import math
import os
import json
import logging
import asyncio
import threading
import time
import requests
from abc import ABC, abstractmethod
from typing import List, Dict, Any, AsyncIterator, Iterator, Optional
import dotenv

dotenv.load_dotenv()

# OpenRouter models API: fetch and rank for optional tooling (scripts / diagnostics)
OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"
OPENROUTER_FALLBACK_MODEL_IDS = [
    "google/gemini-2.5-flash-lite",
    "qwen/qwen3.5-flash-02-23",
]


def _openrouter_cost_per_million(model: dict) -> float:
    pricing = model.get("pricing") or {}
    try:
        p = float(pricing.get("prompt", 0) or 0)
    except (TypeError, ValueError):
        p = 0.0
    try:
        c = float(pricing.get("completion", 0) or 0)
    except (TypeError, ValueError):
        c = 0.0
    return (p + c) * 1_000_000


def _openrouter_score_model(model: dict) -> float:
    """Higher = better (context, completion, params, cost value)."""
    ctx = model.get("context_length") or 0
    ctx_score = math.log10(max(ctx, 256) + 1) / math.log10(1_000_000 + 1)
    top = model.get("top_provider") or {}
    max_comp = top.get("max_completion_tokens") or 4096
    comp_score = math.log10(max(max_comp, 256) + 1) / math.log10(65536 + 1)
    params = model.get("supported_parameters") or []
    param_score = min(len(params) / 10.0, 1.0)
    cost = _openrouter_cost_per_million(model)
    cost_score = 1.0 if cost <= 0 else max(0, 1.0 - math.log10(cost + 0.0001) / 4.0)
    arch = model.get("architecture") or {}
    modality = (arch.get("modality") or "").lower()
    modality_score = 1.0 if ("text" in modality or not modality) else 0.5
    return (
        ctx_score * 0.35
        + comp_score * 0.25
        + cost_score * 0.25
        + param_score * 0.10
        + modality_score * 0.05
    )


def _openrouter_model_expired(m: dict) -> bool:
    exp = m.get("expiration_date")
    if exp is None:
        return False
    now = int(time.time())
    if isinstance(exp, (int, float)):
        return exp < now
    if isinstance(exp, str):
        try:
            from datetime import datetime
            dt = datetime.fromisoformat(exp.replace("Z", "+00:00"))
            return dt.timestamp() < now
        except Exception:
            return False
    return False


def fetch_openrouter_ranked_model_ids(api_key: str | None) -> List[str]:
    """
    GET OpenRouter /models, filter valid, score and sort best-to-worst.
    Returns list of model ids. On failure or empty, returns OPENROUTER_FALLBACK_MODEL_IDS.
    """
    if not (api_key or "").strip():
        return OPENROUTER_FALLBACK_MODEL_IDS.copy()
    try:
        r = requests.get(
            OPENROUTER_MODELS_URL,
            headers={"Authorization": f"Bearer {api_key.strip()}"},
            timeout=15,
        )
        r.raise_for_status()
        data = r.json()
        models = data.get("data") or []
    except Exception:
        return OPENROUTER_FALLBACK_MODEL_IDS.copy()
    valid = [
        m for m in models
        if m.get("id") and not _openrouter_model_expired(m)
    ]
    if not valid:
        return OPENROUTER_FALLBACK_MODEL_IDS.copy()
    scored = [(_openrouter_score_model(m), m.get("id")) for m in valid]
    scored.sort(key=lambda x: -x[0])
    return [mid for _, mid in scored]


class BaseLLMProvider(ABC):
    """Abstract base class for LLM providers"""

    def __init__(self):
        self.logger = logging.getLogger(self.__class__.__name__)

    @abstractmethod
    def invoke_streaming(
        self,
        messages: List[Dict[str, Any]],
        tools: List[Dict[str, Any]],
        max_tokens: int,
        temperature: float,
        system_prompt: str = None,
        thinking_enabled: bool = False,
        thinking_budget: int = 1024,
        model_override: str = None,
    ):
        """Invoke the LLM with the given messages and parameters (sync). model_override: optional model alias."""
        pass

    @abstractmethod
    async def invoke_streaming_async(
        self,
        messages: List[Dict[str, Any]],
        tools: List[Dict[str, Any]],
        max_tokens: int,
        temperature: float,
        system_prompt: str = None,
        thinking_enabled: bool = False,
        thinking_budget: int = 1024,
        stream_read_timeout: float = 120.0,
        model_override: str = None,
    ) -> AsyncIterator[Dict[str, Any]]:
        """Invoke the LLM with the given messages and parameters (async stream). model_override: optional alias."""
        pass

    def get_model_id(self) -> str:
        """Return the model identifier used for the last completion (for display in UI)."""
        return getattr(self, "model", None) or "unknown"

    def get_context_window_tokens(self) -> int:
        """Total context window (input + output) for proactive trimming. Override or set LLM_CONTEXT_WINDOW."""
        try:
            return int(os.getenv("LLM_CONTEXT_WINDOW", "200000"))
        except (TypeError, ValueError):
            return 200000

    def get_max_output_cap_tokens(self) -> int | None:
        """If set, output max_tokens is capped to this value. None = no extra cap."""
        return None


