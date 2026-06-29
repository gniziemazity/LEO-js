# Token-Based Code Differentiator: Algorithm Description

The differentiator compares a student's code against a teacher's reference and
emits per-character **position marks** that the browser highlights. The teacher
reference is normally reconstructed from the lesson **keylog** (the live-coding
event stream); without a keylog the teacher's static files are used instead.

Every method produces the same JSON shape: a list of marks per file, each with a
character `start`/`end` span and one of four labels — **`missing`** (teacher had
it, student didn't), **`extra`** (student typed it, teacher didn't),
**`ghost_extra`** (student kept something the teacher typed then deleted), and
**`comment`** (token inside a comment; never matched). All methods exclude
comments from matching, so students' own comments never count against them.

| Family | Methods          | Granularity  | Core                                                               |
| ------ | ---------------- | ------------ | ------------------------------------------------------------------ |
| LEO    | `leo*` / `leo*+` | Token        | Per-token Hungarian on cosine-similar contexts; ghosts in the base |
| LCS    | `lcs` / `lcs*`   | Token        | `difflib.SequenceMatcher` (Ratcliff/Obershelp) on the token stream |
| Git    | `git` / `git*`   | Line + Token | `git diff --no-index --unified=0 -w`, then per-line token diff     |

- **`leo*`** is keylog-native and the default basis. Ghosts (typed-then-deleted
  teacher tokens) enter its per-token Hungarian as extra teacher columns, so the
  real/ghost split is decided in one base pass — no ghost-promotion needed.
- **`leo*+`** is `leo*` with two tuned knobs (§4.1): a distance-decayed context
  bag and an absolute acceptance threshold on real matches. Off for `leo*`. See
  [leo-star-plus-findings.md](leo-star-plus-findings.md).
- The **`*` (star)** post-pass (§5) adds ghost handling, swap pairing, insert
  anchors, and timestamps. `lcs`/`git` are keylog-blind and gain it via the star
  pass (`lcs`→`lcs*`, `git`→`git*`); `leo*` already does the matching natively,
  so its star pass only _materializes_ and timestamps the base's decisions.
- **`ideal`** / **`minimal`** are hand-curated mark files (recommended-fix /
  minimum-fix), edited in the differentiator's curated editor and used as the
  ground truth by `compare_methods_to_ideal.py` (§7).

Mode→file mapping and cross-window handoff live in
[shared/diff-utils.js](shared/diff-utils.js) (`DIFF_METHODS`,
`DIFF_MARKS_FILES`, `defaultDiffModeKey`, `navigateToDifferentiator`) — one place
shared by the timeline, overview, and students views.

---

## 1. End-to-End Pipeline

`utils/sim_check.py` drives every writer per student. With a keylog:

