import json
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(_ROOT))

from utils.similarity_measures import (
    reconstruct_tokens_from_keylog_full,
    get_reconstructed_files,
)
from utils.token_log import (
    _build_file_timeline,
    _file_at_ts,
    _parse_teacher_tokens,
    _build_leo_diff_marks,
    _add_log_metadata,
    _build_occ_from_diff_marks,
    _strip_internal_fields,
    ts_to_local,
)

_TEST = _ROOT / "test"

# (dir_name, has_css, regen_reco)
# Students are auto-discovered from student_* subdirectories — no hardcoded lists needed.
_CASES = [
    ("wall",    True,  True),
    ("chess",   True,  True),
    ("js",      True,  True),
    ("qr",      True,  True),
    ("sorting", True,  True),
]

_CODE_EXTS = {".html", ".htm", ".css", ".js"}


def _student_dirs(case_dir: Path) -> list[Path]:
    result = []
    for d in sorted(case_dir.iterdir()):
        if d.is_dir() and d.name.startswith("student_"):
            if any(f.suffix.lower() in _CODE_EXTS for f in d.iterdir()):
                result.append(d)
    return result


def _load_events(log_path: Path) -> list:
    with open(log_path, encoding="utf-8") as f:
        return json.load(f)["events"]


def _collect_teacher_files(case_dir: Path) -> dict:
    files = {}
    for f in sorted(case_dir.iterdir()):
        if f.suffix.lower() in _CODE_EXTS:
            files[f.name] = f
    reco_dir = case_dir / "reconstructed"
    if reco_dir.is_dir():
        for f in sorted(reco_dir.iterdir()):
            if f.suffix.lower() in _CODE_EXTS:
                files[f.name] = f
    reco_html = case_dir / "reconstructed.html"
    if reco_html.exists():
        files["reconstructed.html"] = reco_html
    return files


def _collect_student_files(student_dir: Path) -> dict:
    return {
        f.name: f
        for f in sorted(student_dir.iterdir())
        if f.suffix.lower() in _CODE_EXTS
    }


def regen_teacher_tokens(case_dir: Path, has_css: bool) -> None:
    log_path = case_dir / "log.json"
    if not log_path.exists():
        print(f"  SKIP (no log.json): {case_dir.name}")
        return

    events = _load_events(log_path)
    kw_ts, kw_ts_comment, removed_kw_ts, upper_to_display, occ_with_display = (
        reconstruct_tokens_from_keylog_full(events, has_css=has_css)
    )

    all_occ = []
    for tok in kw_ts:
        occ_sorted = sorted(occ_with_display.get(tok, []))
        comment_ts_set = set(kw_ts_comment.get(tok, []))
        for ts, disp in occ_sorted:
            all_occ.append((ts, 0, disp, ts in comment_ts_set, False))
    for tok, ts_list in removed_kw_ts.items():
        disp = upper_to_display.get(tok, tok)
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
        fh.write(f"# Unique     : {len(kw_ts)}\n")
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
    print(f"  {case_dir.name}/tokens.txt  ({n_typed} occ, {n_removed} removed, {len(kw_ts)} unique)")


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


def regen_student(case_dir: Path, student_name: str) -> None:
    teacher_tokens_path = case_dir / "tokens.txt"
    if not teacher_tokens_path.exists():
        print(f"  SKIP (no teacher tokens.txt): {case_dir.name}/{student_name}")
        return

    student_dir = case_dir / student_name
    if not student_dir.is_dir():
        print(f"  SKIP (no dir): {case_dir.name}/{student_name}")
        return

    teacher_entries = _parse_teacher_tokens(teacher_tokens_path)
    teacher_files   = _collect_teacher_files(case_dir)
    stu_files       = _collect_student_files(student_dir)

    if not stu_files:
        print(f"  SKIP (no code files): {case_dir.name}/{student_name}")
        return

    removal_ts_by_token = {
        tok: removal_ts
        for tok, _, _, is_rem, removal_ts in teacher_entries
        if is_rem and removal_ts
    }

    t_marks, s_marks, _, alignments, _, _ = _build_leo_diff_marks(teacher_files, stu_files)

    diff_marks = {
        "teacher_files": t_marks,
        "student_files": s_marks,
    }

    log_path = case_dir / "log.json"
    if log_path.exists():
        _add_log_metadata(
            diff_marks, _load_events(log_path), stu_files,
        )

    all_occ, score_e, _score_c, n_found, n_missing, n_extra, _n_extra_star = (
        _build_occ_from_diff_marks(diff_marks, teacher_entries, removal_ts_by_token or None)
    )

    diff_marks_out = {
        "token_matching": "leo_star",
        "score": score_e,
        "teacher_files": diff_marks["teacher_files"],
        "student_files": diff_marks["student_files"],
    }
    if alignments:
        diff_marks_out["alignments"] = alignments
    _strip_internal_fields(diff_marks_out)

    out = student_dir / "tokens.txt"
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(f"# Found            : {n_found}\n")
        fh.write(f"# MISSING          : {n_missing}\n")
        fh.write(f"# EXTRA            : {n_extra}\n")
        fh.write(f"# Follow (E)       : {score_e} %\n")
        for ts, token, flags in all_occ:
            flag_str = "\t".join(sorted(flags))
            suffix   = f"\t{flag_str}" if flag_str else ""
            fh.write(f"{token}\t{ts}{suffix}\n")

    diff_path = student_dir / "diff_marks_leo_star.json"
    with open(diff_path, "w", encoding="utf-8") as fh:
        json.dump(diff_marks_out, fh, ensure_ascii=False, indent=2)

    print(f"  {case_dir.name}/{student_name}/tokens.txt + diff_marks_leo_star.json"
          f"  (found={n_found}, miss={n_missing}, extra={n_extra}, score={score_e})")


def main():
    print("Regenerating test fixtures...\n")

    for dir_name, has_css, regen_reco in _CASES:
        case_dir = _TEST / dir_name
        print(f"[{dir_name}]")

        regen_teacher_tokens(case_dir, has_css)

        if regen_reco:
            regen_reconstructed(case_dir)

        for student_dir in _student_dirs(case_dir):
            regen_student(case_dir, student_dir.name)

        print()

    print("Done.")


if __name__ == "__main__":
    main()
