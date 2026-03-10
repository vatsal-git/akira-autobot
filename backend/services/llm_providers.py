import math
import os
import json
import logging
import asyncio
import threading
import time
import boto3
import requests
from abc import ABC, abstractmethod
from typing import List, Dict, Any, AsyncIterator
import dotenv

# import urllib3
import ssl

dotenv.load_dotenv()

# OpenRouter models API: fetch and rank for default/fallback list
OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"
# Minimal fallback when API is unavailable (e.g. no key, network error)
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
    ):
        """Invoke the LLM with the given messages and parameters (sync)."""
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
    ) -> AsyncIterator[Dict[str, Any]]:
        """Invoke the LLM with the given messages and parameters (async stream)."""
        pass

    def get_model_id(self) -> str:
        """Return the model identifier used for the last completion (for display in UI)."""
        return getattr(self, "model", None) or "unknown"


class AnthropicProvider(BaseLLMProvider):
    """Provider for Anthropic Claude models via AWS Bedrock"""

    def __init__(self):
        super().__init__()
        self.logger.info("Initializing Anthropic provider")
        self.bedrock_client = self._get_bedrock_client()

    def get_model_id(self) -> str:
        return os.getenv("CLAUDE_INFERENCE_PROFILE", "anthropic")

    def _get_bedrock_client(self):
        self.logger.debug("Creating Bedrock client")
        return boto3.client(
            service_name="bedrock-runtime",
            aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
            region_name=os.getenv("AWS_REGION"),
            endpoint_url=os.getenv("BEDROCK_ENDPOINT"),
        )

    def invoke_streaming(
        self,
        messages,
        tools,
        max_tokens,
        temperature,
        system_prompt=None,
        thinking_enabled=False,
        thinking_budget=1024,
    ):
        """Stream responses from the Anthropic Claude model"""
        self.logger.info(
            f"Invoking Claude with {len(messages)} messages, {len(tools)} tools"
        )
        self.logger.debug(f"Max tokens: {max_tokens}, Temperature: {temperature}")

        request_body = {
            "anthropic_version": os.getenv("ANTHROPIC_VERSION", "bedrock-2023-05-31"),
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }

        if tools:
            request_body["tools"] = tools

        if system_prompt:
            request_body["system"] = system_prompt

        if thinking_enabled:
            # Force temperature to 1.0 for thinking models as required by Anthropic
            request_body["temperature"] = 1.0
            request_body["thinking"] = {
                "type": "enabled",
                "budget_tokens": thinking_budget,
            }

            # Ensure max_tokens is higher than budget
            if max_tokens <= thinking_budget:
                request_body["max_tokens"] = thinking_budget + 4000
                self.logger.warning(
                    f"Adjusting max_tokens to {request_body['max_tokens']} to accommodate thinking budget"
                )

        try:
            self.logger.debug("Sending request to Bedrock")
            response = self.bedrock_client.invoke_model_with_response_stream(
                modelId=os.getenv("CLAUDE_INFERENCE_PROFILE"),
                body=json.dumps(request_body),
            )

            # Process the streaming response
            for event in response.get("body"):
                if "chunk" in event:
                    chunk_data = json.loads(event["chunk"]["bytes"].decode())
                    yield chunk_data

        except Exception as e:
            self.logger.error(f"Error invoking Anthropic model: {e}", exc_info=True)
            raise

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
    ) -> AsyncIterator[Dict[str, Any]]:
        """Stream responses from the Anthropic Claude model (async, non-blocking)."""
        self.logger.info(
            f"Invoking Claude (async) with {len(messages)} messages, {len(tools)} tools"
        )
        queue: asyncio.Queue = asyncio.Queue()
        done = asyncio.Event()

        def run_sync_stream():
            try:
                for chunk in self.invoke_streaming(
                    messages=messages,
                    tools=tools,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    system_prompt=system_prompt,
                    thinking_enabled=thinking_enabled,
                    thinking_budget=thinking_budget,
                ):
                    queue.put_nowait(("chunk", chunk))
            except Exception as e:
                queue.put_nowait(("error", e))
            finally:
                queue.put_nowait(("done", None))
                done.set()

        loop = asyncio.get_event_loop()
        task = loop.run_in_executor(None, run_sync_stream)

        try:
            while True:
                try:
                    kind, payload = await asyncio.wait_for(
                        queue.get(), timeout=stream_read_timeout
                    )
                except asyncio.TimeoutError:
                    self.logger.warning("Stream read timeout reached")
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


