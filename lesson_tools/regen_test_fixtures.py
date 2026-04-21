import json
import sys
from pathlib import Path
from collections import Counter

_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(_ROOT))

from utils import similarity_measures as _sm
from utils.similarity_measures import (
    reconstruct_tokens_from_keylog_full,
    get_reconstructed_files,
)
from utils.token_log import (
    _build_file_timeline,
    _file_at_ts,
    _parse_teacher_tokens,
    _extract_student_ci_split,
    _build_student_token_occurrences,
    _build_contextual_diff_marks,
    _colors_to_position_marks,
    _build_ghost_contexts,
    _CONTEXT_K,
    _GHOST_K,
    ts_to_local,
)

_TEST = _ROOT / "test"

_CASES = [
    ("wall",    True,  ["student_a", "student_b", "student_c", "student_d"], True),
    ("chess",   True,  ["student_a", "student_b", "student_c", "student_d"], True),
    ("js",      True,  ["student_a", "student_b"], True),
    ("qr",      True,  [], True),
    ("sorting", True,  ["student_a", "student_b"], True),
]

_DIFF_MARKS_CASES = [
    ("wall",    "student_c"),
    ("wall",    "student_d"),
    ("chess",   "student_b"),
    ("chess",   "student_c"),
    ("chess",   "student_d"),
    ("sorting", "student_a"),
    ("sorting", "student_b"),
]


def _load_events(log_path: Path) -> list:
    with open(log_path, encoding="utf-8") as f:
        return json.load(f)["events"]


def regen_teacher_tokens(case_dir: Path, has_css: bool) -> None:
    log_path = case_dir / "log.json"
    if not log_path.exists():
        print(f"  SKIP (no log.json): {case_dir.name}")
        return

    events = _load_events(log_path)
    kw_ts_cs, kw_ts_ci, kw_ts_ci_comment, removed_kw_ts_ci, upper_to_display, ci_occ_with_display = (
        reconstruct_tokens_from_keylog_full(events, has_css=has_css)
    )

    all_occ = []
    for ci_key in kw_ts_ci:
        occ_sorted = sorted(ci_occ_with_display.get(ci_key, []))
        comment_ts_set = set(kw_ts_ci_comment.get(ci_key, []))
        for ts, disp in occ_sorted:
            all_occ.append((ts, 0, disp, ts in comment_ts_set, False))
    for ci_key, ts_list in removed_kw_ts_ci.items():
        disp = upper_to_display.get(ci_key, ci_key)
        for ins_ts, del_ts in ts_list:
            all_occ.append((ins_ts, del_ts, disp, False, True))
    all_occ.sort(key=lambda x: x[0])

    n_typed   = sum(1 for *_, is_removed in all_occ if not is_removed)
    n_removed = sum(1 for *_, is_removed in all_occ if is_removed)

    file_timeline   = _build_file_timeline(events)
    has_multi_files = {f for _, f in file_timeline} - {"MAIN"}

    out = case_dir / "tokens.txt"
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(f"# Occurrences: {n_typed}\n")
        fh.write(f"# Removed    : {n_removed}\n")
        fh.write(f"# Unique     : {len(kw_ts_ci)}\n")
        for ins_ts, del_ts, token, is_comment, is_removed in all_occ:
            flags = []
            if is_comment:
                flags.append("COMMENT")
            if is_removed:
                flags.append("REMOVED")
            file_col    = f"\t{_file_at_ts(ins_ts, file_timeline)}" if has_multi_files else ""
            removal_col = f"\t{ts_to_local(del_ts)}" if is_removed else ""
            flag_col    = ("\t" + "\t".join(flags)) if flags else ""
            fh.write(f"{token}\t{ts_to_local(ins_ts)}{file_col}{flag_col}{removal_col}\n")
    print(f"  {case_dir.name}/tokens.txt  ({n_typed} occ, {n_removed} removed, {len(kw_ts_ci)} unique)")


def regen_reconstructed(case_dir: Path) -> None:
    log_path = case_dir / "log.json"
    if not log_path.exists():
        return
    events = _load_events(log_path)
    reco_files = get_reconstructed_files(events)
    for tab_key, text in reco_files.items():
        name = "reconstructed.html" if tab_key == "MAIN" else tab_key
        out = case_dir / name
        out.write_text(text, encoding="utf-8")
        print(f"  {case_dir.name}/{name}  ({len(text)} chars)")


