import difflib
import functools
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
_GHOST_STAR_MUTUAL = os.environ.get('STUDENT_ANALYTICS_GHOST_MUTUAL', '0') == '1'


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


def _collect_occurrences(files_by_ext: dict, token_keys: set) -> Tuple[List[dict], Dict[str, Dict[str, int]]]:
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

        for tok in token_keys:
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


def _build_leo_diff_marks(
    teacher_files: dict,
    student_files: dict,
    teacher_entries: list,
    student_outside: Counter,
    student_comment: Counter,
    context_k: int = _CONTEXT_K,
) -> Tuple[dict, dict]:
    token_keys = set()
    for entry in teacher_entries:
        token_keys.add(entry[0])
    token_keys.update(student_outside.keys())
    token_keys.update(student_comment.keys())

    teacher_occs, teacher_counts = _collect_occurrences(teacher_files, token_keys)
    student_occs, student_counts = _collect_occurrences(student_files, token_keys)

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


_build_contextual_diff_marks = _build_leo_diff_marks


def _apply_ghost_star_to_colors(
    student_colors: dict,
    student_files: Dict[str, Path],
    ghost_contexts: Dict[str, List[Counter]],
    k: int = _GHOST_K,
) -> None:
    """Promote 'extra' → 'extra_star' in the colors-map format. Modifies in-place.

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
    """Promote 'extra' → 'extra_star' in diff_marks['student_files']. Modifies in-place.

    Works on position-mark format produced by both _build_leo_diff_marks
    (via _colors_to_position_marks) and _build_lcs_diff_marks. The same call
    therefore applies ghost-star post-processing to either algorithm's output.
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
                tok = mark.get('token') or raw[mark['start']:mark['end']]
                extra_by_pos[(mark['start'], tok)] = mark_idx

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


def _build_lcs_diff_marks(
    teacher_files: Dict[str, Path],
    student_files: Dict[str, Path],
) -> Tuple[Dict[str, List[dict]], Dict[str, List[dict]], int, int]:
    """LCS token diff without ghost-star post-processing.

    Returns (teacher_result, student_result, n_total_nc, n_missing_nc).
    All unmatched student tokens carry label 'extra'. Call
    _apply_ghost_star_to_diff_marks afterwards to produce the LCS* variant.
    """
    teacher_result: Dict[str, List[dict]] = {}
    student_result: Dict[str, List[dict]] = {}
    n_total_nc = 0
    n_missing_nc = 0

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

        t_all = _tokenize_file_ordered(t_text)
        s_all = _tokenize_file_ordered(s_text) if s_text else []

        t_cs, t_ce = _comment_ranges_for_ext(t_text)
        s_cs, s_ce = _comment_ranges_for_ext(s_text) if s_text else ([], [])

        t_nc = [(pos, tok) for pos, tok in t_all if not _pos_in_comment(pos, t_cs, t_ce)]
        t_cm = [(pos, tok) for pos, tok in t_all if _pos_in_comment(pos, t_cs, t_ce)]
        s_nc = [(pos, tok) for pos, tok in s_all if not _pos_in_comment(pos, s_cs, s_ce)]
        s_cm = [(pos, tok) for pos, tok in s_all if _pos_in_comment(pos, s_cs, s_ce)]

        t_seq = [tok for _, tok in t_nc]
        s_seq = [tok for _, tok in s_nc]
        n_total_nc += len(t_seq)

        t_marks: List[dict] = []
        s_marks: List[dict] = []

        for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, t_seq, s_seq, autojunk=False).get_opcodes():
            if tag == 'equal':
                continue
            if tag in ('delete', 'replace'):
                n_missing_nc += i2 - i1
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

    return teacher_result, student_result, n_total_nc, n_missing_nc


def _lcs_star_score(n_total: int, n_missing: int, student_result: dict) -> Optional[float]:
    n_star = sum(1 for marks in student_result.values()
                 for m in marks if m.get('label') == 'extra_star')
    return round(max(0.0, (n_total - n_missing - n_star) / n_total * 100), 1) if n_total else None


def _build_lcs_star_diff_marks(
    teacher_files: Dict[str, Path],
    student_files: Dict[str, Path],
    removal_counts: Counter = None,
    ghost_contexts: Dict[str, List[Counter]] = None,
) -> Tuple[Dict[str, List[dict]], Dict[str, List[dict]], Optional[float]]:
    """LCS* = LCS + ghost-star post-processing (backward-compat wrapper)."""
    t, s, n_total, n_missing = _build_lcs_diff_marks(teacher_files, student_files)
    dm = {'teacher_files': t, 'student_files': s}
    if ghost_contexts:
        _apply_ghost_star_to_diff_marks(dm, student_files, ghost_contexts, _GHOST_K)
    elif removal_counts:
        used: Counter = Counter()
        for marks in dm['student_files'].values():
            for mark in marks:
                if mark.get('label') == 'extra':
                    tok = mark['token']
                    if used[tok] < removal_counts.get(tok, 0):
                        mark['label'] = 'extra_star'
                        used[tok] += 1
    return dm['teacher_files'], dm['student_files'], _lcs_star_score(n_total, n_missing, dm['student_files'])


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


