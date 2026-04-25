import difflib
import json
import math
import os
import shutil
from collections import Counter
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import bisect
import numpy as np
from scipy.optimize import linear_sum_assignment
from . import similarity_measures as _sm

from .similarity_measures import (
    _COMMENT_RE,
    get_reconstructed_files,
    reconstruct_tokens_from_keylog_full,
    split_code_tokens,
    ts_to_local,
)
from .lv_editor import replay_with_timestamps_all


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


def _parse_teacher_tokens(path: Path) -> List[Tuple[str, str, bool, bool, str]]:
    entries: List[Tuple[str, str, bool, bool, str]] = []
    with open(path, encoding='utf-8') as f:
        for line in f:
            stripped = line.rstrip('\n')
            if stripped.startswith('# ') or not stripped:
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
    return entries


def _comment_ranges_for_ext(text: str, _ext: str = ''):
    starts, ends = [], []
    for m in _COMMENT_RE.finditer(text):
        starts.append(m.start())
        ends.append(m.end())
    return starts, ends


def _pos_in_comment(pos: int, starts: list, ends: list) -> bool:
    idx = bisect.bisect_right(starts, pos) - 1
    return idx >= 0 and ends[idx] > pos


def _scan_file_tokens(text: str, ext: str) -> Dict[str, List[Tuple[int, bool]]]:
    c_starts, c_ends = _comment_ranges_for_ext(text, ext)
    result: Dict[str, List[Tuple[int, bool]]] = {}
    for m in _sm._CHAR_TOKEN_RE.finditer(text):
        tok = m.group()
        pos = m.start()
        result.setdefault(tok, []).append((pos, _pos_in_comment(pos, c_starts, c_ends)))
    return result


def _build_teacher_file_coloring(text: str, ext: str,
                                  miss_budget: dict, comm_tokens: dict) -> dict:
    tok_occs = _scan_file_tokens(text, ext)
    result = {}
    for tok in set(miss_budget) | set(comm_tokens):
        occs = tok_occs.get(tok)
        if not occs:
            continue
        labels = []
        for _, is_c in occs:
            if is_c:
                labels.append('comment')
                comm_tokens[tok] = max(0, comm_tokens.get(tok, 0) - 1)
            elif miss_budget.get(tok, 0) > 0:
                labels.append('missing'); miss_budget[tok] -= 1
            else:
                labels.append(None)
        if any(l is not None for l in labels):
            result[tok] = labels
    return result


def _build_student_file_coloring(text: str, ext: str,
                                  found_out: dict, found_comm: dict,
                                  star: dict, extra: dict, extra_comm: dict) -> dict:
    tok_occs = _scan_file_tokens(text, ext)
    all_toks = set(found_out) | set(found_comm) | set(star) | set(extra) | set(extra_comm)
    result = {}
    for tok in all_toks:
        occs = tok_occs.get(tok)
        if not occs:
            continue
        labels = []
        for _, is_c in occs:
            if is_c:
                labels.append('comment')
                if found_comm.get(tok, 0) > 0:
                    found_comm[tok] -= 1
                elif extra_comm.get(tok, 0) > 0:
                    extra_comm[tok] -= 1
            else:
                if found_out.get(tok, 0) > 0:
                    labels.append(None); found_out[tok] -= 1
                elif star.get(tok, 0) > 0:
                    labels.append('extra_star'); star[tok] -= 1
                elif extra.get(tok, 0) > 0:
                    labels.append('extra'); extra[tok] -= 1
                else:
                    labels.append(None)
        if any(l is not None for l in labels):
            result[tok] = labels
    return result


def _extract_student_tokens(stu_files: dict):
    outside: Counter = Counter()
    comment: Counter = Counter()
    for _, path in stu_files.items():
        try:
            raw = path.read_text(encoding='utf-8', errors='ignore')
        except Exception:
            continue
        out, ins = split_code_tokens(raw)
        outside += out
        comment += ins
    return outside, comment


def _build_student_token_occurrences(
    teacher_entries: list,
    student_outside: Counter,
    student_comment: Counter,
) -> Tuple[list, int, int, int, float, dict]:
    teacher_occ = [
        (tok, ts_str, is_comment)
        for tok, ts_str, is_comment, is_removed, *_ in teacher_entries
        if not is_removed
    ]
    student_total = student_outside + student_comment

    consumed = {True: Counter(), False: Counter()}
    all_occ: List[Tuple[str, str, set]] = []
    for tok, ts_str, is_comment in teacher_occ:
        pool = student_comment if is_comment else student_outside
        cons = consumed[is_comment]
        if cons[tok] < pool.get(tok, 0):
            cons[tok] += 1
            all_occ.append((ts_str, tok, {'COMMENT'} if is_comment else set()))
        else:
            base_flags: set = {'COMMENT'} if is_comment else set()
            all_occ.append((ts_str, tok, base_flags | {'MISSING'}))

    for tok in sorted(student_total):
        extra_outside = student_outside[tok] - consumed[False][tok]
        extra_comment = student_comment[tok] - consumed[True][tok]
        for _ in range(max(0, extra_outside)):
            all_occ.append(('00:00:00', tok, {'EXTRA'}))
        for _ in range(max(0, extra_comment)):
            all_occ.append(('00:00:00', tok, {'COMMENT', 'EXTRA'}))

    all_occ.sort(key=lambda x: (x[0] == '00:00:00', x[0]))

    n_found   = sum(1 for _, _, fl in all_occ if not fl or fl == {'COMMENT'})
    n_missing = sum(1 for _, _, fl in all_occ if 'MISSING' in fl)
    n_extra   = sum(1 for _, _, fl in all_occ if 'EXTRA' in fl)

    n_found_e       = sum(1 for _, _, fl in all_occ if not fl)
    n_missing_e     = sum(1 for _, _, fl in all_occ if fl == {'MISSING'})
    teacher_total_e = n_found_e + n_missing_e
    follow_e_pct    = round(n_found_e / teacher_total_e * 100, 1) if teacher_total_e else 0.0

    return all_occ, n_found, n_missing, n_extra, follow_e_pct, consumed


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


def _context_vector(
    tokens_seq: List[str],
    pos: int,
    k: int,
    exclude_positions: set = None,
) -> Counter:
    vec = Counter()
    if exclude_positions:
        left, right = pos - 1, pos + 1
        left_count = right_count = 0
        while left_count < k and left >= 0:
            if left not in exclude_positions:
                vec[tokens_seq[left]] += 1
                left_count += 1
            left -= 1
        while right_count < k and right < len(tokens_seq):
            if right not in exclude_positions:
                vec[tokens_seq[right]] += 1
                right_count += 1
            right += 1
    else:
        lo = max(0, pos - k)
        hi = min(len(tokens_seq), pos + k + 1)
        for i in range(lo, hi):
            if i != pos:
                vec[tokens_seq[i]] += 1
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