def _content_to_openrouter(content) -> Any:
    """Convert a single message content to OpenRouter/OpenAI format (string or list of parts)."""
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
        # Skip thinking, tool_use, tool_result here; handled in message conversion
    if len(parts) == 1 and parts[0].get("type") == "text":
        return parts[0]["text"]
    if len(parts) == 0:
        return ""
    return parts


def _messages_to_openrouter(
    messages: List[Dict], system_prompt: str = None
) -> List[Dict]:
    """Convert Anthropic-style messages + system_prompt to OpenRouter/OpenAI format."""
    out = []
    if system_prompt and system_prompt.strip():
        out.append({"role": "system", "content": system_prompt.strip()})
    i = 0
    while i < len(messages):
        msg = messages[i]
        role = (msg.get("role") or "").lower()
        content = msg.get("content")
        if role == "user":
            # User message: content can be list with text/image + optional tool_result blocks
            if isinstance(content, list):
                tool_result_blocks = [
                    b
                    for b in content
                    if isinstance(b, dict) and b.get("type") == "tool_result"
                ]
                # User-visible content (text, images); must not be dropped
                user_content = _content_to_openrouter(content)
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
            out.append({"role": "user", "content": _content_to_openrouter(content)})
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
                    {"role": "assistant", "content": _content_to_openrouter(content)}
                )
            i += 1
        else:
            out.append({"role": role, "content": _content_to_openrouter(content)})
            i += 1
    return out


def _tools_to_openrouter(tools: List[Dict]) -> List[Dict]:
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


# OpenRouter API: openapi.yaml
# - POST /chat/completions (request: ChatGenerationParams, model = ModelName)
# - 402: PaymentRequiredResponse (insufficient credits)
# - 429: TooManyRequestsResponse (rate limit exceeded)


def _parse_openrouter_error(r) -> tuple:
    """Parse OpenRouter error response. Returns (message, hint) where hint is optional user guidance."""
    try:
        err_body = r.json()
    except Exception:
        err_body = {}
    raw = r.text or r.reason or "Unknown error"
    # OpenRouter/OpenAI-style: { "error": { "message": "...", "code": ... } } or { "message": "..." }
    err = err_body.get("error") if isinstance(err_body.get("error"), dict) else {}
    msg = (
        err.get("message")
        or err_body.get("message")
        or err_body.get("detail")
        or (err_body.get("error") if isinstance(err_body.get("error"), str) else None)
        or raw
    )
    hint = ""
    if r.status_code == 429:
        hint = " Try again in a minute, use another model, or check openrouter.ai for rate limits and credits."
    elif r.status_code == 402:
        hint = " Add credits at openrouter.ai."
    return (msg, hint)


