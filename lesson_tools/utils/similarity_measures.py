import csv
import difflib
import io
import re
import zipfile
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Set, Tuple

from .lv_editor import (
    reconstruct_html_headless, reconstruct_all_headless,
    replay_with_timestamps, replay_with_timestamps_all,
)

_ALL_EXTRA_STAR: bool = True

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

_TOKEN_RE = re.compile(r'[_a-zA-Z][a-zA-Z0-9_]*|[0-9]+(?:\.[0-9]+)?[a-zA-Z%]*')
_HTML_TAG_RE = re.compile(r'</?[a-zA-Z][a-zA-Z0-9]*')

_CSS_TOKEN_RE = re.compile(r'[_a-zA-Z][a-zA-Z0-9_]*(?:-[_a-zA-Z][a-zA-Z0-9_]*)*|[0-9]+(?:\.[0-9]+)?[a-zA-Z%]*')

_COMMENT_RE = re.compile(
    r'/\*.*?\*/|/\*.*\Z|<!--.*?-->|<!--.*\Z|(?<!:)//[^\n]*',
    re.DOTALL,
)

_COMMENT_RE_HTML = re.compile(
    r'/\*.*?\*/|/\*.*\Z|<!--.*?-->|<!--.*\Z',
    re.DOTALL,
)

_SCRIPT_TAG_RE = re.compile(r'<script\b[^>]*>(.*?)</script>', re.DOTALL | re.IGNORECASE)

_UNCLOSED_SCRIPT_RE = re.compile(r'<script\b[^>]*>(.*?)\Z', re.DOTALL | re.IGNORECASE)

_UNCLOSED_IN_STRIPPED_RE = re.compile(
    r'<script\b[^>]*>(?!.*?</script>)',
    re.DOTALL | re.IGNORECASE,
)


def _strip_script_bodies(html: str) -> str:
    result: List[str] = []
    last = 0
    for m in _SCRIPT_TAG_RE.finditer(html):
        result.append(html[last : m.start(1)])
        result.append(' ')
        last = m.end(1)
    result.append(html[last:])
    return ''.join(result)

def extract_tokens(lines: List[str]) -> Counter:
    text = ' '.join(lines)
    return Counter(t for t in _TOKEN_RE.findall(text) if len(t) >= 1)

def split_code_tokens(text: str) -> Tuple[Counter, Counter]:
    outside_text = _COMMENT_RE.sub(' ', text)
    inside_text  = ' '.join(m.group() for m in _COMMENT_RE.finditer(text))
    outside = Counter(t for t in _TOKEN_RE.findall(outside_text) if len(t) >= 1)
    inside  = Counter(t for t in _TOKEN_RE.findall(inside_text)  if len(t) >= 1)
    return outside, inside

def _extract_css_tokens(text: str, css_only_regions: List[Tuple[int, int]] = None, initial_covered: set = None) -> Counter:
    covered: set = set(initial_covered) if initial_covered else set()
    result: Counter = Counter()
    for m in _CSS_HEX_COLOR_RE.finditer(text):
        result[m.group()] += 1
        for i in range(m.start(), m.end()):
            covered.add(i)
    for m in _CSS_HASH_TOKEN_RE.finditer(text):
        if m.start() not in covered:
            result[m.group()] += 1
            for i in range(m.start(), m.end()):
                covered.add(i)
    if css_only_regions is None:
        for m in _CSS_DOT_TOKEN_RE.finditer(text):
            if m.start() not in covered:
                result[m.group()] += 1
                for i in range(m.start(), m.end()):
                    covered.add(i)
    else:
        for r_start, r_end in css_only_regions:
            segment = text[r_start:r_end]
            for m in _CSS_DOT_TOKEN_RE.finditer(segment):
                abs_start = r_start + m.start()
                if abs_start not in covered:
                    result[m.group()] += 1
                    for i in range(abs_start, r_start + m.end()):
                        covered.add(i)
    for m in _CSS_NEG_VALUE_RE.finditer(text):
        if m.start() not in covered:
            result[m.group()] += 1
            for i in range(m.start(), m.end()):
                covered.add(i)
    for m in _CSS_TOKEN_RE.finditer(text):
        if m.start() not in covered:
            result[m.group()] += 1
    return result