_CONTEXT_K = 6   # neighbor window for teacher/student context vectors
_GHOST_K   = 6   # neighbor window for ghost context vectors (and narrow student comparison)
_GHOST_SIM_THRESHOLD = 0.5  # minimum cosine similarity to ghost context to assign extra_star (Hungarian mode only)
_GHOST_STAR_MUTUAL = os.environ.get('STUDENT_ANALYTICS_GHOST_MUTUAL', '1') == '1'

def _build_ghost_contexts(
    all_events: list,
    token_keys: set,
    k: int = _GHOST_K,
) -> Dict[str, List[Counter]]:
    from .lv_editor import reconstruct_all_headless_at_timestamps

    _tok_re = _sm._CHAR_TOKEN_RE

    _, deleted = replay_with_timestamps_all(all_events)
    if not deleted:
        return {}

    del_token_occs: Dict[str, List[Tuple[int, int]]] = {}
    seg: List[Tuple[int, str, int, int]] = []

    def _flush_seg(s: list) -> None:
        if not s:
            return
        text = ''.join(ch for _, ch, _, _ in s)
        for m in _tok_re.finditer(text):
            tok = m.group()
            if tok not in token_keys:
                continue
            _, _, ins_ts, del_ts = s[m.end() - 1]
            del_token_occs.setdefault(tok, []).append((ins_ts, del_ts))

    for ch, ins_ts, del_ts, idx in sorted(deleted, key=lambda x: x[3]):
        if ch in ('\n', '\r'):
            _flush_seg(seg)
            seg = []
        else:
            seg.append((idx, ch, ins_ts, del_ts))
    _flush_seg(seg)

    if not del_token_occs:
        return {}

    relevant_del_ts = {
        del_ts
        for tok in token_keys
        for _ins_ts, del_ts in del_token_occs.get(tok, [])
    }

    batch_chars: Dict[int, List[Tuple]] = {}
    for ch, ins_ts, del_ts, idx in deleted:
        if del_ts in relevant_del_ts:
            batch_chars.setdefault(del_ts, []).append((idx, ch))

    del_ts_co_tokens: Dict[int, List[str]] = {}
    for dt, chars in batch_chars.items():
        chars.sort()
        toks: List[str] = []
        seg2: List[str] = []
        for _, ch in chars:
            if ch in ('\n', '\r'):
                if seg2:
                    toks.extend(m.group() for m in _tok_re.finditer(''.join(seg2)))
                    seg2 = []
            else:
                seg2.append(ch)
        if seg2:
            toks.extend(m.group() for m in _tok_re.finditer(''.join(seg2)))
        del_ts_co_tokens[dt] = toks

    reconstructed_at: Dict[int, List[str]] = {}
    for dt, texts in reconstruct_all_headless_at_timestamps(all_events, sorted(relevant_del_ts)).items():
        toks: List[str] = []
        for tab_key, text in texts.items():
            ext = Path(tab_key).suffix.lower() or '.html'
            c_starts, c_ends = _comment_ranges_for_ext(text, ext)
            for m in _tok_re.finditer(text):
                if not _pos_in_comment(m.start(), c_starts, c_ends):
                    toks.append(m.group())
        reconstructed_at[dt] = toks

    def _pick_pos(positions: List[int], seq: List[str], co_toks: Counter) -> int:
        if len(positions) == 1 or not co_toks:
            return positions[0]
        best_pos, best_score = positions[0], -1
        for pos in positions:
            lo, hi = max(0, pos - k), min(len(seq), pos + k + 1)
            neighbors = Counter(seq[lo:pos] + seq[pos + 1:hi])
            score = sum(min(neighbors[t], v) for t, v in co_toks.items())
            if score > best_score:
                best_score, best_pos = score, pos
        return best_pos

    ghost_ctxs: Dict[str, List[Counter]] = {}
    for tok in token_keys:
        vecs: List[Counter] = []
        for _ins_ts, del_ts in del_token_occs.get(tok, []):
            seq = reconstructed_at.get(del_ts, [])
            positions = [i for i, t in enumerate(seq) if t == tok]
            if not positions:
                vecs.append(Counter())
                continue

            co_toks = Counter(del_ts_co_tokens.get(del_ts, []))
            del co_toks[tok]

            if len(co_toks) >= 2 and len(positions) > 1:
                batch_seq = list(co_toks.elements()) + [tok]
                vecs.append(_context_vector(batch_seq, len(batch_seq) - 1, k))
            else:
                vecs.append(_context_vector(seq, _pick_pos(positions, seq, co_toks), k))

        if vecs:
            ghost_ctxs[tok] = vecs

    return ghost_ctxs


def _ghost_star_idxs(
    extra_pairs: List[Tuple[int, str]],
    s_seq: List[str],
    ghost_contexts: Dict[str, List[Counter]],
    k: int,
) -> set:
    if not ghost_contexts or not extra_pairs:
        return set()

    by_tok: Dict[str, List[Tuple[int, int]]] = {}
    for pair_idx, (seq_idx, tok) in enumerate(extra_pairs):
        if tok in ghost_contexts:
            by_tok.setdefault(tok, []).append((pair_idx, seq_idx))

    star_pair_idxs: set = set()
    for tok, items in by_tok.items():
        ghost_vecs = ghost_contexts[tok]
        positions = [seq_idx for _, seq_idx in items]

        tok_keep = frozenset(t for v in ghost_vecs for t in v) | {tok}
        filt_items = [(i, t) for i, t in enumerate(s_seq) if t in tok_keep]
        filt_seq = [t for _, t in filt_items]
        orig_to_filt = {i: fi for fi, (i, _) in enumerate(filt_items)}

        s_ctx = [
            _context_vector(filt_seq, orig_to_filt[p], k)
            if p in orig_to_filt else Counter()
            for p in positions
        ]

        sim = [
            [_cosine_similarity_sparse(s_ctx[i], ghost_vecs[j]) for j in range(len(ghost_vecs))]
            for i in range(len(positions))
        ]

        if _GHOST_STAR_MUTUAL:
            n_e, n_g = len(positions), len(ghost_vecs)
            best_ghost = [max(range(n_g), key=lambda j: sim[i][j]) for i in range(n_e)]
            best_extra = [max(range(n_e), key=lambda ii: sim[ii][j]) for j in range(n_g)]
            for i, j in enumerate(best_ghost):
                if sim[i][j] > 0 and best_extra[j] == i:
                    star_pair_idxs.add(items[i][0])
        else:
            for si, gj in _hungarian_max(sim):
                if sim[si][gj] >= _GHOST_SIM_THRESHOLD:
                    star_pair_idxs.add(items[si][0])

    return star_pair_idxs


