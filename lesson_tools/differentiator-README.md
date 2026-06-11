# The Differentiator — How to Use It

The **differentiator** compares one student's submitted code against the
teacher's code and shows the differences as colored **marks**. You curate
those marks into a fix-list; from them the tool produces a **follow score**,
ready-made **correction instructions**, and a **validity check** that confirms
the corrections actually reproduce the teacher's program.

Unlike a plain `diff`, the teacher side is **reconstructed from the lesson key
log**, so it carries the order each token was typed and remembers code the
teacher typed and later deleted (**ghosts**) — neither recoverable from the
final file.

> For the matching internals (how the algorithmic marks are produced), see
> [`differentiator-algorithm.md`](differentiator-algorithm.md). This file is the
> *user* guide.

---

## 1. Opening it

**From the dashboard (the usual way).** In the overview, students, or timeline
tools, click a student. The differentiator opens for that student and lesson,
data already loaded. (Shift+click an id/name opens it in a new tab.)

**Standalone.** Run it from the repo root:

```powershell
npm run diff
```

Then load files with the two file pickers — teacher code files on the left,
the student's code files plus a `diff_marks_*.json` on the right.

**By URL.** The page accepts query params:
`?lesson=<name>&group=lessons&id=<sid>&mode=<basis>&title=<label>`
(`group` is `lessons` or `assignments`; `&embed=1` gives the read-only embedded
view used inside the students tool).

---

## 2. The screen

| Area | What it is |
| --- | --- |
| **Left panel** | The **teacher** reference (labelled *Starter Code* in embed mode). |
| **Right panel** | The **student**'s submission, with the follow **%** beside the name. |
| **File tabs** | One per code file, on each panel header. The active HTML tab drives the preview. |
| **◀ A / B ▶** (student header) | Previous / next student, with a position counter. |
| **Bottom bar** (fixed, bottom-right) | The **Mode dropdown** (the basis — §4) plus display toggles `⇲ Padding`, `Line №`, `🎨 Lang color`, `⬜ Preview`. In Ideal/Minimal mode it also grows the **📋 Copy Diff**, **💾 Download**, and **🪄 Corrections** buttons. |

---

## 3. Reading the marks

Four kinds of mark, each prescribing a correction:

- **missing** — teacher code the student doesn't have → *insert it*. Highlighted
  on the **teacher** side (per-language colored when `🎨 Lang color` is on).
- **extra** — code the student added that the teacher never typed → *remove it*.
  Highlighted on the **student** side.
- **ghost** (`ghost_extra`) — code the teacher typed then **deleted**, which the
  student kept → also removed, but it inherits the moment the teacher deleted it.
- **comment** — a difference inside a comment (free-form notes; excluded from the
  score).

**Connections** between marks carry the meaning:

- A **missing ↔ extra pair** (a substitution: the student wrote one thing where
  the teacher wrote another) is joined by a **dotted underline**.
- An unpaired missing shows a small **arrow marker** at the spot where it should
  be inserted (`insert_at`).
- An **extra** can be **relocated** instead of deleted (`move_to`).

---

## 4. Choosing a basis (the Mode dropdown)

The dropdown switches *which* marks you're looking at:

- **Minimal**, **Ideal** — the two **hand-curated** fix-lists (editable; see §5).
- **LEO\***, **LEO**, **LCS**, **Git**, … — **algorithmic** marks, produced
  automatically. Read-only; useful as a starting point.

A common workflow: glance at **LEO\*** to see the automatic suggestion, then
curate **Ideal** / **Minimal** by hand.

---

## 5. Curating marks (Ideal / Minimal modes)

When the mode is **Ideal** or **Minimal**, the marks become editable.

1. **Select a token** in either panel — or **drag-select a range** (a run of
   tokens, or even a pure-whitespace span when a space is missing/extra). A small
   **action panel** appears.
2. **Label it** with a button or a key (see the shortcut table). Teacher-side
   selections become **missing**; student-side become **extra** / **ghost**.
3. **Pair** a missing with an extra: select it, press **`p`**, then click the
   partner. Press **`r`** to unpair.
4. **Insert / relocate**: press **`i`** to anchor an unpaired missing (where it
   belongs) or to move an extra elsewhere.