def split_css_tokens(text: str) -> Tuple[Counter, Counter]:
    outside_text = _COMMENT_RE.sub(' ', text)
    inside_text  = ' '.join(m.group() for m in _COMMENT_RE.finditer(text))
    return _extract_css_tokens(outside_text), _extract_css_tokens(inside_text)

def split_html_tokens(text: str) -> Tuple[Counter, Counter, Counter]:
    script_bodies = [m.group(1) for m in _SCRIPT_TAG_RE.finditer(text)]
    html_body = _strip_script_bodies(text)
    html_body_fully_stripped = _SCRIPT_TAG_RE.sub(' ', text)
    m_unclosed = _UNCLOSED_SCRIPT_RE.search(html_body_fully_stripped)
    if m_unclosed:
        script_bodies.append(m_unclosed.group(1))
        m_unc_body = _UNCLOSED_IN_STRIPPED_RE.search(html_body)
        if m_unc_body:
            html_body = html_body[:m_unc_body.start()]

    event_handler_bodies = _extract_event_handler_bodies(html_body)
    html_body_no_events  = _strip_event_handler_values(html_body)

    html_comments_text = ' '.join(m.group() for m in _COMMENT_RE_HTML.finditer(html_body_no_events))
    html_outside_text  = _COMMENT_RE_HTML.sub(' ', html_body_no_events)

    script_outside_parts: List[str] = []
    script_comment_parts: List[str] = []
    for body in script_bodies:
        script_outside_parts.append(_COMMENT_RE.sub(' ', body))
        script_comment_parts.append(
            ' '.join(m.group() for m in _COMMENT_RE.finditer(body))
        )
    for body in event_handler_bodies:
        script_outside_parts.append(_COMMENT_RE.sub(' ', body))

    html_outside: Counter = Counter()
    covered: set = set()
    for m in _HTML_TAG_RE.finditer(html_outside_text):
        html_outside[m.group()] += 1
        covered.update(range(m.start(), m.end()))
    for m in _TOKEN_RE.finditer(html_outside_text):
        if m.start() not in covered and len(m.group()) >= 1:
            html_outside[m.group()] += 1
    n_unclosed = 1 if m_unclosed else 0
    if n_unclosed:
        html_outside['<script'] = html_outside.get('<script', 0) + n_unclosed
    script_outside = Counter(t for t in _TOKEN_RE.findall(' '.join(script_outside_parts)) if len(t) >= 1)
    inside_all     = Counter(t for t in _TOKEN_RE.findall(
        html_comments_text + ' ' + ' '.join(script_comment_parts)) if len(t) >= 1)

    return html_outside, script_outside, inside_all

def get_html_outside_css(text: str) -> Counter:
    n_complete = len(list(_SCRIPT_TAG_RE.finditer(text)))
    html_body = _strip_script_bodies(text)
    m_unclosed = _UNCLOSED_SCRIPT_RE.search(_SCRIPT_TAG_RE.sub(' ', text))
    if m_unclosed:
        m_unc_body = _UNCLOSED_IN_STRIPPED_RE.search(html_body)
        if m_unc_body:
            html_body = html_body[:m_unc_body.start()]
    html_outside_text = _COMMENT_RE_HTML.sub(' ', _strip_event_handler_values(html_body))
    style_regions = [(m.start(1), m.end(1))
                     for m in _STYLE_TAG_CONTENT_RE.finditer(html_outside_text)]
    html_tag_covered: set = set()
    html_tag_counter: Counter = Counter()
    for m in _HTML_TAG_RE.finditer(html_outside_text):
        html_tag_counter[m.group()] += 1
        html_tag_covered.update(range(m.start(), m.end()))
    result = _extract_css_tokens(html_outside_text, css_only_regions=style_regions, initial_covered=html_tag_covered)
    result.update(html_tag_counter)
    if m_unclosed:
        result['<script'] = result.get('<script', 0) + 1
    return result


