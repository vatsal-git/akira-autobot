import os
import unittest
from pathlib import Path
from unittest import mock

from backend.core.source_syntax import validate_source_syntax


class TestValidateSourceSyntaxPython(unittest.TestCase):
    def test_valid_python(self):
        self.assertIsNone(
            validate_source_syntax(Path("mod.py"), "def f():\n    return 1\n")
        )

    def test_invalid_python(self):
        err = validate_source_syntax(Path("bad.py"), "def f(:\n")
        self.assertIsNotNone(err)
        self.assertIn("Python syntax error", err)


class TestValidateSourceSyntaxCss(unittest.TestCase):
    def test_valid_css(self):
        self.assertIsNone(
            validate_source_syntax(Path("s.css"), "a { color: red; }\n")
        )

    def test_invalid_css(self):
        err = validate_source_syntax(Path("s.css"), "@@@")
        self.assertIsNotNone(err)
        self.assertIn("CSS syntax error", err)


class TestValidateSourceSyntaxHtml(unittest.TestCase):
    def test_valid_html(self):
        self.assertIsNone(
            validate_source_syntax(
                Path("p.html"),
                "<!DOCTYPE html><html><body><p>x</p></body></html>",
            )
        )

    def test_invalid_html(self):
        err = validate_source_syntax(Path("p.html"), "<<<notatag>>>")
        self.assertIsNotNone(err)
        self.assertIn("HTML parse error", err)


class TestValidateSourceSyntaxUnchecked(unittest.TestCase):
    def test_unknown_extension_skipped(self):
        self.assertIsNone(
            validate_source_syntax(Path("note.txt"), "not { valid")
        )


class TestValidateSourceSyntaxExternalMocks(unittest.TestCase):
    @mock.patch("backend.core.source_syntax.shutil.which", return_value=None)
    def test_js_skipped_when_node_missing(self, _which):
        self.assertIsNone(validate_source_syntax(Path("f.js"), "this is not valid js"))

    @mock.patch.dict(os.environ, {"AKIRA_SYNTAX_STRICT": "1"}, clear=False)
    @mock.patch("backend.core.source_syntax.shutil.which", return_value=None)
    def test_js_strict_requires_node(self, _which):
        err = validate_source_syntax(Path("f.js"), "1+1")
        self.assertIsNotNone(err)
        self.assertIn("node", err)

    @mock.patch("backend.core.source_syntax._run_subprocess")
    @mock.patch("backend.core.source_syntax.shutil.which", return_value="/bin/node")
    def test_js_reports_compiler_stderr(self, _which, mock_run):
        mock_run.return_value = (1, "SyntaxError: unexpected token")
        err = validate_source_syntax(Path("f.js"), "const x =")
        self.assertIsNotNone(err)
        self.assertIn("JavaScript syntax error", err)
        self.assertIn("unexpected token", err)

    @mock.patch("backend.core.source_syntax.shutil.which", return_value=None)
    def test_java_skipped_when_javac_missing(self, _which):
        self.assertIsNone(
            validate_source_syntax(Path("X.java"), "class X { void m() { } }")
        )

    @mock.patch.dict(os.environ, {"AKIRA_SYNTAX_STRICT": "1"}, clear=False)
    @mock.patch("backend.core.source_syntax.shutil.which", return_value=None)
    def test_java_strict_requires_javac(self, _which):
        err = validate_source_syntax(Path("X.java"), "class X {}")
        self.assertIsNotNone(err)
        self.assertIn("javac", err)

    @mock.patch("backend.core.source_syntax._run_subprocess")
    @mock.patch("backend.core.source_syntax.shutil.which", return_value="/bin/javac")
    def test_java_reports_javac_stderr(self, mock_which, mock_run):
        mock_run.return_value = (1, "error: ';' expected")
        err = validate_source_syntax(Path("X.java"), "class X { int x }")
        self.assertIsNotNone(err)
        self.assertIn("Java syntax error", err)

    @mock.patch("backend.core.source_syntax._cpp_compiler", return_value=None)
    def test_cpp_skipped_when_no_compiler(self, _cc):
        self.assertIsNone(validate_source_syntax(Path("a.cpp"), "int main() {"))

    @mock.patch.dict(os.environ, {"AKIRA_SYNTAX_STRICT": "1"}, clear=False)
    @mock.patch("backend.core.source_syntax._cpp_compiler", return_value=None)
    def test_cpp_strict_requires_compiler(self, _cc):
        err = validate_source_syntax(Path("a.cpp"), "int main() {}")
        self.assertIsNotNone(err)
        self.assertIn("clang++", err)

    @mock.patch("backend.core.source_syntax._run_subprocess")
    @mock.patch("backend.core.source_syntax._cpp_compiler", return_value="/bin/clang++")
    def test_cpp_reports_compiler_stderr(self, _cc, mock_run):
        mock_run.return_value = (1, "error: expected ';' after return")
        err = validate_source_syntax(Path("a.cpp"), "int main() { return 0 }")
        self.assertIsNotNone(err)
        self.assertIn("C++ syntax error", err)


if __name__ == "__main__":
    unittest.main()