def _locate_token(
    s_positions: List[int],
    t_positions: List[int],
    s_seq: List[str],
    t_seq: List[str],
    k: int,
) -> Tuple[set, set, set]:
    n_s = len(s_positions)
    n_t = len(t_positions)

    if n_s == 0:
        return set(), set(range(n_t)), set()
    if n_t == 0:
        return set(), set(), set(range(n_s))

    s_ctx = [_context_vector(s_seq, p, k) for p in s_positions]
    t_ctx = [_context_vector(t_seq, p, k) for p in t_positions]

    sim = [
        [_cosine_similarity_sparse(s_ctx[i], t_ctx[j]) for j in range(n_t)]
        for i in range(n_s)
    ]

    pairs = _hungarian_max(sim)

    matched_s: set = set()
    matched_t: set = set()
    for si, col in pairs:
        matched_s.add(si)
        matched_t.add(col)

    missing_t = {j for j in range(n_t) if j not in matched_t}
    extra = {i for i in range(n_s) if i not in matched_s}

    return matched_s, missing_t, extra


def _collect_occurrences(files_by_ext: dict, token_keys: set = None) -> Tuple[List[dict], Dict[str, Dict[str, int]]]:
    occs: List[dict] = []
    counts: Dict[str, Dict[str, int]] = {}

    for file_order, (name, path) in enumerate(files_by_ext.items()):
        ext = Path(name).suffix.lower()
        try:
            raw = path.read_text(encoding='utf-8', errors='ignore')
        except Exception:
            continue
        tok_occs = _scan_file_tokens(raw, ext)
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


def _build_contextual_diff_marks(
    teacher_files: dict,
    student_files: dict,
    context_k: int = _CONTEXT_K,
) -> Tuple[dict, dict]:
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

    teacher_colors = {
        fn: {tok: [None] * n for tok, n in toks.items()}
        for fn, toks in teacher_counts.items()
    }
    student_colors = {
        fn: {tok: [None] * n for tok, n in toks.items()}
        for fn, toks in student_counts.items()
    }

    for tok in token_keys:
        t_list = teacher_by_token.get(tok, [])
        s_list = student_by_token.get(tok, [])

        t_out = [x for x in t_list if not x['is_comment']]
        t_com = [x for x in t_list if x['is_comment']]
        s_out = [x for x in s_list if not x['is_comment']]
        s_com = [x for x in s_list if x['is_comment']]

        t_out_pos = [x['seq_idx'] for x in t_out]
        s_out_pos = [x['seq_idx'] for x in s_out]
        _mso, missing_to, extra_so = _locate_token(
            s_out_pos, t_out_pos, student_seq, teacher_seq, context_k,
        )

        for i, oc in enumerate(t_out):
            arr = teacher_colors[oc['file']][tok]
            if i in missing_to:
                arr[oc['file_idx']] = 'missing'

        for oc in t_com:
            arr = teacher_colors[oc['file']][tok]
            arr[oc['file_idx']] = 'comment'

        for i, oc in enumerate(s_out):
            arr = student_colors[oc['file']][tok]
            if i in extra_so:
                arr[oc['file_idx']] = 'extra'

        for oc in s_com:
            arr = student_colors[oc['file']][tok]
            arr[oc['file_idx']] = 'comment'

    def _prune(file_map: dict) -> dict:
        out = {}
        for fn, toks in file_map.items():
            kept = {tok: arr for tok, arr in toks.items() if any(x is not None for x in arr)}
            if kept:
                out[fn] = kept
        return out

    return _prune(teacher_colors), _prune(student_colors)


def _build_leo_diff_marks(
    teacher_files: dict,
    student_files: dict,
    context_k: int = _CONTEXT_K,
) -> Tuple[dict, dict, Optional[float]]:
    teacher_occs, teacher_counts = _collect_occurrences(teacher_files)
    student_occs, _ = _collect_occurrences(student_files)

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

    teacher_colors = {
        fn: {tok: [None] * n for tok, n in toks.items()}
        for fn, toks in teacher_counts.items()
    }
    student_counts_local = {}
    for oc in student_occs:
        student_counts_local.setdefault(oc['file'], {}).setdefault(oc['token'], 0)
        student_counts_local[oc['file']][oc['token']] += 1
    student_colors = {
        fn: {tok: [None] * n for tok, n in toks.items()}
        for fn, toks in student_counts_local.items()
    }

    n_total = 0
    n_missing = 0

    for tok in token_keys:
        t_list = teacher_by_token.get(tok, [])
        s_list = student_by_token.get(tok, [])

        t_out = [x for x in t_list if not x['is_comment']]
        t_com = [x for x in t_list if x['is_comment']]
        s_out = [x for x in s_list if not x['is_comment']]
        s_com = [x for x in s_list if x['is_comment']]

        n_total += len(t_out)
        t_out_pos = [x['seq_idx'] for x in t_out]
        s_out_pos = [x['seq_idx'] for x in s_out]
        _mso, missing_to, extra_so = _locate_token(
            s_out_pos, t_out_pos, student_seq, teacher_seq, context_k,
        )
        n_missing += len(missing_to)

        for i, oc in enumerate(t_out):
            arr = teacher_colors[oc['file']][tok]
            if i in missing_to:
                arr[oc['file_idx']] = 'missing'

        for oc in t_com:
            arr = teacher_colors[oc['file']][tok]
            arr[oc['file_idx']] = 'comment'

        for i, oc in enumerate(s_out):
            arr = student_colors[oc['file']][tok]
            if i in extra_so:
                arr[oc['file_idx']] = 'extra'

        for oc in s_com:
            arr = student_colors[oc['file']][tok]
            arr[oc['file_idx']] = 'comment'

    def _prune(file_map: dict) -> dict:
        out = {}
        for fn, toks in file_map.items():
            kept = {tok: arr for tok, arr in toks.items() if any(x is not None for x in arr)}
            if kept:
                out[fn] = kept
        return out

    teacher_result = _colors_to_position_marks(teacher_files, _prune(teacher_colors))
    student_result = _colors_to_position_marks(student_files, _prune(student_colors))
    score = round((n_total - n_missing) / n_total * 100, 1) if n_total else None
    return teacher_result, student_result, score


