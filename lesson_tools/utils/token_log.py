import difflib
import functools
import json
import math
import re
import shutil
from collections import Counter
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import bisect
from . import similarity_measures as _sm

from .similarity_measures import (
    _COMMENT_RE,
    _COMMENT_RE_HTML,
    _SCRIPT_TAG_RE,
    _UNCLOSED_SCRIPT_RE,
    _UNCLOSED_IN_STRIPPED_RE,
    get_html_outside_css,
    get_reconstructed_files,
    reconstruct_tokens_from_keylog_full,
    split_code_tokens,
    split_css_tokens,
    split_follow_tokens_html,
    _strip_script_bodies,
    _extract_event_handler_bodies,
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


def _comment_ranges_for_ext(text: str, ext: str):
    """Return (starts, ends) lists for comment spans, matching the same patterns as JS diffColorize."""
    starts, ends = [], []
    if ext in ('.html', '.htm'):
        for m in _COMMENT_RE_HTML.finditer(text):
            starts.append(m.start())
            ends.append(m.end())
        for sm in _SCRIPT_TAG_RE.finditer(text):
            body_start = sm.start(1)
            for cm in _COMMENT_RE.finditer(sm.group(1)):
                starts.append(body_start + cm.start())
                ends.append(body_start + cm.end())
        mu = _UNCLOSED_IN_STRIPPED_RE.search(text)
        if mu:
            body_start = mu.end()
            body = text[body_start:]
            for cm in _COMMENT_RE.finditer(body):
                starts.append(body_start + cm.start())
                ends.append(body_start + cm.end())
        pairs = sorted(zip(starts, ends))
        if pairs:
            starts, ends = map(list, zip(*pairs))
    else:
        for m in _COMMENT_RE.finditer(text):
            starts.append(m.start())
            ends.append(m.end())
    return starts, ends


def _pos_in_comment(pos: int, starts: list, ends: list) -> bool:
    idx = bisect.bisect_right(starts, pos) - 1
    return idx >= 0 and ends[idx] > pos


def _find_token_occs(text_s: str, tok_s: str, c_starts: list, c_ends: list) -> list:
    """Return [(pos, is_in_comment), ...] using the same boundary rules as JS diffColorize.
    text_s and tok_s must already be in matching case (both upper or both original)."""
    escaped = re.escape(tok_s)
    has_hyphen = '-' in tok_s
    if re.match(r'^\w', tok_s):
        escaped = (r'(?<![.<\w])' if has_hyphen else r'(?<![<\w])') + escaped
    if re.search(r'\w$', tok_s):
        escaped = escaped + (r'(?!\w)' if has_hyphen else r'(?!\w)(?!-[a-zA-Z_])')
    try:
        pat = re.compile(escaped)
    except re.error:
        return []
    return [(m.start(), _pos_in_comment(m.start(), c_starts, c_ends))
            for m in pat.finditer(text_s)]


def _build_teacher_file_coloring(text: str, ext: str,
                                  miss_budget: dict, comm_tokens: dict) -> dict:
    """Return {tok: [label|None, ...]} per file occurrence.
    Labels: 'missing' (non-comment missing) | 'comment' (any comment occurrence).
    Consumes from miss_budget and comm_tokens in place (shared across multiple file calls)."""
    text_s = text
    c_starts, c_ends = _comment_ranges_for_ext(text, ext)
    result = {}
    for tok in set(miss_budget) | set(comm_tokens):
        occs = _find_token_occs(text_s, tok, c_starts, c_ends)
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
    """Return {tok: [label|None, ...]} per file occurrence.
    Labels: 'comment' (any comment occurrence) | 'extra_star' | 'extra' (non-comment extras).
    Consumes from all budget dicts in place (shared across multiple file calls)."""
    text_s = text
    c_starts, c_ends = _comment_ranges_for_ext(text, ext)
    all_toks = set(found_out) | set(found_comm) | set(star) | set(extra) | set(extra_comm)
    result = {}
    for tok in all_toks:
        occs = _find_token_occs(text_s, tok, c_starts, c_ends)
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


def _extract_student_ci_split(stu_files: dict):
    outside: Counter = Counter()
    comment: Counter = Counter()
    for name, path in stu_files.items():
        ext = Path(name).suffix.lower()
        try:
            raw = path.read_text(encoding='utf-8', errors='ignore')
        except Exception:
            continue
        if ext in ('.html', '.htm'):
            for k, v in get_html_outside_css(raw).items():
                outside[k] += v
            for m in _SCRIPT_TAG_RE.finditer(raw):
                s_out, _ = split_code_tokens(m.group(1))
                for k, v in s_out.items():
                    outside[k] += v
            _stripped = _SCRIPT_TAG_RE.sub(' ', raw)
            m_unc = _UNCLOSED_SCRIPT_RE.search(_stripped)
            if m_unc:
                s_out, _ = split_code_tokens(m_unc.group(1))
                for k, v in s_out.items():
                    outside[k] += v
            html_body = _strip_script_bodies(raw)
            for body in _extract_event_handler_bodies(html_body):
                s_out, _ = split_code_tokens(body)
                for k, v in s_out.items():
                    outside[k] += v
            for k, v in split_follow_tokens_html(raw)[1].items():
                comment[k] += v
        elif ext == '.css':
            out, ins = split_css_tokens(raw)
            for k, v in out.items():
                outside[k] += v
            for k, v in ins.items():
                comment[k] += v
        else:
            out, ins = split_code_tokens(raw)
            for k, v in out.items():
                outside[k] += v
            for k, v in ins.items():
                comment[k] += v
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
    last_ts = teacher_occ[-1][1] if teacher_occ else '00:00:00'

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

    transposed = False
    mat = weights
    if n > m:
        transposed = True
        mat = [[weights[i][j] for i in range(n)] for j in range(m)]
        n, m = m, n

    max_w = max(max(row) for row in mat) if mat else 0.0
    a = [[max_w - mat[i][j] for j in range(m)] for i in range(n)]

    u = [0.0] * (n + 1)
    v = [0.0] * (m + 1)
    p = [0] * (m + 1)
    way = [0] * (m + 1)

    for i in range(1, n + 1):
        p[0] = i
        minv = [float('inf')] * (m + 1)
        used = [False] * (m + 1)
        j0 = 0
        while True:
            used[j0] = True
            i0 = p[j0]
            delta = float('inf')
            j1 = 0
            for j in range(1, m + 1):
                if used[j]:
                    continue
                cur = a[i0 - 1][j - 1] - u[i0] - v[j]
                if cur < minv[j]:
                    minv[j] = cur
                    way[j] = j0
                if minv[j] < delta:
                    delta = minv[j]
                    j1 = j
            for j in range(0, m + 1):
                if used[j]:
                    u[p[j]] += delta
                    v[j] -= delta
                else:
                    minv[j] -= delta
            j0 = j1
            if p[j0] == 0:
                break
        while True:
            j1 = way[j0]
            p[j0] = p[j1]
            j0 = j1
            if j0 == 0:
                break

    pairs = []
    for j in range(1, m + 1):
        i = p[j]
        if i == 0:
            continue
        ri = i - 1
        cj = j - 1
        if transposed:
            pairs.append((cj, ri))
        else:
            pairs.append((ri, cj))

    rows, cols = len(weights), len(weights[0])
    return [(r, c) for r, c in pairs if r < rows and c < cols]


_CONTEXT_K = 6   # neighbor window for teacher/student context vectors
_GHOST_K   = 6   # neighbor window for ghost context vectors (and narrow student comparison)
_GHOST_SIM_THRESHOLD = 0.5  # minimum cosine similarity to ghost context to assign extra_star


def _build_ghost_contexts(
    all_events: list,
    token_keys: set,
    k: int = _GHOST_K,
) -> Dict[str, List[Counter]]:
    from .lv_editor import reconstruct_all_headless_at_timestamps

    _, deleted = replay_with_timestamps_all(all_events)
    if not deleted:
        return {}

    del_token_occs: Dict[str, List[Tuple[int, int]]] = {}
    seg: List[Tuple[int, str, int, int]] = []

    def _flush_seg(s: list) -> None:
        if not s:
            return
        text = ''.join(ch for _, ch, _, _ in s)
        for m in _sm._CSS_TOKEN_RE.finditer(text):
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
                    toks.extend(m.group() for m in _sm._CSS_TOKEN_RE.finditer(''.join(seg2)))
                    seg2 = []
            else:
                seg2.append(ch)
        if seg2:
            toks.extend(m.group() for m in _sm._CSS_TOKEN_RE.finditer(''.join(seg2)))
        del_ts_co_tokens[dt] = toks

    reconstructed_at: Dict[int, List[str]] = {}
    for dt, texts in reconstruct_all_headless_at_timestamps(all_events, sorted(relevant_del_ts)).items():
        toks: List[str] = []
        for tab_key, text in texts.items():
            ext = Path(tab_key).suffix.lower() or '.html'
            c_starts, c_ends = _comment_ranges_for_ext(text, ext)
            for m in _sm._CSS_TOKEN_RE.finditer(text):
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
    if not ghost_contexts or not _sm._ALL_EXTRA_STAR or not extra_pairs:
        return set()

    by_tok: Dict[str, List[Tuple[int, int]]] = {}  # tok → [(pair_idx, seq_idx)]
    for pair_idx, (seq_idx, tok) in enumerate(extra_pairs):
        if tok in ghost_contexts:
            by_tok.setdefault(tok, []).append((pair_idx, seq_idx))

    star_pair_idxs: set = set()
    for tok, items in by_tok.items():
        positions = [seq_idx for _, seq_idx in items]
        _, _, _, es = _locate_token(
            positions, [], s_seq, [], k,
            ghost_ctx_vecs=ghost_contexts[tok],
        )
        for rank in es:
            star_pair_idxs.add(items[rank][0])

    return star_pair_idxs


def _locate_token(
    s_positions: List[int],
    t_positions: List[int],
    s_seq: List[str],
    t_seq: List[str],
    k: int,
    ghost_ctx_vecs: List[Counter] = None,
    s_exclude: set = None,
) -> Tuple[set, set, set, set]:
    n_s = len(s_positions)
    n_t = len(t_positions)
    n_g = len(ghost_ctx_vecs) if ghost_ctx_vecs else 0

    if n_s == 0:
        return set(), set(range(n_t)), set(), set()

    s_ctx = [_context_vector(s_seq, p, k, s_exclude) for p in s_positions]

    if n_g:
        tok_keep = (frozenset(t for v in ghost_ctx_vecs for t in v)
                    | {s_seq[p] for p in s_positions if p < len(s_seq)})
        filt_items = [(i, t) for i, t in enumerate(s_seq) if t in tok_keep]
        filt_seq_g = [t for _, t in filt_items]
        orig_to_filt_g = {i: fi for fi, (i, _) in enumerate(filt_items)}
        s_ctx_narrow = [
            _context_vector(filt_seq_g, orig_to_filt_g[p], _GHOST_K)
            if p in orig_to_filt_g else Counter()
            for p in s_positions
        ]
    else:
        s_ctx_narrow = []

    n_cols = n_t + n_g
    if n_cols == 0:
        return set(), set(), set(range(n_s)), set()

    if n_t > 0:
        t_ctx = [_context_vector(t_seq, p, k) for p in t_positions]
    else:
        t_ctx = []

    sim = []
    for i in range(n_s):
        row = [_cosine_similarity_sparse(s_ctx[i], t_ctx[j]) for j in range(n_t)]
        row += [_cosine_similarity_sparse(s_ctx_narrow[i], g) for g in (ghost_ctx_vecs or [])]
        sim.append(row)

    pairs = _hungarian_max(sim)

    matched_s: set = set()
    matched_t: set = set()
    extra_star: set = set()

    for si, col in pairs:
        if col < n_t:
            matched_s.add(si)
            matched_t.add(col)
        else:
            if _sm._ALL_EXTRA_STAR and sim[si][col] >= _GHOST_SIM_THRESHOLD:
                extra_star.add(si)

    missing_t = {j for j in range(n_t) if j not in matched_t}
    extra = {i for i in range(n_s) if i not in matched_s and i not in extra_star}

    return matched_s, missing_t, extra, extra_star


def _collect_occurrences(files_by_ext: dict, token_keys: set) -> Tuple[List[dict], Dict[str, Dict[str, int]]]:
    occs: List[dict] = []
    counts: Dict[str, Dict[str, int]] = {}

    for file_order, (name, path) in enumerate(files_by_ext.items()):
        ext = Path(name).suffix.lower()
        try:
            raw = path.read_text(encoding='utf-8', errors='ignore')
        except Exception:
            continue
        text_s = raw
        c_starts, c_ends = _comment_ranges_for_ext(raw, ext)
        file_name = path.name

        for tok in token_keys:
            positions = _find_token_occs(text_s, tok, c_starts, c_ends)
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
    teacher_entries: list,
    student_outside: Counter,
    student_comment: Counter,
    context_k: int = _CONTEXT_K,
    ghost_contexts: Dict[str, List[Counter]] = None,
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

    d_counts = Counter(
        tok
        for tok, _ts, _is_comment, is_removed, *_ in teacher_entries
        if is_removed
    ) if _sm._ALL_EXTRA_STAR else Counter()

    teacher_colors = {
        fn: {tok: [None] * n for tok, n in toks.items()}
        for fn, toks in teacher_counts.items()
    }
    student_colors = {
        fn: {tok: [None] * n for tok, n in toks.items()}
        for fn, toks in student_counts.items()
    }

    # Pre-pass: identify student positions that are ghost-matched (extra_star) so they
    # can be excluded from context windows during the main matching.  This prevents
    # removed-then-reinserted tokens (e.g. onclick/handleClick/this) from distorting
    # the cosine context of nearby surviving tokens (e.g. <img).
    pre_extra_star_positions: set = set()
    if ghost_contexts and d_counts:
        for tok in token_keys:
            if not d_counts.get(tok, 0):
                continue
            ghost_vecs = ghost_contexts.get(tok)
            if not ghost_vecs:
                continue
            t_out_pre = [x for x in teacher_by_token.get(tok, []) if not x['is_comment']]
            s_out_pre = [x for x in student_by_token.get(tok, []) if not x['is_comment']]
            _, _, _, pre_es = _locate_token(
                [x['seq_idx'] for x in s_out_pre],
                [x['seq_idx'] for x in t_out_pre],
                student_seq, teacher_seq, context_k,
                ghost_ctx_vecs=ghost_vecs,
            )
            for i in pre_es:
                pre_extra_star_positions.add(s_out_pre[i]['seq_idx'])

    for tok in token_keys:
        t_list = teacher_by_token.get(tok, [])
        s_list = student_by_token.get(tok, [])

        t_out = [x for x in t_list if not x['is_comment']]
        t_com = [x for x in t_list if x['is_comment']]
        s_out = [x for x in s_list if not x['is_comment']]
        s_com = [x for x in s_list if x['is_comment']]

        t_out_pos = [x['seq_idx'] for x in t_out]
        s_out_pos = [x['seq_idx'] for x in s_out]
        ghost_vecs = (ghost_contexts or {}).get(tok)
        s_excl = pre_extra_star_positions if (pre_extra_star_positions and ghost_vecs is None) else None
        _mso, missing_to, extra_so, extra_star_so = _locate_token(
            s_out_pos, t_out_pos, student_seq, teacher_seq, context_k,
            ghost_ctx_vecs=ghost_vecs,
            s_exclude=s_excl,
        )

        extra_star_assigned = extra_star_so
        extra_assigned = extra_so

        for i, oc in enumerate(t_out):
            arr = teacher_colors[oc['file']][tok]
            if i in missing_to:
                arr[oc['file_idx']] = 'missing'

        for oc in t_com:
            arr = teacher_colors[oc['file']][tok]
            arr[oc['file_idx']] = 'comment'

        for i, oc in enumerate(s_out):
            arr = student_colors[oc['file']][tok]
            if i in extra_star_assigned:
                arr[oc['file_idx']] = 'extra_star'
            elif i in extra_assigned:
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


def _build_utf16_map(text: str) -> List[int]:
    u16map = []
    u16 = 0
    for ch in text:
        u16map.append(u16)
        u16 += 2 if ord(ch) > 0xFFFF else 1
    u16map.append(u16)
    return u16map


def _colors_to_position_marks(files_by_ext: dict, colors_map: dict) -> dict:
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
    for oc in occs:
        labels = colors_map.get(oc['file'], {}).get(oc['token'])
        if not labels or oc['file_idx'] >= len(labels):
            continue
        label = labels[oc['file_idx']]
        if label is None:
            continue
        u16map = file_u16maps.get(oc['file'])
        if u16map:
            start = u16map[oc['pos']]
            end   = start + len(oc['token'])
        else:
            start = oc['pos']
            end   = oc['pos'] + len(oc['token'])
        result.setdefault(oc['file'], []).append({
            'token': oc['token'],
            'label': label,
            'start': start,
            'end':   end,
        })
    for lst in result.values():
        lst.sort(key=lambda x: x['start'])
    return result


def _line_start_offsets(text: str) -> List[int]:
    starts = [0]
    for i, ch in enumerate(text):
        if ch == '\n':
            starts.append(i + 1)
    return starts


def _tokenize_file_ordered(text: str, ext: str) -> List[Tuple[int, str]]:
    has_css = ext in ('.css', '.html', '.htm')
    css_only: List[Tuple[int, int]] = []
    if ext in ('.html', '.htm'):
        for m in _sm._STYLE_TAG_CONTENT_RE.finditer(text):
            css_only.append((m.start(1), m.end(1)))
    matches = _sm._extract_matches_with_priority(text, has_css, css_only)
    return sorted([(pos, tok) for pos, tok, cs in matches], key=lambda x: x[0])


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


def _build_lcs_star_diff_marks(
    teacher_files: Dict[str, Path],
    student_files: Dict[str, Path],
    removal_counts: Counter,
    ghost_contexts: Dict[str, List[Counter]] = None,
) -> Tuple[Dict[str, List[dict]], Dict[str, List[dict]], Optional[float]]:
    teacher_result: Dict[str, List[dict]] = {}
    student_result: Dict[str, List[dict]] = {}
    used_star: Counter = Counter()
    n_total_nc = 0
    n_missing_nc = 0
    n_extra_star_count = 0

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
        n_total_nc += len(t_seq)

        sm = difflib.SequenceMatcher(None, t_seq, s_seq, autojunk=False)

        t_marks: List[dict] = []
        extra_nc_idxs: List[int] = []  # s_nc indices of LCS-extra non-comment tokens

        for tag, i1, i2, j1, j2 in sm.get_opcodes():
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
                    extra_nc_idxs.append(j)

        extra_star_set: set = set()  # indices into extra_nc_idxs
        if ghost_contexts is not None:
            extra_pairs = [(j, s_nc[j][1]) for j in extra_nc_idxs]
            ghost_ranks = _ghost_star_idxs(extra_pairs, s_seq, ghost_contexts, _GHOST_K)
            extra_star_set = ghost_ranks  # ghost_ranks are indices into extra_pairs = extra_nc_idxs
        elif _sm._ALL_EXTRA_STAR:
            for k_idx, j in enumerate(extra_nc_idxs):
                tok = s_nc[j][1]
                remaining = removal_counts.get(tok, 0) - used_star[tok]
                if remaining > 0:
                    extra_star_set.add(k_idx)
                    used_star[tok] += 1

        s_marks: List[dict] = []
        for k_idx, j in enumerate(extra_nc_idxs):
            pos, tok = s_nc[j]
            label = 'extra_star' if k_idx in extra_star_set else 'extra'
            if label == 'extra_star':
                n_extra_star_count += 1
            s_marks.append({'token': tok, 'label': label,
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

    score = round(max(0.0, (n_total_nc - n_missing_nc - n_extra_star_count) / n_total_nc * 100), 1) if n_total_nc else None
    return teacher_result, student_result, score


def _build_myers_diff_marks(
    teacher_files: Dict[str, Path],
    student_files: Dict[str, Path],
) -> Tuple[Dict[str, List[dict]], Dict[str, List[dict]], Optional[float]]:
    teacher_result: Dict[str, List[dict]] = {}
    student_result: Dict[str, List[dict]] = {}
    n_total_lines = 0
    n_missing_lines = 0

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

        t_norm = [l.strip() for l in t_lines_raw]
        s_norm = [l.strip() for l in s_lines_raw]

        t_starts = _line_start_offsets(t_text)
        s_starts = _line_start_offsets(s_text) if s_text else []

        sm = difflib.SequenceMatcher(None, t_norm, s_norm, autojunk=False)

        t_marks: List[dict] = []
        s_marks: List[dict] = []
        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            if tag == 'equal':
                continue
            if tag in ('delete', 'replace'):
                for i in range(i1, i2):
                    line_content = t_lines_raw[i].strip()
                    if not line_content:
                        continue
                    n_missing_lines += 1
                    raw_start = t_starts[i]
                    raw_end   = t_starts[i + 1] if i + 1 < len(t_starts) else len(t_text)
                    line_raw = t_lines_raw[i]
                    ls = len(line_raw) - len(line_raw.lstrip())
                    le = len(line_raw.rstrip())
                    start = raw_start + ls
                    end   = raw_start + le
                    if start < end:
                        t_marks.append({'label': 'missing', 'start': start, 'end': end, 'line': True})
            if tag in ('insert', 'replace'):
                for j in range(j1, j2):
                    line_content = s_lines_raw[j].strip()
                    if not line_content:
                        continue
                    raw_start = s_starts[j]
                    line_raw = s_lines_raw[j]
                    ls = len(line_raw) - len(line_raw.lstrip())
                    le = len(line_raw.rstrip())
                    start = raw_start + ls
                    end   = raw_start + le
                    if start < end:
                        s_marks.append({'label': 'extra', 'start': start, 'end': end, 'line': True})

        fname = Path(t_name).name
        s_fname = s_path.name if s_path else fname
        if t_marks:
            teacher_result[fname] = t_marks
        if s_marks:
            student_result[s_fname] = s_marks

    score = round((n_total_lines - n_missing_lines) / n_total_lines * 100, 1) if n_total_lines else None
    return teacher_result, student_result, score


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
        elif not flags:
            found_count[parts[0]] += 1
            n_found_e_orig += 1
        elif flags == {'MISSING'}:
            n_missing_e_orig += 1

    steal_from_found: Counter = Counter()
    for tok, needed in extra_star_counts.items():
        deficit = max(0, needed - extra_avail[tok])
        if deficit > 0:
            steal_from_found[tok] = min(deficit, found_count.get(tok, 0))

    total_stolen = sum(steal_from_found.values())
    n_found_e = n_found_e_orig - total_stolen
    n_missing_e = n_missing_e_orig + total_stolen
    teacher_total_e = n_found_e + n_missing_e
    n_extra_star = sum(extra_star_counts.values())
    corrected_score = (round(max(0.0, (n_found_e - n_extra_star) / teacher_total_e * 100), 1)
                       if teacher_total_e else 0.0)

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
        if flags == {'EXTRA'} and extra_star_used[tok] < extra_star_counts.get(tok, 0):
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
    tokens_path.write_text('\n'.join(new_lines) + '\n', encoding='utf-8')
    return corrected_score, extra_star_counts, steal_from_found


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

        ghost_contexts = None
        if _sm._ALL_EXTRA_STAR:
            all_events = getattr(self, '_lesson_all_events', None)
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

            student_outside, student_comment = _extract_student_ci_split(stu_files)
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
                teacher_files_colors, student_files_colors = _build_contextual_diff_marks(
                    teacher_code_files,
                    stu_files,
                    teacher_entries,
                    student_outside,
                    student_comment,
                    ghost_contexts=ghost_contexts,
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
                'token_matching': 'context-cosine-hungarian',
                'case_sensitive': True,
                'score': follow_e_pct,
                'teacher_files': _colors_to_position_marks(teacher_code_files, teacher_files_colors),
                'student_files': _colors_to_position_marks(stu_files, student_files_colors),
            }
            removal_ts_by_token = {
                tok: removal_ts
                for tok, _, _, is_rem, removal_ts in teacher_entries
                if is_rem and removal_ts
            }
            corrected_score, extra_star_counts, steal_from_found = _update_tokens_txt_extra_star(
                out_path, diff_marks, removal_ts_by_token
            )
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
                tf_colors_no_star, sf_colors_no_star = _build_contextual_diff_marks(
                    teacher_code_files,
                    stu_files,
                    teacher_entries,
                    student_outside,
                    student_comment,
                    ghost_contexts=None,
                )
            except Exception:
                tf_colors_no_star, sf_colors_no_star = {}, {}
            diff_marks_contextual = {
                'format_version': 4,
                'token_matching': 'context-cosine-hungarian',
                'case_sensitive': True,
                'score': follow_e_pct,
                'teacher_files': _colors_to_position_marks(teacher_code_files, tf_colors_no_star),
                'student_files': _colors_to_position_marks(stu_files, sf_colors_no_star),
            }
            contextual_path = anon_dir / 'diff_marks_contextual.json'
            with open(contextual_path, 'w', encoding='utf-8') as fh:
                json.dump(diff_marks_contextual, fh, ensure_ascii=False, indent=2)

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
                if ext == '.html':
                    t_html = (self.teacher_html_outside_css_by_ext.get(ext)
                              or self.teacher_html_outside_by_ext.get(ext, Counter()))
                    t_script = self.teacher_script_outside_by_ext.get(ext, Counter())
                    teacher_ext = t_html + t_script
                else:
                    teacher_ext = self.teacher_outside_by_ext.get(ext, Counter())
                teacher_agg += teacher_ext
            student_agg, _ = _extract_student_ci_split(stu_files)

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
                    _, file_comm = _extract_student_ci_split({t_name: t_path})
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
                    _, file_comm = _extract_student_ci_split({s_name: s_path})
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
            if len(result) == 3:
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

    def write_myers_diff_marks(self, names_dir: Path, anon_names_dir: Path = None) -> None:
        self._write_alt_diff_marks(
            names_dir, anon_names_dir,
            _build_myers_diff_marks,
            'line-myers',
            'Myers line diff marks',
            filename='diff_marks_myers.json',
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
        if ghost_contexts is None and _sm._ALL_EXTRA_STAR and teacher_entries:
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
