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


_FILE_EXTS = (".js", ".css", ".html", ".htm")


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
            elif any(target.lower().endswith(ext) for ext in _FILE_EXTS):
                timeline.append((ts, target))
        elif "switch_editor" in event and event["switch_editor"] not in ("dev", "DEV"):
            timeline.append((ts, "MAIN"))
    return sorted(timeline)


def _file_at_ts(ts: int, timeline: list) -> str:
    idx = bisect.bisect_right(timeline, (ts, "\xff")) - 1
    return timeline[max(0, idx)][1]


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


_TOKEN_FILE_HEADER_KEYS = ('Occurrences', 'Removed', 'Unique')


def _write_teacher_tokens_file(
    events: list,
    out_path: Path,
) -> Tuple[int, int, int]:
    kw_ts, kw_ts_comment, removed_kw_ts, upper_to_display, occ_with_display = (
        reconstruct_tokens_from_keylog_full(events)
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


def _scan_file_tokens(text: str, ext=None) -> Dict[str, List[Tuple[int, bool]]]:
    result: Dict[str, List[Tuple[int, bool]]] = {}
    for pos, tok, is_comment in _sm.iter_code_tokens(text, ext):
        result.setdefault(tok, []).append((pos, is_comment))
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

    stats = _summarize_occurrence_flags(all_occurrences)
    teacher_total_e = stats['n_found_e'] + stats['n_missing_e']
    score_e = (round(max(0.0, (stats['n_found_e'] - stats['n_ghost_extra']) / teacher_total_e * 100), 1)
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


_CONTEXT_K = 10
_CONTEXT_MATCH_THRESHOLD = 0.8
_SWAP_TOKEN_SIM_WEIGHT = 0.2


def _build_stripped_view(
    teacher_seq_aug: list,
) -> Tuple[List[str], List[int], List[bool]]:
    stripped_seq: List[str] = []
    aug_to_stripped: List[int] = []
    is_ghost_at: List[bool] = []
    for t in teacher_seq_aug:
        gho = not isinstance(t, str)
        is_ghost_at.append(gho)
        aug_to_stripped.append(len(stripped_seq))
        if not gho:
            stripped_seq.append(t)
    return stripped_seq, aug_to_stripped, is_ghost_at


def _context_vector_split(
    tokens_seq: List[str],
    pos: int,
    k: int,
) -> Tuple[Counter, Counter]:
    left: Counter = Counter()
    for i in range(max(0, pos - k), pos):
        left[tokens_seq[i]] += 1
    right: Counter = Counter()
    for i in range(pos + 1, min(len(tokens_seq), pos + k + 1)):
        right[tokens_seq[i]] += 1
    return left, right


def _stripped_context_vector_split(
    stripped_seq: List[str],
    anchor_idx: int,
    anchor_is_ghost: bool,
    k: int,
) -> Tuple[Counter, Counter]:
    left: Counter = Counter()
    right: Counter = Counter()
    n = len(stripped_seq)
    if anchor_is_ghost:
        for off in range(1, k + 1):
            i = anchor_idx - off
            if i < 0:
                break
            left[stripped_seq[i]] += 1
        for off in range(1, k + 1):
            i = anchor_idx - 1 + off
            if i >= n:
                break
            right[stripped_seq[i]] += 1
    else:
        for i in range(max(0, anchor_idx - k), anchor_idx):
            left[stripped_seq[i]] += 1
        for i in range(anchor_idx + 1, min(n, anchor_idx + k + 1)):
            right[stripped_seq[i]] += 1
    return left, right


def _vec_norm(v: Counter) -> float:
    if not v:
        return 0.0
    return math.sqrt(sum(x * x for x in v.values()))


def _cosine_with_norms(v1: Counter, n1: float, v2: Counter, n2: float) -> float:
    if not v1 or not v2 or n1 == 0 or n2 == 0:
        return 0.0
    dot = sum(v1[k] * v2.get(k, 0) for k in v1)
    if dot == 0:
        return 0.0
    return dot / (n1 * n2)


def _context_vector_pack(
    tokens_seq: List[str], pos: int, k: int,
) -> Tuple[Counter, Counter, float, float]:
    left, right = _context_vector_split(tokens_seq, pos, k)
    return (left, right, _vec_norm(left), _vec_norm(right))


def _stripped_context_vector_pack(
    stripped_seq: List[str], anchor_idx: int, anchor_is_ghost: bool, k: int,
) -> Tuple[Counter, Counter, float, float]:
    left, right = _stripped_context_vector_split(
        stripped_seq, anchor_idx, anchor_is_ghost, k,
    )
    return (left, right, _vec_norm(left), _vec_norm(right))


def _combined_context_score(s_pack: tuple, t_pack: tuple) -> float:
    s_left, s_right, sn_l, sn_r = s_pack
    t_left, t_right, tn_l, tn_r = t_pack
    cos_left  = _cosine_with_norms(s_left,  sn_l, t_left,  tn_l)
    cos_right = _cosine_with_norms(s_right, sn_r, t_right, tn_r)
    return 0.3 * min(cos_left, cos_right) + 0.7 * max(cos_left, cos_right)


def _hungarian_max(weights: List[List[float]]) -> List[Tuple[int, int]]:
    n = len(weights)
    m = len(weights[0]) if n else 0
    if n == 0 or m == 0:
        return []
    if n == 1:
        j = max(range(m), key=lambda c: weights[0][c])
        return [(0, j)]
    if m == 1:
        i = max(range(n), key=lambda r: weights[r][0])
        return [(i, 0)]
    rows, cols = linear_sum_assignment(-np.array(weights))
    return list(zip(rows.tolist(), cols.tolist()))


def _collect_teacher_ghosts(events: list) -> Dict[str, list]:
    if not events:
        return {}
    out: Dict[str, list] = {}
    for tab_key, info in reconstruct_all_with_ghosts(events).items():
        if not info['ghosts']:
            continue
        fname = 'reconstructed.html' if tab_key == 'MAIN' else tab_key
        out[fname] = info['ghosts']
    return out


def _pairwise_context_sim(
    s_seq: List[str],
    s_positions: List[int],
    t_seq: List[str],
    t_positions: List[int],
    k: int,
    *,
    t_alt_packs: Optional[List[Optional[tuple]]] = None,
) -> List[List[float]]:
    """Return the |s|×|t| matrix of combined-context cosine scores.

    Single source of truth for "build context packs from positions and
    score every pair." Used by `_locate_token` (LEO base Hungarian),
    `_apply_ghost_extra_promotion` (post-pass Hungarian), and
    `_apply_swap_pairing_to_marks` (greedy swap matcher).

    `t_alt_packs[j]` (optional, len = |t|) is a second pack for teacher
    column j; when present and non-None the per-cell score is the max
    of the two cosines (used by LEO's stripped-view shaping).
    """
    if not s_positions or not t_positions:
        return []
    s_packs = [_context_vector_pack(s_seq, p, k) for p in s_positions]
    t_packs = [_context_vector_pack(t_seq, p, k) for p in t_positions]
    n_s, n_t = len(s_positions), len(t_positions)
    if t_alt_packs is not None:
        return [
            [
                _combined_context_score(s_packs[i], t_packs[j])
                if t_alt_packs[j] is None
                else max(
                    _combined_context_score(s_packs[i], t_packs[j]),
                    _combined_context_score(s_packs[i], t_alt_packs[j]),
                )
                for j in range(n_t)
            ]
            for i in range(n_s)
        ]
    return [
        [_combined_context_score(s_packs[i], t_packs[j]) for j in range(n_t)]
        for i in range(n_s)
    ]


def _locate_token(
    s_positions: List[int],
    t_positions: List[int],
    s_seq: List[str],
    t_seq: List[str],
    k: int,
    *,
    t_alt_packs: Optional[List[Optional[tuple]]] = None,
) -> Tuple[List[Tuple[int, int]], List[List[float]]]:
    sim = _pairwise_context_sim(s_seq, s_positions, t_seq, t_positions, k,
                                t_alt_packs=t_alt_packs)
    if not sim:
        return [], []
    pairs = _hungarian_max(sim)
    return pairs, sim


def _collect_occurrences(files_by_ext: dict, token_keys: set = None) -> Tuple[List[dict], Dict[str, Dict[str, int]]]:
    occurrences: List[dict] = []
    counts: Dict[str, Dict[str, int]] = {}

    for file_order, (name, path) in enumerate(files_by_ext.items()):
        ext = Path(name).suffix.lower()
        try:
            raw_text = path.read_text(encoding='utf-8', errors='ignore')
        except Exception:
            continue
        token_positions_by_file = _scan_file_tokens(raw_text, ext)
        fname = path.name

        for tok in (token_keys if token_keys is not None else token_positions_by_file.keys()):
            positions = token_positions_by_file.get(tok)
            if not positions:
                continue
            counts.setdefault(fname, {})[tok] = len(positions)
            for file_idx, (pos, is_comment) in enumerate(positions):
                occurrences.append({
                    'file': fname,
                    'token': tok,
                    'file_idx': file_idx,
                    'pos': pos,
                    'is_comment': is_comment,
                    'file_order': file_order,
                    'seq_idx': -1,
                })

    occurrences.sort(key=lambda o: (o['file_order'], o['pos'], o['token']))
    noncomment_seq = []
    for occurrence in occurrences:
        if not occurrence['is_comment']:
            occurrence['seq_idx'] = len(noncomment_seq)
            noncomment_seq.append(occurrence['token'])
    return occurrences, counts


def _prune_color_map(file_map: dict) -> dict:
    out = {}
    for fn, toks in file_map.items():
        kept = {tok: arr for tok, arr in toks.items() if any(x is not None for x in arr)}
        if kept:
            out[fn] = kept
    return out


def _compute_per_token_matching(
    teacher_files: dict,
    student_files: dict,
    context_k: int,
    teacher_ghosts: Optional[Dict[str, list]] = None,
) -> Tuple[dict, dict, int, int, dict]:
    teacher_occurrences, teacher_counts = _collect_occurrences(teacher_files)
    student_occurrences, student_counts = _collect_occurrences(student_files)

    token_keys = (
        {occurrence['token'] for occurrence in teacher_occurrences} |
        {occurrence['token'] for occurrence in student_occurrences}
    )

    teacher_by_token: Dict[str, List[dict]] = {}
    for occurrence in teacher_occurrences:
        teacher_by_token.setdefault(occurrence['token'], []).append(occurrence)
    student_by_token: Dict[str, List[dict]] = {}
    for occurrence in student_occurrences:
        student_by_token.setdefault(occurrence['token'], []).append(occurrence)

    teacher_seq = [occurrence['token'] for occurrence in teacher_occurrences if not occurrence['is_comment']]
    student_seq = [occurrence['token'] for occurrence in student_occurrences if not occurrence['is_comment']]

    teacher_seq_aug: Optional[list] = None
    seq_idx_to_aug: Optional[Dict[int, int]] = None
    teacher_match_seq = teacher_seq
    ghost_instances: List[dict] = []
    ghost_by_token: Dict[str, List[dict]] = {}
    stripped_view: Optional[Tuple[List[str], List[int], List[bool]]] = None
    if teacher_ghosts:
        teacher_seq_aug, seq_idx_to_aug, ghost_instances = _build_teacher_seq_aug(
            teacher_occurrences, teacher_ghosts,
        )
        teacher_match_seq = [
            t if isinstance(t, str) else t[0] for t in teacher_seq_aug
        ]
        for ghost_inst in ghost_instances:
            ghost_by_token.setdefault(ghost_inst['token'], []).append(ghost_inst)
        if any(not isinstance(t, str) for t in teacher_seq_aug):
            stripped_view = _build_stripped_view(teacher_seq_aug)

    teacher_colors = {
        fname: {tok: [None] * n for tok, n in toks.items()}
        for fname, toks in teacher_counts.items()
    }
    student_colors = {
        fname: {tok: [None] * n for tok, n in toks.items()}
        for fname, toks in student_counts.items()
    }

    tokens_data: Dict[str, dict] = {}
    n_total = 0
    n_missing = 0
    for tok in token_keys:
        teacher_all = teacher_by_token.get(tok, [])
        student_all = student_by_token.get(tok, [])

        teacher_noncomment = [x for x in teacher_all if not x['is_comment']]
        teacher_comment_insts = [x for x in teacher_all if x['is_comment']]
        teacher_ghost_insts = ghost_by_token.get(tok, [])
        student_noncomment = [x for x in student_all if not x['is_comment']]
        student_comment_insts = [x for x in student_all if x['is_comment']]

        n_total += len(teacher_noncomment)
        n_real_teacher = len(teacher_noncomment)
        student_seq_idxs = [x['seq_idx'] for x in student_noncomment]
        real_teacher_idxs = [
            seq_idx_to_aug[x['seq_idx']] if seq_idx_to_aug else x['seq_idx']
            for x in teacher_noncomment
        ]
        ghost_teacher_idxs = [g['seq_idx_aug'] for g in teacher_ghost_insts]
        all_teacher_idxs = real_teacher_idxs + ghost_teacher_idxs

        t_alt_packs: Optional[List[Optional[tuple]]] = None
        if stripped_view is not None:
            stripped_seq, aug_to_stripped, is_ghost_at = stripped_view
            t_alt_packs = [
                None if is_ghost_at[p] else _stripped_context_vector_pack(
                    stripped_seq,
                    aug_to_stripped[p],
                    False,
                    context_k,
                )
                for p in all_teacher_idxs
            ]

        assigned_pairs, similarity_matrix = _locate_token(
            student_seq_idxs, all_teacher_idxs,
            student_seq, teacher_match_seq, context_k,
            t_alt_packs=t_alt_packs,
        )

        real_assignments: List[Tuple[int, int]] = []
        ghost_assignments: List[Tuple[int, int]] = []
        for s_idx, t_idx in assigned_pairs:
            if t_idx < n_real_teacher:
                real_assignments.append((s_idx, t_idx))
            else:
                g_idx = t_idx - n_real_teacher
                score = (
                    similarity_matrix[s_idx][t_idx]
                    if similarity_matrix
                       and s_idx < len(similarity_matrix)
                       and t_idx < len(similarity_matrix[s_idx])
                    else 0.0
                )
                if score >= _CONTEXT_MATCH_THRESHOLD:
                    ghost_assignments.append((s_idx, g_idx))

        matched_teacher_idxs = {t_idx for _, t_idx in real_assignments}
        missing_teacher_idxs = {
            j for j in range(n_real_teacher) if j not in matched_teacher_idxs
        }
        matched_student_idxs = {s_idx for s_idx, _ in real_assignments}
        extra_student_idxs = {
            i for i in range(len(student_noncomment))
            if i not in matched_student_idxs
        }

        n_missing += len(missing_teacher_idxs)

        student_for_real_teacher: Dict[int, int] = {t_idx: s_idx for s_idx, t_idx in real_assignments}
        real_teacher_for_student: Dict[int, int] = {s_idx: t_idx for s_idx, t_idx in real_assignments}
        student_for_ghost: Dict[int, int] = {g_idx: s_idx for s_idx, g_idx in ghost_assignments}
        ghost_for_student: Dict[int, int] = {s_idx: g_idx for s_idx, g_idx in ghost_assignments}

        for i, occurrence in enumerate(teacher_noncomment):
            if i in missing_teacher_idxs:
                teacher_colors[occurrence['file']][tok][occurrence['file_idx']] = 'missing'
        for occurrence in teacher_comment_insts:
            teacher_colors[occurrence['file']][tok][occurrence['file_idx']] = 'comment'
        for i, occurrence in enumerate(student_noncomment):
            if i in extra_student_idxs:
                student_colors[occurrence['file']][tok][occurrence['file_idx']] = 'extra'
        for occurrence in student_comment_insts:
            student_colors[occurrence['file']][tok][occurrence['file_idx']] = 'comment'

        def _match_idx_for_student(i: int) -> Optional[int]:
            if i in real_teacher_for_student:
                return real_teacher_for_student[i]
            if i in ghost_for_student:
                return n_real_teacher + ghost_for_student[i]
            return None

        has_label = (
            bool(missing_teacher_idxs)
            or bool(extra_student_idxs)
            or bool(teacher_ghost_insts)
        )
        if has_label:
            tokens_data[tok] = {
                'teacher': [
                    {'file': occurrence['file'], 'pos': occurrence['pos'],
                     'seq_idx': occurrence['seq_idx'],
                     'label': 'missing' if i in missing_teacher_idxs else None,
                     **({'seq_idx_aug': seq_idx_to_aug[occurrence['seq_idx']]}
                        if seq_idx_to_aug else {}),
                     **({'match_idx': student_for_real_teacher[i]}
                        if i in student_for_real_teacher else {})}
                    for i, occurrence in enumerate(teacher_noncomment)
                ] + [
                    {'file': ghost_inst['file'], 'pos': ghost_inst['blob_pos'],
                     'blob_offset': ghost_inst['blob_offset'],
                     'ghost': True,
                     'del_ts': ghost_inst['del_ts'],
                     'seq_idx_aug': ghost_inst['seq_idx_aug'],
                     **({'match_idx': student_for_ghost[g_idx]}
                        if g_idx in student_for_ghost else {})}
                    for g_idx, ghost_inst in enumerate(teacher_ghost_insts)
                ],
                'student': [
                    {'file': occurrence['file'], 'pos': occurrence['pos'],
                     'seq_idx': occurrence['seq_idx'],
                     'label': 'extra' if i in extra_student_idxs else None,
                     **({'match_idx': match_idx}
                        if (match_idx := _match_idx_for_student(i)) is not None else {})}
                    for i, occurrence in enumerate(student_noncomment)
                ],
            }

    assignments = {
        'k': context_k,
        'teacher_seq': teacher_seq,
        'student_seq': student_seq,
        'tokens': tokens_data,
    } if tokens_data else {}
    if assignments and teacher_seq_aug is not None:
        assignments['teacher_seq_aug'] = teacher_seq_aug

    return teacher_colors, student_colors, n_total, n_missing, assignments


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


def _build_token_secprefix_map(ts_map: Dict[str, List[str]]) -> Dict[str, Dict[str, List[str]]]:
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


def _build_removal_ts_map(events: list) -> Dict[str, List[str]]:
    _, _, removed_kw_ts, _, _ = reconstruct_tokens_from_keylog_full(events)
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
                                 _ts_map: dict = None) -> None:
    if not events:
        return
    ts_map = _ts_map if _ts_map is not None else _build_file_ordered_ts_map(events)
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


def _build_teacher_seq_aug(
    teacher_occurrences: List[dict],
    teacher_ghosts: Dict[str, list],
) -> Tuple[list, Dict[int, int], List[dict]]:
    file_order_by_fname: Dict[str, int] = {}
    for occurrence in teacher_occurrences:
        file_order_by_fname.setdefault(occurrence['file'], occurrence['file_order'])

    surviving_entries = [
        (occurrence['file_order'], occurrence['pos'], 1, 0,
         occurrence['seq_idx'], occurrence['token'])
        for occurrence in teacher_occurrences if not occurrence['is_comment']
    ]

    ghost_entries: List[tuple] = []
    ghost_counter = 0
    for fname, ghosts in teacher_ghosts.items():
        file_order = file_order_by_fname.get(fname, 1_000_000)
        for ghost in ghosts:
            blob_pos = ghost['pos']
            blob_del_ts = ghost['del_ts']
            char_del_ts = ghost.get('char_del_ts')
            for tok_match in _sm._CHAR_TOKEN_RE.finditer(ghost['text']):
                start_rel = tok_match.start()
                last_char_rel = tok_match.end() - 1
                if char_del_ts and start_rel < len(char_del_ts):
                    slice_end = min(last_char_rel, len(char_del_ts) - 1)
                    slice_vals = [t for t in char_del_ts[start_rel:slice_end + 1]
                                  if t is not None]
                    tok_del_ts = max(slice_vals) if slice_vals else blob_del_ts
                else:
                    tok_del_ts = blob_del_ts
                ghost_entries.append((
                    file_order, blob_pos, 0, ghost_counter,
                    tok_match.group(), tok_match.start(), fname, tok_del_ts,
                ))
                ghost_counter += 1
    ghost_entries.sort()

    aug_seq: List = []
    seq_idx_to_aug: Dict[int, int] = {}
    ghost_instances: List[dict] = []
    s_cur = g_cur = 0
    while s_cur < len(surviving_entries) or g_cur < len(ghost_entries):
        take_surviving = (
            s_cur < len(surviving_entries) and (
                g_cur >= len(ghost_entries)
                or (surviving_entries[s_cur][0],
                    surviving_entries[s_cur][1],
                    surviving_entries[s_cur][2])
                    <= (ghost_entries[g_cur][0],
                        ghost_entries[g_cur][1],
                        ghost_entries[g_cur][2])
            )
        )
        if take_surviving:
            surv = surviving_entries[s_cur]
            seq_idx_to_aug[surv[4]] = len(aug_seq)
            aug_seq.append(surv[5])
            s_cur += 1
        else:
            ghost = ghost_entries[g_cur]
            ghost_instances.append({
                'file':         ghost[6],
                'token':        ghost[4],
                'blob_pos':     ghost[1],
                'blob_offset':  ghost[5],
                'del_ts':       ghost[7],
                'seq_idx_aug':  len(aug_seq),
            })
            aug_seq.append([ghost[4]])
            g_cur += 1

    return aug_seq, seq_idx_to_aug, ghost_instances


def _build_utf16_map(text: str) -> List[int]:
    u16map = []
    u16 = 0
    for ch in text:
        u16map.append(u16)
        u16 += 2 if ord(ch) > 0xFFFF else 1
    u16map.append(u16)
    return u16map


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


def _colors_to_position_marks(
    files_by_ext: dict,
    colors_map: dict,
) -> dict:
    token_keys: set = set()
    for toks in colors_map.values():
        token_keys.update(toks.keys())
    if not token_keys:
        return {}
    occs, _counts = _collect_occurrences(files_by_ext, token_keys)

    file_u16maps: Dict[str, List[int]] = {}
    for _name, path in files_by_ext.items():
        try:
            text = path.read_text(encoding='utf-8', errors='ignore')
        except Exception:
            continue
        if any(ord(c) > 0xFFFF for c in text):
            file_u16maps[path.name] = _build_utf16_map(text)

    result: Dict[str, List[dict]] = {}
    global_tok_idx: Counter = Counter()
    for oc in occs:
        tok = oc['token']
        gidx = global_tok_idx[tok]
        global_tok_idx[tok] += 1
        labels = colors_map.get(oc['file'], {}).get(tok)
        if not labels or oc['file_idx'] >= len(labels):
            continue
        label = labels[oc['file_idx']]
        if label is None:
            continue
        u16map = file_u16maps.get(oc['file'])
        if u16map:
            start = u16map[oc['pos']]
            end   = start + len(tok)
        else:
            start = oc['pos']
            end   = oc['pos'] + len(tok)
        mark = {'token': tok, 'label': label, 'start': start, 'end': end}
        if label == 'missing':
            mark['_tok_idx'] = gidx
        result.setdefault(oc['file'], []).append(mark)
    for lst in result.values():
        lst.sort(key=lambda x: x['start'])
    return result


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


def _split_tokens_by_comment(text: str, ext=None) -> Tuple[List[Tuple[int, str]], List[Tuple[int, str]]]:
    if not text:
        return [], []
    nc: List[Tuple[int, str]] = []
    cm: List[Tuple[int, str]] = []
    for pos, tok, is_comment in _sm.iter_code_tokens(text, ext):
        (cm if is_comment else nc).append((pos, tok))
    return nc, cm


def _build_token_position_index(text: str, ext=None) -> Tuple[Dict[str, List[int]], int]:
    positions: Dict[str, List[int]] = {}
    n = 0
    for pos, tok, _ in _sm.iter_code_tokens(text, ext):
        positions.setdefault(tok, []).append(pos)
        n += 1
    return positions, n


def _missing_mark(pos: int, tok: str, tok_all_positions: Optional[Dict[str, List[int]]] = None) -> dict:
    mark: dict = {'token': tok, 'label': 'missing', 'start': pos, 'end': pos + len(tok)}
    if tok_all_positions is not None:
        positions = tok_all_positions.get(tok, [])
        mark['_tok_idx'] = bisect.bisect_left(positions, pos)
    return mark


def _extra_mark(pos: int, tok: str) -> dict:
    return {'token': tok, 'label': 'extra', 'start': pos, 'end': pos + len(tok)}


def _comment_pos_mark(pos: int, tok: str) -> dict:
    return {'token': tok, 'label': 'comment', 'start': pos, 'end': pos + len(tok)}


def _line_token_marks(line_text: str, line_off: int, side: str,
                       tok_all_positions: Optional[Dict[str, List[int]]] = None) -> List[dict]:
    marks: List[dict] = []
    for m in _sm._CHAR_TOKEN_RE.finditer(line_text):
        abs_pos = line_off + m.start()
        if side == 'teacher':
            marks.append(_missing_mark(abs_pos, m.group(), tok_all_positions))
        else:
            marks.append(_extra_mark(abs_pos, m.group()))
    return marks


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


def _apply_swap_pairing_to_marks(
    t_marks_by_file: Dict[str, List[dict]],
    s_marks_by_file: Dict[str, List[dict]],
    teacher_files: Dict[str, Path],
    student_files: Dict[str, Path],
) -> None:
    # Greedy (not Hungarian) by design: pairs are gated by a 0.8 threshold and
    # curated truth concentrates on the strongest swaps. Greedy "best-first"
    # protects the highest-scoring pair, while Hungarian can sacrifice a strong
    # pair to gain two medium ones — measurably worse against truth on the
    # test corpus.
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

        # cos_matrix is indexed [extra_idx][missing_idx] — student rows, teacher cols.
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

    for teacher_filepath, teacher_path, student_path in _match_files_by_name_then_ext(
            teacher_files, student_files):
        if student_path is None:
            continue
        teacher_fname = Path(teacher_filepath).name
        student_fname = student_path.name

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
        default_fname = sorted(student_files.keys())[0]
        try:
            default_eof = len(_read_text_normalized(student_files[default_fname]))
        except Exception:
            default_eof = 0
        for marks in t_marks_by_file.values():
            for mark in marks:
                if (mark.get('label') == 'missing'
                        and not mark.get('paired_with')
                        and 'insert_at' not in mark):
                    mark['insert_at'] = {'file': default_fname, 'pos': default_eof}


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
    """One-line summary of the first divergence between two structural forms.
    Used in test failure messages."""
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

    for fname, marks in teacher_marks_by_file.items():
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

    return errors


def _apply_ghost_extra_promotion(
    diff_marks: dict,
    events: list,
) -> None:
    # Hungarian here is interchangeable with greedy under the 0.8 threshold
    # gate: per-token-type candidate sets are small enough that the two
    # algorithms pick the same pairs (verified on the test corpus, F1 identical
    # to four decimals). Hungarian is kept because the same helper is required
    # by `_compute_per_token_matching` (LEO base), where greedy collapses on
    # dense unthresholded matrices like chess's repeating cells.
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
            if mark.get('label') == 'extra' and not mark.get('line') and mark.get('token'):
                extra_keys.add((fname, mark.get('start'), mark['token']))
    missing_keys: set = set()
    for fname, marks in diff_marks.get('teacher_files', {}).items():
        for mark in marks:
            if mark.get('label') == 'missing' and not mark.get('line') and mark.get('token'):
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

