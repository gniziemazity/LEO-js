# Token-Based Code Differentiator: Algorithm Description

## Abstract

This document describes the tokenization and matching algorithms used by the
LEO-js differentiator to compare a student's code against a
teacher's reference. The teacher's reference is normally **reconstructed from a
keylog** (the live-coding event stream); when no keylog is available, the
teacher's static source files are used directly.

Up to six matching methods can be loaded into the differentiator UI,
organised in three families with a paired star (`*`) variant for each. The
browser only shows methods whose `diff_marks_*.json` files are actually
present.

| Family | Plain | Star   | Granularity  | Algorithm                                                    |
| ------ | ----- | ------ | ------------ | ------------------------------------------------------------ |
| LEO    | `leo` | `leo*` | Token        | Per-token Hungarian matching on cosine-similar contexts      |
| LCS    | `lcs` | `lcs*` | Token        | Difflib SequenceMatcher (Ratcliff/Obershelp) on token stream |
| Git    | `git` | `git*` | Line + Token | `git diff --no-index --unified=0 -w`, then per-line          |

The star variant of every method is the same algorithm followed by a
**ghost-token post-processing pass**: per token type, student `extra` marks
and teacher ghost instances are paired with a Hungarian assignment scored by
the same cosine-context function used in LEO. Pairs with cosine
`>= _CONTEXT_MATCH_THRESHOLD` are promoted to `ghost_extra` and receive
`removal_ts` from the matched ghost instance.

In addition to the six algorithmic methods, the differentiator can load
two hand-curated modes for any student: `ideal` (`diff_marks_ideal.json`,
the recommended-fix list) and `minimal` (`diff_marks_minimal.json`,
the minimum-fix list). Both use the same schema and are edited inside
the differentiator itself via the curated editor
(`differentiator/curated*.js`); the ideal file
is also the reference that `compare_methods_to_ideal.py` (`npm run eval`)
evaluates the algorithmic methods against. Ideal mode is the default
when present; otherwise minimal, then `leo*`, falling back to `leo`.
See §8.

The output of every method is a JSON document of the same shape — a list of
character-offset position marks per file with one of four labels (`missing`,
`extra`, `ghost_extra`, `comment`) — consumed by `differentiator.js` for
colour-coded highlighting.

Mode-file mapping and cross-window data handoff are centralized in
`lesson_tools/shared/diff-utils.js` (`DIFF_MARKS_FILES`, `defaultDiffModeKey`,
`navigateToDifferentiator`). The timeline, overview, and students views all
use this same mapping, so adding/removing a diff mode should be done in one
place.

---

## 1. Background

In a live coding classroom, the teacher types code while students follow.
After a session, the teacher's keylog is the authoritative reference: every
keystroke and the timestamp at which it was typed. Students send final
source files. The differentiator answers:

- Which tokens did the student successfully reproduce from the teacher's
  reference?
- Which are missing?
- Which are extras beyond what was taught?
- Did the student type something the teacher also typed but later deleted?

The three method families exist because no single algorithm answers these
questions correctly for every situation. Each family makes a different
trade-off between matching granularity, ordering sensitivity, and tolerance
to local rearrangement. They share a common token definition and a common
output format.

---

## 2. Token Definition

A **token** is the minimal unit produced by the shared character-style
tokenizer in `utils/similarity_measures.py`:

- `_CHAR_TOKEN_RE = r'[a-zA-Z0-9]+|[^\s]'`

This yields:

- alphanumeric runs as one token (`function`, `border`, `50`, `p2`)
- each non-whitespace punctuation character as its own token (`<`, `>`, `/`, `:`, `;`, `(`, `)`)

Examples:

- `<div class="card">` → `<`, `div`, `class`, `=`, `"`, `card`, `"`, `>`
- `height: 50px;` → `height`, `:`, `50px`, `;`

There is no HTML/CSS priority tokenizer in the current implementation.
HTML/CSS/JS all use the same tokenizer path, while comment handling is
applied separately via the language-profile registry.

