import logging

logger = logging.getLogger(__name__)

TOOL_DEF = {
    "name": "adjust_llm_settings",
    "description": "Change the model's temperature and/or max tokens for this chat. Temperature (0–2) controls randomness: lower is more focused, higher more creative. Max tokens caps response length. Use when the user asks to change creativity, verbosity, or response length.",
    "input_schema": {
        "type": "object",
        "properties": {
            "temperature": {
                "type": "number",
                "description": "Sampling temperature between 0 and 2. Lower = more deterministic, higher = more random/creative.",
            },
            "max_tokens": {
                "type": "integer",
                "description": "Maximum tokens the model can generate per reply (e.g. 2048, 8192, 131072).",
            },
        },
        "required": [],
    },
    "default_enabled": True,
}


def call_tool(tool_input: dict, context=None):
    temperature = tool_input.get("temperature")
    max_tokens = tool_input.get("max_tokens")
    if temperature is None and max_tokens is None:
        return 400, {"success": False, "error": "Provide at least one of temperature or max_tokens."}
    out = {"success": True}
    if temperature is not None:
        try:
            t = float(temperature)
        except (TypeError, ValueError):
            return 400, {"success": False, "error": "temperature must be a number between 0 and 2."}
        if not 0 <= t <= 2:
            return 400, {"success": False, "error": "temperature must be between 0 and 2."}
        out["temperature"] = t
    if max_tokens is not None:
        try:
            m = int(max_tokens)
        except (TypeError, ValueError):
            return 400, {"success": False, "error": "max_tokens must be a positive integer."}
        if m < 1 or m > 200000:
            return 400, {"success": False, "error": "max_tokens must be between 1 and 200000."}
        out["max_tokens"] = m
    parts = [f"{k}={v}" for k, v in out.items() if k not in ("success", "message") and v is not None]
    out["message"] = f"Settings updated: {', '.join(parts)}. Next messages will use these values."
    return 200, out
