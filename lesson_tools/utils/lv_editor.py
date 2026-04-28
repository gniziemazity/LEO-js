import re
from .lv_constants import (
    ANCHOR_RE, CURSOR_MOVES, SHIFT_CURSOR_MOVES, CHAR_REPLACEMENTS,
    DELETE_LINE_CHAR, BACKSPACE_CHARS, DELETE_FWRD_CHARS, IGNORED_CHARS, PAUSE_CHAR, PAUSE_MS,
    PAGE_LINES, split_code_with_anchors,
)


class HeadlessEditor:
    _CLOSING = ("</style", "</script", "</html")
    _VOID_TAGS_RE = re.compile(
        r"<(area|base|br|col|embed|hr|img|input|link|meta|"
        r"param|source|track|wbr)(?:\s[^>]*)?>$", re.IGNORECASE
    )
    _OPEN_TAG_RE  = re.compile(r"<([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^>]*)?>$")

    def __init__(self, track_timestamps: bool = False) -> None:
        self._chars: list = []
        self._cur:   int  = 0
        self._anchors: dict = {}
        self._ci_indent: str = ""
        self._sel_anchor = None
        self._following_anchor: str | None = None
        self._anchor_had_backspace: bool = False
        self._track_ts: bool = track_timestamps
        self._cur_ts:   int  = 0
        self._next_idx: int  = 0
        self._char_ts:  list = []
        self._char_idx: list = []
        self._deleted_chars: list = []
        self._idx_to_anchor: dict = {}
        self._auto_dedent_idxs: set = set()

    def get_text(self) -> str:
        return "".join(self._chars)

    def get_surviving_with_timestamps(self) -> list:
        return list(zip(self._chars, self._char_ts))

    def get_deleted_with_timestamps(self) -> list:
        return list(self._deleted_chars)

    def get_text_with_ghosts(self) -> tuple:
        import bisect as _bisect
        text = "".join(self._chars)
        if not self._deleted_chars:
            return text, []

        surv_by_anchor: dict = {}
        for pos, gidx in enumerate(self._char_idx):
            anc = self._idx_to_anchor.get(gidx)
            surv_by_anchor.setdefault(anc, []).append((gidx, pos))
        for anc in surv_by_anchor:
            surv_by_anchor[anc].sort(key=lambda t: t[0])

        surv_idx_to_pos = {idx: pos for pos, idx in enumerate(self._char_idx)}
        sorted_all_surv_idxs = sorted(surv_idx_to_pos.keys())

        placements: dict = {}
        for ch, ins_ts, del_ts, gidx in self._deleted_chars:
            if gidx in self._auto_dedent_idxs:
                continue
            anc = self._idx_to_anchor.get(gidx)
            anc_survs = surv_by_anchor.get(anc, [])
            idxs = [s[0] for s in anc_survs]
            i = _bisect.bisect_left(idxs, gidx)
            if i > 0:
                placement_pos = anc_survs[i - 1][1] + 1
            elif i < len(anc_survs):
                placement_pos = anc_survs[i][1]
            elif anc is not None and anc in self._anchors:
                placement_pos = self._anchors[anc]
            else:
                j = _bisect.bisect_left(sorted_all_surv_idxs, gidx)
                if j > 0:
                    placement_pos = surv_idx_to_pos[sorted_all_surv_idxs[j - 1]] + 1
                else:
                    placement_pos = 0
            placements.setdefault(placement_pos, []).append((gidx, ch, ins_ts, del_ts))

        ranges = []
        for pos, items in placements.items():
            items.sort(key=lambda t: t[0])
            blob = "".join(c for _, c, _, _ in items)
            if not blob.strip():
                continue
            char_del_ts = [t[3] for t in items]
            char_before = self._chars[pos - 1] if pos > 0 else "\n"
            if char_before == "\n" and not blob.endswith("\n"):
                blob = blob + "\n"
                char_del_ts.append(max(char_del_ts))
            ranges.append({
                'pos':         pos,
                'text':        blob,
                'ins_ts':      min(t for _, _, t, _ in items),
                'del_ts':      max(t for _, _, _, t in items),
                'char_del_ts': char_del_ts,
            })
        ranges.sort(key=lambda g: g['pos'])
        return text, ranges

    def _line_start(self, pos=None) -> int:
        if pos is None: pos = self._cur
        while pos > 0 and self._chars[pos - 1] != "\n": pos -= 1
        return pos

    def _line_end(self, pos=None) -> int:
        if pos is None: pos = self._cur
        while pos < len(self._chars) and self._chars[pos] != "\n": pos += 1
        return pos

    def _col(self, pos=None):
        c = self._cur if pos is None else pos
        col = 0
        while c > 0 and self._chars[c - 1] != "\n": c -= 1; col += 1
        return col, c

    def _shift_anchors_after(self, pivot: int, delta: int) -> None:
        for name, p in self._anchors.items():
            if delta >= 0:
                if p > pivot or (
                    p == pivot
                    and name == self._following_anchor
                    and self._anchor_had_backspace
                ):
                    self._anchors[name] = p + delta
            else:
                if p > pivot: self._anchors[name] = max(pivot, p + delta)
        if self._sel_anchor is not None:
            p = self._sel_anchor
            if delta >= 0:
                if p >= pivot: self._sel_anchor = p + delta
            else:
                if p > pivot: self._sel_anchor = max(pivot, p + delta)

    def _ins(self, ch: str) -> None:
        self._chars.insert(self._cur, ch)
        if self._track_ts:
            self._char_ts.insert(self._cur, self._cur_ts)
            self._char_idx.insert(self._cur, self._next_idx)
            self._idx_to_anchor[self._next_idx] = self._following_anchor
            self._next_idx += 1
        self._shift_anchors_after(self._cur, 1)
        self._cur += 1

    def _del_before(self) -> None:
        if self._cur > 0:
            if (self._following_anchor is not None
                    and self._anchors.get(self._following_anchor) == self._cur):
                self._anchor_had_backspace = True
            self._cur -= 1
            ch = self._chars.pop(self._cur)
            if self._track_ts:
                ts  = self._char_ts.pop(self._cur)
                idx = self._char_idx.pop(self._cur)
                self._deleted_chars.append((ch, ts, self._cur_ts, idx))
            self._shift_anchors_after(self._cur, -1)

    def _del_at(self) -> None:
        if self._cur < len(self._chars):
            pos = self._cur
            ch = self._chars.pop(pos)
            if self._track_ts:
                ts  = self._char_ts.pop(pos)
                idx = self._char_idx.pop(pos)
                self._deleted_chars.append((ch, ts, self._cur_ts, idx))
            self._shift_anchors_after(pos, -1)

    def _mv_up(self) -> None:
        col, _ = self._col()
        ls = self._line_start()
        if ls == 0: self._cur = 0; return
        pe = ls - 1; ps = self._line_start(pe)
        self._cur = ps + min(col, pe - ps)

    def _mv_down(self) -> None:
        col, _ = self._col()
        le = self._line_end()
        if le >= len(self._chars): self._cur = len(self._chars); return
        nls = le + 1; nle = self._line_end(nls)
        self._cur = nls + min(col, nle - nls)

    def _sel_range(self):
        if self._sel_anchor is None: return None
        a, b = self._sel_anchor, self._cur
        if a == b: return None
        return (min(a, b), max(a, b))

    def _clear_sel(self) -> None:
        self._sel_anchor = None

    def _ensure_sel_anchor(self) -> None:
        if self._sel_anchor is None:
            self._sel_anchor = self._cur

    def _delete_line(self) -> None:
        ls = self._line_start(); le = self._line_end()
        end = le + 1 if le < len(self._chars) else le
        n = end - ls
        if self._track_ts:
            for i in range(ls, end):
                self._deleted_chars.append(
                    (self._chars[i], self._char_ts[i], self._cur_ts, self._char_idx[i]))
            del self._char_ts[ls:end]
            del self._char_idx[ls:end]
        del self._chars[ls:end]
        for name, p in list(self._anchors.items()):
            if p >= end: self._anchors[name] = p - n
            elif p >= ls: self._anchors[name] = ls
        if self._sel_anchor is not None:
            if self._sel_anchor >= end: self._sel_anchor -= n
            elif self._sel_anchor >= ls: self._sel_anchor = ls
        self._cur = ls; self._clear_sel()

    @staticmethod
    def _dedent_one(indent: str) -> str:
        if indent.startswith("\t"):    return indent[1:]
        if indent.startswith("    "): return indent[4:]
        if indent.startswith("  "):   return indent[2:]
        return indent

    def _line_first_char(self, pos=None) -> int:
        p = self._line_start(pos)
        end = self._line_end(p)
        while p < end and self._chars[p] in (' ', '\t'):
            p += 1
        return p

    def _indent_selection(self) -> None:
        sr = self._sel_range()
        if sr is None: return
        sel_start, sel_end = sr
        all_ls = [0]
        for i, ch in enumerate(self._chars):
            if ch == "\n": all_ls.append(i + 1)
        def flat_to_lineidx(pos):
            return "".join(self._chars[:pos]).count("\n")
        s_li = flat_to_lineidx(sel_start)
        e_li = flat_to_lineidx(sel_end)
        if (sel_end < len(self._chars) and sel_end > 0
                and self._chars[sel_end - 1] == "\n" and e_li > s_li):
            e_li -= 1
        for li in range(e_li, s_li - 1, -1):
            if li >= len(all_ls): continue
            pos = all_ls[li]
            self._chars.insert(pos, "\t")
            if self._track_ts:
                self._char_ts.insert(pos, self._cur_ts)
                self._char_idx.insert(pos, self._next_idx)
                self._next_idx += 1
            for name, p in self._anchors.items():
                if p > pos: self._anchors[name] = p + 1
            if self._sel_anchor is not None and self._sel_anchor > pos:
                self._sel_anchor += 1
            if self._cur > pos: self._cur += 1
        self._clear_sel()

    def _prev_line_opens_tag(self) -> bool:
        ls = self._line_start()
        if ls == 0:
            return False
        prev_end = ls - 1
        prev_ls  = self._line_start(prev_end)
        prev = "".join(self._chars[prev_ls:prev_end]).rstrip()
        return bool(
            self._OPEN_TAG_RE.search(prev)
            and not prev.endswith("/>")
            and not self._VOID_TAGS_RE.search(prev)
        )

    def _backspace_is_ignored(self) -> bool:
        if self._cur == 0:
            return False
        prev_ch = self._chars[self._cur - 1]
        if prev_ch == "\n":
            ahead = "".join(self._chars[self._cur: self._cur + 9]).lstrip()
            return any(ahead.startswith(p) for p in self._CLOSING)
        if prev_ch in (" ", "\t"):
            ls = self._line_start()
            le = self._line_end()
            if "".join(self._chars[ls:le]).strip() == "":
                next_start = le + 1 if le < len(self._chars) else len(self._chars)
                ahead = "".join(self._chars[next_start: next_start + 9]).lstrip()
                if any(ahead.startswith(p) for p in self._CLOSING):
                    return True
                if self._prev_line_opens_tag():
                    return True
        return False

    def _auto_indent(self) -> None:
        nl = self._cur - 1; pls = self._line_start(nl)
        prev_line = "".join(self._chars[pls:nl])
        base = re.match(r"^(\s*)", prev_line).group(1)
        stripped = prev_line.rstrip()
        opens = bool(
            re.search(r"[{(\[]$", stripped) or (
                HeadlessEditor._OPEN_TAG_RE.search(stripped)
                and not stripped.endswith("/>")
                and not HeadlessEditor._VOID_TAGS_RE.search(stripped)))
        extra = "\t" if opens else ""
        new_indent = base + extra
        after = "".join(self._chars[self._cur: self._line_end()]).strip()
        closes = bool(re.match(r"^[})\]]", after) or re.match(r"^</", after))
        if opens and closes:
            for ch in new_indent: self._ins(ch)
            mid = self._cur
            self._ins("\n")
            for ch in base: self._ins(ch)
            self._cur = mid
        elif closes:
            for ch in self._dedent_one(base): self._ins(ch)
        else:
            for ch in new_indent: self._ins(ch)

    def _auto_dedent(self, ch: str) -> bool:
        ls = self._line_start()
        before = "".join(self._chars[ls: self._cur])
        is_closer = ch in "})]"
        is_html_end = (ch == "/" and bool(re.fullmatch(r"[ \t]*<", before)))
        if not (is_closer or is_html_end): return False
        if is_closer and not re.fullmatch(r"[ \t]*", before): return False
        if not before: return False
        if before.startswith("\t"): nb = before[1:]
        elif before.startswith("    "): nb = before[4:]
        elif before.startswith("  "): nb = before[2:]
        else: return False
        n = len(before) - len(nb)
        if self._track_ts:
            for i in range(ls, ls + n):
                idx = self._char_idx[i]
                self._deleted_chars.append(
                    (self._chars[i], self._char_ts[i], self._cur_ts, idx))
                self._auto_dedent_idxs.add(idx)
            del self._char_ts[ls: ls + n]
            del self._char_idx[ls: ls + n]
        del self._chars[ls: ls + n]
        for name, p in self._anchors.items():
            if p >= ls + n: self._anchors[name] = p - n
            elif p > ls: self._anchors[name] = ls
        if self._sel_anchor is not None:
            if self._sel_anchor >= ls + n: self._sel_anchor -= n
            elif self._sel_anchor > ls: self._sel_anchor = ls
        self._cur -= n
        return True

    def set_anchor(self, name: str) -> None:
        self._anchors[name] = self._cur

    def move_to_anchor(self, name: str) -> None:
        if name in self._anchors:
            self._cur = self._anchors[name]
            self._following_anchor = name
            self._anchor_had_backspace = False
            self._clear_sel()

    def handle_char(self, ch: str) -> bool:
        if ch in CURSOR_MOVES:
            self._following_anchor = None
            self._anchor_had_backspace = False
            self._clear_sel()
            m = CURSOR_MOVES[ch]
            if   m == "insert-1c":        self._cur = max(0, self._cur - 1)
            elif m == "insert+1c":        self._cur = min(len(self._chars), self._cur + 1)
            elif m == "insert-1l":        self._mv_up()
            elif m == "insert+1l":        self._mv_down()
            elif m == f"insert-{PAGE_LINES}l":
                for _ in range(PAGE_LINES): self._mv_up()
            elif m == f"insert+{PAGE_LINES}l":
                for _ in range(PAGE_LINES): self._mv_down()
            elif m == "insert linestart": self._cur = self._line_first_char()
            elif m == "insert lineend":   self._cur = self._line_end()
            return False
        if ch in SHIFT_CURSOR_MOVES:
            self._ensure_sel_anchor()
            m = SHIFT_CURSOR_MOVES[ch]
            if   m == "insert-1l":        self._mv_up()
            elif m == "insert+1l":        self._mv_down()
            elif m == "insert linestart": self._cur = self._line_first_char()
            elif m == "insert lineend":   self._cur = self._line_end()
            return False
        if ch in CHAR_REPLACEMENTS:
            real = CHAR_REPLACEMENTS[ch]
            if real == "\n":
                self._clear_sel(); self._ins("\n"); self._auto_indent()
            elif real == "\t":
                if self._sel_range() is not None: self._indent_selection()
                else: self._clear_sel(); self._ins("\t")
            else:
                self._clear_sel(); self._ins(real)
            return False
        if ch in BACKSPACE_CHARS:
            ignored = self._backspace_is_ignored()
            if not ignored: self._clear_sel(); self._del_before()
            return ignored
        if ch in DELETE_FWRD_CHARS:
            self._clear_sel(); self._del_at(); return False
        if ch == DELETE_LINE_CHAR:
            self._delete_line(); return False
        if ch == PAUSE_CHAR or ch in IGNORED_CHARS:
            return False
        self._clear_sel(); self._auto_dedent(ch); self._ins(ch)
        return False

    def handle_code_insert(self, code: str) -> None:
        self._clear_sel()
        ls = self._line_start()
        before = "".join(self._chars[ls: self._cur])
        self._ci_indent = re.match(r"^(\s*)", before).group(1)
        for kind, val in split_code_with_anchors(code):
            if kind == "text":
                for ch in val:
                    self.handle_char(ch)
                    ls2 = self._line_start()
                    bef2 = "".join(self._chars[ls2: self._cur])
                    self._ci_indent = re.match(r"^(\s*)", bef2).group(1)
            else:
                self.set_anchor(val)
        self._ci_indent = ""


