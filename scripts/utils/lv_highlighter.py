import re
from .lv_constants import CLR


class Highlighter:
    DEBOUNCE_MS = 100

    COLORS = {
        "hl_comment":  "#008000",
        "hl_doctype":  "#0000ff",
        "hl_tag":      "#800000",
        "hl_attr":     "#ff0000",
        "hl_value":    "#0000ff",
        "hl_keyword":  "#0000ff",
        "hl_builtin":  "#267f99",
        "hl_number":   "#098658",
        "hl_string":   "#a31515",
        "hl_func":     "#795e26",
        "hl_css_sel":  "#800000",
        "hl_css_prop": "#ff0000",
        "hl_css_num":  "#098658",
        "hl_css_at":   "#af00db",
    }

    _PRIORITY = [
        "hl_attr", "hl_css_prop", "hl_func", "hl_builtin",
        "hl_css_sel", "hl_tag", "hl_doctype",
        "hl_keyword", "hl_number", "hl_css_num", "hl_css_at",
        "hl_string", "hl_value", "hl_comment",
    ]

    _JS_KW = frozenset((
        "var","let","const","function","return","if","else","for","while","do",
        "switch","case","break","continue","new","this","typeof","instanceof",
        "null","undefined","true","false","class","extends","import","export",
        "default","try","catch","finally","throw","async","await","of","in",
        "from","static","super","yield","delete","void","debugger",
    ))
    _JS_BUILTINS = frozenset((
        "console","document","window","Array","Object","String","Number",
        "Boolean","Math","JSON","Promise","setTimeout","setInterval",
        "clearTimeout","clearInterval","parseInt","parseFloat","isNaN",
        "isFinite","alert","confirm","prompt","addEventListener","fetch",
        "querySelector","querySelectorAll","getElementById",
        "getElementsByClassName","getElementsByTagName",
    ))

    def __init__(self, widget, tab_key: str = "MAIN") -> None:
        self.widget   = widget
        self._pending = None
        _lk = tab_key.lower()
        self._mode = 'js' if _lk.endswith('.js') else 'css' if _lk.endswith('.css') else 'html'
        self._setup_tags()

    def _setup_tags(self) -> None:
        w = self.widget
        for tag, color in self.COLORS.items():
            w.tag_config(tag, foreground=color)
        for tag in self._PRIORITY:
            w.tag_raise(tag)

    def schedule(self) -> None:
        if self._pending is not None:
            self.widget.after_cancel(self._pending)
        self._pending = self.widget.after(self.DEBOUNCE_MS, self._run)

    def invalidate_now(self) -> None:
        if self._pending is not None:
            self.widget.after_cancel(self._pending)
            self._pending = None
        self._run()

    def _run(self) -> None:
        self._pending = None
        try:
            self._do_highlight()
        except Exception:
            pass

    def _add(self, tag: str, s: int, e: int) -> None:
        if e > s:
            self.widget.tag_add(tag, f"1.0+{s}c", f"1.0+{e}c")

    def _do_highlight(self) -> None:
        w       = self.widget
        content = w.get("1.0", "end-1c")
        if not content:
            return

        for tag in self.COLORS:
            w.tag_remove(tag, "1.0", "end")

        if self._mode == 'js':
            self._hl_js(content, 0)
            return
        if self._mode == 'css':
            self._hl_css(content, 0)
            return

        style_regions  = [(m.start(1), m.end(1))
                          for m in re.finditer(r"<style\b[^>]*>(.*?)</style>",
                                               content, re.DOTALL | re.IGNORECASE)]
        script_regions = [(m.start(1), m.end(1))
                          for m in re.finditer(r"<script\b[^>]*>(.*?)</script>",
                                               content, re.DOTALL | re.IGNORECASE)]

        mask = bytearray(b"h" * len(content))
        for s, e in style_regions:
            mask[s:e] = b"c" * (e - s)
        for s, e in script_regions:
            mask[s:e] = b"j" * (e - s)

        self._hl_html(content, mask)
        for s, e in style_regions:
            self._hl_css(content[s:e], s)
        for s, e in script_regions:
            self._hl_js(content[s:e], s)

    def _hl_html(self, content: str, mask: bytearray) -> None:
        def html(s): return mask[s:s+1] == b"h"

        for m in re.finditer(r"<!--.*?-->", content, re.DOTALL):
            if html(m.start()):
                self._add("hl_comment", m.start(), m.end())

        for m in re.finditer(r"<!DOCTYPE\b[^>]*>", content, re.IGNORECASE):
            if html(m.start()):
                self._add("hl_doctype", m.start(), m.end())

        for m in re.finditer(r'=\s*"([^"]*)"', content):
            if html(m.start()):
                self._add("hl_value", m.start(1), m.end(1))
        for m in re.finditer(r"=\s*'([^']*)'", content):
            if html(m.start()):
                self._add("hl_value", m.start(1), m.end(1))

        for m in re.finditer(r"</?([a-zA-Z][a-zA-Z0-9-]*)", content):
            if html(m.start()):
                self._add("hl_tag", m.start(1), m.end(1))

        for m in re.finditer(r"\b([a-zA-Z][a-zA-Z0-9-:]*)\s*=", content):
            if html(m.start(1)):
                self._add("hl_attr", m.start(1), m.end(1))

    def _hl_css(self, css: str, off: int) -> None:
        protected: set = set()

        for m in re.finditer(r"/\*.*?\*/", css, re.DOTALL):
            self._add("hl_comment", off + m.start(), off + m.end())
            protected.update(range(m.start(), m.end()))

        for m in re.finditer(r'"[^"]*"|' + r"'[^']*'", css):
            if m.start() not in protected:
                self._add("hl_string", off + m.start(), off + m.end())
                protected.update(range(m.start(), m.end()))

        for m in re.finditer(r"@[a-zA-Z-]+", css):
            if m.start() not in protected:
                self._add("hl_css_at", off + m.start(), off + m.end())

        for m in re.finditer(r"(?:^|(?<=[}]))\s*([^{@/][^{@/]*?)(?=\s*\{)", css,
                             re.DOTALL):
            chunk = m.group(1)
            cs, ce = m.start(1), m.end(1)
            if cs not in protected and chunk.strip():
                self._add("hl_css_sel", off + cs, off + ce)

        for m in re.finditer(r"(?:^|\{|;)\s*([a-zA-Z-]+)\s*(?=:)", css,
                             re.MULTILINE | re.DOTALL):
            if m.start(1) not in protected:
                self._add("hl_css_prop", off + m.start(1), off + m.end(1))

        UNITS = r"(%|px|em|rem|vh|vw|vmin|vmax|pt|pc|cm|mm|in|ex|ch|deg|rad|turn|s|ms|fr)?"
        for m in re.finditer(r"-?\b\d+\.?\d*" + UNITS, css):
            if m.group() and m.start() not in protected:
                self._add("hl_css_num", off + m.start(), off + m.end())

    def _hl_js(self, js: str, off: int) -> None:
        protected: set = set()

        for m in re.finditer(r"/\*.*?\*/", js, re.DOTALL):
            self._add("hl_comment", off + m.start(), off + m.end())
            protected.update(range(m.start(), m.end()))
        for m in re.finditer(r"//[^\n]*", js):
            if m.start() not in protected:
                self._add("hl_comment", off + m.start(), off + m.end())
                protected.update(range(m.start(), m.end()))

        for m in re.finditer(r"`(?:[^`\\]|\\.)*`", js, re.DOTALL):
            if m.start() not in protected:
                self._add("hl_string", off + m.start(), off + m.end())
                protected.update(range(m.start(), m.end()))
        for m in re.finditer(r'"(?:[^"\\]|\\.)*"', js):
            if m.start() not in protected:
                self._add("hl_string", off + m.start(), off + m.end())
                protected.update(range(m.start(), m.end()))
        for m in re.finditer(r"'(?:[^'\\]|\\.)*'", js):
            if m.start() not in protected:
                self._add("hl_string", off + m.start(), off + m.end())
                protected.update(range(m.start(), m.end()))

        for m in re.finditer(r"\b0x[0-9a-fA-F]+|\b\d+\.?\d*([eE][+-]?\d+)?\b", js):
            if m.start() not in protected:
                self._add("hl_number", off + m.start(), off + m.end())

        for m in re.finditer(r"\b([a-zA-Z_$][a-zA-Z0-9_$]*)(?=\s*\()", js):
            if m.start() not in protected:
                self._add("hl_func", off + m.start(), off + m.end())

        builtin_re = re.compile(r"\b(" + "|".join(sorted(self._JS_BUILTINS, key=len,
                                                          reverse=True)) + r")\b")
        for m in builtin_re.finditer(js):
            if m.start() not in protected:
                self._add("hl_builtin", off + m.start(), off + m.end())

        kw_re = re.compile(r"\b(" + "|".join(sorted(self._JS_KW, key=len,
                                                     reverse=True)) + r")\b")
        for m in kw_re.finditer(js):
            if m.start() not in protected:
                self._add("hl_keyword", off + m.start(), off + m.end())
