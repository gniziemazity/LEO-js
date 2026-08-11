from pathlib import Path
from typing import Dict, List, Optional, Tuple

import sys as _sys
_sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from .token_log import _read_text_normalized, _split_tokens_by_comment, _ttt_pos_index
from .similarity_measures import token_edit_similarity


_LANG_EXT_LABEL = (('.html', 'HTML'), ('.css', 'CSS'), ('.js', 'JS'), ('.py', 'Py'))
_EMBEDDED_LANG_TO_EXT = {'javascript': '.js', 'css': '.css'}


def _ext_of(fname: str) -> Optional[str]:
    s = (fname or '').lower()
    for ext, _ in _LANG_EXT_LABEL:
        if s.endswith(ext):
            return ext
    return None


def _embedded_lang_ranges_for(text: str, file_ext: Optional[str]) -> Dict[str, List[Tuple[int, int]]]:
    if not file_ext or file_ext.lower() not in ('.html', '.htm'):
        return {}
    from languages import get_profile
    from languages import _embedded_tag_ranges
    profile = get_profile(file_ext)
    if profile is None or not profile.get('embeddedTags'):
        return {}
    by_tag = _embedded_tag_ranges(text, profile)
    out: Dict[str, List[Tuple[int, int]]] = {}
    for entry in profile.get('embeddedTags', []) or []:
        ext = _EMBEDDED_LANG_TO_EXT.get(entry.get('language', ''))
        if ext is None:
            continue
        ranges = by_tag.get(entry['tag'], [])
        if ranges:
            out.setdefault(ext, []).extend(ranges)
    return out


def _effective_ext_at(pos: int, file_ext: str, ranges_by_ext: Dict[str, List[Tuple[int, int]]]) -> str:
    for ext, ranges in (ranges_by_ext or {}).items():
        for lo, hi in ranges:
            if lo <= pos < hi:
                return ext
    return file_ext


