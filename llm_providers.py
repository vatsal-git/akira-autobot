import os
import json
import logging
import requests
import boto3
from abc import ABC, abstractmethod
from typing import List, Dict, Any
import dotenv
import urllib3
import ssl
from requests.adapters import HTTPAdapter
from urllib3.util.ssl_ import create_urllib3_context

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
dotenv.load_dotenv()


class SSLAdapter(HTTPAdapter):
    """An HTTP Adapter that strictly disables SSL verification."""

    def init_poolmanager(self, connections, maxsize, block=False, **pool_kwargs):
        ctx = create_urllib3_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        self.poolmanager = urllib3.PoolManager(
            num_pools=connections,
            maxsize=maxsize,
            block=block,
            ssl_context=ctx,
            **pool_kwargs,
        )


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
    ):
        """Invoke the LLM with the given messages and parameters"""
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
        self, messages, tools, max_tokens, temperature, system_prompt=None
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
            raise Exception(f"Error invoking Anthropic model streaming: {e}")


class OpenAIProvider(BaseLLMProvider):
    """Provider for OpenAI models"""

    def __init__(self):
        super().__init__()
        self.logger.info("Initializing OpenAI provider")
        self.api_key = os.getenv("OPENAI_API_KEY")
        self.model = "gpt-4o"  # Using a current model
        self.api_url = "https://api.openai.com/v1/chat/completions"

    def invoke_streaming(
        self,
        messages: List[Dict[str, Any]],
        tools: List[Dict[str, Any]],
        max_tokens: int,
        temperature: float,
    ):
        """Stream responses from the OpenAI model"""
        self.logger.info(f"Invoking OpenAI with {len(messages)} messages")
        self.logger.debug(
            f"Model: {self.model}, Max tokens: {max_tokens}, Temperature: {temperature}"
        )

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        payload = {
            "model": self.model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": True,
        }

        if tools and self._model_supports_tools():
            payload["tools"] = tools

        try:
            self.logger.debug(
                "Sending request to OpenAI API with detailed SSL disabled"
            )

            session = requests.Session()
            # Mount the custom adapter that forces NO SSL verification at the context level
            adapter = SSLAdapter()
            session.mount("https://", adapter)
            session.verify = False

            response = session.post(
                self.api_url, headers=headers, json=payload, stream=True
            )

            response.raise_for_status()

            for line in response.iter_lines():
                if line:
                    # Remove the "data: " prefix and parse the JSON
                    if line.startswith(b"data: "):
                        json_str = line[6:].decode("utf-8")
                        if json_str.strip() == "[DONE]":
                            break

                        try:
                            chunk = json.loads(json_str)
                            # Convert OpenAI format to our standard format
                            yield self._convert_openai_chunk_to_standard_format(chunk)
                        except json.JSONDecodeError:
                            self.logger.warning(f"Failed to parse JSON: {json_str}")
                            continue

        except Exception as e:
            self.logger.error(f"Error invoking OpenAI model: {e}", exc_info=True)
            raise Exception(f"Error invoking OpenAI model streaming: {e}")

    def _convert_openai_chunk_to_standard_format(self, chunk):
        """Convert OpenAI streaming format to our standard format"""
        result = {"content": []}

        if "choices" in chunk and len(chunk["choices"]) > 0:
            choice = chunk["choices"][0]

            if "delta" in choice:
                delta = choice["delta"]

                # Handle content
                if "content" in delta and delta["content"]:
                    result["content"].append({"type": "text", "text": delta["content"]})

                # Handle tool calls
                if "tool_calls" in delta:
                    for tool_call in delta["tool_calls"]:
                        if "function" in tool_call:
                            # For function name and id
                            if "name" in tool_call["function"] or "id" in tool_call:
                                tool_data = {
                                    "type": "tool_use",
                                    "id": tool_call.get("id", ""),
                                    "name": tool_call["function"].get("name", ""),
                                }
                                # Add arguments if present
                                if "arguments" in tool_call["function"]:
                                    try:
                                        tool_data["input"] = json.loads(
                                            tool_call["function"]["arguments"]
                                        )
                                    except:
                                        tool_data["input"] = tool_call["function"][
                                            "arguments"
                                        ]

                                result["content"].append(tool_data)

                # Handle finish reason / stop reason
                if "finish_reason" in choice and choice["finish_reason"]:
                    result["stop_reason"] = choice["finish_reason"]
                    if choice["finish_reason"] == "tool_calls":
                        result["stop_reason"] = "tool_use"

        return result

    def _model_supports_tools(self):
        # Check if the model supports tools/functions
        # Currently most local models don't have native tool support
        # This could be expanded based on model capabilities
        return True
