import difflib
import math
from collections import Counter
from difflib import SequenceMatcher
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import bisect
import numpy as np
from scipy.optimize import linear_sum_assignment
from . import similarity_measures as _sm

from .similarity_measures import (
    reconstruct_tokens_from_keylog_full,
    ts_to_local,
)
from .lv_editor import replay_with_timestamps_all, reconstruct_all_with_ghosts

from .token_log_leo import (
    _CONTEXT_K,
    _CONTEXT_MATCH_THRESHOLD,
    _SWAP_TOKEN_SIM_WEIGHT,
    _build_stripped_view,
    _build_teacher_seq_aug,
    _build_utf16_map,
    _collect_occurrences,
    _collect_teacher_ghosts,
    _colors_to_position_marks,
    _combined_context_score,
    _compute_per_token_matching,
    _context_vector_pack,
    _context_vector_split,
    _cosine_with_norms,
    _hungarian_max,
    _locate_token,
    _pairwise_context_sim,
    _prune_color_map,
    _scan_file_tokens,
    _stripped_context_vector_pack,
    _stripped_context_vector_split,
    _vec_norm,
)

from .token_log_marks import (
    _assemble_diff_marks,
    _build_occ_from_diff_marks,
    _build_token_position_index,
    _comment_pos_mark,
    _extra_mark,
    _line_start_offsets,
    _line_token_marks,
    _make_line_mark,
    _match_files_by_name_then_ext,
    _missing_mark,
    _read_text_normalized,
    _split_tokens_by_comment,
    _strip_internal_fields,
    _structural_diff_summary,
    _structural_form,
    _summarize_occurrence_flags,
    _validate_curated_schema,
)

from .token_log_starpass import (
    _add_log_metadata,
    _add_seconds_to_hms,
    _apply_ghost_extra_promotion,
    _apply_insert_at_to_unpaired_missings,
    _apply_swap_pairing_to_marks,
    _build_assignments_for_post_pass,
    _build_file_ordered_ts_map,
    _build_removal_ts_map,
    _build_teacher_token_timestamps,
    _build_token_secprefix_map,
    _refresh_missing_timestamps,
    _upgrade_secprefix,
)

from .folder_utils import CODE_EXTS


def _remap_marks_to_utf16(
    diff_marks: dict,
    teacher_files: Dict[str, Path],
    student_files: Dict[str, Path],
) -> dict:
    _maps: Dict[Tuple[int, str], Optional[List[int]]] = {}

    def _map_for(files: Dict[str, Path], fname: Optional[str]) -> Optional[List[int]]:
        if fname is None:
            return None
        cache_key = (id(files), fname)
        if cache_key in _maps:
            return _maps[cache_key]
        u16map: Optional[List[int]] = None
        path = (files or {}).get(fname)
        if path is not None:
            try:
                text = _read_text_normalized(path)
            except Exception:
                text = ''
            if text and any(ord(c) > 0xFFFF for c in text):
                u16map = _build_utf16_map(text)
        _maps[cache_key] = u16map
        return u16map

    def _conv(files: Dict[str, Path], fname: Optional[str], idx):
        u16map = _map_for(files, fname)
        if u16map is None or not isinstance(idx, int):
            return idx
        return u16map[idx] if 0 <= idx < len(u16map) else idx

    def _remap_side(marks_by_file, own_files, partner_files):
        for fname, marks in (marks_by_file or {}).items():
            for mk in marks or []:
                mk['start'] = _conv(own_files, fname, mk.get('start'))
                mk['end'] = _conv(own_files, fname, mk.get('end'))
                pw = mk.get('paired_with')
                if pw and not pw.get('ghost') and pw.get('file') is not None:
                    pw['start'] = _conv(partner_files, pw['file'], pw.get('start'))
                    pw['end'] = _conv(partner_files, pw['file'], pw.get('end'))
                ia = mk.get('insert_at')
                if ia and ia.get('file') is not None:
                    ia['pos'] = _conv(partner_files, ia['file'], ia.get('pos'))
                mv = mk.get('move_to')
                if mv and mv.get('file') is not None:
                    mv['pos'] = _conv(own_files, mv['file'], mv.get('pos'))

    _remap_side(diff_marks.get('teacher_files'), teacher_files, student_files)
    _remap_side(diff_marks.get('student_files'), student_files, teacher_files)

    line_marks = diff_marks.get('line_marks') or {}
    for fname, marks in (line_marks.get('teacher_files') or {}).items():
        for mk in marks or []:
            mk['start'] = _conv(teacher_files, fname, mk.get('start'))
            mk['end'] = _conv(teacher_files, fname, mk.get('end'))
    for fname, marks in (line_marks.get('student_files') or {}).items():
        for mk in marks or []:
            mk['start'] = _conv(student_files, fname, mk.get('start'))
            mk['end'] = _conv(student_files, fname, mk.get('end'))

    return diff_marks