def _content_to_openai_chat(content) -> Any:
    """Convert a single message content to OpenAI chat format (string or list of parts)."""
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return str(content)
    parts = []
    for block in content:
        if not isinstance(block, dict):
            continue
        kind = block.get("type")
        if kind == "text":
            parts.append({"type": "text", "text": block.get("text", "")})
        elif kind == "image" and "source" in block:
            src = block["source"]
            if src.get("type") == "base64":
                media = src.get("media_type", "image/png")
                b64 = src.get("data", "")
                parts.append(
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{media};base64,{b64}"},
                    }
                )
    if len(parts) == 1 and parts[0].get("type") == "text":
        return parts[0]["text"]
    if len(parts) == 0:
        return ""
    return parts


def messages_to_openai_chat(
    messages: List[Dict], system_prompt: str = None
) -> List[Dict]:
    """Convert Anthropic-style messages + system_prompt to OpenAI chat format."""
    out = []
    if system_prompt and system_prompt.strip():
        out.append({"role": "system", "content": system_prompt.strip()})
    i = 0
    while i < len(messages):
        msg = messages[i]
        role = (msg.get("role") or "").lower()
        content = msg.get("content")
        if role == "user":
            if isinstance(content, list):
                tool_result_blocks = [
                    b
                    for b in content
                    if isinstance(b, dict) and b.get("type") == "tool_result"
                ]
                user_content = _content_to_openai_chat(content)
                if user_content != "":
                    out.append({"role": "user", "content": user_content})
                for block in tool_result_blocks:
                    out.append(
                        {
                            "role": "tool",
                            "tool_call_id": block.get("tool_use_id", ""),
                            "content": block.get("content", ""),
                        }
                    )
                i += 1
                continue
            out.append({"role": "user", "content": _content_to_openai_chat(content)})
            i += 1
        elif role == "assistant":
            if isinstance(content, list):
                text_parts = []
                tool_calls = []
                for block in content:
                    if not isinstance(block, dict):
                        continue
                    if block.get("type") == "text":
                        text_parts.append(block.get("text", ""))
                    elif block.get("type") == "tool_use":
                        tool_calls.append(
                            {
                                "id": block.get("id", ""),
                                "type": "function",
                                "function": {
                                    "name": block.get("name", ""),
                                    "arguments": json.dumps(block.get("input", {})),
                                },
                            }
                        )
                text_content = "".join(text_parts) if text_parts else ""
                if tool_calls:
                    out.append(
                        {
                            "role": "assistant",
                            "content": text_content or None,
                            "tool_calls": tool_calls,
                        }
                    )
                else:
                    out.append({"role": "assistant", "content": text_content or ""})
            else:
                out.append(
                    {"role": "assistant", "content": _content_to_openai_chat(content)}
                )
            i += 1
        else:
            out.append({"role": role, "content": _content_to_openai_chat(content)})
            i += 1
    return out


def tools_to_openai_chat(tools: List[Dict]) -> List[Dict]:
    """Convert provider-agnostic tools (name, description, input_schema) to OpenAI format."""
    if not tools:
        return []
    return [
        {
            "type": "function",
            "function": {
                "name": t.get("name", ""),
                "description": t.get("description", ""),
                "parameters": t.get(
                    "input_schema", {"type": "object", "properties": {}}
                ),
            },
        }
        for t in tools
    ]


def _chunk_to_dict(chunk: Any) -> Dict[str, Any]:
    if chunk is None:
        return {}
    if isinstance(chunk, dict):
        return chunk
    if hasattr(chunk, "model_dump"):
        try:
            return chunk.model_dump()
        except Exception:
            pass
    if hasattr(chunk, "json"):
        try:
            return json.loads(chunk.json())
        except Exception:
            pass
    return {}


