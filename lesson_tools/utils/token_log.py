import difflib
import math
from collections import Counter, deque
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


_TOKEN_FILE_HEADER_KEYS = ('Occurrences', 'Removed', 'Unique')


def _write_teacher_tokens_file(
    events: list,
    out_path: Path,
    has_css: bool = True,
) -> Tuple[int, int, int]:
    kw_ts, kw_ts_comment, removed_kw_ts, upper_to_display, occ_with_display = (
        reconstruct_tokens_from_keylog_full(events, has_css=has_css)
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
        'n_extra_star': sum(1 for _, _, fl in all_occ if 'EXTRA*' in fl),
    }


def _build_occ_from_diff_marks(
    diff_marks: dict,
    teacher_entries: list,
    removal_ts_by_token: dict = None,
) -> tuple:
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

    t_comment_ctr: Counter = Counter()
    for marks in diff_marks.get('teacher_files', {}).values():
        for m in marks:
            if m.get('label') == 'comment':
                t_comment_ctr[m['token']] += 1

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
            elif label == 'extra_star':
                rem_ts = m.get('removal_ts') or (removal_ts_by_token or {}).get(tok, '00:00:00')
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
    score_e = (round(max(0.0, (stats['n_found_e'] - stats['n_extra_star']) / teacher_total_e * 100), 1)
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
        stats['n_extra_star'],
    )


def _cosine_similarity_sparse(v1: Counter, v2: Counter) -> float:
    if not v1 or not v2:
        return 0.0
    dot = sum(v1[k] * v2.get(k, 0) for k in v1)
    if dot == 0:
        return 0.0
    n1 = math.sqrt(sum(x * x for x in v1.values()))
    n2 = math.sqrt(sum(x * x for x in v2.values()))
    if n1 == 0 or n2 == 0:
        return 0.0
    return dot / (n1 * n2)


_CONTEXT_K = 10
_CONTEXT_DECAY         = 0.90
_NEIGHBOR_BOOST        = 0
_GHOST_MATCH_THRESHOLD = 0.6


def _context_vector(
    tokens_seq: List[str],
    pos: int,
    k: int,
    decay: float = _CONTEXT_DECAY,
    neighbor_boost: float = _NEIGHBOR_BOOST,
) -> Counter:
    vec: Counter = Counter()
    lo = max(0, pos - k)
    hi = min(len(tokens_seq), pos + k + 1)
    for i in range(lo, hi):
        if i == pos:
            continue
        d = abs(i - pos)
        vec[tokens_seq[i]] += decay ** d
    if pos > 0:
        vec[("L1", tokens_seq[pos - 1])] += neighbor_boost
    if pos + 1 < len(tokens_seq):
        vec[("R1", tokens_seq[pos + 1])] += neighbor_boost
    return vec


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


def _build_ghost_token_budget(events: list) -> Dict[str, deque]:
    if not events:
        return {}
    _, _, removed_kw_ts, _, _ = reconstruct_tokens_from_keylog_full(events)
    by_token: Dict[str, list] = {}
    for tok, occs in removed_kw_ts.items():
        for _ins_ts, del_ts in occs:
            by_token.setdefault(tok, []).append(del_ts)
    return {tok: deque(sorted(ts_list)) for tok, ts_list in by_token.items()}


