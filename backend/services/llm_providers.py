import os
import json
import logging
import asyncio
import boto3
from abc import ABC, abstractmethod
from typing import List, Dict, Any, AsyncIterator
import dotenv

# import urllib3
import ssl

# from requests.adapters import HTTPAdapter
# from urllib3.util.ssl_ import create_urllib3_context

# urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
dotenv.load_dotenv()


# class SSLAdapter(HTTPAdapter):
#     """An HTTP Adapter that strictly disables SSL verification."""

#     def init_poolmanager(self, connections, maxsize, block=False, **pool_kwargs):
#         ctx = create_urllib3_context()
#         ctx.check_hostname = False
#         ctx.verify_mode = ssl.CERT_NONE
#         self.poolmanager = urllib3.PoolManager(
#             num_pools=connections,
#             maxsize=maxsize,
#             block=block,
#             ssl_context=ctx,
#             **pool_kwargs,
#         )


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


class AnthropicProvider(BaseLLMProvider):
    """Provider for Anthropic Claude models via AWS Bedrock"""

    def __init__(self):
        super().__init__()
        self.logger.info("Initializing Anthropic provider")
        self.bedrock_client = self._get_bedrock_client()

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
