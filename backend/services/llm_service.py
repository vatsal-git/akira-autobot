import os
import json
import uuid
import logging
import base64
from datetime import datetime
from .llm_providers import BaseLLMProvider, AnthropicProvider
from .llm_tools import LLM_Tools
from .task_manager import TaskManager
from backend.core.history_store import history_lock, load_history as load_history_file, save_history_atomic
import asyncio

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
        self.current_mood = None  # Optional; can be set by frontend (settings.mood) or by a tool

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

    def _system_prompt_for_request(self, base_prompt: str, mood_override=None) -> str:
        """Return the system prompt to send: base + current mood line if any. Does not modify the .md file."""
        mood = mood_override if mood_override is not None else self.current_mood
        if not mood or not str(mood).strip():
            return base_prompt
        return base_prompt.rstrip() + "\n\nCurrent mood: " + str(mood).strip()

    def _set_provider(self, provider_name: str) -> BaseLLMProvider:
        """Get the appropriate LLM provider based on name"""
        providers = {
            "anthropic": AnthropicProvider
            # Add more providers here as needed
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

    def _build_messages(self, history, user_message):
        """Build messages list from history and current user message (for API)."""
        history = history or []
        keys_to_keep = ["role", "content"]
        messages = [{k: d[k] for k in keys_to_keep if k in d} for d in history]
        if isinstance(user_message, str):
            messages.append(
                {"role": "user", "content": [{"type": "text", "text": user_message}]}
            )
        else:
            messages.append({"role": "user", "content": user_message})
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
            error_message = f"Some error occured in tool call, please check and refactor: {json.dumps(tool_result)}"
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
                        "content": json.dumps(tool_result),
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
        mood=None,
    ):
        """Streaming version of invoke_llm that yields partial responses and handles multiple tool calls."""
        base = system_prompt or self.system_prompt
        active_system_prompt = self._system_prompt_for_request(base, mood)
        messages = self._build_messages(history, user_message)
        full_response = ""
        continue_after_tool = True
        use_thinking_this_turn = thinking_enabled

        while continue_after_tool:
            continue_after_tool = False  # Reset for this iteration
            current_tool_use = None
            tool_input_json = ""
            in_tool_section = False
            is_thinking = False
            thinking_content = ""
            thinking_signature = None
            text_content = ""

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
                        messages.append(
                            {
                                "role": "user",
                                "content": [
                                    {
                                        "type": "tool_result",
                                        "tool_use_id": tool_content["id"],
                                        "content": json.dumps(tool_result),
                                    }
                                ],
                            }
                        )

                        # Single combined block: Tool Use: name with Input and Output sections
                        output_label = "Output" if status == 200 else "Output (error)"
                        tool_combined_msg = (
                            f"\n<details>\n<summary>Tool Use: {tool_name}</summary>\n\n"
                            f"**Input**\n\n```json\n{json.dumps(tool_input, indent=2)}\n```\n\n"
                            f"**{output_label}**\n\n```json\n{json.dumps(tool_result, indent=2)}\n```\n\n"
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
        mood=None,
    ):
        """Async streaming version: yields partial responses and handles multiple tool calls."""
        base = system_prompt or self.system_prompt
        active_system_prompt = self._system_prompt_for_request(base, mood)
        messages = self._build_messages(history, user_message)
        full_response = ""
        continue_after_tool = True
        use_thinking_this_turn = thinking_enabled

        while continue_after_tool:
            continue_after_tool = False
            current_tool_use = None
            tool_input_json = ""
            in_tool_section = False
            is_thinking = False
            thinking_content = ""
            thinking_signature = None
            text_content = ""

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
                        tool_content = {
                            "id": current_tool_use.get("id", "unknown"),
                            "name": current_tool_use.get("name", "unknown"),
                            "input": tool_input,
                            "type": "tool_use",
                        }
                        tool_name = tool_content["name"]
                        tool_input = tool_content["input"]
                        status, tool_result = self.call_tool(tool_name, tool_input)
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
                        messages.append(
                            {
                                "role": "user",
                                "content": [
                                    {
                                        "type": "tool_result",
                                        "tool_use_id": tool_content["id"],
                                        "content": json.dumps(tool_result),
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
                        if (
                            tool_name == "set_theme"
                            and status == 200
                            and isinstance(tool_result, dict)
                            and tool_result.get("success")
                            and tool_result.get("theme")
                        ):
                            yield {"type": "theme", "theme": tool_result["theme"]}
                        if tool_name != "set_theme":
                            tool_combined_msg = (
                                f"\n<details>\n<summary>Tool Use: {tool_name}</summary>\n\n"
                                f"**Input**\n\n```json\n{json.dumps(tool_input, indent=2)}\n```\n\n"
                                f"**{output_label}**\n\n```json\n{json.dumps(tool_result, indent=2)}\n```\n\n"
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