_CSS_HYPHEN_RE = re.compile(r'[_a-zA-Z][a-zA-Z0-9_]*(?:-[_a-zA-Z][a-zA-Z0-9_]*)+')
_CSS_HEX_COLOR_RE = re.compile(r'#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])')
_CSS_HASH_TOKEN_RE = re.compile(r'#[_a-zA-Z][a-zA-Z0-9_-]*')
_CSS_DOT_TOKEN_RE = re.compile(r'(?<![0-9])\.[_a-zA-Z][a-zA-Z0-9_-]*')
_CSS_NEG_VALUE_RE = re.compile(r'-[0-9]+[a-zA-Z%]+')

_STYLE_TAG_CONTENT_RE = re.compile(r'<style\b[^>]*>(.*?)</style>', re.DOTALL | re.IGNORECASE)
_ID_ATTR_RE     = re.compile(r'\bid\s*=\s*["\']([^"\']+)["\']',    re.IGNORECASE)
_CLASS_ATTR_RE  = re.compile(r'\bclass\s*=\s*["\']([^"\']+)["\']', re.IGNORECASE)
_CSS_ID_SEL_RE  = re.compile(r'#([_a-zA-Z][a-zA-Z0-9_-]*)')
_CSS_CLASS_SEL_RE = re.compile(r'\.([_a-zA-Z][a-zA-Z0-9_-]*)')

_EVENT_HANDLER_RE = re.compile(
    r'''\bon\w+\s*=\s*(?:"([^"]*)"|'([^']*)')''',
    re.IGNORECASE,
)


def _extract_event_handler_bodies(html: str) -> List[str]:
    bodies = []
    for m in _EVENT_HANDLER_RE.finditer(html):
        body = m.group(1) if m.group(1) is not None else m.group(2)
        if body:
            bodies.append(body)
    return bodies


def _strip_event_handler_values(html: str) -> str:
    def _repl(m: re.Match) -> str:
        body = m.group(1) if m.group(1) is not None else m.group(2)
        return m.group(0).replace(body, '', 1) if body else m.group(0)
    return _EVENT_HANDLER_RE.sub(_repl, html)


def extract_user_identifiers(text: str, ext: str) -> set:
    result: set = set()
    css_text = ''

    if ext == '.html':
        for m in _STYLE_TAG_CONTENT_RE.finditer(text):
            css_text += m.group(1) + '\n'
        for m in _ID_ATTR_RE.finditer(text):
            for part in m.group(1).split():
                p = part.strip()
                if p:
                    result.add(p)
        for m in _CLASS_ATTR_RE.finditer(text):
            for part in m.group(1).split():
                p = part.strip()
                if p:
                    result.add(p)
    elif ext == '.css':
        css_text = text

    for m in _CSS_ID_SEL_RE.finditer(css_text):
        ident = m.group(1).strip()
        if ident:
            result.add(ident)
    for m in _CSS_CLASS_SEL_RE.finditer(css_text):
        ident = m.group(1).strip()
        if ident:
            result.add(ident)

    return result


def tokenise_follow_style(text: str) -> Counter:
    result: Counter = Counter()
    covered: set = set()
    for m in _HTML_TAG_RE.finditer(text):
        result[m.group()] += 1
        covered.update(range(m.start(), m.end()))
    for m in _CSS_HYPHEN_RE.finditer(text):
        if m.start() not in covered:
            result[m.group()] += 1
            covered.update(range(m.start(), m.end()))
    for m in _TOKEN_RE.finditer(text):
        if m.start() not in covered:
            result[m.group()] += 1
    return result


