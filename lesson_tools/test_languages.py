import unittest
from pathlib import Path

from languages import (
    all_extensions,
    extension_to_id,
    get_profile,
    should_auto_dedent_on_char,
    should_decrease_on_line,
    should_increase_after,
)
from utils.similarity_measures import _comment_ranges

_ROOT = Path(__file__).resolve().parent
_TEST = _ROOT / "test"


_EXPECTED_JS_KEYWORDS = {
    "var", "let", "const", "function", "return", "if", "else", "for", "while", "do",
    "switch", "case", "break", "continue", "new", "this", "typeof", "instanceof",
    "null", "undefined", "true", "false", "class", "extends", "import", "export",
    "default", "try", "catch", "finally", "throw", "async", "await", "of", "in",
    "from", "static", "super", "yield", "delete", "void", "debugger",
}
_EXPECTED_JS_BUILTINS = {
    "console", "document", "window", "Array", "Object", "String", "Number",
    "Boolean", "Math", "JSON", "Promise", "setTimeout", "setInterval",
    "clearTimeout", "clearInterval", "parseInt", "parseFloat", "isNaN",
    "isFinite", "alert", "confirm", "prompt", "addEventListener", "fetch",
    "querySelector", "querySelectorAll", "getElementById",
    "getElementsByClassName", "getElementsByTagName",
}


class TestLanguageProfiles(unittest.TestCase):
    def test_javascript_keywords_snapshot(self):
        self.assertEqual(set(get_profile("javascript")["keywords"]), _EXPECTED_JS_KEYWORDS)

    def test_javascript_builtins_snapshot(self):
        self.assertEqual(set(get_profile("javascript")["builtins"]), _EXPECTED_JS_BUILTINS)

    def test_extension_lookup_case_insensitive(self):
        self.assertEqual(extension_to_id(".js"), "javascript")
        self.assertEqual(extension_to_id(".JS"), "javascript")
        self.assertEqual(extension_to_id(".CSS"), "css")
        self.assertEqual(extension_to_id(".html"), "html")
        self.assertEqual(extension_to_id(".htm"), "html")
        self.assertEqual(extension_to_id(".txt"), "plaintext")
        self.assertIsNone(extension_to_id(".unknown"))
        self.assertIsNone(extension_to_id(""))

    def test_get_profile_by_id_or_extension(self):
        self.assertIs(get_profile("javascript"), get_profile(".js"))
        self.assertIs(get_profile("html"), get_profile(".html"))
        self.assertIs(get_profile("html"), get_profile(".htm"))
        self.assertIs(get_profile("css"), get_profile(".css"))

    def test_all_extensions(self):
        self.assertEqual(set(all_extensions()), {".js", ".css", ".html", ".htm", ".txt", ".py"})

    def test_html_void_tags_match_lv_constants(self):
        from utils.lv_constants import HTML_VOID_TAGS
        self.assertEqual(set(get_profile("html")["voidTags"]), HTML_VOID_TAGS)

    def test_html_embedded_tags_declared(self):
        prof = get_profile("html")
        embedded = {e["tag"]: e["language"] for e in prof["embeddedTags"]}
        self.assertEqual(embedded, {"script": "javascript", "style": "css"})

    def test_plaintext_loads_cleanly(self):
        prof = get_profile("plaintext")
        self.assertIsNotNone(prof)
        self.assertEqual(prof["id"], "plaintext")
        self.assertEqual(prof["keywords"], [])
        self.assertEqual(prof["builtins"], [])
        self.assertEqual(prof["strings"], [])
        self.assertIsNone(prof["comments"]["line"])
        self.assertIsNone(prof["comments"]["block"])

    def test_unknown_returns_none(self):
        self.assertIsNone(get_profile("ruby"))
        self.assertIsNone(get_profile(".rb"))
        self.assertIsNone(get_profile(""))