def _build_file_timeline(events: list) -> list:
    timeline = [(0, "MAIN")]
    for event in events:
        ts = event.get("timestamp", 0)
        if "move_to" in event:
            target = event["move_to"]
            if target in ("DEV", "dev"):
                pass
            elif target in ("MAIN", "main"):
                timeline.append((ts, "MAIN"))
            elif any(target.lower().endswith(ext) for ext in CODE_EXTS):
                timeline.append((ts, target))
        elif "switch_editor" in event and event["switch_editor"] not in ("dev", "DEV"):
            timeline.append((ts, "MAIN"))
    return sorted(timeline)


def _file_at_ts(ts: int, timeline: list) -> str:
    idx = bisect.bisect_right(timeline, (ts, "\xff")) - 1
    return timeline[max(0, idx)][1]






_TOKEN_FILE_HEADER_KEYS = ('Occurrences', 'Removed', 'Unique')


def _write_teacher_tokens_file(
    events: list,
    out_path: Path,
    lesson_file: str | None = None,
) -> Tuple[int, int, int]:
    kw_ts, kw_ts_comment, removed_kw_ts, upper_to_display, occ_with_display = (
        reconstruct_tokens_from_keylog_full(events, lesson_file=lesson_file)
    )

    all_occ: List[Tuple[int, int, str, bool, bool]] = []
    for tok in kw_ts:
        occ_sorted = sorted(occ_with_display.get(tok, []))
        comment_ts_set = set(kw_ts_comment.get(tok, []))
        for ts, disp in occ_sorted:
            all_occ.append((ts, 0, disp, ts in comment_ts_set, False))
    for tok, ts_list in removed_kw_ts.items():
        disp = upper_to_display.get(tok, tok)
        for ins_ts, del_ts in ts_list:
            all_occ.append((ins_ts, del_ts, disp, False, True))
    all_occ.sort(key=lambda x: x[0])

    n_typed   = sum(1 for *_, is_removed in all_occ if not is_removed)
    n_removed = sum(1 for *_, is_removed in all_occ if is_removed)
    n_unique  = len(kw_ts)

    file_timeline   = _build_file_timeline(events)
    has_multi_files = bool({f for _, f in file_timeline} - {"MAIN"})

    with open(out_path, 'w', encoding='utf-8') as fh:
        fh.write(f'# Occurrences: {n_typed}\n')
        fh.write(f'# Removed    : {n_removed}\n')
        fh.write(f'# Unique     : {n_unique}\n')
        for ins_ts, del_ts, token, is_comment, is_removed in all_occ:
            flags: List[str] = []
            if is_comment:
                flags.append('COMMENT')
            if is_removed:
                flags.append('REMOVED')
            file_col    = f'\t{_file_at_ts(ins_ts, file_timeline)}' if has_multi_files else ''
            removal_col = f'\t{ts_to_local(del_ts)}' if is_removed else ''
            flag_col    = ('\t' + '\t'.join(flags)) if flags else ''
            fh.write(f'{token}\t{ts_to_local(ins_ts)}{file_col}{flag_col}{removal_col}\n')

    return n_typed, n_removed, n_unique


def _parse_teacher_tokens(
    path: Path,
    *,
    return_headers: bool = False,
):
    entries: List[Tuple[str, str, bool, bool, str]] = []
    headers: Dict[str, int] = {}
    with open(path, encoding='utf-8') as f:
        for line in f:
            stripped = line.rstrip('\n')
            if not stripped:
                continue
            if stripped.startswith('# '):
                if return_headers:
                    for key in _TOKEN_FILE_HEADER_KEYS:
                        if stripped.startswith(f'# {key}'):
                            headers[key] = int(stripped.split(':')[1].strip())
                continue
            parts = stripped.split('\t')
            tok    = parts[0]
            ts_str = parts[1] if len(parts) > 1 else ''
            flags  = set(parts[2:]) if len(parts) > 2 else set()
            is_removed = 'REMOVED' in flags
            removal_ts_str = ''
            if is_removed:
                try:
                    removed_idx = parts.index('REMOVED')
                    if removed_idx + 1 < len(parts):
                        removal_ts_str = parts[removed_idx + 1]
                except ValueError:
                    pass
            entries.append((tok, ts_str, 'COMMENT' in flags, is_removed, removal_ts_str))
    if return_headers:
        return headers, entries
    return entries