```
TEACHER SIDE (keylog: log.log, legacy log.json)
  reconstruct_tokens_from_keylog_full()  → tokens.txt   (token, ts, COMMENT?, REMOVED?)
  reconstruct_all_headless()             → reconstructed/<name>   (one file per teacher tab)

STUDENT SIDE
  anon_ids/<sid>/*.{html,css,js,py}      → read directly by every method

DIFF-MARK GENERATION (per student, per method)
  teacher reference files + student files
    ├─ _build_leo_diff_marks(…, events)        → leo_assignments  (LEO core, §4.1)
    ├─ _build_lcs_token_diff_marks(…)          → stamps _native_insert_at
    └─ _build_git_diff_marks(…)                → also alignments + line_marks

WRITING (TokenLogMixin)
  LEO   : write_student_token_files → diff_marks_leo_star.json   (+ star post-pass)
          write_leo_plus_diff_marks → diff_marks_leo_star_plus.json
                                      (same flow inside leo_plus_config())
  LCS   : _write_alt_diff_marks → diff_marks_lcs.json   then  *_star  (+ star post-pass)
  Git   : _write_alt_diff_marks → diff_marks_git.json   then  *_star  (+ star post-pass)
  Every write goes through _emit_diff_marks, which skips bases in
  DISABLED_DIFF_MARK_VARIANTS = {lcs_star, git_star}; so by default the files
  written are: leo_star, leo_star_plus, lcs, git (+ curated ideal/minimal copied in).

THE STAR POST-PASS (_apply_star_post_pass, only when a keylog exists)
  ├─ _refresh_missing_timestamps          (insertion ts onto missing marks via _tok_idx)
  ├─ _build_assignments_for_post_pass     (LCS/Git only: synthesize leo_assignments)
  ├─ _apply_ghost_extra_promotion         (extra → ghost_extra, write removal_ts)
  ├─ _apply_swap_pairing_to_marks         (pair leftover missing ↔ extra)
  ├─ _apply_insert_at_to_unpaired_missings
  └─ attach teacher_ghosts

NO-KEYLOG FALLBACK
  no tokens.txt; only the plain diff_marks files (no *_star); the star post-pass
  is a no-op, so timestamp / removal_ts / ghost_extra / teacher_ghosts are absent.

EVALUATION (npm run eval → compare_methods_to_ideal.py)
  walk <root>/lessons/<lesson>/anon_ids/<sid>/, score each diff_marks_<method>.json
  vs diff_marks_ideal.json, write <root>/Method_Evaluation.xlsx.

BROWSER (differentiator/index.js)
  load whichever diff_marks_*.json exist into allMarks; default mode
  ideal → minimal → leo_star; render with diffColorizePositions() — no
  re-tokenisation in the browser.
```

Implementation map:

| Concept                | Module                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| Teacher reconstruction | `_build_file_timeline`, `_file_at_ts` — `utils/token_log.py`                                    |
| Token timeline         | `reconstruct_tokens_from_keylog_full` — `utils/similarity_measures.py`; `_parse_teacher_tokens` |
| Ghost stream           | `_collect_teacher_ghosts` — `utils/token_log_leo.py`                                            |
| LEO core               | `_compute_per_token_matching` — `utils/token_log_leo.py`                                        |
| Mark factories         | `_missing_mark`, `_extra_mark`, `_comment_pos_mark` — `utils/token_log_marks.py`                |
| Star post-pass         | `_apply_star_post_pass` & friends — `utils/token_log_starpass.py`                               |
| Curated schema         | `_validate_curated_schema` — `utils/token_log_curated.py`                                       |
| Pipeline wiring        | `TokenLogMixin` — `utils/token_log_mixin.py`; driven by `utils/sim_check.py`                    |

`utils/token_log.py` is the public entry point; it re-exports every symbol from
the sibling `token_log_*` modules, so `from utils.token_log import _foo` resolves.

---

## 2. Tokens

A token is produced by the shared tokenizer in `utils/similarity_measures.py`:

- `_CHAR_TOKEN_RE = r'[a-zA-Z0-9]+|[^\s]'` — alphanumeric runs are one token;
  every other non-whitespace character is its own token.

```
<div class="card">  →  <  div  class  =  "  card  "  >
height: 50px;       →  height  :  50px  ;
```

HTML/CSS/JS/Python share this one tokenizer path; only comment handling is
language-specific. Comment detection (`_sm._comment_ranges` / JS
`_diffCommentRanges`) looks up a language profile by file extension and matches
**closed** comments only — `/* … */`, `<!-- … -->`, `// …\n`. An unclosed `/*`
or `<!--` is not a comment; its characters tokenise as ordinary code (so a typo
surfaces as a small `extra` cluster instead of swallowing the rest of the file).

By extension (profiles in [languages/](languages/)):

- `.css` — only `/* … */`.
- `.html`/`.htm` — `<!-- … -->` everywhere; `/* … */` only inside
  `<style>`/`<script>`; `// …` only inside `<script>`. Embedded ranges come from
  `embeddedTags`; an unclosed block extends to EOF (browser behaviour).
- `.js` — all three styles, no context gating.
- `.py` / unknown — the fallback union regex.

---

## 3. Teacher Reference

### 3.1 From keylog (preferred)

A `HeadlessEditor` replays every event, tracking timestamps:

```
function replay_with_timestamps(events):
    editor = HeadlessEditor(track_timestamps=true)
    for event in events:
        editor.current_timestamp = event.timestamp
        keypress → insert/delete · code_insert → insert · move_to/switch → record tab
    return editor.surviving_with_ts(),   # [(char, ins_ts), …]
           editor.deleted_with_ts()      # [(char, ins_ts, del_ts, seq_idx), …]
```

- The surviving text per tab is written to `reconstructed/<name>` (main HTML tab
  → `reconstructed.html`); these are the teacher reference for every method.
- The same surviving + deleted data drives `tokens.txt`: one line per occurrence
  in chronological order with `COMMENT` and `REMOVED <del_ts>` flags. Deleted
  tokens become the **ghost** stream.

### 3.2 Static files (no keylog)

Project layout on disk:

```
<root>/students.csv                         roster (two levels above <project>/)
<category>/<project>/
  correct/          teacher reference solution (reference_dir)
  start/            optional skeleton; when present it is the reference, not correct/
  reconstructed/    generated from the keylog (one file per teacher tab)
  students/         one folder per student (real names)
  anon_ids/         anonymised per-student folders — what every tool reads/writes
  <name>.log        the keylog (.log; legacy .json)
```

Reference precedence (`reconstructed/` → `start/` → `correct/`): if keylog events
exist and `reconstructed/` has code files, use them; else if `start/` exists, use
it; else `correct/`. Sources are never mixed.
`_get_teacher_code_files` handles the `reconstructed/` step;
`CodeSimilarityChecker._effective_reference_dir()` centralises the
`start/`-vs-`correct/` choice. Rendering-side tools infer "no keylog" from the
absence of `reconstructed/` files.

---

## 4. Matching Methods

Every method follows one skeleton and returns a uniform tuple
(`t_marks, s_marks, score, alignments, line_marks, n_total` [, `leo_assignments`])
that `token_log_mixin._write_alt_diff_marks` wires into the pipeline. Shared
helpers (re-exported by `token_log.py`): `_match_files_by_name_then_ext`,
`_read_text_normalized` (utf-8, `\r\n`→`\n`), `_split_tokens_by_comment`,
`_build_token_position_index`, the `_*_mark` factories, and `_finalize_per_file_diff`.

`score = (n_total − n_missing) / n_total · 100`.

### 4.1 LEO — context-cosine Hungarian

Matches **per token type** by a maximum-weight bipartite assignment over the
cosine similarity of each occurrence's surrounding context. With a keylog, ghost
teacher instances are extra columns in the same Hungarian.

```
def _compute_per_token_matching(teacher_files, student_files, k, teacher_ghosts=None):
    teacher_seq = non-comment teacher tokens   (+ ghosts spliced in at keylog position
                                                 → teacher_seq_aug, when ghosts present)
    student_seq = non-comment student tokens

    for tok in {teacher tokens} ∪ {student tokens}:
        t_real  = teacher occurrences of tok      # n_real columns
        t_ghost = ghost  occurrences of tok       # appended after the real columns
        s_out   = student occurrences of tok      # rows

        # per (student row i, teacher col j):
        sim[i][j] = combined_score(student_seq, s_i, teacher_match_seq, t_j, k)
        #   real columns also take max() with the ghost-stripped context (see below)

        pairs = hungarian_max(sim)                # maximise Σ similarity
        real_pairs  = pairs with j < n_real
        ghost_pairs = pairs with j ≥ n_real and sim ≥ _CONTEXT_MATCH_THRESHOLD (0.8)

        unmatched teacher reals → 'missing'   ;   unmatched student rows → 'extra'
        each pair ships its partner's index as match_idx in leo_assignments
        comment occurrences → 'comment' on both sides

combined_score(s, sp, t, tp, k) = 0.3·min(cos_left, cos_right) + 0.7·max(cos_left, cos_right)
  cos_left  = cosine(ctx_left (s, sp, k), ctx_left (t, tp, k))    over the k tokens before
  cos_right = cosine(ctx_right(s, sp, k), ctx_right(t, tp, k))    over the k tokens after
  ctx_*(seq, p, k) is a count bag (Counter) over the window; the anchor p is excluded.
  default k = 10.
```

