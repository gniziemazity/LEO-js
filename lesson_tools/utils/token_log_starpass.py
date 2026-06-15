from difflib import SequenceMatcher
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from . import similarity_measures as _sm
from .similarity_measures import reconstruct_tokens_from_keylog_full, ts_to_local
from .lv_editor import replay_with_timestamps_all

from .token_log_leo import (
    _CONTEXT_K,
    _CONTEXT_MATCH_THRESHOLD,
    _SWAP_TOKEN_SIM_WEIGHT,
    _build_teacher_seq_aug,
    _collect_occurrences,
    _collect_teacher_ghosts,
    _hungarian_max,
    _pairwise_context_sim,
)
from .token_log_marks import (
    _match_files_by_name_then_ext,
    _read_text_normalized,
    _split_tokens_by_comment,
)

def _build_file_ordered_ts_map(all_events: list) -> Dict[str, List[str]]:
    surviving_chars_with_ts, _ = replay_with_timestamps_all(all_events)
    if not surviving_chars_with_ts:
        return {}
    text_parts: List[str] = []
    char_timestamps: List[int] = []
    for ch, ts in surviving_chars_with_ts:
        text_parts.append(ch)
        char_timestamps.extend([ts] * len(ch))
    surviving_text = ''.join(text_parts)
    ts_by_token: Dict[str, List[str]] = {}
    for tok_match in _sm._CHAR_TOKEN_RE.finditer(surviving_text):
        last_char_idx = tok_match.end() - 1
        if last_char_idx < len(char_timestamps):
            ts_by_token.setdefault(tok_match.group(), []).append(
                ts_to_local(char_timestamps[last_char_idx]),
            )
    return ts_by_token


def _build_teacher_token_timestamps(events: list) -> Dict[str, list]:
    if not events:
        return {}
    from .lv_editor import _replay_headless_multi
    editors_by_tab = _replay_headless_multi(events, track_timestamps=True)
    entries_by_file: Dict[str, list] = {}
    for tab_key, editor in editors_by_tab.items():
        fname = "reconstructed.html" if tab_key == "MAIN" else tab_key
        char_ts_pairs = editor.get_surviving_with_timestamps()
        text_parts: List[str] = []
        char_timestamps: List[int] = []
        for ch, ts in char_ts_pairs:
            text_parts.append(ch)
            char_timestamps.extend([ts] * len(ch))
        surviving_text = "".join(text_parts)
        token_entries = []
        for tok_match in _sm._CHAR_TOKEN_RE.finditer(surviving_text):
            last_char_idx = tok_match.end() - 1
            if last_char_idx < len(char_timestamps):
                token_entries.append({
                    'start': tok_match.start(),
                    'end': tok_match.end(),
                    'ts': ts_to_local(char_timestamps[last_char_idx]),
                })
        entries_by_file[fname] = token_entries
    return entries_by_file

def _build_token_secprefix_map(
    ts_map: Dict[str, List[str]],
) -> Dict[str, Dict[str, List[str]]]:
    out: Dict[str, Dict[str, List[str]]] = {}
    for tok, ts_list in ts_map.items():
        tok_map: Dict[str, List[str]] = {}
        for ts in ts_list:
            secprefix, _, ms_str = ts.partition('.')
            ms = int(ms_str) if ms_str else 0
            tok_map.setdefault(secprefix, []).append(ts)
            if ms >= 500:
                rounded = _add_seconds_to_hms(secprefix, 1)
                if rounded:
                    tok_map.setdefault(rounded, []).append(ts)
        out[tok] = tok_map
    return out


def _add_seconds_to_hms(hms: str, delta: int) -> Optional[str]:
    try:
        h, m, s = hms.split(':')
        total = int(h) * 3600 + int(m) * 60 + int(s) + delta
        if total < 0 or total >= 24 * 3600:
            return None
        return f'{total // 3600:02d}:{(total // 60) % 60:02d}:{total % 60:02d}'
    except Exception:
        return None


def _build_removal_ts_map(events: list, lesson_file: str | None = None) -> Dict[str, List[str]]:
    _, _, removed_kw_ts, _, _ = reconstruct_tokens_from_keylog_full(
        events, lesson_file=lesson_file,
    )
    out: Dict[str, List[str]] = {}
    for tok, pairs in removed_kw_ts.items():
        for _ins_ts, del_ts in pairs:
            out.setdefault(tok, []).append(ts_to_local(del_ts))
    return out


