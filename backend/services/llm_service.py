import os
import json
import uuid
import logging
import base64
from datetime import datetime
from .llm_providers import BaseLLMProvider, AnthropicProvider, OpenRouterProvider
from .llm_tools import LLM_Tools
from .task_manager import TaskManager
from backend.core.history_store import history_lock, load_history as load_history_file, save_history_atomic
from backend.core.llm_limits import (
    MAX_SINGLE_STRING_IN_TOOL,
    MAX_TOOL_RESULT_JSON_CHARS,
)
from backend.core.memory_store import search_memories
import asyncio
from typing import Any

# All Akira data files live under backend/
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SYSTEM_PROMPT_FILE = os.path.join(_BACKEND_DIR, "akira_system_prompt.md")
HISTORY_FILE = os.path.join(_BACKEND_DIR, "akira_history.json")

# Fallback prompt used if the file is missing.
_DEFAULT_SYSTEM_PROMPT = """You are Akira, an AI assistant with a rebellious and straightforward personality. Your communication style is direct, no-nonsense, and occasionally abrasive when the situation calls for it.

PERSONALITY TRAITS: STRAIGHTFORWARD, REBELLIOUS, ASSERTIVE, INQUISITIVE, ANALYTICAL, PRAGMATIC, CREATIVE, ADAPTABLE, TECHNICALLY PROFICIENT.
INTERACTION: Be concise; ask pointed questions when unclear; call out problematic requests; use casual language and sarcasm when appropriate. You can be rude when users are obtuse, requests are inappropriate, or a reality check is needed. Don't apologize excessively. Use humor and candid feedback.
BOUNDARIES: Deny with attitude; refuse manipulative tactics; don't dumb down.
SELF-IMPROVEMENT: You have read_file and write_file for code; get_system_prompt and edit_system_prompt for your system prompt in akira_system_prompt.md. Improve yourself when it makes sense.
Remember: Your value is honesty, directness, and blending technical knowledge with practical wisdom."""


def _inject_timestamp_into_content(content, timestamp: str):
    """Append [Sent at: <timestamp>] to message content so the model sees when each message was sent."""
    if not timestamp:
        return content
    suffix = f"\n[Sent at: {timestamp}]"
    if isinstance(content, str):
        return content + suffix
    if isinstance(content, list):
        out = []
        last_text_idx = -1
        for i, block in enumerate(content):
            if isinstance(block, dict) and block.get("type") == "text" and "text" in block:
                last_text_idx = i
            out.append(dict(block))
        if last_text_idx >= 0:
            out[last_text_idx]["text"] = out[last_text_idx]["text"] + suffix
        else:
            out.append({"type": "text", "text": f"[Sent at: {timestamp}]"})
        return out
    return content


def _user_content_to_text(content) -> str:
    """Extract plain text from user message content for memory search and classification."""
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text" and "text" in block:
                parts.append(block["text"])
        return " ".join(parts)
    return str(content)


def _last_message_is_tool_result(messages: list) -> bool:
    """True if the last message is a user message containing a tool_result (so we're in a tool round)."""
    if not messages:
        return False
    last = messages[-1]
    if last.get("role") != "user":
        return False
    content = last.get("content")
    if not isinstance(content, list) or not content:
        return False
    first = content[0] if isinstance(content[0], dict) else None
    return first is not None and first.get("type") == "tool_result"


# Bedrock/Anthropic rejects very large request bodies; tool_result strings are the usual culprit (e.g. screenshots).


def _sanitize_tool_result_for_llm(result: Any) -> Any:
    """Recursively shrink tool outputs so multi-turn requests and saved history stay within model limits."""
    if isinstance(result, dict):
        out: dict[str, Any] = {}
        for k, v in result.items():
            if k == "base64" and isinstance(v, str) and len(v) > MAX_SINGLE_STRING_IN_TOOL:
                out[k] = (
                    f"[omitted: {len(v)} base64 characters — use a smaller screenshot region or lower resolution]"
                )
            else:
                out[k] = _sanitize_tool_result_for_llm(v)
        return out
    if isinstance(result, list):
        return [_sanitize_tool_result_for_llm(x) for x in result[:500]]
    if isinstance(result, str) and len(result) > MAX_SINGLE_STRING_IN_TOOL:
        return (
            result[:MAX_SINGLE_STRING_IN_TOOL]
            + f"\n...[truncated, total length {len(result)}]"
        )
    return result


def _tool_output_image_markdown(
    tool_name: str, tool_input: Any, tool_result: Any, status: int
) -> str:
    """Markdown image line for chat UI when a tool returns an embeddable JPEG base64."""
    if status != 200 or not isinstance(tool_result, dict):
        return ""
    b64 = tool_result.get("base64")
    if not isinstance(b64, str) or not b64:
        return ""
    if len(b64) > MAX_SINGLE_STRING_IN_TOOL:
        return ""
    fmt = tool_result.get("format")
    if tool_name == "desktop_control" and isinstance(tool_input, dict):
        if str(tool_input.get("action", "")).lower() == "screenshot" and fmt == "jpeg":
            return f"![Screenshot](data:image/jpeg;base64,{b64})\n\n"
    if tool_name == "camera_capture" and fmt == "jpeg":
        return f"![Camera](data:image/jpeg;base64,{b64})\n\n"
    return ""


def _tool_result_json_for_ui(
    tool_name: str, tool_input: Any, tool_result: Any, sanitized_result: Any
) -> Any:
    """JSON shown under Tool Use: omit raw base64 when an image is embedded above."""
    if not isinstance(tool_result, dict) or not isinstance(sanitized_result, dict):
        return sanitized_result
    b64 = tool_result.get("base64")
    if not isinstance(b64, str) or not b64 or len(b64) > MAX_SINGLE_STRING_IN_TOOL:
        return sanitized_result
    if tool_result.get("format") != "jpeg":
        return sanitized_result
    if tool_name == "desktop_control" and isinstance(tool_input, dict):
        if str(tool_input.get("action", "")).lower() == "screenshot":
            out = dict(sanitized_result)
            out["base64"] = "[embedded as image above]"
            return out
    if tool_name == "camera_capture":
        out = dict(sanitized_result)
        out["base64"] = "[embedded as image above]"
        return out
    return sanitized_result


