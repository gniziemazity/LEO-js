from __future__ import annotations

import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from .token_log_mixin import _embedded_lang_ranges_for


BURST_GAP_S = 30
MIN_BURST = 2

DELETE_LINE_CHAR = "⛔"
BACKSPACE_CHARS = frozenset({"↢", "⌫"})
DELETE_FWRD_CHARS = frozenset({"↣", "⌦"})
DELETE_CHARS = BACKSPACE_CHARS | DELETE_FWRD_CHARS | {DELETE_LINE_CHAR}

_TOKEN_RE = re.compile(r"[a-zA-Z0-9]+|[^\s]")

_LANG_EXT_TO_BUCKET = {
    ".html": "html", ".htm": "html",
    ".css":  "css",
    ".js":   "js",
    ".py":   "py",
}
_EMBEDDED_EXT_TO_BUCKET = {".js": "js", ".css": "css"}


def _annotate_editors(events):
    cur = "main"
    out = []
    for ev in events:
        e = dict(ev)
        if e.get("switch_editor"):
            cur = e["switch_editor"]
        elif e.get("move_to") == "DEV":
            cur = "dev"
        elif e.get("move_to") == "MAIN":
            cur = "main"
        e["_editor"] = cur
        out.append(e)
    return out


def _make_burst(evs):
    start_ts = evs[0]["timestamp"] / 1000
    end_ts = evs[-1]["timestamp"] / 1000
    dur = (end_ts - start_ts) or 1
    chars = sum(1 for e in evs if not e.get("_virtualType"))
    forward_text = "".join(
        e["char"] for e in evs
        if not e.get("_virtualType")
        and e.get("char") is not None
        and e["char"] not in DELETE_CHARS
    )
    tokens = len(_TOKEN_RE.findall(forward_text))
    return {
        "start_ts": start_ts,
        "end_ts":   end_ts,
        "dur":      dur,
        "chars":    chars,
        "tokens":   tokens,
        "evs":      evs,
    }


def _split_dev_main_bursts(raw_bursts):
    """Mirror JS: a burst with both dev-editor and non-dev-editor char
    events is split into two — first the dev chars alone, then the
    non-dev events (chars + virtual events) in timestamp order.
    """
    result = []
    for b in raw_bursts:
        evs = b["evs"]
        dev_chars = [e for e in evs
                     if not e.get("_virtualType")
                     and e.get("_editor") == "dev"]
        non_dev_chars = [e for e in evs
                         if not e.get("_virtualType")
                         and e.get("_editor") != "dev"]
        if dev_chars and non_dev_chars:
            result.append(_make_burst(dev_chars))
            non_dev_evs = sorted(
                (e for e in evs
                 if e.get("_virtualType") or e.get("_editor") != "dev"),
                key=lambda x: x["timestamp"],
            )
            result.append(_make_burst(non_dev_evs))
        else:
            result.append(b)
    return result


def _compute_bursts(typing_events):
    if not typing_events:
        return []
    bursts = []
    cur = [typing_events[0]]
    for i in range(1, len(typing_events)):
        gap = (typing_events[i]["timestamp"]
               - typing_events[i - 1]["timestamp"]) / 1000
        if gap < BURST_GAP_S:
            cur.append(typing_events[i])
        else:
            if len(cur) >= MIN_BURST:
                bursts.append(_make_burst(cur))
            cur = [typing_events[i]]
    if len(cur) >= MIN_BURST:
        bursts.append(_make_burst(cur))
    return bursts


def _compute_segments(bursts, session_start, session_end):
    segs = []
    cursor = session_start
    for b in bursts:
        if b["start_ts"] > cursor:
            segs.append(("p", b["start_ts"] - cursor, 0))
        segs.append(("t", b["dur"], b["tokens"]))
        cursor = b["end_ts"]
    if session_end > cursor:
        segs.append(("p", session_end - cursor, 0))
    return segs


def _format_segments(segs):
    return ";".join(f"{k}:{v:.2f}:{t}" for k, v, t in segs)


def _pause_stats(char_events):
    pauses = []
    for i in range(1, len(char_events)):
        gap = (char_events[i]["timestamp"]
               - char_events[i - 1]["timestamp"]) / 1000
        if gap >= BURST_GAP_S:
            pauses.append(gap)
    if not pauses:
        return {"count": 0, "min": 0.0, "max": 0.0, "avg": 0.0}
    return {
        "count": len(pauses),
        "min":   min(pauses),
        "max":   max(pauses),
        "avg":   sum(pauses) / len(pauses),
    }


def _count_tokens(text: str, file_ext: str) -> Dict[str, int]:
    out = {"total": 0, "html": 0, "css": 0, "js": 0, "py": 0}
    default = _LANG_EXT_TO_BUCKET.get(file_ext.lower())
    if default is None:
        return out
    if default == "html":
        ranges_by_ext = _embedded_lang_ranges_for(text, file_ext.lower())
        flat: List[Tuple[str, int, int]] = []
        for ext, ranges in (ranges_by_ext or {}).items():
            bucket = _EMBEDDED_EXT_TO_BUCKET.get(ext)
            if bucket is None:
                continue
            for lo, hi in ranges:
                flat.append((bucket, lo, hi))
        for m in _TOKEN_RE.finditer(text):
            pos = m.start()
            bucket = "html"
            for b, lo, hi in flat:
                if lo <= pos < hi:
                    bucket = b
                    break
            out[bucket] += 1
            out["total"] += 1
    else:
        n = sum(1 for _ in _TOKEN_RE.finditer(text))
        out[default] = n
        out["total"] = n
    return out