def _upgrade_secprefix(existing: str, candidates: List[str],
                        consumed: Dict[Tuple[str, str], int],
                        key: Tuple[str, str]) -> Optional[str]:
    if not candidates:
        return None
    idx = consumed.get(key, 0)
    if idx >= len(candidates):
        return None
    consumed[key] = idx + 1
    return candidates[idx]


def _refresh_missing_timestamps(diff_marks: dict, events: list,
                                 _ts_map: dict = None,
                                 _teacher_token_ts: dict = None) -> None:
    if not events:
        return
    ts_map = _ts_map if _ts_map is not None else _build_file_ordered_ts_map(events)
    teacher_token_ts = (
        _teacher_token_ts if _teacher_token_ts is not None
        else _build_teacher_token_timestamps(events)
    )
    pos_ts: Dict[Tuple[str, int, int], str] = {}
    for fname, entries in (teacher_token_ts or {}).items():
        for e in entries or []:
            s = e.get('start')
            en = e.get('end')
            ts = e.get('ts')
            if isinstance(s, int) and isinstance(en, int) and ts:
                pos_ts[(fname, s, en)] = ts

    insert_ts_by_tok_secprefix = _build_token_secprefix_map(ts_map)
    insert_consumed: Dict[Tuple[str, str], int] = {}
    for fname in sorted(diff_marks.get('teacher_files', {})):
        for mark in diff_marks['teacher_files'][fname]:
            if mark.get('label') != 'missing':
                mark.pop('_tok_idx', None)
                continue
            tok = mark.get('token', '')
            existing_ts = mark.get('timestamp', '')
            stored_idx = mark.pop('_tok_idx', None)
            s = mark.get('start')
            en = mark.get('end')
            if isinstance(s, int) and isinstance(en, int):
                pos_ts_val = pos_ts.get((fname, s, en))
                if pos_ts_val:
                    mark['timestamp'] = pos_ts_val
                    continue
            if existing_ts and '.' in existing_ts:
                continue
            if existing_ts:
                candidates = insert_ts_by_tok_secprefix.get(tok, {}).get(existing_ts, [])
                upgraded = _upgrade_secprefix(
                    existing_ts, candidates, insert_consumed, (tok, existing_ts),
                )
                if upgraded:
                    mark['timestamp'] = upgraded
            elif stored_idx is not None:
                ts_list = ts_map.get(tok, [])
                if stored_idx < len(ts_list):
                    mark['timestamp'] = ts_list[stored_idx]

    removal_ts_map = _build_removal_ts_map(events)
    removal_ts_by_tok_secprefix = _build_token_secprefix_map(removal_ts_map)
    removal_consumed: Dict[Tuple[str, str], int] = {}
    for fname in sorted(diff_marks.get('student_files', {})):
        for mark in diff_marks['student_files'][fname]:
            if mark.get('label') != 'ghost_extra':
                continue
            existing_ts = mark.get('removal_ts', '')
            if not existing_ts or '.' in existing_ts:
                continue
            tok = mark.get('token', '')
            candidates = removal_ts_by_tok_secprefix.get(tok, {}).get(existing_ts, [])
            upgraded = _upgrade_secprefix(
                existing_ts, candidates, removal_consumed, (tok, existing_ts),
            )
            if upgraded:
                mark['removal_ts'] = upgraded

def _add_log_metadata(
    diff_marks: dict,
    events: list,
    student_files: Dict[str, Path],
    teacher_files: Optional[Dict[str, Path]] = None,
    _ts_map: dict = None,
) -> None:
    if not events:
        return

    ts_map = _ts_map if _ts_map is not None else _build_file_ordered_ts_map(events)
    _refresh_missing_timestamps(diff_marks, events, _ts_map=ts_map)

    if 'leo_assignments' not in diff_marks and teacher_files:
        assignments = _build_assignments_for_post_pass(
            teacher_files, student_files, diff_marks, events,
        )
        if assignments:
            diff_marks['leo_assignments'] = assignments

    _apply_ghost_extra_promotion(diff_marks, events)
    if teacher_files:
        _apply_swap_pairing_to_marks(
            diff_marks.get('teacher_files', {}),
            diff_marks.get('student_files', {}),
            teacher_files, student_files,
        )
        _apply_insert_at_to_unpaired_missings(
            diff_marks.get('teacher_files', {}),
            diff_marks.get('student_files', {}),
            teacher_files, student_files,
        )
    teacher_ghosts = _collect_teacher_ghosts(events)
    if teacher_ghosts:
        diff_marks['teacher_ghosts'] = teacher_ghosts

