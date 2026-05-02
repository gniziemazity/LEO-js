import difflib
import math
from collections import Counter
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
    result = [(0, "MAIN")]
    for ev in events:
        ts = ev.get("timestamp", 0)
        if "move_to" in ev:
            t = ev["move_to"]
            if t in ("DEV", "dev"):
                pass
            elif t in ("MAIN", "main"):
                result.append((ts, "MAIN"))
            elif any(t.lower().endswith(ext) for ext in _FILE_EXTS):
                result.append((ts, t))
        elif "switch_editor" in ev and ev["switch_editor"] not in ("dev", "DEV"):
            result.append((ts, "MAIN"))
    return sorted(result)


def _file_at_ts(ts: int, timeline: list) -> str:
    idx = bisect.bisect_right(timeline, (ts, "\xff")) - 1
    return timeline[max(0, idx)][1]


def _build_file_ordered_ts_map(all_events: list) -> Dict[str, List[str]]:
    surviving, _ = replay_with_timestamps_all(all_events)
    if not surviving:
        return {}
    text = ''.join(ch for ch, _ in surviving)
    char_ts = [ts for _, ts in surviving]
    result: Dict[str, List[str]] = {}
    for m in _sm._CHAR_TOKEN_RE.finditer(text):
        end_idx = m.end() - 1
        result.setdefault(m.group(), []).append(ts_to_local(char_ts[end_idx]))
    return result


def _build_teacher_token_timestamps(events: list) -> Dict[str, list]:
    if not events:
        return {}
    from .lv_editor import _replay_headless_multi
    editors = _replay_headless_multi(events, track_timestamps=True)
    result: Dict[str, list] = {}
    for tab_key, ed in editors.items():
        fname = "reconstructed.html" if tab_key == "MAIN" else tab_key
        pairs = ed.get_surviving_with_timestamps()
        text = "".join(ch for ch, _ in pairs)
        char_ts = [ts for _, ts in pairs]
        entries = []
        for m in _sm._CHAR_TOKEN_RE.finditer(text):
            end_idx = m.end() - 1
            entries.append({
                'start': m.start(),
                'end': m.end(),
                'ts': ts_to_local(char_ts[end_idx]),
            })
        result[fname] = entries
    return result


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


def _scan_file_tokens(text: str) -> Dict[str, List[Tuple[int, bool]]]:
    result: Dict[str, List[Tuple[int, bool]]] = {}
    for pos, tok, is_comment in _sm.iter_code_tokens(text):
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
) -> tuple:
    def _pop_removal_ts(tok: str) -> str:
        val = (removal_ts_by_token or {}).get(tok)
        if val:
            return val.pop(0)
        return '00:00:00'

    miss_nc_ts: Counter = Counter()
    miss_nc_ctr: Counter = Counter()
    has_ts = False
    for marks in diff_marks.get('teacher_files', {}).values():
        for m in marks:
            if m.get('label') == 'missing':
                tok = m['token']
                ts = m.get('timestamp', '')
                miss_nc_ctr[tok] += 1
                if ts:
                    has_ts = True
                miss_nc_ts[(tok, ts)] += 1

    s_comment_ctr: Counter = Counter()
    for marks in diff_marks.get('student_files', {}).values():
        for m in marks:
            if m.get('label') == 'comment':
                s_comment_ctr[m['token']] += 1

    all_occ: list = []
    miss_nc_remaining = Counter(miss_nc_ts)
    miss_nc_ctr_remaining = Counter(miss_nc_ctr)
    s_comment_consumed: Counter = Counter()

    for entry in teacher_entries:
        tok, ts_str, is_comment, is_removed = entry[0], entry[1], entry[2], entry[3]
        if is_removed:
            continue
        if is_comment:
            if s_comment_consumed[tok] < s_comment_ctr.get(tok, 0):
                s_comment_consumed[tok] += 1
                all_occ.append((ts_str, tok, {'COMMENT'}))
            else:
                all_occ.append((ts_str, tok, {'MISSING', 'COMMENT'}))
        else:
            if has_ts:
                key = (tok, ts_str)
                if miss_nc_remaining.get(key, 0) > 0:
                    miss_nc_remaining[key] -= 1
                    all_occ.append((ts_str, tok, {'MISSING'}))
                else:
                    all_occ.append((ts_str, tok, set()))
            else:
                if miss_nc_ctr_remaining.get(tok, 0) > 0:
                    miss_nc_ctr_remaining[tok] -= 1
                    all_occ.append((ts_str, tok, {'MISSING'}))
                else:
                    all_occ.append((ts_str, tok, set()))

    if has_ts:
        for (tok, ts), count in miss_nc_remaining.items():
            if ts:
                for _ in range(count):
                    all_occ.append((ts, tok, {'MISSING'}))
    else:
        for tok, count in miss_nc_ctr_remaining.items():
            for _ in range(count):
                all_occ.append(('00:00:00', tok, {'MISSING'}))

    for tok, s_count in s_comment_ctr.items():
        extra_c = s_count - s_comment_consumed.get(tok, 0)
        for _ in range(max(0, extra_c)):
            all_occ.append(('00:00:00', tok, {'COMMENT', 'EXTRA'}))

    for marks in diff_marks.get('student_files', {}).values():
        for m in marks:
            label = m.get('label')
            tok = m['token']
            if label == 'extra':
                all_occ.append(('00:00:00', tok, {'EXTRA'}))
            elif label == 'ghost_extra':
                rem_ts = m.get('removal_ts') or _pop_removal_ts(tok)
                all_occ.append((rem_ts, tok, {'EXTRA*'}))

    def _sort_key(entry: tuple) -> tuple:
        ts, _, fl = entry
        is_tail = ts == '00:00:00' and 'EXTRA' in fl and 'EXTRA*' not in fl
        try:
            h, m, s = ts.split(':')
            return (is_tail, int(h), int(m), int(s))
        except Exception:
            return (is_tail, 99, 99, 99)

    all_occ.sort(key=_sort_key)

    stats = _summarize_occurrence_flags(all_occ)
    teacher_total_e = stats['n_found_e'] + stats['n_missing_e']
    score_e = (round(max(0.0, (stats['n_found_e'] - stats['n_ghost_extra']) / teacher_total_e * 100), 1)
               if teacher_total_e else 0.0)

    comment_total = stats['n_found_c'] + stats['n_missing_c']
    score_c = (round(stats['n_found_c'] / comment_total * 100, 1) if comment_total else 0.0)

    return (
        all_occ,
        score_e,
        score_c,
        stats['n_found'],
        stats['n_missing'],
        stats['n_extra'],
        stats['n_ghost_extra'],
    )


_CONTEXT_K = 10
_CONTEXT_MATCH_THRESHOLD = 0.8


def _compute_idf(*seqs: List[str]) -> Dict[str, float]:
    counts: Counter = Counter()
    for seq in seqs:
        for tok in seq:
            counts[tok] += 1
    n_total = sum(counts.values())
    if n_total == 0:
        return {}
    return {tok: math.log((1 + n_total) / (1 + c)) for tok, c in counts.items()}


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
    idf: Dict[str, float],
) -> Tuple[Counter, Counter]:
    left: Counter = Counter()
    for i in range(max(0, pos - k), pos):
        tok = tokens_seq[i]
        w = idf.get(tok, 0.0)
        if w > 0:
            left[tok] += w
    right: Counter = Counter()
    for i in range(pos + 1, min(len(tokens_seq), pos + k + 1)):
        tok = tokens_seq[i]
        w = idf.get(tok, 0.0)
        if w > 0:
            right[tok] += w
    return left, right


def _stripped_context_vector_split(
    stripped_seq: List[str],
    anchor_idx: int,
    anchor_is_ghost: bool,
    k: int,
    idf: Dict[str, float],
) -> Tuple[Counter, Counter]:
    left: Counter = Counter()
    right: Counter = Counter()
    n = len(stripped_seq)
    if anchor_is_ghost:
        for off in range(1, k + 1):
            i = anchor_idx - off
            if i < 0:
                break
            tok = stripped_seq[i]
            w = idf.get(tok, 0.0)
            if w > 0:
                left[tok] += w
        for off in range(1, k + 1):
            i = anchor_idx - 1 + off
            if i >= n:
                break
            tok = stripped_seq[i]
            w = idf.get(tok, 0.0)
            if w > 0:
                right[tok] += w
    else:
        for i in range(max(0, anchor_idx - k), anchor_idx):
            tok = stripped_seq[i]
            w = idf.get(tok, 0.0)
            if w > 0:
                left[tok] += w
        for i in range(anchor_idx + 1, min(n, anchor_idx + k + 1)):
            tok = stripped_seq[i]
            w = idf.get(tok, 0.0)
            if w > 0:
                right[tok] += w
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
    tokens_seq: List[str], pos: int, k: int, idf: Dict[str, float],
) -> Tuple[Counter, Counter, float, float]:
    left, right = _context_vector_split(tokens_seq, pos, k, idf)
    return (left, right, _vec_norm(left), _vec_norm(right))


