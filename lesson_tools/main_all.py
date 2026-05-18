import argparse
import subprocess
import sys
from pathlib import Path

from utils.cli_common import add_grading_flags, forward_grading_flags
from utils.folder_utils import pick_folder

ROOT_DIR = Path(__file__).resolve().parent
MAIN_PY = ROOT_DIR / "main.py"


def _pick_course_folder() -> Path | None:
    chosen = pick_folder(
        "Select course root folder (containing OverviewPlus.xlsx and lessons/)"
    )
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
    add_grading_flags(parser)
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
    return [sys.executable, str(MAIN_PY), str(lesson_dir), *forward_grading_flags(args)]


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
    flags = forward_grading_flags(args)
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
