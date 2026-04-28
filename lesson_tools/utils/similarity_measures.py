import csv
from bisect import bisect_right
import difflib
import io
import re
import zipfile
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Set, Tuple

from .lv_editor import reconstruct_all_headless, replay_with_timestamps_all

_CHAR_TOKEN_RE = re.compile(r'[a-zA-Z0-9]+|[^\s]')

def normalize_code(code: str) -> List[str]:
    return [line.strip() for line in code.split('\n') if line.strip()]

def calculate_ide_diff_sim(lines1: List[str], lines2: List[str]) -> float:
    return difflib.SequenceMatcher(None, lines1, lines2).ratio()

def calculate_char_histogram_similarity(lines1: List[str], lines2: List[str]) -> float:
    text1 = ''.join(lines1).replace(' ', '')
    text2 = ''.join(lines2).replace(' ', '')
    freq1, freq2 = Counter(text1), Counter(text2)
    total1, total2 = len(text1), len(text2)
    if total1 == 0 and total2 == 0:
        return 1.0
    if total1 == 0 or total2 == 0:
        return 0.0
    all_chars = set(freq1.keys()) | set(freq2.keys())
    total_diff = sum(abs(freq1.get(c, 0) - freq2.get(c, 0)) for c in all_chars)
    return 1.0 - total_diff / (total1 + total2)

_COMMENT_RE = re.compile(
    r'/\*.*?\*/|/\*.*\Z|<!--.*?-->|<!--.*\Z|(?<!:)//[^\n]*',
    re.DOTALL,
)


def _comment_ranges(text: str) -> Tuple[List[int], List[int]]:
    starts: List[int] = []
    ends: List[int] = []
    for match in _COMMENT_RE.finditer(text):
        starts.append(match.start())
        ends.append(match.end())
    return starts, ends


def _pos_in_comment(pos: int, starts: List[int], ends: List[int]) -> bool:
    idx = bisect_right(starts, pos) - 1
    return idx >= 0 and ends[idx] > pos


def iter_code_tokens(text: str):
    starts, ends = _comment_ranges(text)
    for match in _CHAR_TOKEN_RE.finditer(text):
        pos = match.start()
        yield pos, match.group(), _pos_in_comment(pos, starts, ends)


def extract_tokens(lines: List[str]) -> Counter:
    text = ' '.join(lines)
    return Counter(tok for _, tok, _ in iter_code_tokens(text))

def split_code_tokens(text: str) -> Tuple[Counter, Counter]:
    outside: Counter = Counter()
    inside: Counter = Counter()
    for _, tok, is_comment in iter_code_tokens(text):
        if is_comment:
            inside[tok] += 1
        else:
            outside[tok] += 1
    return outside, inside


def reconstruct_tokens_from_keylog_full(
    events: List[dict],
    has_css: bool = True,
) -> Tuple[
    Dict[str, List[int]],
    Dict[str, List[int]],
    Dict[str, List[Tuple[int, int]]],
    Dict[str, str],
    Dict[str, List[Tuple[int, str]]],
]:
    surviving, deleted = replay_with_timestamps_all(events)
    if not surviving and not deleted:
        return {}, {}, {}, {}, {}

    final_text = ''.join(c for c, _ in surviving)
    char_ts_final: List[int] = [e[1] for e in surviving]
    n = len(final_text)

    comment_mask_final: List[bool] = [False] * n
    for cm in _COMMENT_RE.finditer(final_text):
        for i in range(cm.start(), min(cm.end(), n)):
            comment_mask_final[i] = True

    kw_ts: Dict[str, List[int]] = {}
    kw_ts_comment: Dict[str, List[int]] = {}
    upper_to_display: Dict[str, str] = {}
    occ_with_display: Dict[str, List[Tuple[int, str]]] = {}

    for m in _CHAR_TOKEN_RE.finditer(final_text):
        tok = m.group()
        f_end = m.end() - 1
        ts = char_ts_final[f_end]
        is_comment = bool(comment_mask_final[f_end])
        kw_ts.setdefault(tok, []).append(ts)
        if tok not in upper_to_display:
            upper_to_display[tok] = tok
        occ_with_display.setdefault(tok, []).append((ts, tok))
        if is_comment:
            kw_ts_comment.setdefault(tok, []).append(ts)

    removed_kw_ts: Dict[str, List[Tuple[int, int]]] = {}
    removed_upper_to_display: Dict[str, str] = {}

    if deleted:
        ordered = sorted(deleted, key=lambda x: x[3])

        seg_chars: List[Tuple[str, int, int]] = []

        def _flush_seg() -> None:
            if not seg_chars:
                return
            seg_text = ''.join(c for c, _, _ in seg_chars)
            for m in _CHAR_TOKEN_RE.finditer(seg_text):
                tok = m.group()
                end_rel = m.end() - 1
                ins_ts = seg_chars[end_rel][1]
                del_ts = seg_chars[end_rel][2]
                removed_kw_ts.setdefault(tok, []).append((ins_ts, del_ts))
                if tok not in removed_upper_to_display:
                    removed_upper_to_display[tok] = tok
            seg_chars.clear()

        for ch, ins_ts, del_ts, _ in ordered:
            if ch in ('\n', '\r'):
                _flush_seg()
            else:
                seg_chars.append((ch, ins_ts, del_ts))
        _flush_seg()

    for upper, display in removed_upper_to_display.items():
        if upper not in upper_to_display:
            upper_to_display[upper] = display

    return kw_ts, kw_ts_comment, removed_kw_ts, upper_to_display, occ_with_display


def calculate_containment(a: Counter, b: Counter) -> float:
    if not a:
        return 0.0
    return round(sum((a & b).values()) / sum(a.values()) * 100, 1)

def ts_to_local(ts_ms: int) -> str:
    return datetime.fromtimestamp(ts_ms / 1000).strftime('%H:%M:%S')


_SIZEWITHCELLS_RE = re.compile(r'<[^>]*:SizeWithCells\s*/>|<SizeWithCells\s*/>')


def save_xlsx(wb, path: str, vml_source: str = None) -> None:
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    out = io.BytesIO()

    vml_from_source: dict = {}
    if vml_source:
        with zipfile.ZipFile(vml_source, 'r') as zsrc:
            for name in zsrc.namelist():
                if name.endswith('.vml'):
                    vml_from_source[name] = zsrc.read(name)

    with zipfile.ZipFile(buf, 'r') as zin, \
         zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename.endswith('.vml'):
                if item.filename in vml_from_source:
                    data = vml_from_source[item.filename]
                else:
                    data = _SIZEWITHCELLS_RE.sub('', data.decode('utf-8')).encode('utf-8')
            zout.writestr(item, data)
    Path(path).write_bytes(out.getvalue())


_CSV_ENCODINGS = ('utf-8-sig', 'utf-8', 'latin-1', 'cp1252')


def open_csv_encoded(path, row_fn, delimiter: str = ';',
                     reset_fn=None) -> bool:
    for enc in _CSV_ENCODINGS:
        try:
            with open(path, 'r', encoding=enc) as fh:
                for row in csv.DictReader(fh, delimiter=delimiter):
                    row_fn(row)
            return True
        except (UnicodeDecodeError, UnicodeError):
            if reset_fn:
                reset_fn()
    return False