def _build_ro_diff_marks(
    teacher_files: Dict[str, Path],
    student_files: Dict[str, Path],
) -> Tuple[Dict[str, List[dict]], Dict[str, List[dict]], Optional[float], Dict[str, list]]:
    teacher_result: Dict[str, List[dict]] = {}
    student_result: Dict[str, List[dict]] = {}
    alignments:     Dict[str, list]        = {}
    n_total_lines  = 0
    n_missing_lines = 0

    _tok_re = _sm._CHAR_TOKEN_RE

    def _line_mark(lines_raw, starts, idx, label, marks_list):
        line_raw = lines_raw[idx]
        if not line_raw.strip():
            return
        raw_start = starts[idx]
        ls = len(line_raw) - len(line_raw.lstrip())
        le = len(line_raw.rstrip())
        if raw_start + ls < raw_start + le:
            marks_list.append({'label': label, 'start': raw_start + ls,
                                'end': raw_start + le, 'line': True})

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

        sm        = difflib.SequenceMatcher(None, t_norm, s_norm, autojunk=False)
        t_marks:  List[dict] = []
        s_marks:  List[dict] = []
        alignment: list      = []

        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            if tag == 'equal':
                for k in range(i2 - i1):
                    alignment.append([i1 + k, j1 + k])

            elif tag == 'delete':
                for i in range(i1, i2):
                    alignment.append([i, None])
                    if t_lines_raw[i].strip():
                        n_missing_lines += 1
                        _line_mark(t_lines_raw, t_starts, i, 'missing', t_marks)

            elif tag == 'insert':
                for j in range(j1, j2):
                    alignment.append([None, j])
                    _line_mark(s_lines_raw, s_starts, j, 'extra', s_marks)

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
                                t_marks.append({'label': 'missing',
                                                'start': t_off + m.start(),
                                                'end':   t_off + m.end()})
                        if ttag in ('insert', 'replace'):
                            for tj in range(tj1, tj2):
                                m = s_tok_ms[tj]
                                s_marks.append({'label': 'extra',
                                                'start': s_off + m.start(),
                                                'end':   s_off + m.end()})

                for k in range(n_paired, n_t):
                    t_i = i1 + k
                    alignment.append([t_i, None])
                    if t_lines_raw[t_i].strip():
                        n_missing_lines += 1
                        _line_mark(t_lines_raw, t_starts, t_i, 'missing', t_marks)

                for k in range(n_paired, n_s):
                    s_j = j1 + k
                    alignment.append([None, s_j])
                    _line_mark(s_lines_raw, s_starts, s_j, 'extra', s_marks)

        fname  = Path(t_name).name
        s_fname = s_path.name if s_path else fname
        if t_marks:
            teacher_result[fname] = t_marks
        if s_marks:
            student_result[s_fname] = s_marks
        alignments[fname] = alignment
        if s_fname != fname:
            alignments[s_fname] = alignment

    score = round((n_total_lines - n_missing_lines) / n_total_lines * 100, 1) if n_total_lines else None
    return teacher_result, student_result, score, alignments


_build_myers_diff_marks = _build_ro_diff_marks


import subprocess as _subprocess

_VSCODE_DIFF_SCRIPT = Path(__file__).resolve().parent.parent / 'vscode_diff.js'


def _build_vscode_diff_marks(
    teacher_files: Dict[str, Path],
    student_files: Dict[str, Path],
) -> Tuple[Dict[str, List[dict]], Dict[str, List[dict]], Optional[float], Dict[str, list]]:
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
    )


def _build_vscode_star_diff_marks(
    teacher_files: Dict[str, Path],
    student_files: Dict[str, Path],
    ghost_contexts: Optional[dict] = None,
) -> Tuple[Dict[str, List[dict]], Dict[str, List[dict]], Optional[float], Dict[str, list]]:
    t, s, score, alignments = _build_vscode_diff_marks(teacher_files, student_files)
    if ghost_contexts:
        dm = {'teacher_files': t, 'student_files': s}
        _apply_ghost_star_to_diff_marks(dm, student_files, ghost_contexts)
        t, s = dm['teacher_files'], dm['student_files']
    return t, s, score, alignments