def _build_leo_diff_marks(
    teacher_files: dict,
    student_files: dict,
    context_k: int = _CONTEXT_K,
    events: Optional[list] = None,
) -> Tuple[dict, dict, Optional[float], dict, dict, int, dict]:
    teacher_ghosts = _collect_teacher_ghosts(events) if events else None
    teacher_colors, student_colors, n_total, n_missing, assignments = (
        _compute_per_token_matching(
            teacher_files, student_files, context_k,
            teacher_ghosts=teacher_ghosts or None,
        )
    )
    teacher_result = _colors_to_position_marks(
        teacher_files, _prune_color_map(teacher_colors),
    )
    student_result = _colors_to_position_marks(
        student_files, _prune_color_map(student_colors),
    )
    _apply_swap_pairing_to_marks(
        teacher_result, student_result, teacher_files, student_files,
    )
    _apply_insert_at_to_unpaired_missings(
        teacher_result, student_result, teacher_files, student_files,
    )
    score = round((n_total - n_missing) / n_total * 100, 1) if n_total else None
    return teacher_result, student_result, score, {}, {}, n_total, assignments



def _diff_line_pair_tokens(t_line: str, t_off: int, s_line: str, s_off: int,
                            tok_all_positions: Dict[str, List[int]],
                            s_fname: Optional[str] = None,
                            ) -> Tuple[List[dict], List[dict]]:
    teacher_tok_matches = list(_sm._CHAR_TOKEN_RE.finditer(t_line))
    student_tok_matches = list(_sm._CHAR_TOKEN_RE.finditer(s_line))
    matcher = difflib.SequenceMatcher(
        None,
        [tm.group() for tm in teacher_tok_matches],
        [sm.group() for sm in student_tok_matches],
        autojunk=False,
    )
    teacher_marks: List[dict] = []
    student_marks: List[dict] = []
    for tag, t_lo, t_hi, s_lo, s_hi in matcher.get_opcodes():
        if tag == 'equal':
            continue
        if tag in ('delete', 'replace'):
            if s_fname is not None:
                insert_pos = (
                    s_off + student_tok_matches[s_lo].start()
                    if s_lo < len(student_tok_matches) else s_off + len(s_line)
                )
                native_anchor = {'file': s_fname, 'pos': insert_pos}
            else:
                native_anchor = None
            for ti in range(t_lo, t_hi):
                tok_match = teacher_tok_matches[ti]
                mark = _missing_mark(
                    t_off + tok_match.start(), tok_match.group(), tok_all_positions,
                )
                if native_anchor is not None:
                    mark['_native_insert_at'] = native_anchor
                teacher_marks.append(mark)
        if tag in ('insert', 'replace'):
            for sj in range(s_lo, s_hi):
                tok_match = student_tok_matches[sj]
                student_marks.append(_extra_mark(s_off + tok_match.start(), tok_match.group()))
    return teacher_marks, student_marks


def _line_anchors_from_alignment(
    alignment: list, student_line_offsets: List[int], student_text_len: int,
) -> Dict[int, int]:
    anchors: Dict[int, int] = {}
    next_student_pos = student_text_len
    for entry in reversed(alignment):
        t_line, s_line = entry[0], entry[1]
        if s_line is not None:
            next_student_pos = (
                student_line_offsets[s_line]
                if s_line < len(student_line_offsets) else student_text_len
            )
        elif t_line is not None:
            anchors[t_line] = next_student_pos
    return anchors


def _stamp_native_line_insert_at(
    teacher_marks: List[dict], teacher_line_offsets: List[int],
    line_anchors: Dict[int, int], student_fname: str,
) -> None:
    if not line_anchors:
        return
    for mark in teacher_marks:
        if mark.get('label') != 'missing':
            continue
        if mark.get('_native_insert_at') is not None:
            continue
        line_idx = bisect.bisect_right(teacher_line_offsets, mark['start']) - 1
        if line_idx in line_anchors:
            mark['_native_insert_at'] = {
                'file': student_fname, 'pos': line_anchors[line_idx],
            }