- **Ghost-stripped max (real columns only).** For a real teacher column the score
  is `max(combined_with_ghosts, combined_ghost_stripped)`, where the stripped
  window skips ghost positions and extends until `k` surviving tokens are
  gathered. This lets a student match whether they kept the deleted material or
  followed the teacher and removed it. Ghost columns use the with-ghosts context
  alone.
- **Ghost matches are decided here.** A student row may be assigned to a ghost
  column (`match_idx` points at a `ghost: true` teacher entry); the star post-pass
  treats that as authoritative and relabels it `ghost_extra` without re-matching.
- **`leo*+` knobs** (active only inside `leo_plus_config()`, default off so `leo*`
  is byte-identical):
   - `_DECAY = 0.70` — a context neighbour at window-distance `d` contributes
     `_DECAY**(d-1)` instead of `1`, so nearer neighbours dominate the cosine.
   - `_REAL_MATCH_TAU = 0.65` — a **real** match is dropped when its cosine is
     below this floor; the orphaned occurrences become `missing`+`extra`, which the
     swap pass (§5.2) re-pairs. Surfaces force-matched wrong-token-in-right-slot
     mistakes.

LEO does not embed `alignments`/`line_marks`; the differentiator borrows those
from any loaded line-based method (`_borrowedAlignments()`) for the aligned view.

### 4.2 LCS — difflib on tokens

```
def _build_token_seq_diff_marks(teacher_files, student_files, opcodes_fn):
    for each (t_file, s_file):
        t_seq, s_seq = non-comment token strings
        for (tag, i1, i2, j1, j2) in opcodes_fn(t_seq, s_seq):   # _lcs_opcodes
            delete/replace → _missing_mark for t tokens [i1,i2)
            insert/replace → _extra_mark   for s tokens [j1,j2)
        comment tokens → _comment_pos_mark on both sides
```

`_lcs_opcodes` = `difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes()`
(Ratcliff/Obershelp, not strict LCS).

### 4.3 Git — line then token

Comments are blanked to spaces first (preserving offsets/newlines), so
`code; // foo` and `code; // bar` align on `code;`. Lines are aligned, then each
paired line is refined with a token-level difflib diff.

```
def _build_line_diff_marks(teacher_files, student_files, align_fn):
    for each (t_file, s_file):
        t_text, s_text = blank_comments(...)
        for (tag, i1, i2, j1, j2) in align_fn(...):     # _git_align
            equal   → extend alignment
            delete  → _add_unpaired_teacher_line  (line + per-token missing marks)
            insert  → _add_unpaired_student_line  (line + per-token extra marks)
            replace → _add_replace_block          (pair lines, _diff_line_pair_tokens each)
        comment tokens (from the ORIGINAL text) → _comment_pos_mark
```

`_git_align` runs `git diff --no-index --unified=0 -w` and parses `@@` hunks into
difflib-style opcodes. `-w` ignores whitespace-only line differences, so the
per-line token diff runs on **every** paired line (not just `replace` blocks) to
catch token differences inside lines that strip to equal. Git emits both
per-token marks (coloured letters) and per-line marks (line backgrounds, via
`_make_line_mark`).

---

## 5. Star Post-Pass

`_apply_star_post_pass` (keylog only) runs these in order.

### 5.1 Ghost-extra promotion

`_apply_ghost_extra_promotion` promotes `extra` marks whose context resembles a
teacher ghost. It works over `leo_assignments` (synthesised by
`_build_assignments_for_post_pass` for LCS/Git):

1. **LEO short-circuit** — any `extra` whose `match_idx` already points at a
   `ghost: true` teacher entry is relabelled `ghost_extra` directly, with
   `removal_ts` from that ghost's `del_ts`.