def _openrouter_extra_headers() -> Dict[str, str]:
    headers: Dict[str, str] = {}
    ref = os.getenv("OPENROUTER_HTTP_REFERER") or os.getenv("HTTP_REFERER")
    if ref:
        headers["HTTP-Referer"] = ref
    title = os.getenv("OPENROUTER_X_TITLE") or os.getenv("X_OPENROUTER_TITLE")
    if title:
        headers["X-OpenRouter-Title"] = title
    categories = os.getenv("OPENROUTER_CATEGORIES") or os.getenv("X_OPENROUTER_CATEGORIES")
    if categories:
        headers["X-OpenRouter-Categories"] = categories
    return headers


def _retryable_litellm_error(exc: BaseException) -> bool:
    try:
        from litellm.exceptions import RateLimitError, APIError
        if isinstance(exc, RateLimitError):
            return True
        if isinstance(exc, APIError):
            code = getattr(exc, "status_code", None)
            if code in (402, 429):
                return True
    except ImportError:
        pass
    code = getattr(exc, "status_code", None)
    if code in (402, 429):
        return True
    msg = str(exc).lower()
    if "429" in msg or "402" in msg or "rate limit" in msg or "payment" in msg:
        return True
    return False


def _yield_normalized_stream_chunks(
    stream: Iterator[Any],
    tools: List[Dict[str, Any]],
    logger: logging.Logger,
) -> Iterator[Dict[str, Any]]:
    """Map OpenAI-compatible streaming chunks to Akira Anthropic-style chunks."""
    tool_calls_acc: Dict[int, Dict[str, str]] = {}
    thinking_started = False
    thinking_signature: Optional[str] = None
    allow_content_emission = True

    for raw in stream:
        obj = _chunk_to_dict(raw)
        if obj.get("error"):
            err = obj["error"]
            msg = err.get("message", "LLM error") if isinstance(err, dict) else str(err)
            code = err.get("code", "?") if isinstance(err, dict) else "?"
            logger.error("Stream error object: %s (code=%s)", msg, code)
            raise RuntimeError(msg)

        choices = obj.get("choices") or []
        if not choices:
            continue
        delta = choices[0].get("delta") or {}
        reasoning_details = delta.get("reasoning_details") or []
        reasoning_text = delta.get("reasoning")
        has_reasoning = bool(
            reasoning_details or (reasoning_text is not None and reasoning_text != "")
        )
        if has_reasoning:
            allow_content_emission = False
            if not thinking_started:
                sig = "litellm"
                for detail in reasoning_details:
                    if isinstance(detail, dict) and detail.get("id"):
                        sig = detail.get("id", sig)
                        break
                thinking_signature = sig
                yield {
                    "type": "content_block_start",
                    "content_block": {"type": "thinking", "signature": thinking_signature},
                }
                thinking_started = True
            emitted_reasoning = False
            for detail in reasoning_details:
                if isinstance(detail, dict) and detail.get("type") == "reasoning.text":
                    text = detail.get("text") or ""
                    if text:
                        yield {
                            "type": "content_block_delta",
                            "delta": {"type": "thinking_delta", "thinking": text},
                        }
                        emitted_reasoning = True
            if not emitted_reasoning and reasoning_text is not None and reasoning_text != "":
                yield {
                    "type": "content_block_delta",
                    "delta": {"type": "thinking_delta", "thinking": reasoning_text},
                }
        else:
            allow_content_emission = True

        content = delta.get("content")
        if content is not None and content != "" and allow_content_emission:
            yield {
                "type": "content_block_delta",
                "delta": {"type": "text_delta", "text": content},
            }

        for tc in delta.get("tool_calls") or []:
            idx = tc.get("index")
            if idx is not None:
                if idx not in tool_calls_acc:
                    tool_calls_acc[idx] = {"id": "", "name": "", "arguments": ""}
                acc = tool_calls_acc[idx]
                if tc.get("id"):
                    acc["id"] = tc["id"]
                fn = tc.get("function") or {}
                if fn.get("name"):
                    acc["name"] = fn["name"]
                if fn.get("arguments") is not None:
                    acc["arguments"] += fn["arguments"]
            else:
                args = (tc.get("function") or {}).get("arguments")
                if args is not None and tool_calls_acc:
                    first_idx = min(tool_calls_acc)
                    tool_calls_acc[first_idx]["arguments"] += args

        finish_reason = choices[0].get("finish_reason")
        if finish_reason == "tool_calls" and tool_calls_acc:
            full_message = choices[0].get("message") or {}
            for i, ftc in enumerate(full_message.get("tool_calls") or []):
                if i not in tool_calls_acc:
                    tool_calls_acc[i] = {"id": "", "name": "", "arguments": ""}
                acc_i = tool_calls_acc[i]
                if ftc.get("id"):
                    acc_i["id"] = ftc["id"]
                fn = ftc.get("function") or {}
                if fn.get("name"):
                    acc_i["name"] = fn["name"]
                if fn.get("arguments"):
                    acc_i["arguments"] = fn["arguments"]
            idx = min(tool_calls_acc)
            acc = tool_calls_acc[idx]
            tool_name = (acc["name"] or "").strip()
            if not tool_name and tools and 0 <= idx < len(tools):
                tool_name = (tools[idx].get("name") or "").strip()
            if not tool_name:
                tool_name = "unknown"
            try:
                tool_input = json.loads(acc["arguments"]) if (acc["arguments"] or "").strip() else {}
            except json.JSONDecodeError:
                tool_input = {}
            yield {
                "type": "content_block_start",
                "content_block": {
                    "type": "tool_use",
                    "id": acc["id"] or f"call_{idx}",
                    "name": tool_name,
                    "input": tool_input,
                },
            }
            yield {
                "type": "content_block_delta",
                "delta": {"type": "input_json_delta", "partial_json": acc["arguments"]},
            }
            yield {
                "type": "message_delta",
                "delta": {"stop_reason": "tool_use"},
            }
            return


