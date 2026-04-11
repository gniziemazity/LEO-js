import json
import math
import re
from collections import Counter
from pathlib import Path
from typing import Dict, List, Tuple

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


def _norm_key(tok: str) -> str:
    return tok if _sm._ALL_CASE_SENSITIVE else tok.upper()

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
        # Hyphenated tokens (e.g. FLEX-DIRECTION) allow a preceding dot/hyphen;
        # plain tokens use the standard word-boundary lookbehind.
        escaped = (r'(?<![.\w])' if has_hyphen else r'(?<!\w)') + escaped
    if re.search(r'\w$', tok_s):
        # For non-hyphenated tokens, also block when followed by a hyphen that
        # begins a CSS identifier continuation (letter after the hyphen), e.g.
        # FLEX must not match inside `flex-direction` or `flex-end`.
        # A hyphen followed by a digit is arithmetic (e.g. i-1) and is allowed.
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
    cs = _sm._ALL_CASE_SENSITIVE
    text_s = text if cs else text.upper()
    c_starts, c_ends = _comment_ranges_for_ext(text, ext)
    result = {}
    for tok in set(miss_budget) | set(comm_tokens):
        occs = _find_token_occs(text_s, tok, c_starts, c_ends)
        if not occs:
            continue
        labels = []
        for _, is_c in occs:
            if is_c and comm_tokens.get(tok, 0) > 0:
                labels.append('comment'); comm_tokens[tok] -= 1
            elif not is_c and miss_budget.get(tok, 0) > 0:
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
    cs = _sm._ALL_CASE_SENSITIVE
    text_s = text if cs else text.upper()
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
                if found_comm.get(tok, 0) > 0:
                    labels.append('comment'); found_comm[tok] -= 1
                elif extra_comm.get(tok, 0) > 0:
                    labels.append('comment'); extra_comm[tok] -= 1
                else:
                    labels.append(None)
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
    for ext, path in stu_files.items():
        try:
            raw = path.read_text(encoding='utf-8', errors='ignore')
        except Exception:
            continue
        if ext in ('.html', '.htm'):
            for k, v in get_html_outside_css(raw).items():
                outside[_norm_key(k)] += v
            for m in _SCRIPT_TAG_RE.finditer(raw):
                s_out, _ = split_code_tokens(m.group(1))
                for k, v in s_out.items():
                    outside[_norm_key(k)] += v
            _stripped = _SCRIPT_TAG_RE.sub(' ', raw)
            m_unc = _UNCLOSED_SCRIPT_RE.search(_stripped)
            if m_unc:
                s_out, _ = split_code_tokens(m_unc.group(1))
                for k, v in s_out.items():
                    outside[_norm_key(k)] += v
            html_body = _strip_script_bodies(raw)
            for body in _extract_event_handler_bodies(html_body):
                s_out, _ = split_code_tokens(body)
                for k, v in s_out.items():
                    outside[_norm_key(k)] += v
            for k, v in split_follow_tokens_html(raw)[1].items():
                comment[_norm_key(k)] += v
        elif ext == '.css':
            out, ins = split_css_tokens(raw)
            for k, v in out.items():
                outside[_norm_key(k)] += v
            for k, v in ins.items():
                comment[_norm_key(k)] += v
        else:
            out, ins = split_code_tokens(raw)
            for k, v in out.items():
                outside[_norm_key(k)] += v
            for k, v in ins.items():
                comment[_norm_key(k)] += v
    return outside, comment


