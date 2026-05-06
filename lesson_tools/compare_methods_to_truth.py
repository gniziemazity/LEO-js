"""compare_methods_to_truth.py

Compare every diff_marks_<method>.json against diff_marks_truth.json across all
students in a chosen project folder, then write an Excel workbook with per-student
and aggregated metrics.

Run:
    python compare_methods_to_truth.py [PROJECT_DIR]

If PROJECT_DIR is omitted, a folder picker is shown. PROJECT_DIR should contain
student subfolders (e.g. anon_id directories). Teacher files are looked up in
PROJECT_DIR itself or PROJECT_DIR/reconstructed/. Output:
    PROJECT_DIR/methods_vs_truth.xlsx

For each (student, method, label) where label ∈ {missing, extra, ghost_extra}:
  * mark-level TP/FP/FN/TN with precision, recall, F1, accuracy
    (universe = all non-comment tokens in the relevant source files)
  * pair-level TP/FP/FN/TN measured on TP marks: does the method's pairing or
    insert-anchor on a correctly identified mark match the truth's? Comparison
    uses (file, start, end) of the partner — token text is not required to match.
"""

from __future__ import annotations

import json
import re
import sys
import tkinter as tk
from collections import defaultdict
from pathlib import Path
from tkinter import filedialog

try:
    import pandas as pd  # noqa: F401
except ImportError:
    print("error: pandas + openpyxl required. pip install pandas openpyxl",
          file=sys.stderr)
    sys.exit(1)


TRUTH_FILE = "diff_marks_truth.json"
LABELS = ("missing", "extra", "ghost_extra")
CODE_EXTS = (".html", ".htm", ".css", ".js")

_CHAR_TOKEN_RE = re.compile(r"[a-zA-Z0-9]+|[^\s]")
_COMMENT_RE = re.compile(r"/\*.*?\*/|<!--.*?-->|(?<!:)//[^\n]*", re.DOTALL)

METHOD_LABELS = {
    "leo_star":  "LEO*",
    "leo":       "LEO",
    "lcs_star":  "LCS*",
    "lcs":       "LCS",
    "lev_star":  "Lev*",
    "lev":       "Lev",
    "ro_star":   "R/O*",
    "ro":        "R/O",
    "git_star":  "Git*",
    "git":       "Git",
}


def _load_json(path: Path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="ignore").replace("\r\n", "\n")
    except Exception:
        return ""


def _non_comment_token_count(text: str) -> int:
    spans = [(m.start(), m.end()) for m in _COMMENT_RE.finditer(text)]
    n = 0
    for tm in _CHAR_TOKEN_RE.finditer(text):
        pos = tm.start()
        in_comment = False
        for lo, hi in spans:
            if lo <= pos < hi:
                in_comment = True
                break
            if pos < lo:
                break
        if not in_comment:
            n += 1
    return n


def _find_teacher_file(project_dir: Path, fname: str) -> Path | None:
    direct = project_dir / fname
    if direct.is_file():
        return direct
    reco = project_dir / "reconstructed" / fname
    if reco.is_file():
        return reco
    correct = project_dir / "correct" / fname
    if correct.is_file():
        return correct
    return None


def _find_student_file(student_dir: Path, fname: str) -> Path | None:
    p = student_dir / fname
    return p if p.is_file() else None


def _collect_marks(data):
    out = {lbl: defaultdict(dict) for lbl in LABELS}
    for fname, items in (data.get("teacher_files") or {}).items():
        for m in items or []:
            if m.get("label") == "missing" and "start" in m and "end" in m:
                out["missing"][fname][(m["start"], m["end"])] = m
    for fname, items in (data.get("student_files") or {}).items():
        for m in items or []:
            lbl = m.get("label")
            if lbl in ("extra", "ghost_extra") and "start" in m and "end" in m:
                out[lbl][fname][(m["start"], m["end"])] = m
    return out


def _pair_signature(mark, ignore_ghost_pairs: bool = False) -> tuple | None:
    pw = mark.get("paired_with")
    if isinstance(pw, dict):
        if pw.get("ghost"):
            if ignore_ghost_pairs:
                return None
            return ("pair", pw.get("file"), pw.get("start"), pw.get("end"), "ghost")
        return ("pair", pw.get("file"), pw.get("start"), pw.get("end"))
    ia = mark.get("insert_at")
    if isinstance(ia, dict):
        return ("insert", ia.get("file"), ia.get("pos"))
    return None


def _is_star_method(method_key: str) -> bool:
    return method_key.endswith("_star")


