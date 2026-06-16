import bisect
from collections import Counter
from pathlib import Path
from typing import Dict, Iterator, List, Optional, Tuple

from . import similarity_measures as _sm
from .similarity_measures import ts_to_local


def iter_ghost_tokens(
    teacher_ghosts: Optional[Dict[str, list]],
) -> Iterator[tuple]:
    for fname, blobs in (teacher_ghosts or {}).items():
        for blob in blobs or []:
            blob_pos = blob.get('pos')
            if blob_pos is None:
                continue
            blob_del_ts = blob.get('del_ts')
            char_del_ts = blob.get('char_del_ts') or []
            blob_text = blob.get('text') or ''
            for tok_match in _sm._CHAR_TOKEN_RE.finditer(blob_text):
                start_rel = tok_match.start()
                end_rel = tok_match.end() - 1
                if start_rel < len(char_del_ts):
                    slice_end = min(end_rel, len(char_del_ts) - 1)
                    slice_vals = [t for t in char_del_ts[start_rel:slice_end + 1]
                                  if t is not None]
                    raw_ts = max(slice_vals) if slice_vals else blob_del_ts
                else:
                    raw_ts = blob_del_ts
                yield fname, blob_pos, start_rel, tok_match.group(), raw_ts


def build_ghost_ts_by_pair(teacher_ghosts: Optional[Dict[str, list]]) -> dict:
    out: dict = {}
    for fname, blob_pos, start_rel, tok, raw_ts in iter_ghost_tokens(teacher_ghosts):
        if raw_ts is None:
            continue
        ts_str = ts_to_local(raw_ts) if isinstance(raw_ts, (int, float)) else raw_ts
        out[(fname, blob_pos + start_rel, tok)] = ts_str
    return out


def _missing_mark(
    pos: int, tok: str,
    tok_all_positions: Optional[Dict[str, List[int]]] = None,
) -> dict:
    mark: dict = {'token': tok, 'label': 'missing', 'start': pos, 'end': pos + len(tok)}
    if tok_all_positions is not None:
        positions = tok_all_positions.get(tok, [])
        mark['_tok_idx'] = bisect.bisect_left(positions, pos)
    return mark


def _extra_mark(pos: int, tok: str) -> dict:
    return {'token': tok, 'label': 'extra', 'start': pos, 'end': pos + len(tok)}


def _comment_pos_mark(pos: int, tok: str) -> dict:
    return {'token': tok, 'label': 'comment', 'start': pos, 'end': pos + len(tok)}


def _line_token_marks(
    line_text: str, line_off: int, side: str,
    tok_all_positions: Optional[Dict[str, List[int]]] = None,
) -> List[dict]:
    marks: List[dict] = []
    for m in _sm._CHAR_TOKEN_RE.finditer(line_text):
        abs_pos = line_off + m.start()
        if side == 'teacher':
            marks.append(_missing_mark(abs_pos, m.group(), tok_all_positions))
        else:
            marks.append(_extra_mark(abs_pos, m.group()))
    return marks


def _line_start_offsets(text: str) -> List[int]:
    starts = [0]
    for i, ch in enumerate(text):
        if ch == '\n':
            starts.append(i + 1)
    return starts


def _make_line_mark(lines_raw, starts, idx, label):
    line_raw = lines_raw[idx]
    if not line_raw.strip():
        return None
    raw_start = starts[idx]
    ls = len(line_raw) - len(line_raw.lstrip())
    le = len(line_raw.rstrip())
    if raw_start + ls < raw_start + le:
        return {'label': label, 'start': raw_start + ls, 'end': raw_start + le}
    return None


def _match_files_by_name_then_ext(
    teacher_files: Dict[str, Path],
    student_files: Dict[str, Path],
) -> List[Tuple[str, Path, Optional[Path]]]:
    matched_student: set = set()
    pairs: List[Tuple[str, Path, Optional[Path]]] = []

    for t_name, t_path in teacher_files.items():
        if t_name in student_files:
            pairs.append((t_name, t_path, student_files[t_name]))
            matched_student.add(t_name)
        else:
            ext = Path(t_name).suffix.lower()
            same_ext = [
                (s_name, s_path)
                for s_name, s_path in student_files.items()
                if Path(s_name).suffix.lower() == ext and s_name not in matched_student
            ]
            if len(same_ext) == 1:
                s_name, s_path = same_ext[0]
                pairs.append((t_name, t_path, s_path))
                matched_student.add(s_name)
            else:
                pairs.append((t_name, t_path, None))

    return pairs