def _locate_token(
    s_positions: List[int],
    t_positions: List[int],
    s_seq: List[str],
    t_seq: List[str],
    k: int,
) -> dict:
    n_s = len(s_positions)
    n_t = len(t_positions)
    s_ctx = [_context_vector(s_seq, p, k) for p in s_positions]
    t_ctx = [_context_vector(t_seq, p, k) for p in t_positions]

    if n_s == 0 or n_t == 0:
        return {
            'matched_s': set(),
            'missing_t': set(range(n_t)) if n_s == 0 else set(),
            'extra': set(range(n_s)) if n_t == 0 else set(),
            'sim': [],
            'pairs': [],
        }

    sim = [
        [_cosine_similarity_sparse(s_ctx[i], t_ctx[j]) for j in range(n_t)]
        for i in range(n_s)
    ]
    pairs = _hungarian_max(sim)
    matched_s: set = {si for si, _ in pairs}
    matched_t: set = {col for _, col in pairs}
    missing_t = {j for j in range(n_t) if j not in matched_t}
    extra = {i for i in range(n_s) if i not in matched_s}
    return {
        'matched_s': matched_s,
        'missing_t': missing_t,
        'extra': extra,
        'sim': sim,
        'pairs': pairs,
    }


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
    if teacher_ghosts:
        teacher_seq_aug, seq_idx_to_aug, ghost_instances = _build_teacher_seq_aug(
            teacher_occs, teacher_ghosts,
        )
        teacher_match_seq = [
            t if isinstance(t, str) else t[0] for t in teacher_seq_aug
        ]
        for inst in ghost_instances:
            ghost_by_token.setdefault(inst['token'], []).append(inst)

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

        res = _locate_token(
            s_idxs, t_all_idxs,
            student_seq, teacher_match_seq, context_k,
        )
        all_pairs = list(res.get('pairs', []))
        sim = res.get('sim', [])

        real_pairs: List[Tuple[int, int]] = []
        ghost_pairs: List[Tuple[int, int]] = []
        for si, tj in all_pairs:
            if tj < n_real:
                real_pairs.append((si, tj))
            else:
                gj = tj - n_real
                cos = sim[si][tj] if sim and si < len(sim) and tj < len(sim[si]) else 0.0
                if cos >= _GHOST_MATCH_THRESHOLD:
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
                     **({'match_idx': _student_match_idx(i)}
                        if _student_match_idx(i) is not None else {})}
                    for i, oc in enumerate(s_out)
                ],
            }

    assignments = {
        'k': context_k,
        'decay': _CONTEXT_DECAY,
        'neighbor_boost': _NEIGHBOR_BOOST,
        'teacher_seq': teacher_seq,
        'student_seq': student_seq,
        'tokens': tokens_data,
    } if tokens_data else {}
    if assignments and teacher_seq_aug is not None:
        assignments['teacher_seq_aug'] = teacher_seq_aug

    return teacher_colors, student_colors, n_total, n_missing, assignments


def _build_contextual_diff_marks(
    teacher_files: dict,
    student_files: dict,
    context_k: int = _CONTEXT_K,
) -> Tuple[dict, dict]:
    teacher_colors, student_colors, _, _, _ = _compute_per_token_matching(
        teacher_files, student_files, context_k,
    )
    return _prune_color_map(teacher_colors), _prune_color_map(student_colors)


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
    score = round((n_total - n_missing) / n_total * 100, 1) if n_total else None
    try:
        _, _, _, alignments, line_marks, *_ = _build_git_diff_marks(teacher_files, student_files)
    except Exception:
        alignments, line_marks = {}, {}
    return teacher_result, student_result, score, alignments, line_marks, n_total, assignments


def _add_log_metadata(
    diff_marks: dict,
    events: list,
    student_files: Dict[str, Path],
    teacher_files: Optional[Dict[str, Path]] = None,
    has_css: bool = True,
    _ghost_contexts: dict = None,
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

    _apply_leo_ghost_star_to_diff_marks(diff_marks, events)
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


def _apply_ghost_star_to_colors(
    student_colors: dict,
    events: list,
) -> None:
    budget = _build_ghost_token_budget(events)
    if not budget:
        return
    for fname in sorted(student_colors):
        toks = student_colors[fname]
        for tok in sorted(toks):
            if tok not in budget or not budget[tok]:
                continue
            labels = toks[tok]
            for i, label in enumerate(labels):
                if label != 'extra' or not budget[tok]:
                    continue
                budget[tok].popleft()
                labels[i] = 'extra_star'


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
                mark.pop('_tok_idx', None)


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
                            tok_all_positions: Dict[str, List[int]]
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
            for ti in range(i1, i2):
                m = t_tok_ms[ti]
                t_marks.append(_missing_mark(t_off + m.start(), m.group(), tok_all_positions))
        if tag in ('insert', 'replace'):
            for tj in range(j1, j2):
                m = s_tok_ms[tj]
                s_marks.append(_extra_mark(s_off + m.start(), m.group()))
    return t_marks, s_marks


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
                            t_start, s_start, n_paired, tok_all_positions) -> None:
    for k in range(n_paired):
        t_i, s_j = t_start + k, s_start + k
        alignment.append([t_i, s_j])
        if t_i >= len(t_lines_raw) or s_j >= len(s_lines_raw):
            continue
        t_off = t_starts[t_i] if t_i < len(t_starts) else 0
        s_off = s_starts[s_j] if s_j < len(s_starts) else 0
        tm, sm = _diff_line_pair_tokens(
            t_lines_raw[t_i], t_off, s_lines_raw[s_j], s_off, tok_all_positions
        )
        t_marks.extend(tm)
        s_marks.extend(sm)