def split_follow_tokens_html(html: str) -> Tuple[Counter, Counter]:
    script_bodies: List[str] = [m.group(1) for m in _SCRIPT_TAG_RE.finditer(html)]
    html_body = _strip_script_bodies(html)
    m_unclosed = _UNCLOSED_SCRIPT_RE.search(_SCRIPT_TAG_RE.sub(' ', html))
    if m_unclosed:
        script_bodies.append(m_unclosed.group(1))
        m_unc_body = _UNCLOSED_IN_STRIPPED_RE.search(html_body)
        if m_unc_body:
            html_body = html_body[:m_unc_body.start()]

    event_handler_bodies = _extract_event_handler_bodies(html_body)
    html_body_no_events  = _strip_event_handler_values(html_body)

    html_comments_text = ' '.join(m.group() for m in _COMMENT_RE_HTML.finditer(html_body_no_events))
    html_outside_text  = _COMMENT_RE_HTML.sub(' ', html_body_no_events)

    script_outside_parts: List[str] = []
    script_comment_parts: List[str] = []
    for body in script_bodies + event_handler_bodies:
        script_outside_parts.append(_COMMENT_RE.sub(' ', body))
        script_comment_parts.append(' '.join(m.group() for m in _COMMENT_RE.finditer(body)))

    outside = tokenise_follow_style(html_outside_text + ' ' + ' '.join(script_outside_parts))
    inside  = tokenise_follow_style(html_comments_text + ' ' + ' '.join(script_comment_parts))

    n_complete = len(list(_SCRIPT_TAG_RE.finditer(html)))
    n_script   = n_complete * 2 + (1 if m_unclosed else 0)
    if n_script:
        outside['script'] = outside.get('script', 0) + n_script

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
    return _reconstruct_tokens_core(events, has_css)


_FILE_EXTS_SIM = ('.js', '.css', '.html', '.htm')


def _build_file_timeline_from_events(events: List[dict]) -> List[Tuple[int, str]]:
    result: List[Tuple[int, str]] = [(0, 'MAIN')]
    for ev in events:
        ts = ev.get('timestamp', 0)
        if 'move_to' in ev:
            t = ev['move_to']
            if t in ('DEV', 'dev'):
                pass
            elif t in ('MAIN', 'main'):
                result.append((ts, 'MAIN'))
            elif any(t.lower().endswith(ext) for ext in _FILE_EXTS_SIM):
                result.append((ts, t))
        elif 'switch_editor' in ev and ev['switch_editor'] not in ('dev', 'DEV'):
            result.append((ts, 'MAIN'))
    return sorted(result)


def _file_at_ts_bisect(ts: int, timeline: List[Tuple[int, str]]) -> str:
    lo, hi = 0, len(timeline) - 1
    idx = 0
    while lo <= hi:
        mid = (lo + hi) // 2
        if timeline[mid][0] <= ts:
            idx = mid
            lo = mid + 1
        else:
            hi = mid - 1
    return timeline[idx][1]


def _extract_matches_with_priority(
    text: str,
    has_css: bool,
    css_only_regions: List[Tuple[int, int]],
) -> List[Tuple[int, str, bool]]:
    covered: set = set()
    matches: List[Tuple[int, str, bool]] = []

    def _add(start: int, tok: str, cs_override: bool) -> None:
        for i in range(start, start + len(tok)):
            covered.add(i)
        matches.append((start, tok, cs_override))

    for m in _HTML_TAG_RE.finditer(text):
        if m.start() not in covered:
            _add(m.start(), m.group(), False)

    if has_css:
        for m in _CSS_HEX_COLOR_RE.finditer(text):
            if m.start() not in covered:
                _add(m.start(), m.group(), True)

        for m in _CSS_HASH_TOKEN_RE.finditer(text):
            if m.start() not in covered:
                _add(m.start(), m.group(), True)

        for cs_start, cs_end in css_only_regions:
            segment = text[cs_start:cs_end]
            for m in _CSS_DOT_TOKEN_RE.finditer(segment):
                abs_start = cs_start + m.start()
                if abs_start not in covered:
                    _add(abs_start, m.group(), True)

        for m in _CSS_NEG_VALUE_RE.finditer(text):
            if m.start() not in covered:
                _add(m.start(), m.group(), False)

        for m in _CSS_HYPHEN_RE.finditer(text):
            if m.start() not in covered:
                _add(m.start(), m.group(), False)

    for m in _TOKEN_RE.finditer(text):
        if m.start() not in covered:
            _add(m.start(), m.group(), False)

    return matches