def _merge_marks(*by_file_dicts):
    out: dict = defaultdict(dict)
    for d in by_file_dicts:
        for fname, marks in d.items():
            out[fname].update(marks)
    return out


def _files_referenced(*data_objs) -> tuple[set, set]:
    teacher_files: set = set()
    student_files: set = set()
    for data in data_objs:
        if not data:
            continue
        for fname in (data.get("teacher_files") or {}):
            teacher_files.add(fname)
        for fname in (data.get("student_files") or {}):
            student_files.add(fname)
    return teacher_files, student_files


def _files_referenced_by_source(named_data: dict) -> tuple[dict, dict]:
    """Return ({teacher_fname: [sources]}, {student_fname: [sources]})."""
    teacher_src: dict = {}
    student_src: dict = {}
    for source, data in named_data.items():
        if not data:
            continue
        for fname in (data.get("teacher_files") or {}):
            teacher_src.setdefault(fname, []).append(source)
        for fname in (data.get("student_files") or {}):
            student_src.setdefault(fname, []).append(source)
    return teacher_src, student_src


def _universe_size(side: str, fname: str, project_dir: Path,
                   student_dir: Path, cache: dict) -> int:
    key = (side, fname) if side == "teacher" else (side, str(student_dir), fname)
    if key in cache:
        return cache[key]
    if side == "teacher":
        path = _find_teacher_file(project_dir, fname)
    else:
        path = _find_student_file(student_dir, fname)
    if not path:
        cache[key] = 0
        return 0
    n = _non_comment_token_count(_read_text(path))
    cache[key] = n
    return n


def _score_label_for_files(label, method_marks_by_file, truth_marks_by_file,
                           file_universe, ignore_ghost_pairs: bool = False):
    tp = fp = fn = tn = 0
    pair_tp = pair_fp = pair_fn = pair_tn = 0
    fnames = (
        set(method_marks_by_file) | set(truth_marks_by_file) | set(file_universe)
    )
    for fname in fnames:
        m = method_marks_by_file.get(fname, {})
        t = truth_marks_by_file.get(fname, {})
        m_keys = set(m)
        t_keys = set(t)
        tp_keys = m_keys & t_keys
        local_tp = len(tp_keys)
        local_fp = len(m_keys - t_keys)
        local_fn = len(t_keys - m_keys)
        univ = file_universe.get(fname, 0)
        local_tn = max(0, univ - local_tp - local_fp - local_fn)
        tp += local_tp
        fp += local_fp
        fn += local_fn
        tn += local_tn
        for k in tp_keys:
            ms = _pair_signature(m[k], ignore_ghost_pairs)
            ts = _pair_signature(t[k], ignore_ghost_pairs)
            if ms is None and ts is None:
                pair_tn += 1
            elif ms is None and ts is not None:
                pair_fn += 1
            elif ms is not None and ts is None:
                pair_fp += 1
            elif ms == ts:
                pair_tp += 1
            else:
                pair_fp += 1
                pair_fn += 1
    return {
        "TP": tp, "FP": fp, "FN": fn, "TN": tn,
        "Pair TP": pair_tp, "Pair FP": pair_fp,
        "Pair FN": pair_fn, "Pair TN": pair_tn,
    }


def _add_metrics(row):
    tp, fp, fn, tn = row["TP"], row["FP"], row["FN"], row["TN"]
    p = tp / (tp + fp) if (tp + fp) else 0.0
    r = tp / (tp + fn) if (tp + fn) else 0.0
    f = 2 * p * r / (p + r) if (p + r) else 0.0
    total = tp + fp + fn + tn
    acc = (tp + tn) / total if total else 0.0
    row["Precision"] = round(p, 4)
    row["Recall"] = round(r, 4)
    row["F1"] = round(f, 4)
    row["Accuracy"] = round(acc, 4)

    ptp, pfp, pfn, ptn = row["Pair TP"], row["Pair FP"], row["Pair FN"], row["Pair TN"]
    pp = ptp / (ptp + pfp) if (ptp + pfp) else 0.0
    pr = ptp / (ptp + pfn) if (ptp + pfn) else 0.0
    pf = 2 * pp * pr / (pp + pr) if (pp + pr) else 0.0
    ptotal = ptp + pfp + pfn + ptn
    pacc = (ptp + ptn) / ptotal if ptotal else 0.0
    row["Pair Precision"] = round(pp, 4)
    row["Pair Recall"] = round(pr, 4)
    row["Pair F1"] = round(pf, 4)
    row["Pair Accuracy"] = round(pacc, 4)


def _method_display_name(key: str) -> str:
    return METHOD_LABELS.get(key, key)