def _apply_swap_pairing_to_marks(
    t_marks_by_file: Dict[str, List[dict]],
    s_marks_by_file: Dict[str, List[dict]],
    teacher_files: Dict[str, Path],
    student_files: Dict[str, Path],
) -> None:
    for marks in t_marks_by_file.values():
        for mark in marks:
            paired_with = mark.get('paired_with')
            if paired_with and paired_with.get('ghost'):
                continue
            mark.pop('paired_with', None)
    for marks in s_marks_by_file.values():
        for mark in marks:
            paired_with = mark.get('paired_with')
            if paired_with and paired_with.get('ghost'):
                continue
            mark.pop('paired_with', None)

    for teacher_filepath, teacher_path, student_path in _match_files_by_name_then_ext(teacher_files, student_files):
        if student_path is None:
            continue
        teacher_fname = Path(teacher_filepath).name
        student_fname = student_path.name

        missing_marks = [
            m for m in t_marks_by_file.get(teacher_fname, [])
            if m.get('label') == 'missing'
        ]
        extra_marks = [
            e for e in s_marks_by_file.get(student_fname, [])
            if e.get('label') == 'extra'
        ]
        if not missing_marks or not extra_marks:
            continue

        teacher_text = _read_text_normalized(teacher_path)
        student_text = _read_text_normalized(student_path)
        ext = Path(teacher_filepath).suffix.lower()
        teacher_noncomment_toks, _ = _split_tokens_by_comment(teacher_text, ext)
        student_noncomment_toks, _ = _split_tokens_by_comment(student_text, ext)
        teacher_seq = [tok for _, tok in teacher_noncomment_toks]
        student_seq = [tok for _, tok in student_noncomment_toks]
        teacher_pos_to_seq_idx = {pos: i for i, (pos, _) in enumerate(teacher_noncomment_toks)}
        student_pos_to_seq_idx = {pos: j for j, (pos, _) in enumerate(student_noncomment_toks)}

        missing_entries = [
            (teacher_pos_to_seq_idx[m['start']], m)
            for m in missing_marks if m['start'] in teacher_pos_to_seq_idx
        ]
        extra_entries = [
            (student_pos_to_seq_idx[e['start']], e)
            for e in extra_marks if e['start'] in student_pos_to_seq_idx
        ]
        if not missing_entries or not extra_entries:
            continue

        cos_matrix = _pairwise_context_sim(
            student_seq, [idx for idx, _ in extra_entries],
            teacher_seq, [idx for idx, _ in missing_entries],
            _CONTEXT_K,
        )

        candidates: List[Tuple[float, int, int]] = []
        for missing_idx, (_, missing_mark) in enumerate(missing_entries):
            missing_tok = missing_mark['token']
            for extra_idx, (_, extra_mark) in enumerate(extra_entries):
                tok_sim = (
                    1.0 if missing_tok == extra_mark['token']
                    else SequenceMatcher(None, missing_tok, extra_mark['token']).ratio()
                )
                score = cos_matrix[extra_idx][missing_idx] + _SWAP_TOKEN_SIM_WEIGHT * tok_sim
                if score >= _CONTEXT_MATCH_THRESHOLD:
                    candidates.append((score, missing_idx, extra_idx))
        candidates.sort(reverse=True)

        consumed_missing: set = set()
        consumed_extra: set = set()
        for _score, missing_idx, extra_idx in candidates:
            if missing_idx in consumed_missing or extra_idx in consumed_extra:
                continue
            consumed_missing.add(missing_idx)
            consumed_extra.add(extra_idx)
            missing_mark = missing_entries[missing_idx][1]
            extra_mark = extra_entries[extra_idx][1]
            missing_mark['paired_with'] = {
                'file':  student_fname,
                'start': extra_mark['start'],
                'end':   extra_mark['end'],
                'token': extra_mark['token'],
                'label': 'extra',
            }
            extra_mark['paired_with'] = {
                'file':  teacher_fname,
                'start': missing_mark['start'],
                'end':   missing_mark['end'],
                'token': missing_mark['token'],
                'label': 'missing',
            }