def _shift_inserts_past_comments(
    teacher_marks: List[dict], student_fname: str, student_text: str,
    student_comment_ranges: List[Tuple[int, int]],
) -> None:
    if not student_comment_ranges:
        return
    text_len = len(student_text)
    for mark in teacher_marks:
        if mark.get('label') != 'missing':
            continue
        for field in ('_native_insert_at', 'insert_at'):
            anchor = mark.get(field)
            if not anchor or anchor.get('file') != student_fname:
                continue
            pos = anchor.get('pos')
            if pos is None:
                continue
            for cm_start, cm_end in student_comment_ranges:
                if cm_start <= pos <= cm_end:
                    new_pos = cm_end
                    if new_pos < text_len and student_text[new_pos] == '\n':
                        new_pos += 1
                    anchor['pos'] = new_pos
                    break
                if pos < cm_start:
                    break


def _add_unpaired_teacher_line(alignment, teacher_marks, teacher_line_marks,
                                teacher_lines, teacher_line_offsets, teacher_line_idx,
                                all_token_positions) -> None:
    alignment.append([teacher_line_idx, None])
    if teacher_line_idx >= len(teacher_lines):
        return
    line_mark = _make_line_mark(
        teacher_lines, teacher_line_offsets, teacher_line_idx, 'missing',
    )
    if line_mark:
        teacher_line_marks.append(line_mark)
    line_offset = (
        teacher_line_offsets[teacher_line_idx]
        if teacher_line_idx < len(teacher_line_offsets) else 0
    )
    teacher_marks.extend(_line_token_marks(
        teacher_lines[teacher_line_idx], line_offset, 'teacher', all_token_positions,
    ))


def _add_unpaired_student_line(alignment, student_marks, student_line_marks,
                                student_lines, student_line_offsets,
                                student_line_idx) -> None:
    alignment.append([None, student_line_idx])
    if student_line_idx >= len(student_lines):
        return
    line_mark = _make_line_mark(
        student_lines, student_line_offsets, student_line_idx, 'extra',
    )
    if line_mark:
        student_line_marks.append(line_mark)
    line_offset = (
        student_line_offsets[student_line_idx]
        if student_line_idx < len(student_line_offsets) else 0
    )
    student_marks.extend(_line_token_marks(
        student_lines[student_line_idx], line_offset, 'student',
    ))


def _add_paired_line_block(alignment, teacher_marks, student_marks,
                            teacher_lines, student_lines,
                            teacher_line_offsets, student_line_offsets,
                            teacher_start, student_start, n_paired,
                            all_token_positions,
                            s_fname=None) -> None:
    for k in range(n_paired):
        t_line, s_line = teacher_start + k, student_start + k
        alignment.append([t_line, s_line])
        if t_line >= len(teacher_lines) or s_line >= len(student_lines):
            continue
        t_off = (
            teacher_line_offsets[t_line]
            if t_line < len(teacher_line_offsets) else 0
        )
        s_off = (
            student_line_offsets[s_line]
            if s_line < len(student_line_offsets) else 0
        )
        line_t_marks, line_s_marks = _diff_line_pair_tokens(
            teacher_lines[t_line], t_off, student_lines[s_line], s_off,
            all_token_positions, s_fname=s_fname,
        )
        teacher_marks.extend(line_t_marks)
        student_marks.extend(line_s_marks)


def _add_replace_block(alignment, teacher_marks, student_marks,
                        teacher_line_marks, student_line_marks,
                        teacher_lines, student_lines,
                        teacher_line_offsets, student_line_offsets,
                        teacher_start, n_teacher_lines,
                        student_start, n_student_lines,
                        all_token_positions, s_fname=None) -> None:
    n_paired = min(n_teacher_lines, n_student_lines)
    _add_paired_line_block(alignment, teacher_marks, student_marks,
                            teacher_lines, student_lines,
                            teacher_line_offsets, student_line_offsets,
                            teacher_start, student_start, n_paired,
                            all_token_positions, s_fname=s_fname)
    for k in range(n_paired, n_teacher_lines):
        _add_unpaired_teacher_line(alignment, teacher_marks, teacher_line_marks,
                                    teacher_lines, teacher_line_offsets,
                                    teacher_start + k, all_token_positions)
    for k in range(n_paired, n_student_lines):
        _add_unpaired_student_line(alignment, student_marks, student_line_marks,
                                    student_lines, student_line_offsets,
                                    student_start + k)