class TestIndentHelpers(unittest.TestCase):
    """Phase 4 unit tests for VS-Code-style indent rules."""

    def test_increase_after_js_brace(self):
        prof = get_profile(".js")
        self.assertTrue(should_increase_after(prof, "function foo() {"))
        self.assertTrue(should_increase_after(prof, "const a = ["))
        self.assertTrue(should_increase_after(prof, "if (x) ("))
        self.assertFalse(should_increase_after(prof, "var x = 1;"))
        self.assertFalse(should_increase_after(prof, "function foo() {}"))

    def test_increase_after_js_does_not_fire_on_html_tag(self):
        prof = get_profile(".js")
        self.assertFalse(should_increase_after(prof, "render(<div>"))

    def test_increase_after_html_brace_or_open_tag(self):
        prof = get_profile(".html")
        self.assertTrue(should_increase_after(prof, "<div>"))
        self.assertTrue(should_increase_after(prof, "  <section>"))
        self.assertTrue(should_increase_after(prof, "<style>"))
        self.assertTrue(should_increase_after(prof, "function() {"))

    def test_increase_after_html_skips_void_and_self_closing(self):
        prof = get_profile(".html")
        self.assertFalse(should_increase_after(prof, "<br>"))
        self.assertFalse(should_increase_after(prof, "<img src='x'>"))
        self.assertFalse(should_increase_after(prof, "<div/>"))

    def test_decrease_on_line_brace(self):
        for ext in (".js", ".css", ".html"):
            prof = get_profile(ext)
            self.assertTrue(should_decrease_on_line(prof, "}"), ext)
            self.assertTrue(should_decrease_on_line(prof, "])"), ext)

    def test_decrease_on_line_html_close_tag(self):
        prof = get_profile(".html")
        self.assertTrue(should_decrease_on_line(prof, "</div>"))
        prof_js = get_profile(".js")
        self.assertFalse(should_decrease_on_line(prof_js, "</div>"))

    def test_auto_dedent_on_closing_bracket(self):
        for ext in (".js", ".css", ".html"):
            prof = get_profile(ext)
            self.assertTrue(should_auto_dedent_on_char(prof, "}", "\t\t"), ext)
            self.assertTrue(should_auto_dedent_on_char(prof, ")", "    "), ext)
            self.assertFalse(should_auto_dedent_on_char(prof, "}", "  x"), ext)

    def test_auto_dedent_on_html_slash_only_for_html(self):
        prof_html = get_profile(".html")
        self.assertTrue(should_auto_dedent_on_char(prof_html, "/", "\t<"))
        prof_js = get_profile(".js")
        self.assertFalse(should_auto_dedent_on_char(prof_js, "/", "\t<"))

    def test_none_profile_returns_false(self):
        self.assertFalse(should_increase_after(None, "anything {"))
        self.assertFalse(should_decrease_on_line(None, "}"))
        self.assertFalse(should_auto_dedent_on_char(None, "/", "\t<"))

    def test_auto_dedent_closing_bracket_is_universal(self):
        self.assertTrue(should_auto_dedent_on_char(None, "}", "\t"))
        self.assertTrue(should_auto_dedent_on_char(None, ")", "  "))
        self.assertFalse(should_auto_dedent_on_char(None, "}", "x"))


class TestPythonProfile(unittest.TestCase):
    """Phase 5: Python language support."""

    def test_python_profile_loads(self):
        prof = get_profile("python")
        self.assertIsNotNone(prof)
        self.assertEqual(prof["id"], "python")
        self.assertEqual(prof["extensions"], [".py"])

    def test_python_extension_lookup(self):
        self.assertEqual(extension_to_id(".py"), "python")
        self.assertEqual(extension_to_id(".PY"), "python")
        self.assertIs(get_profile(".py"), get_profile("python"))

    def test_python_in_all_extensions(self):
        self.assertIn(".py", all_extensions())

    def test_python_keywords_include_def_class(self):
        prof = get_profile("python")
        for kw in ("def", "class", "if", "elif", "else", "for", "while", "import", "lambda"):
            self.assertIn(kw, prof["keywords"], kw)

    def test_python_builtins_include_print_len(self):
        prof = get_profile("python")
        for bi in ("print", "len", "range", "input", "type"):
            self.assertIn(bi, prof["builtins"], bi)

    def test_python_increase_after_colon(self):
        prof = get_profile(".py")
        self.assertTrue(should_increase_after(prof, "def foo():"))
        self.assertTrue(should_increase_after(prof, "class Bar:"))
        self.assertTrue(should_increase_after(prof, "if x > 0:"))
        self.assertTrue(should_increase_after(prof, "for i in range(10):"))
        self.assertTrue(should_increase_after(prof, "while True:"))
        self.assertTrue(should_increase_after(prof, "if x:  # explain"))
        self.assertFalse(should_increase_after(prof, "x = 1"))
        self.assertFalse(should_increase_after(prof, "def foo()"))

    def test_python_decrease_on_line(self):
        prof = get_profile(".py")
        self.assertTrue(should_decrease_on_line(prof, "else:"))
        self.assertTrue(should_decrease_on_line(prof, "elif x > 0:"))
        self.assertTrue(should_decrease_on_line(prof, "    except ValueError:"))
        self.assertTrue(should_decrease_on_line(prof, "  finally:"))
        self.assertFalse(should_decrease_on_line(prof, "x = 1"))
        self.assertFalse(should_decrease_on_line(prof, "elselif"))

    def test_python_decrease_after(self):
        from languages import should_decrease_after
        prof = get_profile(".py")
        self.assertTrue(should_decrease_after(prof, "    return 0"))
        self.assertTrue(should_decrease_after(prof, "  break"))
        self.assertTrue(should_decrease_after(prof, "continue"))
        self.assertTrue(should_decrease_after(prof, "    pass"))
        self.assertTrue(should_decrease_after(prof, "    raise ValueError()"))
        self.assertFalse(should_decrease_after(prof, "x = return_value"))

    def test_python_does_not_have_html_open_tag_rule(self):
        prof = get_profile(".py")
        self.assertFalse(should_increase_after(prof, "render(<div>"))

    def test_python_comment_detection(self):
        from languages import comment_ranges
        prof = get_profile(".py")
        text = "x = 1  # the answer\nprint(x)"
        starts, ends = comment_ranges(prof, text)
        self.assertEqual(len(starts), 1)
        self.assertEqual(text[starts[0]:ends[0]], "# the answer")

    def test_python_comment_detection_via_sm(self):
        from utils.similarity_measures import _comment_ranges
        text = "# top comment\nx = 1\n# bottom"
        starts, ends = _comment_ranges(text, ".py")
        self.assertEqual(len(starts), 2)
        self.assertEqual(text[starts[0]:ends[0]], "# top comment")
        self.assertEqual(text[starts[1]:ends[1]], "# bottom")