def _reconstruct_tokens_core(
    events: List[dict],
    has_css: bool = True,
) -> Tuple[
    Dict[str, List[int]],
    Dict[str, List[int]],
    Dict[str, List[int]],
    Dict[str, List[int]],
    Dict[str, str],
    Dict[str, List[Tuple[int, str]]],
]:
    surviving, deleted = replay_with_timestamps_all(events)
    if not surviving and not deleted:
        return {}, {}, {}, {}, {}, {}

    final_text = ''.join(c for c, _ in surviving)
    char_ts_final: List[int] = [e[1] for e in surviving]
    n = len(final_text)

    comment_mask_final: List[bool] = [False] * n
    for cm in _COMMENT_RE_HTML.finditer(final_text):
        for i in range(cm.start(), min(cm.end(), n)):
            comment_mask_final[i] = True
    for sm in _SCRIPT_TAG_RE.finditer(final_text):
        body_start = sm.start(1)
        for cm in _COMMENT_RE.finditer(sm.group(1)):
            for i in range(body_start + cm.start(),
                           min(body_start + cm.end(), n)):
                comment_mask_final[i] = True
    _complete_script_starts = {m.start() for m in _SCRIPT_TAG_RE.finditer(final_text)}
    m_unc = _UNCLOSED_SCRIPT_RE.search(final_text)
    if m_unc and m_unc.start() not in _complete_script_starts:
        body_start = m_unc.start(1)
        for cm in _COMMENT_RE.finditer(m_unc.group(1)):
            for i in range(body_start + cm.start(),
                           min(body_start + cm.end(), n)):
                comment_mask_final[i] = True
    timeline = _build_file_timeline_from_events(events)
    char_file: List[str] = [_file_at_ts_bisect(ts, timeline) for ts in char_ts_final]
    css_file_regions: List[Tuple[int, int]] = []
    if has_css:
        i = 0
        while i < n:
            fk = char_file[i]
            if isinstance(fk, str) and fk.lower().endswith('.css'):
                j = i
                while j < n and char_file[j] == fk:
                    j += 1
                css_file_regions.append((i, j))
                i = j
            else:
                i += 1
        for cs, ce in css_file_regions:
            seg = final_text[cs:ce]
            for cm in re.finditer(r'/\*.*?\*/|/\*.*\Z', seg, re.DOTALL):
                for k in range(cs + cm.start(), min(cs + cm.end(), n)):
                    comment_mask_final[k] = True
    js_file_regions: List[Tuple[int, int]] = []
    i = 0
    while i < n:
        fk = char_file[i]
        if isinstance(fk, str) and fk.lower().endswith('.js'):
            j = i
            while j < n and char_file[j] == fk:
                j += 1
            js_file_regions.append((i, j))
            i = j
        else:
            i += 1
    for js, je in js_file_regions:
        seg = final_text[js:je]
        for cm in _COMMENT_RE.finditer(seg):
            for k in range(js + cm.start(), min(js + cm.end(), n)):
                comment_mask_final[k] = True

    css_only_regions: List[Tuple[int, int]] = []
    for m in _STYLE_TAG_CONTENT_RE.finditer(final_text):
        css_only_regions.append((m.start(1), m.end(1)))
    css_only_regions.extend(css_file_regions)

    kw_ts: Dict[str, List[int]] = {}
    kw_ts_comment: Dict[str, List[int]] = {}
    upper_to_display: Dict[str, str] = {}
    occ_with_display: Dict[str, List[Tuple[int, str]]] = {}

    f_matches = _extract_matches_with_priority(final_text, has_css, css_only_regions)

    for f_start, tok, is_cs_override in f_matches:
        f_end = f_start + len(tok) - 1
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
            d_matches = _extract_matches_with_priority(seg_text, has_css, [])
            for s_rel, tok, is_cs_override in d_matches:
                end_rel = s_rel + len(tok) - 1
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


def get_reconstructed_files(events: List[dict]) -> dict:
    return reconstruct_all_headless(events)


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