def _finalize_per_file_diff(per_file_results, n_total
                             ) -> Tuple[Dict[str, List[dict]], Dict[str, List[dict]],
                                        Optional[float], Dict[str, list], dict, int]:
    teacher_result: Dict[str, List[dict]] = {}
    student_result: Dict[str, List[dict]] = {}
    alignments: Dict[str, list] = {}
    teacher_line_marks_by_file: Dict[str, List[dict]] = {}
    student_line_marks_by_file: Dict[str, List[dict]] = {}

    for entry in per_file_results:
        (teacher_fname, student_fname,
         teacher_marks, student_marks,
         teacher_line_marks, student_line_marks,
         alignment) = entry
        if teacher_marks:
            teacher_result[teacher_fname] = teacher_marks
        if student_marks:
            student_result[student_fname] = student_marks
        if teacher_line_marks:
            teacher_line_marks_by_file[teacher_fname] = teacher_line_marks
        if student_line_marks:
            student_line_marks_by_file[student_fname] = student_line_marks
        if alignment is not None:
            alignments[teacher_fname] = alignment
            if student_fname != teacher_fname:
                alignments[student_fname] = alignment

    n_missing = sum(
        1 for marks in teacher_result.values()
        for mark in marks if mark.get('label') == 'missing'
    )
    score = round((n_total - n_missing) / n_total * 100, 1) if n_total else None
    line_marks: dict = {}
    if teacher_line_marks_by_file:
        line_marks['teacher_files'] = teacher_line_marks_by_file
    if student_line_marks_by_file:
        line_marks['student_files'] = student_line_marks_by_file
    return teacher_result, student_result, score, alignments, line_marks, n_total


def _lcs_opcodes(a: List[str], b: List[str]):
    return difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes()


def _levenshtein_opcodes(a: List[str], b: List[str]):
    m, n = len(a), len(b)
    if m == 0:
        return [('insert', 0, 0, j, j + 1) for j in range(n)]
    if n == 0:
        return [('delete', i, i + 1, 0, 0) for i in range(m)]

    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(m + 1):
        dp[i][0] = i
    for j in range(n + 1):
        dp[0][j] = j
    for i in range(1, m + 1):
        ai = a[i - 1]
        prev = dp[i - 1]
        cur = dp[i]
        for j in range(1, n + 1):
            if ai == b[j - 1]:
                cur[j] = prev[j - 1]
            else:
                cur[j] = 1 + min(prev[j - 1], prev[j], cur[j - 1])

    ops: List[Tuple[str, int, int, int, int]] = []
    i, j = m, n
    while i > 0 or j > 0:
        if i > 0 and j > 0 and a[i - 1] == b[j - 1]:
            ops.append(('equal', i - 1, i, j - 1, j)); i -= 1; j -= 1
        elif i > 0 and j > 0 and dp[i][j] == dp[i - 1][j - 1] + 1:
            ops.append(('replace', i - 1, i, j - 1, j)); i -= 1; j -= 1
        elif i > 0 and dp[i][j] == dp[i - 1][j] + 1:
            ops.append(('delete', i - 1, i, j, j)); i -= 1
        else:
            ops.append(('insert', i, i, j - 1, j)); j -= 1
    ops.reverse()
    return ops


def _build_token_seq_diff_marks(
    teacher_files: Dict[str, Path],
    student_files: Dict[str, Path],
    opcodes_fn,
) -> Tuple[Dict[str, List[dict]], Dict[str, List[dict]], Optional[float], Dict[str, list], dict, int]:
    teacher_result: Dict[str, List[dict]] = {}
    student_result: Dict[str, List[dict]] = {}
    n_total = 0
    n_missing = 0

    for teacher_filepath, teacher_path, student_path in _match_files_by_name_then_ext(teacher_files, student_files):
        teacher_text = _read_text_normalized(teacher_path)
        student_text = _read_text_normalized(student_path) if student_path else ''
        if not teacher_text:
            continue

        ext = Path(teacher_filepath).suffix.lower()
        teacher_noncomment_toks, teacher_comment_toks = _split_tokens_by_comment(teacher_text, ext)
        student_noncomment_toks, student_comment_toks = _split_tokens_by_comment(student_text, ext)
        all_token_positions, _ = _build_token_position_index(teacher_text, ext)

        teacher_seq = [tok for _, tok in teacher_noncomment_toks]
        student_seq = [tok for _, tok in student_noncomment_toks]
        n_total += len(teacher_seq)

        teacher_fname = Path(teacher_filepath).name
        student_fname = student_path.name if student_path else teacher_fname
        stamp_native_anchor = student_path is not None

        teacher_marks: List[dict] = []
        student_marks: List[dict] = []
        for tag, t_lo, t_hi, s_lo, s_hi in opcodes_fn(teacher_seq, student_seq):
            if tag == 'equal':
                continue
            if tag in ('delete', 'replace'):
                n_missing += t_hi - t_lo
                if stamp_native_anchor:
                    insert_pos = (
                        student_noncomment_toks[s_lo][0]
                        if s_lo < len(student_noncomment_toks)
                        else len(student_text)
                    )
                    native_anchor = {'file': student_fname, 'pos': insert_pos}
                else:
                    native_anchor = None
                for i in range(t_lo, t_hi):
                    pos, tok = teacher_noncomment_toks[i]
                    mark = _missing_mark(pos, tok, all_token_positions)
                    if native_anchor is not None:
                        mark['_native_insert_at'] = native_anchor
                    teacher_marks.append(mark)
            if tag in ('insert', 'replace'):
                for j in range(s_lo, s_hi):
                    pos, tok = student_noncomment_toks[j]
                    student_marks.append(_extra_mark(pos, tok))

        for pos, tok in teacher_comment_toks:
            teacher_marks.append(_comment_pos_mark(pos, tok))
        for pos, tok in student_comment_toks:
            student_marks.append(_comment_pos_mark(pos, tok))

        if teacher_marks:
            teacher_result[teacher_fname] = sorted(teacher_marks, key=lambda x: x['start'])
        if student_marks:
            student_result[student_fname] = sorted(student_marks, key=lambda x: x['start'])

    score = round((n_total - n_missing) / n_total * 100, 1) if n_total else None
    return teacher_result, student_result, score, {}, {}, n_total


