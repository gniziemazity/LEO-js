import json
import os
import re
from .lv_constants import HTML_VOID_TAGS


class VSCodeSettings:
    DEFAULTS: dict = {
        "editor.stickyScroll.enabled":       False,
        "editor.parameterHints.enabled":     False,
        "editor.suggestOnTriggerCharacters": False,
        "editor.wordBasedSuggestions":       "off",
        "editor.quickSuggestions":           {"other": False, "comments": False, "strings": False},
        "editor.autoClosingBrackets":        "never",
        "editor.autoClosingQuotes":          "never",
        "editor.minimap.enabled":            False,
        "html.autoClosingTags":              False,
        "html.autoCreateQuotes":             False,
    }

    BRACKET_PAIRS: dict = {"(": ")", "[": "]", "{": "}"}
    QUOTE_PAIRS:   dict = {'"': '"', "'": "'", "`": "`"}

    def __init__(self, raw: dict, source: str = "defaults") -> None:
        self.raw    = {**self.DEFAULTS, **raw}
        self.source = source

    @staticmethod
    def _parse_jsonc(text: str) -> dict:
        text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)

        result = []
        in_str = False
        escape = False
        i = 0
        while i < len(text):
            ch = text[i]
            if escape:
                result.append(ch); escape = False
            elif ch == "\\" and in_str:
                result.append(ch); escape = True
            elif ch == '"':
                in_str = not in_str; result.append(ch)
            elif not in_str and ch == "/" and i + 1 < len(text) and text[i + 1] == "/":
                while i < len(text) and text[i] != "\n":
                    i += 1
                continue
            else:
                result.append(ch)
            i += 1
        text = "".join(result)

        text = re.sub(r",\s*([}\]])", r"\1", text)
        return json.loads(text)

    @classmethod
    def load(cls, log_path: str) -> "VSCodeSettings":

        folder = os.path.dirname(os.path.abspath(log_path))
        candidate = os.path.join(folder, ".vscode", "settings.json")
        if os.path.exists(candidate):
            try:
                with open(candidate, encoding="utf-8") as f:
                    text = f.read()
                raw = cls._parse_jsonc(text)
                return cls(raw, source=candidate)
            except Exception as exc:
                return cls({}, source=f"parse error: {exc}")
        return cls({}, source="defaults")

    def summary(self) -> list[tuple[str, str, bool]]:
        r = self.raw
        def yesno(v):
            if isinstance(v, bool):
                return ("ON", v)
            if isinstance(v, str):
                on = v.lower() not in ("never", "off", "false", "0")
                return (v, on)
            return (str(v), bool(v))

        rows = []
        for key, label in [
            ("editor.autoClosingBrackets", "Auto-close brackets"),
            ("editor.autoClosingQuotes",   "Auto-close quotes"),
            ("html.autoClosingTags",       "HTML auto-close tags"),
            ("html.autoCreateQuotes",      "HTML auto-create quotes"),
            ("editor.minimap.enabled",     "Minimap"),
            ("editor.parameterHints.enabled", "Parameter hints"),
            ("editor.quickSuggestions",    "Quick suggestions"),
        ]:
            val = r.get(key)
            if isinstance(val, dict):
                active = any(v for v in val.values() if v not in (False, "off"))
                rows.append((label, "mixed", active))
            else:
                vs, active = yesno(val)
                rows.append((label, vs, active))
        return rows

    def _closing_mode(self, key: str) -> str:
        v = self.raw.get(key, "never")
        if isinstance(v, bool):
            return "always" if v else "never"
        return str(v).lower()

    def _should_close(self, mode: str, text_after: str) -> bool:
        if mode == "never":
            return False
        if mode == "always":
            return True
        if mode in ("languagedefined", "beforewhitespace"):
            return (not text_after) or text_after[0] in " \t\n\r)]}>\"'`"
        return False

    def auto_close_bracket(self, char: str, text_after: str) -> str | None:
        closing = self.BRACKET_PAIRS.get(char)
        if not closing:
            return None
        mode = self._closing_mode("editor.autoClosingBrackets")
        if text_after and text_after[0] == closing:
            return None
        return closing if self._should_close(mode, text_after) else None

    def auto_close_quote(self, char: str, text_before: str, text_after: str) -> str | None:
        if char not in self.QUOTE_PAIRS:
            return None
        closing = self.QUOTE_PAIRS[char]
        mode = self._closing_mode("editor.autoClosingQuotes")
        if text_after and text_after[0] == closing:
            return None
        count = text_before.count(char)
        if count % 2 == 1:
            return None
        return closing if self._should_close(mode, text_after) else None

    def auto_close_html_tag(self, char: str, text_before: str) -> str | None:
        if char != ">":
            return None
        if not self.raw.get("html.autoClosingTags", False):
            return None
        m = re.search(r"<([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^<>]*)?$", text_before)
        if not m:
            return None
        tag = m.group(1).lower()
        if tag in HTML_VOID_TAGS:
            return None
        if text_before.rfind("</") > text_before.rfind("<" + m.group(1)):
            return None
        return f"</{m.group(1)}>"

    def auto_create_quotes(self, char: str, text_before: str) -> str | None:
        if char != "=":
            return None
        if not self.raw.get("html.autoCreateQuotes", False):
            return None
        last_lt = text_before.rfind("<")
        last_gt = text_before.rfind(">")
        if last_lt <= last_gt:
            return None
        tag_text = text_before[last_lt:]
        if tag_text.startswith("<!") or tag_text.startswith("</"):
            return None
        return '""'