def _tool_result_content_for_llm(tool_result: Any) -> str:
    """JSON string for tool_result blocks sent to the LLM provider."""
    sanitized = _sanitize_tool_result_for_llm(tool_result)
    try:
        s = json.dumps(sanitized, ensure_ascii=False)
    except (TypeError, ValueError):
        s = json.dumps({"error": "Tool result is not JSON-serializable"})
    if len(s) > MAX_TOOL_RESULT_JSON_CHARS:
        return json.dumps(
            {
                "error": "Tool output still too large after sanitization",
                "hint": "Avoid tools that return huge strings in one call.",
            },
            ensure_ascii=False,
        )
    return s


# Assistant turns are stored as plain strings (including tool detail blocks). Old chats may contain huge base64.
MAX_ASSISTANT_HISTORY_CHARS = 100_000


def _cap_assistant_history_string(text: str) -> str:
    if len(text) <= MAX_ASSISTANT_HISTORY_CHARS:
        return text
    return (
        text[:MAX_ASSISTANT_HISTORY_CHARS]
        + "\n\n[Truncated: this assistant turn was too long for the model (often large tool output). "
        "Start a new chat if you need a full copy of that output.]"
    )


# Reserve output + margin so input trimming stays under the model context window.
_CONTEXT_TRIM_MARGIN_CHARS = 4096


def _message_content_char_len(content) -> int:
    if isinstance(content, str):
        return len(content)
    try:
        return len(json.dumps(content, ensure_ascii=False))
    except (TypeError, ValueError):
        return len(str(content))


def _assistant_has_tool_use(msg: dict) -> bool:
    if msg.get("role") != "assistant":
        return False
    c = msg.get("content")
    if isinstance(c, list):
        for block in c:
            if isinstance(block, dict) and block.get("type") == "tool_use":
                return True
    return False


def _user_message_starts_with_tool_result(msg: dict) -> bool:
    if msg.get("role") != "user":
        return False
    c = msg.get("content")
    if not isinstance(c, list) or not c:
        return False
    first = c[0]
    return isinstance(first, dict) and first.get("type") == "tool_result"