def _read_text_normalized(path: Optional[Path]) -> str:
    if path is None:
        return ''
    try:
        return path.read_text(encoding='utf-8', errors='ignore').replace('\r\n', '\n')
    except Exception:
        return ''


def _split_tokens_by_comment(
    text: str, ext=None,
) -> Tuple[List[Tuple[int, str]], List[Tuple[int, str]]]:
    if not text:
        return [], []
    nc: List[Tuple[int, str]] = []
    cm: List[Tuple[int, str]] = []
    for pos, tok, is_comment in _sm.iter_code_tokens(text, ext):
        (cm if is_comment else nc).append((pos, tok))
    return nc, cm


def _build_token_position_index(
    text: str, ext=None,
) -> Tuple[Dict[str, List[int]], int]:
    positions: Dict[str, List[int]] = {}
    n = 0
    for pos, tok, _ in _sm.iter_code_tokens(text, ext):
        positions.setdefault(tok, []).append(pos)
        n += 1
    return positions, n


def _strip_internal_fields(diff_marks: dict) -> None:
    for side in ('teacher_files', 'student_files'):
        for marks in diff_marks.get(side, {}).values():
            for mark in marks:
                if (
                    mark.get('label') == 'missing'
                    and 'insert_at' not in mark
                    and mark.get('paired_with') is None
                    and mark.get('_native_insert_at')
                ):
                    mark['insert_at'] = dict(mark['_native_insert_at'])
                mark.pop('_tok_idx', None)
                mark.pop('_native_insert_at', None)


def _assemble_diff_marks(
    token_matching: str,
    teacher_files: dict,
    student_files: dict,
    score: Optional[float] = None,
    alignments: Optional[dict] = None,
    line_marks: Optional[dict] = None,
    leo_assignments: Optional[dict] = None,
) -> dict:
    result: dict = {'token_matching': token_matching}
    if score is not None:
        result['score'] = score
    result['teacher_files'] = teacher_files
    result['student_files'] = student_files
    if alignments:
        result['alignments'] = alignments
    if line_marks:
        result['line_marks'] = line_marks
    if leo_assignments:
        result['leo_assignments'] = leo_assignments
    return result


def _summarize_occurrence_flags(all_occ: list) -> dict:
    n_found_e = sum(1 for _, _, fl in all_occ if not fl)
    n_missing_e = sum(1 for _, _, fl in all_occ if fl == {'MISSING'})
    n_found_c = sum(1 for _, _, fl in all_occ if fl == {'COMMENT'})
    n_missing_c = sum(1 for _, _, fl in all_occ if fl == {'MISSING', 'COMMENT'})
    return {
        'n_found_e': n_found_e,
        'n_missing_e': n_missing_e,
        'n_found_c': n_found_c,
        'n_missing_c': n_missing_c,
        'n_found': n_found_e + n_found_c,
        'n_missing': n_missing_e + n_missing_c,
        'n_extra': sum(1 for _, _, fl in all_occ if 'EXTRA' in fl),
        'n_ghost_extra': sum(1 for _, _, fl in all_occ if 'EXTRA*' in fl),
    }