class LiteLLMProvider(BaseLLMProvider):
    """Unified provider via LiteLLM Router; model names are YAML aliases (no separate provider enum)."""

    def __init__(self, default_model_alias: Optional[str] = None):
        super().__init__()
        from litellm import Router
        from backend.config.litellm_loader import load_litellm_config

        self.logger.info("Initializing LiteLLM provider (Router)")
        model_list, settings = load_litellm_config()
        if not model_list:
            raise ValueError(
                "litellm_config.yaml has no valid model_list entries. "
                "Set OPENROUTER_API_KEY and/or CLAUDE_INFERENCE_PROFILE + AWS_REGION."
            )
        self.router = Router(model_list=model_list)
        self._model_list = model_list
        self._settings = settings
        self.supports_agi_task_routing = bool(settings.get("agi_task_routing", False))
        dm = (default_model_alias or os.getenv("DEFAULT_MODEL") or settings.get("default_model") or "").strip()
        aliases = {e.get("model_name") for e in model_list if e.get("model_name")}
        if dm not in aliases:
            dm = settings.get("default_model")
        if dm not in aliases:
            dm = next(iter(aliases))
        self.default_alias = dm
        fo = settings.get("fallback_order") or list(aliases)
        self._fallback_order = [a for a in fo if a in aliases]
        if self.default_alias not in self._fallback_order:
            self._fallback_order = [self.default_alias] + [
                a for a in self._fallback_order if a != self.default_alias
            ]
        self._current_index = 0
        self._model_lock = threading.Lock()
        self.model = self.default_alias
        _cap = os.getenv("OPENROUTER_MAX_OUTPUT_TOKENS", "32768")
        try:
            self._max_output_tokens = int(_cap)
        except (TypeError, ValueError):
            self._max_output_tokens = 32768
        self._max_output_tokens = max(1, min(self._max_output_tokens, 65536))

    def get_context_window_tokens(self) -> int:
        try:
            return int(os.getenv("OPENROUTER_CONTEXT_WINDOW", os.getenv("LLM_CONTEXT_WINDOW", "131072")))
        except (TypeError, ValueError):
            return 131072

    def get_max_output_cap_tokens(self) -> int:
        return self._max_output_tokens

    def _get_active_alias(self) -> str:
        with self._model_lock:
            if self._current_index >= len(self._fallback_order):
                return self._fallback_order[-1]
            return self._fallback_order[self._current_index]

    def _advance_fallback(self) -> bool:
        with self._model_lock:
            self._current_index += 1
            return self._current_index < len(self._fallback_order)

    def _reset_fallback(self) -> None:
        with self._model_lock:
            self._current_index = 0

    def get_model_id(self) -> str:
        return self._get_active_alias()

    def _resolve_alias(self, model_override: Optional[str]) -> str:
        if model_override and model_override.strip():
            alias = model_override.strip()
            names = {e.get("model_name") for e in self._model_list if e.get("model_name")}
            if alias in names:
                return alias
            self.logger.warning("Unknown model alias %r, using %s", alias, self.default_alias)
        return self._get_active_alias()

    def _alias_for_litellm(self, alias: str) -> str:
        """Router.completion expects model_list model_name."""
        return alias

    def _resolved_litellm_route(self, alias: str) -> str:
        """Underlying LiteLLM model string for an alias (e.g. openrouter/..., bedrock/...)."""
        for e in self._model_list:
            if e.get("model_name") == alias:
                return ((e.get("litellm_params") or {}).get("model") or "").strip()
        return ""

    def invoke_streaming(
        self,
        messages,
        tools,
        max_tokens,
        temperature,
        system_prompt=None,
        thinking_enabled=False,
        thinking_budget=1024,
        model_override=None,
    ):
        or_messages = messages_to_openai_chat(messages, system_prompt)
        or_tools = tools_to_openai_chat(tools)
        capped = min(int(max_tokens), self._max_output_tokens)
        if thinking_enabled and capped <= thinking_budget:
            capped = min(thinking_budget + 4000, self._max_output_tokens)

        use_override = bool(model_override and model_override.strip())

        while True:
            alias = self._resolve_alias(model_override) if use_override else self._get_active_alias()
            self.model = alias
            route = self._resolved_litellm_route(alias)
            # OpenRouter-only: extra_body.reasoning is rejected by Bedrock ("extra_body: Extra inputs are not permitted").
            extra_body = None
            if thinking_enabled and route.startswith("openrouter/"):
                extra_body = {
                    "reasoning": {
                        "max_tokens": max(1024, min(thinking_budget, 128000)),
                        "exclude": False,
                    }
                }
            extra_headers = (
                _openrouter_extra_headers() if route.startswith("openrouter/") else {}
            )
            eff_temp = float(temperature)
            kwargs: Dict[str, Any] = {
                "model": self._alias_for_litellm(alias),
                "messages": or_messages,
                "max_tokens": capped,
                "temperature": eff_temp,
                "stream": True,
            }
            if or_tools:
                kwargs["tools"] = or_tools
                kwargs["tool_choice"] = "auto"
            if thinking_enabled and route.startswith("bedrock/"):
                kwargs["thinking"] = {
                    "type": "enabled",
                    "budget_tokens": max(1024, min(int(thinking_budget), 128000)),
                }
                kwargs["temperature"] = 1.0
            if extra_headers:
                kwargs["extra_headers"] = extra_headers
            if extra_body:
                kwargs["extra_body"] = extra_body

            try:
                response = self.router.completion(**kwargs)
            except BaseException as e:
                if _retryable_litellm_error(e) and not use_override:
                    if self._advance_fallback():
                        self.logger.warning(
                            "LiteLLM retryable error, switching to fallback alias: %s",
                            self._get_active_alias(),
                        )
                        continue
                raise

            try:
                for chunk in _yield_normalized_stream_chunks(
                    response, tools, self.logger
                ):
                    yield chunk
            except BaseException as e:
                if _retryable_litellm_error(e) and not use_override:
                    if self._advance_fallback():
                        self.logger.warning(
                            "LiteLLM stream error, retrying fallback: %s",
                            self._get_active_alias(),
                        )
                        continue
                raise

            if not use_override:
                self._reset_fallback()
            break

    async def invoke_streaming_async(
        self,
        messages,
        tools,
        max_tokens,
        temperature,
        system_prompt=None,
        thinking_enabled=False,
        thinking_budget=1024,
        stream_read_timeout=120.0,
        model_override=None,
    ) -> AsyncIterator[Dict[str, Any]]:
        queue: asyncio.Queue = asyncio.Queue()
        done = asyncio.Event()

        def run_sync():
            try:
                for chunk in self.invoke_streaming(
                    messages=messages,
                    tools=tools,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    system_prompt=system_prompt,
                    thinking_enabled=thinking_enabled,
                    thinking_budget=thinking_budget,
                    model_override=model_override,
                ):
                    queue.put_nowait(("chunk", chunk))
            except Exception as e:
                queue.put_nowait(("error", e))
            finally:
                queue.put_nowait(("done", None))
                done.set()

        loop = asyncio.get_event_loop()
        task = loop.run_in_executor(None, run_sync)
        try:
            while True:
                try:
                    kind, payload = await asyncio.wait_for(
                        queue.get(), timeout=stream_read_timeout
                    )
                except asyncio.TimeoutError:
                    self.logger.warning("Stream read timeout")
                    raise TimeoutError(
                        f"Stream read timeout ({stream_read_timeout}s) exceeded"
                    ) from None
                if kind == "chunk":
                    yield payload
                elif kind == "error":
                    raise payload
                elif kind == "done":
                    break
        finally:
            await done.wait()
            await task


# Backward-compatible names for tests / scripts
_messages_to_openrouter = messages_to_openai_chat
_tools_to_openrouter = tools_to_openai_chat