class TestPythonReconstruction(unittest.TestCase):
    """Phase 5: synthesize a Python keylog and verify reconstruction."""

    def _events(self, chars: str) -> list:
        events = [{"move_to": "main.py", "timestamp": 0}]
        ts = 0
        for c in chars:
            ts += 10
            events.append({"char": c, "timestamp": ts})
        return events

    def test_python_indent_after_colon(self):
        from utils.lv_editor import _replay_headless_multi
        events = self._events("def foo():↩return 1")
        editors = _replay_headless_multi(events)
        text = editors["main.py"].get_text()
        self.assertEqual(text, "def foo():\n\treturn 1")

    def test_python_dedent_on_else(self):
        from utils.lv_editor import _replay_headless_multi
        events = self._events("if x:↩return↩↣")
        editors = _replay_headless_multi(events)
        self.assertIn("main.py", editors)

    def test_python_hash_comment_is_not_string(self):
        from utils.lv_editor import _replay_headless_multi
        events = self._events("x = 1  # hi")
        editors = _replay_headless_multi(events)
        text = editors["main.py"].get_text()
        self.assertEqual(text, "x = 1  # hi")


class TestLessonFileLanguageDetection(unittest.TestCase):
    """Phase: language detection from lessonFile (no move_to required)."""

    def test_detect_python_from_filename(self):
        from languages import detect_language_from_lesson_file
        self.assertEqual(
            detect_language_from_lesson_file("plans/Python.json"), "python")
        self.assertEqual(
            detect_language_from_lesson_file("C:\\plans\\Python.json"), "python")
        self.assertEqual(
            detect_language_from_lesson_file("PYTHON.JSON"), "python")

    def test_detect_returns_none_for_unknown_lesson(self):
        from languages import detect_language_from_lesson_file
        self.assertIsNone(
            detect_language_from_lesson_file("plans/Emordnilap.json"))
        self.assertIsNone(detect_language_from_lesson_file(None))
        self.assertIsNone(detect_language_from_lesson_file(""))

    def test_lesson_file_extension(self):
        from languages import lesson_file_extension
        self.assertEqual(lesson_file_extension("plans/Python.json"), ".py")
        self.assertIsNone(lesson_file_extension("plans/Emordnilap.json"))
        self.assertIsNone(lesson_file_extension(None))

    def test_main_uses_python_indent_when_lesson_is_python(self):
        from utils.lv_editor import _replay_headless_multi
        chars = "def foo():↩return 1↩↩x = 2"
        events = []
        ts = 0
        for c in chars:
            ts += 10
            events.append({"char": c, "timestamp": ts})
        editors = _replay_headless_multi(
            events, lesson_file="plans/Python.json")
        text = editors["MAIN"].get_text()
        self.assertEqual(text, "def foo():\n\treturn 1\n\nx = 2")

    def test_main_falls_back_to_html_when_lesson_unknown(self):
        from utils.lv_editor import _replay_headless_multi
        chars = "<div>↩hello"
        events = []
        ts = 0
        for c in chars:
            ts += 10
            events.append({"char": c, "timestamp": ts})
        editors = _replay_headless_multi(events)
        text = editors["MAIN"].get_text()
        self.assertEqual(text, "<div>\n\thello")


if __name__ == "__main__":
    unittest.main()
