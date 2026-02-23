# Akira tools

Every `.py` file in this folder (except `__init__.py` and `_*.py`) is loaded as a tool. Add a new file here and call the **reload_tools** tool (or restart the server) to use it.

## Adding a new tool

1. Create a new file, e.g. `my_tool.py`, in this directory.
2. Define two things:

**TOOL_DEF** — same shape as the API expects:

```python
TOOL_DEF = {
    "name": "my_tool",
    "description": "What this tool does (the model reads this).",
    "input_schema": {
        "type": "object",
        "properties": {
            "arg_name": {"type": "string", "description": "Description."},
        },
        "required": ["arg_name"],
    },
    "default_enabled": True,
}
```

**call_tool** — function that runs the tool:

```python
def call_tool(tool_input: dict, context=None):
    # tool_input has the arguments from the model
    # context is the LLM_Service instance (or None); use it for get_system_prompt, etc.
    result = do_something(tool_input.get("arg_name"))
    return 200, result  # (status_code, result). Use 4xx/5xx for errors.
}
```

3. Call the **reload_tools** tool so Akira picks up the new tool, or restart the backend.

Files whose names start with `_` are ignored. Each file must expose exactly one tool (one `TOOL_DEF`, one `call_tool`).