_FILE_EXTS = frozenset((".js", ".css", ".html", ".htm"))


def _replay_headless_multi(events: list, track_timestamps: bool = False) -> dict:
    editors: dict = {"MAIN": HeadlessEditor(track_timestamps=track_timestamps)}
    active          = "MAIN"
    current_context = "main"

    for ev in events:
        if "move_to" in ev:
            t = ev["move_to"]
            if t in ("DEV", "dev"):
                current_context = "dev"
            elif t in ("MAIN", "main"):
                current_context = "main"
                active = "MAIN"
            elif any(t.lower().endswith(ext) for ext in _FILE_EXTS):
                current_context = "main"
                active = t
                if active not in editors:
                    editors[active] = HeadlessEditor(track_timestamps=track_timestamps)
            else:
                editors[active].move_to_anchor(t)
            continue
        if "switch_editor" in ev:
            val = ev["switch_editor"]
            if val in ("dev", "DEV"):
                current_context = "dev"
            else:
                current_context = "main"
                active = "MAIN"
            continue
        if "interaction" in ev:
            continue
        if current_context != "main":
            continue

        ed = editors[active]
        if track_timestamps:
            ed._cur_ts = ev.get("timestamp", 0)

        if "char" in ev:
            ed.handle_char(ev["char"])
        elif "anchor" in ev:
            ed.set_anchor(ev["anchor"])
        elif "move" in ev:
            ed.move_to_anchor(ev["move"])
        elif "jump_to" in ev:
            ed.move_to_anchor(ev["jump_to"])
        elif "code_insert" in ev:
            ed.handle_code_insert(ev["code_insert"])

    return editors