def _build_student_token_occurrences(
    teacher_entries: list,
    student_ci_outside: Counter,
    student_ci_comment: Counter,
) -> Tuple[list, int, int, int, float, dict]:
    teacher_occ = [
        (tok, ts_str, is_comment)
        for tok, ts_str, is_comment, is_removed, *_ in teacher_entries
        if not is_removed
    ]
    teacher_removed_del_ts: Dict[str, List[str]] = {}
    for entry in teacher_entries:
        tok, ts_str, _, is_removed = entry[:4]
        removal_ts_str = entry[4] if len(entry) > 4 else ''
        if is_removed:
            effective_ts = removal_ts_str if removal_ts_str else ts_str
            teacher_removed_del_ts.setdefault(_norm_key(tok), []).append(effective_ts)

    student_ci_total = student_ci_outside + student_ci_comment
    last_ts = teacher_occ[-1][1] if teacher_occ else '00:00:00'

    consumed = {True: Counter(), False: Counter()}
    all_occ: List[Tuple[str, str, set]] = []

    for tok, ts_str, is_comment in teacher_occ:
        ci_key = _norm_key(tok)
        pool = student_ci_comment if is_comment else student_ci_outside
        cons = consumed[is_comment]
        if cons[ci_key] < pool.get(ci_key, 0):
            cons[ci_key] += 1
            all_occ.append((ts_str, tok, {'COMMENT'} if is_comment else set()))
        else:
            base_flags: set = {'COMMENT'} if is_comment else set()
            all_occ.append((ts_str, tok, base_flags | {'MISSING'}))

    for ci_key in sorted(student_ci_total):
        extra_outside = student_ci_outside[ci_key] - consumed[False][ci_key]
        extra_comment = student_ci_comment[ci_key] - consumed[True][ci_key]
        removal_ts_list = list(reversed(teacher_removed_del_ts.get(ci_key, [])))
        n_star = min(max(0, extra_outside), len(removal_ts_list))
        for i in range(max(0, extra_outside)):
            if i < n_star:
                all_occ.append((removal_ts_list[i], ci_key, {'EXTRA*'}))
            else:
                all_occ.append((last_ts, ci_key, {'EXTRA'}))
        for _ in range(max(0, extra_comment)):
            all_occ.append((last_ts, ci_key, {'COMMENT', 'EXTRA'}))

    all_occ.sort(key=lambda x: x[0])

    n_found   = sum(1 for _, _, fl in all_occ if not fl or fl == {'COMMENT'})
    n_missing = sum(1 for _, _, fl in all_occ if 'MISSING' in fl)
    n_extra   = sum(1 for _, _, fl in all_occ if 'EXTRA' in fl or 'EXTRA*' in fl)

    n_found_e    = sum(1 for _, _, fl in all_occ if not fl)
    n_missing_e  = sum(1 for _, _, fl in all_occ if fl == {'MISSING'})
    n_extra_star = sum(1 for _, _, fl in all_occ if 'EXTRA*' in fl)
    teacher_total_e = n_found_e + n_missing_e
    follow_e_pct    = (round(max(0.0, (n_found_e - n_extra_star) / teacher_total_e * 100), 1)
                       if teacher_total_e else 0.0)

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
    comment_flags: List[bool] = None,
) -> Counter:
    lo = max(0, pos - k)
    hi = min(len(tokens_seq), pos + k + 1)
    vec = Counter()
    for i in range(lo, hi):
        if i == pos:
            continue
        if comment_flags is not None and comment_flags[i]:
            continue
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


_CONTEXT_K = 4   # neighbor window for teacher/student context vectors
_GHOST_K   = 2   # neighbor window for ghost context vectors (and narrow student comparison)
_GHOST_SIM_THRESHOLD = 0.05  # minimum cosine similarity to ghost context to assign extra_star