def _add_log_metadata(
    diff_marks: dict,
    events: list,
    student_files: Dict[str, Path],
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
                    idx = tok_seen[tok]
                    tok_seen[tok] += 1
                    ts_list = ts_map.get(tok, [])
                    if idx < len(ts_list):
                        mark['timestamp'] = ts_list[idx]

    ghost_contexts = _ghost_contexts
    if ghost_contexts is None:
        _, _, removed_kw_ts, _, _ = reconstruct_tokens_from_keylog_full(events, has_css=has_css)
        removed_keys = set(removed_kw_ts.keys())
        if removed_keys:
            ghost_contexts = _build_ghost_contexts(events, removed_keys)
    if ghost_contexts:
        _apply_ghost_star_to_diff_marks(diff_marks, student_files, ghost_contexts)


def _apply_ghost_star_to_colors(
    student_colors: dict,
    student_files: Dict[str, Path],
    ghost_contexts: Dict[str, List[Counter]],
    k: int = _GHOST_K,
) -> None:
    """Promote 'extra' â†’ 'extra_star' in the colors-map format. Modifies in-place.

    The colors map is {filename: {token: [label|None, ...]}} where each label
    corresponds to the occurrence of that token at its file_idx (all occurrences,
    comment and non-comment). Rebuilds the student non-comment sequence to compute
    the same ghost-context matching used by _apply_ghost_star_to_diff_marks.
    """
    if not ghost_contexts:
        return

    s_seq: List[str] = []
    extra_pairs: List[Tuple[int, str]] = []
    extra_info: List[Tuple[str, str, int]] = []  # (fname, token, file_idx)

    for _, path in student_files.items():
        fname = path.name
        try:
            raw = path.read_text(encoding='utf-8', errors='ignore')
        except Exception:
            continue
        c_starts, c_ends = _comment_ranges_for_ext(raw)
        tok_seen: Counter = Counter()
        for m in _sm._CHAR_TOKEN_RE.finditer(raw):
            tok = m.group()
            fidx = tok_seen[tok]
            tok_seen[tok] += 1
            if _pos_in_comment(m.start(), c_starts, c_ends):
                continue
            seq_idx = len(s_seq)
            s_seq.append(tok)
            labels = student_colors.get(fname, {}).get(tok)
            if labels and fidx < len(labels) and labels[fidx] == 'extra':
                extra_pairs.append((seq_idx, tok))
                extra_info.append((fname, tok, fidx))

    if extra_pairs:
        for pair_idx in _ghost_star_idxs(extra_pairs, s_seq, ghost_contexts, k):
            fname, tok, fidx = extra_info[pair_idx]
            student_colors[fname][tok][fidx] = 'extra_star'


def _build_utf16_map(text: str) -> List[int]:
    u16map = []
    u16 = 0
    for ch in text:
        u16map.append(u16)
        u16 += 2 if ord(ch) > 0xFFFF else 1
    u16map.append(u16)
    return u16map


def _colors_to_position_marks(files_by_ext: dict, colors_map: dict, ts_map: Dict[str, List[str]] = None) -> dict:
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
        if label == 'missing' and ts_map:
            ts_list = ts_map.get(tok, [])
            if gidx < len(ts_list):
                mark['timestamp'] = ts_list[gidx]
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


def _tokenize_file_ordered(text: str, _ext: str = '') -> List[Tuple[int, str]]:
    return [(m.start(), m.group()) for m in _sm._CHAR_TOKEN_RE.finditer(text)]


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


def _build_lcs_token_diff_marks(
    teacher_files: Dict[str, Path],
    student_files: Dict[str, Path],
) -> Tuple[Dict[str, List[dict]], Dict[str, List[dict]], Optional[float]]:
    teacher_result: Dict[str, List[dict]] = {}
    student_result: Dict[str, List[dict]] = {}
    n_total = 0
    n_missing = 0

    for t_name, t_path, s_path in _match_files_by_name_then_ext(teacher_files, student_files):
        ext = Path(t_name).suffix.lower()
        try:
            t_text = t_path.read_text(encoding='utf-8', errors='ignore').replace('\r\n', '\n')
        except Exception:
            continue

        s_text = ''
        if s_path:
            try:
                s_text = s_path.read_text(encoding='utf-8', errors='ignore').replace('\r\n', '\n')
            except Exception:
                pass

        t_all = _tokenize_file_ordered(t_text, ext)
        s_all = _tokenize_file_ordered(s_text, ext) if s_text else []

        t_cs, t_ce = _comment_ranges_for_ext(t_text, ext)
        s_cs, s_ce = _comment_ranges_for_ext(s_text, ext) if s_text else ([], [])

        t_nc = [(pos, tok) for pos, tok in t_all if not _pos_in_comment(pos, t_cs, t_ce)]
        t_cm = [(pos, tok) for pos, tok in t_all if _pos_in_comment(pos, t_cs, t_ce)]
        s_nc = [(pos, tok) for pos, tok in s_all if not _pos_in_comment(pos, s_cs, s_ce)]
        s_cm = [(pos, tok) for pos, tok in s_all if _pos_in_comment(pos, s_cs, s_ce)]

        t_seq = [tok for _, tok in t_nc]
        s_seq = [tok for _, tok in s_nc]
        n_total += len(t_seq)

        sm = difflib.SequenceMatcher(None, t_seq, s_seq, autojunk=False)

        t_marks: List[dict] = []
        s_marks: List[dict] = []
        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            if tag == 'equal':
                continue
            if tag in ('delete', 'replace'):
                n_missing += i2 - i1
                for i in range(i1, i2):
                    pos, tok = t_nc[i]
                    t_marks.append({'token': tok, 'label': 'missing',
                                    'start': pos, 'end': pos + len(tok)})
            if tag in ('insert', 'replace'):
                for j in range(j1, j2):
                    pos, tok = s_nc[j]
                    s_marks.append({'token': tok, 'label': 'extra',
                                    'start': pos, 'end': pos + len(tok)})

        for pos, tok in t_cm:
            t_marks.append({'token': tok, 'label': 'comment',
                            'start': pos, 'end': pos + len(tok)})
        for pos, tok in s_cm:
            s_marks.append({'token': tok, 'label': 'comment',
                            'start': pos, 'end': pos + len(tok)})

        fname = Path(t_name).name
        s_fname = s_path.name if s_path else fname
        if t_marks:
            teacher_result[fname] = sorted(t_marks, key=lambda x: x['start'])
        if s_marks:
            student_result[s_fname] = sorted(s_marks, key=lambda x: x['start'])

    score = round((n_total - n_missing) / n_total * 100, 1) if n_total else None
    return teacher_result, student_result, score


def _apply_ghost_star_to_diff_marks(
    diff_marks: dict,
    student_files: Dict[str, Path],
    ghost_contexts: Dict[str, List[Counter]],
    k: int = _GHOST_K,
) -> None:
    """Promote 'extra' â†’ 'extra_star' in diff_marks['student_files']. Modifies in-place.

    Works on position-mark format produced by _build_leo_diff_marks
    (via _colors_to_position_marks) and _build_lcs_token_diff_marks.
    """
    if not ghost_contexts:
        return
    student_marks = diff_marks.get('student_files', {})
    if not student_marks:
        return

    s_seq: List[str] = []
    extra_pairs: List[Tuple[int, str]] = []
    extra_update: List[Tuple[str, int]] = []  # (fname, mark_idx) per pair

    for _, path in student_files.items():
        fname = path.name
        try:
            raw = path.read_text(encoding='utf-8', errors='ignore')
        except Exception:
            continue
        c_starts, c_ends = _comment_ranges_for_ext(raw)
        u16map = _build_utf16_map(raw) if any(ord(c) > 0xFFFF for c in raw) else None

        extra_by_pos: Dict[Tuple[int, str], int] = {}
        for mark_idx, mark in enumerate(student_marks.get(fname, [])):
            if mark.get('label') == 'extra' and not mark.get('line'):
                if mark.get('token'):
                    extra_by_pos[(mark['start'], mark['token'])] = mark_idx
                else:
                    span = raw[mark['start']:mark['end']]
                    for sm in _sm._CHAR_TOKEN_RE.finditer(span):
                        extra_by_pos[(mark['start'] + sm.start(), sm.group())] = mark_idx

        for m in _sm._CHAR_TOKEN_RE.finditer(raw):
            if _pos_in_comment(m.start(), c_starts, c_ends):
                continue
            tok = m.group()
            seq_idx = len(s_seq)
            s_seq.append(tok)
            if extra_by_pos:
                u16_pos = u16map[m.start()] if u16map else m.start()
                mark_idx = extra_by_pos.pop((u16_pos, tok), None)
                if mark_idx is None and u16map:
                    mark_idx = extra_by_pos.pop((m.start(), tok), None)
                if mark_idx is not None:
                    extra_pairs.append((seq_idx, tok))
                    extra_update.append((fname, mark_idx))

    if extra_pairs:
        for pair_idx in _ghost_star_idxs(extra_pairs, s_seq, ghost_contexts, k):
            fname, mark_idx = extra_update[pair_idx]
            student_marks[fname][mark_idx]['label'] = 'extra_star'


def _build_context_first_diff_marks(
    teacher_files: Dict[str, Path],
    student_files: Dict[str, Path],
    k = 1
) -> Tuple[Dict[str, List[dict]], Dict[str, List[dict]], Optional[float]]:
    teacher_result: Dict[str, List[dict]] = {}
    student_result: Dict[str, List[dict]] = {}
    n_total = 0
    n_matched = 0

    for t_name, t_path, s_path in _match_files_by_name_then_ext(teacher_files, student_files):
        ext = Path(t_name).suffix.lower()
        try:
            t_text = t_path.read_text(encoding='utf-8', errors='ignore').replace('\r\n', '\n')
        except Exception:
            continue

        s_text = ''
        if s_path:
            try:
                s_text = s_path.read_text(encoding='utf-8', errors='ignore').replace('\r\n', '\n')
            except Exception:
                pass

        t_all = _tokenize_file_ordered(t_text, ext)
        s_all = _tokenize_file_ordered(s_text, ext) if s_text else []

        t_cs, t_ce = _comment_ranges_for_ext(t_text, ext)
        s_cs, s_ce = _comment_ranges_for_ext(s_text, ext) if s_text else ([], [])

        t_nc = [(pos, tok) for pos, tok in t_all if not _pos_in_comment(pos, t_cs, t_ce)]
        t_cm = [(pos, tok) for pos, tok in t_all if _pos_in_comment(pos, t_cs, t_ce)]
        s_nc = [(pos, tok) for pos, tok in s_all if not _pos_in_comment(pos, s_cs, s_ce)]
        s_cm = [(pos, tok) for pos, tok in s_all if _pos_in_comment(pos, s_cs, s_ce)]

        t_seq = [tok for _, tok in t_nc]
        s_seq = [tok for _, tok in s_nc]
        n_total += len(t_seq)

        def _left_key(seq: List[str], i: int) -> tuple:
            return tuple(seq[max(0, i - k):i])

        def _right_key(seq: List[str], i: int) -> tuple:
            return tuple(seq[i + 1:i + k + 1])

        t_by_left: Dict[tuple, List[int]] = {}
        t_by_right: Dict[tuple, List[int]] = {}
        for i in range(len(t_seq)):
            t_by_left.setdefault((t_seq[i], _left_key(t_seq, i)), []).append(i)
            t_by_right.setdefault((t_seq[i], _right_key(t_seq, i)), []).append(i)

        s_by_left: Dict[tuple, List[int]] = {}
        s_by_right: Dict[tuple, List[int]] = {}
        for i in range(len(s_seq)):
            s_by_left.setdefault((s_seq[i], _left_key(s_seq, i)), []).append(i)
            s_by_right.setdefault((s_seq[i], _right_key(s_seq, i)), []).append(i)

        matched_t: set = set()
        matched_s: set = set()

        for key in set(t_by_left) & set(s_by_left):
            t_list = [i for i in t_by_left[key] if i not in matched_t]
            s_list = [i for i in s_by_left[key] if i not in matched_s]
            n = min(len(t_list), len(s_list))
            for idx in range(n):
                matched_t.add(t_list[idx])
                matched_s.add(s_list[idx])

        for key in set(t_by_right) & set(s_by_right):
            t_list = [i for i in t_by_right[key] if i not in matched_t]
            s_list = [i for i in s_by_right[key] if i not in matched_s]
            n = min(len(t_list), len(s_list))
            for idx in range(n):
                matched_t.add(t_list[idx])
                matched_s.add(s_list[idx])

        n_matched += len(matched_t)

        t_marks: List[dict] = []
        for i, (pos, tok) in enumerate(t_nc):
            if i not in matched_t:
                t_marks.append({'token': tok, 'label': 'missing',
                                'start': pos, 'end': pos + len(tok)})
        for pos, tok in t_cm:
            t_marks.append({'token': tok, 'label': 'comment',
                            'start': pos, 'end': pos + len(tok)})

        s_marks: List[dict] = []
        for i, (pos, tok) in enumerate(s_nc):
            if i not in matched_s:
                s_marks.append({'token': tok, 'label': 'extra',
                                'start': pos, 'end': pos + len(tok)})
        for pos, tok in s_cm:
            s_marks.append({'token': tok, 'label': 'comment',
                            'start': pos, 'end': pos + len(tok)})

        fname = Path(t_name).name
        s_fname = s_path.name if s_path else fname
        if t_marks:
            teacher_result[fname] = sorted(t_marks, key=lambda x: x['start'])
        if s_marks:
            student_result[s_fname] = sorted(s_marks, key=lambda x: x['start'])

    score = round(n_matched / n_total * 100, 1) if n_total else None
    return teacher_result, student_result, score


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


def _build_ro_diff_marks(
    teacher_files: Dict[str, Path],
    student_files: Dict[str, Path],
) -> Tuple[Dict[str, List[dict]], Dict[str, List[dict]], Optional[float], Dict[str, list], dict]:
    teacher_result:    Dict[str, List[dict]] = {}
    student_result:    Dict[str, List[dict]] = {}
    alignments:        Dict[str, list]        = {}
    t_line_by_file:    Dict[str, List[dict]] = {}
    s_line_by_file:    Dict[str, List[dict]] = {}
    n_total_lines  = 0
    n_missing_lines = 0

    _tok_re = _sm._CHAR_TOKEN_RE

    for t_name, t_path, s_path in _match_files_by_name_then_ext(teacher_files, student_files):
        try:
            t_text = t_path.read_text(encoding='utf-8', errors='ignore').replace('\r\n', '\n')
        except Exception:
            continue

        s_text = ''
        if s_path:
            try:
                s_text = s_path.read_text(encoding='utf-8', errors='ignore').replace('\r\n', '\n')
            except Exception:
                pass

        t_lines_raw = t_text.splitlines()
        s_lines_raw = s_text.splitlines() if s_text else []
        n_total_lines += sum(1 for l in t_lines_raw if l.strip())

        t_norm   = [l.strip() for l in t_lines_raw]
        s_norm   = [l.strip() for l in s_lines_raw]
        t_starts = _line_start_offsets(t_text)
        s_starts = _line_start_offsets(s_text) if s_text else []

        sm          = difflib.SequenceMatcher(None, t_norm, s_norm, autojunk=False)
        t_marks:    List[dict] = []
        s_marks:    List[dict] = []
        t_line_ms:  List[dict] = []
        s_line_ms:  List[dict] = []
        alignment:  list       = []

        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            if tag == 'equal':
                for k in range(i2 - i1):
                    alignment.append([i1 + k, j1 + k])

            elif tag == 'delete':
                for i in range(i1, i2):
                    alignment.append([i, None])
                    if t_lines_raw[i].strip():
                        n_missing_lines += 1
                        lm = _make_line_mark(t_lines_raw, t_starts, i, 'missing')
                        if lm:
                            t_line_ms.append(lm)

            elif tag == 'insert':
                for j in range(j1, j2):
                    alignment.append([None, j])
                    lm = _make_line_mark(s_lines_raw, s_starts, j, 'extra')
                    if lm:
                        s_line_ms.append(lm)

            elif tag == 'replace':
                n_t, n_s   = i2 - i1, j2 - j1
                n_paired   = min(n_t, n_s)

                for k in range(n_paired):
                    t_i, s_j = i1 + k, j1 + k
                    alignment.append([t_i, s_j])
                    if t_lines_raw[t_i].strip():
                        n_missing_lines += 1
                    t_off = t_starts[t_i]
                    s_off = s_starts[s_j]
                    t_tok_ms = list(_tok_re.finditer(t_lines_raw[t_i]))
                    s_tok_ms = list(_tok_re.finditer(s_lines_raw[s_j]))
                    tok_sm   = difflib.SequenceMatcher(
                        None, [m.group() for m in t_tok_ms],
                        [m.group() for m in s_tok_ms], autojunk=False)
                    for ttag, ti1, ti2, tj1, tj2 in tok_sm.get_opcodes():
                        if ttag == 'equal':
                            continue
                        if ttag in ('delete', 'replace'):
                            for ti in range(ti1, ti2):
                                m = t_tok_ms[ti]
                                t_marks.append({'token': m.group(), 'label': 'missing',
                                                'start': t_off + m.start(),
                                                'end':   t_off + m.end()})
                        if ttag in ('insert', 'replace'):
                            for tj in range(tj1, tj2):
                                m = s_tok_ms[tj]
                                s_marks.append({'token': m.group(), 'label': 'extra',
                                                'start': s_off + m.start(),
                                                'end':   s_off + m.end()})

                for k in range(n_paired, n_t):
                    t_i = i1 + k
                    alignment.append([t_i, None])
                    if t_lines_raw[t_i].strip():
                        n_missing_lines += 1
                        lm = _make_line_mark(t_lines_raw, t_starts, t_i, 'missing')
                        if lm:
                            t_line_ms.append(lm)

                for k in range(n_paired, n_s):
                    s_j = j1 + k
                    alignment.append([None, s_j])
                    lm = _make_line_mark(s_lines_raw, s_starts, s_j, 'extra')
                    if lm:
                        s_line_ms.append(lm)

        fname  = Path(t_name).name
        s_fname = s_path.name if s_path else fname
        if t_marks:
            teacher_result[fname] = t_marks
        if s_marks:
            student_result[s_fname] = s_marks
        if t_line_ms:
            t_line_by_file[fname] = t_line_ms
        if s_line_ms:
            s_line_by_file[s_fname] = s_line_ms
        alignments[fname] = alignment
        if s_fname != fname:
            alignments[s_fname] = alignment

    score = round((n_total_lines - n_missing_lines) / n_total_lines * 100, 1) if n_total_lines else None
    line_marks = {}
    if t_line_by_file:
        line_marks['teacher_files'] = t_line_by_file
    if s_line_by_file:
        line_marks['student_files'] = s_line_by_file
    return teacher_result, student_result, score, alignments, line_marks


_build_myers_diff_marks = _build_ro_diff_marks


import subprocess as _subprocess

_VSCODE_DIFF_SCRIPT = Path(__file__).resolve().parent.parent / 'vscode_diff.js'


def _build_vscode_diff_marks(
    teacher_files: Dict[str, Path],
    student_files: Dict[str, Path],
) -> Tuple[Dict[str, List[dict]], Dict[str, List[dict]], Optional[float], Dict[str, list], dict]:
    input_data = {
        'teacherFiles': {
            name: path.read_text(encoding='utf-8', errors='ignore')
            for name, path in teacher_files.items()
        },
        'studentFiles': {
            name: path.read_text(encoding='utf-8', errors='ignore')
            for name, path in student_files.items()
        },
    }
    result = _subprocess.run(
        ['node', str(_VSCODE_DIFF_SCRIPT)],
        input=json.dumps(input_data),
        capture_output=True,
        text=True,
        encoding='utf-8',
    )
    if result.returncode != 0:
        raise RuntimeError(f'vscode_diff.js failed: {result.stderr.strip()}')
    output = json.loads(result.stdout)
    return (
        output.get('teacher_files', {}),
        output.get('student_files', {}),
        output.get('score'),
        output.get('alignments', {}),
        output.get('line_marks', {}),
    )


import re as _re

_GIT_HUNK_RE = _re.compile(r'^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@')


def _build_git_diff_marks(
    teacher_files: Dict[str, Path],
    student_files: Dict[str, Path],
) -> Tuple[Dict[str, List[dict]], Dict[str, List[dict]], Optional[float], Dict[str, list], dict]:
    teacher_result: Dict[str, List[dict]] = {}
    student_result: Dict[str, List[dict]] = {}
    alignments:     Dict[str, list]        = {}
    t_line_by_file: Dict[str, List[dict]] = {}
    s_line_by_file: Dict[str, List[dict]] = {}
    n_total_lines  = 0
    n_missing_lines = 0

    _tok_re = _sm._CHAR_TOKEN_RE

    def _git_hunks(t_path, s_path):
        result = _subprocess.run(
            ['git', 'diff', '--no-index', '--unified=0', '-w',
             str(t_path), str(s_path)],
            capture_output=True, text=True, encoding='utf-8',
        )
        hunks = []
        for line in result.stdout.splitlines():
            m = _GIT_HUNK_RE.match(line)
            if m:
                i1 = int(m.group(1))
                ic = int(m.group(2)) if m.group(2) is not None else 1
                j1 = int(m.group(3))
                jc = int(m.group(4)) if m.group(4) is not None else 1
                hunks.append((i1, ic, j1, jc))
        return hunks

    for t_name, t_path, s_path in _match_files_by_name_then_ext(teacher_files, student_files):
        try:
            t_text = t_path.read_text(encoding='utf-8', errors='ignore').replace('\r\n', '\n')
        except Exception:
            continue

        s_text = ''
        if s_path:
            try:
                s_text = s_path.read_text(encoding='utf-8', errors='ignore').replace('\r\n', '\n')
            except Exception:
                pass

        t_lines_raw = t_text.splitlines()
        s_lines_raw = s_text.splitlines() if s_text else []
        n_total_lines += sum(1 for l in t_lines_raw if l.strip())

        t_starts = _line_start_offsets(t_text)
        s_starts = _line_start_offsets(s_text) if s_text else []

        t_marks:   List[dict] = []
        s_marks:   List[dict] = []
        t_line_ms: List[dict] = []
        s_line_ms: List[dict] = []
        alignment: list       = []

        hunks = _git_hunks(t_path, s_path) if s_path else []

        t_cursor = 0
        s_cursor = 0

        for i1_raw, ic, j1_raw, jc in hunks:
            t_end = (i1_raw - 1) if ic > 0 else i1_raw
            s_end = (j1_raw - 1) if jc > 0 else j1_raw
            eq_count = t_end - t_cursor
            for k in range(eq_count):
                alignment.append([t_cursor + k, s_cursor + k])
            t_cursor += eq_count
            s_cursor += eq_count

            t_hunk_start = t_end
            s_hunk_start = s_end
            n_t = ic
            n_s = jc
            n_paired = min(n_t, n_s)

            if n_t > 0 and n_s > 0:
                for k in range(n_paired):
                    t_i = t_hunk_start + k
                    s_j = s_hunk_start + k
                    alignment.append([t_i, s_j])
                    if t_i < len(t_lines_raw) and t_lines_raw[t_i].strip():
                        n_missing_lines += 1
                    if t_i < len(t_lines_raw) and s_j < len(s_lines_raw):
                        t_off = t_starts[t_i] if t_i < len(t_starts) else 0
                        s_off = s_starts[s_j] if s_j < len(s_starts) else 0
                        t_tok_ms = list(_tok_re.finditer(t_lines_raw[t_i]))
                        s_tok_ms = list(_tok_re.finditer(s_lines_raw[s_j]))
                        tok_sm = difflib.SequenceMatcher(
                            None, [m.group() for m in t_tok_ms],
                            [m.group() for m in s_tok_ms], autojunk=False)
                        for ttag, ti1, ti2, tj1, tj2 in tok_sm.get_opcodes():
                            if ttag == 'equal':
                                continue
                            if ttag in ('delete', 'replace'):
                                for ti in range(ti1, ti2):
                                    m = t_tok_ms[ti]
                                    t_marks.append({'token': m.group(), 'label': 'missing',
                                                    'start': t_off + m.start(),
                                                    'end':   t_off + m.end()})
                            if ttag in ('insert', 'replace'):
                                for tj in range(tj1, tj2):
                                    m = s_tok_ms[tj]
                                    s_marks.append({'token': m.group(), 'label': 'extra',
                                                    'start': s_off + m.start(),
                                                    'end':   s_off + m.end()})

                for k in range(n_paired, n_t):
                    t_i = t_hunk_start + k
                    alignment.append([t_i, None])
                    if t_i < len(t_lines_raw) and t_lines_raw[t_i].strip():
                        n_missing_lines += 1
                        lm = _make_line_mark(t_lines_raw, t_starts, t_i, 'missing')
                        if lm:
                            t_line_ms.append(lm)

                for k in range(n_paired, n_s):
                    s_j = s_hunk_start + k
                    alignment.append([None, s_j])
                    if s_j < len(s_lines_raw):
                        lm = _make_line_mark(s_lines_raw, s_starts, s_j, 'extra')
                        if lm:
                            s_line_ms.append(lm)

            elif n_t > 0:
                for k in range(n_t):
                    t_i = t_hunk_start + k
                    alignment.append([t_i, None])
                    if t_i < len(t_lines_raw) and t_lines_raw[t_i].strip():
                        n_missing_lines += 1
                        lm = _make_line_mark(t_lines_raw, t_starts, t_i, 'missing')
                        if lm:
                            t_line_ms.append(lm)
            else:
                for k in range(n_s):
                    s_j = s_hunk_start + k
                    alignment.append([None, s_j])
                    if s_j < len(s_lines_raw):
                        lm = _make_line_mark(s_lines_raw, s_starts, s_j, 'extra')
                        if lm:
                            s_line_ms.append(lm)

            t_cursor = t_hunk_start + n_t
            s_cursor = s_hunk_start + n_s

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
        if t_marks:
            teacher_result[fname] = t_marks
        if s_marks:
            student_result[s_fname] = s_marks
        if t_line_ms:
            t_line_by_file[fname] = t_line_ms
        if s_line_ms:
            s_line_by_file[s_fname] = s_line_ms
        alignments[fname] = alignment
        if s_fname != fname:
            alignments[s_fname] = alignment

    score = round((n_total_lines - n_missing_lines) / n_total_lines * 100, 1) if n_total_lines else None
    line_marks = {}
    if t_line_by_file:
        line_marks['teacher_files'] = t_line_by_file
    if s_line_by_file:
        line_marks['student_files'] = s_line_by_file
    return teacher_result, student_result, score, alignments, line_marks




def _apply_diff_to_occurrences(
    all_occ: list,
    diff_marks: dict,
    removal_ts_by_token: dict = None,
) -> Tuple[list, float]:
    new_missing: List[Tuple[str, str]] = []
    for marks in diff_marks.get('teacher_files', {}).values():
        for m in marks:
            if m.get('label') == 'missing' and 'timestamp' in m:
                new_missing.append((m['token'], m['timestamp']))

    extra_star_counts: Counter = Counter()
    for marks in diff_marks.get('student_files', {}).values():
        for m in marks:
            if m.get('label') == 'extra_star':
                extra_star_counts[m['token']] += 1

    if new_missing:
        all_occ = [(ts, tok, fl) for ts, tok, fl in all_occ if fl != {'MISSING'}]
        for tok, ts in new_missing:
            all_occ.append((ts, tok, {'MISSING'}))

    if extra_star_counts:
        extra_avail: Counter = Counter(tok for _, tok, fl in all_occ if fl == {'EXTRA'})
        extra_star_existing: Counter = Counter(tok for _, tok, fl in all_occ if fl == {'EXTRA*'})
        found_count: Counter = Counter(tok for _, tok, fl in all_occ if not fl)

        steal_from_found: Counter = Counter()
        for tok, needed in extra_star_counts.items():
            deficit = max(0, needed - (extra_avail[tok] + extra_star_existing[tok]))
            if deficit > 0:
                steal_from_found[tok] = min(deficit, found_count.get(tok, 0))

        extra_star_used: Counter = Counter()
        found_stolen: Counter = Counter()
        new_occ: list = []
        appended_star: list = []
        for ts, tok, fl in all_occ:
            if fl == {'EXTRA'} and extra_star_used[tok] < extra_star_counts.get(tok, 0):
                extra_star_used[tok] += 1
                new_ts = removal_ts_by_token.get(tok, ts) if removal_ts_by_token else ts
                new_occ.append((new_ts, tok, {'EXTRA*'}))
            elif not fl and found_stolen[tok] < steal_from_found.get(tok, 0):
                found_stolen[tok] += 1
                new_occ.append((ts, tok, {'MISSING'}))
                star_ts = removal_ts_by_token.get(tok, ts) if removal_ts_by_token else ts
                appended_star.append((star_ts, tok, {'EXTRA*'}))
            else:
                new_occ.append((ts, tok, fl))
        all_occ = new_occ + appended_star

    def _sort_key(entry: tuple) -> tuple:
        ts, _, fl = entry
        is_tail = ts == '00:00:00' and 'EXTRA' in fl and 'EXTRA*' not in fl
        try:
            h, m, s = ts.split(':')
            return (is_tail, int(h), int(m), int(s))
        except Exception:
            return (is_tail, 99, 99, 99)

    all_occ.sort(key=_sort_key)

    n_found_e = sum(1 for _, _, fl in all_occ if not fl)
    n_missing_e = sum(1 for _, _, fl in all_occ if fl == {'MISSING'})
    teacher_total_e = n_found_e + n_missing_e
    n_extra_star = sum(extra_star_counts.values())
    score = (round(max(0.0, (n_found_e - n_extra_star) / teacher_total_e * 100), 1)
             if teacher_total_e else 0.0)
    return all_occ, score


def _update_tokens_txt_extra_star(
    tokens_path: Path,
    diff_marks: dict,
    removal_ts_by_token: dict = None,
) -> Tuple[float, Counter, Counter]:
    if not tokens_path.exists():
        return 0.0, Counter(), Counter()

    extra_star_counts: Counter = Counter()
    for marks in diff_marks.get('student_files', {}).values():
        for m in marks:
            if m.get('label') == 'extra_star':
                extra_star_counts[m['token']] += 1

    lines = tokens_path.read_text(encoding='utf-8').splitlines()

    extra_avail: Counter = Counter()
    extra_star_existing: Counter = Counter()
    found_count: Counter = Counter()
    n_found_e_orig = 0
    n_missing_e_orig = 0
    for line in lines:
        if line.startswith('#') or not line.strip():
            continue
        parts = line.split('\t')
        flags = set(parts[2:]) if len(parts) > 2 else set()
        if flags == {'EXTRA'}:
            extra_avail[parts[0]] += 1
        elif flags == {'EXTRA*'}:
            extra_star_existing[parts[0]] += 1
        elif not flags:
            found_count[parts[0]] += 1
            n_found_e_orig += 1
        elif flags == {'MISSING'}:
            n_missing_e_orig += 1

    steal_from_found: Counter = Counter()
    for tok, needed in extra_star_counts.items():
        deficit = max(0, needed - (extra_avail[tok] + extra_star_existing[tok]))
        if deficit > 0:
            steal_from_found[tok] = min(deficit, found_count.get(tok, 0))

    total_stolen = sum(steal_from_found.values())
    n_found_e = n_found_e_orig - total_stolen
    n_missing_e = n_missing_e_orig + total_stolen
    teacher_total_e = n_found_e + n_missing_e
    n_extra_star = sum(extra_star_counts.values())
    corrected_score = (round(max(0.0, (n_found_e - n_extra_star) / teacher_total_e * 100), 1)
                       if teacher_total_e else 0.0)

    def _parse_ts_key(ts_str: str):
        try:
            h, m, s = ts_str.split(':')
            return int(h), int(m), int(s)
        except Exception:
            return (99, 99, 99)

    extra_star_used: Counter = Counter()
    found_stolen: Counter = Counter()
    new_extra_star_appended: list = []
    new_lines = []
    for line in lines:
        if line.startswith('# Follow (E)'):
            new_lines.append(f'# Follow (E)       : {corrected_score} %')
            continue
        if line.startswith('#') or not line.strip():
            new_lines.append(line)
            continue
        parts = line.split('\t')
        tok = parts[0]
        flags = set(parts[2:]) if len(parts) > 2 else set()
        if flags == {'EXTRA*'}:
            new_lines.append(line)
        elif flags == {'EXTRA'} and extra_star_used[tok] < extra_star_counts.get(tok, 0):
            extra_star_used[tok] += 1
            ts = (removal_ts_by_token.get(tok, parts[1])
                  if removal_ts_by_token else parts[1])
            new_lines.append(tok + '\t' + ts + '\tEXTRA*')
        elif not flags and found_stolen[tok] < steal_from_found.get(tok, 0):
            found_stolen[tok] += 1
            new_lines.append(tok + '\t' + parts[1] + '\tMISSING')
            ts_star = (removal_ts_by_token.get(tok, parts[1])
                       if removal_ts_by_token else parts[1])
            new_extra_star_appended.append(tok + '\t' + ts_star + '\tEXTRA*')
        else:
            new_lines.append(line)

    new_lines.extend(new_extra_star_appended)

    headers = [ln for ln in new_lines if ln.startswith('#')]
    body = [ln for ln in new_lines if ln and not ln.startswith('#')]

    regular_rows = []
    tail_extras = []
    for idx, line in enumerate(body):
        parts = line.split('\t')
        ts = parts[1] if len(parts) > 1 else '99:99:99'
        flags = set(parts[2:]) if len(parts) > 2 else set()
        if ts == '00:00:00' and 'EXTRA' in flags and 'EXTRA*' not in flags:
            tail_extras.append((idx, line))
        else:
            regular_rows.append((_parse_ts_key(ts), idx, line))

    regular_rows.sort(key=lambda x: (x[0], x[1]))
    ordered_body = [line for _, _, line in regular_rows] + [line for _, line in tail_extras]
    tokens_path.write_text('\n'.join(headers + ordered_body) + '\n', encoding='utf-8')
    return corrected_score, extra_star_counts, steal_from_found


def _update_tokens_txt_missing(tokens_path: Path, diff_marks: dict) -> None:
    new_missing: List[Tuple[str, str]] = []
    for marks in diff_marks.get('teacher_files', {}).values():
        for m in marks:
            if m.get('label') == 'missing' and 'timestamp' in m:
                new_missing.append((m['token'], m['timestamp']))
    if not new_missing:
        return

    lines = tokens_path.read_text(encoding='utf-8').splitlines()
    headers = [l for l in lines if l.startswith('#')]
    body    = [l for l in lines if l and not l.startswith('#')]

    non_missing = []
    for line in body:
        parts = line.split('\t')
        flags = set(parts[2:]) if len(parts) > 2 else set()
        if flags == {'MISSING'}:
            continue
        non_missing.append(line)

    for tok, ts in new_missing:
        non_missing.append(f'{tok}\t{ts}\tMISSING')

    def _sort_key(line: str) -> tuple:
        parts = line.split('\t')
        ts    = parts[1] if len(parts) > 1 else '99:99:99'
        flags = set(parts[2:]) if len(parts) > 2 else set()
        is_tail = ts == '00:00:00' and 'EXTRA' in flags and 'EXTRA*' not in flags
        try:
            h, m, s = ts.split(':')
            key = (int(h), int(m), int(s))
        except Exception:
            key = (99, 99, 99)
        return (is_tail, key)

    non_missing.sort(key=_sort_key)
    tokens_path.write_text('\n'.join(headers + non_missing) + '\n', encoding='utf-8')


