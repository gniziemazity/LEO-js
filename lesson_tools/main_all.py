import argparse
import subprocess
import sys
import tkinter as tk
from pathlib import Path
from tkinter import filedialog

ROOT_DIR = Path(__file__).resolve().parent
MAIN_PY = ROOT_DIR / "main.py"


def _pick_course_folder() -> Path | None:
    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    root.update()
    chosen = filedialog.askdirectory(
        title="Select course root folder (containing OverviewPlus.xlsx and lessons/)"
    )
    root.destroy()
    return Path(chosen).resolve() if chosen else None


def _parse_args(argv):
    parser = argparse.ArgumentParser(
        description="Run the grading pipeline on every lesson in a course folder"
    )
    parser.add_argument(
        "course",
        nargs="?",
        help="Course folder path (the one containing OverviewPlus.xlsx and lessons/)",
    )
    parser.add_argument(
        "--anon",
        action="store_true",
        help="Forwarded to main.py: use Alter Ego names",
    )
    parser.add_argument(
        "--follow-basis",
        default="auto",
        help="Forwarded to main.py: ideal | required | leo_star | leo | ... (default: auto)",
    )
    return parser.parse_args(argv)


def _resolve_course(course_arg) -> Path:
    if course_arg:
        course = Path(course_arg)
        if not course.is_dir():
            print(f"Course folder not found: {course_arg}")
            sys.exit(1)
        return course.resolve()
    picked = _pick_course_folder()
    if picked is None or not picked.is_dir():
        print("No course folder selected. Aborting.")
        sys.exit(1)
    return picked


def _lesson_dirs(course: Path) -> list[Path]:
    lessons_root = course / "lessons"
    if not lessons_root.is_dir():
        print(f"error: no 'lessons/' folder in {course}")
        sys.exit(1)
    return sorted(d for d in lessons_root.iterdir() if d.is_dir())


def _build_cmd(lesson_dir: Path, args) -> list[str]:
    cmd = [sys.executable, str(MAIN_PY), str(lesson_dir)]
    if args.anon:
        cmd.append("--anon")
    if args.follow_basis and args.follow_basis != "auto":
        cmd.append(f"--follow-basis={args.follow_basis}")
    return cmd


def main(argv=None) -> int:
    args = _parse_args(argv if argv is not None else sys.argv[1:])
    course = _resolve_course(args.course)
    lessons = _lesson_dirs(course)

    if not lessons:
        print(f"No lesson subfolders found under {course / 'lessons'}")
        return 1

    separator = "#" * 70
    print(f"\n{separator}")
    print(f"  Course : {course.name}")
    print(f"  Path   : {course}")
    print(f"  Lessons: {len(lessons)} ({', '.join(l.name for l in lessons)})")
    flags = []
    if args.anon:
        flags.append("--anon")
    if args.follow_basis and args.follow_basis != "auto":
        flags.append(f"--follow-basis={args.follow_basis}")
    print(f"  Flags  : {' '.join(flags) if flags else '(none)'}")
    print(separator)

    failed: list[tuple[str, int]] = []
    for i, lesson_dir in enumerate(lessons, start=1):
        print(f"\n{separator}")
        print(f"  Lesson {i}/{len(lessons)}: {lesson_dir.name}")
        print(separator)
        cmd = _build_cmd(lesson_dir, args)
        result = subprocess.run(cmd, cwd=str(ROOT_DIR))
        if result.returncode != 0:
            print(f"\n** Lesson {lesson_dir.name} failed (exit code {result.returncode}) — continuing **")
            failed.append((lesson_dir.name, result.returncode))

    print(f"\n{separator}")
    print(f"  Course pipeline complete: {len(lessons) - len(failed)}/{len(lessons)} lessons succeeded")
    if failed:
        print("  Failed lessons:")
        for name, code in failed:
            print(f"    - {name} (exit {code})")
    print(separator)

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