def _apply_insert_at_to_unpaired_missings(
    t_marks_by_file: Dict[str, List[dict]],
    s_marks_by_file: Dict[str, List[dict]],
    teacher_files: Dict[str, Path],
    student_files: Dict[str, Path],
) -> None:
    for marks in t_marks_by_file.values():
        for mark in marks:
            if mark.get('label') != 'missing':
                continue
            if mark.get('paired_with') is not None:
                mark.pop('insert_at', None)
                continue
            native_anchor = mark.get('_native_insert_at')
            if native_anchor is not None:
                mark['insert_at'] = dict(native_anchor)
            else:
                mark.pop('insert_at', None)

    matched_student_for_teacher: dict = {}
    for teacher_filepath, teacher_path, student_path in _match_files_by_name_then_ext(
            teacher_files, student_files):
        if student_path is None:
            continue
        teacher_fname = Path(teacher_filepath).name
        student_fname = student_path.name
        matched_student_for_teacher[teacher_fname] = student_fname

        unpaired_missings = [
            mark for mark in t_marks_by_file.get(teacher_fname, [])
            if mark.get('label') == 'missing'
                and mark.get('paired_with') is None
                and 'insert_at' not in mark
        ]
        if not unpaired_missings:
            continue

        teacher_text = _read_text_normalized(teacher_path)
        student_text = _read_text_normalized(student_path)
        ext = Path(teacher_filepath).suffix.lower()
        teacher_noncomment_toks, _ = _split_tokens_by_comment(teacher_text, ext)
        student_noncomment_toks, _ = _split_tokens_by_comment(student_text, ext)

        teacher_missing_positions = {
            mark['start'] for mark in t_marks_by_file.get(teacher_fname, [])
            if mark.get('label') == 'missing'
        }
        student_skip_positions = {
            mark['start'] for mark in s_marks_by_file.get(student_fname, [])
            if mark.get('label') in ('extra', 'ghost_extra')
        }

        matched_teacher_seq_idxs = [
            i for i, (pos, _) in enumerate(teacher_noncomment_toks)
            if pos not in teacher_missing_positions
        ]
        matched_student_toks = [
            (pos, tok) for pos, tok in student_noncomment_toks
            if pos not in student_skip_positions
        ]

        teacher_pos_to_seq_idx = {
            pos: i for i, (pos, _) in enumerate(teacher_noncomment_toks)
        }

        for mark in unpaired_missings:
            teacher_idx = teacher_pos_to_seq_idx.get(mark['start'])
            if teacher_idx is None:
                continue
            prev_matched_idx = -1
            for k, matched_t_idx in enumerate(matched_teacher_seq_idxs):
                if matched_t_idx < teacher_idx:
                    prev_matched_idx = k
                else:
                    break
            if prev_matched_idx < 0:
                insert_pos = 0
            elif prev_matched_idx < len(matched_student_toks):
                anchor_pos, anchor_tok = matched_student_toks[prev_matched_idx]
                insert_pos = anchor_pos + len(anchor_tok)
            else:
                insert_pos = len(student_text)
            mark['insert_at'] = {'file': student_fname, 'pos': insert_pos}

    if student_files:
        global_fname = sorted(student_files.keys())[0]
        eof_cache: dict = {}

        def _eof_of(fname):
            if fname not in eof_cache:
                try:
                    eof_cache[fname] = len(
                        _read_text_normalized(student_files[fname]))
                except Exception:
                    eof_cache[fname] = 0
            return eof_cache[fname]

        for teacher_fname, marks in t_marks_by_file.items():
            target_fname = matched_student_for_teacher.get(teacher_fname, global_fname)
            if target_fname not in student_files:
                target_fname = global_fname
            for mark in marks:
                if (mark.get('label') == 'missing'
                        and not mark.get('paired_with')
                        and 'insert_at' not in mark):
                    mark['insert_at'] = {
                        'file': target_fname, 'pos': _eof_of(target_fname)}