def _build_ghost_contexts(
    all_events: list,
    token_keys: set,
    k: int = _GHOST_K,
) -> Dict[str, List[Counter]]:
    from .lv_editor import reconstruct_all_headless

    _, deleted = replay_with_timestamps_all(all_events)
    if not deleted:
        return {}

    del_ts_char_count: Counter = Counter(del_ts for _, _, del_ts, _ in deleted)

    sorted_deleted = sorted(deleted, key=lambda x: x[3])

    del_token_occs: Dict[str, List[Tuple[int, int]]] = {}
    seg: List[Tuple[int, str, int, int]] = []

    def _flush_occ_seg(s: list) -> None:
        if not s:
            return
        text = ''.join(ch for _, ch, _, _ in s)
        for m in _sm._CSS_TOKEN_RE.finditer(text):
            tok = _norm_key(m.group())
            if tok not in token_keys:
                continue
            rel_end = m.end() - 1
            _, _, ins_ts, del_ts = s[rel_end]
            del_token_occs.setdefault(tok, []).append((ins_ts, del_ts))

    for ch, ins_ts, del_ts, idx in sorted_deleted:
        if ch in ('\n', '\r'):
            _flush_occ_seg(seg)
            seg = []
        else:
            seg.append((idx, ch, ins_ts, del_ts))
    _flush_occ_seg(seg)

    if not del_token_occs:
        return {}

    del_ts_groups: Dict[int, List[Tuple]] = {}
    for ch, ins_ts, del_ts, idx in deleted:
        if del_ts_char_count[del_ts] > 1:
            del_ts_groups.setdefault(del_ts, []).append((idx, ch))

    del_ts_co_tokens: Dict[int, List[str]] = {}
    for dt, chars in del_ts_groups.items():
        chars.sort()
        batch_toks: List[str] = []
        seg2: List[str] = []
        for _, ch in chars:
            if ch in ('\n', '\r'):
                if seg2:
                    text = ''.join(seg2)
                    batch_toks.extend(_norm_key(m.group()) for m in _sm._CSS_TOKEN_RE.finditer(text))
                    seg2 = []
            else:
                seg2.append(ch)
        if seg2:
            text = ''.join(seg2)
            batch_toks.extend(_norm_key(m.group()) for m in _sm._CSS_TOKEN_RE.finditer(text))
        del_ts_co_tokens[dt] = batch_toks

    relevant_del_ts = {
        del_ts
        for tok in token_keys
        for _ins_ts, del_ts in del_token_occs.get(tok, [])
    }

    reconstructed_at: Dict[int, List[str]] = {}
    for dt in sorted(relevant_del_ts):
        filtered = [e for e in all_events if e.get('timestamp', 0) < dt]
        texts = reconstruct_all_headless(filtered)
        seq: List[str] = []
        for text in texts.values():
            for m in _sm._CSS_TOKEN_RE.finditer(text):
                seq.append(_norm_key(m.group()))
        reconstructed_at[dt] = seq

    ghost_ctxs: Dict[str, List[Counter]] = {}
    for tok in token_keys:
        vecs: List[Counter] = []
        for _ins_ts, del_ts in del_token_occs.get(tok, []):
            seq = reconstructed_at.get(del_ts, [])
            positions = [i for i, t in enumerate(seq) if t == tok]
            if not positions:
                vecs.append(Counter())
                continue

            if del_ts_char_count[del_ts] > 1:
                co_toks = Counter(del_ts_co_tokens.get(del_ts, []))
                del co_toks[tok]

                n_co = len(co_toks)

                if n_co >= 2 and len(positions) > 1:
                    best_pos, best_score = positions[0], -1
                    for pos in positions:
                        lo = max(0, pos - k)
                        hi = min(len(seq), pos + k + 1)
                        neighbors = Counter(seq[lo:pos] + seq[pos + 1:hi])
                        score = sum(min(neighbors[t], v) for t, v in co_toks.items())
                        if score > best_score:
                            best_score, best_pos = score, pos
                    batch_seq = list(co_toks.elements()) + [tok]
                    pos_in_batch = batch_seq.index(tok)
                    vecs.append(_context_vector(batch_seq, pos_in_batch, k))
                    continue
                else:
                    if co_toks and len(positions) > 1:
                        best_pos, best_score = positions[0], -1
                        for pos in positions:
                            lo = max(0, pos - k)
                            hi = min(len(seq), pos + k + 1)
                            neighbors = Counter(seq[lo:pos] + seq[pos + 1:hi])
                            score = sum(min(neighbors[t], v) for t, v in co_toks.items())
                            if score > best_score:
                                best_score, best_pos = score, pos
                        pos_to_use = best_pos
                    else:
                        pos_to_use = positions[0]
            else:
                pos_to_use = positions[0]

            vecs.append(_context_vector(seq, pos_to_use, k))

        if vecs:
            ghost_ctxs[tok] = vecs

    return ghost_ctxs


def _locate_token(
    s_positions: List[int],
    t_positions: List[int],
    d_count: int,
    s_seq: List[str],
    t_seq: List[str],
    k: int,
    ghost_ctx_vecs: List[Counter] = None,
    s_flags: List[bool] = None,
    t_flags: List[bool] = None,
) -> Tuple[set, set, set, set]:
    n_s = len(s_positions)
    n_t = len(t_positions)
    n_g = len(ghost_ctx_vecs) if ghost_ctx_vecs else 0

    if n_s == 0:
        return set(), set(range(n_t)), set(), set()

    s_ctx = [_context_vector(s_seq, p, k, s_flags) for p in s_positions]
    s_ctx_narrow = [_context_vector(s_seq, p, _GHOST_K, s_flags) for p in s_positions] if n_g else []

    n_cols = n_t + n_g
    if n_cols == 0:
        return set(), set(), set(range(n_s)), set()

    if n_t > 0:
        t_ctx = [_context_vector(t_seq, p, k, t_flags) for p in t_positions]
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
            if sim[si][col] >= _GHOST_SIM_THRESHOLD:
                extra_star.add(si)

    missing_t = {j for j in range(n_t) if j not in matched_t}
    extra = {i for i in range(n_s) if i not in matched_s and i not in extra_star}

    return matched_s, missing_t, extra, extra_star