def _build_occ_from_diff_marks(
    diff_marks: dict,
    teacher_entries: list,
    removal_ts_by_token: dict = None,
    teacher_ghosts: dict = None,
) -> tuple:
    def _pop_removal_ts(tok: str) -> str:
        timestamps = (removal_ts_by_token or {}).get(tok)
        if timestamps:
            return timestamps.pop(0)
        return '00:00:00'

    ghosts_for_lookup = teacher_ghosts
    if ghosts_for_lookup is None:
        ghosts_for_lookup = diff_marks.get('teacher_ghosts')
    ghost_ts_by_pair = build_ghost_ts_by_pair(ghosts_for_lookup)

    def _ghost_pair_ts(mark: dict) -> str:
        paired_with = mark.get('paired_with') or {}
        if not paired_with.get('ghost'):
            return ''
        key = (paired_with.get('file'), paired_with.get('start'), paired_with.get('token'))
        return ghost_ts_by_pair.get(key, '')

    missing_noncomment_by_tok_ts: Counter = Counter()
    missing_noncomment_by_tok: Counter = Counter()
    has_timestamps = False
    for marks in diff_marks.get('teacher_files', {}).values():
        for mark in marks:
            if mark.get('label') == 'missing':
                tok = mark['token']
                ts = mark.get('timestamp', '')
                missing_noncomment_by_tok[tok] += 1
                if ts:
                    has_timestamps = True
                missing_noncomment_by_tok_ts[(tok, ts)] += 1

    student_comment_by_tok: Counter = Counter()
    for marks in diff_marks.get('student_files', {}).values():
        for mark in marks:
            if mark.get('label') == 'comment':
                student_comment_by_tok[mark['token']] += 1

    all_occurrences: list = []
    missing_remaining_by_tok_ts = Counter(missing_noncomment_by_tok_ts)
    missing_remaining_by_tok = Counter(missing_noncomment_by_tok)
    student_comment_consumed: Counter = Counter()

    for entry in teacher_entries:
        tok, ts_str, is_comment, is_removed = entry[0], entry[1], entry[2], entry[3]
        if is_removed:
            continue
        if is_comment:
            if student_comment_consumed[tok] < student_comment_by_tok.get(tok, 0):
                student_comment_consumed[tok] += 1
                all_occurrences.append((ts_str, tok, {'COMMENT'}))
            else:
                all_occurrences.append((ts_str, tok, {'MISSING', 'COMMENT'}))
        else:
            if has_timestamps:
                key = (tok, ts_str)
                if missing_remaining_by_tok_ts.get(key, 0) > 0:
                    missing_remaining_by_tok_ts[key] -= 1
                    all_occurrences.append((ts_str, tok, {'MISSING'}))
                else:
                    all_occurrences.append((ts_str, tok, set()))
            else:
                if missing_remaining_by_tok.get(tok, 0) > 0:
                    missing_remaining_by_tok[tok] -= 1
                    all_occurrences.append((ts_str, tok, {'MISSING'}))
                else:
                    all_occurrences.append((ts_str, tok, set()))

    if has_timestamps:
        for (tok, ts), count in missing_remaining_by_tok_ts.items():
            for _ in range(count):
                all_occurrences.append((ts or '00:00:00', tok, {'MISSING'}))
    else:
        for tok, count in missing_remaining_by_tok.items():
            for _ in range(count):
                all_occurrences.append(('00:00:00', tok, {'MISSING'}))

    for tok, total_student_comments in student_comment_by_tok.items():
        extra_count = total_student_comments - student_comment_consumed.get(tok, 0)
        for _ in range(max(0, extra_count)):
            all_occurrences.append(('00:00:00', tok, {'COMMENT', 'EXTRA'}))

    for marks in diff_marks.get('student_files', {}).values():
        for mark in marks:
            label = mark.get('label')
            tok = mark['token']
            if label == 'extra':
                all_occurrences.append(('00:00:00', tok, {'EXTRA'}))
            elif label == 'ghost_extra':
                removal_ts = (
                    _ghost_pair_ts(mark)
                    or mark.get('removal_ts')
                    or _pop_removal_ts(tok)
                )
                all_occurrences.append((removal_ts, tok, {'EXTRA*'}))

    def _sort_key(entry: tuple) -> tuple:
        ts, _, flags = entry
        is_tail = ts == '00:00:00' and 'EXTRA' in flags and 'EXTRA*' not in flags
        try:
            hh, mm, rest = ts.split(':')
            ss, _, ms_str = rest.partition('.')
            ms = int(ms_str) if ms_str else 0
            return (is_tail, int(hh), int(mm), int(ss), ms)
        except Exception:
            return (is_tail, 99, 99, 99, 0)

    all_occurrences.sort(key=_sort_key)

    n_extra_unpaired = sum(
        1
        for marks in diff_marks.get('student_files', {}).values()
        for m in marks
        if m.get('label') == 'extra' and not m.get('paired_with')
    )

    stats = _summarize_occurrence_flags(all_occurrences)
    teacher_total_e = stats['n_found_e'] + stats['n_missing_e']
    score_e = (round(max(0.0, (stats['n_found_e'] - stats['n_ghost_extra'] - n_extra_unpaired) / teacher_total_e * 100), 1)
               if teacher_total_e else 0.0)

    comment_total = stats['n_found_c'] + stats['n_missing_c']
    score_c = (round(stats['n_found_c'] / comment_total * 100, 1) if comment_total else 0.0)

    return (
        all_occurrences,
        score_e,
        score_c,
        stats['n_found'],
        stats['n_missing'],
        stats['n_extra'],
        stats['n_ghost_extra'],
    )