def _apply_ghost_extra_promotion(
    diff_marks: dict,
    events: list,
) -> None:
    if not events:
        return
    assignments = diff_marks.get('leo_assignments') or {}
    tokens_data = assignments.get('tokens') or {}
    teacher_seq_aug = assignments.get('teacher_seq_aug')
    if not tokens_data or not teacher_seq_aug:
        return
    teacher_match_seq = [
        t if isinstance(t, str) else t[0] for t in teacher_seq_aug
    ]
    student_seq = assignments.get('student_seq', [])
    context_k = assignments.get('k', _CONTEXT_K)

    student_marks = diff_marks.get('student_files', {})
    mark_index: Dict[Tuple[str, int, str], dict] = {}
    for fname, marks in student_marks.items():
        for mark in marks:
            mark_index[(fname, mark.get('start'), mark.get('token'))] = mark

    def _promote(student_inst: dict, ghost_inst: dict, tok: str) -> None:
        student_inst['label'] = 'ghost_extra'
        mark = mark_index.get(
            (student_inst.get('file'), student_inst.get('pos'), tok)
        )
        if mark is not None:
            mark['label'] = 'ghost_extra'
            del_ts = ghost_inst.get('del_ts')
            if del_ts is not None:
                mark['removal_ts'] = ts_to_local(del_ts)
            ghost_file = ghost_inst.get('file')
            ghost_blob_pos = ghost_inst.get('pos')
            ghost_blob_offset = ghost_inst.get('blob_offset')
            if (ghost_file is not None
                    and ghost_blob_pos is not None
                    and ghost_blob_offset is not None):
                ghost_start = ghost_blob_pos + ghost_blob_offset
                mark['paired_with'] = {
                    'file': ghost_file,
                    'start': ghost_start,
                    'end': ghost_start + len(tok),
                    'token': tok,
                    'ghost': True,
                }

    for tok, token_data in tokens_data.items():
        student_insts = token_data.get('student', [])
        teacher_insts = token_data.get('teacher', [])
        extra_insts = [
            (i, s) for i, s in enumerate(student_insts)
            if s.get('label') == 'extra'
        ]
        ghost_insts = [
            (j, t) for j, t in enumerate(teacher_insts) if t.get('ghost')
        ]
        if not extra_insts or not ghost_insts:
            continue

        def _is_ghost_pair(match_idx):
            return (match_idx is not None
                    and 0 <= match_idx < len(teacher_insts)
                    and teacher_insts[match_idx].get('ghost'))

        prepaired_ghost_idxs: set = set()
        unpaired_extras: List[Tuple[int, dict]] = []
        for student_idx, student_inst in extra_insts:
            match_idx = student_inst.get('match_idx')
            if _is_ghost_pair(match_idx):
                _promote(student_inst, teacher_insts[match_idx], tok)
                prepaired_ghost_idxs.add(match_idx)
            else:
                unpaired_extras.append((student_idx, student_inst))

        unpaired_ghosts = [
            (j, t) for j, t in ghost_insts if j not in prepaired_ghost_idxs
        ]
        if not unpaired_extras or not unpaired_ghosts:
            continue

        similarity_matrix = _pairwise_context_sim(
            student_seq, [s.get('seq_idx') for _, s in unpaired_extras],
            teacher_match_seq, [t.get('seq_idx_aug') for _, t in unpaired_ghosts],
            context_k,
        )
        if not similarity_matrix or not similarity_matrix[0]:
            continue

        new_pairs: List[Tuple[dict, dict]] = []
        for s_local, g_local in _hungarian_max(similarity_matrix):
            if similarity_matrix[s_local][g_local] < _CONTEXT_MATCH_THRESHOLD:
                continue
            student_idx, student_inst = unpaired_extras[s_local]
            ghost_idx, ghost_inst = unpaired_ghosts[g_local]
            student_inst['match_idx'] = ghost_idx
            ghost_inst['match_idx'] = student_idx
            new_pairs.append((student_inst, ghost_inst))

        for student_inst, ghost_inst in new_pairs:
            _promote(student_inst, ghost_inst, tok)