def _replay_headless(events: list, track_timestamps: bool = False) -> "HeadlessEditor":
    return _replay_headless_multi(events, track_timestamps)["MAIN"]


def reconstruct_html_headless(events: list) -> str:
    return _replay_headless(events).get_text()


def reconstruct_all_headless(events: list) -> dict:
    return {k: ed.get_text() for k, ed in _replay_headless_multi(events).items()}


def reconstruct_all_with_ghosts(events: list) -> dict:
    out: dict = {}
    for k, ed in _replay_headless_multi(events, track_timestamps=True).items():
        text, ranges = ed.get_text_with_ghosts()
        out[k] = {'text': text, 'ghosts': ranges}
    return out


def reconstruct_all_headless_at_timestamps(events: list, timestamps: list) -> dict:
    if not timestamps:
        return {}

    ts_sorted = sorted(set(timestamps))
    ts_idx = 0
    result: dict = {}

    editors: dict = {"MAIN": HeadlessEditor()}
    active          = "MAIN"
    current_context = "main"

    def _snapshot() -> dict:
        return {k: ed.get_text() for k, ed in editors.items()}

    for ev in sorted(events, key=lambda e: e.get("timestamp", 0)):
        ev_ts = ev.get("timestamp", 0)

        while ts_idx < len(ts_sorted) and ts_sorted[ts_idx] <= ev_ts:
            result[ts_sorted[ts_idx]] = _snapshot()
            ts_idx += 1
        if ts_idx >= len(ts_sorted):
            break  # all snapshots collected — no need to replay further

        if "move_to" in ev:
            t = ev["move_to"]
            if t in ("DEV", "dev"):
                current_context = "dev"
            elif t in ("MAIN", "main"):
                current_context = "main"
                active = "MAIN"
            elif any(t.lower().endswith(ext) for ext in _FILE_EXTS):
                current_context = "main"
                active = t
                if active not in editors:
                    editors[active] = HeadlessEditor()
            else:
                editors[active].move_to_anchor(t)
            continue
        if "switch_editor" in ev:
            val = ev["switch_editor"]
            current_context = "dev" if val in ("dev", "DEV") else "main"
            if current_context == "main":
                active = "MAIN"
            continue
        if "interaction" in ev or current_context != "main":
            continue

        ed = editors[active]
        if "char" in ev:
            ed.handle_char(ev["char"])
        elif "anchor" in ev:
            ed.set_anchor(ev["anchor"])
        elif "move" in ev:
            ed.move_to_anchor(ev["move"])
        elif "jump_to" in ev:
            ed.move_to_anchor(ev["jump_to"])
        elif "code_insert" in ev:
            ed.handle_code_insert(ev["code_insert"])

    if ts_idx < len(ts_sorted):
        snap = _snapshot()
        while ts_idx < len(ts_sorted):
            result[ts_sorted[ts_idx]] = snap
            ts_idx += 1

    return result