def _collect_occurrences(files_by_ext: dict, token_keys: set) -> Tuple[List[dict], Dict[str, Dict[str, int]]]:
    cs = _sm._ALL_CASE_SENSITIVE
    occs: List[dict] = []
    counts: Dict[str, Dict[str, int]] = {}

    for file_order, (ext, path) in enumerate(files_by_ext.items()):
        try:
            raw = path.read_text(encoding='utf-8', errors='ignore')
        except Exception:
            continue
        text_s = raw if cs else raw.upper()
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
    for i, oc in enumerate(occs):
        oc['seq_idx'] = i
        seq.append(oc['token'])
    return occs, counts


def _build_contextual_diff_marks(
    teacher_files: dict,
    student_files: dict,
    teacher_entries: list,
    student_ci_outside: Counter,
    student_ci_comment: Counter,
    context_k: int = _CONTEXT_K,
    ghost_contexts: Dict[str, List[Counter]] = None,
) -> Tuple[dict, dict]:
    token_keys = set()
    for entry in teacher_entries:
        token_keys.add(_norm_key(entry[0]))
    token_keys.update(student_ci_outside.keys())
    token_keys.update(student_ci_comment.keys())

    teacher_occs, teacher_counts = _collect_occurrences(teacher_files, token_keys)
    student_occs, student_counts = _collect_occurrences(student_files, token_keys)

    teacher_by_token: Dict[str, List[dict]] = {}
    for oc in teacher_occs:
        teacher_by_token.setdefault(oc['token'], []).append(oc)
    student_by_token: Dict[str, List[dict]] = {}
    for oc in student_occs:
        student_by_token.setdefault(oc['token'], []).append(oc)

    teacher_seq = [oc['token'] for oc in teacher_occs]
    student_seq = [oc['token'] for oc in student_occs]
    teacher_flags = [oc['is_comment'] for oc in teacher_occs]
    student_flags = [oc['is_comment'] for oc in student_occs]

    d_counts = Counter(
        _norm_key(tok)
        for tok, _ts, _is_comment, is_removed, *_ in teacher_entries
        if is_removed
    )

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
        ghost_vecs = (ghost_contexts or {}).get(tok)
        _mso, missing_to, extra_so, extra_star_so = _locate_token(
            s_out_pos, t_out_pos, d_counts.get(tok, 0), student_seq, teacher_seq, context_k,
            ghost_ctx_vecs=ghost_vecs,
            s_flags=student_flags,
            t_flags=teacher_flags,
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
            if i in extra_star_so:
                arr[oc['file_idx']] = 'extra_star'
            elif i in extra_so:
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


def _build_occurrence_position_metadata(files_by_ext: dict, colors_map: dict) -> dict:
    token_keys = set()
    for toks in colors_map.values():
        token_keys.update(toks.keys())

    occs, _counts = _collect_occurrences(files_by_ext, token_keys)

    token_arrays: Dict[str, List[list]] = {}
    for _fn, toks in colors_map.items():
        for tok, arr in toks.items():
            token_arrays.setdefault(tok, []).append(arr)

    occurrences = []
    for oc in occs:
        labels = colors_map.get(oc['file'], {}).get(oc['token'])
        if labels is None:
            arrays = token_arrays.get(oc['token'], [])
            if len(arrays) == 1:
                labels = arrays[0]
        label = None
        if labels and oc['file_idx'] < len(labels):
            label = labels[oc['file_idx']]
        occurrences.append({
            'token': oc['token'],
            'file': oc['file'],
            'char_index': oc['pos'],
            'token_index': oc['seq_idx'],
            'file_token_index': oc['file_idx'],
            'in_comment': oc['is_comment'],
            'label': label,
        })

    return {
        'count': len(occurrences),
        'occurrences': occurrences,
    }


class TokenLogMixin:
    def write_keyword_log(self) -> None:
        has_css = bool(
            self.teacher_tokens_by_ext.get('.css')
            or self.teacher_tokens_by_ext.get('.html')
        )

        all_events = getattr(self, '_lesson_all_events', None) or (
            self._lesson_keypresses + self._lesson_code_inserts
        )
        kw_ts_cs, kw_ts_ci, kw_ts_ci_comment, removed_kw_ts_ci, upper_to_display, ci_occ_with_display = (
            reconstruct_tokens_from_keylog_full(all_events, has_css=has_css)
        )

        if not kw_ts_cs and not removed_kw_ts_ci:
            print('  Keyword log skipped — no key-log data.')
            return

        all_occ: List[Tuple[int, int, str, bool, bool]] = []

        for ci_key, ts_list in kw_ts_ci.items():
            occ_sorted = sorted(ci_occ_with_display.get(ci_key, []))
            comment_ts_set = set(kw_ts_ci_comment.get(ci_key, []))
            for ts, disp in occ_sorted:
                all_occ.append((ts, 0, disp, ts in comment_ts_set, False))

        for ci_key, ts_list in removed_kw_ts_ci.items():
            disp = upper_to_display.get(ci_key, ci_key)
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
            fh.write(f'# Unique     : {len(kw_ts_ci)}\n')
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
              f'{n_removed} removed, {len(kw_ts_cs)} unique)')

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
            print('  Student token files skipped — tokens.txt not found.')
            return

        teacher_entries = _parse_teacher_tokens(teacher_tokens_path)

        ghost_contexts = None
        all_events = getattr(self, '_lesson_all_events', None)
        if all_events:
            removed_keys = {_norm_key(tok) for tok, _, _, is_rem, *_ in teacher_entries if is_rem}
            if removed_keys:
                ghost_contexts = _build_ghost_contexts(all_events, removed_keys)
                n_with_ctx = sum(1 for k in removed_keys if k in ghost_contexts)
                print(f'  Ghost contexts: {n_with_ctx}/{len(removed_keys)} removed tokens '
                      f'have deletion-batch context')

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

            stu_files = self.get_code_files(anon_dir) or self.get_code_files(student_dir)
            if not stu_files:
                continue

            student_ci_outside, student_ci_comment = _extract_student_ci_split(stu_files)
            all_occ, n_found, n_missing, n_extra, follow_e_pct, consumed = _build_student_token_occurrences(
                teacher_entries, student_ci_outside, student_ci_comment
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

            teacher_code_files = self.get_code_files(self.reference_dir)
            try:
                teacher_files_colors, student_files_colors = _build_contextual_diff_marks(
                    teacher_code_files,
                    stu_files,
                    teacher_entries,
                    student_ci_outside,
                    student_ci_comment,
                    ghost_contexts=ghost_contexts,
                )
            except Exception:
                miss_budget  = Counter(_norm_key(tok) for _, tok, fl in all_occ if fl == {'MISSING'})
                comm_tokens  = Counter(_norm_key(tok) for _, tok, fl in all_occ
                                       if 'COMMENT' in fl and 'EXTRA' not in fl and 'EXTRA*' not in fl)
                found_out    = Counter(consumed[False])
                found_comm   = Counter(consumed[True])
                star_budget      = Counter(_norm_key(tok) for _, tok, fl in all_occ if fl == {'EXTRA*'})
                extra_budget     = Counter(_norm_key(tok) for _, tok, fl in all_occ if fl == {'EXTRA'})
                extra_comm_budget= Counter(_norm_key(tok) for _, tok, fl in all_occ
                                           if 'COMMENT' in fl and ('EXTRA' in fl or 'EXTRA*' in fl))

                teacher_files_colors = {}
                for t_ext, t_path in teacher_code_files.items():
                    try:
                        raw = t_path.read_text(encoding='utf-8', errors='ignore')
                        teacher_files_colors[t_path.name] = _build_teacher_file_coloring(
                            raw, t_ext, miss_budget, comm_tokens
                        )
                    except Exception:
                        pass

                student_files_colors = {}
                for s_ext, s_path in stu_files.items():
                    try:
                        raw = s_path.read_text(encoding='utf-8', errors='ignore')
                        student_files_colors[s_path.name] = _build_student_file_coloring(
                            raw, s_ext, found_out, found_comm,
                            star_budget, extra_budget, extra_comm_budget
                        )
                    except Exception:
                        pass

            diff_marks = {
                'format_version': 3,
                'token_matching': 'context-cosine-hungarian',
                'case_sensitive': _sm._ALL_CASE_SENSITIVE,
                'teacher_files':  teacher_files_colors,
                'student_files':  student_files_colors,
            }
            diff_path = anon_dir / 'diff_marks.json'
            with open(diff_path, 'w', encoding='utf-8') as fh:
                json.dump(diff_marks, fh, ensure_ascii=False, indent=2)

            positions_meta = {
                'format_version': 1,
                'source': 'diff_marks',
                'case_sensitive': _sm._ALL_CASE_SENSITIVE,
                'teacher': _build_occurrence_position_metadata(
                    teacher_code_files, teacher_files_colors,
                ),
                'student': _build_occurrence_position_metadata(
                    stu_files, student_files_colors,
                ),
            }
            pos_path = anon_dir / 'tokens_positions.json'
            with open(pos_path, 'w', encoding='utf-8') as fh:
                json.dump(positions_meta, fh, ensure_ascii=False, indent=2)

            written += 1

        print(f'  Written token files for {written} student(s) in {names_dir.name}/')