def _build_assignments_for_post_pass(
    teacher_files: Dict[str, Path],
    student_files: Dict[str, Path],
    diff_marks: dict,
    events: Optional[list],
) -> Optional[dict]:
    teacher_occurrences, _ = _collect_occurrences(teacher_files)
    student_occurrences, _ = _collect_occurrences(student_files)
    teacher_seq = [
        occurrence['token'] for occurrence in teacher_occurrences
        if not occurrence['is_comment']
    ]
    student_seq = [
        occurrence['token'] for occurrence in student_occurrences
        if not occurrence['is_comment']
    ]

    teacher_seq_aug: Optional[list] = None
    seq_idx_to_aug: Optional[Dict[int, int]] = None
    ghost_instances: List[dict] = []
    teacher_ghosts = _collect_teacher_ghosts(events) if events else {}
    if teacher_ghosts:
        teacher_seq_aug, seq_idx_to_aug, ghost_instances = _build_teacher_seq_aug(
            teacher_occurrences, teacher_ghosts,
        )

    student_by_token: Dict[str, List[dict]] = {}
    for occurrence in student_occurrences:
        if occurrence['is_comment']:
            continue
        student_by_token.setdefault(occurrence['token'], []).append(occurrence)
    teacher_by_token: Dict[str, List[dict]] = {}
    for occurrence in teacher_occurrences:
        if occurrence['is_comment']:
            continue
        teacher_by_token.setdefault(occurrence['token'], []).append(occurrence)
    ghost_by_token: Dict[str, List[dict]] = {}
    for ghost_inst in ghost_instances:
        ghost_by_token.setdefault(ghost_inst['token'], []).append(ghost_inst)

    extra_keys: set = set()
    for fname, marks in diff_marks.get('student_files', {}).items():
        for mark in marks:
            if mark.get('label') == 'extra' and mark.get('token'):
                extra_keys.add((fname, mark.get('start'), mark['token']))
    missing_keys: set = set()
    for fname, marks in diff_marks.get('teacher_files', {}).items():
        for mark in marks:
            if mark.get('label') == 'missing' and mark.get('token'):
                missing_keys.add((fname, mark.get('start'), mark['token']))

    tokens_data: Dict[str, dict] = {}
    all_tokens = set(student_by_token) | set(teacher_by_token) | set(ghost_by_token)
    for tok in all_tokens:
        student_insts = student_by_token.get(tok, [])
        teacher_insts = teacher_by_token.get(tok, [])
        ghost_insts = ghost_by_token.get(tok, [])

        student_entries = []
        any_extra = False
        for student_inst in student_insts:
            label = (
                'extra'
                if (student_inst['file'], student_inst['pos'], tok) in extra_keys
                else None
            )
            if label == 'extra':
                any_extra = True
            student_entries.append({
                'file': student_inst['file'], 'pos': student_inst['pos'],
                'seq_idx': student_inst['seq_idx'], 'label': label,
            })

        teacher_entries: List[dict] = []
        any_missing = False
        for teacher_inst in teacher_insts:
            label = (
                'missing'
                if (teacher_inst['file'], teacher_inst['pos'], tok) in missing_keys
                else None
            )
            if label == 'missing':
                any_missing = True
            entry = {
                'file': teacher_inst['file'], 'pos': teacher_inst['pos'],
                'seq_idx': teacher_inst['seq_idx'], 'label': label,
            }
            if seq_idx_to_aug:
                entry['seq_idx_aug'] = seq_idx_to_aug[teacher_inst['seq_idx']]
            teacher_entries.append(entry)
        for ghost_inst in ghost_insts:
            teacher_entries.append({
                'file': ghost_inst['file'], 'pos': ghost_inst['blob_pos'],
                'blob_offset': ghost_inst['blob_offset'],
                'ghost': True, 'del_ts': ghost_inst['del_ts'],
                'seq_idx_aug': ghost_inst['seq_idx_aug'],
            })

        if not (any_extra or any_missing or ghost_insts):
            continue
        tokens_data[tok] = {'teacher': teacher_entries, 'student': student_entries}

    if not tokens_data:
        return None
    assignments = {
        'k': _CONTEXT_K,
        'teacher_seq': teacher_seq,
        'student_seq': student_seq,
        'tokens': tokens_data,
    }
    if teacher_seq_aug is not None:
        assignments['teacher_seq_aug'] = teacher_seq_aug
    return assignments
