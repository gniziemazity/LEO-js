"""
score_against_truth.py — compare a method's diff_marks against ground truth.

Usage:
    python score_against_truth.py [TEST_ROOT]

TEST_ROOT defaults to "test/". The script walks every project/student under it,
loads diff_marks_truth.json (skipping students that lack one), and compares each
available diff_marks_<method>.json against the truth. Per-label precision /
recall / F1 are reported per student and aggregated overall.

A "mark" is identified by (file, label, start, end). Two marks match iff all
four agree. Token text is ignored (truth files might tokenize slightly
differently in edge cases — position is the source of truth). Swap pairing is
scored by checking the unordered pair of (start_a, start_b) endpoints.
"""

import json
import os
import sys
from collections import defaultdict


TRUTH_FILE = "diff_marks_truth.json"
LABELS = ("missing", "extra", "ghost_extra")


def _load(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _collect_marks(data):
    marks = defaultdict(set)
    teacher = data.get("teacher_files", {}) or {}
    student = data.get("student_files", {}) or {}

    for fname, items in teacher.items():
        for m in items:
            label = m.get("label")
            if label == "missing":
                marks["missing"].add((fname, m["start"], m["end"]))

    for fname, items in student.items():
        for m in items:
            label = m.get("label")
            if label in ("extra", "ghost_extra"):
                marks[label].add((fname, m["start"], m["end"]))

    swaps = set()
    for fname, items in teacher.items():
        for m in items:
            partner = m.get("paired_with")
            if not isinstance(partner, dict):
                continue
            here = (fname, m["start"], m["end"])
            there = (partner["file"], partner["start"], partner["end"])
            swaps.add(frozenset({here, there}))

    return marks, swaps


def _prf(tp, fp, fn):
    p = tp / (tp + fp) if (tp + fp) else 0.0
    r = tp / (tp + fn) if (tp + fn) else 0.0
    f = 2 * p * r / (p + r) if (p + r) else 0.0
    return p, r, f


def _score(method_marks, truth_marks, method_swaps, truth_swaps):
    rows = {}
    for label in LABELS:
        m = method_marks.get(label, set())
        t = truth_marks.get(label, set())
        tp = len(m & t)
        fp = len(m - t)
        fn = len(t - m)
        rows[label] = {"tp": tp, "fp": fp, "fn": fn,
                       "p": _prf(tp, fp, fn)[0],
                       "r": _prf(tp, fp, fn)[1],
                       "f1": _prf(tp, fp, fn)[2]}

    tp = len(method_swaps & truth_swaps)
    fp = len(method_swaps - truth_swaps)
    fn = len(truth_swaps - method_swaps)
    rows["swap"] = {"tp": tp, "fp": fp, "fn": fn,
                    "p": _prf(tp, fp, fn)[0],
                    "r": _prf(tp, fp, fn)[1],
                    "f1": _prf(tp, fp, fn)[2]}
    return rows


def _all_methods(student_dir):
    out = []
    for entry in sorted(os.listdir(student_dir)):
        if entry.startswith("diff_marks_") and entry.endswith(".json") \
                and entry != TRUTH_FILE:
            method = entry[len("diff_marks_"):-len(".json")]
            out.append((method, os.path.join(student_dir, entry)))
    return out


def _walk(test_root):
    for proj in sorted(os.listdir(test_root)):
        proj_dir = os.path.join(test_root, proj)
        if not os.path.isdir(proj_dir):
            continue
        for student in sorted(os.listdir(proj_dir)):
            sd = os.path.join(proj_dir, student)
            if not os.path.isdir(sd):
                continue
            truth_path = os.path.join(sd, TRUTH_FILE)
            if not os.path.isfile(truth_path):
                continue
            yield proj, student, sd, truth_path


def _fmt_row(label, row, width=12):
    return (f"  {label:<{width}}"
            f"  P={row['p']*100:5.1f}%  R={row['r']*100:5.1f}%"
            f"  F1={row['f1']*100:5.1f}%"
            f"  (tp={row['tp']:3d} fp={row['fp']:3d} fn={row['fn']:3d})")


def main(argv):
    test_root = argv[1] if len(argv) > 1 else "test"
    if not os.path.isdir(test_root):
        print(f"error: {test_root} is not a directory", file=sys.stderr)
        return 1

    aggregate = defaultdict(lambda: defaultdict(
        lambda: {"tp": 0, "fp": 0, "fn": 0}))
    student_count = defaultdict(int)
    truth_total = 0

    for proj, student, sd, truth_path in _walk(test_root):
        truth_total += 1
        truth_data = _load(truth_path)
        truth_marks, truth_swaps = _collect_marks(truth_data)

        methods = _all_methods(sd)
        if not methods:
            continue

        print(f"\n=== {proj}/{student} ===")
        truth_summary = (
            f"truth: missing={len(truth_marks['missing'])}, "
            f"extra={len(truth_marks['extra'])}, "
            f"ghost_extra={len(truth_marks['ghost_extra'])}, "
            f"swaps={len(truth_swaps)}")
        print(f"  {truth_summary}")
        for method, mpath in methods:
            method_data = _load(mpath)
            method_marks, method_swaps = _collect_marks(method_data)
            rows = _score(method_marks, truth_marks, method_swaps, truth_swaps)
            print(f"  -- {method} --")
            for label in (*LABELS, "swap"):
                print(_fmt_row(label, rows[label]))
            student_count[method] += 1
            for label, row in rows.items():
                agg = aggregate[method][label]
                agg["tp"] += row["tp"]
                agg["fp"] += row["fp"]
                agg["fn"] += row["fn"]

    if truth_total == 0:
        print(f"\nNo {TRUTH_FILE} files found under {test_root}.")
        return 0

    print(f"\n\n=== AGGREGATE (over {truth_total} students with truth) ===")
    method_order = sorted(aggregate.keys())
    for method in method_order:
        print(f"\n{method}  (covered {student_count[method]} students)")
        for label in (*LABELS, "swap"):
            agg = aggregate[method][label]
            p, r, f = _prf(agg["tp"], agg["fp"], agg["fn"])
            print(f"  {label:<12}"
                  f"  P={p*100:5.1f}%  R={r*100:5.1f}%  F1={f*100:5.1f}%"
                  f"  (tp={agg['tp']:4d} fp={agg['fp']:4d} fn={agg['fn']:4d})")

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