def _build_lcs_token_diff_marks(
    teacher_files: Dict[str, Path],
    student_files: Dict[str, Path],
) -> Tuple[Dict[str, List[dict]], Dict[str, List[dict]], Optional[float], Dict[str, list], dict, int]:
    return _build_token_seq_diff_marks(teacher_files, student_files, _lcs_opcodes)


def _build_lev_token_diff_marks(
    teacher_files: Dict[str, Path],
    student_files: Dict[str, Path],
) -> Tuple[Dict[str, List[dict]], Dict[str, List[dict]], Optional[float], Dict[str, list], dict, int]:
    return _build_token_seq_diff_marks(teacher_files, student_files, _levenshtein_opcodes)
















def _build_ro_diff_marks(
    teacher_files: Dict[str, Path],
    student_files: Dict[str, Path],
) -> Tuple[Dict[str, List[dict]], Dict[str, List[dict]], Optional[float], Dict[str, list], dict, int]:
    n_total = 0
    per_file_results: List[tuple] = []

    for teacher_filepath, teacher_path, student_path in _match_files_by_name_then_ext(teacher_files, student_files):
        teacher_orig = _read_text_normalized(teacher_path)
        student_orig = _read_text_normalized(student_path) if student_path else ''
        if not teacher_orig:
            continue

        ext = Path(teacher_filepath).suffix.lower()
        teacher_blanked = _sm.blank_comments(teacher_orig, ext)
        student_blanked = _sm.blank_comments(student_orig, ext) if student_orig else ''

        teacher_lines = teacher_blanked.splitlines()
        student_lines = student_blanked.splitlines()
        teacher_line_offsets = _line_start_offsets(teacher_blanked)
        student_line_offsets = _line_start_offsets(student_blanked) if student_blanked else []

        all_token_positions, file_token_count = _build_token_position_index(teacher_blanked, ext)
        n_total += file_token_count

        teacher_fname  = Path(teacher_filepath).name
        student_fname  = student_path.name if student_path else teacher_fname
        student_fname_for_native = student_fname if student_path is not None else None

        teacher_marks:      List[dict] = []
        student_marks:      List[dict] = []
        teacher_line_marks: List[dict] = []
        student_line_marks: List[dict] = []
        alignment:          list       = []

        for tag, t_lo, t_hi, s_lo, s_hi in difflib.SequenceMatcher(
            None,
            [line.strip() for line in teacher_lines],
            [line.strip() for line in student_lines],
            autojunk=False,
        ).get_opcodes():
            if tag == 'equal':
                for k in range(t_hi - t_lo):
                    alignment.append([t_lo + k, s_lo + k])
            elif tag == 'delete':
                for line_i in range(t_lo, t_hi):
                    _add_unpaired_teacher_line(alignment, teacher_marks, teacher_line_marks,
                                                teacher_lines, teacher_line_offsets,
                                                line_i, all_token_positions)
            elif tag == 'insert':
                for line_j in range(s_lo, s_hi):
                    _add_unpaired_student_line(alignment, student_marks, student_line_marks,
                                                student_lines, student_line_offsets, line_j)
            elif tag == 'replace':
                _add_replace_block(alignment, teacher_marks, student_marks,
                                    teacher_line_marks, student_line_marks,
                                    teacher_lines, student_lines,
                                    teacher_line_offsets, student_line_offsets,
                                    t_lo, t_hi - t_lo, s_lo, s_hi - s_lo,
                                    all_token_positions,
                                    s_fname=student_fname_for_native)

        student_comment_ranges: List[Tuple[int, int]] = []
        if student_orig:
            cm_starts, cm_ends = _sm._comment_ranges(student_orig, ext)
            student_comment_ranges = list(zip(cm_starts, cm_ends))

        if student_fname_for_native is not None:
            anchors = _line_anchors_from_alignment(
                alignment, student_line_offsets, len(student_blanked),
            )
            _stamp_native_line_insert_at(
                teacher_marks, teacher_line_offsets, anchors, student_fname_for_native,
            )
            _shift_inserts_past_comments(
                teacher_marks, student_fname_for_native, student_orig, student_comment_ranges,
            )

        _, teacher_comment_toks = _split_tokens_by_comment(teacher_orig, ext)
        _, student_comment_toks = (
            _split_tokens_by_comment(student_orig, ext) if student_orig else ([], [])
        )
        for pos, tok in teacher_comment_toks:
            teacher_marks.append(_comment_pos_mark(pos, tok))
        for pos, tok in student_comment_toks:
            student_marks.append(_comment_pos_mark(pos, tok))
        teacher_marks.sort(key=lambda m: m['start'])
        student_marks.sort(key=lambda m: m['start'])

        per_file_results.append((
            teacher_fname, student_fname, teacher_marks, student_marks,
            teacher_line_marks, student_line_marks, alignment,
        ))

    return _finalize_per_file_diff(per_file_results, n_total)


