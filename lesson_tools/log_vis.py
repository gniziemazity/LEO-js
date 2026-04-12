import json
import os
import re
import time
from datetime import datetime
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

from utils.lv_constants import (
    FINLAND_TZ, ANCHOR_RE, DELAY_OPS,
    CURSOR_MOVES, SHIFT_CURSOR_MOVES, CHAR_REPLACEMENTS,
    DELETE_LINE_CHAR, BACKSPACE_CHARS, DELETE_FWRD_CHARS, IGNORED_CHARS,
    PAUSE_CHAR, PAUSE_MS, HTML_VOID_TAGS, CLR,
    fmt_ts,
)
from utils.lv_vscode import VSCodeSettings
from utils.lv_highlighter import Highlighter
from utils.lv_editor import HeadlessEditor, reconstruct_html_headless, find_ignored_backspace_timestamps
from utils.lv_expand import expand_events


def text_flat_index(widget, index: str) -> int:
    result = widget.count("1.0", index, "chars")
    return int(result[0]) if result else 0


class LogVisualizer:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("📋 Log Visualizer")
        self.root.geometry("1280x820")
        self.root.configure(bg=CLR["toolbar"])
        self.root.withdraw()

        self.vscode    = VSCodeSettings({})
        self.micro:    list = []
        self.micro_idx:int  = 0
        self.playing:  bool = False
        self.after_id       = None

        self.char_ts:  list = []
        self.dev_ts:   list = []
        self.highlighter     = None
        self._silent         = False
        self._log_buf:   list = []
        self._full_log:  list = []
        self._log_micro: list = []
        self._log_chars: list = []
        self._log_built: bool = False
        self._ci_base_indent = ""
        self._seek_canvas      = None
        self._seeking          = False
        self._seek_fraction    = 0.0
        self._seek_was_playing = False

        self._step_start_wall: float = 0.0
        self._step_dur_s:      float = 0.001
        self._seekbar_after_id        = None

        self._drag_frac:       float  = 0.0
        self._drag_seek_id             = None
        self._sel_anchor       = None
        self.auto_scroll_var   = tk.BooleanVar(value=True)
        self._micro_ts: list   = []

        self._file_tabs:   dict = {}
        self._active_file: str  = "MAIN"
        self._tab_buttons: dict = {}
        self._txt_wrap          = None
        self._mono_font         = None
        self._tab_bar           = None

        self._build_ui()
        self.root.after(50, self._startup_open)


    def _startup_open(self) -> None:
        path = filedialog.askopenfilename(
            title="Open Key-Press Log",
            filetypes=[("JSON log files", "*.json"), ("All files", "*.*")],
        )
        if not path:
            self.root.destroy()
            return
        self.root.deiconify()
        try:
            self.root.state('zoomed')
        except tk.TclError:
            try:
                self.root.attributes('-zoomed', True)
            except Exception:
                pass
        self._load_file(path)


    def _build_ui(self) -> None:
        self._build_toolbar()
        self._build_progress()
        self._build_main()
        self._build_statusbar()
        self._build_tooltip()
        self._setup_text_tags()

    def _build_toolbar(self) -> None:
        bar = tk.Frame(self.root, bg=CLR["toolbar"], pady=7)
        bar.pack(fill=tk.X, side=tk.TOP)

        def mkbtn(parent, text, cmd, bg, state=tk.NORMAL, width=None):
            kw = dict(width=width) if width else {}
            b = tk.Button(
                parent, text=text, command=cmd,
                bg=bg, fg="#ffffff",
                activebackground="#cccccc", activeforeground="#ffffff",
                relief=tk.FLAT, padx=11, pady=5, bd=0, cursor="hand2",
                font=("Segoe UI", 9), **kw,
            )
            b.config(state=state)
            return b

        self.btn_play = mkbtn(bar, "▶   Play", self.toggle_play, "#2d8f2d",
                               state=tk.DISABLED, width=10)
        self.btn_play.pack(side=tk.LEFT, padx=(10, 4))

        self.btn_reset = mkbtn(bar, "⏮  Reset", self.reset_playback, "#7a6500",
                                state=tk.DISABLED)
        self.btn_reset.pack(side=tk.LEFT, padx=4)

        tk.Frame(bar, bg="#bbbbbb", width=1).pack(side=tk.LEFT, fill=tk.Y, pady=2, padx=8)

        self.btn_settings = tk.Button(
            bar, text="⚙ VS Code: defaults",
            command=self._show_settings_popup,
            bg=CLR["settingsbg"], fg=CLR["blue"],
            activebackground="#2a2a4e", activeforeground=CLR["blue"],
            relief=tk.FLAT, padx=9, pady=5, bd=0, cursor="hand2",
            font=("Segoe UI", 9),
        )
        self.btn_settings.pack(side=tk.LEFT, padx=4)

        tk.Frame(bar, bg="#bbbbbb", width=1).pack(side=tk.LEFT, fill=tk.Y, pady=2, padx=8)

        tk.Label(bar, text="Speed:", bg=CLR["toolbar"], fg="#aaaaaa",
                 font=("Segoe UI", 9)).pack(side=tk.LEFT)

        self.speed_var = tk.DoubleVar(value=8.0)
        sl = ttk.Scale(bar, from_=1, to=60, variable=self.speed_var,
                       orient=tk.HORIZONTAL, length=180)
        sl.pack(side=tk.LEFT, padx=6)

        self.lbl_speed = tk.Label(bar, text="8×", bg=CLR["toolbar"],
                                   fg=CLR["blue"], font=("Segoe UI", 9, "bold"), width=5)
        self.lbl_speed.pack(side=tk.LEFT)
        self.speed_var.trace_add("write", self._on_speed_changed)

        tk.Frame(bar, bg="#bbbbbb", width=1).pack(side=tk.LEFT, fill=tk.Y, pady=2, padx=8)

        self.chk_autoscroll = tk.Checkbutton(
            bar, text="Auto-scroll", variable=self.auto_scroll_var,
            bg=CLR["toolbar"], fg="#aaaaaa", selectcolor=CLR["toolbar"],
            activebackground=CLR["toolbar"], activeforeground="#ffffff",
            font=("Segoe UI", 9), bd=0, cursor="hand2",
        )
        self.chk_autoscroll.pack(side=tk.LEFT, padx=4)

        self.lbl_ts = tk.Label(bar, text="", bg=CLR["toolbar"],
                                fg=CLR["blue"], font=("Consolas", 9))
        self.lbl_ts.pack(side=tk.RIGHT, padx=12)

        self.lbl_progress = tk.Label(bar, text="No file loaded",
                                      bg=CLR["toolbar"], fg=CLR["muted"],
                                      font=("Segoe UI", 9))
        self.lbl_progress.pack(side=tk.RIGHT, padx=12)

    def _build_progress(self) -> None:
        self._seek_canvas = tk.Canvas(
            self.root, height=14, bg=CLR["sidebar"],
            highlightthickness=0, cursor="hand2"
        )
        self._seek_canvas.pack(fill=tk.X, side=tk.TOP)
        self._seek_canvas.bind("<Button-1>",        self._on_seek_press)
        self._seek_canvas.bind("<B1-Motion>",       self._on_seek_drag)
        self._seek_canvas.bind("<ButtonRelease-1>", self._on_seek_release)
        self.progress = self._seek_canvas

    def _build_main(self) -> None:
        paned = tk.PanedWindow(
            self.root, orient=tk.HORIZONTAL,
            bg=CLR["toolbar"], sashwidth=5, sashrelief=tk.FLAT,
        )
        paned.pack(fill=tk.BOTH, expand=True, side=tk.TOP)

        self.editor_frame = tk.Frame(paned, bg=CLR["bg"])
        paned.add(self.editor_frame, minsize=650, stretch="always")

        self._tab_bar = tk.Frame(self.editor_frame, bg=CLR["toolbar"])
        self._tab_bar.pack(fill=tk.X)

        txt_wrap = tk.Frame(self.editor_frame, bg=CLR["bg"])
        txt_wrap.pack(fill=tk.BOTH, expand=True)
        self._txt_wrap = txt_wrap

        self._mono_font = tkfont.Font(family="Consolas", size=11)
        self.vscroll = ttk.Scrollbar(txt_wrap, orient=tk.VERTICAL)
        self.hscroll = ttk.Scrollbar(txt_wrap, orient=tk.HORIZONTAL)
        self.vscroll.pack(side=tk.RIGHT, fill=tk.Y)
        self.hscroll.pack(side=tk.BOTTOM, fill=tk.X)

        self.text, self.highlighter = self._create_file_tab("MAIN")
        self.char_ts = self._file_tabs["MAIN"]["char_ts"]
        self._update_tab_bar()

        dev_outer = tk.Frame(self.editor_frame, bg=CLR["devborder"], bd=0)
        dev_outer.place(relx=1.0, rely=1.0, relwidth=0.52, relheight=0.40,
                        anchor="se", x=-18, y=-22)
        self._dev_outer       = dev_outer
        self._dev_expanded    = True

        dev_title = tk.Frame(dev_outer, bg="#ddeeff")
        dev_title.pack(fill=tk.X, side=tk.TOP)
        tk.Label(
            dev_title, text="  DevTools",
            bg="#ddeeff", fg=CLR["devborder"],
            anchor=tk.W, font=("Consolas", 8, "bold"), pady=3,
        ).pack(side=tk.LEFT)
        self.dev_indicator = tk.Label(
            dev_title, text="●", bg="#ddeeff", fg=CLR["dim"],
            font=("Segoe UI", 8),
        )
        self.dev_indicator.pack(side=tk.RIGHT, padx=6)
        self._dev_toggle_btn = tk.Button(
            dev_title, text="−",
            command=self._toggle_dev_panel,
            bg="#ddeeff", fg=CLR["devborder"],
            activebackground="#c8e0ff", activeforeground=CLR["devborder"],
            relief=tk.FLAT, padx=6, pady=1, bd=0, cursor="hand2",
            font=("Consolas", 9, "bold"),
        )
        self._dev_toggle_btn.pack(side=tk.RIGHT, padx=2)

        dev_inner = tk.Frame(dev_outer, bg=CLR["devbg"], padx=1, pady=1)
        dev_inner.pack(fill=tk.BOTH, expand=True)

        dev_vscroll = ttk.Scrollbar(dev_inner, orient=tk.VERTICAL)
        dev_mono = tkfont.Font(family="Consolas", size=9)
        self.dev_text = tk.Text(
            dev_inner,
            bg=CLR["devbg"], fg="#009900",
            insertbackground=CLR["devborder"],
            font=dev_mono, wrap=tk.NONE, undo=False,
            selectbackground="#b3d9ff",
            yscrollcommand=dev_vscroll.set,
            padx=6, pady=3,
        )
        dev_vscroll.config(command=self.dev_text.yview)
        dev_vscroll.pack(side=tk.RIGHT, fill=tk.Y)
        self.dev_text.pack(fill=tk.BOTH, expand=True)
        self.dev_text.bind("<Motion>", lambda e: self._on_hover(e, self.dev_text, self.dev_ts))
        self.dev_text.bind("<Leave>",  lambda _e: self.tip.withdraw())

        right = tk.Frame(paned, bg=CLR["sidebar"])
        paned.add(right, minsize=300, stretch="never")

        tk.Label(
            right, text="  Event Log",
            bg=CLR["sidebar"], fg=CLR["fg"],
            anchor=tk.W, font=("Segoe UI", 9, "bold"), pady=4,
        ).pack(fill=tk.X)

        log_wrap = tk.Frame(right, bg=CLR["sidebar"])
        log_wrap.pack(fill=tk.BOTH, expand=True)

        log_scroll = ttk.Scrollbar(log_wrap)
        self.event_log = tk.Text(
            log_wrap, bg=CLR["sidebar"], fg=CLR["blue"],
            font=("Consolas", 8), wrap=tk.WORD,
            state=tk.NORMAL, width=40,
            yscrollcommand=log_scroll.set,
            padx=4, pady=2,
        )
        self.event_log.bind("<Key>", lambda e: (
            None if (e.keysym in ("Left","Right","Up","Down","Home","End",
                                  "Prior","Next","c","a") and
                     (e.state & 0x4 or e.keysym in ("Left","Right","Up","Down",
                                                     "Home","End","Prior","Next")))
            else "break"
        ))
        log_scroll.config(command=self.event_log.yview)
        log_scroll.pack(side=tk.RIGHT, fill=tk.Y)
        self.event_log.pack(fill=tk.BOTH, expand=True)

    def _create_file_tab(self, tab_key: str) -> tuple:
        mono = self._mono_font
        char_ts: list = []
        w = tk.Text(
            self._txt_wrap,
            bg=CLR["bg"], fg=CLR["fg"],
            insertbackground=CLR["cursor"],
            font=mono, wrap=tk.NONE, undo=False,
            selectbackground=CLR["select"],
            spacing1=2, spacing3=2, padx=6, pady=4,
            tabs=mono.measure("    "),
        )
        w.tag_config("anchor_flash")
        w.tag_config("auto_insert", foreground="#007acc")
        w.bind("<Button-1>",        lambda e: "break")
        w.bind("<B1-Motion>",       lambda e: "break")
        w.bind("<Double-Button-1>", lambda e: "break")
        w.bind("<Triple-Button-1>", lambda e: "break")
        w.bind("<Control-a>",       self._select_all_code)
        w.bind("<Motion>", lambda e, _w=w, _ts=char_ts: self._on_hover(e, _w, _ts))
        w.bind("<Leave>",  lambda _e: self.tip.withdraw())
        hl = Highlighter(w, tab_key)
        self._file_tabs[tab_key] = {
            "widget":      w,
            "char_ts":     char_ts,
            "insert_pos":  "1.0",
            "highlighter": hl,
        }
        self._add_tab_button(tab_key)
        w.pack(fill=tk.BOTH, expand=True)
        self._connect_scrollbars(w)
        return w, hl

    def _connect_scrollbars(self, widget: "tk.Text") -> None:
        self.vscroll.config(command=widget.yview)
        self.hscroll.config(command=widget.xview)
        widget.config(yscrollcommand=self.vscroll.set,
                      xscrollcommand=self.hscroll.set)

    def _switch_to_file(self, tab_key: str) -> None:
        if tab_key == self._active_file:
            return
        try:
            self._file_tabs[self._active_file]["insert_pos"] = self.text.index(tk.INSERT)
        except Exception:
            pass
        self.text.config(yscrollcommand="", xscrollcommand="")
        self.text.pack_forget()
        if tab_key not in self._file_tabs:
            widget, hl = self._create_file_tab(tab_key)
        else:
            widget = self._file_tabs[tab_key]["widget"]
            hl     = self._file_tabs[tab_key]["highlighter"]
            widget.pack(fill=tk.BOTH, expand=True)
            self._connect_scrollbars(widget)
        self._active_file = tab_key
        self.text         = widget
        self.char_ts      = self._file_tabs[tab_key]["char_ts"]
        self.highlighter  = hl
        try:
            self.text.mark_set(tk.INSERT, self._file_tabs[tab_key]["insert_pos"])
        except tk.TclError:
            self.text.mark_set(tk.INSERT, "1.0")
        self._update_tab_bar()

    def _add_tab_button(self, tab_key: str) -> None:
        btn = tk.Button(
            self._tab_bar,
            text=f"  {tab_key}  ",
            command=lambda k=tab_key: self._switch_to_file(k),
            bg=CLR["sidebar"], fg=CLR["muted"],
            activebackground=CLR["toolbar"], activeforeground=CLR["fg"],
            relief=tk.FLAT, padx=6, pady=3, bd=0, cursor="hand2",
            font=("Segoe UI", 8),
        )
        btn.pack(side=tk.LEFT)
        self._tab_buttons[tab_key] = btn

    def _update_tab_bar(self) -> None:
        for key, btn in self._tab_buttons.items():
            if key == self._active_file:
                btn.config(bg=CLR["bg"], fg=CLR["fg"])
            else:
                btn.config(bg=CLR["sidebar"], fg=CLR["muted"])

    def _build_statusbar(self) -> None:
        self.lbl_status = tk.Label(
            self.root, text="Ready",
            bg=CLR["accent"], fg="white",
            anchor=tk.W, padx=8, pady=3,
            font=("Segoe UI", 9),
        )
        self.lbl_status.pack(fill=tk.X, side=tk.BOTTOM)

    def _toggle_dev_panel(self) -> None:
        if self._dev_expanded:
            self._dev_expanded = False
            self._dev_toggle_btn.config(text="+")
            self._dev_outer.place(relx=1.0, rely=1.0, relwidth=0.52, relheight=0.0,
                                   anchor="se", x=-18, y=-22)
            self._dev_outer.place_forget()
            self._dev_outer.place(relx=1.0, rely=1.0, relwidth=0.52, height=24,
                                   anchor="se", x=-18, y=-22)
        else:
            self._dev_expanded = True
            self._dev_toggle_btn.config(text="−")
            self._dev_outer.place_forget()
            self._dev_outer.place(relx=1.0, rely=1.0, relwidth=0.52, relheight=0.40,
                                   anchor="se", x=-18, y=-22)

    def _build_tooltip(self) -> None:
        self.tip = tk.Toplevel(self.root)
        self.tip.withdraw()
        self.tip.overrideredirect(True)
        self.tip.attributes("-topmost", True)
        tf = tk.Frame(self.tip, bg="#e0e0e0", bd=1, relief=tk.SOLID)
        tf.pack()
        self.tip_lbl = tk.Label(
            tf, bg="#ffffff", fg=CLR["fg"],
            font=("Segoe UI", 9), padx=10, pady=5,
        )
        self.tip_lbl.pack()

    def _setup_text_tags(self) -> None:
        self.dev_text.tag_config("anchor_flash")


    def _show_settings_popup(self) -> None:
        pop = tk.Toplevel(self.root)
        pop.title("VS Code Settings")
        pop.configure(bg=CLR["settingsbg"])
        pop.resizable(False, False)
        pop.geometry("520x370")
        pop.grab_set()

        src = self.vscode.source
        short_src = src if src == "defaults" else (
            "…" + src[-45:] if len(src) > 48 else src
        )
        tk.Label(
            pop, text="⚙  VS Code Editor Settings",
            bg=CLR["settingsbg"], fg=CLR["blue"],
            font=("Segoe UI", 11, "bold"), pady=10,
        ).pack()
        tk.Label(
            pop, text=f"Source: {short_src}",
            bg=CLR["settingsbg"], fg=CLR["muted"],
            font=("Consolas", 8), pady=0,
        ).pack()

        ttk.Separator(pop, orient=tk.HORIZONTAL).pack(fill=tk.X, padx=16, pady=8)

        sections = {
            "Affects typing output": [
                "editor.autoClosingBrackets",
                "editor.autoClosingQuotes",
                "html.autoClosingTags",
                "html.autoCreateQuotes",
            ],
            "UI / hints (no output effect)": [
                "editor.stickyScroll.enabled",
                "editor.parameterHints.enabled",
                "editor.suggestOnTriggerCharacters",
                "editor.wordBasedSuggestions",
                "editor.quickSuggestions",
                "editor.minimap.enabled",
            ],
        }

        for section_title, keys in sections.items():
            tk.Label(
                pop, text=f"  {section_title}",
                bg=CLR["settingsbg"], fg=CLR["yellow"],
                font=("Segoe UI", 9, "bold"), anchor=tk.W,
            ).pack(fill=tk.X, padx=16)

            frame = tk.Frame(pop, bg=CLR["bg"], padx=12, pady=6)
            frame.pack(fill=tk.X, padx=16, pady=(2, 8))

            for key in keys:
                val = self.vscode.raw.get(key, VSCodeSettings.DEFAULTS.get(key))
                if isinstance(val, bool):
                    active = val
                    val_str = "ON" if val else "off"
                elif isinstance(val, dict):
                    active = any(v for v in val.values() if v not in (False, "off"))
                    val_str = "mixed" if active else "off"
                else:
                    active = str(val).lower() not in ("never", "off", "false", "0")
                    val_str = str(val)

                row = tk.Frame(frame, bg=CLR["bg"])
                row.pack(fill=tk.X, pady=1)

                indicator_color = CLR["green"] if active else CLR["dim"]
                tk.Label(row, text="●", bg=CLR["bg"], fg=indicator_color,
                         font=("Segoe UI", 8), width=2).pack(side=tk.LEFT)
                tk.Label(row, text=key, bg=CLR["bg"], fg=CLR["fg"],
                         font=("Consolas", 9), anchor=tk.W).pack(side=tk.LEFT, expand=True, fill=tk.X)
                tk.Label(row, text=val_str,
                         bg=CLR["bg"],
                         fg=CLR["orange"] if active else CLR["muted"],
                         font=("Consolas", 9, "bold"), width=18, anchor=tk.E,
                         ).pack(side=tk.RIGHT)

        ttk.Separator(pop, orient=tk.HORIZONTAL).pack(fill=tk.X, padx=16, pady=4)
        tk.Button(
            pop, text="Close", command=pop.destroy,
            bg=CLR["accent"], fg="white",
            relief=tk.FLAT, padx=16, pady=4, cursor="hand2",
        ).pack(pady=6)

    def _load_file(self, path: str) -> None:
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
        except Exception as exc:
            self._set_status(f"⚠  Could not load file: {exc}", CLR["red"])
            return

        self.vscode = VSCodeSettings.load(path)
        self._update_settings_badge()

        events = data.get("events", [])
        self.micro = self._expand_events(events)
        def _ts(act):
            k = act[0]
            if k == "interaction":                      return act[3]
            if k in ("code_insert_begin", "code_insert_end"): return act[1]
            if k == "switch_editor":                    return act[2]
            return act[2]
        self._micro_ts = [_ts(a) for a in self.micro]
        self._seek_to(len(self.micro))
        self.btn_play.config(state=tk.NORMAL)
        self.btn_reset.config(state=tk.NORMAL)
        name = path.replace("\\", "/").split("/")[-1]
        src_label = "settings.json" if self.vscode.source != "defaults" else "defaults"
        self._set_status(
            f"  Loaded: {name}  ·  {len(events)} events  →  {len(self.micro)} steps"
            f"  ·  VS Code: {src_label}"
        )

    def _update_settings_badge(self) -> None:
        src = self.vscode.source
        if src == "defaults":
            label, fg = "⚙ VS Code: defaults", CLR["blue"]
        elif src.startswith("parse error:"):
            label, fg = "⚙ VS Code: parse error ⚠", CLR["red"]
        else:
            label, fg = "⚙ VS Code: settings.json ✓", CLR["green"]
        self.btn_settings.config(text=label, fg=fg)


    def _expand_events(self, events: list) -> list:
        return expand_events(events)


    def toggle_play(self) -> None:
        if self.playing:
            self._pause()
        else:
            if self.micro_idx >= len(self.micro) and self.micro:
                self._seek_to(0)
            self._play()

    def _play(self) -> None:
        self.playing = True
        self.btn_play.config(text="⏸   Pause", bg="#9a7000")
        self._set_status("  ▶  Playing…")
        self._step_start_wall = time.monotonic()
        self._step_dur_s      = 0.001
        self._schedule_seekbar_update()
        self._schedule(0)

    def _pause(self) -> None:
        self.playing = False
        if self.after_id:
            self.root.after_cancel(self.after_id)
            self.after_id = None
        if self._seekbar_after_id:
            self.root.after_cancel(self._seekbar_after_id)
            self._seekbar_after_id = None
        if self._drag_seek_id is not None:
            self.root.after_cancel(self._drag_seek_id)
            self._drag_seek_id = None
        self.btn_play.config(text="▶   Play", bg="#2d8f2d")
        self._set_status("  ⏸  Paused")

    def _schedule_seekbar_update(self) -> None:
        if self._seekbar_after_id:
            self.root.after_cancel(self._seekbar_after_id)
            self._seekbar_after_id = None
        if not self.playing or self._seeking:
            return
        total = len(self.micro)
        if not total:
            return
        elapsed = time.monotonic() - self._step_start_wall
        t = elapsed / self._step_dur_s if self._step_dur_s > 0 else 1.0
        t = max(0.0, min(1.0, t))
        frac = (self.micro_idx + t) / total
        frac = max(0.0, min(1.0, frac))
        self._seek_fraction = frac
        self._draw_seekbar(frac)
        self._seekbar_after_id = self.root.after(33, self._schedule_seekbar_update)

    def reset_playback(self) -> None:
        self._pause()
        self.micro_idx = 0
        for tab_data in self._file_tabs.values():
            w = tab_data["widget"]
            w.config(state=tk.NORMAL)
            w.delete("1.0", tk.END)
            for mark in w.mark_names():
                if mark.startswith("_anchor_"):
                    w.mark_unset(mark)
            tab_data["char_ts"].clear()
            tab_data["insert_pos"] = "1.0"
        if self._active_file != "MAIN":
            self._switch_to_file("MAIN")
        self.char_ts = self._file_tabs["MAIN"]["char_ts"]
        self.dev_ts  = []
        self.dev_text.config(state=tk.NORMAL)
        self.dev_text.delete("1.0", tk.END)
        if self._log_built:
            self._update_log_clip(0)
        else:
            self._clear_log()
            self._log_buf.clear()
        self._update_progress()
        if self.micro:
            self.btn_play.config(state=tk.NORMAL)
        self._set_status("  ⏮  Reset — press Play to begin")
        self.dev_indicator.config(fg=CLR["dim"])

    def _schedule(self, delay_ms: int) -> None:
        if self.playing:
            self.after_id = self.root.after(max(1, delay_ms), self._step)

    def _step(self) -> None:
        if not self.playing:
            return
        if self.micro_idx >= len(self.micro):
            self.playing = False
            self.btn_play.config(text="▶   Play", bg="#2d8f2d")
            self._set_status("  ✓  Playback complete")
            return
        act = self.micro[self.micro_idx]
        self.micro_idx += 1
        delay_base = self._handle(act)
        if self._log_built:
            self._update_log_clip(self.micro_idx)
        self._update_progress()
        speed = max(0.1, self.speed_var.get())
        delay_ms = int(delay_base / speed)
        self._step_start_wall = time.monotonic()
        self._step_dur_s      = delay_ms / 1000.0 if delay_ms > 0 else 0.001
        self._schedule(delay_ms)

    def _handle(self, act: tuple) -> int:
        kind = act[0]

        if kind == "switch_editor":
            _, target, ts, delay = act
            if target == "main":
                self._switch_to_file("MAIN")
            label = "DevTools" if target == "dev" else "Main Editor"
            self._log(ts, f"⇄  switch to {label}", CLR["move"])
            self.dev_indicator.config(fg=CLR["devborder"] if target == "dev" else CLR["dim"])
            return delay

        elif kind == "switch_file":
            _, filename, ts, delay = act
            self._switch_to_file(filename)
            self._log(ts, f"⇄  switch to file: {filename}", CLR["move"])
            return delay

        elif kind == "char":
            _, ch, ts, delay, editor = act
            return self._handle_char(ch, ts, delay, editor)

        elif kind == "code_insert_begin":
            _, ts, delay = act
            line_start = self.text.index("insert linestart")
            line_text  = self.text.get(line_start, "insert")
            self._ci_base_indent = re.match(r"^(\s*)", line_text).group(1)
            return delay

        elif kind == "code_insert_end":
            _, ts, delay = act
            self._ci_base_indent = ""
            return delay

        elif kind == "code_delete_line":
            _, ts, delay, editor = act
            widget, ts_store = self._editor_widgets(editor)
            try:
                self._delete_current_line(widget, ts_store)
            except tk.TclError:
                pass
            self._log(ts, "⛔  Delete Line (in code_insert)", CLR["red"])
            return delay

        elif kind == "code_move_up":
            _, ts, delay, editor = act
            widget, _ = self._editor_widgets(editor)
            try:
                line_start = widget.index("insert linestart")
                prev_line  = widget.index(f"{line_start}-1line")
                widget.mark_set(tk.INSERT, prev_line)
                if editor == "main":
                    line_text = self.text.get("insert linestart", "insert")
                    self._ci_base_indent = re.match(r"^(\s*)", line_text).group(1)
                self._scroll_to()
            except tk.TclError:
                pass
            self._log(ts, "⬆  Move Up (in code_insert)", CLR["orange"])
            return delay

        elif kind == "code_move_end":
            _, ts, delay, editor = act
            widget, _ = self._editor_widgets(editor)
            try:
                line_end = widget.index("insert lineend")
                widget.mark_set(tk.INSERT, line_end)
                if editor == "main":
                    line_text = self.text.get("insert linestart", "insert")
                    self._ci_base_indent = re.match(r"^(\s*)", line_text).group(1)
                self._scroll_to()
            except tk.TclError:
                pass
            self._log(ts, "►  Move End (in code_insert)", CLR["orange"])
            return delay

        elif kind == "code_insert_newline":
            _, ts, delay, editor = act
            widget, ts_store = self._editor_widgets(editor)
            try:
                self._insert_char("\n", ts, widget, ts_store)
                if editor == "main":
                    self._auto_indent(ts)
                    line_text = self.text.get("insert linestart", "insert")
                    self._ci_base_indent = re.match(r"^(\s*)", line_text).group(1)
                self._scroll_to()
            except tk.TclError:
                pass
            self._log(ts, "↩  Insert Newline (in code_insert)", CLR["orange"])
            return delay

        elif kind == "code_cursor_move":
            _, ch, ts, delay, editor = act
            widget, _ = self._editor_widgets(editor)
            try:
                if CURSOR_MOVES.get(ch) == "insert linestart":
                    widget.mark_set(tk.INSERT, "insert linestart")
                    line_text = widget.get("insert linestart", "insert lineend")
                    indent = len(line_text) - len(line_text.lstrip())
                    widget.mark_set(tk.INSERT, f"insert linestart +{indent}c")
                else:
                    widget.mark_set(tk.INSERT, CURSOR_MOVES[ch])
                self._scroll_to()
                if editor == "main":
                    line_text = self.text.get("insert linestart", "insert")
                    self._ci_base_indent = re.match(r"^(\s*)", line_text).group(1)
            except tk.TclError:
                pass
            self._log(ts, f"  {ch} (in code_insert)", CLR["orange"])
            return delay

        elif kind == "code_backspace":
            _, ts, delay, editor = act
            widget, ts_store = self._editor_widgets(editor)
            ignored = False
            try:
                ignored = self._bs_ignored_for_widget(widget)
                if not ignored:
                    flat = text_flat_index(widget, "insert")
                    if flat > 0 and (flat - 1) < len(ts_store):
                        ts_store.pop(flat - 1)
                    widget.delete("insert-1c", tk.INSERT)
            except tk.TclError:
                pass
            if ignored:
                self._log(ts, "⌫  Backspace (ignored — before closing tag)", "#FFAAAA")
            else:
                self._log(ts, "⌫  Backspace (in code_insert)", CLR["red"])
            return delay

        elif kind == "code_fwd_delete":
            _, ts, delay, editor = act
            widget, ts_store = self._editor_widgets(editor)
            try:
                flat = text_flat_index(widget, "insert")
                if flat < len(ts_store):
                    ts_store.pop(flat)
                widget.delete(tk.INSERT, "insert+1c")
            except tk.TclError:
                pass
            self._log(ts, "⌦  Delete (in code_insert)", CLR["red"])
            return delay

        elif kind == "code_char":
            _, ch, ts, delay, editor = act
            widget, ts_store = self._editor_widgets(editor)
            if editor == "main":
                self._auto_dedent(ch, ts)
            self._insert_char(ch, ts, widget, ts_store)
            if editor == "dev":
                self.dev_indicator.config(fg=CLR["devborder"])
            return delay

        elif kind == "log_code_insert":
            _, snippet, ts, delay = act
            clean = ANCHOR_RE.sub("", snippet)
            self._log(ts, f"⬇  code_insert: {repr(clean[:50])}", CLR["orange"])
            return delay

        elif kind == "set_anchor":
            _, name, ts, delay = act
            mark = f"_anchor_{name}"
            self.text.mark_set(mark, tk.INSERT)
            self.text.mark_gravity(mark, tk.LEFT)
            pos = self.text.index(mark)
            self._log(ts, f"⚓  anchor {name} → {pos}", CLR["accent"])
            return delay

        elif kind == "move_anchor":
            _, name, ts, delay = act
            mark = f"_anchor_{name}"
            if mark in self.text.mark_names():
                pos = self.text.index(mark)
                self.text.mark_set(tk.INSERT, mark)
                self._scroll_to()
                self._flash_anchor(self.text, pos)
                self._log(ts, f"→  move_to {name} (now {pos})", CLR["move"])
            else:
                self._log(ts, f"⚠  unknown anchor: {name}", CLR["red"])
            return delay

        return DELAY_OPS


    def _editor_widgets(self, editor: str) -> tuple:
        if editor == "dev":
            return self.dev_text, self.dev_ts
        return self.text, self.char_ts

    def _bs_ignored_for_widget(self, widget: "tk.Text") -> bool:
        closing = HeadlessEditor._CLOSING
        next_text = widget.get(tk.INSERT, "insert lineend").lstrip()
        prev_char = widget.get("insert-1c", tk.INSERT) if widget.index(tk.INSERT) != "1.0" else ""
        if prev_char in ("\n", "") and any(next_text.startswith(t) for t in closing):
            return True
        whole_line = widget.get("insert linestart", "insert lineend")
        if whole_line.strip() == "":
            try:
                next_line = widget.get("insert lineend +1c", "insert lineend +1c lineend").lstrip()
                if any(next_line.startswith(t) for t in closing):
                    return True
            except tk.TclError:
                pass
            prev_end  = widget.index("insert linestart -1c")
            prev_text = widget.get(f"{prev_end} linestart", prev_end).rstrip()
            if (HeadlessEditor._OPEN_TAG_RE.search(prev_text)
                    and not prev_text.endswith("/>")
                    and not HeadlessEditor._VOID_TAGS_RE.search(prev_text)):
                return True
        return False

    def _delete_current_line(self, widget: "tk.Text", ts_store: list) -> None:
        line_start  = widget.index("insert linestart")
        line_end    = widget.index("insert lineend")
        after_end   = widget.index(f"{line_end}+1c")
        has_newline = widget.get(line_end, after_end) == "\n"
        del_end     = after_end if has_newline else line_end
        flat_s = text_flat_index(widget, line_start)
        flat_e = text_flat_index(widget, del_end)
        n_del  = flat_e - flat_s
        if n_del > 0 and flat_s < len(ts_store):
            del ts_store[flat_s: flat_s + n_del]
        widget.delete(line_start, del_end)

    def _handle_char(self, ch: str, ts: int, delay: int, editor: str = "main") -> int:
        widget, ts_store = self._editor_widgets(editor)

        if ch in CURSOR_MOVES:
            try:
                if CURSOR_MOVES[ch] == "insert linestart":
                    self.text.mark_set(tk.INSERT, "insert linestart")
                    line_text = self.text.get("insert linestart", "insert lineend")
                    indent = len(line_text) - len(line_text.lstrip())
                    self.text.mark_set(tk.INSERT, f"insert linestart +{indent}c")
                else:
                    self.text.mark_set(tk.INSERT, CURSOR_MOVES[ch])
                self._scroll_to()
            except tk.TclError:
                pass
            self._sel_anchor = None
            self.text.tag_remove("sel", "1.0", "end")
            self._log(ts, f"⌨  {ch}", CLR["fg"])
            return delay

        if ch in SHIFT_CURSOR_MOVES:
            try:
                if self._sel_anchor is None:
                    self._sel_anchor = self.text.index(tk.INSERT)
                self.text.mark_set(tk.INSERT, SHIFT_CURSOR_MOVES[ch])
                self._scroll_to()
                new_pos = self.text.index(tk.INSERT)
                anchor  = self._sel_anchor
                self.text.tag_remove("sel", "1.0", "end")
                if self.text.compare(anchor, "<=", new_pos):
                    self.text.tag_add("sel", anchor, new_pos)
                else:
                    self.text.tag_add("sel", new_pos, anchor)
            except tk.TclError:
                pass
            self._log(ts, f"⌨  {ch} (select)", CLR["fg"])
            return delay

        if ch in CHAR_REPLACEMENTS:
            real_ch = CHAR_REPLACEMENTS[ch]
            is_enter = real_ch == "\n"
            is_tab   = real_ch == "\t"

            if is_tab and editor == "main" and self.text.tag_ranges("sel"):
                self._indent_selection(ts)
                self._log(ts, "⇥ Tab (indent selection)", CLR["fg"])
                return delay

            self._insert_char(real_ch, ts, widget, ts_store)
            if is_enter and editor == "main":
                self._auto_indent(ts)
            label = "↩ Enter" if is_enter else "⇥ Tab"
            self._log(ts, f"⌨  {label}", CLR["fg"])
            if editor == "dev":
                self.dev_indicator.config(fg=CLR["devborder"])
            return delay

        if ch in BACKSPACE_CHARS:
            if self._bs_ignored_for_widget(widget):
                self._log(ts, "⌫  Backspace (ignored — before closing tag)", "#FFAAAA")
                return delay
            if widget.index(tk.INSERT) != "1.0":
                flat = text_flat_index(widget, "insert")
                if flat > 0 and (flat - 1) < len(ts_store):
                    ts_store.pop(flat - 1)
                widget.delete("insert-1c", tk.INSERT)
            self._log(ts, "⌫  Backspace", CLR["red"])
            return delay

        if ch in DELETE_FWRD_CHARS:
            try:
                flat = text_flat_index(widget, "insert")
                if flat < len(ts_store):
                    ts_store.pop(flat)
                widget.delete(tk.INSERT, "insert+1c")
            except tk.TclError:
                pass
            self._log(ts, "⌦  Delete (forward)", CLR["red"])
            return delay

        if ch == DELETE_LINE_CHAR:
            try:
                self._delete_current_line(widget, ts_store)
            except tk.TclError:
                pass
            self._log(ts, "⛔  Delete Line (Ctrl+Shift+K)", CLR["red"])
            return delay

        if ch == PAUSE_CHAR:
            self._log(ts, "🕛  pause 500 ms", CLR["dim"])
            return PAUSE_MS

        if ch in IGNORED_CHARS:
            return DELAY_OPS

        if ch == ";" and editor == "dev":
            self._insert_char(ch, ts, widget, ts_store)
            self._dev_semicolon_newline(ts)
            self._log(ts, f"⌨  {repr(ch)}", CLR["dim"])
            return delay

        if editor == "main":
            self._auto_dedent(ch, ts)
        self._insert_char(ch, ts, widget, ts_store)

        if editor == "main":
            self._apply_vscode_auto(ch, ts)

        if editor == "dev":
            self.dev_indicator.config(fg=CLR["devborder"])

        self._log(ts, f"⌨  {repr(ch)}", CLR["dim"])
        return delay

    def _apply_vscode_auto(self, ch: str, ts: int) -> None:
        text_before = self.text.get("1.0", "insert")
        text_after  = self.text.get("insert", "insert lineend")

        auto = self.vscode.auto_create_quotes(ch, text_before[:-1])
        if auto:
            self._insert_auto(auto, ts)
            self.text.mark_set(tk.INSERT, "insert-1c")
            self._log(ts, f"  ↳ auto-quotes: {repr(auto)}", CLR["green"])
            return

        auto = self.vscode.auto_close_html_tag(ch, text_before[:-1])
        if auto:
            self._insert_auto(auto, ts)
            self.text.mark_set(tk.INSERT, f"insert-{len(auto)}c")
            self._log(ts, f"  ↳ auto-tag: {repr(auto)}", CLR["green"])
            return

        auto = self.vscode.auto_close_bracket(ch, text_after)
        if auto:
            self._insert_auto(auto, ts)
            self.text.mark_set(tk.INSERT, f"insert-{len(auto)}c")
            self._log(ts, f"  ↳ auto-bracket: {repr(auto)}", CLR["green"])
            return

        auto = self.vscode.auto_close_quote(ch, text_before, text_after)
        if auto:
            self._insert_auto(auto, ts)
            self.text.mark_set(tk.INSERT, f"insert-{len(auto)}c")
            self._log(ts, f"  ↳ auto-quote: {repr(auto)}", CLR["green"])
            return

    def _insert_auto(self, chars: str, ts: int) -> None:
        for ch in chars:
            flat = text_flat_index(self.text, "insert")
            if flat <= len(self.char_ts):
                self.char_ts.insert(flat, ts)
            else:
                self.char_ts.append(ts)
            self.text.insert(tk.INSERT, ch, "auto_insert")
        self._scroll_to()

    def _insert_char(self, ch: str, ts: int,
                     widget: tk.Text, ts_store: list) -> None:
        flat = text_flat_index(widget, "insert")
        if flat <= len(ts_store):
            ts_store.insert(flat, ts)
        else:
            ts_store.append(ts)
        widget.insert(tk.INSERT, ch)
        if not self._silent:
            widget.see(tk.INSERT)
            self.lbl_ts.config(text=fmt_ts(ts))
            if widget is self.text and self.highlighter:
                self.highlighter.schedule()

    def _indent_selection(self, ts: int) -> None:
        sel_ranges = self.text.tag_ranges("sel")
        if not sel_ranges:
            return
        sel_start = str(sel_ranges[0])
        sel_end   = str(sel_ranges[1])

        start_line = int(sel_start.split(".")[0])
        end_line   = int(sel_end.split(".")[0])
        if int(sel_end.split(".")[1]) == 0 and end_line > start_line:
            end_line -= 1

        for line in range(end_line, start_line - 1, -1):
            pos  = f"{line}.0"
            flat = text_flat_index(self.text, pos)
            if flat <= len(self.char_ts):
                self.char_ts.insert(flat, ts)
            else:
                self.char_ts.append(ts)
            self.text.insert(pos, "\t")

        if self.highlighter:
            self.highlighter.schedule()

        self._sel_anchor = None
        self.text.tag_remove("sel", "1.0", "end")


    def _auto_dedent(self, ch: str, ts: int) -> bool:
        line_start  = self.text.index("insert linestart")
        line_before = self.text.get(line_start, "insert")

        is_closer   = ch in "})]"
        is_html_end = (ch == "/" and bool(re.fullmatch(r"[ \t]*<", line_before)))

        if not (is_closer or is_html_end):
            return False

        if is_closer and not re.fullmatch(r"[ \t]*", line_before):
            return False

        if not line_before:
            return False

        if line_before.startswith("\t"):
            new_before = line_before[1:]
        elif line_before.startswith("    "):
            new_before = line_before[4:]
        elif line_before.startswith("  "):
            new_before = line_before[2:]
        else:
            return False

        n_remove = len(line_before) - len(new_before)
        for _ in range(n_remove):
            flat = text_flat_index(self.text, line_start)
            if flat < len(self.char_ts):
                self.char_ts.pop(flat)
            self.text.delete(line_start, f"{line_start}+1c")
        return True


    def _auto_indent(self, ts: int) -> None:
        cur_start    = self.text.index("insert linestart")
        prev_lineend = self.text.index(f"{cur_start}-1c")
        prev_text    = self.text.get(f"{prev_lineend} linestart", prev_lineend)

        base_indent  = re.match(r"^(\s*)", prev_text).group(1)
        prev_stripped = prev_text.rstrip()

        opens = bool(
            re.search(r"[{(\[]$", prev_stripped)
            or (
                HeadlessEditor._OPEN_TAG_RE.search(prev_stripped)
                and not prev_stripped.endswith("/>")
                and not HeadlessEditor._VOID_TAGS_RE.search(prev_stripped)
            )
        )

        extra        = "\t" if opens else ""
        new_indent   = base_indent + extra

        after = self.text.get("insert", "insert lineend").strip()
        closes = bool(re.match(r"^[})\]]", after) or re.match(r"^</", after))

        if opens and closes:
            for ch in new_indent:
                self._insert_char(ch, ts, self.text, self.char_ts)
            self._insert_char("\n", ts, self.text, self.char_ts)
            for ch in base_indent:
                self._insert_char(ch, ts, self.text, self.char_ts)
            self.text.mark_set(tk.INSERT, "insert-1l lineend")
        elif closes:
            closing_indent = HeadlessEditor._dedent_one(base_indent)
            for ch in closing_indent:
                self._insert_char(ch, ts, self.text, self.char_ts)
        else:
            for ch in new_indent:
                self._insert_char(ch, ts, self.text, self.char_ts)

    def _dev_semicolon_newline(self, ts: int) -> None:
        cur_line  = self.dev_text.get("insert linestart", "insert lineend")
        indent    = re.match(r"^(\s*)", cur_line).group(1)
        self._insert_char("\n", ts, self.dev_text, self.dev_ts)
        for ch in indent:
            self._insert_char(ch, ts, self.dev_text, self.dev_ts)

    def _flash_anchor(self, widget: tk.Text, pos: str) -> None:
        try:
            end = widget.index(f"{pos}+1c")
            widget.tag_add("anchor_flash", pos, end)
            self.root.after(600, lambda w=widget: w.tag_remove("anchor_flash", "1.0", "end"))
        except Exception:
            pass

    def _select_all_code(self, event=None) -> str:
        self.text.tag_add("sel", "1.0", "end")
        return "break"

    def _on_hover(self, event: tk.Event, widget: tk.Text, ts_store: list) -> None:
        try:
            idx  = widget.index(f"@{event.x},{event.y}")
            flat = text_flat_index(widget, idx)
            ts   = None
            if 0 <= flat < len(ts_store):
                ts = ts_store[flat]
            elif flat > 0 and (flat - 1) < len(ts_store):
                ts = ts_store[flat - 1]
            if ts:
                try:
                    dt = datetime.fromtimestamp(ts / 1000, tz=FINLAND_TZ)
                    time_str = dt.strftime("%H:%M:%S") + f".{dt.microsecond // 1000:03d}"
                except Exception:
                    time_str = fmt_ts(ts).split("  ")[-1]
                self.tip_lbl.config(text=time_str)
                x = self.root.winfo_pointerx() + 16
                y = self.root.winfo_pointery() + 24
                self.tip.geometry(f"+{x}+{y}")
                self.tip.deiconify()
                return
        except Exception:
            pass
        self.tip.withdraw()

    def _log(self, ts: int, msg: str, color: str = "#1a6a9a") -> None:
        if self._log_built:
            return
        t_short = fmt_ts(ts)[-12:] if ts else "??:??:??.???"
        if self._silent:
            self._log_buf.append((self.micro_idx, f"[{t_short}] {msg}\n", color))
            return
        self.lbl_ts.config(text=fmt_ts(ts))
        self._log_raw(f"[{t_short}] {msg}\n", color)

    def _log_raw(self, text: str, color: str) -> None:
        tag = f"clr_{color.replace('#', '')}"
        self.event_log.tag_config(tag, foreground=color)
        self.event_log.insert(tk.END, text, tag)
        self.event_log.see(tk.END)


    def _render_full_log_widget(self) -> None:
        w = self.event_log
        w.delete("1.0", tk.END)
        w.tag_config("log_hidden", elide=True)

        self._log_chars = []
        cumulative = 0
        for (_mi, text, color) in self._full_log:
            tag = f"clr_{color.replace('#', '')}"
            w.tag_config(tag, foreground=color)
            w.insert(tk.END, text, (tag, "log_hidden"))
            cumulative += len(text)
            self._log_chars.append(cumulative)

    def _update_log_clip(self, target_idx: int) -> None:
        if not self._log_built or not self._full_log:
            return
        import bisect
        k = bisect.bisect_right(self._log_micro, target_idx) - 1
        w = self.event_log
        if k < 0:
            w.tag_add("log_hidden", "1.0", "end")
        else:
            cut = f"1.0+{self._log_chars[k]}c"
            w.tag_remove("log_hidden", "1.0", cut)
            w.tag_add("log_hidden", cut, "end")
            w.see(cut)

    def _clear_log(self) -> None:
        self.event_log.delete("1.0", tk.END)

    def _update_progress(self) -> None:
        total = len(self.micro)
        idx   = self.micro_idx
        if not self._silent:
            self.lbl_progress.config(text=f"{idx} / {total}")
        if not self.playing or self._seeking:
            frac = self._idx_to_frac(idx)
            self._seek_fraction = frac
            self._draw_seekbar(frac)

    def _idx_to_frac(self, idx: int) -> float:
        total = len(self.micro)
        return idx / total if total else 0.0

    def _frac_to_idx(self, frac: float) -> int:
        total = len(self.micro)
        return min(total, max(0, round(frac * total)))

    def _scroll_to(self, pos: str = tk.INSERT) -> None:
        if self.auto_scroll_var.get():
            self.text.see(pos)

    def _draw_seekbar(self, frac: float) -> None:
        c = self._seek_canvas
        if c is None:
            return
        w = c.winfo_width()
        h = c.winfo_height()
        if w < 2:
            return
        filled = int(w * max(0.0, min(1.0, frac)))
        c.delete("all")
        c.create_rectangle(0, 0, w, h, fill=CLR["sidebar"], outline="")
        if filled > 0:
            c.create_rectangle(0, 0, filled, h, fill=CLR["accent"], outline="")
        c.update_idletasks()

    def _seek_fraction_from_x(self, x: int) -> float:
        w = self._seek_canvas.winfo_width()
        return max(0.0, min(1.0, x / w)) if w > 0 else 0.0

    def _on_seek_press(self, event: tk.Event) -> None:
        self._seeking = True
        self._seek_was_playing = self.playing
        if self.playing:
            self.playing = False
            if self.after_id:
                self.root.after_cancel(self.after_id)
                self.after_id = None
            if self._seekbar_after_id:
                self.root.after_cancel(self._seekbar_after_id)
                self._seekbar_after_id = None
        frac = self._seek_fraction_from_x(event.x)
        self._draw_seekbar(frac)

    def _on_seek_drag(self, event: tk.Event) -> None:
        if not self._seeking:
            return
        frac = self._seek_fraction_from_x(event.x)
        self._drag_frac = frac
        self._draw_seekbar(frac)
        if self._drag_seek_id is None:
            self._drag_seek_id = self.root.after(150, self._do_drag_seek)

    def _do_drag_seek(self) -> None:
        self._drag_seek_id = None
        if not self._seeking:
            return
        target = self._frac_to_idx(self._drag_frac)
        self._seek_to(target)
        self._draw_seekbar(self._drag_frac)

    def _on_seek_release(self, event: tk.Event) -> None:
        if not self._seeking:
            return
        if self._drag_seek_id is not None:
            self.root.after_cancel(self._drag_seek_id)
            self._drag_seek_id = None
        self._seeking = False
        frac = self._seek_fraction_from_x(event.x)
        target = self._frac_to_idx(frac)
        self._seek_to(target)
        if getattr(self, "_seek_was_playing", False):
            self._play()

    def _seek_to(self, target_idx: int) -> None:
        if not self.micro:
            return
        target_idx = max(0, min(target_idx, len(self.micro)))
        self._set_status("  ⏩  Seeking…", CLR["dim"])
        self.root.update_idletasks()

        self._silent = True
        self.micro_idx = 0
        self._ci_base_indent = ""
        for tab_data in self._file_tabs.values():
            w = tab_data["widget"]
            w.delete("1.0", tk.END)
            for mark in w.mark_names():
                if mark.startswith("_anchor_"):
                    w.mark_unset(mark)
            tab_data["char_ts"].clear()
            tab_data["insert_pos"] = "1.0"
        if self._active_file != "MAIN":
            self._switch_to_file("MAIN")
        self.char_ts = self._file_tabs["MAIN"]["char_ts"]
        self.dev_ts  = []
        self.dev_text.delete("1.0", tk.END)
        if not self._log_built:
            self._clear_log()

        while self.micro_idx < target_idx:
            self._handle(self.micro[self.micro_idx])
            self.micro_idx += 1

        self._silent = False

        if not self._log_built:
            self._full_log  = list(self._log_buf)
            self._log_micro = [e[0] for e in self._full_log]
            self._log_buf.clear()
            self._render_full_log_widget()
            self._log_built = True
        if self.char_ts:
            self.lbl_ts.config(text=fmt_ts(self.char_ts[-1]))
        self._update_log_clip(target_idx)

        self._scroll_to()
        self.dev_text.see(tk.INSERT)
        for tab_data in self._file_tabs.values():
            if tab_data["highlighter"]:
                tab_data["highlighter"].invalidate_now()
        self._update_progress()
        self.lbl_progress.config(text=f"{self.micro_idx} / {len(self.micro)}")
        self.dev_indicator.config(
            fg=CLR["devborder"] if self.dev_text.get("1.0","end-1c") else CLR["dim"])

        if not self._seeking:
            if target_idx >= len(self.micro):
                self._set_status("  ✓  Playback complete")
            else:
                self._set_status(f"  ⏸  Seeked to {target_idx} / {len(self.micro)}")

    def _set_status(self, msg: str, bg: str = CLR["accent"]) -> None:
        self.lbl_status.config(text=msg, bg=bg)

    def _on_speed_changed(self, *_) -> None:
        v = self.speed_var.get()
        self.lbl_speed.config(text=f"{v:.0f}×")


def main() -> None:
    root = tk.Tk()
    style = ttk.Style(root)
    style.theme_use("clam")
    style.configure("Vertical.TScrollbar",
                    background="#c0c0c0", troughcolor=CLR["sidebar"], arrowcolor="#666")
    style.configure("Horizontal.TScrollbar",
                    background="#c0c0c0", troughcolor=CLR["sidebar"], arrowcolor="#666")
    style.configure("TProgressbar",
                    background=CLR["accent"], troughcolor=CLR["sidebar"], thickness=4)
    style.configure("TScale",
                    background=CLR["toolbar"], troughcolor="#cccccc")

    app = LogVisualizer(root)
    root.mainloop()


if __name__ == "__main__":
    main()