def _stripped_context_vector_pack(
    stripped_seq: List[str], anchor_idx: int, anchor_is_ghost: bool,
    k: int, idf: Dict[str, float],
) -> Tuple[Counter, Counter, float, float]:
    left, right = _stripped_context_vector_split(
        stripped_seq, anchor_idx, anchor_is_ghost, k, idf,
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


def _locate_token(
    s_positions: List[int],
    t_positions: List[int],
    s_seq: List[str],
    t_seq: List[str],
    k: int,
    idf: Dict[str, float],
    *,
    t_alt_packs: Optional[List[Optional[tuple]]] = None,
) -> Tuple[List[Tuple[int, int]], List[List[float]]]:
    n_s = len(s_positions)
    n_t = len(t_positions)
    if n_s == 0 or n_t == 0:
        return [], []

    s_packs = [_context_vector_pack(s_seq, p, k, idf) for p in s_positions]
    t_packs = [_context_vector_pack(t_seq, p, k, idf) for p in t_positions]

    if t_alt_packs is not None:
        sim = [
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
    else:
        sim = [
            [_combined_context_score(s_packs[i], t_packs[j]) for j in range(n_t)]
            for i in range(n_s)
        ]
    pairs = _hungarian_max(sim)
    return pairs, sim


def _collect_occurrences(files_by_ext: dict, token_keys: set = None) -> Tuple[List[dict], Dict[str, Dict[str, int]]]:
    occs: List[dict] = []
    counts: Dict[str, Dict[str, int]] = {}

    for file_order, (name, path) in enumerate(files_by_ext.items()):
        ext = Path(name).suffix.lower()
        try:
            raw = path.read_text(encoding='utf-8', errors='ignore')
        except Exception:
            continue
        tok_occs = _scan_file_tokens(raw)
        file_name = path.name

        for tok in (token_keys if token_keys is not None else tok_occs.keys()):
            positions = tok_occs.get(tok)
            if not positions:
                continue
            counts.setdefault(file_name, {})[tok] = len(positions)
            for i, (pos, is_comment) in enumerate(positions):
                occs.append({
                    'file': file_name,
                    'token': tok,
                    'file_idx': i,
                    'pos': pos,
                    'is_comment': is_comment,
                    'file_order': file_order,
                    'seq_idx': -1,
                })

    occs.sort(key=lambda x: (x['file_order'], x['pos'], x['token']))
    seq = []
    for oc in occs:
        if not oc['is_comment']:
            oc['seq_idx'] = len(seq)
            seq.append(oc['token'])
    return occs, counts


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
    teacher_occs, teacher_counts = _collect_occurrences(teacher_files)
    student_occs, student_counts = _collect_occurrences(student_files)

    token_keys = (
        {oc['token'] for oc in teacher_occs} |
        {oc['token'] for oc in student_occs}
    )

    teacher_by_token: Dict[str, List[dict]] = {}
    for oc in teacher_occs:
        teacher_by_token.setdefault(oc['token'], []).append(oc)
    student_by_token: Dict[str, List[dict]] = {}
    for oc in student_occs:
        student_by_token.setdefault(oc['token'], []).append(oc)

    teacher_seq = [oc['token'] for oc in teacher_occs if not oc['is_comment']]
    student_seq = [oc['token'] for oc in student_occs if not oc['is_comment']]

    teacher_seq_aug: Optional[list] = None
    seq_idx_to_aug: Optional[Dict[int, int]] = None
    teacher_match_seq = teacher_seq
    ghost_instances: List[dict] = []
    ghost_by_token: Dict[str, List[dict]] = {}
    stripped_view: Optional[Tuple[List[str], List[int], List[bool]]] = None
    if teacher_ghosts:
        teacher_seq_aug, seq_idx_to_aug, ghost_instances = _build_teacher_seq_aug(
            teacher_occs, teacher_ghosts,
        )
        teacher_match_seq = [
            t if isinstance(t, str) else t[0] for t in teacher_seq_aug
        ]
        for inst in ghost_instances:
            ghost_by_token.setdefault(inst['token'], []).append(inst)
        if any(not isinstance(t, str) for t in teacher_seq_aug):
            stripped_view = _build_stripped_view(teacher_seq_aug)

    idf = _compute_idf(teacher_match_seq, student_seq)

    teacher_colors = {
        fn: {tok: [None] * n for tok, n in toks.items()}
        for fn, toks in teacher_counts.items()
    }
    student_colors = {
        fn: {tok: [None] * n for tok, n in toks.items()}
        for fn, toks in student_counts.items()
    }

    tokens_data: Dict[str, dict] = {}
    n_total = 0
    n_missing = 0
    for tok in token_keys:
        t_list = teacher_by_token.get(tok, [])
        s_list = student_by_token.get(tok, [])

        t_out = [x for x in t_list if not x['is_comment']]
        t_com = [x for x in t_list if x['is_comment']]
        t_ghost = ghost_by_token.get(tok, [])
        s_out = [x for x in s_list if not x['is_comment']]
        s_com = [x for x in s_list if x['is_comment']]

        n_total += len(t_out)
        n_real = len(t_out)
        s_idxs = [x['seq_idx'] for x in s_out]
        real_idxs = [
            seq_idx_to_aug[x['seq_idx']] if seq_idx_to_aug else x['seq_idx']
            for x in t_out
        ]
        ghost_idxs = [g['seq_idx_aug'] for g in t_ghost]
        t_all_idxs = real_idxs + ghost_idxs

        t_alt_packs: Optional[List[Optional[tuple]]] = None
        if stripped_view is not None:
            stripped_seq, aug_to_stripped, is_ghost_at = stripped_view
            t_alt_packs = [
                None if is_ghost_at[p] else _stripped_context_vector_pack(
                    stripped_seq,
                    aug_to_stripped[p],
                    False,
                    context_k,
                    idf,
                )
                for p in t_all_idxs
            ]

        all_pairs, sim = _locate_token(
            s_idxs, t_all_idxs,
            student_seq, teacher_match_seq, context_k, idf,
            t_alt_packs=t_alt_packs,
        )

        real_pairs: List[Tuple[int, int]] = []
        ghost_pairs: List[Tuple[int, int]] = []
        for si, tj in all_pairs:
            if tj < n_real:
                real_pairs.append((si, tj))
            else:
                gj = tj - n_real
                cos = sim[si][tj] if sim and si < len(sim) and tj < len(sim[si]) else 0.0
                if cos >= _CONTEXT_MATCH_THRESHOLD:
                    ghost_pairs.append((si, gj))

        matched_real_t = {tj for _, tj in real_pairs}
        missing_to = {j for j in range(n_real) if j not in matched_real_t}
        matched_to_real_s = {si for si, _ in real_pairs}
        extra_so = {i for i in range(len(s_out)) if i not in matched_to_real_s}

        n_missing += len(missing_to)

        teacher_match_idx: Dict[int, int] = {tj: si for si, tj in real_pairs}
        student_real_match_idx: Dict[int, int] = {si: tj for si, tj in real_pairs}
        ghost_match_to_s: Dict[int, int] = {gj: si for si, gj in ghost_pairs}
        student_ghost_match: Dict[int, int] = {si: gj for si, gj in ghost_pairs}

        for i, oc in enumerate(t_out):
            if i in missing_to:
                teacher_colors[oc['file']][tok][oc['file_idx']] = 'missing'
        for oc in t_com:
            teacher_colors[oc['file']][tok][oc['file_idx']] = 'comment'
        for i, oc in enumerate(s_out):
            if i in extra_so:
                student_colors[oc['file']][tok][oc['file_idx']] = 'extra'
        for oc in s_com:
            student_colors[oc['file']][tok][oc['file_idx']] = 'comment'

        def _student_match_idx(i: int) -> Optional[int]:
            if i in student_real_match_idx:
                return student_real_match_idx[i]
            if i in student_ghost_match:
                return n_real + student_ghost_match[i]
            return None

        has_label = bool(missing_to) or bool(extra_so) or bool(t_ghost)
        if has_label:
            tokens_data[tok] = {
                'teacher': [
                    {'file': oc['file'], 'pos': oc['pos'], 'seq_idx': oc['seq_idx'],
                     'label': 'missing' if i in missing_to else None,
                     **({'seq_idx_aug': seq_idx_to_aug[oc['seq_idx']]}
                        if seq_idx_to_aug else {}),
                     **({'match_idx': teacher_match_idx[i]}
                        if i in teacher_match_idx else {})}
                    for i, oc in enumerate(t_out)
                ] + [
                    {'file': inst['file'], 'pos': inst['blob_pos'],
                     'blob_offset': inst['blob_offset'],
                     'ghost': True,
                     'del_ts': inst['del_ts'],
                     'seq_idx_aug': inst['seq_idx_aug'],
                     **({'match_idx': ghost_match_to_s[gj]}
                        if gj in ghost_match_to_s else {})}
                    for gj, inst in enumerate(t_ghost)
                ],
                'student': [
                    {'file': oc['file'], 'pos': oc['pos'], 'seq_idx': oc['seq_idx'],
                     'label': 'extra' if i in extra_so else None,
                     **({'match_idx': midx}
                        if (midx := _student_match_idx(i)) is not None else {})}
                    for i, oc in enumerate(s_out)
                ],
            }

    assignments = {
        'k': context_k,
        'idf': idf,
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

    tok_seen: Counter = Counter()
    for fname in sorted(diff_marks.get('teacher_files', {})):
        for mark in diff_marks['teacher_files'][fname]:
            if mark.get('label') == 'missing':
                tok = mark.get('token', '')
                if tok:
                    stored_idx = mark.pop('_tok_idx', None)
                    if stored_idx is not None:
                        idx = stored_idx
                    else:
                        idx = tok_seen[tok]
                        tok_seen[tok] += 1
                    ts_list = ts_map.get(tok, [])
                    if idx < len(ts_list):
                        mark['timestamp'] = ts_list[idx]
            else:
                mark.pop('_tok_idx', None)

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
    teacher_occs: List[dict],
    teacher_ghosts: Dict[str, list],
) -> Tuple[list, Dict[int, int], List[dict]]:
    file_order_map: Dict[str, int] = {}
    for oc in teacher_occs:
        file_order_map.setdefault(oc['file'], oc['file_order'])

    surv_entries = [
        (oc['file_order'], oc['pos'], 1, 0, oc['seq_idx'], oc['token'])
        for oc in teacher_occs if not oc['is_comment']
    ]

    ghost_entries: List[tuple] = []
    g_counter = 0
    for fname, ghosts in teacher_ghosts.items():
        forder = file_order_map.get(fname, 1_000_000)
        for g in ghosts:
            base_pos = g['pos']
            blob_del_ts = g['del_ts']
            char_del_ts = g.get('char_del_ts')
            for m in _sm._CHAR_TOKEN_RE.finditer(g['text']):
                end_rel = m.end() - 1
                tok_del_ts = (
                    char_del_ts[end_rel]
                    if char_del_ts and end_rel < len(char_del_ts)
                    else blob_del_ts
                )
                ghost_entries.append((
                    forder, base_pos, 0, g_counter,
                    m.group(), m.start(), fname, tok_del_ts,
                ))
                g_counter += 1
    ghost_entries.sort()

    aug_seq: List = []
    seq_idx_to_aug: Dict[int, int] = {}
    ghost_instances: List[dict] = []
    si = gi = 0
    while si < len(surv_entries) or gi < len(ghost_entries):
        take_surv = (
            si < len(surv_entries) and (
                gi >= len(ghost_entries)
                or (surv_entries[si][0], surv_entries[si][1], surv_entries[si][2])
                    <= (ghost_entries[gi][0], ghost_entries[gi][1], ghost_entries[gi][2])
            )
        )
        if take_surv:
            s = surv_entries[si]
            seq_idx_to_aug[s[4]] = len(aug_seq)
            aug_seq.append(s[5])
            si += 1
        else:
            g = ghost_entries[gi]
            ghost_instances.append({
                'file':         g[6],
                'token':        g[4],
                'blob_pos':     g[1],
                'blob_offset':  g[5],
                'del_ts':       g[7],
                'seq_idx_aug':  len(aug_seq),
            })
            aug_seq.append([g[4]])
            gi += 1

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


def _split_tokens_by_comment(text: str) -> Tuple[List[Tuple[int, str]], List[Tuple[int, str]]]:
    if not text:
        return [], []
    nc: List[Tuple[int, str]] = []
    cm: List[Tuple[int, str]] = []
    for pos, tok, is_comment in _sm.iter_code_tokens(text):
        (cm if is_comment else nc).append((pos, tok))
    return nc, cm


def _build_token_position_index(text: str) -> Tuple[Dict[str, List[int]], int]:
    positions: Dict[str, List[int]] = {}
    n = 0
    for pos, tok, _ in _sm.iter_code_tokens(text):
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
    t_tok_ms = list(_sm._CHAR_TOKEN_RE.finditer(t_line))
    s_tok_ms = list(_sm._CHAR_TOKEN_RE.finditer(s_line))
    sm = difflib.SequenceMatcher(
        None, [m.group() for m in t_tok_ms], [m.group() for m in s_tok_ms],
        autojunk=False,
    )
    t_marks: List[dict] = []
    s_marks: List[dict] = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == 'equal':
            continue
        if tag in ('delete', 'replace'):
            if s_fname is not None:
                insert_pos = (
                    s_off + s_tok_ms[j1].start()
                    if j1 < len(s_tok_ms) else s_off + len(s_line)
                )
                native = {'file': s_fname, 'pos': insert_pos}
            else:
                native = None
            for ti in range(i1, i2):
                m = t_tok_ms[ti]
                mark = _missing_mark(t_off + m.start(), m.group(), tok_all_positions)
                if native is not None:
                    mark['_native_insert_at'] = native
                t_marks.append(mark)
        if tag in ('insert', 'replace'):
            for tj in range(j1, j2):
                m = s_tok_ms[tj]
                s_marks.append(_extra_mark(s_off + m.start(), m.group()))
    return t_marks, s_marks


def _line_anchors_from_alignment(
    alignment: list, s_starts: List[int], s_text_len: int,
) -> Dict[int, int]:
    anchors: Dict[int, int] = {}
    next_s_pos = s_text_len
    for entry in reversed(alignment):
        t_i, s_j = entry[0], entry[1]
        if s_j is not None:
            next_s_pos = s_starts[s_j] if s_j < len(s_starts) else s_text_len
        elif t_i is not None:
            anchors[t_i] = next_s_pos
    return anchors


def _stamp_native_line_insert_at(
    t_marks: List[dict], t_starts: List[int],
    line_anchors: Dict[int, int], s_fname: str,
) -> None:
    if not line_anchors:
        return
    for m in t_marks:
        if m.get('label') != 'missing':
            continue
        if m.get('_native_insert_at') is not None:
            continue
        line_idx = bisect.bisect_right(t_starts, m['start']) - 1
        if line_idx in line_anchors:
            m['_native_insert_at'] = {
                'file': s_fname, 'pos': line_anchors[line_idx],
            }


def _add_unpaired_teacher_line(alignment, t_marks, t_line_ms,
                                t_lines_raw, t_starts, t_i, tok_all_positions) -> None:
    alignment.append([t_i, None])
    if t_i >= len(t_lines_raw):
        return
    lm = _make_line_mark(t_lines_raw, t_starts, t_i, 'missing')
    if lm:
        t_line_ms.append(lm)
    t_off = t_starts[t_i] if t_i < len(t_starts) else 0
    t_marks.extend(_line_token_marks(t_lines_raw[t_i], t_off, 'teacher', tok_all_positions))


def _add_unpaired_student_line(alignment, s_marks, s_line_ms,
                                s_lines_raw, s_starts, s_j) -> None:
    alignment.append([None, s_j])
    if s_j >= len(s_lines_raw):
        return
    lm = _make_line_mark(s_lines_raw, s_starts, s_j, 'extra')
    if lm:
        s_line_ms.append(lm)
    s_off = s_starts[s_j] if s_j < len(s_starts) else 0
    s_marks.extend(_line_token_marks(s_lines_raw[s_j], s_off, 'student'))


def _add_paired_line_block(alignment, t_marks, s_marks,
                            t_lines_raw, s_lines_raw, t_starts, s_starts,
                            t_start, s_start, n_paired, tok_all_positions,
                            s_fname=None) -> None:
    for k in range(n_paired):
        t_i, s_j = t_start + k, s_start + k
        alignment.append([t_i, s_j])
        if t_i >= len(t_lines_raw) or s_j >= len(s_lines_raw):
            continue
        t_off = t_starts[t_i] if t_i < len(t_starts) else 0
        s_off = s_starts[s_j] if s_j < len(s_starts) else 0
        tm, sm = _diff_line_pair_tokens(
            t_lines_raw[t_i], t_off, s_lines_raw[s_j], s_off,
            tok_all_positions, s_fname=s_fname,
        )
        t_marks.extend(tm)
        s_marks.extend(sm)


def _add_replace_block(alignment, t_marks, s_marks, t_line_ms, s_line_ms,
                        t_lines_raw, s_lines_raw, t_starts, s_starts,
                        t_start, n_t, s_start, n_s, tok_all_positions,
                        s_fname=None) -> None:
    n_paired = min(n_t, n_s)
    _add_paired_line_block(alignment, t_marks, s_marks,
                            t_lines_raw, s_lines_raw, t_starts, s_starts,
                            t_start, s_start, n_paired, tok_all_positions,
                            s_fname=s_fname)
    for k in range(n_paired, n_t):
        _add_unpaired_teacher_line(alignment, t_marks, t_line_ms,
                                    t_lines_raw, t_starts, t_start + k, tok_all_positions)
    for k in range(n_paired, n_s):
        _add_unpaired_student_line(alignment, s_marks, s_line_ms,
                                    s_lines_raw, s_starts, s_start + k)


def _finalize_per_file_diff(per_file_results, n_total
                             ) -> Tuple[Dict[str, List[dict]], Dict[str, List[dict]],
                                        Optional[float], Dict[str, list], dict, int]:
    teacher_result: Dict[str, List[dict]] = {}
    student_result: Dict[str, List[dict]] = {}
    alignments: Dict[str, list] = {}
    t_line_by_file: Dict[str, List[dict]] = {}
    s_line_by_file: Dict[str, List[dict]] = {}

    for fname, s_fname, t_marks, s_marks, t_line_ms, s_line_ms, alignment in per_file_results:
        if t_marks:
            teacher_result[fname] = t_marks
        if s_marks:
            student_result[s_fname] = s_marks
        if t_line_ms:
            t_line_by_file[fname] = t_line_ms
        if s_line_ms:
            s_line_by_file[s_fname] = s_line_ms
        if alignment is not None:
            alignments[fname] = alignment
            if s_fname != fname:
                alignments[s_fname] = alignment

    n_missing = sum(1 for marks in teacher_result.values() for m in marks if m.get('label') == 'missing')
    score = round((n_total - n_missing) / n_total * 100, 1) if n_total else None
    line_marks: dict = {}
    if t_line_by_file:
        line_marks['teacher_files'] = t_line_by_file
    if s_line_by_file:
        line_marks['student_files'] = s_line_by_file
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

    for t_name, t_path, s_path in _match_files_by_name_then_ext(teacher_files, student_files):
        t_text = _read_text_normalized(t_path)
        s_text = _read_text_normalized(s_path) if s_path else ''
        if not t_text:
            continue

        t_nc, t_cm = _split_tokens_by_comment(t_text)
        s_nc, s_cm = _split_tokens_by_comment(s_text)
        tok_all_positions, _ = _build_token_position_index(t_text)

        t_seq = [tok for _, tok in t_nc]
        s_seq = [tok for _, tok in s_nc]
        n_total += len(t_seq)

        fname = Path(t_name).name
        s_fname = s_path.name if s_path else fname
        stamp_native = s_path is not None

        t_marks: List[dict] = []
        s_marks: List[dict] = []
        for tag, i1, i2, j1, j2 in opcodes_fn(t_seq, s_seq):
            if tag == 'equal':
                continue
            if tag in ('delete', 'replace'):
                n_missing += i2 - i1
                if stamp_native:
                    insert_pos = (
                        s_nc[j1][0] if j1 < len(s_nc) else len(s_text)
                    )
                    native = {'file': s_fname, 'pos': insert_pos}
                else:
                    native = None
                for i in range(i1, i2):
                    pos, tok = t_nc[i]
                    m = _missing_mark(pos, tok, tok_all_positions)
                    if native is not None:
                        m['_native_insert_at'] = native
                    t_marks.append(m)
            if tag in ('insert', 'replace'):
                for j in range(j1, j2):
                    pos, tok = s_nc[j]
                    s_marks.append(_extra_mark(pos, tok))

        for pos, tok in t_cm:
            t_marks.append(_comment_pos_mark(pos, tok))
        for pos, tok in s_cm:
            s_marks.append(_comment_pos_mark(pos, tok))

        if t_marks:
            teacher_result[fname] = sorted(t_marks, key=lambda x: x['start'])
        if s_marks:
            student_result[s_fname] = sorted(s_marks, key=lambda x: x['start'])

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
    for marks in t_marks_by_file.values():
        for m in marks:
            m.pop('paired_with', None)
    for marks in s_marks_by_file.values():
        for m in marks:
            m.pop('paired_with', None)

    for t_name, t_path, s_path in _match_files_by_name_then_ext(teacher_files, student_files):
        if s_path is None:
            continue
        t_fname = Path(t_name).name
        s_fname = s_path.name

        missing = [m for m in t_marks_by_file.get(t_fname, []) if m.get('label') == 'missing']
        extras  = [e for e in s_marks_by_file.get(s_fname, []) if e.get('label') == 'extra']
        if not missing or not extras:
            continue

        t_text = _read_text_normalized(t_path)
        s_text = _read_text_normalized(s_path)
        t_nc, _ = _split_tokens_by_comment(t_text)
        s_nc, _ = _split_tokens_by_comment(s_text)
        t_seq = [tok for _, tok in t_nc]
        s_seq = [tok for _, tok in s_nc]
        t_pos_to_idx = {pos: i for i, (pos, _) in enumerate(t_nc)}
        s_pos_to_idx = {pos: j for j, (pos, _) in enumerate(s_nc)}

        m_entries = [(t_pos_to_idx[m['start']], m) for m in missing if m['start'] in t_pos_to_idx]
        e_entries = [(s_pos_to_idx[e['start']], e) for e in extras if e['start'] in s_pos_to_idx]
        if not m_entries or not e_entries:
            continue

        idf = _compute_idf(t_seq, s_seq)
        m_packs = [_context_vector_pack(t_seq, idx, _CONTEXT_K, idf) for idx, _ in m_entries]
        e_packs = [_context_vector_pack(s_seq, idx, _CONTEXT_K, idf) for idx, _ in e_entries]

        candidates: List[Tuple[float, int, int]] = []
        for i in range(len(m_entries)):
            for j in range(len(e_entries)):
                cos = _combined_context_score(e_packs[j], m_packs[i])
                if cos >= _CONTEXT_MATCH_THRESHOLD:
                    candidates.append((cos, i, j))
        candidates.sort(reverse=True)

        used_m: set = set()
        used_e: set = set()
        for _cos, i, j in candidates:
            if i in used_m or j in used_e:
                continue
            used_m.add(i)
            used_e.add(j)
            m_mark = m_entries[i][1]
            e_mark = e_entries[j][1]
            m_mark['paired_with'] = {
                'file':  s_fname,
                'start': e_mark['start'],
                'end':   e_mark['end'],
                'token': e_mark['token'],
                'label': 'extra',
            }
            e_mark['paired_with'] = {
                'file':  t_fname,
                'start': m_mark['start'],
                'end':   m_mark['end'],
                'token': m_mark['token'],
                'label': 'missing',
            }


def _apply_insert_at_to_unpaired_missings(
    t_marks_by_file: Dict[str, List[dict]],
    s_marks_by_file: Dict[str, List[dict]],
    teacher_files: Dict[str, Path],
    student_files: Dict[str, Path],
) -> None:
    for marks in t_marks_by_file.values():
        for m in marks:
            if m.get('label') != 'missing':
                continue
            if m.get('paired_with') is not None:
                m.pop('insert_at', None)
                continue
            native = m.get('_native_insert_at')
            if native is not None:
                m['insert_at'] = dict(native)
            else:
                m.pop('insert_at', None)

    for t_name, t_path, s_path in _match_files_by_name_then_ext(
            teacher_files, student_files):
        if s_path is None:
            continue
        t_fname = Path(t_name).name
        s_fname = s_path.name

        unpaired = [m for m in t_marks_by_file.get(t_fname, [])
                    if m.get('label') == 'missing'
                    and m.get('paired_with') is None
                    and 'insert_at' not in m]
        if not unpaired:
            continue

        t_text = _read_text_normalized(t_path)
        s_text = _read_text_normalized(s_path)
        t_nc, _ = _split_tokens_by_comment(t_text)
        s_nc, _ = _split_tokens_by_comment(s_text)

        missing_pos = {m['start'] for m in t_marks_by_file.get(t_fname, [])
                       if m.get('label') == 'missing'}
        skip_s_pos  = {e['start'] for e in s_marks_by_file.get(s_fname, [])
                       if e.get('label') in ('extra', 'ghost_extra')}

        matched_t_positions = [i for i, (pos, _) in enumerate(t_nc)
                               if pos not in missing_pos]
        matched_s = [(pos, tok) for pos, tok in s_nc if pos not in skip_s_pos]

        t_pos_to_idx = {pos: i for i, (pos, _) in enumerate(t_nc)}

        for m in unpaired:
            t_idx = t_pos_to_idx.get(m['start'])
            if t_idx is None:
                continue
            prev_k = -1
            for k, mt_idx in enumerate(matched_t_positions):
                if mt_idx < t_idx:
                    prev_k = k
                else:
                    break
            if prev_k < 0:
                insert_pos = 0
            elif prev_k < len(matched_s):
                s_pos, s_tok = matched_s[prev_k]
                insert_pos = s_pos + len(s_tok)
            else:
                insert_pos = len(s_text)
            m['insert_at'] = {'file': s_fname, 'pos': insert_pos}

    if student_files:
        default_fname = sorted(student_files.keys())[0]
        try:
            default_eof = len(_read_text_normalized(student_files[default_fname]))
        except Exception:
            default_eof = 0
        for marks in t_marks_by_file.values():
            for m in marks:
                if (m.get('label') == 'missing'
                        and not m.get('paired_with')
                        and 'insert_at' not in m):
                    m['insert_at'] = {'file': default_fname, 'pos': default_eof}


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


def _flatten_structural_form(form):
    out: List[str] = []
    for item in form:
        if (isinstance(item, tuple) and len(item) == 2
                and item[0] in ('{', '<') and isinstance(item[1], frozenset)):
            opener = item[0]
            closer = '}' if opener == '{' else '>'
            out.append(opener)
            entries = sorted(item[1], key=lambda kv: repr(kv[0]))
            for entry, count in entries:
                if isinstance(entry, tuple):
                    sub = _flatten_structural_form([entry] if (
                        len(entry) == 2 and entry[0] in ('{', '<')
                        and isinstance(entry[1], frozenset)
                    ) else entry)
                    for _ in range(count):
                        out.extend(sub)
                        if opener == '{':
                            out.append(';')
                else:
                    for _ in range(count):
                        out.append(entry)
            out.append(closer)
        else:
            out.append(item)
    return out


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


def _reconstruct_corrected_tokens(t_marks, s_marks, s_text, s_fname):
    s_nc, _ = _split_tokens_by_comment(s_text)
    extras = {m['start'] for m in s_marks
              if m.get('label') in ('extra', 'ghost_extra')}
    for m in t_marks:
        pw = m.get('paired_with')
        if pw and pw.get('file') == s_fname:
            extras.add(pw['start'])

    events: List[tuple] = []
    for i, (start, tok) in enumerate(s_nc):
        if start in extras:
            continue
        events.append((start, 1, i, tok))

    order = 0
    for m in t_marks:
        if m.get('label') != 'missing':
            continue
        pw = m.get('paired_with')
        if pw and pw.get('file') == s_fname:
            events.append((pw['start'], 0, order, m['token']))
        else:
            ia = m.get('insert_at')
            if ia and ia.get('file') == s_fname:
                events.append((ia['pos'], 0, order, m['token']))
        order += 1

    events.sort(key=lambda e: (e[0], e[1], e[2]))
    return [e[3] for e in events]


def _apply_leo_genetic_refinement(
    diff_marks: dict,
    teacher_files: Dict[str, Path],
    student_files: Dict[str, Path],
    *,
    generations: int = 20,
    population: int = 8,
    lambda_marks: float = 0.001,
    context_k: int = _CONTEXT_K,
    seed: Optional[int] = None,
) -> None:
    import copy
    import difflib
    import random

    rng = random.Random(seed)

    file_data: Dict[str, dict] = {}
    for t_name, t_path, s_path in _match_files_by_name_then_ext(
            teacher_files, student_files):
        if s_path is None:
            continue
        try:
            t_text = _read_text_normalized(t_path)
            s_text = _read_text_normalized(s_path)
        except Exception:
            continue
        t_nc, _ = _split_tokens_by_comment(t_text)
        s_nc, _ = _split_tokens_by_comment(s_text)
        t_seq = [tok for _, tok in t_nc]
        s_seq = [tok for _, tok in s_nc]
        file_data[Path(t_name).name] = {
            's_fname': s_path.name,
            's_text': s_text,
            't_nc': t_nc,
            's_nc': s_nc,
            't_seq': t_seq,
            's_seq': s_seq,
            'teacher_tokens': list(t_seq),
        }

    if not file_data:
        return

    idf = _compute_idf(
        *(fd['t_seq'] for fd in file_data.values()),
        *(fd['s_seq'] for fd in file_data.values()),
    )
    teacher_ghosts_top = diff_marks.get('teacher_ghosts') or {}
    for t_name, fd in file_data.items():
        fd['t_packs'] = [_context_vector_pack(fd['t_seq'], i, context_k, idf)
                         for i in range(len(fd['t_seq']))]
        fd['s_packs'] = [_context_vector_pack(fd['s_seq'], i, context_k, idf)
                         for i in range(len(fd['s_seq']))]
        fd['t_pos_to_idx'] = {pos: i for i, (pos, _) in enumerate(fd['t_nc'])}
        fd['s_pos_to_idx'] = {pos: i for i, (pos, _) in enumerate(fd['s_nc'])}
        ghost_tokens: set = set()
        for g in teacher_ghosts_top.get(t_name, []) or []:
            for gm in _sm._CHAR_TOKEN_RE.finditer(g.get('text', '')):
                ghost_tokens.add(gm.group())
        fd['ghost_tokens'] = ghost_tokens

    for fd in file_data.values():
        fd['teacher_struct_flat'] = _flatten_structural_form(
            _structural_form(fd['teacher_tokens']),
        )

    def fitness(dm: dict) -> float:
        n_marks = 0
        for marks in dm.get('teacher_files', {}).values():
            for m in marks or []:
                if m.get('label') == 'missing':
                    n_marks += 1
        for marks in dm.get('student_files', {}).values():
            for m in marks or []:
                if m.get('label') in ('extra', 'ghost_extra'):
                    n_marks += 1
        sim_total = 0.0
        for t_name, fd in file_data.items():
            t_marks = dm.get('teacher_files', {}).get(t_name, []) or []
            s_marks = dm.get('student_files', {}).get(fd['s_fname'], []) or []
            actual = _reconstruct_corrected_tokens(
                t_marks, s_marks, fd['s_text'], fd['s_fname'],
            )
            actual_flat = _flatten_structural_form(_structural_form(actual))
            expected_flat = fd['teacher_struct_flat']
            sm = difflib.SequenceMatcher(None, actual_flat, expected_flat,
                                          autojunk=False)
            sim_total += sm.ratio()
        sim_avg = sim_total / max(1, len(file_data))
        return sim_avg - lambda_marks * n_marks

    def m1_shift_insert_at(dm: dict) -> bool:
        candidates = []
        for t_name, marks in dm.get('teacher_files', {}).items():
            fd = file_data.get(t_name)
            if fd is None:
                continue
            for m in marks or []:
                if m.get('label') != 'missing':
                    continue
                if m.get('paired_with'):
                    continue
                ia = m.get('insert_at')
                if not ia or ia.get('file') != fd['s_fname']:
                    continue
                candidates.append((m, fd))
        if not candidates:
            return False
        m, fd = rng.choice(candidates)
        t_idx = fd['t_pos_to_idx'].get(m['start'])
        if t_idx is None or len(fd['s_nc']) == 0:
            return False
        t_pack = fd['t_packs'][t_idx]
        weights = [max(0.0, _combined_context_score(fd['s_packs'][i], t_pack)) ** 2 + 1e-3
                   for i in range(len(fd['s_nc']))]
        idx = rng.choices(range(len(fd['s_nc'])), weights=weights, k=1)[0]
        m['insert_at'] = {'file': fd['s_fname'], 'pos': fd['s_nc'][idx][0]}
        return True

    def m2_form_pair(dm: dict) -> bool:
        candidates = []
        for t_name, fd in file_data.items():
            s_fname = fd['s_fname']
            t_marks = dm.get('teacher_files', {}).get(t_name, []) or []
            s_marks = dm.get('student_files', {}).get(s_fname, []) or []
            unpaired_m = [(m, fd['t_pos_to_idx'].get(m['start']))
                          for m in t_marks
                          if m.get('label') == 'missing'
                          and not m.get('paired_with')
                          and m['start'] in fd['t_pos_to_idx']]
            unpaired_e = [(e, fd['s_pos_to_idx'].get(e['start']))
                          for e in s_marks
                          if e.get('label') == 'extra'
                          and not e.get('paired_with')
                          and e['start'] in fd['s_pos_to_idx']]
            for m, mi in unpaired_m:
                t_pack = fd['t_packs'][mi]
                for e, ei in unpaired_e:
                    cos = _combined_context_score(fd['s_packs'][ei], t_pack)
                    candidates.append((cos, m, e, t_name, s_fname))
        if not candidates:
            return False
        weights = [max(0.0, c[0]) ** 2 + 1e-3 for c in candidates]
        _cos, m, e, t_name, s_fname = rng.choices(candidates, weights=weights, k=1)[0]
        m['paired_with'] = {
            'file': s_fname, 'start': e['start'], 'end': e['end'],
            'token': e['token'], 'label': 'extra',
        }
        e['paired_with'] = {
            'file': t_name, 'start': m['start'], 'end': m['end'],
            'token': m['token'], 'label': 'missing',
        }
        return True

    def m3_break_pair(dm: dict) -> bool:
        candidates = []
        for t_name, fd in file_data.items():
            s_fname = fd['s_fname']
            t_marks = dm.get('teacher_files', {}).get(t_name, []) or []
            s_marks = dm.get('student_files', {}).get(s_fname, []) or []
            s_by_pos = {e['start']: e for e in s_marks}
            for m in t_marks:
                if m.get('label') != 'missing':
                    continue
                pw = m.get('paired_with')
                if not pw or pw.get('file') != s_fname:
                    continue
                e = s_by_pos.get(pw['start'])
                if e is None or e.get('label') != 'extra':
                    continue
                ti = fd['t_pos_to_idx'].get(m['start'])
                ei = fd['s_pos_to_idx'].get(e['start'])
                if ti is None or ei is None:
                    continue
                cos = _combined_context_score(fd['s_packs'][ei], fd['t_packs'][ti])
                candidates.append((cos, m, e, s_fname))
        if not candidates:
            return False
        weights = [(1.0 - max(0.0, min(1.0, c[0]))) ** 2 + 1e-3 for c in candidates]
        _cos, m, e, s_fname = rng.choices(candidates, weights=weights, k=1)[0]
        partner_start = e['start']
        m.pop('paired_with', None)
        e.pop('paired_with', None)
        m['insert_at'] = {'file': s_fname, 'pos': partner_start}
        return True

    def m5_reassign_extra(dm: dict) -> bool:
        all_candidates = []  # (s_name, fd, t_name, tok, extras, unmarked_positions)
        for t_name, fd in file_data.items():
            s_name = fd['s_fname']
            s_marks = dm.get('student_files', {}).get(s_name, []) or []
            extra_by_tok: Dict[str, list] = {}
            for m in s_marks:
                if m.get('label') == 'extra' and not m.get('paired_with'):
                    extra_by_tok.setdefault(m['token'], []).append(m)
            if not extra_by_tok:
                continue
            all_pos_by_tok: Dict[str, list] = {}
            for pos, tk in fd['s_nc']:
                all_pos_by_tok.setdefault(tk, []).append(pos)
            for tok, extras in extra_by_tok.items():
                extra_pos = {m['start'] for m in extras}
                unmarked = [p for p in all_pos_by_tok.get(tok, []) if p not in extra_pos]
                if not unmarked:
                    continue
                all_candidates.append((s_name, fd, t_name, tok, extras, unmarked))
        if not all_candidates:
            return False

        s_name, fd, t_name, tok, extras, unmarked = rng.choice(all_candidates)

        teacher_packs = []
        for tp, t_tok in fd['t_nc']:
            if t_tok != tok:
                continue
            ti = fd['t_pos_to_idx'].get(tp)
            if ti is not None:
                teacher_packs.append(fd['t_packs'][ti])
        if not teacher_packs:
            return False

        def best_sim(student_pos):
            si = fd['s_pos_to_idx'].get(student_pos)
            if si is None:
                return 0.0
            s_pack = fd['s_packs'][si]
            return max(_combined_context_score(s_pack, tp) for tp in teacher_packs)

        extra_weights = [max(0.0, best_sim(m['start'])) ** 2 + 1e-3 for m in extras]
        extra_to_remove = rng.choices(extras, weights=extra_weights, k=1)[0]

        unmarked_weights = [(1.0 - max(0.0, min(1.0, best_sim(p)))) ** 2 + 1e-3
                            for p in unmarked]
        new_extra_pos = rng.choices(unmarked, weights=unmarked_weights, k=1)[0]

        if new_extra_pos == extra_to_remove['start']:
            return False

        new_end = None
        for p, t in fd['s_nc']:
            if p == new_extra_pos and t == tok:
                new_end = p + len(t)
                break
        if new_end is None:
            return False

        s_marks = dm.setdefault('student_files', {}).setdefault(s_name, [])
        try:
            s_marks.remove(extra_to_remove)
        except ValueError:
            return False
        s_marks.append({
            'token': tok, 'label': 'extra',
            'start': new_extra_pos, 'end': new_end,
        })
        s_marks.sort(key=lambda m: m['start'])
        return True

    def m7_cluster_neighbor_shift(dm: dict) -> bool:
        per_file = {}
        for t_name, fd in file_data.items():
            marks = dm.get('teacher_files', {}).get(t_name, []) or []
            unpaired = [m for m in marks
                        if m.get('label') == 'missing'
                        and not m.get('paired_with')
                        and m.get('insert_at')
                        and m['insert_at'].get('file') == fd['s_fname']]
            if not unpaired:
                continue
            from collections import Counter as _Counter
            pos_counts = _Counter(m['insert_at']['pos'] for m in unpaired)
            best_pos, best_count = pos_counts.most_common(1)[0]
            if best_count < 2:
                continue
            cluster = [m for m in unpaired if m['insert_at']['pos'] == best_pos]
            per_file[t_name] = (cluster, best_pos)
        if not per_file:
            return False

        t_name = rng.choice(list(per_file.keys()))
        fd = file_data[t_name]
        cluster, cur_pos = per_file[t_name]
        s_nc = fd['s_nc']
        if not s_nc:
            return False
        positions = [p for p, _ in s_nc]
        try:
            cur_idx = positions.index(cur_pos)
        except ValueError:
            cur_idx = min(range(len(positions)), key=lambda i: abs(positions[i] - cur_pos))
        offset = rng.choice([-3, -2, -1, 1, 2, 3])
        new_idx = max(0, min(len(positions) - 1, cur_idx + offset))
        if new_idx == cur_idx:
            return False
        new_pos = positions[new_idx]
        for m in cluster:
            m['insert_at'] = {'file': fd['s_fname'], 'pos': new_pos}
        return True

    def m6_bulk_shift(dm: dict) -> bool:
        per_file = {}
        for t_name, fd in file_data.items():
            marks = dm.get('teacher_files', {}).get(t_name, []) or []
            unpaired = sorted(
                [m for m in marks
                 if m.get('label') == 'missing' and not m.get('paired_with')
                 and m['start'] in fd['t_pos_to_idx']],
                key=lambda m: m['start'],
            )
            if len(unpaired) >= 2:
                per_file[t_name] = unpaired
        if not per_file:
            return False

        t_name = rng.choice(list(per_file.keys()))
        fd = file_data[t_name]
        s_fname = fd['s_fname']
        unpaired = per_file[t_name]
        n_s = len(fd['s_nc'])
        if n_s == 0:
            return False

        K_max = min(30, len(unpaired))
        K_min = 2 if len(unpaired) < 5 else 5
        K = rng.randint(K_min, K_max)
        i = rng.randint(0, len(unpaired) - K)
        run = unpaired[i:i + K]

        head_idx = fd['t_pos_to_idx'].get(run[0]['start'])
        if head_idx is None:
            return False
        head_pack = fd['t_packs'][head_idx]
        weights = [max(0.0, _combined_context_score(fd['s_packs'][j], head_pack)) ** 2 + 1e-3
                   for j in range(n_s)]
        chosen = rng.choices(range(n_s), weights=weights, k=1)[0]
        target_pos = fd['s_nc'][chosen][0]

        for m in run:
            m['insert_at'] = {'file': s_fname, 'pos': target_pos}
        return True

    def m4_flip_label(dm: dict) -> bool:
        promote = []
        demote = []
        for t_name, fd in file_data.items():
            s_fname = fd['s_fname']
            ghost_tokens = fd.get('ghost_tokens', set())
            s_marks = dm.get('student_files', {}).get(s_fname, []) or []
            for e in s_marks:
                if e.get('paired_with'):
                    continue
                lbl = e.get('label')
                if lbl == 'extra' and e.get('token') in ghost_tokens:
                    promote.append(e)
                elif lbl == 'ghost_extra':
                    demote.append(e)
        pool = ([('promote', e) for e in promote]
                + [('demote', e) for e in demote])
        if not pool:
            return False
        op, e = rng.choice(pool)
        if op == 'promote':
            e['label'] = 'ghost_extra'
        else:
            e['label'] = 'extra'
            e.pop('removal_ts', None)
        return True

    def mutate(dm: dict) -> None:
        ops = [m1_shift_insert_at, m2_form_pair, m3_break_pair,
               m4_flip_label, m5_reassign_extra, m6_bulk_shift,
               m7_cluster_neighbor_shift]
        rng.shuffle(ops)
        for fn in ops:
            if fn(dm):
                return

    def crossover(pa: dict, pb: dict) -> dict:
        child: dict = {}
        for k, v in pa.items():
            if k in ('teacher_files', 'student_files'):
                continue
            child[k] = copy.deepcopy(v)

        child_t: Dict[str, list] = {}
        t_files = (set(pa.get('teacher_files', {}))
                   | set(pb.get('teacher_files', {})))
        for t_name in t_files:
            a_marks = pa.get('teacher_files', {}).get(t_name, []) or []
            b_marks = pb.get('teacher_files', {}).get(t_name, []) or []
            types = ({m['token'] for m in a_marks if m.get('label') == 'missing'}
                     | {m['token'] for m in b_marks if m.get('label') == 'missing'})
            new_marks: list = []
            for tok in types:
                src = a_marks if rng.random() < 0.5 else b_marks
                for m in src:
                    if m.get('label') == 'missing' and m['token'] == tok:
                        new_marks.append(copy.deepcopy(m))
            child_t[t_name] = sorted(new_marks, key=lambda m: m['start'])
        child['teacher_files'] = child_t

        child_s: Dict[str, list] = {}
        s_files = (set(pa.get('student_files', {}))
                   | set(pb.get('student_files', {})))
        for s_name in s_files:
            a_marks = pa.get('student_files', {}).get(s_name, []) or []
            b_marks = pb.get('student_files', {}).get(s_name, []) or []
            types = ({m['token'] for m in a_marks
                      if m.get('label') in ('extra', 'ghost_extra')}
                     | {m['token'] for m in b_marks
                        if m.get('label') in ('extra', 'ghost_extra')})
            new_marks = []
            for tok in types:
                src = a_marks if rng.random() < 0.5 else b_marks
                for m in src:
                    if (m.get('label') in ('extra', 'ghost_extra')
                            and m['token'] == tok):
                        new_marks.append(copy.deepcopy(m))
            child_s[s_name] = sorted(new_marks, key=lambda m: m['start'])
        child['student_files'] = child_s

        s_by_pos = {(s_name, m['start']): m
                    for s_name, marks in child_s.items() for m in marks
                    if m.get('label') in ('extra', 'ghost_extra')}
        t_by_pos = {(t_name, m['start']): m
                    for t_name, marks in child_t.items() for m in marks
                    if m.get('label') == 'missing'}
        for t_name, marks in child_t.items():
            for m in marks:
                pw = m.get('paired_with')
                if not pw:
                    continue
                partner = s_by_pos.get((pw.get('file'), pw.get('start')))
                if partner is None:
                    m.pop('paired_with', None)
                    continue
                ppw = partner.get('paired_with') or {}
                if (ppw.get('file') != t_name
                        or ppw.get('start') != m['start']):
                    m.pop('paired_with', None)
        for s_name, marks in child_s.items():
            for m in marks:
                pw = m.get('paired_with')
                if not pw:
                    continue
                partner = t_by_pos.get((pw.get('file'), pw.get('start')))
                if partner is None:
                    m.pop('paired_with', None)
                    continue
                ppw = partner.get('paired_with') or {}
                if (ppw.get('file') != s_name
                        or ppw.get('start') != m['start']):
                    m.pop('paired_with', None)

        if student_files:
            default_fname = sorted(student_files.keys())[0]
            try:
                default_eof = len(_read_text_normalized(
                    student_files[default_fname]))
            except Exception:
                default_eof = 0
        else:
            default_fname = None
            default_eof = 0
        for marks in child_t.values():
            for m in marks:
                if (m.get('label') == 'missing'
                        and not m.get('paired_with')
                        and 'insert_at' not in m
                        and default_fname is not None):
                    m['insert_at'] = {'file': default_fname, 'pos': default_eof}

        return child

    pop = [copy.deepcopy(diff_marks) for _ in range(population)]
    for ind in pop[1:]:
        mutate(ind)

    for _ in range(generations):
        scored = [(fitness(ind), ind) for ind in pop]
        scored.sort(key=lambda x: -x[0])
        keep_n = max(1, population // 2)
        keep = scored[:keep_n]
        new_pop = [c[1] for c in keep]
        while len(new_pop) < population:
            if len(keep) >= 2 and rng.random() < 0.5:
                pa, pb = rng.sample(keep, 2)
                child = crossover(pa[1], pb[1])
            else:
                parent = rng.choice(keep)[1]
                child = copy.deepcopy(parent)
            for _ in range(rng.randint(1, 3)):
                mutate(child)
            new_pop.append(child)
        pop = new_pop

    best = max(pop, key=fitness)
    diff_marks['teacher_files'] = best['teacher_files']
    diff_marks['student_files'] = best['student_files']


def _apply_ghost_extra_promotion(
    diff_marks: dict,
    events: list,
) -> None:
    if not events:
        return
    la = diff_marks.get('leo_assignments') or {}
    tokens_data = la.get('tokens') or {}
    teacher_seq_aug = la.get('teacher_seq_aug')
    if not tokens_data or not teacher_seq_aug:
        return
    teacher_match_seq = [
        t if isinstance(t, str) else t[0] for t in teacher_seq_aug
    ]
    student_seq = la.get('student_seq', [])
    k   = la.get('k', _CONTEXT_K)
    idf = la.get('idf') or _compute_idf(teacher_match_seq, student_seq)

    student_marks = diff_marks.get('student_files', {})
    mark_index: Dict[Tuple[str, int, str], dict] = {}
    for fname, marks in student_marks.items():
        for m in marks:
            mark_index[(fname, m.get('start'), m.get('token'))] = m

    def _promote(s_inst: dict, g_inst: dict, tok: str) -> None:
        s_inst['label'] = 'ghost_extra'
        mark = mark_index.get((s_inst.get('file'), s_inst.get('pos'), tok))
        if mark is not None:
            mark['label'] = 'ghost_extra'
            del_ts = g_inst.get('del_ts')
            if del_ts is not None:
                mark['removal_ts'] = ts_to_local(del_ts)

    for tok, td in tokens_data.items():
        students = td.get('student', [])
        teachers = td.get('teacher', [])
        extras = [(i, s) for i, s in enumerate(students) if s.get('label') == 'extra']
        ghosts = [(j, t) for j, t in enumerate(teachers) if t.get('ghost')]
        if not extras or not ghosts:
            continue

        def _is_ghost_pair(midx):
            return (midx is not None
                    and 0 <= midx < len(teachers)
                    and teachers[midx].get('ghost'))

        pre_paired_ghost_idx: set = set()
        unpaired_extras: List[Tuple[int, dict]] = []
        for i, s in extras:
            midx = s.get('match_idx')
            if _is_ghost_pair(midx):
                _promote(s, teachers[midx], tok)
                pre_paired_ghost_idx.add(midx)
            else:
                unpaired_extras.append((i, s))

        unpaired_ghosts = [(j, t) for j, t in ghosts if j not in pre_paired_ghost_idx]
        if not unpaired_extras or not unpaired_ghosts:
            continue

        s_packs = [
            _context_vector_pack(student_seq, s.get('seq_idx'), k, idf)
            for _, s in unpaired_extras
        ]
        g_packs = [
            _context_vector_pack(teacher_match_seq, t.get('seq_idx_aug'), k, idf)
            for _, t in unpaired_ghosts
        ]
        sim = [
            [_combined_context_score(sp, gp) for gp in g_packs]
            for sp in s_packs
        ]
        if not sim or not sim[0]:
            continue

        new_pairs: List[Tuple[dict, dict]] = []
        for s_local, g_local in _hungarian_max(sim):
            if sim[s_local][g_local] < _CONTEXT_MATCH_THRESHOLD:
                continue
            s_idx, s_inst = unpaired_extras[s_local]
            g_idx, g_inst = unpaired_ghosts[g_local]
            s_inst['match_idx'] = g_idx
            g_inst['match_idx'] = s_idx
            new_pairs.append((s_inst, g_inst))

        for s_inst, g_inst in new_pairs:
            _promote(s_inst, g_inst, tok)


def _build_assignments_for_post_pass(
    teacher_files: Dict[str, Path],
    student_files: Dict[str, Path],
    diff_marks: dict,
    events: Optional[list],
) -> Optional[dict]:
    teacher_occs, _ = _collect_occurrences(teacher_files)
    student_occs, _ = _collect_occurrences(student_files)
    teacher_seq = [oc['token'] for oc in teacher_occs if not oc['is_comment']]
    student_seq = [oc['token'] for oc in student_occs if not oc['is_comment']]

    teacher_seq_aug: Optional[list] = None
    seq_idx_to_aug: Optional[Dict[int, int]] = None
    ghost_instances: List[dict] = []
    teacher_ghosts = _collect_teacher_ghosts(events) if events else {}
    if teacher_ghosts:
        teacher_seq_aug, seq_idx_to_aug, ghost_instances = _build_teacher_seq_aug(
            teacher_occs, teacher_ghosts,
        )

    student_by_tok: Dict[str, List[dict]] = {}
    for oc in student_occs:
        if oc['is_comment']:
            continue
        student_by_tok.setdefault(oc['token'], []).append(oc)
    teacher_by_tok: Dict[str, List[dict]] = {}
    for oc in teacher_occs:
        if oc['is_comment']:
            continue
        teacher_by_tok.setdefault(oc['token'], []).append(oc)
    ghost_by_tok: Dict[str, List[dict]] = {}
    for inst in ghost_instances:
        ghost_by_tok.setdefault(inst['token'], []).append(inst)

    extras_by_key: set = set()
    for fname, marks in diff_marks.get('student_files', {}).items():
        for m in marks:
            if m.get('label') == 'extra' and not m.get('line') and m.get('token'):
                extras_by_key.add((fname, m.get('start'), m['token']))
    missings_by_key: set = set()
    for fname, marks in diff_marks.get('teacher_files', {}).items():
        for m in marks:
            if m.get('label') == 'missing' and not m.get('line') and m.get('token'):
                missings_by_key.add((fname, m.get('start'), m['token']))

    tokens_data: Dict[str, dict] = {}
    all_tokens = set(student_by_tok) | set(teacher_by_tok) | set(ghost_by_tok)
    for tok in all_tokens:
        students = student_by_tok.get(tok, [])
        teachers = teacher_by_tok.get(tok, [])
        ghosts = ghost_by_tok.get(tok, [])

        student_entries = []
        any_extra = False
        for s in students:
            label = 'extra' if (s['file'], s['pos'], tok) in extras_by_key else None
            if label == 'extra':
                any_extra = True
            student_entries.append({
                'file': s['file'], 'pos': s['pos'],
                'seq_idx': s['seq_idx'], 'label': label,
            })

        teacher_entries: List[dict] = []
        any_missing = False
        for t in teachers:
            label = 'missing' if (t['file'], t['pos'], tok) in missings_by_key else None
            if label == 'missing':
                any_missing = True
            entry = {
                'file': t['file'], 'pos': t['pos'],
                'seq_idx': t['seq_idx'], 'label': label,
            }
            if seq_idx_to_aug:
                entry['seq_idx_aug'] = seq_idx_to_aug[t['seq_idx']]
            teacher_entries.append(entry)
        for g in ghosts:
            teacher_entries.append({
                'file': g['file'], 'pos': g['blob_pos'],
                'blob_offset': g['blob_offset'],
                'ghost': True, 'del_ts': g['del_ts'],
                'seq_idx_aug': g['seq_idx_aug'],
            })

        if not (any_extra or any_missing or ghosts):
            continue
        tokens_data[tok] = {'teacher': teacher_entries, 'student': student_entries}

    if not tokens_data:
        return None
    teacher_match_seq = (
        [t if isinstance(t, str) else t[0] for t in teacher_seq_aug]
        if teacher_seq_aug is not None else teacher_seq
    )
    idf = _compute_idf(teacher_match_seq, student_seq)
    assignments = {
        'k': _CONTEXT_K,
        'idf': idf,
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

    for t_name, t_path, s_path in _match_files_by_name_then_ext(teacher_files, student_files):
        t_text = _read_text_normalized(t_path)
        s_text = _read_text_normalized(s_path) if s_path else ''
        if not t_text:
            continue

        t_lines_raw = t_text.splitlines()
        s_lines_raw = s_text.splitlines()
        t_starts    = _line_start_offsets(t_text)
        s_starts    = _line_start_offsets(s_text) if s_text else []

        tok_all_positions, file_n = _build_token_position_index(t_text)
        n_total += file_n

        fname   = Path(t_name).name
        s_fname = s_path.name if s_path else fname
        s_fname_native = s_fname if s_path is not None else None

        t_marks:   List[dict] = []
        s_marks:   List[dict] = []
        t_line_ms: List[dict] = []
        s_line_ms: List[dict] = []
        alignment: list       = []

        for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(
            None,
            [l.strip() for l in t_lines_raw],
            [l.strip() for l in s_lines_raw],
            autojunk=False,
        ).get_opcodes():
            if tag == 'equal':
                for k in range(i2 - i1):
                    alignment.append([i1 + k, j1 + k])
            elif tag == 'delete':
                for i in range(i1, i2):
                    _add_unpaired_teacher_line(alignment, t_marks, t_line_ms,
                                                t_lines_raw, t_starts, i, tok_all_positions)
            elif tag == 'insert':
                for j in range(j1, j2):
                    _add_unpaired_student_line(alignment, s_marks, s_line_ms,
                                                s_lines_raw, s_starts, j)
            elif tag == 'replace':
                _add_replace_block(alignment, t_marks, s_marks, t_line_ms, s_line_ms,
                                    t_lines_raw, s_lines_raw, t_starts, s_starts,
                                    i1, i2 - i1, j1, j2 - j1, tok_all_positions,
                                    s_fname=s_fname_native)

        if s_fname_native is not None:
            anchors = _line_anchors_from_alignment(alignment, s_starts, len(s_text))
            _stamp_native_line_insert_at(t_marks, t_starts, anchors, s_fname_native)

        per_file_results.append((fname, s_fname, t_marks, s_marks, t_line_ms, s_line_ms, alignment))

    return _finalize_per_file_diff(per_file_results, n_total)


import subprocess as _subprocess
import re as _re

_GIT_HUNK_RE = _re.compile(r'^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@')


def _git_diff_hunks(t_path: Path, s_path: Path) -> List[Tuple[int, int, int, int]]:
    result = _subprocess.run(
        ['git', 'diff', '--no-index', '--unified=0', '-w',
         str(t_path), str(s_path)],
        capture_output=True, text=True, encoding='utf-8',
    )
    hunks: List[Tuple[int, int, int, int]] = []
    for line in result.stdout.splitlines():
        m = _GIT_HUNK_RE.match(line)
        if m:
            i1 = int(m.group(1))
            ic = int(m.group(2)) if m.group(2) is not None else 1
            j1 = int(m.group(3))
            jc = int(m.group(4)) if m.group(4) is not None else 1
            hunks.append((i1, ic, j1, jc))
    return hunks


def _build_git_diff_marks(
    teacher_files: Dict[str, Path],
    student_files: Dict[str, Path],
) -> Tuple[Dict[str, List[dict]], Dict[str, List[dict]], Optional[float], Dict[str, list], dict, int]:
    n_total = 0
    per_file_results: List[tuple] = []

    for t_name, t_path, s_path in _match_files_by_name_then_ext(teacher_files, student_files):
        t_text = _read_text_normalized(t_path)
        s_text = _read_text_normalized(s_path) if s_path else ''
        if not t_text:
            continue

        t_lines_raw = t_text.splitlines()
        s_lines_raw = s_text.splitlines()
        t_starts    = _line_start_offsets(t_text)
        s_starts    = _line_start_offsets(s_text) if s_text else []

        tok_all_positions, file_n = _build_token_position_index(t_text)
        n_total += file_n

        fname   = Path(t_name).name
        s_fname = s_path.name if s_path else fname
        s_fname_native = s_fname if s_path is not None else None

        t_marks:   List[dict] = []
        s_marks:   List[dict] = []
        t_line_ms: List[dict] = []
        s_line_ms: List[dict] = []
        alignment: list       = []

        hunks = _git_diff_hunks(t_path, s_path) if s_path else []
        t_cursor = s_cursor = 0

        for i1_raw, ic, j1_raw, jc in hunks:
            t_end    = (i1_raw - 1) if ic > 0 else i1_raw
            s_end    = (j1_raw - 1) if jc > 0 else j1_raw
            eq_count = t_end - t_cursor
            _add_paired_line_block(alignment, t_marks, s_marks,
                                    t_lines_raw, s_lines_raw, t_starts, s_starts,
                                    t_cursor, s_cursor, eq_count, tok_all_positions,
                                    s_fname=s_fname_native)
            t_cursor += eq_count
            s_cursor += eq_count

            _add_replace_block(alignment, t_marks, s_marks, t_line_ms, s_line_ms,
                                t_lines_raw, s_lines_raw, t_starts, s_starts,
                                t_end, ic, s_end, jc, tok_all_positions,
                                s_fname=s_fname_native)
            t_cursor = t_end + ic
            s_cursor = s_end + jc

        tail_pair = min(len(t_lines_raw) - t_cursor, len(s_lines_raw) - s_cursor)
        _add_paired_line_block(alignment, t_marks, s_marks,
                                t_lines_raw, s_lines_raw, t_starts, s_starts,
                                t_cursor, s_cursor, tail_pair, tok_all_positions,
                                s_fname=s_fname_native)
        t_cursor += tail_pair
        s_cursor += tail_pair
        while t_cursor < len(t_lines_raw):
            _add_unpaired_teacher_line(alignment, t_marks, t_line_ms,
                                        t_lines_raw, t_starts, t_cursor,
                                        tok_all_positions)
            t_cursor += 1
        while s_cursor < len(s_lines_raw):
            _add_unpaired_student_line(alignment, s_marks, s_line_ms,
                                        s_lines_raw, s_starts, s_cursor)
            s_cursor += 1

        if s_fname_native is not None:
            anchors = _line_anchors_from_alignment(alignment, s_starts, len(s_text))
            _stamp_native_line_insert_at(t_marks, t_starts, anchors, s_fname_native)

        per_file_results.append((fname, s_fname, t_marks, s_marks, t_line_ms, s_line_ms, alignment))

    return _finalize_per_file_diff(per_file_results, n_total)