2. **Hungarian for the rest** — over (remaining extras × remaining ghosts) of the
   same token type, scored by the with-ghosts context cosine; pairs with cosine
   `≥ _CONTEXT_MATCH_THRESHOLD (0.8)` are promoted. For `lcs*`/`git*` no extras
   carry a pre-set ghost `match_idx`, so this Hungarian decides every match.

### 5.2 Swap pairing

`_apply_swap_pairing_to_marks` links residual `missing` ↔ `extra` marks per file:

```
score = combined_context_cos(missing, extra)
      + _SWAP_TOKEN_SIM_WEIGHT * SequenceMatcher(missing.token, extra.token).ratio()
```

with `_SWAP_TOKEN_SIM_WEIGHT = 0.2` (the token-text bonus lets typo pairs like
`border`↔`boder` clear the bar). Pairing is greedy: collect all candidate pairs
with `score ≥ _CONTEXT_MATCH_THRESHOLD`, sort descending, consume each side once.
Both marks gain a `paired_with: {file, start, end, token, label}` field (labels
stay `missing`/`extra`). Runs once at the end of `_build_leo_diff_marks` (so plain
LEO has swap pairs even without a keylog) and again after promotion; idempotent
(clears existing `paired_with` first).

### 5.3 Insert anchors

`_apply_insert_at_to_unpaired_missings` stamps each unpaired `missing` with
`insert_at: {file, pos}` — the offset where inserting the token fixes the diff.
Paired missings get no anchor (the pair already encodes a replace).

- **LCS/Git** know the anchor from their alignment and stamp an internal
  `_native_insert_at` at build time; the post-pass copies it into `insert_at`.
- **LEO** has no native anchor (per-token matching isn't order-preserving), so a
  heuristic walks the matched-only teacher/student sequences (which are 1-1 in
  order) and anchors each missing after its previous matched neighbour. Anything
  still unanchored falls back to end-of-file of the name/ext-matched student file.

### 5.4 Star score

After promotion the star score penalises each promoted token and each unpaired
`extra` (extras with `move_to` count too; swap-paired extras don't, since the
matched `missing` already accounts for the fix):

```
score* = max(0, (n_found_nc_star − n_ghost_extra_count − n_extra_unpaired_count)
                / teacher_total_nc · 100)
```

---

## 6. Output JSON

Every method emits the same shape:

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
  "alignments": { "index.html": [[0,0],[1,1],[2,null], …] },
  "line_marks": { "teacher_files": {…}, "student_files": {…} }
}
```

Field reference:

| Field                               | Where                            | Meaning                                                                            |
| ----------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------- |
| `token` / `label` / `start` / `end` | all marks                        | the span and one of `missing`/`extra`/`ghost_extra`/`comment`                      |
| `timestamp`                         | star `missing` marks (+ curated) | wall-clock moment the teacher _typed_ it; never on plain `lcs`/`git`               |
| `removal_ts`                        | `ghost_extra`, keylog only       | wall-clock moment of the _specific_ deletion this mark matched                     |
| `paired_with`                       | swap-paired `missing`/`extra`    | the partner span; renders as a dotted underline. Mutually exclusive with `move_to` |
| `insert_at: {file,pos}`             | unpaired `missing`               | offset where inserting the token fixes the diff                                    |
| `move_to: {file,pos}`               | `extra`, **curator-only**        | delete the token and re-insert it at `pos` (wrong-place, not surplus)              |
| `alignments` / `line_marks`         | line methods only                | drive the side-by-side view; per-token & curated borrow them                       |
| `leo_assignments`                   | LEO only                         | per-token-instance teacher/student lists with `match_idx`; powers the tooltip      |
| `teacher_ghosts`                    | LEO/LEO\*                        | `{file:[{pos,text,ins_ts,del_ts}]}` deletion ghosts spliced into the teacher pane  |

- **Offsets are UTF-16 code units** (how the browser indexes a JS string), so an
  astral char counts as two. LEO produces these directly
  (`_colors_to_position_marks` via a `_build_utf16_map`); LCS/Git compute
  code-point offsets and `_remap_marks_to_utf16` shifts them before writing.
- `_strip_internal_fields` removes the internal `_tok_idx` (bisect index used by
  the star pass) and `_native_insert_at` before writing.
- `token` may be whitespace (curator-only — the tokenizer strips whitespace), for
  "missing space" / "extra space" marks; the schema only requires
  `text[start:end] == token`.

---

## 7. Curated Files & Evaluation

`diff_marks_ideal.json` (recommended fixes) and `diff_marks_minimal.json`
(minimum fixes) share the per-mark schema but are produced by hand in the
differentiator's curated editor (`differentiator/curated*.js`). They omit the
algorithm-only top-level fields (`alignments`, `line_marks`, `leo_assignments`,
`teacher_ghosts`) and may carry an optional `file_pairs` map
(`{studentFile: teacherFile}`) when the curator pairs differently-named files.

`_validate_curated_schema` (run by the test suite against every test `ideal`)
enforces: teacher labels ∈ {`missing`,`comment`}, student labels ∈
{`extra`,`ghost_extra`,`comment`}; `text[start:end] == token`; `paired_with` is
bidirectional, only between a teacher `missing` and a student `extra`, one-to-one;
every unpaired `missing` has an `insert_at`; `move_to` only on `extra`, never with
`paired_with`, `pos` in range.

`compare_methods_to_ideal.py` (`npm run eval`) scores each method's marks against
the ideal — mark-level and pair-level precision/recall/F1, plus the outcome
metrics **Result** and **Assist Rate** (fraction of the student's gap-to-ideal an
applied method closes) — and writes `Method_Evaluation.xlsx`. This is the
empirical harness for matching changes.

---

## 8. Browser Rendering

`differentiator/index.js` applies the position marks directly with `<span>`
wrappers (`diffColorizePositions()`) — no re-tokenisation in the browser, so
`border` never highlights inside `border-box`.

| Label         | CSS variable         | Default        | Meaning                                   |
| ------------- | -------------------- | -------------- | ----------------------------------------- |
| `missing`     | `--clr-mark-missing` | Red `#e00`     | in teacher, absent from student           |
| `extra`       | `--clr-mark-extra`   | Blue `#00c`    | in student, never typed by teacher        |
| `ghost_extra` | `--clr-mark-ghost`   | Cyan `#3aa0e0` | in student; teacher typed then deleted it |
| `comment`     | `--clr-mark-comment` | Green `#4a4`   | token inside a comment                    |

