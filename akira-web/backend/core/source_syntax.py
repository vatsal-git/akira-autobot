"""
Syntax-only validation before write_file / patch_file (no execution).
Python and CSS run in-process; JS / Java / C++ use external CLIs when available.
HTML uses lxml (best-effort; very malformed markup may still parse).
"""
from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, Optional

from backend.core.python_syntax import validate_python_syntax

logger = logging.getLogger(__name__)

SUBPROCESS_TIMEOUT_SEC = 15
MAX_DIAG_CHARS = 2000

_JS_EXTS = frozenset({".js", ".mjs", ".cjs"})
_HTML_EXTS = frozenset({".html", ".htm"})
_CSS_EXTS = frozenset({".css"})
_JAVA_EXTS = frozenset({".java"})
_CPP_EXTS = frozenset({".cpp", ".cc", ".cxx", ".hpp", ".h"})

_CHECKED = _JS_EXTS | _HTML_EXTS | _CSS_EXTS | _JAVA_EXTS | _CPP_EXTS | frozenset({".py"})


def _syntax_strict() -> bool:
    v = (os.environ.get("AKIRA_SYNTAX_STRICT") or "").strip().lower()
    return v in ("1", "true", "yes", "on")


def _truncate(msg: str, limit: int = MAX_DIAG_CHARS) -> str:
    if len(msg) <= limit:
        return msg
    return msg[: limit - 1] + "…"


def is_syntax_checked_file(path: Path) -> bool:
    return path.suffix.lower() in _CHECKED


def _missing_tool_error(language: str, executable: str) -> str:
    return (
        f"{language} syntax check requires `{executable}` on PATH "
        f"(set AKIRA_SYNTAX_STRICT=0 to skip when missing, or install the tool)."
    )


@contextmanager
def _temp_source_file(suffix: str, source: str) -> Iterator[Path]:
    fd, raw = tempfile.mkstemp(suffix=suffix)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as fh:
            fh.write(source)
        yield Path(raw)
    finally:
        try:
            os.unlink(raw)
        except OSError:
            pass


def _run_subprocess(
    cmd: list[str],
    *,
    timeout: int = SUBPROCESS_TIMEOUT_SEC,
) -> tuple[Optional[int], str]:
    """
    Run cmd; return (returncode, combined_stderr_stdout).
    returncode None means the executable was not found (FileNotFoundError).
    """
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            encoding="utf-8",
            errors="replace",
        )
    except FileNotFoundError:
        return None, ""
    except subprocess.TimeoutExpired:
        return -1, f"Syntax check timed out after {timeout}s"
    except OSError as e:
        return -1, str(e)
    out = (proc.stderr or "").strip()
    if proc.stdout:
        out = (out + "\n" + proc.stdout.strip()).strip() if out else proc.stdout.strip()
    return proc.returncode, out


def _validate_js(source: str, filename: str, suffix: str = ".js") -> Optional[str]:
    node = shutil.which("node")
    if not node:
        if _syntax_strict():
            return _missing_tool_error("JavaScript", "node")
        logger.debug("Skipping JavaScript syntax check: node not on PATH (%s)", filename)
        return None
    tmp_suffix = suffix if suffix in _JS_EXTS else ".js"
    with _temp_source_file(tmp_suffix, source) as tmp:
        code, out = _run_subprocess([node, "--check", str(tmp)])
    if code is None:
        if _syntax_strict():
            return _missing_tool_error("JavaScript", "node")
        return None
    if code != 0 and code != -1:
        detail = _truncate(out or "invalid JavaScript")
        return f"JavaScript syntax error: {detail}"
    if code == -1:
        return _truncate(out)
    return None


def _validate_html(source: str, filename: str) -> Optional[str]:
    try:
        from lxml import etree, html
    except ImportError:
        if _syntax_strict():
            return "HTML syntax check requires the `lxml` package."
        logger.debug("Skipping HTML syntax check: lxml not installed (%s)", filename)
        return None

    parser = etree.HTMLParser(recover=False)
    try:
        html.document_fromstring(source.encode("utf-8"), parser=parser)
    except (etree.ParserError, etree.XMLSyntaxError) as e:
        return _truncate(f"HTML parse error: {e}")
    except Exception as e:
        return _truncate(f"HTML parse error: {e}")
    if parser.error_log:
        first = parser.error_log[0]
        msg = getattr(first, "message", str(first))
        line = getattr(first, "line", "?")
        return _truncate(f"HTML parse error: {msg} (line {line})")
    return None