def _method_sort_key(key: str) -> tuple:
    order = list(METHOD_LABELS.keys())
    try:
        return (0, order.index(key))
    except ValueError:
        return (1, key)


def _list_methods(student_dir: Path) -> list[tuple[str, Path]]:
    out = []
    for entry in sorted(student_dir.iterdir()):
        name = entry.name
        if (
            entry.is_file()
            and name.startswith("diff_marks_")
            and name.endswith(".json")
            and name != TRUTH_FILE
        ):
            method = name[len("diff_marks_") : -len(".json")]
            out.append((method, entry))
    return out


def _list_students(project_dir: Path) -> list[Path]:
    return sorted(
        d for d in project_dir.iterdir()
        if d.is_dir() and (d / TRUTH_FILE).is_file()
    )


def _pick_project_dir() -> Path | None:
    root = tk.Tk()
    root.withdraw()
    root.update()
    chosen = filedialog.askdirectory(
        title="Select project folder containing student subfolders",
    )
    root.destroy()
    return Path(chosen) if chosen else None


_PER_STUDENT_COLS = [
    "Student", "Method", "Label",
    "TP", "FP", "FN", "TN",
    "Precision", "Recall", "F1", "Accuracy",
    "Pair TP", "Pair FP", "Pair FN", "Pair TN",
    "Pair Precision", "Pair Recall", "Pair F1", "Pair Accuracy",
]
_TOTALS_COLS = [
    "Method", "Label", "Students",
    "TP", "FP", "FN", "TN",
    "Precision", "Recall", "F1", "Accuracy",
    "Pair TP", "Pair FP", "Pair FN", "Pair TN",
    "Pair Precision", "Pair Recall", "Pair F1", "Pair Accuracy",
]


def evaluate(project_dir: Path) -> tuple[list[dict], list[dict]]:
    students = _list_students(project_dir)
    if not students:
        raise SystemExit(f"No student subfolders with {TRUTH_FILE} in {project_dir}")

    per_student: list[dict] = []
    aggregate: dict[tuple[str, str], dict] = {}
    methods_per_student_count: dict[tuple[str, str], int] = defaultdict(int)
    universe_cache: dict = {}

    for student_dir in students:
        student_id = student_dir.name
        truth_path = student_dir / TRUTH_FILE
        truth_data = _load_json(truth_path)
        truth_marks = _collect_marks(truth_data)

        methods = _list_methods(student_dir)
        if not methods:
            print(f"  {student_id}: no diff_marks_<method>.json siblings; skipping")
            continue
        method_names = ", ".join(_method_display_name(m) for m, _ in methods)
        print(f"  {student_id}: {len(methods)} method(s) — {method_names}")

        per_method_data = {}
        for method, mpath in methods:
            try:
                per_method_data[method] = _load_json(mpath)
            except Exception as e:
                print(f"  warn: failed to load {mpath}: {e}", file=sys.stderr)

        named_data = {"truth": truth_data, **per_method_data}
        teacher_src, student_src = _files_referenced_by_source(named_data)

        teacher_universe = {}
        for fname in teacher_src:
            n = _universe_size(
                "teacher", fname, project_dir, student_dir, universe_cache,
            )
            if n == 0 and not _find_teacher_file(project_dir, fname):
                srcs = ", ".join(_method_display_name(s) for s in teacher_src[fname])
                print(
                    f"  warn: skipping teacher-side {fname!r} for student "
                    f"{student_id} (referenced by {srcs}; file not found)",
                    file=sys.stderr,
                )
                continue
            teacher_universe[fname] = n

        student_universe = {}
        for fname in student_src:
            n = _universe_size(
                "student", fname, project_dir, student_dir, universe_cache,
            )
            if n == 0 and not _find_student_file(student_dir, fname):
                srcs = ", ".join(_method_display_name(s) for s in student_src[fname])
                print(
                    f"  warn: skipping student-side {fname!r} for student "
                    f"{student_id} (referenced by {srcs}; file not found)",
                    file=sys.stderr,
                )
                continue
            student_universe[fname] = n

        def _filter_marks(marks_by_file, allowed):
            return {f: m for f, m in marks_by_file.items() if f in allowed}

        truth_marks = {
            lbl: _filter_marks(
                truth_marks[lbl],
                teacher_universe if lbl == "missing" else student_universe,
            )
            for lbl in truth_marks
        }

        for method, mdata in per_method_data.items():
            method_marks = _collect_marks(mdata)
            method_marks = {
                lbl: _filter_marks(
                    method_marks[lbl],
                    teacher_universe if lbl == "missing" else student_universe,
                )
                for lbl in method_marks
            }
            is_star = _is_star_method(method)

            label_specs: list[tuple[str, dict, dict, dict, bool]] = []
            label_specs.append((
                "missing",
                method_marks["missing"],
                truth_marks["missing"],
                teacher_universe,
                False,
            ))
            if is_star:
                label_specs.append((
                    "extra",
                    method_marks["extra"],
                    truth_marks["extra"],
                    student_universe,
                    False,
                ))
                label_specs.append((
                    "ghost_extra",
                    method_marks["ghost_extra"],
                    truth_marks["ghost_extra"],
                    student_universe,
                    False,
                ))
            else:
                label_specs.append((
                    "extra (incl. ghost)",
                    _merge_marks(method_marks["extra"], method_marks["ghost_extra"]),
                    _merge_marks(truth_marks["extra"], truth_marks["ghost_extra"]),
                    student_universe,
                    True,
                ))

            for label, m_marks, t_marks, universe, ignore_ghost_pairs in label_specs:
                stats = _score_label_for_files(
                    label, m_marks, t_marks, universe,
                    ignore_ghost_pairs=ignore_ghost_pairs,
                )
                row = {
                    "Student": student_id,
                    "Method": _method_display_name(method),
                    "_method_key": method,
                    "Label": label,
                    **stats,
                }
                _add_metrics(row)
                per_student.append(row)

                key = (method, label)
                agg = aggregate.setdefault(key, {
                    "TP": 0, "FP": 0, "FN": 0, "TN": 0,
                    "Pair TP": 0, "Pair FP": 0, "Pair FN": 0, "Pair TN": 0,
                })
                for k in ("TP", "FP", "FN", "TN",
                         "Pair TP", "Pair FP", "Pair FN", "Pair TN"):
                    agg[k] += stats[k]
                methods_per_student_count[key] += 1

    totals: list[dict] = []
    for (method, label), stats in aggregate.items():
        row = {
            "Method": _method_display_name(method),
            "_method_key": method,
            "Label": label,
            "Students": methods_per_student_count[(method, label)],
            **stats,
        }
        _add_metrics(row)
        totals.append(row)

    label_order = {
        "missing": 0,
        "extra": 1,
        "extra (incl. ghost)": 1,
        "ghost_extra": 2,
    }
    per_student.sort(key=lambda r: (
        r["Student"],
        _method_sort_key(r["_method_key"]),
        label_order.get(r["Label"], 99),
    ))
    totals.sort(key=lambda r: (
        _method_sort_key(r["_method_key"]),
        label_order.get(r["Label"], 99),
    ))

    return per_student, totals