def _build_ro_star_diff_marks(
    teacher_files: Dict[str, Path],
    student_files: Dict[str, Path],
    ghost_contexts: Optional[dict] = None,
) -> Tuple[Dict[str, List[dict]], Dict[str, List[dict]], Optional[float], Dict[str, list]]:
    t, s, score, alignments = _build_ro_diff_marks(teacher_files, student_files)
    if ghost_contexts:
        dm = {'teacher_files': t, 'student_files': s}
        _apply_ghost_star_to_diff_marks(dm, student_files, ghost_contexts)
        t, s = dm['teacher_files'], dm['student_files']
    return t, s, score, alignments


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


class TokenLogMixin:
    def write_keyword_log(self) -> None:
        has_css = bool(
            self.teacher_tokens_by_ext.get('.css')
            or self.teacher_tokens_by_ext.get('.html')
        )

        all_events = getattr(self, '_lesson_all_events', None) or (
            self._lesson_keypresses + self._lesson_code_inserts
        )
        kw_ts, kw_ts_comment, removed_kw_ts, upper_to_display, occ_with_display = (
            reconstruct_tokens_from_keylog_full(all_events, has_css=has_css)
        )

        if not kw_ts and not removed_kw_ts:
            print('  Keyword log skipped \u2014 no key-log data.')
            return

        all_occ: List[Tuple[int, int, str, bool, bool]] = []

        for tok, ts_list in kw_ts.items():
            occ_sorted = sorted(occ_with_display.get(tok, []))
            comment_ts_set = set(kw_ts_comment.get(tok, []))
            for ts, disp in occ_sorted:
                all_occ.append((ts, 0, disp, ts in comment_ts_set, False))

        for tok, ts_list in removed_kw_ts.items():
            disp = upper_to_display.get(tok, tok)
            for ins_ts, del_ts in ts_list:
                all_occ.append((ins_ts, del_ts, disp, False, True))

        all_occ.sort(key=lambda x: x[0])

        n_typed   = sum(1 for _, _, _, _, is_removed in all_occ if not is_removed)
        n_removed = sum(1 for _, _, _, _, is_removed in all_occ if is_removed)

        file_timeline   = _build_file_timeline(all_events)
        active_files    = {f for _, f in file_timeline}
        has_multi_files = active_files - {"MAIN"}

        out_path = self.reference_dir / 'tokens.txt'
        with open(out_path, 'w', encoding='utf-8') as fh:
            fh.write(f'# Occurrences: {n_typed}\n')
            fh.write(f'# Removed    : {n_removed}\n')
            fh.write(f'# Unique     : {len(kw_ts)}\n')
            for ins_ts, del_ts, token, is_comment, is_removed in all_occ:
                flags: List[str] = []
                if is_comment:
                    flags.append('COMMENT')
                if is_removed:
                    flags.append('REMOVED')
                file_col    = f'\t{_file_at_ts(ins_ts, file_timeline)}' if has_multi_files else ''
                removal_col = f'\t{ts_to_local(del_ts)}' if is_removed else ''
                suffix      = ('\t' + '\t'.join(flags)) if flags else ''
                fh.write(f'{token}\t{ts_to_local(ins_ts)}{file_col}{suffix}{removal_col}\n')

        print(f'  Written: correct/{out_path.name}  ({n_typed} occurrences, '
              f'{n_removed} removed, {len(kw_ts)} unique)')

        reco_files = get_reconstructed_files(all_events)
        if reco_files:
            reco_dir = self.reference_dir.parent / 'reconstructed'
            reco_dir.mkdir(exist_ok=True)
            for tab_key, reco_text in reco_files.items():
                reco_name = 'reconstructed.html' if tab_key == 'MAIN' else tab_key
                reco_path = reco_dir / reco_name
                with open(reco_path, 'w', encoding='utf-8') as fh:
                    fh.write(reco_text)
                print(f'  Written: reconstructed/{reco_path.name}  ({len(reco_text)} chars)')

    def write_student_token_files(self, names_dir: Path, anon_names_dir: Path = None) -> None:
        teacher_tokens_path = self.reference_dir / 'tokens.txt'
        if not teacher_tokens_path.exists():
            print('  Student token files skipped \u2014 tokens.txt not found.')
            return

        teacher_entries = _parse_teacher_tokens(teacher_tokens_path)
        ts_map: Dict[str, List[str]] = {}
        for _tok, _ts, _is_c, _is_r, *_ in teacher_entries:
            if not _is_r:
                ts_map.setdefault(_tok, []).append(_ts)

        ghost_contexts = None
        all_events = getattr(self, '_lesson_all_events', None)
        file_ordered_ts_map = _build_file_ordered_ts_map(all_events) if all_events else ts_map
        if all_events:
            removed_keys = {tok for tok, _, _, is_rem, *_ in teacher_entries if is_rem}
            if removed_keys:
                ghost_contexts = _build_ghost_contexts(all_events, removed_keys)
                n_with_ctx = sum(1 for k in removed_keys if k in ghost_contexts)
                print(f'  Ghost contexts: {n_with_ctx}/{len(removed_keys)} removed tokens '
                      f'have deletion-batch context')
        self._ghost_contexts = ghost_contexts

        written = 0
        for student_dir in sorted(names_dir.iterdir()):
            if not student_dir.is_dir():
                continue
            sid = self.name_to_id.get(student_dir.name)
            if sid is None or sid not in self.results:
                continue

            anon_dir = student_dir
            if anon_names_dir is not None and anon_names_dir.is_dir():
                candidate = anon_names_dir / student_dir.name
                if candidate.is_dir():
                    anon_dir = candidate

            stu_files = self.get_all_code_files(anon_dir) or self.get_all_code_files(student_dir)
            if not stu_files:
                continue

            student_outside, student_comment = _extract_student_tokens(stu_files)
            all_occ, n_found, n_missing, n_extra, follow_e_pct, consumed = _build_student_token_occurrences(
                teacher_entries, student_outside, student_comment
            )

            n_found_e   = sum(1 for _, _, fl in all_occ if not fl)
            n_missing_e = sum(1 for _, _, fl in all_occ if fl == {'MISSING'})
            teacher_total_e = n_found_e + n_missing_e

            n_found_c   = sum(1 for _, _, fl in all_occ if fl == {'COMMENT'})
            n_missing_c = sum(1 for _, _, fl in all_occ if fl == {'MISSING', 'COMMENT'})
            comment_total = n_found_c + n_missing_c
            follow_c_pct  = (round(n_found_c / comment_total * 100, 1)
                             if comment_total else 0.0)

            extra_ctr         = Counter(tok for _, tok, fl in all_occ if fl == {'EXTRA'})
            extra_star_ctr    = Counter(tok for _, tok, fl in all_occ if fl == {'EXTRA*'})
            extra_comment_ctr = Counter(tok for _, tok, fl in all_occ if fl == {'COMMENT', 'EXTRA'})
            extra_star_comment_ctr = Counter(tok for _, tok, fl in all_occ if fl == {'COMMENT', 'EXTRA*'})

            _miss_e  = sorted((ts, f'-{tok}')  for ts, tok, fl in all_occ if fl == {'MISSING'})
            _miss_c  = sorted((ts, f'-{tok}')  for ts, tok, fl in all_occ if fl == {'MISSING', 'COMMENT'})
            _extra   = sorted((ts, f'+{tok}')  for ts, tok, fl in all_occ if fl == {'EXTRA'})
            _extra_s = sorted((ts, f'+{tok}*') for ts, tok, fl in all_occ if fl == {'EXTRA*'})
            _extra_c = sorted((ts, f'+{tok}')  for ts, tok, fl in all_occ if fl == {'COMMENT', 'EXTRA'})
            _extra_sc= sorted((ts, f'+{tok}*') for ts, tok, fl in all_occ if fl == {'COMMENT', 'EXTRA*'})
            _comb_e  = sorted(_miss_e + _extra + _extra_s)
            _comb_c  = sorted(_miss_c + _extra_c + _extra_sc)

            def _fmt_item(ts_str: str, s: str) -> str:
                return f'{s} ({ts_str})'

            def _fmt_ctr(c: Counter) -> List[str]:
                return [f'{t} (x{n})' if n > 1 else t for t, n in sorted(c.items())]

            self._student_token_stats[sid] = {
                'found':                 n_found,
                'missing':               n_missing,
                'extra':                 n_extra,
                'n_extra_comment':       len(extra_comment_ctr),
                'teacher_total_e':       teacher_total_e,
                'follow_e':              follow_e_pct,
                'follow_c':              follow_c_pct,
                'extra_e_text':          ', '.join(_fmt_item(ts, s) for ts, s in _comb_e),
                'comment_text':          ', '.join(_fmt_item(ts, s) for ts, s in _comb_c),
                'extra_e_items':         [_fmt_item(ts, s) for ts, s in _comb_e],
                'comment_items':         [_fmt_item(ts, s) for ts, s in _comb_c],
                'extra_all':             _fmt_ctr(extra_ctr) + [f'{t}* (x{n})' if n > 1 else f'{t}*' for t, n in sorted(extra_star_ctr.items())],
                'extra_comment_all':     _fmt_ctr(extra_comment_ctr) + [f'{t}* (x{n})' if n > 1 else f'{t}*' for t, n in sorted(extra_star_comment_ctr.items())],
                'extra_counter':         extra_ctr,
                'extra_comment_counter': extra_comment_ctr,
                'extra_star':            sum(extra_star_ctr.values()),
                'extra_star_all':         _fmt_ctr({f'{t}*': n for t, n in (extra_star_ctr + extra_star_comment_ctr).items()}),
                'extra_e_count':         len(_comb_e),
                'comment_count':         len(_comb_c),
            }

            out_path = student_dir / 'tokens.txt'
            with open(out_path, 'w', encoding='utf-8') as fh:
                fh.write(f'# Found            : {n_found}\n')
                fh.write(f'# MISSING          : {n_missing}\n')
                fh.write(f'# EXTRA            : {n_extra}\n')
                fh.write(f'# Follow (E)       : {follow_e_pct} %\n')
                for ts, token, flags in all_occ:
                    flag_str = '\t'.join(sorted(flags))
                    suffix   = f'\t{flag_str}' if flag_str else ''
                    fh.write(f'{token}\t{ts}{suffix}\n')

            teacher_code_files = self.get_all_code_files(self.reference_dir)
            try:
                teacher_files_colors, student_files_colors = _build_leo_diff_marks(
                    teacher_code_files,
                    stu_files,
                    teacher_entries,
                    student_outside,
                    student_comment,
                )
            except Exception:
                miss_budget  = Counter(tok for _, tok, fl in all_occ if fl == {'MISSING'})
                comm_tokens  = Counter(tok for _, tok, fl in all_occ
                                       if 'COMMENT' in fl and 'EXTRA' not in fl and 'EXTRA*' not in fl)
                found_out    = Counter(consumed[False])
                found_comm   = Counter(consumed[True])
                star_budget      = Counter(tok for _, tok, fl in all_occ if fl == {'EXTRA*'})
                extra_budget     = Counter(tok for _, tok, fl in all_occ if fl == {'EXTRA'})
                extra_comm_budget= Counter(tok for _, tok, fl in all_occ
                                           if 'COMMENT' in fl and ('EXTRA' in fl or 'EXTRA*' in fl))

                teacher_files_colors = {}
                for t_name, t_path in teacher_code_files.items():
                    t_ext = Path(t_name).suffix.lower()
                    try:
                        raw = t_path.read_text(encoding='utf-8', errors='ignore')
                        teacher_files_colors[t_path.name] = _build_teacher_file_coloring(
                            raw, t_ext, miss_budget, comm_tokens
                        )
                    except Exception:
                        pass

                student_files_colors = {}
                for s_name, s_path in stu_files.items():
                    s_ext = Path(s_name).suffix.lower()
                    try:
                        raw = s_path.read_text(encoding='utf-8', errors='ignore')
                        student_files_colors[s_path.name] = _build_student_file_coloring(
                            raw, s_ext, found_out, found_comm,
                            star_budget, extra_budget, extra_comm_budget
                        )
                    except Exception:
                        pass

            diff_marks = {
                'format_version': 4,
                'token_matching': 'leo',
                'case_sensitive': True,
                'score': follow_e_pct,
                'teacher_files': _colors_to_position_marks(teacher_code_files, teacher_files_colors, ts_map=file_ordered_ts_map),
                'student_files': _colors_to_position_marks(stu_files, student_files_colors),
            }
            _apply_ghost_star_to_diff_marks(diff_marks, stu_files, ghost_contexts)
            _update_tokens_txt_missing(out_path, diff_marks)
            corrected_miss_e = sorted(
                (m['timestamp'], f"-{m['token']}")
                for marks in diff_marks.get('teacher_files', {}).values()
                for m in marks
                if m.get('label') == 'missing' and 'timestamp' in m
            )
            if corrected_miss_e:
                _miss_e = corrected_miss_e
                _comb_e_corr = sorted(_miss_e + _extra + _extra_s)
                self._student_token_stats[sid]['extra_e_text']  = ', '.join(_fmt_item(ts, s) for ts, s in _comb_e_corr)
                self._student_token_stats[sid]['extra_e_items'] = [_fmt_item(ts, s) for ts, s in _comb_e_corr]
                self._student_token_stats[sid]['extra_e_count'] = len(_comb_e_corr)
            removal_ts_by_token = {
                tok: removal_ts
                for tok, _, _, is_rem, removal_ts in teacher_entries
                if is_rem and removal_ts
            }
            if removal_ts_by_token:
                corrected_score, extra_star_counts, steal_from_found = _update_tokens_txt_extra_star(
                    out_path, diff_marks, removal_ts_by_token
                )
            else:
                corrected_score = follow_e_pct
                extra_star_counts = Counter()
                steal_from_found = Counter()
            diff_marks['score'] = corrected_score
            self._student_token_stats[sid]['follow_e'] = corrected_score

            if anon_dir != student_dir:
                shutil.copy2(out_path, anon_dir / 'tokens.txt')

            if extra_star_counts or steal_from_found:
                stats = self._student_token_stats[sid]

                stolen_miss_items: list = []
                stolen_star_items: list = []
                if steal_from_found:
                    found_occ_by_tok: dict = {}
                    for ts_o, tok_o, fl_o in all_occ:
                        if not fl_o:
                            found_occ_by_tok.setdefault(tok_o, []).append(ts_o)
                    for tok_s, n_steal in steal_from_found.items():
                        found_ts_list = found_occ_by_tok.get(tok_s, [])
                        for i in range(n_steal):
                            ts_found = found_ts_list[i] if i < len(found_ts_list) else '00:00:00'
                            stolen_miss_items.append((ts_found, f'-{tok_s}'))
                            ts_removal = removal_ts_by_token.get(tok_s, ts_found)
                            stolen_star_items.append((ts_removal, f'+{tok_s}*'))

                used = Counter()
                new_comb_e = []
                for ts, s in sorted(_miss_e + stolen_miss_items + _extra):
                    if s.startswith('+'):
                        tok_name = s[1:]
                        if used[tok_name] < extra_star_counts.get(tok_name, 0):
                            used[tok_name] += 1
                            new_ts = removal_ts_by_token.get(tok_name, ts)
                            new_comb_e.append((new_ts, f'+{tok_name}*'))
                        else:
                            new_comb_e.append((ts, s))
                    else:
                        new_comb_e.append((ts, s))

                new_comb_e.extend(stolen_star_items)
                new_comb_e.sort(key=lambda x: x[0])

                def _fmt_item_local(ts_str: str, s: str) -> str:
                    return f'{s} ({ts_str})'

                stats['extra_e_text']  = ', '.join(_fmt_item_local(ts, s) for ts, s in new_comb_e)
                stats['extra_e_items'] = [_fmt_item_local(ts, s) for ts, s in new_comb_e]
                stats['extra_e_count'] = len(new_comb_e)

                remaining_extra = Counter(extra_ctr)
                new_extra_star_ctr: Counter = Counter()
                for tok_name, n in extra_star_counts.items():
                    promoted = min(n, remaining_extra[tok_name])
                    remaining_extra[tok_name] -= promoted
                    if remaining_extra[tok_name] <= 0:
                        del remaining_extra[tok_name]
                    if promoted:
                        new_extra_star_ctr[tok_name] += promoted
                for tok_name, n in steal_from_found.items():
                    new_extra_star_ctr[tok_name] += n

                stats['extra_all'] = _fmt_ctr(remaining_extra) + [
                    f'{t}* (x{n})' if n > 1 else f'{t}*'
                    for t, n in sorted(new_extra_star_ctr.items())
                ]
                stats['extra_star']     = sum(new_extra_star_ctr.values())
                stats['extra_star_all'] = [
                    f'{t}* (x{n})' if n > 1 else f'{t}*'
                    for t, n in sorted(new_extra_star_ctr.items())
                ]

            diff_path = anon_dir / 'diff_marks.json'
            with open(diff_path, 'w', encoding='utf-8') as fh:
                json.dump(diff_marks, fh, ensure_ascii=False, indent=2)

            try:
                tf_colors_no_star, sf_colors_no_star = _build_leo_diff_marks(
                    teacher_code_files,
                    stu_files,
                    teacher_entries,
                    student_outside,
                    student_comment,
                )
            except Exception:
                tf_colors_no_star, sf_colors_no_star = {}, {}
            leo_marks = {
                'format_version': 4,
                'token_matching': 'leo',
                'case_sensitive': True,
                'score': follow_e_pct,
                'teacher_files': _colors_to_position_marks(teacher_code_files, tf_colors_no_star, ts_map=file_ordered_ts_map),
                'student_files': _colors_to_position_marks(stu_files, sf_colors_no_star),
            }
            leo_path = anon_dir / 'diff_marks_leo.json'
            with open(leo_path, 'w', encoding='utf-8') as fh:
                json.dump(leo_marks, fh, ensure_ascii=False, indent=2)

            written += 1

        print(f'  Written token files for {written} student(s) in {names_dir.name}/')

    def write_similarity_diff_marks(self, names_dir: Path, anon_names_dir: Path = None) -> None:
        teacher_code_files = self.get_all_code_files(self.reference_dir)
        if not teacher_code_files:
            print('  Similarity diff marks skipped — no teacher code files found.')
            return

        written = 0
        for student_dir in sorted(names_dir.iterdir()):
            if not student_dir.is_dir():
                continue
            sid = self.name_to_id.get(student_dir.name)
            if sid is None or sid not in self.results:
                continue

            anon_dir = student_dir
            if anon_names_dir is not None and anon_names_dir.is_dir():
                candidate = anon_names_dir / student_dir.name
                if candidate.is_dir():
                    anon_dir = candidate

            stu_files = self.get_all_code_files(anon_dir) or self.get_all_code_files(student_dir)
            if not stu_files:
                continue

            data = self.results.get(sid, {})
            if not data or not data.get('files_compared'):
                continue

            teacher_agg: Counter = Counter()
            for ext in ['.html', '.css', '.js']:
                teacher_agg += self.teacher_outside_by_ext.get(ext, Counter())
            student_agg, _ = _extract_student_tokens(stu_files)

            miss_budget: Dict[str, int] = {
                tok: teacher_agg[tok] - student_agg.get(tok, 0)
                for tok in teacher_agg
                if teacher_agg[tok] > student_agg.get(tok, 0)
            }
            found_out: Dict[str, int] = dict(teacher_agg & student_agg)
            extra_budget: Dict[str, int] = dict(student_agg - teacher_agg)

            teacher_colors: Dict[str, dict] = {}
            for t_name, t_path in teacher_code_files.items():
                t_ext = Path(t_name).suffix.lower()
                try:
                    raw = t_path.read_text(encoding='utf-8', errors='ignore')
                    _, file_comm = _extract_student_tokens({t_name: t_path})
                    result = _build_teacher_file_coloring(raw, t_ext, miss_budget, dict(file_comm))
                    if result:
                        teacher_colors[t_path.name] = result
                except Exception:
                    pass

            student_colors: Dict[str, dict] = {}
            for s_name, s_path in stu_files.items():
                s_ext = Path(s_name).suffix.lower()
                try:
                    raw = s_path.read_text(encoding='utf-8', errors='ignore')
                    _, file_comm = _extract_student_tokens({s_name: s_path})
                    result = _build_student_file_coloring(
                        raw, s_ext,
                        found_out, dict(file_comm),
                        {}, extra_budget, {}
                    )
                    if result:
                        student_colors[s_path.name] = result
                except Exception:
                    pass

            teacher_total = sum(teacher_agg.values())
            sim_score = round(sum(found_out.values()) / teacher_total * 100, 1) if teacher_total else None
            diff_marks = {
                'format_version': 4,
                'token_matching': 'similarity-containment',
                'case_sensitive': True,
                'teacher_files': _colors_to_position_marks(teacher_code_files, teacher_colors),
                'student_files': _colors_to_position_marks(stu_files, student_colors),
            }
            if sim_score is not None:
                diff_marks['score'] = sim_score
            diff_path = anon_dir / 'diff_marks.json'
            with open(diff_path, 'w', encoding='utf-8') as fh:
                json.dump(diff_marks, fh, ensure_ascii=False, indent=2)
            written += 1

        print(f'  Written similarity diff marks for {written} student(s) in {names_dir.name}/')

    def _write_alt_diff_marks(
        self,
        names_dir: Path,
        anon_names_dir: Optional[Path],
        build_fn,
        diff_mode: str,
        label: str,
        filename: str = 'diff_marks.json',
    ) -> None:
        teacher_code_files = self.get_all_code_files(self.reference_dir)
        if not teacher_code_files:
            print(f'  {label} skipped — no teacher code files found.')
            return

        written = 0
        for student_dir in sorted(names_dir.iterdir()):
            if not student_dir.is_dir():
                continue
            sid = self.name_to_id.get(student_dir.name)
            if sid is None or sid not in self.results:
                continue

            anon_dir = student_dir
            if anon_names_dir is not None and anon_names_dir.is_dir():
                candidate = anon_names_dir / student_dir.name
                if candidate.is_dir():
                    anon_dir = candidate

            stu_files = self.get_all_code_files(anon_dir) or self.get_all_code_files(student_dir)
            if not stu_files:
                continue

            result = build_fn(teacher_code_files, stu_files)
            alignments = None
            if len(result) == 4:
                teacher_marks, student_marks, score, alignments = result
            elif len(result) == 3:
                teacher_marks, student_marks, score = result
            else:
                teacher_marks, student_marks = result
                score = None

            diff_marks = {
                'format_version': 4,
                'diff_mode': diff_mode,
                'case_sensitive': True,
                'teacher_files': teacher_marks,
                'student_files': student_marks,
            }
            if score is not None:
                diff_marks['score'] = score
            if alignments is not None:
                diff_marks['alignments'] = alignments
            diff_path = anon_dir / filename
            with open(diff_path, 'w', encoding='utf-8') as fh:
                json.dump(diff_marks, fh, ensure_ascii=False, indent=2)
            written += 1

        print(f'  Written {label} for {written} student(s) in {names_dir.name}/')

    def write_lcs_diff_marks(self, names_dir: Path, anon_names_dir: Path = None) -> None:
        self._write_alt_diff_marks(
            names_dir, anon_names_dir,
            _build_lcs_token_diff_marks,
            'token-lcs',
            'LCS token diff marks',
            filename='diff_marks_lcs.json',
        )

    def write_ro_diff_marks(self, names_dir: Path, anon_names_dir: Path = None) -> None:
        self._write_alt_diff_marks(
            names_dir, anon_names_dir,
            _build_ro_diff_marks,
            'line-ro',
            'R/O line diff marks',
            filename='diff_marks_ro.json',
        )

    write_myers_diff_marks = write_ro_diff_marks

    def write_ro_star_diff_marks(self, names_dir: Path, anon_names_dir: Path = None) -> None:
        ghost_contexts = getattr(self, '_ghost_contexts', None)
        if ghost_contexts is None:
            teacher_tokens_path = self.reference_dir / 'tokens.txt'
            if teacher_tokens_path.exists():
                teacher_entries = _parse_teacher_tokens(teacher_tokens_path)
                removed_keys = {tok for tok, _, _, is_rem, *_ in teacher_entries if is_rem}
                all_events = getattr(self, '_lesson_all_events', None)
                if removed_keys and all_events:
                    ghost_contexts = _build_ghost_contexts(all_events, removed_keys)
                    self._ghost_contexts = ghost_contexts

        build_fn = functools.partial(_build_ro_star_diff_marks, ghost_contexts=ghost_contexts)
        self._write_alt_diff_marks(
            names_dir, anon_names_dir,
            build_fn,
            'line-ro-star',
            'R/O* line diff marks',
            filename='diff_marks_ro_star.json',
        )

    def write_vscode_diff_marks(self, names_dir: Path, anon_names_dir: Path = None) -> None:
        self._write_alt_diff_marks(
            names_dir, anon_names_dir,
            _build_vscode_diff_marks,
            'line-vscode',
            'VS Code line diff marks',
            filename='diff_marks_vscode.json',
        )

    def write_vscode_star_diff_marks(self, names_dir: Path, anon_names_dir: Path = None) -> None:
        ghost_contexts = getattr(self, '_ghost_contexts', None)
        if ghost_contexts is None:
            teacher_tokens_path = self.reference_dir / 'tokens.txt'
            if teacher_tokens_path.exists():
                teacher_entries = _parse_teacher_tokens(teacher_tokens_path)
                removed_keys = {tok for tok, _, _, is_rem, *_ in teacher_entries if is_rem}
                all_events = getattr(self, '_lesson_all_events', None)
                if removed_keys and all_events:
                    ghost_contexts = _build_ghost_contexts(all_events, removed_keys)
                    self._ghost_contexts = ghost_contexts

        build_fn = functools.partial(_build_vscode_star_diff_marks, ghost_contexts=ghost_contexts)
        self._write_alt_diff_marks(
            names_dir, anon_names_dir,
            build_fn,
            'line-vscode-star',
            'VS Code* line diff marks',
            filename='diff_marks_vscode_star.json',
        )

    def write_lcs_star_diff_marks(self, names_dir: Path, anon_names_dir: Path = None,
                                   filename: str = 'diff_marks_lcs_star.json') -> None:
        teacher_tokens_path = self.reference_dir / 'tokens.txt'
        removal_counts: Counter = Counter()
        teacher_entries = []
        if teacher_tokens_path.exists():
            teacher_entries = _parse_teacher_tokens(teacher_tokens_path)
            for tok, _ts, _is_comment, is_removed, _rm_ts in teacher_entries:
                if is_removed:
                    removal_counts[tok] += 1

        ghost_contexts = getattr(self, '_ghost_contexts', None)
        if ghost_contexts is None and teacher_entries:
            all_events = getattr(self, '_lesson_all_events', None)
            if all_events:
                removed_keys = {tok for tok, _, _, is_rem, *_ in teacher_entries if is_rem}
                if removed_keys:
                    ghost_contexts = _build_ghost_contexts(all_events, removed_keys)
                    self._ghost_contexts = ghost_contexts

        build_fn = functools.partial(
            _build_lcs_star_diff_marks,
            removal_counts=removal_counts,
            ghost_contexts=ghost_contexts,
        )
        self._write_alt_diff_marks(
            names_dir, anon_names_dir,
            build_fn,
            'token-lcs-star',
            'LCS* token diff marks',
            filename=filename,
        )

    def write_context_first_diff_marks(self, names_dir: Path, anon_names_dir: Path = None) -> None:
        self._write_alt_diff_marks(
            names_dir, anon_names_dir,
            _build_context_first_diff_marks,
            'context-first',
            'Context-first diff marks',
            filename='diff_marks_context_first.json',
        )