5. **Delete** a mark with **`d`** / **Delete**.
6. **Undo / redo** with **Ctrl+Z** / **Ctrl+Y** (or Ctrl+Shift+Z).

The follow **%** in the student's title updates **live** as you edit, and the
**parity line** below the Corrections button (see §7) tells you whether your
corrections reproduce the teacher's tokens yet.

### Keyboard shortcuts

| Context | Key | Action |
| --- | --- | --- |
| Nothing selected | `m` / `i` / `l` | Switch basis to **Minimal** / **Ideal** / **LEO\*** |
| Token selected, teacher side | `m` | Mark **missing** |
| Token selected, student side | `e` | Mark **extra** |
| Token selected, student side | `g` | Mark **ghost** |
| Token selected | `c` | Mark **comment** |
| Token selected | `i` or `p` | **Insert** anchor / **Pair** (then click partner) |
| Token selected | `r` | **Remove** pair |
| Token selected | `d` / `Delete` / `Backspace` | **Delete** mark (Shift = include its pair / comments) |
| Any | `Esc` | Cancel a pending pair / close the panel |
| Any | `Ctrl+Z` / `Ctrl+Y` | Undo / redo |

> The same letters `m`/`i` mean *switch basis* when nothing is selected and
> *label a mark* when a token is selected — there's no clash because the two
> never apply at the same time.

---

## 6. Ideal vs. Minimal

You curate **two** fix-lists per student, same schema, different bar:

- **Ideal** = the **recommended** result. Marks *every* deviation from the
  teacher's solution (including best-practice nits like a missing `;`).
- **Minimal** = the **minimum** the student must fix for the program to work
  acceptably. Drops cosmetic differences (casing, optional semicolons, consistent
  renames, equivalent CSS values) and improvisations that don't break anything.

Use the **minimal** score when awarding the follow bonus — it stays encouraging.
By construction **minimal ⊆ ideal** (every minimal mark is also an ideal one); a
minimal mark is also an early-warning signal that the student likely couldn't
follow the rest of the lesson from that point.

---

## 7. The Corrections preview

Click **🪄 Corrections** (bottom bar, in curated mode). It applies your marks and
shows:

- **Full Code** / **Step-by-step** — the corrected file, or a numbered list of
  the individual fixes.
- **Result After Corrections** — a live render (iframe) of the corrected program,
  so you can confirm it works.
- A **token-parity line** below the Corrections button, updated live:
  - 🟢 **Same tokens & order** — the corrections reproduce the teacher's
    non-comment tokens exactly.
  - 🟠 **Same tokens · reordered** — same tokens, different (still-valid) order.
  - 🔴 **Δ +N · −M** — the corrections don't reproduce the teacher's tokens yet
    (N surplus, M missing). Aim for green/orange before you trust the marks.

Export the corrections as a **📸 Screenshot** (image — students can't copy-paste
it) or **🌐 HTML** (paste into a Moodle comment), or just use them as a scaffold
for written feedback.

---

## 8. Saving your work

- **💾 Download** writes `diff_marks_<mode>.json` — `diff_marks_ideal.json` in
  Ideal mode, `diff_marks_minimal.json` in Minimal mode.
- **📋 Copy Diff** copies that JSON to the clipboard.

In the grading pipeline, place the saved file in the student's
`curated/<sid>/` folder (`copy_curated_diff_marks` copies it into
`anon_ids/<sid>/` on the next `npm run main`). The differentiator reads
`anon_ids/<sid>/` directly.

---

## 9. Display toggles (bottom bar)

| Button | Effect |
| --- | --- |
| `⇲ Padding` | Line-align the two panels so matching lines sit across from each other. |
| `Line №` | Show line numbers. |
| `🎨 Lang color` | Color missing marks by language (HTML / CSS / JS / Py) instead of one color. |
| `⬜ Preview` | Render the active HTML file instead of showing its source. |

---

## Quick start

1. Open a student from the dashboard.
2. Switch the mode to **Minimal** (or **Ideal**).
3. Select tokens and label them (`m`/`e`/`g`/`c`), pairing substitutions with `p`.
4. Watch the follow **%** and the parity line until the corrections check out.
5. **🪄 Corrections** to preview/export, **💾 Download** to save
   `diff_marks_minimal.json`.