def write_excel(out_path: Path, per_student: list[dict], totals: list[dict]) -> None:
    import pandas as pd

    ps_df = pd.DataFrame(
        [{c: r.get(c, "") for c in _PER_STUDENT_COLS} for r in per_student],
        columns=_PER_STUDENT_COLS,
    )
    tot_df = pd.DataFrame(
        [{c: r.get(c, "") for c in _TOTALS_COLS} for r in totals],
        columns=_TOTALS_COLS,
    )

    with pd.ExcelWriter(out_path, engine="openpyxl") as writer:
        tot_df.to_excel(writer, sheet_name="Totals", index=False)
        ps_df.to_excel(writer, sheet_name="Per Student", index=False)
        for sheet_name, df in (("Totals", tot_df), ("Per Student", ps_df)):
            ws = writer.sheets[sheet_name]
            for col_idx, col in enumerate(df.columns, start=1):
                max_len = max(
                    [len(str(col))]
                    + [len(str(v)) for v in df[col].tolist()]
                )
                ws.column_dimensions[ws.cell(row=1, column=col_idx).column_letter].width = min(
                    max(max_len + 2, 10), 32
                )
            ws.freeze_panes = "A2"


def main(argv: list[str]) -> int:
    if len(argv) > 1:
        project_dir = Path(argv[1]).resolve()
        if not project_dir.is_dir():
            print(f"error: {project_dir} is not a directory", file=sys.stderr)
            return 1
    else:
        project_dir = _pick_project_dir()
        if project_dir is None:
            print("No folder selected.")
            return 0

    print(f"Project: {project_dir}")
    per_student, totals = evaluate(project_dir)
    if not per_student:
        print("No methods to compare.")
        return 0

    out_path = project_dir / "methods_vs_truth.xlsx"
    write_excel(out_path, per_student, totals)
    print(f"Wrote {out_path}")
    print(f"  {len(per_student)} per-student rows  ·  {len(totals)} totals rows")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
