import bisect
from collections import Counter
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from . import similarity_measures as _sm
from .similarity_measures import ts_to_local


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
    ghost_ts_by_pair: dict = {}
    if ghosts_for_lookup:
        for fname, blobs in ghosts_for_lookup.items():
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
                    if raw_ts is None:
                        continue
                    ts_str = (
                        ts_to_local(raw_ts)
                        if isinstance(raw_ts, (int, float))
                        else raw_ts
                    )
                    ghost_ts_by_pair[
                        (fname, blob_pos + start_rel, tok_match.group())
                    ] = ts_str

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
            if ts:
                for _ in range(count):
                    all_occurrences.append((ts, tok, {'MISSING'}))
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


def _structural_form(tokens):
    stack = [{'kind': 'top', 'items': []}]

    def push(item):
        ctx = stack[-1]
        if ctx['kind'] == 'block':
            ctx['cur_stmt'].append(item)
        elif ctx['kind'] == 'tag':
            ctx['items'].append(item)
        else:
            ctx['items'].append(item)

    def close_block(closer):
        ctx = stack[-1]
        if ctx['kind'] == 'block' and closer == '}':
            stack.pop()
            if ctx['cur_stmt']:
                ctx['stmts'].append(tuple(ctx['cur_stmt']))
            return ('{', frozenset(Counter(ctx['stmts']).items()))
        if ctx['kind'] == 'tag' and closer == '>':
            stack.pop()
            return ('<', frozenset(Counter(ctx['items']).items()))
        return None

    for tok in tokens:
        if tok == '{':
            stack.append({'kind': 'block', 'stmts': [], 'cur_stmt': []})
        elif tok == '<':
            stack.append({'kind': 'tag', 'items': []})
        elif tok == '}':
            node = close_block('}')
            push(node if node is not None else tok)
        elif tok == '>':
            node = close_block('>')
            push(node if node is not None else tok)
        elif tok == ';' and stack[-1]['kind'] == 'block':
            ctx = stack[-1]
            if ctx['cur_stmt']:
                ctx['stmts'].append(tuple(ctx['cur_stmt']))
                ctx['cur_stmt'] = []
        else:
            push(tok)

    while stack[-1]['kind'] != 'top':
        kind = stack[-1]['kind']
        node = close_block('}' if kind == 'block' else '>')
        push(node)

    return tuple(stack[0]['items'])


def _structural_diff_summary(actual_form, expected_form):
    if actual_form == expected_form:
        return 'forms equal'
    a_len = len(actual_form)
    e_len = len(expected_form)
    if a_len != e_len:
        return f'top-level length differs: actual={a_len}, expected={e_len}'
    for i, (a, e) in enumerate(zip(actual_form, expected_form)):
        if a != e:
            a_kind = a[0] if isinstance(a, tuple) else 'tok'
            e_kind = e[0] if isinstance(e, tuple) else 'tok'
            return (f'first divergence at index {i}: '
                    f'actual={a_kind}({a!r}) vs expected={e_kind}({e!r})')
    return 'unknown divergence'