def _validate_css(source: str, filename: str) -> Optional[str]:
    try:
        import tinycss2
        from tinycss2.ast import (
            AtRule,
            CurlyBracketsBlock,
            FunctionBlock,
            ParenthesesBlock,
            ParseError,
            QualifiedRule,
            SquareBracketsBlock,
        )
    except ImportError:
        if _syntax_strict():
            return "CSS syntax check requires the `tinycss2` package."
        logger.debug("Skipping CSS syntax check: tinycss2 not installed (%s)", filename)
        return None

    sheet = tinycss2.parse_stylesheet(
        source, skip_whitespace=True, skip_comments=True
    )
    stack: list = list(sheet)
    while stack:
        node = stack.pop()
        if isinstance(node, ParseError):
            line = getattr(node, "source_line", "?")
            col = getattr(node, "source_column", "?")
            msg = getattr(node, "message", str(node))
            return _truncate(f"CSS syntax error (line {line}, column {col}): {msg}")
        if isinstance(node, QualifiedRule):
            stack.extend(reversed(node.content))
            stack.extend(reversed(node.prelude))
        elif isinstance(node, AtRule):
            if node.content is not None:
                if isinstance(node.content, list):
                    stack.extend(reversed(node.content))
                else:
                    stack.append(node.content)
            stack.extend(reversed(node.prelude))
        elif isinstance(node, FunctionBlock):
            stack.extend(reversed(node.arguments))
        elif isinstance(node, (CurlyBracketsBlock, ParenthesesBlock, SquareBracketsBlock)):
            stack.extend(reversed(node.value))
        elif isinstance(node, (list, tuple)):
            stack.extend(reversed(node))
    return None


def _validate_java(source: str, filename: str) -> Optional[str]:
    javac = shutil.which("javac")
    if not javac:
        if _syntax_strict():
            return _missing_tool_error("Java", "javac")
        logger.debug("Skipping Java syntax check: javac not on PATH (%s)", filename)
        return None
    with tempfile.TemporaryDirectory() as outdir:
        with _temp_source_file(".java", source) as src:
            cmd = [
                javac,
                "-proc:none",
                "-Xlint:none",
                "-implicit:none",
                "-d",
                outdir,
                str(src),
            ]
            code, out = _run_subprocess(cmd)
    if code is None:
        if _syntax_strict():
            return _missing_tool_error("Java", "javac")
        return None
    if code != 0 and code != -1:
        detail = _truncate(out or "compilation failed")
        return f"Java syntax error: {detail}"
    if code == -1:
        return _truncate(out)
    return None


def _cpp_compiler() -> Optional[str]:
    return shutil.which("clang++") or shutil.which("g++")


def _validate_cpp(source: str, path: Path) -> Optional[str]:
    compiler = _cpp_compiler()
    if not compiler:
        if _syntax_strict():
            return _missing_tool_error("C++", "clang++ or g++")
        logger.debug("Skipping C++ syntax check: no clang++/g++ on PATH (%s)", path)
        return None
    suffix = path.suffix.lower() or ".cpp"
    if suffix not in _CPP_EXTS:
        suffix = ".cpp"
    lang_flag: list[str] = []
    if suffix == ".h":
        lang_flag = ["-x", "c++-header"]
    elif suffix == ".hpp":
        lang_flag = ["-x", "c++-header"]
    with _temp_source_file(suffix, source) as tmp:
        cmd = [compiler, "-fsyntax-only", *lang_flag, str(tmp)]
        code, out = _run_subprocess(cmd)
    if code is None:
        if _syntax_strict():
            return _missing_tool_error("C++", "clang++ or g++")
        return None
    if code != 0 and code != -1:
        detail = _truncate(out or "compilation failed")
        return f"C++ syntax error: {detail}"
    if code == -1:
        return _truncate(out)
    return None


def validate_source_syntax(path: Path, source: str) -> Optional[str]:
    """
    Return None if the path is not checked, validation is skipped (missing tool,
    non-strict), or syntax is OK. Otherwise return a short error message.
    """
    ext = path.suffix.lower()
    if ext == ".py":
        return validate_python_syntax(source, str(path))
    if ext in _JS_EXTS:
        return _validate_js(source, str(path), ext)
    if ext in _HTML_EXTS:
        return _validate_html(source, str(path))
    if ext in _CSS_EXTS:
        return _validate_css(source, str(path))
    if ext in _JAVA_EXTS:
        return _validate_java(source, str(path))
    if ext in _CPP_EXTS:
        return _validate_cpp(source, path)
    return None
