import json
import os
import re
try:
    import tkinter as tk
    from tkinter import filedialog, ttk, font as tkfont
    _HAS_TK = True
except ImportError:
    _HAS_TK = False
    class _TkMock:
        NORMAL = DISABLED = ACTIVE = END = INSERT = W = X = Y = BOTH = \
        TOP = BOTTOM = LEFT = RIGHT = HORIZONTAL = VERTICAL = WORD = NONE = \
        FLAT = SOLID = "mock"
        def __getattr__(self, _): return type("_M", (), {"__getattr__": lambda s, n: None})()
    class _TkMockMod:
        def __getattr__(self, _): return None
    tk = _TkMock()
    filedialog = ttk = tkfont = _TkMockMod()
from datetime import datetime

try:
    from zoneinfo import ZoneInfo
    FINLAND_TZ = ZoneInfo("Europe/Helsinki")
except ImportError:
    try:
        import pytz
        FINLAND_TZ = pytz.timezone("Europe/Helsinki")
    except ImportError:
        FINLAND_TZ = None

ANCHOR_RE      = re.compile(r"⚓([^⚓]*)⚓")
MAX_REAL_DELAY = 3_000
DELAY_CODE     = 30
DELAY_OPS      = 15
PAGE_LINES     = 20

CURSOR_MOVES: dict = {
    "←": "insert-1c",   "→": "insert+1c",
    "↑": "insert-1l",   "↓": "insert+1l",
    "◄": "insert linestart", "►": "insert lineend",
    "▲": f"insert-{PAGE_LINES}l", "▼": f"insert+{PAGE_LINES}l",
}

SHIFT_CURSOR_MOVES: dict = {
    "⇑": "insert-1l",   "⇓": "insert+1l",
    "⇐": "insert linestart", "⇒": "insert lineend",
}

CHAR_REPLACEMENTS: dict = {"↩": "\n", "\n": "\n", "―": "\t", "\t": "\t"}

DELETE_LINE_CHAR   = "⛔"
BACKSPACE_CHARS    = frozenset({"↢", "⌫"})
DELETE_FWRD_CHARS  = frozenset({"↣", "⌦"})

IGNORED_CHARS: frozenset = frozenset(
    ["💾", "🔁", "Ö", "ö", "Ș", "ñ", "ω", "Ț", "é", "🅴"]
)

PAUSE_CHAR = "🕛"
PAUSE_MS   = 500

HTML_VOID_TAGS = frozenset({
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
})

CLR = {
    "bg":        "#ffffff",  "sidebar":   "#f3f3f3",
    "toolbar":   "#e8e8e8",  "fg":        "#1e1e1e",
    "cursor":    "#000000",  "select":    "#add6ff",
    "blue":      "#0000ff",  "purple":    "#af00db",
    "orange":    "#795e26",  "yellow":    "#795e26",
    "move":      "#e07020",
    "green":     "#267f99",  "red":       "#d40000",
    "pink":      "#d40000",  "comment":   "#008000",
    "accent":    "#007acc",  "dim":       "#717171",
    "muted":     "#999999",  "devbg":     "#f5f5f5",
    "devborder": "#007acc",  "settingsbg":"#f0f0f8",
}


def fmt_ts(ts_ms: int) -> str:
    try:
        dt = datetime.fromtimestamp(ts_ms / 1000, tz=FINLAND_TZ)
        return dt.strftime("%d.%m.%Y  %H:%M:%S") + f".{dt.microsecond // 1000:03d}"
    except Exception:
        return str(ts_ms)


def split_code_with_anchors(code: str) -> list:
    result = []
    last = 0
    for m in ANCHOR_RE.finditer(code):
        if m.start() > last:
            result.append(("text", code[last: m.start()]))
        result.append(("anchor", f"⚓{m.group(1)}⚓"))
        last = m.end()
    if last < len(code):
        result.append(("text", code[last:]))
    return result