def _validate_truth_schema(
    truth: dict,
    teacher_files: Dict[str, Path],
    student_files: Dict[str, Path],
) -> List[str]:
    errors: List[str] = []
    ALLOWED_TEACHER = {'missing', 'comment'}
    ALLOWED_STUDENT = {'extra', 'ghost_extra', 'comment'}
    REQ = ('token', 'label', 'start', 'end')

    t_text_cache: Dict[str, str] = {}
    s_text_cache: Dict[str, str] = {}
    for fname, p in (teacher_files or {}).items():
        try:
            t_text_cache[fname] = _read_text_normalized(p)
        except Exception:
            pass
    for fname, p in (student_files or {}).items():
        try:
            s_text_cache[fname] = _read_text_normalized(p)
        except Exception:
            pass

    def check_mark(side: str, fname: str, m, allowed_labels: set) -> bool:
        for k in REQ:
            if k not in m:
                errors.append(f'{side}/{fname}: mark missing field {k!r}: {m}')
                return False
        if m['label'] not in allowed_labels:
            errors.append(
                f'{side}/{fname}: bad label {m["label"]!r} '
                f'(allowed: {sorted(allowed_labels)})'
            )
            return False
        if not (isinstance(m['start'], int) and isinstance(m['end'], int)):
            errors.append(f'{side}/{fname}: start/end must be ints: {m}')
            return False
        if m['start'] >= m['end']:
            errors.append(f'{side}/{fname}: start>=end: {m}')
            return False
        text = (t_text_cache if side == 'teacher' else s_text_cache).get(fname)
        if text is None:
            errors.append(f'{side}/{fname}: file not in {side}_files')
            return False
        if m['end'] > len(text):
            errors.append(f'{side}/{fname}: end {m["end"]} past file len {len(text)}: {m}')
            return False
        if text[m['start']:m['end']] != m['token']:
            errors.append(
                f'{side}/{fname}: substring at [{m["start"]},{m["end"]}] is '
                f'{text[m["start"]:m["end"]]!r}, not token {m["token"]!r}'
            )
            return False
        return True

    teacher_marks_by_file = truth.get('teacher_files', {}) or {}
    student_marks_by_file = truth.get('student_files', {}) or {}
    missing_files_raw = truth.get('missing_files', []) or []
    if not isinstance(missing_files_raw, list):
        errors.append(f'missing_files must be a list, got {type(missing_files_raw).__name__}')
        missing_files_raw = []
    missing_files: set = set()
    for entry in missing_files_raw:
        if not isinstance(entry, str):
            errors.append(f'missing_files entry must be a string: {entry!r}')
            continue
        if entry not in (teacher_files or {}):
            errors.append(
                f'missing_files entry {entry!r} is not a teacher file'
            )
            continue
        if entry in (student_files or {}):
            errors.append(
                f'missing_files entry {entry!r} is also in student_files — '
                f'student did submit it'
            )
            continue
        missing_files.add(entry)

    for fname, marks in teacher_marks_by_file.items():
        for m in marks or []:
            check_mark('teacher', fname, m, ALLOWED_TEACHER)
    for fname, marks in student_marks_by_file.items():
        for m in marks or []:
            check_mark('student', fname, m, ALLOWED_STUDENT)

    t_index = {(fname, m['start']): m
               for fname, marks in teacher_marks_by_file.items()
               for m in marks or [] if 'start' in m}
    s_index = {(fname, m['start']): m
               for fname, marks in student_marks_by_file.items()
               for m in marks or [] if 'start' in m}

    t_paired_to: Dict[Tuple[str, int], Tuple[str, int]] = {}
    s_paired_to: Dict[Tuple[str, int], Tuple[str, int]] = {}

    for fname, marks in teacher_marks_by_file.items():
        for m in marks or []:
            pw = m.get('paired_with')
            if pw is None:
                continue
            if m.get('label') != 'missing':
                errors.append(
                    f'teacher/{fname}: only `missing` may have paired_with, '
                    f'got label {m.get("label")!r}'
                )
                continue
            partner_key = (pw.get('file'), pw.get('start'))
            partner = s_index.get(partner_key)
            if partner is None:
                errors.append(
                    f'teacher/{fname}: paired_with refers to non-existent '
                    f'student mark at {pw.get("file")}:{pw.get("start")}'
                )
                continue
            if partner.get('label') != 'extra':
                errors.append(
                    f'teacher/{fname}: paired_with partner at {partner_key} '
                    f'has label {partner.get("label")!r}, expected `extra`'
                )
                continue
            ppw = partner.get('paired_with') or {}
            if (ppw.get('file') != fname or ppw.get('start') != m['start']):
                errors.append(
                    f'teacher/{fname}: paired_with not bidirectional — '
                    f'partner at {partner_key} does not point back'
                )
                continue
            t_paired_to[(fname, m['start'])] = partner_key

    for fname, marks in student_marks_by_file.items():
        for m in marks or []:
            pw = m.get('paired_with')
            if pw is None:
                continue
            if pw.get('ghost'):
                if m.get('label') != 'ghost_extra':
                    errors.append(
                        f'student/{fname}: ghost paired_with only allowed on '
                        f'`ghost_extra`, got label {m.get("label")!r}'
                    )
                    continue
                if not (
                    isinstance(pw.get('file'), str)
                    and isinstance(pw.get('start'), int)
                    and isinstance(pw.get('end'), int)
                    and isinstance(pw.get('token'), str)
                ):
                    errors.append(
                        f'student/{fname}: ghost paired_with must include '
                        f'file/start/end/token strings/ints'
                    )
                continue
            if m.get('label') != 'extra':
                errors.append(
                    f'student/{fname}: only `extra` may have paired_with, '
                    f'got label {m.get("label")!r}'
                )
                continue
            partner_key = (pw.get('file'), pw.get('start'))
            partner = t_index.get(partner_key)
            if partner is None:
                errors.append(
                    f'student/{fname}: paired_with refers to non-existent '
                    f'teacher mark at {pw.get("file")}:{pw.get("start")}'
                )
                continue
            if partner.get('label') != 'missing':
                errors.append(
                    f'student/{fname}: paired_with partner at {partner_key} '
                    f'has label {partner.get("label")!r}, expected `missing`'
                )
                continue
            s_paired_to[(fname, m['start'])] = partner_key

    seen: Dict[Tuple[str, int], Tuple[str, int]] = {}
    for src, dst in t_paired_to.items():
        if dst in seen:
            errors.append(
                f'student mark at {dst} is the paired_with target of '
                f'multiple teacher missings: {seen[dst]} and {src}'
            )
        else:
            seen[dst] = src
    seen.clear()
    for src, dst in s_paired_to.items():
        if dst in seen:
            errors.append(
                f'teacher mark at {dst} is the paired_with target of '
                f'multiple student extras: {seen[dst]} and {src}'
            )
        else:
            seen[dst] = src

    for fname, marks in teacher_marks_by_file.items():
        for m in marks or []:
            ia = m.get('insert_at')
            if ia is None:
                continue
            if m.get('label') != 'missing':
                errors.append(
                    f'teacher/{fname}: only `missing` may have insert_at, '
                    f'got label {m.get("label")!r}'
                )
                continue
            if m.get('paired_with'):
                continue
            ifile = ia.get('file')
            ipos = ia.get('pos')
            if ifile not in s_text_cache:
                errors.append(
                    f'teacher/{fname}: insert_at.file {ifile!r} not in student_files'
                )
                continue
            if not isinstance(ipos, int) or ipos < 0 or ipos > len(s_text_cache[ifile]):
                errors.append(
                    f'teacher/{fname}: insert_at.pos {ipos} out of range '
                    f'[0, {len(s_text_cache[ifile])}] for {ifile}'
                )

    for fname, marks in student_marks_by_file.items():
        for m in marks or []:
            mt = m.get('move_to')
            if mt is None:
                continue
            if m.get('label') != 'extra':
                errors.append(
                    f'student/{fname}: only `extra` may have move_to, '
                    f'got label {m.get("label")!r}'
                )
                continue
            if m.get('paired_with'):
                errors.append(
                    f'student/{fname}: extra at {m.get("start")} cannot have '
                    f'both paired_with and move_to'
                )
                continue
            mfile = mt.get('file')
            mpos = mt.get('pos')
            if mfile not in s_text_cache:
                errors.append(
                    f'student/{fname}: move_to.file {mfile!r} not in student_files'
                )
                continue
            if not isinstance(mpos, int) or mpos < 0 or mpos > len(s_text_cache[mfile]):
                errors.append(
                    f'student/{fname}: move_to.pos {mpos} out of range '
                    f'[0, {len(s_text_cache[mfile])}] for {mfile}'
                )

    for fname, marks in teacher_marks_by_file.items():
        if fname in missing_files:
            continue
        for m in marks or []:
            if m.get('label') != 'missing':
                continue
            if m.get('paired_with'):
                continue
            if not m.get('insert_at'):
                errors.append(
                    f'teacher/{fname}: unpaired missing {m.get("token")!r} '
                    f'at {m.get("start")} has no insert_at — undefined where '
                    f'to splice'
                )

    for side, marks_by_file in (
        ('teacher', teacher_marks_by_file),
        ('student', student_marks_by_file),
    ):
        for fname, marks in marks_by_file.items():
            seen_spans: Dict[Tuple[int, int], str] = {}
            for m in marks or []:
                if 'start' not in m or 'end' not in m:
                    continue
                key = (m['start'], m['end'])
                if key in seen_spans:
                    errors.append(
                        f'{side}/{fname}: duplicate marks at span '
                        f'[{key[0]},{key[1]}] — labels {seen_spans[key]!r} '
                        f'and {m.get("label")!r}'
                    )
                else:
                    seen_spans[key] = m.get('label')

    return errors
