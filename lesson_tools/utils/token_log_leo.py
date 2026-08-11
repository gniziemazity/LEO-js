import contextlib
import math
from collections import Counter
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
from scipy.optimize import linear_sum_assignment

from . import similarity_measures as _sm
from .lv_editor import reconstruct_all_with_ghosts
from .token_log_marks import iter_ghost_tokens


_CONTEXT_K = 10
_CONTEXT_MATCH_THRESHOLD = 0.8
_SWAP_TOKEN_SIM_WEIGHT = 0.2

_LEO_PLUS_DECAY = 0.70
_LEO_PLUS_TAU = 0.65
_DECAY = 1.0
_REAL_MATCH_TAU = None


@contextlib.contextmanager
def leo_plus_config():
    global _DECAY, _REAL_MATCH_TAU
    prev = (_DECAY, _REAL_MATCH_TAU)
    _DECAY, _REAL_MATCH_TAU = _LEO_PLUS_DECAY, _LEO_PLUS_TAU
    try:
        yield
    finally:
        _DECAY, _REAL_MATCH_TAU = prev


def _scan_file_tokens(text: str, ext=None) -> Dict[str, List[Tuple[int, bool]]]:
    result: Dict[str, List[Tuple[int, bool]]] = {}
    for pos, tok, is_comment in _sm.iter_code_tokens(text, ext):
        result.setdefault(tok, []).append((pos, is_comment))
    return result


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
    right: Counter = Counter()
    if _DECAY == 1.0:
        for i in range(max(0, pos - k), pos):
            left[tokens_seq[i]] += 1
        for i in range(pos + 1, min(len(tokens_seq), pos + k + 1)):
            right[tokens_seq[i]] += 1
    else:
        for i in range(max(0, pos - k), pos):
            left[tokens_seq[i]] += _DECAY ** (pos - i - 1)
        for i in range(pos + 1, min(len(tokens_seq), pos + k + 1)):
            right[tokens_seq[i]] += _DECAY ** (i - pos - 1)
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
            left[stripped_seq[i]] += 1 if _DECAY == 1.0 else _DECAY ** (off - 1)
        for off in range(1, k + 1):
            i = anchor_idx - 1 + off
            if i >= n:
                break
            right[stripped_seq[i]] += 1 if _DECAY == 1.0 else _DECAY ** (off - 1)
    else:
        for i in range(max(0, anchor_idx - k), anchor_idx):
            left[stripped_seq[i]] += 1 if _DECAY == 1.0 else _DECAY ** (anchor_idx - i - 1)
        for i in range(anchor_idx + 1, min(n, anchor_idx + k + 1)):
            right[stripped_seq[i]] += 1 if _DECAY == 1.0 else _DECAY ** (i - anchor_idx - 1)
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


def _split_real_and_ghost_assignments(
    assigned_pairs: List[Tuple[int, int]],
    n_real_teacher: int,
    similarity_matrix: list,
) -> Tuple[List[Tuple[int, int]], List[Tuple[int, int]]]:
    real_assignments: List[Tuple[int, int]] = []
    ghost_assignments: List[Tuple[int, int]] = []
    for s_idx, t_idx in assigned_pairs:
        if t_idx < n_real_teacher:
            if _REAL_MATCH_TAU is not None:
                score = (
                    similarity_matrix[s_idx][t_idx]
                    if similarity_matrix
                       and s_idx < len(similarity_matrix)
                       and t_idx < len(similarity_matrix[s_idx])
                    else 0.0
                )
                if score < _REAL_MATCH_TAU:
                    continue
            real_assignments.append((s_idx, t_idx))
            continue
        ghost_idx = t_idx - n_real_teacher
        score = (
            similarity_matrix[s_idx][t_idx]
            if similarity_matrix
               and s_idx < len(similarity_matrix)
               and t_idx < len(similarity_matrix[s_idx])
            else 0.0
        )
        if score >= _CONTEXT_MATCH_THRESHOLD:
            ghost_assignments.append((s_idx, ghost_idx))
    return real_assignments, ghost_assignments

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

        real_assignments, ghost_assignments = _split_real_and_ghost_assignments(
            assigned_pairs, n_real_teacher, similarity_matrix,
        )

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
    for fname, blob_pos, start_rel, tok, tok_del_ts in iter_ghost_tokens(teacher_ghosts):
        file_order = file_order_by_fname.get(fname, 1_000_000)
        ghost_entries.append((
            file_order, blob_pos, 0, ghost_counter,
            tok, start_rel, fname, tok_del_ts,
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
            end_cp = oc['pos'] + len(tok)
            end   = u16map[end_cp] if end_cp < len(u16map) else start + len(tok)
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