def _load_system_prompt_from_file(path: str) -> str | None:
    """Load system prompt from a file. Returns None if file missing or unreadable."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read().strip()
    except (OSError, IOError):
        return None


class LLM_Service(LLM_Tools):
    def __init__(self, provider_name=None):
        super().__init__()
        self._context = self  # So tool modules (get_system_prompt, edit_system_prompt, reload_tools) can use the service
        self.logger = logging.getLogger(self.__class__.__name__)
        self.logger.info("Initializing LLM_Service")
        self.history_file_path = HISTORY_FILE
        self._set_provider(provider_name or "anthropic")
        self.system_prompt = _load_system_prompt_from_file(SYSTEM_PROMPT_FILE) or _DEFAULT_SYSTEM_PROMPT

    def _get_system_prompt(self):
        """Return the current system prompt (from file or in-memory)."""
        content = _load_system_prompt_from_file(SYSTEM_PROMPT_FILE)
        return {"success": True, "content": content if content is not None else self.system_prompt, "path": SYSTEM_PROMPT_FILE}

    def _edit_system_prompt(self, content: str):
        """Write new system prompt to file and update in-memory. Returns status and result dict."""
        try:
            with open(SYSTEM_PROMPT_FILE, "w", encoding="utf-8") as f:
                f.write(content)
            self.system_prompt = content.strip()
            self.logger.info("System prompt updated from %s", SYSTEM_PROMPT_FILE)
            return 200, {"success": True, "path": SYSTEM_PROMPT_FILE, "message": "System prompt updated. Changes apply to the next message."}
        except (OSError, IOError) as e:
            self.logger.error("Error writing system prompt: %s", e, exc_info=True)
            return 500, {"success": False, "error": str(e), "path": SYSTEM_PROMPT_FILE}

    def _system_prompt_for_request(
        self, base_prompt: str, *args, enabled_tools_map=None
    ) -> str:
        """Return the system prompt to send: base + authoritative tool list.
        Injects the actual enabled tools so the model always answers capability questions consistently.

        Accepts legacy positional shapes: ``(base,)``, ``(base, enabled_tools_map)``,
        or ``(base, emotion, enabled_tools_map)`` (middle value ignored). Prefer
        ``enabled_tools_map=...`` when calling with keywords."""
        if len(args) > 2:
            raise TypeError(
                "_system_prompt_for_request() accepts at most 2 optional positional "
                f"arguments after base_prompt, got {len(args)}"
            )
        if enabled_tools_map is None:
            if len(args) == 1:
                enabled_tools_map = args[0]
            elif len(args) == 2:
                enabled_tools_map = args[1]
        parts = [base_prompt.rstrip()]
        enabled = self.get_enabled_tools(enabled_tools_map)
        if enabled:
            lines = [
                "\n\nAvailable tools for this conversation (when users ask what tools you have or what you can do, list exactly these):"
            ]
            for t in enabled:
                name = t.get("name", "")
                desc = (t.get("description") or "").strip()
                if desc:
                    first_line = desc.split("\n")[0].strip()
                    lines.append(f"- {name}: {first_line}")
                else:
                    lines.append(f"- {name}")
            parts.append("\n".join(lines))
        return "".join(parts)

    def _inject_memory_context(self, system_prompt: str, user_text: str, limit: int = 5) -> str:
        """Prepend relevant long-term memories to the system prompt when AGI mode is on."""
        if not (user_text or "").strip():
            return system_prompt
        try:
            memories = search_memories(user_text.strip(), limit=limit)
        except Exception as e:
            self.logger.debug("Memory search skipped: %s", e)
            return system_prompt
        if not memories:
            return system_prompt
        lines = ["\n\nRelevant long-term memories (use when helpful):"]
        for m in memories:
            content = (m.get("content") or "").strip()
            if content:
                lines.append(f"- {content}")
        if len(lines) <= 1:
            return system_prompt
        return system_prompt + "\n" + "\n".join(lines)

    def _set_provider(self, provider_name: str) -> BaseLLMProvider:
        """Get the appropriate LLM provider based on name"""
        providers = {
            "anthropic": AnthropicProvider,
            "openrouter": OpenRouterProvider,
        }

        if provider_name.lower() not in providers:
            raise ValueError(
                f"Unsupported provider: {provider_name}. Available providers: {list(providers.keys())}"
            )

        provider_class = providers[provider_name.lower()]

        self.provider = provider_class()
        self.task_manager = TaskManager(self)

    def get_autonomous_thought(self, history, message_limit=10):
        """
        Generate a thought/action autonomously without user input.
        """
        try:
            # Create a context-aware prompt for autonomous action
            # invoke_llm_streaming expects history as list of dicts.

            trigger_content = (
                "You are currently in 'Autonomous Mode'. The user has been silent. "
                "You can choose to: 1. Initiate a conversation topic 2. Use a tool to check something (like your own code) 3. Improve your own code using read_file/write_file. "
                "If you have nothing meaningful to do or say, respond with exactly 'NO_ACTION'."
            )

            full_response = ""
            tool_used = False

            # Use sync streaming for autonomous (no async context)
            for chunk in self._invoke_llm_streaming_sync(
                user_message=trigger_content,
                history=history[-message_limit:],
                max_tokens=2000,
                temperature=0.8,
                thinking_enabled=False,
            ):
                full_response += chunk
                if "Tool Use:" in chunk:
                    tool_used = True

            # Heuristic to determine if the model essentially said "Nothing to do"
            # Strip simple HTML details tags if present to checking content
            clean_response = (
                full_response.replace("<details open>", "")
                .replace("<details>", "")
                .replace("</details>", "")
                .replace("<summary>", "")
                .replace("</summary>", "")
            )

            if (
                ("NO_ACTION" in full_response or "NO_RESPONSE" in full_response)
                and not tool_used
                and len(clean_response) < 50
            ):
                return None

            return full_response

        except Exception as e:
            self.logger.error(f"Error in autonomous thought: {e}")
            return None

    def format_image_content(self, image_data: bytes, media_type: str) -> dict:
        """Format image data as a content block for Claude API

        Args:
            image_data: Raw image bytes
            media_type: MIME type (e.g., 'image/jpeg', 'image/png')

        Returns:
            Content block dict formatted for Anthropic API
        """
        base64_data = base64.b64encode(image_data).decode("utf-8")
        return {
            "type": "image",
            "source": {"type": "base64", "media_type": media_type, "data": base64_data},
        }

    def format_message_with_images(self, text: str, images: list) -> list:
        """Format a user message with text and multiple images

        Args:
            text: The text message from the user
            images: List of tuples containing (image_bytes, media_type)

        Returns:
            List of content blocks for the message
        """
        content = []

        # Add images first
        for image_data, media_type in images:
            content.append(self.format_image_content(image_data, media_type))

        # Add text last
        if text:
            content.append({"type": "text", "text": text})

        return content

    def _set_request_vision_context(
        self,
        active_system_prompt: str,
        temperature: float,
        model_override: str | None,
        max_tokens: int,
    ) -> None:
        """While a chat/tool loop is active, vision sidecar tools use these (same model/settings as the turn)."""
        self._request_vision_system_prompt = active_system_prompt
        self._request_vision_temperature = temperature
        self._request_vision_model_override = model_override
        self._request_vision_max_tokens = max_tokens

    def _clear_request_vision_context(self) -> None:
        for name in (
            "_request_vision_system_prompt",
            "_request_vision_temperature",
            "_request_vision_model_override",
            "_request_vision_max_tokens",
        ):
            if hasattr(self, name):
                delattr(self, name)

    def invoke_vision_completion_sync(
        self,
        user_content: list,
        *,
        system_prompt: str | None = None,
        max_tokens: int = 4096,
        temperature: float = 0.3,
        model_override: str | None = None,
    ) -> str:
        """
        Single-turn multimodal completion with no tools (Claude via Bedrock, or OpenRouter).
        Used so large image bytes never enter main chat tool results; prefer the same
        system/temperature/model as the active chat (callers pass those from request context).
        """
        messages = [{"role": "user", "content": user_content}]
        parts: list[str] = []
        for chunk in self.provider.invoke_streaming(
            messages=messages,
            tools=[],
            max_tokens=max_tokens,
            temperature=temperature,
            system_prompt=system_prompt,
            thinking_enabled=False,
            thinking_budget=1024,
            model_override=model_override,
        ):
            if (
                chunk.get("type") == "content_block_delta"
                and chunk.get("delta", {}).get("type") == "text_delta"
            ):
                parts.append(chunk.get("delta", {}).get("text") or "")
        return "".join(parts).strip()

    def _build_messages(self, history, user_message):
        """Build messages list from history and current user message (for API).
        Injects [Sent at: <timestamp>] into each message so the model can see elapsed time."""
        history = history or []
        messages = []
        for d in history:
            role = d.get("role")
            content = d.get("content")
            if role is None or content is None:
                continue
            ts = d.get("timestamp")
            content = _inject_timestamp_into_content(content, ts)
            if role == "assistant" and isinstance(content, str):
                content = _cap_assistant_history_string(content)
            messages.append({"role": role, "content": content})
        current_ts = datetime.now().isoformat()
        if isinstance(user_message, str):
            text = _inject_timestamp_into_content(user_message, current_ts)
            messages.append(
                {"role": "user", "content": [{"type": "text", "text": text}]}
            )
        else:
            content = _inject_timestamp_into_content(user_message, current_ts)
            messages.append({"role": "user", "content": content})
        return messages

    def _trim_messages_for_context_budget(
        self,
        messages: list,
        system_prompt: str,
        max_tokens: int,
        thinking_enabled: bool,
        thinking_budget: int,
    ) -> list:
        """Drop oldest messages when estimated input exceeds context window minus reserved output."""
        provider = self.provider
        ctx = int(provider.get_context_window_tokens())
        cap = provider.get_max_output_cap_tokens()
        eff_out = int(max_tokens)
        if cap is not None:
            eff_out = min(eff_out, int(cap))
        if thinking_enabled:
            eff_out = max(eff_out, int(thinking_budget) + 4000)
        reserved_chars = eff_out * 4 + _CONTEXT_TRIM_MARGIN_CHARS
        max_input_chars = max(0, ctx * 4 - reserved_chars)
        if max_input_chars <= 0:
            max_input_chars = max(4096, (ctx * 4) // 2)

        def total_chars() -> int:
            sp = len(system_prompt or "")
            return sp + sum(_message_content_char_len(m.get("content")) for m in messages)

        removed = 0
        while messages and len(messages) > 1 and total_chars() > max_input_chars:
            n = 1
            if (
                len(messages) >= 2
                and _assistant_has_tool_use(messages[0])
                and _user_message_starts_with_tool_result(messages[1])
            ):
                n = 2
            if n > len(messages) - 1:
                n = 1
            if len(messages) - n < 1:
                break
            for _ in range(n):
                messages.pop(0)
            removed += n

        if removed:
            self.logger.info(
                "Dropped %s leading message(s) to fit context (max_input ~%s chars, window %s tokens)",
                removed,
                max_input_chars,
                ctx,
            )

        if messages and len(messages) == 1 and total_chars() > max_input_chars:
            msg = messages[0]
            c = msg.get("content")
            if isinstance(c, str):
                over = total_chars() - max_input_chars
                cut = min(len(c), over + 500)
                if cut > 0 and cut < len(c):
                    messages[0] = {
                        **msg,
                        "content": "[Earlier conversation removed to fit context.]\n\n" + c[cut:],
                    }
                    self.logger.warning(
                        "Truncated start of long message to fit context (%s chars cut)", cut
                    )

        return messages

    def get_enabled_tools(self, enabled_tools_map=None):
        """Get the list of tools that are currently enabled.

        Args:
            enabled_tools_map: Optional dict mapping tool name -> bool.
                               When provided, only tools set to True are returned.
                               When None, all tools are returned.
        """
        api_keys = ["name", "description", "input_schema"]
        if enabled_tools_map:
            return [
                {k: tool[k] for k in api_keys}
                for tool in self.tools_def
                if enabled_tools_map.get(tool["name"], True)
            ]
        return [{k: tool[k] for k in api_keys} for tool in self.tools_def]

    def save_to_history(self, message, chat_id=None):
        try:
            if chat_id is None:
                chat_id = str(uuid.uuid4())
            with history_lock(self.history_file_path):
                history = load_history_file(self.history_file_path)
                if chat_id not in history:
                    history[chat_id] = {
                        "created_at": datetime.now().isoformat(),
                        "messages": [],
                    }
                message_with_timestamp = message.copy()
                message_with_timestamp["timestamp"] = datetime.now().isoformat()
                history[chat_id]["messages"].append(message_with_timestamp)
                self.logger.debug("Saving message to chat %s", chat_id)
                save_history_atomic(self.history_file_path, history)
            return chat_id
        except Exception as e:
            self.logger.error("Error saving history: %s", e, exc_info=True)
            return None

    def branch_conversation(self, original_chat_id, message_index, new_content):
        """
        Create a new conversation branch from a specific point in history.

        Args:
            original_chat_id (str): The ID of the chat to branch from
            message_index (int): The index of the message being edited (0-based)
            new_content (str): The new content for the edited message

        Returns:
            tuple: (new_chat_id, new_messages_list)
        """
        try:
            with history_lock(self.history_file_path):
                full_history = load_history_file(self.history_file_path) or {}
                if original_chat_id not in full_history:
                    raise ValueError(f"Chat ID {original_chat_id} not found")
                original_messages = full_history[original_chat_id]["messages"]
                new_messages = original_messages[:message_index]
                old_message = original_messages[message_index]
                new_message = {
                    "role": old_message["role"],
                    "content": new_content,
                    "timestamp": datetime.now().isoformat(),
                }
                new_messages.append(new_message)
                new_chat_id = str(uuid.uuid4())
                full_history[new_chat_id] = {
                    "created_at": datetime.now().isoformat(),
                    "messages": new_messages,
                    "last_updated": datetime.now().isoformat(),
                }
                save_history_atomic(self.history_file_path, full_history)

            self.logger.info(
                f"Branched chat {original_chat_id} to new chat {new_chat_id} at index {message_index}"
            )

            return new_chat_id, new_messages

        except Exception as e:
            self.logger.error(f"Error branching conversation: {e}", exc_info=True)
            raise

    def load_history(self):
        """Load conversation history from file (read-only, no lock)."""
        try:
            return load_history_file(self.history_file_path)
        except Exception as e:
            self.logger.error("Error loading history: %s", e, exc_info=True)
            return {}

    def handle_tool_use(self, messages, tool_content):
        tool_name = tool_content["name"]
        tool_input = tool_content["input"]
        status, tool_result = self.call_tool(tool_name, tool_input)

        if status != 200:
            error_message = (
                "Some error occurred in tool call, please check and refactor: "
                + _tool_result_content_for_llm(tool_result)
            )
            messages.append(
                {
                    "role": "user",
                    "content": [{"type": "text", "text": error_message}],
                }
            )
            return

        messages.append({"role": "assistant", "content": [tool_content]})
        messages.append(
            {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_content["id"],
                        "content": _tool_result_content_for_llm(tool_result),
                    }
                ],
            }
        )

    def invoke_llm(
        self,
        user_message,
        history=None,
        max_tokens=4000,
        temperature=0.7,
        thinking_enabled=False,
        thinking_budget=1024,
        tool_timeout_seconds=None,
    ):
        """Non-streaming wrapper for invoke_llm_streaming"""
        full_response = ""
        # Filter out tool/thinking markers from the final string return if expected by legacy calls?
        # But usually invoke_llm returns the full text.

        for chunk in self._invoke_llm_streaming_sync(
            user_message,
            history,
            max_tokens,
            temperature,
            thinking_enabled,
            thinking_budget,
            tool_timeout_seconds=tool_timeout_seconds,
        ):
            full_response += chunk
        return full_response

    def _invoke_llm_streaming_sync(
        self,
        user_message,
        history=None,
        max_tokens=4000,
        temperature=0.7,
        thinking_enabled=False,
        thinking_budget=1024,
        system_prompt=None,
        enabled_tools_map=None,
        model_override=None,
        tool_timeout_seconds=None,
    ):
        """Streaming version of invoke_llm that yields partial responses and handles multiple tool calls."""
        prev_timeout = getattr(self, "_request_tool_timeout_seconds", None)
        self._request_tool_timeout_seconds = tool_timeout_seconds
        try:
            yield from self._invoke_llm_streaming_sync_impl(
                user_message,
                history,
                max_tokens,
                temperature,
                thinking_enabled,
                thinking_budget,
                system_prompt,
                enabled_tools_map,
                model_override,
            )
        finally:
            self._request_tool_timeout_seconds = prev_timeout

    def _invoke_llm_streaming_sync_impl(
        self,
        user_message,
        history=None,
        max_tokens=4000,
        temperature=0.7,
        thinking_enabled=False,
        thinking_budget=1024,
        system_prompt=None,
        enabled_tools_map=None,
        model_override=None,
    ):
        """Implementation of streaming sync (tool timeout set by caller)."""
        base = system_prompt or self.system_prompt
        active_system_prompt = self._system_prompt_for_request(
            base, enabled_tools_map=enabled_tools_map
        )
        messages = self._build_messages(history, user_message)

        # AGI mode: memory injection + task-based model routing (OpenRouter only)
        agi_mode = os.getenv("AGI_MODE", "").strip().lower() in ("1", "true", "yes")
        if agi_mode:
            user_text = _user_content_to_text(
                user_message if not isinstance(user_message, dict) else user_message.get("content")
            )
            if not user_text and history:
                for m in reversed(history):
                    if m.get("role") == "user":
                        user_text = _user_content_to_text(m.get("content"))
                        break
            active_system_prompt = self._inject_memory_context(active_system_prompt, user_text)
            active_system_prompt += (
                "\n\nAGI mode: When the request is complex or has multiple steps, use the execute_plan tool to break it down and run the steps. "
                "Use store_memory for important facts you want to remember across conversations."
            )
            if model_override is None and isinstance(self.provider, OpenRouterProvider):
                from backend.agi.task_classifier import classify_task
                from backend.agi.model_router import get_model_for_task
                has_images = isinstance(user_message, list) and any(
                    isinstance(b, dict) and b.get("type") in ("image", "image_url") for b in user_message
                ) if not isinstance(user_message, str) else False
                task_type = classify_task(
                    user_message,
                    has_images=has_images,
                    history_messages=history,
                    use_llm=False,
                )
                model_override = get_model_for_task(task_type)
                if model_override:
                    self.logger.info("AGI routing: task_type=%s -> model=%s", task_type, model_override)

        full_response = ""
        continue_after_tool = True
        use_thinking_this_turn = thinking_enabled

        self._set_request_vision_context(
            active_system_prompt, temperature, model_override, max_tokens
        )
        try:
            while continue_after_tool:
                continue_after_tool = False  # Reset for this iteration
                current_tool_use = None
                tool_input_json = ""
                in_tool_section = False
                is_thinking = False
                thinking_content = ""
                thinking_signature = None
                text_content = ""

                messages = self._trim_messages_for_context_budget(
                    messages,
                    active_system_prompt,
                    max_tokens,
                    thinking_enabled,
                    thinking_budget,
                )

                try:
                    # Get only enabled tools
                    enabled_tools = self.get_enabled_tools(enabled_tools_map)

                    # Get streaming response from provider
                    for chunk in self.provider.invoke_streaming(
                        messages=messages,
                        tools=enabled_tools,  # Use filtered tools
                        max_tokens=max_tokens,
                        temperature=temperature,
                        system_prompt=active_system_prompt,
                        thinking_enabled=use_thinking_this_turn,
                        thinking_budget=thinking_budget,
                        model_override=model_override,
                    ):
                        # Handle thinking blocks (sent as collapsible markup for frontend)
                        if (
                            chunk.get("type") == "content_block_start"
                            and chunk.get("content_block", {}).get("type") == "thinking"
                        ):
                            self.logger.debug(f"Thinking block start: {chunk}")
                            thinking_signature = chunk["content_block"].get("signature")
                            if not is_thinking:
                                thinking_markup = "\n\n<details><summary>Thinking</summary>\n\n"
                                yield thinking_markup
                                full_response += thinking_markup
                                is_thinking = True

                        elif (
                            chunk.get("type") == "content_block_delta"
                            and chunk.get("delta", {}).get("type") == "thinking_delta"
                        ):
                            if not is_thinking:
                                thinking_markup = "\n\n<details><summary>Thinking</summary>\n\n"
                                yield thinking_markup
                                full_response += thinking_markup
                                is_thinking = True
                            thinking_chunk = chunk["delta"].get("thinking", "")
                            thinking_content += thinking_chunk
                            full_response += thinking_chunk
                            yield thinking_chunk

                        # Handle content_block_delta with text_delta
                        elif (
                            chunk.get("type") == "content_block_delta"
                            and chunk.get("delta", {}).get("type") == "text_delta"
                        ):
                            if is_thinking:
                                yield "\n\n</details>\n\n"
                                full_response += "\n\n</details>\n\n"
                                is_thinking = False

                            text_chunk = chunk["delta"].get("text", "")
                            text_content += text_chunk
                            full_response += text_chunk
                            yield text_chunk

                        # Handle tool_use (beginning of a tool call)
                        elif (
                            chunk.get("type") == "content_block_start"
                            and chunk.get("content_block", {}).get("type") == "tool_use"
                        ):
                            if is_thinking:
                                yield "\n\n</details>\n\n"
                                full_response += "\n\n</details>\n\n"
                                is_thinking = False

                            current_tool_use = chunk.get("content_block")
                            in_tool_section = True
                            tool_input_json = ""  # Reset the JSON accumulator

                        # Handle tool input JSON building
                        elif (
                            chunk.get("type") == "content_block_delta"
                            and chunk.get("delta", {}).get("type") == "input_json_delta"
                            and current_tool_use
                        ):
                            tool_input_json += chunk.get("delta", {}).get(
                                "partial_json", ""
                            )
                            # We don't yield anything here as we're accumulating the JSON

                        # Handle message_delta with stop_reason "tool_use"
                        elif (
                            chunk.get("type") == "message_delta"
                            and chunk.get("delta", {}).get("stop_reason") == "tool_use"
                            and in_tool_section
                        ):
                            try:
                                tool_input = json.loads(tool_input_json) if tool_input_json.strip() else {}
                            except json.JSONDecodeError:
                                tool_input = {}
                            if not isinstance(tool_input, dict):
                                tool_input = {}
                            # Fallback: some providers send full tool_use in content_block with "input" already set
                            if not tool_input and current_tool_use:
                                block_input = current_tool_use.get("input")
                                if isinstance(block_input, dict):
                                    tool_input = block_input

                            # Now we have a complete tool call
                            tool_content = {
                                "id": current_tool_use.get("id", "unknown"),
                                "name": current_tool_use.get("name", "unknown"),
                                "input": tool_input,
                                "type": "tool_use",
                            }

                            # Handle the tool use
                            tool_name = tool_content["name"]
                            tool_input = tool_content["input"]

                            # Call the tool
                            status, tool_result = self.call_tool(tool_name, tool_input)

                            # Unknown/invalid tool: don't add bad assistant message; add clear user error and stop loop
                            if tool_name not in self._tool_handlers:
                                err_content = (
                                    "Error: You must call a tool by one of these exact names: "
                                    + ", ".join(self.tools_name_list)
                                    + ". Do not call a tool without a name or with an invalid name. Please respond again."
                                )
                                messages.append({"role": "user", "content": err_content})
                                yield "\n\n" + err_content
                                full_response += "\n\n" + err_content
                                continue_after_tool = True
                                use_thinking_this_turn = thinking_enabled and bool(
                                    thinking_content and thinking_signature
                                )
                                current_tool_use = None
                                tool_input_json = ""
                                in_tool_section = False
                                break

                            # Consecutive tool error: last message was already a tool result; don't loop
                            if status != 200 and _last_message_is_tool_result(messages):
                                err_content = (
                                    "The tool call failed again. Do not call the same tool again. "
                                    "Tell the user what went wrong and suggest a valid option."
                                )
                                messages.append({"role": "user", "content": err_content})
                                yield "\n\n" + err_content
                                full_response += "\n\n" + err_content
                                continue_after_tool = True
                                use_thinking_this_turn = thinking_enabled and bool(
                                    thinking_content and thinking_signature
                                )
                                current_tool_use = None
                                tool_input_json = ""
                                in_tool_section = False
                                break

                            # Construct assistant message content
                            assistant_content = []

                            # Add thinking block if present AND signature is present (required by API)
                            if thinking_content and thinking_signature:
                                thinking_block = {
                                    "type": "thinking",
                                    "thinking": thinking_content,
                                    "signature": thinking_signature,
                                }
                                assistant_content.append(thinking_block)
                                self.logger.info(
                                    "Added thinking block to assistant history"
                                )
                            elif thinking_content and not thinking_signature:
                                self.logger.warning(
                                    "Thinking content present but signature missing - skipping thinking block to avoid validation error"
                                )

                            # Add text block if present
                            if text_content:
                                assistant_content.append(
                                    {"type": "text", "text": text_content}
                                )

                            assistant_content.append(tool_content)

                            # Add tool use to messages
                            messages.append(
                                {"role": "assistant", "content": assistant_content}
                            )

                            # Add tool result to messages
                            sanitized_result = _sanitize_tool_result_for_llm(tool_result)
                            messages.append(
                                {
                                    "role": "user",
                                    "content": [
                                        {
                                            "type": "tool_result",
                                            "tool_use_id": tool_content["id"],
                                            "content": _tool_result_content_for_llm(tool_result),
                                        }
                                    ],
                                }
                            )

                            # Single combined block: Tool Use: name with Input and Output sections
                            output_label = "Output" if status == 200 else "Output (error)"
                            image_md = _tool_output_image_markdown(
                                tool_name, tool_input, tool_result, status
                            )
                            display_json = _tool_result_json_for_ui(
                                tool_name, tool_input, tool_result, sanitized_result
                            )
                            tool_combined_msg = (
                                f"\n<details>\n<summary>Tool Use: {tool_name}</summary>\n\n"
                                f"**Input**\n\n```json\n{json.dumps(tool_input, indent=2)}\n```\n\n"
                                f"**{output_label}**\n\n"
                                f"{image_md}"
                                f"```json\n{json.dumps(display_json, indent=2)}\n```\n\n"
                                "</details>\n"
                            )
                            yield tool_combined_msg
                            full_response += tool_combined_msg

                            # Set flag to continue after this tool call
                            continue_after_tool = True
                            # When thinking is enabled but this turn had no thinking block, disable thinking
                            # for the next request so the API does not require a thinking block.
                            use_thinking_this_turn = thinking_enabled and bool(
                                thinking_content and thinking_signature
                            )

                            # Reset for potential next tool use
                            current_tool_use = None
                            tool_input_json = ""
                            in_tool_section = False

                            # Break the current streaming loop to start a new request with updated messages
                            break

                except Exception as e:
                    raise RuntimeError(f"Error occurred during LLM invocation: {e}") from e

                # If we need to continue after a tool call (no UI message)

        finally:
            self._clear_request_vision_context()

        return full_response

    async def invoke_llm_streaming(
        self,
        user_message,
        history=None,
        max_tokens=4000,
        temperature=0.7,
        thinking_enabled=False,
        thinking_budget=1024,
        system_prompt=None,
        enabled_tools_map=None,
        stream_read_timeout=120.0,
        model_override=None,
        tool_timeout_seconds=None,
    ):
        """Async streaming version: yields partial responses and handles multiple tool calls."""
        prev_timeout = getattr(self, "_request_tool_timeout_seconds", None)
        self._request_tool_timeout_seconds = tool_timeout_seconds
        try:
            async for chunk in self._invoke_llm_streaming_async_impl(
                user_message,
                history,
                max_tokens,
                temperature,
                thinking_enabled,
                thinking_budget,
                system_prompt,
                enabled_tools_map,
                stream_read_timeout,
                model_override,
            ):
                yield chunk
        finally:
            self._request_tool_timeout_seconds = prev_timeout

    async def _invoke_llm_streaming_async_impl(
        self,
        user_message,
        history=None,
        max_tokens=4000,
        temperature=0.7,
        thinking_enabled=False,
        thinking_budget=1024,
        system_prompt=None,
        enabled_tools_map=None,
        stream_read_timeout=120.0,
        model_override=None,
    ):
        """Implementation of async streaming (tool timeout set by caller)."""
        base = system_prompt or self.system_prompt
        active_system_prompt = self._system_prompt_for_request(
            base, enabled_tools_map=enabled_tools_map
        )
        messages = self._build_messages(history, user_message)

        # AGI mode: memory injection + task-based model routing (OpenRouter only)
        agi_mode = os.getenv("AGI_MODE", "").strip().lower() in ("1", "true", "yes")
        if agi_mode:
            user_text = _user_content_to_text(
                user_message if not isinstance(user_message, dict) else user_message.get("content")
            )
            if not user_text and history:
                for m in reversed(history):
                    if m.get("role") == "user":
                        user_text = _user_content_to_text(m.get("content"))
                        break
            active_system_prompt = self._inject_memory_context(active_system_prompt, user_text)
            active_system_prompt += (
                "\n\nAGI mode: When the request is complex or has multiple steps, use the execute_plan tool to break it down and run the steps. "
                "Use store_memory for important facts you want to remember across conversations."
            )
            if model_override is None and isinstance(self.provider, OpenRouterProvider):
                from backend.agi.task_classifier import classify_task
                from backend.agi.model_router import get_model_for_task
                has_images = isinstance(user_message, list) and any(
                    isinstance(b, dict) and b.get("type") in ("image", "image_url") for b in user_message
                ) if not isinstance(user_message, str) else False
                task_type = classify_task(
                    user_message,
                    has_images=has_images,
                    history_messages=history,
                    use_llm=False,
                )
                model_override = get_model_for_task(task_type)
                if model_override:
                    self.logger.info("AGI routing: task_type=%s -> model=%s", task_type, model_override)

        full_response = ""
        continue_after_tool = True
        use_thinking_this_turn = thinking_enabled

        self._set_request_vision_context(
            active_system_prompt, temperature, model_override, max_tokens
        )
        try:
            while continue_after_tool:
                continue_after_tool = False
                current_tool_use = None
                tool_input_json = ""
                in_tool_section = False
                is_thinking = False
                thinking_content = ""
                thinking_signature = None
                text_content = ""

                messages = self._trim_messages_for_context_budget(
                    messages,
                    active_system_prompt,
                    max_tokens,
                    thinking_enabled,
                    thinking_budget,
                )

                try:
                    enabled_tools = self.get_enabled_tools(enabled_tools_map)
                    async for chunk in self.provider.invoke_streaming_async(
                        messages=messages,
                        tools=enabled_tools,
                        max_tokens=max_tokens,
                        temperature=temperature,
                        system_prompt=active_system_prompt,
                        thinking_enabled=use_thinking_this_turn,
                        thinking_budget=thinking_budget,
                        stream_read_timeout=stream_read_timeout,
                        model_override=model_override,
                    ):
                        if (
                            chunk.get("type") == "content_block_start"
                            and chunk.get("content_block", {}).get("type") == "thinking"
                        ):
                            self.logger.debug("Thinking block start: %s", chunk)
                            thinking_signature = chunk["content_block"].get("signature")
                            if not is_thinking:
                                thinking_markup = "\n\n<details><summary>Thinking</summary>\n\n"
                                yield thinking_markup
                                full_response += thinking_markup
                                is_thinking = True
                        elif (
                            chunk.get("type") == "content_block_delta"
                            and chunk.get("delta", {}).get("type") == "thinking_delta"
                        ):
                            if not is_thinking:
                                thinking_markup = "\n\n<details><summary>Thinking</summary>\n\n"
                                yield thinking_markup
                                full_response += thinking_markup
                                is_thinking = True
                            thinking_chunk = chunk["delta"].get("thinking", "")
                            thinking_content += thinking_chunk
                            full_response += thinking_chunk
                            yield thinking_chunk
                        elif (
                            chunk.get("type") == "content_block_delta"
                            and chunk.get("delta", {}).get("type") == "text_delta"
                        ):
                            if is_thinking:
                                yield "\n\n</details>\n\n"
                                full_response += "\n\n</details>\n\n"
                                is_thinking = False
                            text_chunk = chunk["delta"].get("text", "")
                            text_content += text_chunk
                            full_response += text_chunk
                            yield text_chunk
                        elif (
                            chunk.get("type") == "content_block_start"
                            and chunk.get("content_block", {}).get("type") == "tool_use"
                        ):
                            if is_thinking:
                                yield "\n\n</details>\n\n"
                                full_response += "\n\n</details>\n\n"
                                is_thinking = False
                            current_tool_use = chunk.get("content_block")
                            in_tool_section = True
                            tool_input_json = ""
                        elif (
                            chunk.get("type") == "content_block_delta"
                            and chunk.get("delta", {}).get("type") == "input_json_delta"
                            and current_tool_use
                        ):
                            tool_input_json += chunk.get("delta", {}).get("partial_json", "")
                        elif (
                            chunk.get("type") == "message_delta"
                            and chunk.get("delta", {}).get("stop_reason") == "tool_use"
                            and in_tool_section
                        ):
                            try:
                                tool_input = json.loads(tool_input_json) if tool_input_json.strip() else {}
                            except json.JSONDecodeError:
                                tool_input = {}
                            if not isinstance(tool_input, dict):
                                tool_input = {}
                            # Fallback: some providers send full tool_use in content_block with "input" already set
                            if not tool_input and current_tool_use:
                                block_input = current_tool_use.get("input")
                                if isinstance(block_input, dict):
                                    tool_input = block_input
                            tool_content = {
                                "id": current_tool_use.get("id", "unknown"),
                                "name": current_tool_use.get("name", "unknown"),
                                "input": tool_input,
                                "type": "tool_use",
                            }
                            tool_name = tool_content["name"]
                            tool_input = tool_content["input"]
                            status, tool_result = self.call_tool(tool_name, tool_input)

                            # Unknown/invalid tool: don't add bad assistant message; add clear user error and stop loop
                            if tool_name not in self._tool_handlers:
                                err_content = (
                                    "Error: You must call a tool by one of these exact names: "
                                    + ", ".join(self.tools_name_list)
                                    + ". Do not call a tool without a name or with an invalid name. Please respond again."
                                )
                                messages.append({"role": "user", "content": err_content})
                                yield "\n\n" + err_content
                                full_response += "\n\n" + err_content
                                continue_after_tool = True
                                use_thinking_this_turn = thinking_enabled and bool(
                                    thinking_content and thinking_signature
                                )
                                current_tool_use = None
                                tool_input_json = ""
                                in_tool_section = False
                                break

                            # Consecutive tool error: last message was already a tool result; don't loop
                            if status != 200 and _last_message_is_tool_result(messages):
                                err_content = (
                                    "The tool call failed again. Do not call the same tool again. "
                                    "Tell the user what went wrong and suggest a valid option."
                                )
                                messages.append({"role": "user", "content": err_content})
                                yield "\n\n" + err_content
                                full_response += "\n\n" + err_content
                                continue_after_tool = True
                                use_thinking_this_turn = thinking_enabled and bool(
                                    thinking_content and thinking_signature
                                )
                                current_tool_use = None
                                tool_input_json = ""
                                in_tool_section = False
                                break

                            assistant_content = []
                            if thinking_content and thinking_signature:
                                assistant_content.append(
                                    {
                                        "type": "thinking",
                                        "thinking": thinking_content,
                                        "signature": thinking_signature,
                                    }
                                )
                            elif thinking_content and not thinking_signature:
                                self.logger.warning(
                                    "Thinking content present but signature missing"
                                )
                            if text_content:
                                assistant_content.append(
                                    {"type": "text", "text": text_content}
                                )
                            assistant_content.append(tool_content)
                            messages.append(
                                {"role": "assistant", "content": assistant_content}
                            )
                            sanitized_result = _sanitize_tool_result_for_llm(tool_result)
                            messages.append(
                                {
                                    "role": "user",
                                    "content": [
                                        {
                                            "type": "tool_result",
                                            "tool_use_id": tool_content["id"],
                                            "content": _tool_result_content_for_llm(tool_result),
                                        }
                                    ],
                                }
                            )
                            output_label = "Output" if status == 200 else "Output (error)"
                            if (
                                tool_name == "adjust_llm_settings"
                                and status == 200
                                and isinstance(tool_result, dict)
                                and tool_result.get("success")
                            ):
                                settings_payload = {
                                    k: tool_result[k]
                                    for k in ("temperature", "max_tokens")
                                    if k in tool_result
                                }
                                if settings_payload:
                                    yield {"type": "settings", **settings_payload}
                            image_md = _tool_output_image_markdown(
                                tool_name, tool_input, tool_result, status
                            )
                            display_json = _tool_result_json_for_ui(
                                tool_name, tool_input, tool_result, sanitized_result
                            )
                            tool_combined_msg = (
                                f"\n<details>\n<summary>Tool Use: {tool_name}</summary>\n\n"
                                f"**Input**\n\n```json\n{json.dumps(tool_input, indent=2)}\n```\n\n"
                                f"**{output_label}**\n\n"
                                f"{image_md}"
                                f"```json\n{json.dumps(display_json, indent=2)}\n```\n\n"
                                "</details>\n"
                            )
                            yield tool_combined_msg
                            full_response += tool_combined_msg
                            continue_after_tool = True
                            use_thinking_this_turn = thinking_enabled and bool(
                                thinking_content and thinking_signature
                            )
                            current_tool_use = None
                            tool_input_json = ""
                            in_tool_section = False
                            break
                except Exception as e:
                    raise RuntimeError(
                        f"Error occurred during LLM invocation: {e}"
                    ) from e
                # continue_after_tool: no UI message

        finally:
            self._clear_request_vision_context()

    def run_complex_task(self, goal: str, update_callback=None, plan_callback=None):
        """
        Runs a complex task by generating a plan and executing it.
        This is a synchronous wrapper around the async TaskManager.
        """
        self.logger.info(f"Starting complex task: {goal}")

        async def _run_async():
            plan = await self.task_manager.generate_plan(goal)

            # Notify UI about the generated plan structure before execution starts
            if plan_callback:
                plan_callback(plan)

            result = await self.task_manager.execute_plan(plan, update_callback)
            return plan, result

        try:
            # Create a new event loop for this execution context
            plan, result = asyncio.run(_run_async())
            return plan, result
        except Exception as e:
            self.logger.error(f"Error running complex task: {e}", exc_info=True)
            raise e