def replay_with_timestamps(events: list):
    ed = _replay_headless(events, track_timestamps=True)
    return ed.get_surviving_with_timestamps(), ed.get_deleted_with_timestamps()


def replay_with_timestamps_all(events: list):
    editors = _replay_headless_multi(events, track_timestamps=True)
    surviving: list = []
    for ed in editors.values():
        pairs = ed.get_surviving_with_timestamps()
        if surviving and pairs:
            surviving.append(('\n', 0))
        surviving.extend(pairs)
    all_deleted: list = []
    offset = 0
    for ed in editors.values():
        ed_deleted = ed.get_deleted_with_timestamps()
        all_deleted.extend((ch, ins_ts, del_ts, idx + offset) for ch, ins_ts, del_ts, idx in ed_deleted)
        offset += ed._next_idx
    deleted = sorted(all_deleted, key=lambda x: x[3])
    return surviving, deleted


def find_ignored_backspace_timestamps(events: list) -> set:
    ignored: set = set()
    ed: HeadlessEditor = HeadlessEditor()
    current_editor = "main"

    for ev in events:
        if "move_to" in ev:
            t = ev["move_to"]
            if   t == "DEV":  current_editor = "dev"
            elif t == "MAIN": current_editor = "main"
            else:             ed.move_to_anchor(t)
            continue
        if "switch_editor" in ev:
            current_editor = ev["switch_editor"]
            continue
        if "interaction" in ev:
            continue

        if "char" in ev:
            ch = ev["char"]
            if current_editor != "main" and ch != DELETE_LINE_CHAR:
                continue
            if ch in BACKSPACE_CHARS and ed._backspace_is_ignored():
                ignored.add(ev["timestamp"])
            ed.handle_char(ch)
        elif "anchor" in ev:
            ed.set_anchor(ev["anchor"])
        elif "move" in ev:
            ed.move_to_anchor(ev["move"])
        elif "jump_to" in ev:
            ed.move_to_anchor(ev["jump_to"])
        elif "code_insert" in ev:
            ed.handle_code_insert(ev["code_insert"])

    return ignored
