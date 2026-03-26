"""Limits for tool results serialized into LLM requests (Bedrock / context size safety)."""

MAX_TOOL_RESULT_JSON_CHARS = 100_000
MAX_SINGLE_STRING_IN_TOOL = 48_000