def _find_teacher_files(project_dir: Path) -> List[Tuple[Path, str]]:
    for sub in ("reconstructed", "correct"):
        d = project_dir / sub
        if not d.is_dir():
            continue
        result = []
        for f in sorted(d.iterdir()):
            if not f.is_file():
                continue
            ext = f.suffix.lower()
            if ext in _LANG_EXT_TO_BUCKET:
                result.append((f, ext))
        if result:
            return result
    return []


def _count_teacher_tokens(project_dir: Path) -> Dict[str, int]:
    out = {"total": 0, "html": 0, "css": 0, "js": 0, "py": 0}
    for f, ext in _find_teacher_files(project_dir):
        try:
            text = f.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        t = _count_tokens(text, ext)
        for k in out:
            out[k] += t[k]
    return out


def compute_lesson_stats_csv(
    events: List[dict],
    project_dir: Path,
) -> Optional[str]:
    if not events:
        return None
    evs = _annotate_editors(events)

    char_events = [e for e in evs if e.get("char") is not None]
    main_chars = [
        e for e in char_events
        if e["_editor"] != "dev" and e["char"] not in DELETE_CHARS
    ]
    dev_chars = [e for e in char_events if e["_editor"] == "dev"]
    deletes   = [e for e in char_events if e["char"] in DELETE_CHARS]

    code_inserts = [e for e in evs if e.get("code_insert") is not None]
    anchors = [e for e in evs if e.get("anchor") is not None]
    moves = [
        e for e in evs
        if (e.get("move_to") and e["move_to"] not in ("DEV", "MAIN"))
        or e.get("move") or e.get("jump_to")
    ]

    typing_events: List[dict] = []
    for e in char_events:
        ev = dict(e); ev["_virtualType"] = None
        typing_events.append(ev)
    for e in anchors:
        ev = dict(e); ev["_virtualType"] = "anchor"
        typing_events.append(ev)
    for e in moves:
        ev = dict(e); ev["_virtualType"] = "move"
        typing_events.append(ev)
    for e in code_inserts:
        ev = dict(e); ev["_virtualType"] = "code_insert"
        typing_events.append(ev)
    typing_events.sort(key=lambda x: x["timestamp"])

    raw_bursts = _compute_bursts(typing_events)
    split_bursts = _split_dev_main_bursts(raw_bursts)

    session_start = evs[0]["timestamp"] / 1000
    session_end   = evs[-1]["timestamp"] / 1000
    segments      = _compute_segments(split_bursts, session_start, session_end)
    duration_s    = max(0.0, session_end - session_start)
    duration_min  = duration_s / 60

    all_chars_count = len(char_events)
    kpm_session = (all_chars_count / (duration_s / 60)) if duration_s > 0 else 0.0
    total_c = sum(b["chars"] for b in raw_bursts)
    total_s = sum(b["dur"] or 1 for b in raw_bursts)
    kpm_active = (total_c / total_s) * 60 if total_c > 0 else 0.0

    pause = _pause_stats(main_chars)

    interactions = {
        "teacher-question": 0,
        "student-question": 0,
        "providing-help":   0,
    }
    teacher_q_unanswered = 0
    for e in evs:
        i = e.get("interaction")
        if i in interactions:
            interactions[i] += 1
        if i == "teacher-question":
            ans = e.get("answered_by")
            if not ans:
                teacher_q_unanswered += 1

    tokens = _count_teacher_tokens(project_dir)

    n_chars   = len(main_chars)
    n_moves   = len(moves)
    n_anchors = len(anchors)
    n_jumps   = n_moves + n_anchors
    jumps_per_100c = (n_jumps / n_chars * 100) if n_chars > 0 else 0.0

    cols = [
        ("duration_min",   f"{duration_min:.2f}"),
        ("events",         str(len(evs))),
        ("chars",          str(n_chars)),
        ("dev_chars",      str(len(dev_chars))),
        ("code_inserts",   str(len(code_inserts))),
        ("deletes",        str(len(deletes))),
        ("move_to",        str(n_moves)),
        ("anchors",        str(n_anchors)),
        ("jumps",          str(n_jumps)),
        ("jumps_per_100c", f"{jumps_per_100c:.2f}"),
        ("kpm_active",     f"{kpm_active:.1f}"),
        ("kpm_session",    f"{kpm_session:.1f}"),
        ("bursts",         str(len(split_bursts))),
        ("pause_count",    str(pause["count"])),
        ("pause_min_s",    f"{pause['min']:.2f}"),
        ("pause_max_s",    f"{pause['max']:.2f}"),
        ("pause_avg_s",    f"{pause['avg']:.2f}"),
        ("teacher_q",      str(interactions["teacher-question"])),
        ("teacher_q_unanswered", str(teacher_q_unanswered)),
        ("student_q",      str(interactions["student-question"])),
        ("help",           str(interactions["providing-help"])),
        ("tokens",         str(tokens["total"])),
        ("tokens_html",    str(tokens["html"])),
        ("tokens_css",     str(tokens["css"])),
        ("tokens_js",      str(tokens["js"])),
        ("tokens_py",      str(tokens["py"])),
        ("segments",       _format_segments(segments)),
    ]
    header = ",".join(c[0] for c in cols)
    row    = ",".join(c[1] for c in cols)
    return header + "\n" + row + "\n"


def write_lesson_stats_csv(
    events: List[dict],
    project_dir: Path,
    out_name: str = "lesson_stats_py.csv",
) -> Optional[Path]:
    csv = compute_lesson_stats_csv(events, project_dir)
    if csv is None:
        return None
    out_path = project_dir / out_name
    out_path.write_text(csv, encoding="utf-8")
    return out_path