Line backgrounds use faded variants (`--clr-mark-*-bg`); pair/swap/curated
highlights derive from the same `--clr-mark-*` palette (read once into
`MARK_COLORS` in `shared/diff-utils.js`), so a colour change happens in one place.

---

## 9. Parameters

| Parameter                  | Default    | Where                                   | Notes                                                                                    |
| -------------------------- | ---------- | --------------------------------------- | ---------------------------------------------------------------------------------------- |
| `_CONTEXT_K`               | 10         | LEO context window half-width           | larger = more disambiguation for repeated tokens, less precision when neighbours are far |
| `_CONTEXT_MATCH_THRESHOLD` | 0.8        | ghost promotion + swap pairing cutoff   | one knob, three sites (Phase-1 ghost keep, Phase-2 promotion, swap pairing)              |
| `_SWAP_TOKEN_SIM_WEIGHT`   | 0.2        | swap-pair token-text bonus              | additive boost so typo pairs clear the threshold                                         |
| `_DECAY`                   | 1.0 (off)  | LEO context decay; `leo*+` uses 0.70    | per-neighbour weight `_DECAY**(d-1)`                                                     |
| `_REAL_MATCH_TAU`          | None (off) | LEO real-match floor; `leo*+` uses 0.65 | drop real matches below this cosine                                                      |

Context vectors are uniform unigram count bags (no IDF). Constants live at the top
of `token_log_leo.py`; the `leo*+` knobs are flipped per student by
`leo_plus_config()`. `regen_test_fixtures.py` + `python -m unittest
test_lesson_tools` is the fastest way to detect a parameter change that breaks a
fixture.
