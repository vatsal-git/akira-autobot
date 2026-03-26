"""Syntax-only validation for Python source (no import, no execution)."""
from pathlib import Path
from typing import Optional


def is_python_source_file(path: Path) -> bool:
    return path.suffix.lower() == ".py"


def validate_python_syntax(source: str, filename: str) -> Optional[str]:
    """
    Return None if source parses as a module body, else a short error message.
    `filename` is only used in SyntaxError messages (use the real path when possible).
    """
    try:
        compile(source, filename, "exec", dont_inherit=True, optimize=0)
    except SyntaxError as e:
        line = e.lineno or "?"
        col = e.offset or ""
        col_part = f", column {col}" if col else ""
        snippet = (e.text or "").strip()
        tail = f' — near "{snippet}"' if snippet else ""
        return f"Python syntax error at line {line}{col_part}: {e.msg}{tail}"
    except Exception as e:
        return f"Could not compile Python source: {e}"
    return None