def regen_student_tokens(case_dir: Path, student_name: str) -> None:
    teacher_tokens_path = case_dir / "tokens.txt"
    if not teacher_tokens_path.exists():
        print(f"  SKIP (no teacher tokens.txt): {case_dir.name}/{student_name}")
        return

    student_dir = case_dir / student_name
    if not student_dir.is_dir():
        print(f"  SKIP (no dir): {case_dir.name}/{student_name}")
        return

    teacher_entries = _parse_teacher_tokens(teacher_tokens_path)

    stu_files = {}
    for f in sorted(student_dir.iterdir()):
        ext = f.suffix.lower()
        if ext in (".html", ".htm", ".css", ".js"):
            stu_files[f.name] = f

    if not stu_files:
        print(f"  SKIP (no code files): {case_dir.name}/{student_name}")
        return

    stu_outside, stu_comment = _extract_student_ci_split(stu_files)
    all_occ, n_found, n_missing, n_extra, follow_e_pct, _ = _build_student_token_occurrences(
        teacher_entries, stu_outside, stu_comment
    )

    out = student_dir / "tokens.txt"
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(f"# Found            : {n_found}\n")
        fh.write(f"# MISSING          : {n_missing}\n")
        fh.write(f"# EXTRA            : {n_extra}\n")
        fh.write(f"# Follow (E)       : {follow_e_pct} %\n")
        for ts, token, flags in all_occ:
            flag_str = "\t".join(sorted(flags))
            suffix   = f"\t{flag_str}" if flag_str else ""
            fh.write(f"{token}\t{ts}{suffix}\n")
    print(f"  {case_dir.name}/{student_name}/tokens.txt  (found={n_found}, miss={n_missing}, extra={n_extra})")


def regen_diff_marks(case_dir: Path, student_name: str) -> None:
    teacher_tokens_path = case_dir / "tokens.txt"
    if not teacher_tokens_path.exists():
        print(f"  SKIP diff_marks (no teacher tokens.txt): {case_dir.name}/{student_name}")
        return

    teacher_entries = _parse_teacher_tokens(teacher_tokens_path)

    teacher_files = {}
    for f in sorted(case_dir.iterdir()):
        ext = f.suffix.lower()
        if ext in (".html", ".htm", ".css", ".js"):
            teacher_files[f.name] = f

    reco_dir = case_dir / "reconstructed"
    if reco_dir.is_dir():
        for f in sorted(reco_dir.iterdir()):
            ext = f.suffix.lower()
            if ext in (".html", ".htm", ".css", ".js"):
                teacher_files[f.name] = f

    reco_html = case_dir / "reconstructed.html"
    if reco_html.exists():
        teacher_files["reconstructed.html"] = reco_html

    student_dir = case_dir / student_name
    stu_files = {}
    for f in sorted(student_dir.iterdir()):
        ext = f.suffix.lower()
        if ext in (".html", ".htm", ".css", ".js"):
            stu_files[f.name] = f

    stu_outside, stu_comment = _extract_student_ci_split(stu_files)
    all_occ, _, _, _, _, consumed = _build_student_token_occurrences(
        teacher_entries, stu_outside, stu_comment
    )

    removed_keys = {tok for tok, _, _, is_rem, *_ in teacher_entries if is_rem}
    log_path = case_dir / "log.json"
    ghost_ctx = None
    if log_path.exists() and removed_keys and _sm._ALL_EXTRA_STAR:
        events = _load_events(log_path)
        ghost_ctx = _build_ghost_contexts(events, removed_keys, k=_GHOST_K)

    tf_colors, sf_colors = _build_contextual_diff_marks(
        teacher_files, stu_files, teacher_entries,
        stu_outside, stu_comment,
        context_k=_CONTEXT_K,
        ghost_contexts=ghost_ctx,
    )

    diff_marks = {
        "format_version": 4,
        "token_matching": "context-cosine-hungarian",
        "case_sensitive": True,
        "teacher_files": _colors_to_position_marks(teacher_files, tf_colors),
        "student_files": _colors_to_position_marks(stu_files, sf_colors),
    }
    diff_path = student_dir / "diff_marks.json"
    with open(diff_path, "w", encoding="utf-8") as fh:
        json.dump(diff_marks, fh, ensure_ascii=False, indent=2)

    print(f"  {case_dir.name}/{student_name}/diff_marks.json")


def main():
    print("Regenerating test fixtures...\n")

    _sm._ALL_EXTRA_STAR = True

    for dir_name, has_css, students, regen_reco in _CASES:
        case_dir = _TEST / dir_name
        print(f"[{dir_name}]")

        regen_teacher_tokens(case_dir, has_css)

        if regen_reco:
            regen_reconstructed(case_dir)

        for student in students:
            regen_student_tokens(case_dir, student)

        print()

    print("[diff_marks]")
    for dir_name, student_name in _DIFF_MARKS_CASES:
        regen_diff_marks(_TEST / dir_name, student_name)

    print("\nDone.")


if __name__ == "__main__":
    main()