def _add_replace_block(alignment, t_marks, s_marks, t_line_ms, s_line_ms,
                        t_lines_raw, s_lines_raw, t_starts, s_starts,
                        t_start, n_t, s_start, n_s, tok_all_positions) -> None:
    n_paired = min(n_t, n_s)
    _add_paired_line_block(alignment, t_marks, s_marks,
                            t_lines_raw, s_lines_raw, t_starts, s_starts,
                            t_start, s_start, n_paired, tok_all_positions)
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

        t_marks: List[dict] = []
        s_marks: List[dict] = []
        for tag, i1, i2, j1, j2 in opcodes_fn(t_seq, s_seq):
            if tag == 'equal':
                continue
            if tag in ('delete', 'replace'):
                n_missing += i2 - i1
                for i in range(i1, i2):
                    pos, tok = t_nc[i]
                    t_marks.append(_missing_mark(pos, tok, tok_all_positions))
            if tag in ('insert', 'replace'):
                for j in range(j1, j2):
                    pos, tok = s_nc[j]
                    s_marks.append(_extra_mark(pos, tok))

        for pos, tok in t_cm:
            t_marks.append(_comment_pos_mark(pos, tok))
        for pos, tok in s_cm:
            s_marks.append(_comment_pos_mark(pos, tok))

        fname = Path(t_name).name
        s_fname = s_path.name if s_path else fname
        if t_marks:
            teacher_result[fname] = sorted(t_marks, key=lambda x: x['start'])
        if s_marks:
            student_result[s_fname] = sorted(s_marks, key=lambda x: x['start'])

    score = round((n_total - n_missing) / n_total * 100, 1) if n_total else None
    try:
        _, _, _, alignments, line_marks, *_ = _build_git_diff_marks(teacher_files, student_files)
    except Exception:
        alignments, line_marks = {}, {}
    return teacher_result, student_result, score, alignments, line_marks, n_total


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


def _apply_ghost_star_to_diff_marks(
    diff_marks: dict,
    events: list,
) -> None:
    if not events:
        return
    student_marks = diff_marks.get('student_files', {})
    if not student_marks:
        return
    budget = _build_ghost_token_budget(events)
    if not budget:
        return

    for fname in sorted(student_marks):
        for mark in student_marks[fname]:
            if mark.get('label') != 'extra' or mark.get('line'):
                continue
            tok = mark.get('token')
            if not tok or tok not in budget or not budget[tok]:
                continue
            del_ts = budget[tok].popleft()
            mark['label'] = 'extra_star'
            mark['removal_ts'] = ts_to_local(del_ts)