import subprocess as _subprocess
import re as _re
import tempfile as _tempfile
import os as _os

_GIT_HUNK_RE = _re.compile(r'^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@')


def _parse_git_hunks(stdout: str) -> List[Tuple[int, int, int, int]]:
    hunks: List[Tuple[int, int, int, int]] = []
    for line in stdout.splitlines():
        m = _GIT_HUNK_RE.match(line)
        if m:
            i1 = int(m.group(1))
            ic = int(m.group(2)) if m.group(2) is not None else 1
            j1 = int(m.group(3))
            jc = int(m.group(4)) if m.group(4) is not None else 1
            hunks.append((i1, ic, j1, jc))
    return hunks


def _git_diff_hunks_text(t_text: str, s_text: str,
                          ext: Optional[str] = None) -> List[Tuple[int, int, int, int]]:
    suffix = ext or ''
    t_fd, t_path_str = _tempfile.mkstemp(suffix=suffix, prefix='git_diff_t_')
    s_fd, s_path_str = _tempfile.mkstemp(suffix=suffix, prefix='git_diff_s_')
    try:
        with _os.fdopen(t_fd, 'w', encoding='utf-8', newline='') as f:
            f.write(t_text)
        with _os.fdopen(s_fd, 'w', encoding='utf-8', newline='') as f:
            f.write(s_text)
        result = _subprocess.run(
            ['git', 'diff', '--no-index', '--unified=0', '-w',
             t_path_str, s_path_str],
            capture_output=True, text=True, encoding='utf-8',
        )
        return _parse_git_hunks(result.stdout)
    finally:
        for p in (t_path_str, s_path_str):
            try:
                _os.unlink(p)
            except OSError:
                pass