The detection regex matches **closed** comments only — `/* … */`,
`<!-- … -->`, and `// …\n`. An unmatched `/*` or `<!--` is _not_ a
comment: the `/`, `*`, `<`, etc. tokenise as ordinary code. This trades
parser fidelity for graceful degradation under a typo: a forgotten `*/`
surfaces as a small cluster of `extra` marks at the unclosed `/*` (and a
`missing` for the teacher's matching `*/`), instead of having the
unclosed comment swallow the entire rest of the student file from the
diff's view.

`_sm._comment_ranges(text, ext)` and the JS-side `_diffCommentRanges` are
thin wrappers that look up the language profile from the file extension
and delegate to `comment_ranges(profile, text)` (Python:
[lesson_tools/languages/**init**.py](../lesson_tools/languages/__init__.py))
or `commentRangesOf(profile, text)` (JS:
[lesson_tools/languages/profiles.js](../lesson_tools/languages/profiles.js)).
Each language's detect regex and any embedded-tag rules live as data on
the profile JSON ([javascript.json](../lesson_tools/languages/javascript.json),
[css.json](../lesson_tools/languages/css.json),
[html.json](../lesson_tools/languages/html.json),
[python.json](../lesson_tools/languages/python.json),
[plaintext.json](../lesson_tools/languages/plaintext.json)).

Behaviour by extension (preserved exactly through the migration):

- `.css` — only `/* … */` is a comment.
- `.html` / `.htm` — `<!-- … -->` matches everywhere; `/* … */` is a
  comment only inside `<style>…</style>` or `<script>…</script>`; `// …`
  only inside `<script>…</script>`. Embedded tag ranges are computed
  from `embeddedTags` on the HTML profile, tolerating malformed close
  tags (`<\script>`, `<\/script>`, `/script>`) and treating an unclosed
  block as extending to end of file (matching browser behaviour).
- `.js` — all three styles match, no context gating (a quirk of the
  legacy union regex retained for byte parity; HTML-style comments in
  JS files are unusual but possible inside strings).
- Unknown / no extension — falls through to `_FALLBACK_DETECT_RE`
  (Python) / `_DIFF_FALLBACK_DETECT_RE` (JS), the same union pattern.

This means a stray `/* … */` written by a student in HTML body text
(invalid HTML — would render as visible text) shows up in the diff as a
cluster of `extra` marks rather than being silently swallowed as
"comment". Comment-range behaviour is exercised by the language-profile
tests in `lesson_tools/test_languages.py` (e.g. `TestPythonProfile`,
which checks `comment_ranges` / `_comment_ranges` output against fixture
text).

---

## 3. Teacher Reference: From Keylog or Files

### 3.1 Reconstructed from keylog (preferred)

A `HeadlessEditor` replays every keylog event:

```
function replay_with_timestamps(events):
    editor = HeadlessEditor(track_timestamps=true)
    for event in events:
        editor.current_timestamp = event.timestamp
        match event:
            keypress       → translate then insert / delete
            code_insert    → insert text
            cursor_move    → move cursor
            move_to / switch_editor → record file in timeline
    return editor.surviving_with_ts(),     // [(char, ins_ts), …]
           editor.deleted_with_ts()        // [(char, ins_ts, del_ts, seq_idx), …]
```

The reconstructed final text is written to `reconstructed/<name>` (one file per
tab the teacher used, with the main HTML tab named `reconstructed.html`).
These files become the teacher reference passed to every matching method.

### 3.2 Token timeline (`tokens.txt`)

The same surviving-character + deleted-character data drives the
chronological token log:

```
function reconstruct_tokens_from_keylog(events):
    surviving, deleted = replay_with_timestamps_all(events)
    final_text = "".join(c for c,_ in surviving)
    char_ts    = [ts for _,ts in surviving]

    # Comments in final_text are detected with _COMMENT_RE and used only as flags.
    kw_ts         = {}   # token -> [insertion_timestamps]
    kw_ts_comment = {}
    for token_match in _CHAR_TOKEN_RE.finditer(final_text):
        tok = token_match.group()
        end = token_match.end() - 1
        ts  = char_ts[end]
        kw_ts.setdefault(tok, []).append(ts)
        if end_is_inside_comment(end):
            kw_ts_comment.setdefault(tok, []).append(ts)

    # Deleted chars are grouped into contiguous non-newline segments.
    # Tokens from each deleted segment populate removed_kw_ts.
    removed_kw_ts = {}
    for seg in contiguous_deleted_segments(deleted):
        for token_match in _CHAR_TOKEN_RE.finditer(seg.text):
            tok = token_match.group()
            end = token_match.end() - 1
            ins_ts = seg[end].insertion_ts
            del_ts = seg[end].deletion_ts
            removed_kw_ts.setdefault(tok, []).append((ins_ts, del_ts))

    return kw_ts, kw_ts_comment, removed_kw_ts
```

`tokens.txt` records one line per occurrence in chronological order with
`COMMENT` and `REMOVED <del_ts>` flags.

### 3.3 Static teacher files (no keylog)

When no keylog is present (e.g., grading a take-home assignment with a model
solution), the teacher's static source files are used as the reference.
`token_log_mixin._get_teacher_code_files` decides which to use.

A project on disk has this layout:

```
<grading_root>/
  students.csv                — roster shared across all projects under this root
  <category>/
    <project>/
      correct/                — teacher's static reference solution (the `reference_dir`)
      start/                  — optional skeleton students began from; when present it
                                is the reference instead of correct/ (see rule below)
      reconstructed/          — generated from the keylog by `write_keyword_log`,
                                one file per editor tab the teacher used
      students/               — one subfolder per student (real names)
      anon_ids/               — anonymised codes keyed by student id;
                                the view every tool + the pipeline read/write
      anon_names/             — same content keyed by student name; generated by
                                `anonymize.py` for the teacher, but no tool reads it
      <name>.log              — the keylog (`.log`; legacy `.json` still read)
```

`students.csv` lives two levels above `<project>/`
(`current_dir.parent.parent / 'students.csv'` in
[`sim_check.main`](../lesson_tools/utils/sim_check.py)) so a single roster
covers every project in the grading root.

`reconstructed/`, `start/`, and `correct/` are sibling directories. The
selection rule (precedence `reconstructed/` → `start/` → `correct/`):

```
if keylog events are present and <project>/reconstructed/ contains code files:
    use those                              # authoritative — mirrors what the teacher typed
elif <project>/start/ exists and contains code files:
    use all code files in <project>/start/ # the skeleton — correct/ is ignored
else:
    use all code files in <project>/correct/
```

`_get_teacher_code_files` handles the `reconstructed/` step; the static
`start/`-vs-`correct/` choice is centralised in
`CodeSimilarityChecker._effective_reference_dir()` so the diff, the
`run_check` containment similarity, the Excel report, and `lesson_stats`
all resolve to the same folder. The sources are never mixed: when one is
used the others are ignored. The differentiator, timeline, students, and
overview views follow the same precedence on the rendering side (they infer
"no keylog" from the absence of `reconstructed/` files).

### 3.4 Implementation Mapping

| Concept (algorithm)              | Implementation (Python module)                                                                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Teacher reference reconstruction | `_build_file_timeline()`, `_file_at_ts()` — `utils/token_log.py`                                                                                                                            |
| Token timeline                   | `_parse_teacher_tokens()` — `utils/token_log.py`; `reconstruct_tokens_from_keylog_full()` — `utils/similarity_measures.py`                                                                  |
| Ghost stream                     | `_collect_teacher_ghosts()` — `utils/token_log_leo.py`                                                                                                                                      |
| Per-token matching (LEO core)    | `_compute_per_token_matching()` — `utils/token_log_leo.py`                                                                                                                                  |
| Mark factories                   | `_missing_mark`, `_extra_mark`, `_comment_pos_mark` — `utils/token_log_marks.py`                                                                                                            |
| Curated schema                   | `_validate_curated_schema` — `utils/token_log_curated.py`                                                                                                                                   |
| Star post-processing             | `_add_log_metadata`, `_apply_ghost_extra_promotion`, `_apply_swap_pairing_to_marks`, `_apply_insert_at_to_unpaired_missings`, `_refresh_missing_timestamps` — `utils/token_log_starpass.py` |

`utils/token_log.py` is the public entry point and re-exports every symbol
from `token_log_leo.py`, `token_log_marks.py`, `token_log_curated.py`, and
`token_log_starpass.py`, so existing `from utils.token_log import _foo` import
paths still resolve unchanged.

---

## 4. Common Helpers Used by All Methods

All methods share the helpers re-exported by `utils/token_log.py` (their physical homes are the sibling `token_log_*` modules — see §3.4):

| Helper                          | Purpose                                                                                                                                                                                                         |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_match_files_by_name_then_ext` | Pair teacher and student files by filename, fallback by extension                                                                                                                                               |
| `_read_text_normalized`         | utf-8 read with `errors='ignore'`, normalise `\r\n` → `\n`                                                                                                                                                      |
| `_split_tokens_by_comment`      | Tokenize a file into `(non_comment, comment)` lists of `(pos, token)`                                                                                                                                           |
| `_build_token_position_index`   | Build `{token: [positions]}` dict + total-token count for bisect lookups                                                                                                                                        |
| `_missing_mark`                 | `{token, label='missing', start, end, _tok_idx}` — `_tok_idx` (via `bisect.bisect_left` on the position index) is needed by `_add_log_metadata` to map missing marks back to chronological insertion timestamps |
| `_extra_mark`                   | `{token, label='extra', start, end}`                                                                                                                                                                            |
| `_comment_pos_mark`             | `{token, label='comment', start, end}`                                                                                                                                                                          |
| `_line_token_marks`             | All token marks for one line, given an offset and a side (teacher/student)                                                                                                                                      |
| `_diff_line_pair_tokens`        | Token-level difflib diff between two paired lines                                                                                                                                                               |
| `_add_unpaired_teacher_line`    | Append `[t_i, None]` to alignment, line + per-token missing marks                                                                                                                                               |
| `_add_unpaired_student_line`    | Append `[None, s_j]` to alignment, line + per-token extra marks                                                                                                                                                 |
| `_add_paired_line_block`        | Pair-up `n_paired` lines, run `_diff_line_pair_tokens` on each                                                                                                                                                  |
| `_add_replace_block`            | Combo of `_add_paired_line_block` + leftover unpaired loops                                                                                                                                                     |
| `_finalize_per_file_diff`       | Assemble per-file results into the canonical 6-tuple `(t_marks, s_marks, score, alignments, line_marks, n_total)`. LEO's `_build_leo_diff_marks` returns this 6-tuple plus a 7th element, `leo_assignments`.    |

Every matching method follows the same skeleton:

```
def _build_<method>_diff_marks(teacher_files, student_files):
    n_total = 0
    per_file_results = []
    for t_name, t_path, s_path in _match_files_by_name_then_ext(...):
        t_text = _read_text_normalized(t_path)
        s_text = _read_text_normalized(s_path) if s_path else ''
        # ── method-specific matching here ──
        per_file_results.append((fname, s_fname,
                                  t_marks, s_marks,
                                  t_line_ms, s_line_ms,
                                  alignment))
    return _finalize_per_file_diff(per_file_results, n_total)
```

Returning a uniform 6-tuple lets one driver
(`token_log_mixin._write_alt_diff_marks`) wire any of them into the grading
pipeline.

---

## 5. Per-Token Methods (LEO, LCS)

These operate on **token sequences with comments excluded**. Each
non-comment token gets one of: `None` (matched), `missing` (teacher only) or
`extra` (student only). Comment tokens get the `comment` label automatically
(no matching is attempted on them).

### 5.1 LEO — Context-Cosine Hungarian

LEO is the default. It matches **per token type** by solving a maximum-weight
bipartite assignment over cosine similarity of the surrounding context. When a
keylog is supplied, ghost teacher instances (typed-and-deleted occurrences) are
included as additional teacher columns in the same Hungarian, so the optimal
real/ghost split is decided in one pass instead of by a greedy base step plus a
post-pass (see §7 for why this matters).

```
def _compute_per_token_matching(teacher_files, student_files, k, teacher_ghosts=None):
    teacher_occs, teacher_counts = collect_occurrences(teacher_files)
    student_occs, student_counts = collect_occurrences(student_files)

    teacher_seq = [oc.token for oc in teacher_occs if not oc.is_comment]
    student_seq = [oc.token for oc in student_occs if not oc.is_comment]

    # When ghosts are present, build the augmented sequence with ghost
    # tokens spliced in at their original keylog positions. The augmented
    # sequence is what context vectors are computed on; ghosts contribute
    # to context but are tracked separately for matching.
    if teacher_ghosts:
        teacher_seq_aug, seq_idx_to_aug, ghost_instances = _build_teacher_seq_aug(...)
        teacher_match_seq = [t if str else t[0] for t in teacher_seq_aug]
    else:
        teacher_match_seq = teacher_seq
        seq_idx_to_aug = identity
        ghost_instances = []

    teacher_colors = init from teacher_counts (all None)
    student_colors = init from student_counts (all None)

    for tok in {teacher tokens} ∪ {student tokens}:
        t_out   = teacher non-comment occurrences of tok
        t_ghost = ghost instances of tok        # may be empty
        s_out   = student non-comment occurrences of tok

        # Joint Hungarian over real + ghost teacher columns.
        n_real   = len(t_out)
        t_all    = [seq_idx_to_aug[t.seq_idx] for t in t_out] + \
                   [g.seq_idx_aug             for g in t_ghost]

        # combined_score is a weighted blend of two cosines per pair:
        #   cos_left  — cosine of the k tokens BEFORE the anchor only
        #   cos_right — cosine of the k tokens AFTER the anchor only
        # Heavy weight (0.7) on max(cos_left, cos_right) means a
        # near-perfect match on EITHER side dominates the score; the
        # 0.3 weight on min(cos_left, cos_right) ensures the weak side
        # has to pull its weight too — fully one-sided "boilerplate"
        # matches (one side perfect, other ≈ 0.3) get pulled below
        # threshold.
        sim[i][j] = max(
            combined_score(student_seq, s_out[i].seq_idx,
                            teacher_match_seq, t_all[j], k),    # with-ghosts
            combined_score(student_seq, s_out[i].seq_idx,
                            stripped_seq, stripped_idx_of(t_all[j]), k),
                                                                # stripped (real cols only)
        )
            where:
              combined_score(s_seq, sp, t_seq, tp, k) =
                  0.3 * min(cos_left, cos_right)
                  + 0.7 * max(cos_left, cos_right)

              cos_left  = cosine(ctx_left (s_seq, sp, k), ctx_left (t_seq, tp, k))
              cos_right = cosine(ctx_right(s_seq, sp, k), ctx_right(t_seq, tp, k))

              ctx_left(seq, p, k) is a Counter over the k tokens
              [p-k..p-1]: vec[seq[i]] += 1. There is no IDF weighting
              and no distance decay — every neighbour inside the
              window contributes equally. The window is reproducible
              in the differentiator tooltip from `leo_assignments.k`
              plus the `teacher_seq` / `student_seq` arrays.
              ctx_right is the symmetric construction over [p+1..p+k].

              stripped_seq is teacher_match_seq with ghost positions
              removed; the stripped variant anchors the window at the
              stripped index, extending past where ghosts were dropped
              until k surviving tokens are gathered on each side or the
              document edge is hit.

              The stripped (second) combined_score is computed only
              for REAL teacher columns. Ghost teacher columns get
              cos_with alone — see §11 for why crediting cos_stripped
              on a ghost column would invert the intended ghost_extra
              signal.
            (default: k = 10)

        Taking the max of the two cosine variants on real columns
        means a student token wins the real-pair match either way: if
        the student kept the deletion (their context contains ghost-
        equivalent tokens) they match the with-ghosts teacher context;
        if they followed the teacher and removed it, they match the
        stripped context.

        pairs = hungarian_max(sim)            # maximises Σ similarity

        # Split by column kind. Real-column pairs become regular matches;
        # ghost-column pairs surviving cosine ≥ _CONTEXT_MATCH_THRESHOLD (0.8)
        # are recorded so the star post-pass can relabel them as ghost_extra.
        real_pairs  = [(i, tj)          for i, tj in pairs if tj <  n_real]
        ghost_pairs = [(i, tj - n_real) for i, tj in pairs if tj >= n_real
                                                       and sim[i][tj] >= _CONTEXT_MATCH_THRESHOLD]

        matched_real_t = {tj for _, tj in real_pairs}
        matched_real_s = {i  for i, _  in real_pairs}
        for j ∉ matched_real_t: teacher_colors[...][file_idx] = 'missing'
        for i ∉ matched_real_s: student_colors[...][file_idx] = 'extra'

        # Each pair (real or ghost) ships its counterpart's index as
        # `match_idx` in leo_assignments.tokens[tok].{teacher,student}.
        # Students paired with ghosts retain label='extra' here — they
        # will be relabelled to 'ghost_extra' by the star post-pass, which
        # treats a pre-set match_idx pointing to a ghost as authoritative
        # and skips its own Hungarian for that pair.

        # Comment occurrences are labelled 'comment' on both sides.

    return teacher_colors, student_colors, n_total, n_missing
```

`_build_leo_diff_marks` is a thin wrapper: call `_compute_per_token_matching`,
convert the colour map to position marks, and compute the score
`(n_total − n_missing) / n_total · 100`. Per-token methods (LEO, LCS) do
not embed `alignments` or `line_marks` — those are line-level structures and
the differentiator borrows them from a loaded line-based method (Git)
via `_borrowedAlignments()` for the side-by-side aligned view.

### 5.2 LCS — Difflib SequenceMatcher on Tokens

```
def _lcs_opcodes(a, b):
    return difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes()
```

Note: Python's `difflib.SequenceMatcher` is **Ratcliff/Obershelp** (longest
common substring + recursive expansion), not strict longest-common-
subsequence. The two often agree but Ratcliff/Obershelp can favour different
alignments when there are repeated subsequences.

`_build_lcs_token_diff_marks` calls a shared driver
`_build_token_seq_diff_marks(…, _lcs_opcodes)`:

```
def _build_token_seq_diff_marks(teacher_files, student_files, opcodes_fn):
    for each (t_file, s_file) pair:
        t_text = _read_text_normalized(t_path)
        s_text = _read_text_normalized(s_path)
        t_nc, t_cm = _split_tokens_by_comment(t_text, ext)
        s_nc, s_cm = _split_tokens_by_comment(s_text, ext)
        tok_all_positions, _ = _build_token_position_index(t_text)

        t_seq = [tok for _,tok in t_nc]
        s_seq = [tok for _,tok in s_nc]
        n_total += len(t_seq)

        for (tag, i1, i2, j1, j2) in opcodes_fn(t_seq, s_seq):
            if tag in ('delete','replace'):
                for i in range(i1, i2):
                    pos, tok = t_nc[i]
                    t_marks.append(_missing_mark(pos, tok, tok_all_positions))
                    n_missing += 1
            if tag in ('insert','replace'):
                for j in range(j1, j2):
                    pos, tok = s_nc[j]
                    s_marks.append(_extra_mark(pos, tok))

        for (pos, tok) in t_cm:  t_marks.append(_comment_pos_mark(pos, tok))
        for (pos, tok) in s_cm:  s_marks.append(_comment_pos_mark(pos, tok))

    score = (n_total − n_missing) / n_total · 100
    return ...   # per-token methods don't embed alignments/line_marks
```

---

## 6. Per-Line Method (Git)

The line-based method aligns whole lines first, then refines within each
paired line. **Comments are blanked first** so
the diff sees `code; // foo` and `code; // bar` as the same `code;`:

```
def _build_<line>_diff_marks(teacher_files, student_files):
    for each (t_file, s_file) pair:
        t_orig = _read_text_normalized(t_path)
        s_orig = _read_text_normalized(s_path)
        # Replace every char inside a comment range with ' ', preserving
        # newlines so character offsets and line numbers are unchanged.
        t_text = _sm.blank_comments(t_orig, ext)
        s_text = _sm.blank_comments(s_orig, ext)
        t_lines, s_lines = t_text.splitlines(), s_text.splitlines()
        t_starts, s_starts = _line_start_offsets(t_text), _line_start_offsets(s_text)
        tok_all_positions, file_n = _build_token_position_index(t_text)
        n_total += file_n

        # Method-specific: produce line-level opcodes / hunks
        for (tag, i1, i2, j1, j2) in line_ops:
            if tag == 'equal':    extend alignment with [i1+k, j1+k] for k in range(i2-i1)
            elif tag == 'delete': for i in i1..i2: _add_unpaired_teacher_line(i)
            elif tag == 'insert': for j in j1..j2: _add_unpaired_student_line(j)
            elif tag == 'replace':
                _add_replace_block(i1, i2-i1, j1, j2-j1, tok_all_positions)
                # internally: pair up min(n_t,n_s) lines, run token-level
                # difflib on each pair via _diff_line_pair_tokens; the leftover
                # unpaired teacher/student lines get the same per-line mark
                # treatment as 'delete' / 'insert'.

        # Append `comment` marks for every comment token in the *original*
        # text, so the differentiator can show comments green even though
        # they didn't participate in the diff.
        _, t_cm = _split_tokens_by_comment(t_orig, ext)
        _, s_cm = _split_tokens_by_comment(s_orig, ext)
        for (pos, tok) in t_cm: t_marks.append(_comment_pos_mark(pos, tok))
        for (pos, tok) in s_cm: s_marks.append(_comment_pos_mark(pos, tok))

    return _finalize_per_file_diff(per_file_results, n_total)
```

The skeleton lives in a single
`_build_line_diff_marks(teacher_files, student_files, align_fn)` driver: the
`for (tag, …) in line_ops` step above is the only per-method part, supplied as
an `align_fn` callback (`_git_align`) that fills the alignment + line/token
marks in place — the same pattern `_build_token_seq_diff_marks` uses with
`_lcs_opcodes`.

### 6.1 Git — `git diff --no-index`

```
result = subprocess.run([
    'git', 'diff', '--no-index', '--unified=0', '-w',
    str(t_path), str(s_path),
], …)
hunks = parse(@@ headers from result.stdout)
# (i1, ic, j1, jc) per hunk → re-assemble into difflib-style opcodes
# Equal lines between hunks fill in the alignment; each hunk becomes an
# 'equal' run + a 'replace' block (degenerates to 'delete' or 'insert' when
# one side has zero lines).
```

`-w` makes git ignore whitespace-only differences at the line level. Two
lines that strip down to the same content under `-w` (e.g. teacher
`1 fraction` vs student `1fraction`) end up as an "equal" pair, but their
token streams still differ — so the token-level diff (`_diff_line_pair_tokens`)
runs on every paired line, not only on `replace` blocks, to catch those.

After the last hunk, any leftover paired lines run the same token-level
diff; lines on only one side become unpaired entries and get
`_add_unpaired_teacher_line` / `_add_unpaired_student_line` marks like a
`delete` / `insert` opcode would produce.

### 6.2 What happens inside a paired line

When Git pairs two lines that are not byte-identical, `_add_paired_line_block`
runs **token-level difflib** within the pair:

```
def _diff_line_pair_tokens(t_line, t_off, s_line, s_off, tok_all_positions):
    t_tok_ms = list(_TOK_RE.finditer(t_line))
    s_tok_ms = list(_TOK_RE.finditer(s_line))
    sm = difflib.SequenceMatcher(None,
                                  [m.group() for m in t_tok_ms],
                                  [m.group() for m in s_tok_ms],
                                  autojunk=False)
    for (tag, i1, i2, j1, j2) in sm.get_opcodes():
        if tag in ('delete','replace'):
            for ti in i1..i2:
                t_marks.append(_missing_mark(t_off + t_tok_ms[ti].start(), …))
        if tag in ('insert','replace'):
            for tj in j1..j2:
                s_marks.append(_extra_mark(s_off + s_tok_ms[tj].start(), …))
```

This refines the line-level diff with per-token marks where the lines mostly
agree. Because the per-line builder blanks out comments before splitting into
lines (see top of §6), the regex `_TOK_RE.finditer(t_line)` here only emits
non-comment tokens — the spaces produced by `blank_comments` aren't matched
by the token regex. Comment tokens are appended separately as `comment`
marks after the diff completes.

### 6.3 Line-level marks

Git produces both **per-token marks** (red/blue letters inside lines)
_and_ **per-line marks** (light-red / light-blue line backgrounds), via
`_make_line_mark`. The differentiator displays them together: a missing line
gets a red background and red letters for every token on it.

---

## 7. The Star Variant: Ghost-Token Promotion

For each method, the star variant runs the base algorithm and then promotes
a subset of `extra` marks to `ghost_extra`. The promotion criterion: the
student `extra`'s context resembles the context of a token the teacher
typed and later deleted.

This is pedagogically important — it identifies cases where the student
explored or made the same mistake / edit the teacher demonstrated and corrected.

### 7.1 LEO-style cosine Hungarian (used for every star variant)

Every star variant — `leo*`, `lcs*`, `git*` — runs the same
post-pass: [`_apply_ghost_extra_promotion`](../lesson_tools/utils/token_log.py)
solves a per-token Hungarian assignment between student `extra` marks and
ghost teacher instances, scoring by the same cosine-context function used in
the main LEO matching (a uniform ±k Counter, no distance decay — the
post-pass does _not_ apply the with-ghosts/ghost-stripped `max` shaping
that Phase 1 uses, since the only consumers of Phase 2 are non-LEO bases
which never carry a stripped view to begin with). When a pair's cosine
`>= _CONTEXT_MATCH_THRESHOLD` (currently `0.8`), the student mark is promoted
to `ghost_extra` and the ghost's `del_ts` is written as `removal_ts` on the
mark.

**LEO short-circuit.** For LEO, the base step in `_compute_per_token_matching`
already runs a _joint_ Hungarian over real + ghost teacher columns (see §5.1),
so it can pre-set `match_idx` on student instances to point at a ghost
teacher when that yields a globally-better assignment. The post-pass
detects these pre-set ghost matches (any extra whose `match_idx` references
a teacher entry with `ghost: true`) and **skips its own Hungarian for
those**, simply relabelling them and copying `removal_ts`. It then runs the
Hungarian only for the remaining unpaired extras and ghosts. For
`lcs*/git*` no extras carry pre-set ghost match_idx, so the whole
post-pass falls through to the original Hungarian path.

```
def _apply_ghost_extra_promotion(diff_marks, events):
    la = diff_marks['leo_assignments']      # built earlier or by post-pass
    teacher_match_seq = la['teacher_seq_aug-flattened']
    student_seq       = la['student_seq']

    for tok, td in la['tokens'].items():
        extras = [(i, s) for i, s in enumerate(td['student'])
                          if s.get('label') == 'extra']
        ghosts = [(j, t) for j, t in enumerate(td['teacher'])
                          if t.get('ghost')]
        if not extras or not ghosts: continue

        # 1. Honor pre-existing ghost matches (LEO base path).
        pre_matched_ghost_local = set()
        unmatched_extras = []
        for i, s in extras:
            midx = s.get('match_idx')
            if midx is set and td['teacher'][midx].get('ghost'):
                promote s → 'ghost_extra' with removal_ts from teacher[midx].del_ts
                pre_matched_ghost_local.add(local index of midx in `ghosts`)
            else:
                unmatched_extras.append((i, s))

        # 2. Hungarian over the remainder (lcs*/git* path).
        remaining_ghosts = [g for g in ghosts if local idx ∉ pre_matched_ghost_local]
        if unmatched_extras and remaining_ghosts:
            sim = [[cos(context(student_seq,       s.seq_idx),
                       context(teacher_match_seq, g.seq_idx_aug))
                    for g in remaining_ghosts] for s in unmatched_extras]
            for s_local, g_local in hungarian_max(sim):
                if sim[s_local][g_local] < _CONTEXT_MATCH_THRESHOLD: continue
                promote unmatched_extras[s_local] → 'ghost_extra'
                    with removal_ts = ts_to_local(remaining_ghosts[g_local].del_ts)
```

Non-LEO base methods (LCS/Git) don't produce `leo_assignments`
themselves, so [`_add_log_metadata`](../lesson_tools/utils/token_log.py)
calls [`_build_assignments_for_post_pass`](../lesson_tools/utils/token_log.py)
first to synthesize them from the existing diff_marks: it scans
teacher_files / student_files for `missing` and `extra` labels and wraps
each non-comment teacher/student token into the shape
`leo_assignments.tokens[tok].{teacher,student}` expects, augmenting the
teacher list with the ghost stream (same `_build_teacher_seq_aug` helper
the LEO base path uses). Synthesised `leo_assignments` never carry
ghost-pointing `match_idx` on student instances, so the post-pass falls
through to its Hungarian step for those methods.

**Why the joint Hungarian for LEO.** The two-stage shape (greedy
real-only base, then ghost post-pass) is suboptimal for LEO because the
post-pass can't reassign a student instance the base step has already
locked in. Concrete case: teacher had `width: 200px;` typed-and-deleted,
final code is `height: 200px;`; student typed both `width: 200px;` and
`height: 200px;`. Greedy LEO pairs the _first_ student `200px` with the
real teacher `200px` (its cosine to the real is fractionally higher),
leaving the _second_ student `200px` to be promoted to `ghost_extra`
against the ghost — but contextually the _first_ student `200px` is the
much better ghost match (it sits in `width:` context, identical to the
ghost's own context). The joint Hungarian finds the globally-optimal
`first→ghost, second→real` assignment instead of the locally-greedy one.

### 7.2 Star score adjustment

After promotion, the star variant recomputes the score with an extra
penalty for each promoted token and for each unpaired student `extra`
(an `extra` with no `paired_with` swap-pair partner — i.e., a deletion
the student made beyond what the teacher typed, that no swap accounts
for; extras with `move_to` are also counted, since a curator-set
relocation still represents a place the student got wrong):

```
score* = max(0, (n_found_nc_star − n_ghost_extra_count − n_extra_unpaired_count) / teacher_total_nc · 100)
```

`teacher_total_nc` is the count of non-comment teacher tokens supplied by
the base method; `n_found_nc_star = teacher_total_nc − n_missing_nc_star`
(where `n_missing_nc_star` recounts the missing marks after the star pass,
in case any teacher missing marks moved). This makes star a
strictly-not-better score: an `ghost_extra` is treated as costing as much
as a missing token, and an unpaired `extra` (any extra not part of a swap
pair — including those with `move_to`) costs the same. Swap-paired extras
(`paired_with`) are the only kind that escape the penalty, because the
matched teacher `missing` already accounts for the same fix. The intent is
to make students pay attention both to debugging steps and to extra
unrelated tokens left behind.

### 7.3 Swap pairing on LEO leftovers

After LEO finishes its base matching, a separate post-pass
[`_apply_swap_pairing_to_marks`](../lesson_tools/utils/token_log.py)
links residual `missing` ↔ `extra` marks per file using a blended
**context cosine + token-text-similarity** score:

```
score = combined_context_cos(missing, extra)
      + _SWAP_TOKEN_SIM_WEIGHT * SequenceMatcher(missing.token, extra.token).ratio()
```

with `_SWAP_TOKEN_SIM_WEIGHT = 0.2`. The cosine is the same uniform ±k
context vector LEO uses elsewhere; the token-text bonus is a small
additive boost so that typo pairs (e.g. `border` ↔ `boder`,
`Karelia` ↔ `karlia`) that have identical neighbourhoods but
near-borderline cosine still clear the threshold. Pure-text similarity
alone is intentionally not enough — context still has to look like a
valid substitution slot.

Pairing is greedy-best rather than Hungarian: build all candidate
(missing, extra) pairs whose blended `score >= _CONTEXT_MATCH_THRESHOLD`
(the same `0.8` cutoff used for ghost promotion — both sites ask the same
question, "is this pair similar enough to claim usage equivalence?"),
sort descending by score, and walk the list consuming each side at most
once. This produces a one-to-one mapping that picks the strongest pairs
first, lets borderline pairs be ignored, and is order-independent.

```
def _apply_swap_pairing_to_marks(t_marks, s_marks, t_files, s_files):
    clear all existing paired_with annotations           # idempotent

    for each (t_file, s_file) pair:
        missing = [m for m in t_marks[t_file] if m.label == 'missing']
        extras  = [e for e in s_marks[s_file] if e.label == 'extra']
        if not missing or not extras: continue

        m_ctx = [context_vector(t_seq, missing[i].seq_idx, k) ...]
        e_ctx = [context_vector(s_seq, extras[j].seq_idx, k) ...]

        candidates = []
        for i, m in enumerate(missing):
            for j, e in enumerate(extras):
                cos = combined_context_score(e_ctx[j], m_ctx[i])
                tok_sim = (1.0 if m.token == e.token
                           else SequenceMatcher(None, m.token, e.token).ratio())
                score = cos + _SWAP_TOKEN_SIM_WEIGHT * tok_sim
                if score >= _CONTEXT_MATCH_THRESHOLD:
                    candidates.append((score, i, j))
        candidates.sort(reverse=True)

        for score, i, j in candidates:
            if i in used_m or j in used_e: continue
            used_m.add(i); used_e.add(j)
            annotate paired_with on both sides
```

Empirically the bonus weight `0.2` improves Pair F1 across
chess/wall/js/sorting (mean +0.009, with the biggest lifts on js
+0.022 and sorting +0.012 — the lessons with the most typo-style
edits), without changing mark-level F1 (the bonus only re-orders
swap candidates; it doesn't affect which marks exist).

Annotated marks gain a
`paired_with: {file, start, end, token, label}` field on **both**
sides. The annotation is informational only — labels stay
`missing`/`extra`, the score is unaffected. The differentiator
renders a dotted underline on paired marks and highlights the
partner span when one is clicked.

The post-pass runs once at the end of `_build_leo_diff_marks` (so
plain LEO has swap pairs even without a keylog) and a second time
inside `_add_log_metadata` after `_apply_ghost_extra_promotion`
(so any `extra` promoted to `ghost_extra` drops out of swap pairing
— ghost explanation supersedes swap explanation, and the second
pass re-pairs the remaining `extra` marks). Both calls are
idempotent: any pre-existing `paired_with` field is cleared first.

### 7.4 Insert anchors for unpaired missings

Each finding implies an action: `ghost_extra` and unpaired `extra`
mean _delete_; `paired_with` (an `extra`↔`missing` swap) means
_replace student's token with teacher's_. The remaining case —
unpaired `missing` — implies _insert_, but on its own doesn't say
**where** in the student file to insert.

`_apply_insert_at_to_unpaired_missings` runs immediately after
`_apply_swap_pairing_to_marks` (both call sites) and stamps each
unpaired missing with an `insert_at: {file, pos}` field, where
`pos` is a character offset in the student file such that
`student_text[:pos] + token + student_text[pos:]` is the
locally-correct fix. Paired missings (those with `paired_with`)
have any stale `insert_at` cleared because the pair already encodes
a replace action.

For LCS and Git, the base method already knows the right
anchor from its own alignment, so it stamps a **method-native**
anchor on every missing mark at build time (in an internal field
`_native_insert_at` that is stripped before write). The post-pass
copies it into `insert_at` for unpaired missings:

| Method | Native anchor source                                                                                                                                                                                                                                       |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lcs`  | For a `delete (i1,i2,j1,j2)` or `replace (i1,i2,j1,j2)` opcode, every teacher token in `[i1,i2)` anchors at `s_nc[j1].start_char`.                                                                                                                         |
| `git`  | Within a paired-but-replaced line, `_diff_line_pair_tokens` uses the same per-line `j1` anchor. For tokens on an unpaired teacher line, the anchor is the start of the next paired student line in the file alignment (or end-of-file if there isn't one). |

LEO has no native concept of an insert anchor — its matching is
per-token-type, not order-preserving — so LEO marks fall through
to a heuristic that walks matched-only sequences:

```
for each (t_file, s_file) pair:
    missing_pos  = {start of every missing mark in t_file}
    skip_s_pos   = {start of every extra/ghost_extra mark in s_file}

    matched_t = [teacher_idx ... where token's pos ∉ missing_pos]
    matched_s = [(pos, tok)  ... where tok's pos    ∉ skip_s_pos]

    for each unpaired missing m at teacher idx t_idx without a native anchor:
        prev_k = largest k such that matched_t[k] < t_idx
        if prev_k < 0:               insert_pos = 0
        elif prev_k < len(matched_s): insert_pos = matched_s[prev_k] end
        else:                        insert_pos = len(student_text)
        m.insert_at = {file: s_file, pos: insert_pos}
```

The matched-only sequences are 1-1 in order (Hungarian-matched
counts are equal across both sides), so walking by index gives the
right student anchor.

The pass is idempotent: at the start it resets `insert_at` on every
missing — paired ones get nothing, unpaired ones with a native
anchor get the native anchor restored, and unpaired ones without
fall through to the heuristic.

After the native-anchor copy and the matched-walk heuristic, any
unpaired missing that still lacks an `insert_at` (e.g. a mark whose
token position isn't in the matched sequence, or one in a teacher
file with no student counterpart) is anchored at end-of-file. This
final fallback prefers the **name/ext-matched student file** for the
teacher file the mark belongs to, and only falls back to the first
student file (alphabetical) when that teacher file has no matched
student — so a teacher file's leftover missings don't get dumped
into an unrelated student file.

**Why pure cosine, no text similarity?** The point is to surface
_positional substitutions_ — places where the student wrote a
different token in the same code spot the teacher wrote something
else. Edit-distance is misleading: it would over-credit `gray ↔ grey`
just because the strings are similar, and under-credit
`getElementsByClassName ↔ getElementById` even though one is clearly
a stand-in for the other. Context-cosine answers the substitution
question directly; classic typos still get caught when they share a
context (and most do).

## 8. From Marks to JSON

All methods produce the same per-file output shape:

```json
{
  "token_matching": "leo_star",
  "score": 97.3,
  "teacher_files": {
    "reconstructed.html": [
      { "token": "border", "label": "missing", "start": 1024, "end": 1030,
        "timestamp": "12:34:56",
        "paired_with": { "file": "index.html", "start": 1612, "end": 1616,
                          "token": "boder", "label": "extra" } },
      { "token": ";", "label": "missing", "start": 857, "end": 858,
        "timestamp": "12:35:01",
        "insert_at": { "file": "index.html", "pos": 1290 } }
    ]
  },
  "student_files": {
    "index.html": [
      { "token": "background", "label": "ghost_extra", "start": 800, "end": 810,
        "removal_ts": "12:56:57" },
      { "token": "color", "label": "extra", "start": 1450, "end": 1455,
        "move_to": { "file": "index.html", "pos": 980 } }
    ]
  },
  "alignments":  { "index.html": [[0,0], [1,1], [2, null], …] },
  "line_marks":  { "teacher_files": { "index.html": [{label, start, end}] },
                   "student_files": { … } }
}
```

**Offset units are UTF-16 code units, not Unicode code points.** Every
`start` / `end` (and `insert_at.pos` / `move_to.pos`, and `paired_with`
`start` / `end`) is an offset into the file as the browser indexes it — a
JS string is UTF-16, so an astral character (e.g. the motorcycle emoji
🏍️ = `U+1F3CD` + `U+FE0F`, where `U+1F3CD` is a surrogate pair) counts as
**two** units, not one. LEO produces these directly in
`_colors_to_position_marks` (it builds a per-file `_build_utf16_map` and
looks each occurrence's code-point position up through it). The line/token
methods (LCS, Git) compute raw **code-point** offsets while
building marks, then `_remap_marks_to_utf16` (in `token_log.py`, called from
`_write_alt_diff_marks` for those two methods only) shifts every offset
through the same map just before the JSON is written — files with no astral
characters are a no-op. Ghost references (`paired_with.ghost`) and
`teacher_ghosts` blob positions live in the reconstructed-with-ghosts view
rather than a real file, so the remap leaves them alone. Without this, every
mark after an emoji would be off by one unit per astral character and the
differentiator's highlight would drift (it slices the raw file by these
offsets).

`alignments` and `line_marks` exist **only for the line-based method (Git)**.
Per-token methods (LEO, LCS) and curated (`ideal`/`minimal`) files omit them; the
differentiator borrows them from any loaded line-based method via
`_borrowedAlignments()` to drive the side-by-side aligned view. The aligned
view itself can also be toggled off in the differentiator (Padding button), in
which case both columns render flat without spacers.

`timestamp` is added to `missing` marks **only when a keylog is available**:
`_add_log_metadata` matches each missing mark to its chronological insertion
timestamp using `_tok_idx` (the index of this occurrence among all
same-named tokens in the teacher file, computed via
`bisect.bisect_left(positions, mark.start)`).

`removal_ts` is added to `ghost_extra` marks **only when a keylog is
available**: when the post-hoc ghost-extra promotion step promotes an
`extra` to `ghost_extra` it carries through the matched ghost's `del_ts` (the wall-clock
moment the teacher deleted the corresponding occurrence) and writes it as
an `HH:MM:SS` string on the mark. Since a token can be removed multiple
times by the teacher, this is per-mark — each `ghost_extra` carries the
timestamp of the _specific_ deletion it was matched to.

`insert_at: {file, pos}` is added to **unpaired** `missing` marks
(i.e., those without `paired_with`) by `_apply_insert_at_to_unpaired_missings`.
`pos` is the character offset in the named student file at which the token
should be inserted to fix the diff (`student_text[:pos] + token +
student_text[pos:]`). Paired missings deliberately omit it — their
`paired_with` already encodes the replace action. See §7.4.

`move_to: {file, pos}` is the student-side mirror of `insert_at`. It
appears only on `extra` marks and is **curator-only** (no algorithmic
method emits it) — set inside the curated editor
(`differentiator/curated*.js`) when the
curator decides an extra token is in the wrong place rather than
genuinely surplus. Applying the diff deletes the token from
`[start, end]` and re-inserts the same token at `move_to.pos` in
`move_to.file`. `paired_with` and `move_to` are mutually exclusive on
a single mark; the validator in `_validate_curated_schema` rejects
combinations.

`token` may be **whitespace** (spaces, tabs, newlines). The schema
imposes no content restriction beyond `text[start:end] == token`.
Whitespace marks are emitted only by the curator (no algorithmic
method emits them, since the tokenizer regex `[a-zA-Z0-9]+|[^\s]`
strips whitespace), and let the curator handle "missing space between
tokens" (teacher-side `missing` whitespace with `insert_at`) or
"extra space the student added" (student-side `extra` whitespace).
The differentiator activates them via drag-select on a pure-whitespace
range followed by `e`/`m`/`i`.

`_strip_internal_fields` removes `_tok_idx` and `_native_insert_at`
before the JSON is written — both are internal handles
(`_tok_idx` is the bisect index used by `_add_log_metadata`,
`_native_insert_at` is the method-native anchor that the
insert-at post-pass copies into `insert_at`), not part of the
public schema.

For the LEO method, `leo_assignments.tokens[token]` carries one entry per
teacher and student instance. Matched (label-less) instances also include
`match_idx` — the row's pair-mate index in the other side's list — so the
differentiator tooltip can locate the matched counterpart.

When the keylog is available, `_build_leo_diff_marks` builds an augmented
teacher token sequence — the surviving teacher tokens interleaved with
deletion-ghost tokens (sorted by file then char position) — and uses it
for the cosine matching itself. Each teacher token's context window now
includes nearby deleted text, so a student who kept material the teacher
later removed (e.g. an `onclick="handleClick(this);"` attribute the
teacher demonstrated and then deleted) gets a similarity boost on tokens
near that material, which usually flips the Hungarian assignment to the
"right" student instance.

The augmented sequence is shipped as `leo_assignments.teacher_seq_aug` —
surviving entries are plain token strings; ghost entries are 1-element
arrays `[token_text]`. Each teacher instance in `tokens[*].teacher` gets
a `seq_idx_aug` field pointing into this augmented sequence so the
differentiator's tooltip context window shows the same neighbours used by
the matching (ghost tokens rendered in italic gray).

The student side stays surviving-only — there's no equivalent ghost
stream for student deletions, so augmenting student context would
introduce asymmetry the cosine can't correct.

`teacher_ghosts: {[file]: [{pos, text, ins_ts, del_ts}]}` is an optional
top-level field on LEO/LEO\* JSON. It carries deletion ghosts (text the
teacher typed and later removed) so the differentiator can splice them into
the teacher pane in lighter gray. Placement is anchor-aware: each char
records the named anchor it was following at insertion time
(`HeadlessEditor._idx_to_anchor`), and ghosts are placed by finding the
closest left-neighbour surviving char _typed at the same anchor_. When a
ghost has no same-anchor surviving sibling it falls back to the anchor's
final position in the surviving doc, then to the cross-anchor idx
neighbour, then to position 0. This matches the way lessons are authored
— teachers jump between anchors, type, sometimes delete and retry — so
ghosts visually surface where they were typed instead of next to whatever
surviving char happens to share their global insertion idx.

Two normalisation passes keep the rendered output readable:

1. **Auto-dedent suppression.** `_auto_dedent` (the indent characters the
   editor strips when you type `}`/`)`/`]`/`</`) records its removals in
   `_deleted_chars` for the existing token-ghost-context machinery, but
   their idxs are also added to `_auto_dedent_idxs` and skipped during
   ghost placement. Without this, every closing bracket would emit
   spurious whitespace ghosts that visually disrupt indentation.
2. **Per-blob cleanup.** After grouping, ghost blobs that are pure
   whitespace are dropped (auto-indent leftovers), and a blob anchored
   to the start of a line (i.e. preceded by `\n` in the surviving text)
   that doesn't already end with `\n` gets one appended — so a deleted
   full line shows as a complete inline strike instead of running into
   the surviving line that follows it.

### 8.1 Curated files (hand-curated)

`diff_marks_ideal.json` (the recommended-fix list) and
`diff_marks_minimal.json` (the minimum-fix list) follow the same
per-mark schema as the algorithmic methods but are produced and edited
by hand in the differentiator (Ideal/Minimal modes, implemented in
`differentiator/curated*.js`). The curator's job is to label every
divergence between teacher and student as one of `missing`, `extra`,
`ghost_extra`, or `comment`, connect swap pairs (`paired_with`), and
place anchors (`insert_at`) for unpaired missings.

Curated files omit the algorithm-derived top-level fields (`score`,
`alignments`, `line_marks`, `leo_assignments`, `teacher_ghosts`); the
differentiator borrows `alignments` from any line-based method that's
also loaded for the same student so the side-by-side aligned view still
works in Ideal/Minimal mode.

Curated files may carry an optional top-level `file_pairs` map
(`{studentFile: teacherFile}`) when the curator has manually paired
student/teacher files whose names don't match. This is used by
`_pairedFileName` in `differentiator/index.js` to drive tab synchronisation
when the student named a file differently from the teacher (e.g. the
student's `654321.js` should pair with the teacher's `123456.js`). The
field is omitted from the JSON when empty.

`_validate_curated_schema()` in `token_log_curated.py` (re-exported by
`token_log.py`) enforces the structural
invariants:

- Allowed teacher labels: `missing`, `comment`. Allowed student labels:
  `extra`, `ghost_extra`, `comment`. (Teacher files never carry `extra`
  and student files never carry `missing` — curated files respect the
  same per-side label split as the algorithmic methods.)
- Every mark satisfies `text[start:end] == token`. Drift between the
  curator's edits and the source files is caught here.
- `paired_with` links are bidirectional and only between a teacher
  `missing` and a student `extra`. No two missings share an extra and
  no two extras share a missing.
- Every unpaired `missing` carries an `insert_at` (so the action
  "insert this token here in the student file" is fully defined).
- `move_to` may appear only on `extra` marks, and never together with
  `paired_with` on the same mark. Its `pos` must lie in `[0, len(student_text)]`
  and `file` must be a known student file.

The unit-test suite runs `_validate_curated_schema` against every
`diff_marks_ideal.json` in `test/`, so a curator who breaks invariants
fails the suite immediately.

`compare_methods_to_ideal.py` (in `lesson_tools/`, wired to
`npm run eval`) compares each method's diff*marks against the ideal and
writes an Excel workbook with per-label precision, recall, F1 (mark-
level \_and* pair-level) across all students with a curated ideal.
Two modes:

- **Multi-lesson** (default): pick a Grades excel; walks
  `<root>/lessons/<lesson>/anon_ids/`, evaluates every student in every
  lesson, writes `<root>/Method_Evaluation.xlsx` with a Summary sheet
  (F1 + Pair F1 per method × lesson) plus one detail sheet per lesson.
- **Single-project** (with a folder arg): scores students directly under
  that folder, writes `methods_vs_ideal.xlsx` next to them.

This is the empirical evaluation harness for changes to the matching
code.

---

## 9. Browser Rendering

`differentiator/index.js` reads one JSON per method (or all of them, packaged
together under `allMarks`) and renders both files side by side. Position
marks are applied directly with `<span>` wrappers — no re-tokenisation
happens in the browser. This is intentional: regex-based highlighting in the
browser would re-introduce false matches (e.g., `border` matching inside
`border-box`), exactly the problem position-based highlighting is designed to
solve.

Colour scheme (defined as `--clr-mark-*` variables in
`shared/shared.css`, read once into `MARK_COLORS` by `_cssVar()` in
`shared/diff-utils.js` so the JS palette and the CSS rules stay in sync):

| Label         | CSS variable         | Default        | Meaning                                                               |
| ------------- | -------------------- | -------------- | --------------------------------------------------------------------- |
| `missing`     | `--clr-mark-missing` | Red `#e00`     | In teacher reference, absent from student                             |
| `extra`       | `--clr-mark-extra`   | Blue `#00c`    | In student, never typed by teacher                                    |
| `ghost_extra` | `--clr-mark-ghost`   | Cyan `#3aa0e0` | In student; teacher typed it then deleted it                          |
| `comment`     | `--clr-mark-comment` | Green `#4a4`   | Token in a comment (all methods; comments are excluded from matching) |

For line-based methods, line backgrounds use a faded version of the same
colours (`--clr-mark-missing-bg` ≈ `rgba(220,0,0,0.13)`,
`--clr-mark-extra-bg` ≈ `rgba(0,0,200,0.10)`). Pair-highlight, swap-pair, and
curated-grouping highlights all derive from the same palette
(`--clr-mark-missing-pair-bg`, `--clr-mark-*-soft-bg`,
`--clr-swap-pair[-bg]`, `--clr-highlight-active[-bg]`) so a colour-scheme
change happens in one place.

---

## 10. End-to-End Pipeline

```
TEACHER SIDE (with keylog)
──────────────────────────
log.json
  │
  ├─► reconstruct_tokens_from_keylog_full()  →  teacher entries
  │      └─► _write_teacher_tokens_file → tokens.txt
  │            (token, timestamp, COMMENT?, REMOVED?)
  │
  └─► reconstruct_all_headless()
       └─► reconstructed/<name>   (one file per editor tab the teacher used)


STUDENT SIDE
────────────
student/index.html, style.css, app.js
  │
  ▼ read directly by the matching methods


DIFF-MARK GENERATION (per student)
──────────────────────────────────
teacher reference files  +  student files
  │
  ├─► _build_leo_diff_marks(..., events)
  │      ├─► _compute_per_token_matching(..., teacher_ghosts=...)
  │      ├─► pre-set `match_idx` on student instances paired with ghost cols
  │      ├─► _apply_swap_pairing_to_marks   ← context-cosine missing↔extra pairs
  │      ├─► _apply_insert_at_to_unpaired_missings
  │      └─► returns leo_assignments (no alignments/line_marks — borrowed at view time)
  │
  ├─► _build_lcs_token_diff_marks(...)        ← stamps _native_insert_at on missings
  └─► _build_git_diff_marks(...)              ← also produces alignments + line_marks


PIPELINE WRITING
────────────────
LEO family (`TokenLogMixin.write_student_token_files`, keylog runs only;
without a keylog plain LEO goes through `write_leo_diff_marks` →
`_write_alt_diff_marks` instead):
  build result  →  diff_marks dict
   │
   ├─► deepcopy → token_matching='leo'
   │     ├─► _build_occ_from_diff_marks (compute non-star score)
   │     ├─► _strip_internal_fields
   │     └─► write diff_marks_leo.json
   │
   └─► if keylog events exist:
        diff_marks (token_matching='leo_star')
          │
          ▼ _add_log_metadata()
             ├─► _refresh_missing_timestamps  (chronological insertion ts via _tok_idx)
             ├─► _apply_ghost_extra_promotion (LEO short-circuit honours
             │     pre-set ghost match_idx; Hungarian for any leftover)
             ├─► _apply_swap_pairing_to_marks  (re-pair after promotion)
             ├─► _apply_insert_at_to_unpaired_missings
             └─► attach `teacher_ghosts`
          │
          ▼ _build_occ_from_diff_marks → final star score; (optional) re-score
            against curated_dir/<sid>/diff_marks_ideal.json when a curated
            ideal is supplied so leo_star.score reflects ideal-aligned counts
          │
          ▼ write tokens.txt + diff_marks_leo_star.json

Other families (`TokenLogMixin._write_alt_diff_marks`, used for LCS/Git):
  build result  →  _assemble_diff_marks (token_matching=plain key)
   │
   ├─► _apply_insert_at_to_unpaired_missings  (copy _native_insert_at into insert_at)
   │
   ├─► deepcopy → _strip_internal_fields → write diff_marks_<plain>.json
   │
   └─► if keylog events exist:
        diff_marks (token_matching='<plain>_star')
          │
          ▼ _add_log_metadata()
             ├─► _refresh_missing_timestamps
             ├─► _build_assignments_for_post_pass  (synthesize leo_assignments
             │     from existing missing/extra labels + ghost stream)
             ├─► _apply_ghost_extra_promotion
             ├─► _apply_swap_pairing_to_marks
             ├─► _apply_insert_at_to_unpaired_missings
             └─► attach `teacher_ghosts`
          │
          ▼ recompute star score:
            max(0, (n_found_nc_star − n_ghost_extra_count − n_extra_unpaired_count) / teacher_total_nc · 100)
          │
          ▼ _strip_internal_fields → write diff_marks_<plain>_star.json

Every write goes through `_emit_diff_marks`, which skips bases listed in
`DISABLED_DIFF_MARK_VARIANTS` (default: plain `leo`, `lcs_star`, `git_star`
are not written — see the CLAUDE.md "Disabling diff-mark generation" note).


FALLBACK WHEN NO KEYLOG EXISTS
──────────────────────────────
sim_check.py drives all writers:
  · no `tokens.txt` / student token files
  · only the plain diff_marks files are written (no `*_star`) — and only
    for bases not in `DISABLED_DIFF_MARK_VARIANTS`, so by default `lcs`
    and `git` (plain `leo` generation is disabled)
  · `_add_log_metadata` is a no-op without events, so `timestamp`,
    `removal_ts`, ghost promotion, and `teacher_ghosts` are absent


EVALUATION (`npm run eval` → compare_methods_to_ideal.py)
─────────────────────────────────────────────────────────
multi-lesson mode (default): pick Grades excel; for each
`<root>/lessons/<lesson>/`:
  ├─► list students under `<lesson>/anon_ids/<sid>/`
  ├─► load each `diff_marks_<method>.json` and `diff_marks_ideal.json`
  ├─► compute per-(student, method, label) TP/FP/FN/TN at mark level
  │     and pair level (ideal vs method `paired_with` / `insert_at`)
  └─► aggregate
write `<root>/Method_Evaluation.xlsx`:
  · Summary sheet — F1 + Pair F1 per method × lesson (2 cols/lesson)
  · one detail sheet per lesson with Totals + Per Student tables


BROWSER
───────
navigateToDifferentiator() / openDifferentiatorWindow()
  │
  ├─► load whichever diff_marks files exist into `allMarks`
  ├─► default mode preference (defaultDiffModeKey in diff-utils.js):
  │     ideal → minimal → '' (=leo_star) → leo → first loaded mode
  ├─► dropdown is populated from DIFF_MODE_OPTIONS, filtered to loaded modes;
  │     any custom `diff_marks_<name>.json` in the student folder is also loaded
  │     (keyed by `<name>`) and listed after Ideal/Minimal, before the methods
  └─► render with `diffColorizePositions()` (no re-tokenisation in browser);
       line-based methods bring `alignments` and `line_marks`, which the
       per-token methods and curated (`ideal`/`minimal`) borrow via `_borrowedAlignments()`
```

---

## 11. Design Decisions

**Tokens, not characters or AST.** The token level is the right granularity
for "did the student type the same thing." Characters give too much noise;
ASTs require a full parser per language and lose the chronological signal. Also not useful if code is broken (students make mistakes following along).

**Same output schema for every method.** Letting any matcher slot into the
same downstream rendering and grading pipeline is the whole point of the
refactor — whichever methods are present are runtime-selectable from the
differentiator dropdown without any code changes elsewhere.

**Star always = base + ghost-context post-processing.** The promotion is an
orthogonal step; every method's `extra` marks are eligible. This avoids
having a different "stars-aware" version of each algorithm.

**Comments excluded from matching in every method.** Per-token methods
(LEO, LCS) filter comment tokens out before matching
(`_split_tokens_by_comment`); the line-based method (Git) blanks comment
ranges to spaces first (`_sm.blank_comments`), so comment-only lines drop
out of the line diff and `code; // foo` matches `code; // bar` on `code;`
alone. Both re-attach comment tokens afterwards as `comment` marks, so a
student's natural-language comment never affects the score.

**`timestamp` on missing marks, `removal_ts` on ghost_extra marks.** A
`missing` mark carries the wall-clock moment the teacher _typed_ the
token (`timestamp`) — useful for spotting where the student fell behind.
An `ghost_extra` mark carries the wall-clock moment the teacher _deleted_
the matching ghost (`removal_ts`) — useful for showing which abandoned
edit the student is reproducing. Plain `extra` marks have no teacher
timestamp at all (the teacher never typed those tokens).

**Hungarian ghost promotion.** Earlier iterations used simpler token-text
budget or per-extra best-match heuristics. The current scheme is
assignment-based: for each token type, build a cosine matrix for
`student_extra_instances × teacher_ghost_instances`, run Hungarian, then
promote only assigned pairs whose cosine is `>= _CONTEXT_MATCH_THRESHOLD`
(`0.8`). This preserves one-to-one pairing per token type and makes
promotion deterministic for repeated tokens.

**Why Hungarian and a threshold are not redundant, and why only on ghosts.**
Hungarian and `_CONTEXT_MATCH_THRESHOLD` answer different questions: Hungarian
picks the _optimal_ pairing within a token type (avoiding the greedy local
mistakes that misassign repeated tokens); the threshold decides whether to
_act on_ that pairing at all. They're orthogonal — Hungarian still produces
the best-possible pairing for the data, and the threshold rejects pairings
that are best-but-still-weak (e.g. a 0.3-cosine "least-bad" partner).

The threshold is asymmetric — applied to ghost `ghost_extra` but not real
`extra` — because the two outcomes mean different things. Real-token `extra`
is _count-forced_: if a student typed `border` more times than the teacher,
the surplus is genuinely extra regardless of context similarity, and cosine
only decides _which_ student instance gets paired with _which_ surviving
teacher slot. Ghost `ghost_extra` is _evidentiary_: it's a claim that the
student is reproducing a specific teacher deletion, which is only credible
when the surrounding contexts match. Thresholding the real side would
suppress facts; not thresholding the ghost side would manufacture claims
from token-text coincidence alone.

**Per-mark `removal_ts`.** A token can be removed by the teacher more than
once during a session (e.g. `(` removed both with a `console.log(element);`
expression and later with an `onclick="handleClick(this);"` attribute).
Recording removal timestamps in a flat per-token dictionary collapsed those
to a single value and produced wrong timestamps in the displayed output.
The promotion step now records the `del_ts` of the _specific_ ghost a
student extra was matched to, written on the mark as `removal_ts`.

**Split left/right window.** The context window is built as **two**
separate Counters per anchor: a left vector over `[p-k..p-1]` and a
right vector over `[p+1..p+k]` (the anchor `p` itself is excluded).
A candidate pair's similarity is a blend of two cosines, one per
side — see the _Combined score_ paragraph below. Only `match_idx`
(pair-mate index) is shipped to the tooltip.

**Uniform unigrams.** Each context vector is a plain count bag —
every token in the window contributes 1 regardless of its frequency
or distance from the anchor. There is no IDF weighting and no
distance decay. Earlier versions weighted by IDF, but on the
test-fixture corpus IDF gave only noise-level gains at the mark
level and slightly _hurt_ pair-finding on the harder lessons
(js, sorting), so it was removed. The differentiator tooltip
reproduces vectors directly from `leo_assignments.teacher_seq` /
`student_seq` plus `k`.

**Combined score: `0.3 * min(cos_left, cos_right) + 0.7 * max(cos_left, cos_right)`.**
For every (student, teacher) pair the matcher computes two cosines —
`cos_left` over the k tokens _before_ the anchor, `cos_right` over the
k tokens _after_. The pair similarity is a weighted blend of the
two: 70 % from the strong side, 30 % from the weak side.

The 0.7 weight on `max(cos_left, cos_right)` lets a near-perfect match
on **either** side carry most of the signal. When one side of two
tokens shares an exact same-tokens-in-same-order sequence, that's
hard to forge by chance — a `cos_right = 1.0` (e.g. both have `cells =
document.getElementsByClassName(...)` to the right of the anchor)
pulls the combined score up substantially, correctly identifying
"this is the same usage" cases where the student is missing the
surrounding lines but still wrote the same line of code.

The 0.3 weight on `min(cos_left, cos_right)` is the strict-bilateral
guard. Without it, _any_ one-sided perfect match would clear the
threshold — including end-of-file boilerplate where two unrelated
`;` tokens both happen to precede `</script></body></html>`.
Requiring the weak side to contribute roughly 30 % of the score
means a perfect one side + ≈0.15 other side scores `0.045 + 0.7 ≈
0.745` (well below the 0.8 threshold), while a perfect one side +
≈0.35 other side scores `0.105 + 0.7 = 0.805` (just above
threshold) — i.e. the weak side has to be at least ≈0.35 for the
pair to pass when the strong side is perfect. Random pairs
typically score well below 0.4 on both sides, so they're rejected
outright.

When `cos_left = cos_right = x` (balanced match) the formula
collapses to `x` regardless of the 0.3/0.7 split, so balanced pairs
just need to clear the threshold value itself — at threshold 0.8,
that's both sides ≥ 0.8.

**With-ghosts and ghost-stripped contexts, max of the two combined
scores — on real columns only.** For every **real** teacher candidate
the matcher computes the combined score twice: once against the
augmented teacher sequence (`teacher_match_seq`, ghosts included as if
they were normal tokens), once against the ghost-stripped sequence
(window extended past the gaps until k surviving tokens are gathered
on each side or the document edge is reached). The Hungarian sees
`max(combined_with, combined_stripped)` for those columns. **Ghost
teacher columns use the with-ghosts variant alone** —
`_compute_per_token_matching` short-circuits `t_alt_packs[j]` to
`None` when `is_ghost_at[p]` (see [`_locate_token`](../lesson_tools/utils/token_log.py)).
All this shaping is applied only in Phase 1; Phase 2
(`_apply_ghost_extra_promotion`) uses the with-ghosts variant alone
across the board, since for non-LEO bases — its only real consumers —
no stripped view has been built.

The shaping removes a structural asymmetry on real columns: the
student sequence has no concept of ghosts, so comparing the student's
plain context against a teacher context that mixes in ghost tokens
unfairly lowered the cosine when the student had correctly removed
the deletion. The max picks whichever side of "did the student keep
the ghost or not" the student landed on.

The asymmetry — keeping max-of-two on real columns but not on ghost
columns — is deliberate. On a ghost column, `cos_with` rewards a
student whose context contains the ghost-equivalent material (i.e.
the student kept the deletion); `cos_stripped` would reward a student
whose context matches the surrounding survivors instead (i.e. the
student followed the teacher and removed the deletion). We only want
to credit the first case as a `ghost_extra` claim. Crediting the
second would label a student who _correctly_ followed the teacher's
edit as having reproduced an abandoned edit — the opposite of the
intended signal. So ghost columns deliberately stay on `cos_with`
alone.

> **Known limitation:** the two extremes (all kept / all removed) don't
> cover students who kept some ghosts and removed others. A future
> extension is to enumerate the 2^G subsets of ghosts within the window
> and take max cosine over all of them — see `ideas/to-do.txt`
> ("Per-ghost subset enumeration in LEO context matching").

**Ghost tokens are first-class candidates in the LEO Hungarian, in two
phases at different call sites.** Beyond just shaping the cosine context,
ghost tokens participate as teacher candidates. The matching runs in two
phases that live in different functions:

- **Phase 1** runs inside `_compute_per_token_matching`: Hungarian over
  (students × surviving-teachers). Surviving teacher tokens get first
  claim — the count of "what should be there" never shifts because of
  ghosts. The cosine context window uses the augmented teacher sequence
  (`teacher_seq_aug`) AND a ghost-stripped variant, with the per-pair
  similarity being the max of the two cosines (see "With-ghosts and
  ghost-stripped contexts" above).
- **Phase 2** runs inside `_apply_ghost_extra_promotion`, called
  from `_add_log_metadata` after the base matching is done: Hungarian
  over (unmatched-students × ghost-teachers). Pairs with cosine ≥
  `_CONTEXT_MATCH_THRESHOLD` get `ghost_extra` directly out of the matching
  (with `removal_ts` sourced from that ghost's last-character `del_ts`).
  Unlike Phase 1, the cosine here is the plain with-ghosts context only
  — no ghost-stripped variant — because Phase 2 is reused for non-LEO
  bases that never built a stripped view in the first place.

Phase 2 is reused for every star variant: for non-LEO bases,
`_build_assignments_for_post_pass` first synthesizes `leo_assignments`
from the existing diff_marks, then Phase 2 runs against those.

Without the phase split, a single Hungarian over (t_surv + t_ghost) could
leave a surviving teacher unmatched whenever a ghost scored a higher
cosine for the same student — inflating both `missing` (on the surv side)
and `ghost_extra` (on the student side) by exactly one for each such
collision. An earlier iteration shipped the augmented sequence for
display only and left matching on surviving-only; that produced a visible
incoherence — the tooltip showed ghosts in the context window, ghost
token instances didn't appear in the per-token row list, and the legacy
token-text post-pass sometimes assigned different ghost candidates than
the cosine match would have. Promoting ghosts to first-class candidates
closed all three gaps. The student side stays surviving-only because we
don't track student deletions; in practice the asymmetry helps rather
than hurts — a student who kept text the teacher later deleted (e.g. an
`onclick` handler that was demoed then removed) gets a similarity boost
on tokens near that text, which typically flips the Hungarian to the
"right" student instance.

`teacher_seq_aug` is built once by `_build_teacher_seq_aug` at the start
of `_compute_per_token_matching` and reused for every token. The same
helper also returns the per-token-instance ghost metadata
(`{file, token, blob_pos, blob_offset, del_ts, seq_idx_aug}`) used
in the matching loop and emitted into `leo_assignments.tokens[*].teacher`
with `ghost: true`. Per-token `del_ts` is sourced from the blob's
`char_del_ts` array (a parallel list to `text` carried on each ghost
blob) — using the blob's aggregated `del_ts` (max of the batch) here
would round away earlier deletions of the same token in a multi-token
blob.

---

## 12. Parameter Sensitivity

The matching pipeline has a small number of tunables. None of them require
per-corpus tuning today — defaults work across all test fixtures and
the production grading pipeline — but the sensitivities below are the
guide-rails to keep in mind when changing them.

| Parameter                  | Default | Where it lives                                                                                                                                                                                  | Sensitivity |
| -------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `_CONTEXT_K`               | 10      | LEO student/teacher context window (half-width)                                                                                                                                                 | Low–medium  |
| `_CONTEXT_MATCH_THRESHOLD` | 0.8     | Min combined score (`0.3·min(cos_left, cos_right) + 0.7·max(cos_left, cos_right)`) for an `extra` ↔ ghost pair to be promoted to `ghost_extra`, **and** for a LEO `missing` ↔ `extra` swap pair | Medium      |

- **`_CONTEXT_K`.** Half-width of the symmetric ±k window used to build
  the per-token context vectors for the LEO Hungarian. Two separate
  Counters are built per anchor: a left vector over `[p-k..p-1]` and a
  right vector over `[p+1..p+k]`; the pair score is
  `0.3·min(cos_L, cos_R) + 0.7·max(cos_L, cos_R)` over those two
  cosines (see §11 _Combined score_). Larger windows give more
  disambiguation signal for duplicate-token positions inside the same
  file but dilute precision when the matched neighbours are far away.
  The separate `max` in §5.1's similarity formula is between two
  combined scores — one against the with-ghosts teacher sequence and
  one against the ghost-stripped variant — and is orthogonal to the
  left/right split inside each cosine.

- **Uniform weighting.** Each window token contributes 1 to its
  side's Counter regardless of frequency or distance from the anchor.
  Earlier versions used IDF (`log((1+N)/(1+count(t)))` over the joint
  teacher+student vocabulary) but it was removed: empirical evaluation
  on chess/wall/js/sorting showed mark-level F1 was unchanged within
  noise (Δ ≤ 0.003) and pair-level F1 actually _improved_ without IDF
  on the harder lessons (js: +0.018, sorting: +0.030). The uniform
  vector is reproducible in the tooltip from
  `leo_assignments.teacher_seq` / `student_seq` plus `k` alone — no
  shipped IDF table is needed.

- **`_CONTEXT_MATCH_THRESHOLD`.** Cutoff applied at three sites — all
  asking the same question (is the context cosine high enough to
  claim usage equivalence?) so they share one knob:
  (1) inside `_compute_per_token_matching`, the bar for keeping a
  Phase-1 student↔ghost pair from the joint Hungarian (below the bar
  the pair is dropped and the student stays plain `extra`);
  (2) inside `_apply_ghost_extra_promotion`, the bar for promoting
  a Phase-2 student↔ghost pair to `ghost_extra`;
  (3) inside `_apply_swap_pairing_to_marks` (§7.3), the bar for
  greedy-best `missing` ↔ `extra` swap pairing on LEO leftovers. At
  `0.8` it accepts strong substitutions like
  `getElementsByClassName ↔ getElementById`, `gray ↔ grey`,
  `selectedPiece ↔ selectedpice`, `onclick ↔ onClick` while
  rejecting weakly-related tokens. Lower values are more permissive
  (more pairings, including spurious ones); higher values miss
  cases where the surrounding context isn't quite identical.

- **Test-suite signal.** `regen_test_fixtures.py` regenerates every LEO\*
  fixture across the `test/lessons/*` corpora; running `python -m unittest
test_lesson_tools` is the fastest way to detect a parameter
  change that breaks something. The per-student `tokens.txt` fixtures
  under `test/lessons/` are the most informative diff: the corpus covers
  both the count-surplus case (LEO Hungarian leaves room for ghost-extra
  promotion to rescue duplicate occurrences) and the count-parity case
  (LEO Hungarian uses every surviving slot, so only the line-based method
  can recover the HTML-attribute tokens).

---

## Citations

The classical algorithms used here:

- **Hungarian assignment** — Kuhn (1955), via `scipy.optimize.linear_sum_assignment`.
- **Ratcliff/Obershelp** ("gestalt pattern matching") — Ratcliff & Metzener
  (1988), implemented in Python's `difflib.SequenceMatcher`.
- **Myers diff** — Myers (1986), "An O(ND) Difference Algorithm and Its
  Variations", _Algorithmica_. This is what `git diff` uses, and what
  `difflib` also approximates.

Related work in code similarity for grading (background; not used here):

- **MOSS** — Schleimer, Wilkerson & Aiken (2003), winnowing-based fingerprinting.
- **JPlag** — Prechelt, Malpohl & Philippsen (2002), Greedy String Tiling on tokens.
- **GumTree** — Falleri et al. (2014), AST edit-script computation.
- **Tree edit distance (RTED)** — Pawlik & Augsten (2011), efficient tree
  edit distance.
- **Sim** — Grune & Huntjens (1989), token-stream LCS for plagiarism detection.