class OpenRouterProvider(BaseLLMProvider):
    """Provider for OpenRouter API with ranked fallback: on 429/402 switch to next model; on success try top again."""

    def __init__(self):
        super().__init__()
        self.logger.info("Initializing OpenRouter provider")
        self.api_key = os.getenv("OPENROUTER_API_KEY")
        if not self.api_key:
            self.logger.warning(
                "OPENROUTER_API_KEY not set; requests will fail until it is set"
            )
        # openapi.yaml: servers[0].url + /chat/completions
        self.base_url = "https://openrouter.ai/api/v1/chat/completions"
        ranked_ids = fetch_openrouter_ranked_model_ids(self.api_key)
        preferred = os.getenv("OPENROUTER_MODEL", "").strip() or (ranked_ids[0] if ranked_ids else "google/gemini-2.5-flash-lite")
        # Ordered list: preferred first, then rest of ranked (no duplicates)
        self._ordered_models = [preferred] + [
            m for m in ranked_ids if m != preferred
        ]
        self._current_index = 0
        self._model_lock = threading.Lock()
        self.model = preferred  # for display / backward compatibility
        # Many OpenRouter models have 65k context; requesting 131k output causes 400. Cap output tokens.
        _cap = os.getenv("OPENROUTER_MAX_OUTPUT_TOKENS", "32768")
        try:
            self._max_output_tokens = int(_cap)
        except (TypeError, ValueError):
            self._max_output_tokens = 32768
        self._max_output_tokens = max(1, min(self._max_output_tokens, 65536))

    def _get_current_model(self) -> str:
        with self._model_lock:
            return self._ordered_models[self._current_index]

    def _advance_to_next_model(self) -> bool:
        """On rate limit / payment: switch to next in list. Returns True if there is a next model."""
        with self._model_lock:
            self._current_index += 1
            return self._current_index < len(self._ordered_models)

    def _reset_to_top(self) -> None:
        """On success: prefer top-ranked model again for next request."""
        with self._model_lock:
            self._current_index = 0

    def get_model_id(self) -> str:
        return self._get_current_model()

    def _headers(self):
        """Headers per OpenRouter API spec: Bearer auth + optional HTTP-Referer, X-OpenRouter-Title, X-OpenRouter-Categories."""
        headers = {
            "Authorization": f"Bearer {self.api_key or ''}",
            "Content-Type": "application/json",
        }
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

    def invoke_streaming(
        self,
        messages,
        tools,
        max_tokens,
        temperature,
        system_prompt=None,
        thinking_enabled=False,
        thinking_budget=1024,
    ):
        """Stream responses from OpenRouter; yield Anthropic-style chunks for llm_service.
        On 429/402 (openapi: TooManyRequestsResponse, PaymentRequiredResponse) switch to next ranked model and retry.
        On success, reset to top-ranked so next request tries the best model again.
        """
        self.logger.info(
            "Invoking OpenRouter with %s messages, %s tools",
            len(messages),
            len(tools),
        )
        or_messages = _messages_to_openrouter(messages, system_prompt)
        or_tools = _tools_to_openrouter(tools)
        # Cap output tokens so (input + output) fits model context (e.g. 65k). Prevents 400 from OpenRouter.
        capped = min(int(max_tokens), self._max_output_tokens)
        if capped != max_tokens:
            self.logger.debug(
                "Capping max_tokens %s -> %s for OpenRouter context limit",
                max_tokens,
                capped,
            )
        # When thinking is enabled, ensure max_tokens > thinking_budget (required by OpenRouter/Anthropic).
        if thinking_enabled and capped <= thinking_budget:
            capped = min(thinking_budget + 4000, self._max_output_tokens)
            self.logger.debug(
                "Adjusting max_tokens for thinking budget: %s",
                capped,
            )
        # openapi: ChatGenerationParams — model (ModelName), messages, stream, max_tokens, temperature, tools, tool_choice
        if not self.api_key or not str(self.api_key).strip():
            raise ValueError(
                "OPENROUTER_API_KEY is not set. Set it in .env or environment to use OpenRouter."
            )

        while True:
            model = self._get_current_model()
            payload = {
                "model": model,
                "messages": or_messages,
                "max_tokens": capped,
                "max_completion_tokens": capped,
                "temperature": float(temperature),
                "stream": True,
            }
            if thinking_enabled:
                # OpenRouter unified reasoning parameter (Anthropic/Gemini use max_tokens).
                payload["reasoning"] = {
                    "max_tokens": max(1024, min(thinking_budget, 128000)),
                    "exclude": False,
                }
            if or_tools:
                payload["tools"] = or_tools
                payload["tool_choice"] = "auto"

            try:
                with requests.post(
                    self.base_url,
                    headers=self._headers(),
                    json=payload,
                    stream=True,
                    timeout=120,
                ) as r:
                    if not r.ok:
                        # Consume body so connection can be reused
                        _ = r.content
                        msg, hint = _parse_openrouter_error(r)
                        # openapi: 429 TooManyRequestsResponse, 402 PaymentRequiredResponse
                        if r.status_code in (429, 402):
                            if not self._advance_to_next_model():
                                self.logger.error("OpenRouter %s: no more fallback models. %s", r.status_code, msg)
                                raise RuntimeError(
                                    f"OpenRouter API error ({r.status_code}): {msg}. All fallback models exhausted."
                                    + (f" {hint}" if hint else "")
                                )
                            next_model = self._get_current_model()
                            self.logger.warning(
                                "OpenRouter %s (rate limit/credits), switching to next model: %s",
                                r.status_code,
                                next_model,
                            )
                            continue
                        self.logger.error("OpenRouter HTTP %s: %s", r.status_code, msg)
                        raise RuntimeError(f"OpenRouter API error ({r.status_code}): {msg}" + (f" {hint}" if hint else ""))

                    tool_calls_acc = {}  # index -> {id, name, arguments}
                    thinking_started = False
                    thinking_signature = None
                    # Force UTF-8 so emoji and other Unicode from the model decode correctly
                    r.encoding = "utf-8"
                    for line in r.iter_lines(decode_unicode=True):
                        if line is None:
                            continue
                        line = line.strip()
                        if not line.startswith("data: "):
                            continue
                        data = line[6:].strip()
                        if data == "[DONE]":
                            break
                        try:
                            obj = json.loads(data)
                        except json.JSONDecodeError:
                            continue
                        if obj.get("error"):
                            err = obj["error"]
                            msg = err.get("message", "OpenRouter error")
                            code = err.get("code", "?")
                            self.logger.error("OpenRouter stream error: %s (code=%s)", msg, code)
                            raise RuntimeError(msg)
                        choices = obj.get("choices") or []
                        if not choices:
                            continue
                        delta = choices[0].get("delta") or {}
                        # OpenRouter reasoning: delta.reasoning_details (array) or delta.reasoning (string)
                        reasoning_details = delta.get("reasoning_details") or []
                        reasoning_text = delta.get("reasoning")
                        if reasoning_details or (reasoning_text is not None and reasoning_text != ""):
                            if not thinking_started:
                                # Use first reasoning_detail id as signature, or placeholder
                                sig = "openrouter"
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
                            # Emit reasoning text from reasoning_details (reasoning.text items) or delta.reasoning
                            for detail in reasoning_details:
                                if isinstance(detail, dict) and detail.get("type") == "reasoning.text":
                                    text = detail.get("text") or ""
                                    if text:
                                        yield {
                                            "type": "content_block_delta",
                                            "delta": {"type": "thinking_delta", "thinking": text},
                                        }
                            if reasoning_text is not None and reasoning_text != "":
                                yield {
                                    "type": "content_block_delta",
                                    "delta": {"type": "thinking_delta", "thinking": reasoning_text},
                                }
                        # Text delta (content can be null in stream)
                        content = delta.get("content")
                        if content is not None and content != "":
                            yield {
                                "type": "content_block_delta",
                                "delta": {"type": "text_delta", "text": content},
                            }
                        # Accumulate tool_calls (OpenAI/OpenRouter: index, id, function.name, function.arguments)
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
                                # Some providers send continuation chunks without index; append to first acc
                                args = (tc.get("function") or {}).get("arguments")
                                if args is not None and tool_calls_acc:
                                    first_idx = min(tool_calls_acc)
                                    tool_calls_acc[first_idx]["arguments"] += args
                        finish_reason = choices[0].get("finish_reason")
                        if finish_reason == "tool_calls" and tool_calls_acc:
                            # Fallback: final chunk may include full message.tool_calls (OpenAI-style)
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
                            # If the model didn't send a tool name in the stream, infer from tools by index
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
                            self._reset_to_top()
                            return
                    self._reset_to_top()
                    break
            except requests.RequestException as e:
                self.logger.error("OpenRouter request error: %s", e, exc_info=True)
                raise

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
    ) -> AsyncIterator[Dict[str, Any]]:
        """Stream OpenRouter (async via executor)."""
        queue = asyncio.Queue()
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