def _build_git_diff_marks(
    teacher_files: Dict[str, Path],
    student_files: Dict[str, Path],
) -> Tuple[Dict[str, List[dict]], Dict[str, List[dict]], Optional[float], Dict[str, list], dict, int]:
    n_total = 0
    per_file_results: List[tuple] = []

    for teacher_filepath, teacher_path, student_path in _match_files_by_name_then_ext(teacher_files, student_files):
        teacher_orig = _read_text_normalized(teacher_path)
        student_orig = _read_text_normalized(student_path) if student_path else ''
        if not teacher_orig:
            continue

        ext = Path(teacher_filepath).suffix.lower()
        teacher_blanked = _sm.blank_comments(teacher_orig, ext)
        student_blanked = _sm.blank_comments(student_orig, ext) if student_orig else ''

        teacher_lines = teacher_blanked.splitlines()
        student_lines = student_blanked.splitlines()
        teacher_line_offsets = _line_start_offsets(teacher_blanked)
        student_line_offsets = _line_start_offsets(student_blanked) if student_blanked else []

        all_token_positions, file_token_count = _build_token_position_index(teacher_blanked, ext)
        n_total += file_token_count

        teacher_fname  = Path(teacher_filepath).name
        student_fname  = student_path.name if student_path else teacher_fname
        student_fname_for_native = student_fname if student_path is not None else None

        teacher_marks:      List[dict] = []
        student_marks:      List[dict] = []
        teacher_line_marks: List[dict] = []
        student_line_marks: List[dict] = []
        alignment:          list       = []

        hunks = (
            _git_diff_hunks_text(teacher_blanked, student_blanked, ext)
            if student_path else []
        )
        teacher_cursor = student_cursor = 0

        for hunk_t_first_raw, n_changed_t, hunk_s_first_raw, n_changed_s in hunks:
            teacher_replace_start = (
                hunk_t_first_raw - 1 if n_changed_t > 0 else hunk_t_first_raw
            )
            student_replace_start = (
                hunk_s_first_raw - 1 if n_changed_s > 0 else hunk_s_first_raw
            )
            n_equal_lines = teacher_replace_start - teacher_cursor
            _add_paired_line_block(alignment, teacher_marks, student_marks,
                                    teacher_lines, student_lines,
                                    teacher_line_offsets, student_line_offsets,
                                    teacher_cursor, student_cursor, n_equal_lines,
                                    all_token_positions,
                                    s_fname=student_fname_for_native)
            teacher_cursor += n_equal_lines
            student_cursor += n_equal_lines

            _add_replace_block(alignment, teacher_marks, student_marks,
                                teacher_line_marks, student_line_marks,
                                teacher_lines, student_lines,
                                teacher_line_offsets, student_line_offsets,
                                teacher_replace_start, n_changed_t,
                                student_replace_start, n_changed_s,
                                all_token_positions,
                                s_fname=student_fname_for_native)
            teacher_cursor = teacher_replace_start + n_changed_t
            student_cursor = student_replace_start + n_changed_s

        n_tail_paired = min(len(teacher_lines) - teacher_cursor,
                            len(student_lines) - student_cursor)
        _add_paired_line_block(alignment, teacher_marks, student_marks,
                                teacher_lines, student_lines,
                                teacher_line_offsets, student_line_offsets,
                                teacher_cursor, student_cursor, n_tail_paired,
                                all_token_positions,
                                s_fname=student_fname_for_native)
        teacher_cursor += n_tail_paired
        student_cursor += n_tail_paired
        while teacher_cursor < len(teacher_lines):
            _add_unpaired_teacher_line(alignment, teacher_marks, teacher_line_marks,
                                        teacher_lines, teacher_line_offsets,
                                        teacher_cursor, all_token_positions)
            teacher_cursor += 1
        while student_cursor < len(student_lines):
            _add_unpaired_student_line(alignment, student_marks, student_line_marks,
                                        student_lines, student_line_offsets,
                                        student_cursor)
            student_cursor += 1

        student_comment_ranges: List[Tuple[int, int]] = []
        if student_orig:
            cm_starts, cm_ends = _sm._comment_ranges(student_orig, ext)
            student_comment_ranges = list(zip(cm_starts, cm_ends))

        if student_fname_for_native is not None:
            anchors = _line_anchors_from_alignment(
                alignment, student_line_offsets, len(student_blanked),
            )
            _stamp_native_line_insert_at(
                teacher_marks, teacher_line_offsets, anchors, student_fname_for_native,
            )
            _shift_inserts_past_comments(
                teacher_marks, student_fname_for_native, student_orig, student_comment_ranges,
            )

        _, teacher_comment_toks = _split_tokens_by_comment(teacher_orig, ext)
        _, student_comment_toks = (
            _split_tokens_by_comment(student_orig, ext) if student_orig else ([], [])
        )
        for pos, tok in teacher_comment_toks:
            teacher_marks.append(_comment_pos_mark(pos, tok))
        for pos, tok in student_comment_toks:
            student_marks.append(_comment_pos_mark(pos, tok))
        teacher_marks.sort(key=lambda m: m['start'])
        student_marks.sort(key=lambda m: m['start'])

        per_file_results.append((
            teacher_fname, student_fname, teacher_marks, student_marks,
            teacher_line_marks, student_line_marks, alignment,
        ))

    return _finalize_per_file_diff(per_file_results, n_total)