def _apply_leo_ghost_star_to_diff_marks(
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
    k     = la.get('k', _CONTEXT_K)
    decay = la.get('decay', _CONTEXT_DECAY)
    boost = la.get('neighbor_boost', _NEIGHBOR_BOOST)

    student_marks = diff_marks.get('student_files', {})
    mark_index: Dict[Tuple[str, int, str], dict] = {}
    for fname, marks in student_marks.items():
        for m in marks:
            mark_index[(fname, m.get('start'), m.get('token'))] = m

    for tok, td in tokens_data.items():
        students = td.get('student', [])
        teachers = td.get('teacher', [])
        extras = [(i, s) for i, s in enumerate(students) if s.get('label') == 'extra']
        ghosts = [(j, t) for j, t in enumerate(teachers) if t.get('ghost')]
        if not extras or not ghosts:
            continue

        def _promote(s_inst: dict, g_inst: dict) -> None:
            s_inst['label'] = 'extra_star'
            mark = mark_index.get(
                (s_inst.get('file'), s_inst.get('pos'), tok),
            )
            if mark is not None:
                mark['label'] = 'extra_star'
                del_ts = g_inst.get('del_ts')
                if del_ts is not None:
                    mark['removal_ts'] = ts_to_local(del_ts)

        pre_matched_ghost_local: set = set()
        unmatched_extras: List[Tuple[int, dict]] = []
        for i, s in extras:
            midx = s.get('match_idx')
            if midx is not None and 0 <= midx < len(teachers) and teachers[midx].get('ghost'):
                _promote(s, teachers[midx])
                for g_local, (j, _) in enumerate(ghosts):
                    if j == midx:
                        pre_matched_ghost_local.add(g_local)
                        break
            else:
                unmatched_extras.append((i, s))

        if not unmatched_extras:
            continue
        remaining_ghosts = [
            (g_local, j, t)
            for g_local, (j, t) in enumerate(ghosts)
            if g_local not in pre_matched_ghost_local
        ]
        if not remaining_ghosts:
            continue

        s_ctxs = [
            _context_vector(student_seq, s.get('seq_idx'), k, decay, boost)
            for _, s in unmatched_extras
        ]
        g_ctxs = [
            _context_vector(teacher_match_seq, t.get('seq_idx_aug'), k, decay, boost)
            for _, _, t in remaining_ghosts
        ]
        sim = [
            [_cosine_similarity_sparse(sc, gc) for gc in g_ctxs]
            for sc in s_ctxs
        ]
        if not sim or not sim[0]:
            continue
        pairs = _hungarian_max(sim)

        for s_local, g_local in pairs:
            cos = sim[s_local][g_local]
            if cos < _GHOST_MATCH_THRESHOLD:
                continue
            s_idx, s_inst = unmatched_extras[s_local]
            _, g_idx, g_inst = remaining_ghosts[g_local]
            s_inst['match_idx'] = g_idx
            g_inst['match_idx'] = s_idx
            _promote(s_inst, g_inst)


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
    assignments = {
        'k': _CONTEXT_K,
        'decay': _CONTEXT_DECAY,
        'neighbor_boost': _NEIGHBOR_BOOST,
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
                                    i1, i2 - i1, j1, j2 - j1, tok_all_positions)

        fname   = Path(t_name).name
        s_fname = s_path.name if s_path else fname
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
            for k in range(eq_count):
                alignment.append([t_cursor + k, s_cursor + k])
            t_cursor += eq_count
            s_cursor += eq_count

            _add_replace_block(alignment, t_marks, s_marks, t_line_ms, s_line_ms,
                                t_lines_raw, s_lines_raw, t_starts, s_starts,
                                t_end, ic, s_end, jc, tok_all_positions)
            t_cursor = t_end + ic
            s_cursor = s_end + jc

        while t_cursor < len(t_lines_raw) or s_cursor < len(s_lines_raw):
            t_val = t_cursor if t_cursor < len(t_lines_raw) else None
            s_val = s_cursor if s_cursor < len(s_lines_raw) else None
            alignment.append([t_val, s_val])
            if t_cursor < len(t_lines_raw):
                t_cursor += 1
            if s_cursor < len(s_lines_raw):
                s_cursor += 1

        fname   = Path(t_name).name
        s_fname = s_path.name if s_path else fname
        per_file_results.append((fname, s_fname, t_marks, s_marks, t_line_ms, s_line_ms, alignment))

    return _finalize_per_file_diff(per_file_results, n_total)