def _per_language_follow_stats(
    diff_marks: dict,
    teacher_files: Dict[str, Path],
    student_files: Optional[Dict[str, Path]] = None,
    teacher_ghosts: Optional[dict] = None,
    removal_ts_by_token: Optional[Dict[str, List[str]]] = None,
    teacher_entries: Optional[list] = None,
    teacher_token_timestamps: Optional[Dict[str, list]] = None,
) -> Dict[str, dict]:
    student_files = student_files or {}

    ghost_ts_by_pair: dict = {}
    if teacher_ghosts:
        from .token_log_marks import build_ghost_ts_by_pair
        ghost_ts_by_pair = build_ghost_ts_by_pair(teacher_ghosts)

    ghost_blobs_sorted: Dict[str, list] = {}
    if teacher_ghosts:
        for fname, blobs in teacher_ghosts.items():
            ghost_blobs_sorted[fname] = sorted(
                (b for b in (blobs or []) if b.get('pos') is not None),
                key=lambda b: b.get('pos') or 0,
            )

    def _ghost_final_pos(paired_with: dict) -> Optional[Tuple[str, int]]:
        if not paired_with or not paired_with.get('ghost'):
            return None
        fname = paired_with.get('file')
        pos = paired_with.get('start')
        if fname is None or not isinstance(pos, int):
            return None
        for blob in ghost_blobs_sorted.get(fname) or []:
            bp = blob.get('pos')
            bp_end = bp + len(blob.get('text') or '')
            if bp <= pos < bp_end:
                return (fname, bp)
        return None

    missing_ts_pool: Dict[str, List[str]] = {}
    for entry in teacher_entries or []:
        tok = entry[0] if len(entry) > 0 else ''
        ts = entry[1] if len(entry) > 1 else ''
        is_cm = entry[2] if len(entry) > 2 else False
        is_rem = entry[3] if len(entry) > 3 else False
        if is_cm or is_rem:
            continue
        missing_ts_pool.setdefault(tok, []).append(ts)

    ttt_by_pos = _ttt_pos_index(teacher_token_timestamps)

    def _resolve_missing_ts(mark: dict, fname: str) -> str:
        ts = mark.get('timestamp')
        if ts:
            return ts
        s = mark.get('start')
        e = mark.get('end')
        if isinstance(s, int) and isinstance(e, int):
            pos_ts = ttt_by_pos.get((fname, s, e))
            if pos_ts:
                return pos_ts
        tok = mark.get('token', '')
        pool = missing_ts_pool.get(tok)
        if pool:
            return pool.pop(0)
        return '00:00:00'

    removal_pool: Dict[str, List[str]] = {
        tok: list(lst) for tok, lst in (removal_ts_by_token or {}).items()
    }

    def _resolve_ghost_ts(mark: dict) -> str:
        pw = mark.get('paired_with') or {}
        if pw.get('ghost'):
            key = (pw.get('file'), pw.get('start'), pw.get('token'))
            ts = ghost_ts_by_pair.get(key)
            if ts:
                return ts
        existing = mark.get('removal_ts')
        if existing:
            return existing
        tok = mark.get('token', '')
        pool = removal_pool.get(tok)
        if pool:
            return pool.pop(0)
        return '00:00:00'

    def _load(files: Dict[str, Path]):
        texts: Dict[str, str] = {}
        ranges: Dict[str, dict] = {}
        for fname, p in (files or {}).items():
            if _ext_of(fname) is None:
                continue
            try:
                text = _read_text_normalized(p)
            except Exception:
                continue
            texts[fname] = text
            ranges[fname] = _embedded_lang_ranges_for(text, _ext_of(fname))
        return texts, ranges

    teacher_texts, teacher_ranges = _load(teacher_files)
    student_texts, student_ranges = _load(student_files)

    totals: Dict[str, int] = {ext: 0 for ext, _ in _LANG_EXT_LABEL}
    per_file_nc: Dict[str, list] = {}
    for fname, text in teacher_texts.items():
        file_ext = _ext_of(fname)
        ranges = teacher_ranges.get(fname, {})
        nc, _cm = _split_tokens_by_comment(text, file_ext)
        per_file_nc[fname] = list(nc)
        for pos, _tok in nc:
            totals[_effective_ext_at(pos, file_ext, ranges)] += 1

    missing_files = set(diff_marks.get('missing_files') or [])
    n_missing: Dict[str, int] = {ext: 0 for ext, _ in _LANG_EXT_LABEL}
    n_ghost_extra: Dict[str, int] = {ext: 0 for ext, _ in _LANG_EXT_LABEL}
    n_extra_unpaired: Dict[str, int] = {ext: 0 for ext, _ in _LANG_EXT_LABEL}
    items_by_ext: Dict[str, list] = {ext: [] for ext, _ in _LANG_EXT_LABEL}
    extras_by_ext: Dict[str, list] = {ext: [] for ext, _ in _LANG_EXT_LABEL}

    def _add_whole_file_missing(fname: str, file_ext: str) -> None:
        nc = per_file_nc.get(fname) or []
        ranges = teacher_ranges.get(fname, {})
        for pos, _tok in nc:
            n_missing[_effective_ext_at(pos, file_ext, ranges)] += 1
        if nc:
            items_by_ext[file_ext].append(
                ('99:99:99', f'(whole file missing: {fname} — {len(nc)} tokens)', '')
            )

    counted_missing_for: set = set()
    for fname, marks in (diff_marks.get('teacher_files') or {}).items():
        file_ext = _ext_of(fname)
        if file_ext is None:
            continue
        missing_marks = [m for m in (marks or []) if m.get('label') == 'missing']
        if fname in missing_files and not missing_marks:
            _add_whole_file_missing(fname, file_ext)
            counted_missing_for.add(fname)
        else:
            ranges = teacher_ranges.get(fname, {})
            for m in missing_marks:
                pos = m.get('start', 0)
                eff_ext = _effective_ext_at(pos, file_ext, ranges)
                n_missing[eff_ext] += 1
                ts = _resolve_missing_ts(m, fname)
                pw = m.get('paired_with')
                suffix = (
                    f' ~{token_edit_similarity(m.get("token", ""), pw.get("token", "")):.2f}'
                    if pw else ''
                )
                items_by_ext[eff_ext].append((ts, f'-{m.get("token", "")}', suffix))
            if fname in missing_files:
                counted_missing_for.add(fname)
    for fname in missing_files:
        file_ext = _ext_of(fname)
        if file_ext is None or fname in counted_missing_for:
            continue
        _add_whole_file_missing(fname, file_ext)

    for fname, marks in (diff_marks.get('student_files') or {}).items():
        file_ext = _ext_of(fname)
        if file_ext is None:
            continue
        ranges = student_ranges.get(fname, {})
        for m in marks or []:
            pos = m.get('start', 0)
            eff_ext = _effective_ext_at(pos, file_ext, ranges)
            lbl = m.get('label')
            if lbl == 'ghost_extra':
                ghost_final = _ghost_final_pos(m.get('paired_with') or {})
                ge_ext = None
                if ghost_final is not None:
                    t_fname, t_pos = ghost_final
                    t_file_ext = _ext_of(t_fname)
                    if t_file_ext:
                        t_ranges = teacher_ranges.get(t_fname, {})
                        ge_ext = _effective_ext_at(t_pos, t_file_ext, t_ranges)
                if ge_ext is None:
                    ge_ext = eff_ext
                n_ghost_extra[ge_ext] += 1
                ts = _resolve_ghost_ts(m)
                items_by_ext[ge_ext].append((ts, f'+{m.get("token", "")}*', ''))
            elif lbl == 'extra':
                if not m.get('paired_with'):
                    n_extra_unpaired[eff_ext] += 1
                extras_by_ext[eff_ext].append(
                    (fname, pos, f'+{m.get("token", "")}')
                )

    out: Dict[str, dict] = {}
    for ext, _label in _LANG_EXT_LABEL:
        total = totals[ext]
        if total <= 0:
            out[ext] = None
            continue
        deduction = n_missing[ext] + n_ghost_extra[ext] + n_extra_unpaired[ext]
        score = round(max(0.0, (total - deduction) / total * 100), 1)
        sorted_items = sorted(items_by_ext[ext], key=lambda x: (x[0], x[1]))
        items_text = [
            (s if ts == '99:99:99' else f'{s} ({ts})') + suffix
            for ts, s, suffix in sorted_items
        ]
        sorted_extras = sorted(extras_by_ext[ext], key=lambda t: (t[0], t[1]))
        for _fname, _pos, label in sorted_extras:
            items_text.append(f'{label} (00:00:00)')
        out[ext] = {
            'score': score,
            'items': items_text,
            'text': ', '.join(items_text),
        }
    return out
