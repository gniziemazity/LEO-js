import argparse
import subprocess
import sys
from pathlib import Path

from utils.cli_common import add_grading_flags, forward_grading_flags
from utils.folder_utils import PROJECT_GROUPS, resolve_course

ROOT_DIR = Path(__file__).resolve().parent
MAIN_PY = ROOT_DIR / "main.py"


def _parse_args(argv):
    parser = argparse.ArgumentParser(
        description="Run the grading pipeline on every lesson and assignment in a course folder"
    )
    parser.add_argument(
        "course",
        nargs="?",
        help="Course folder path (the one containing lessons/ and/or assignments/)",
    )
    add_grading_flags(parser)
    return parser.parse_args(argv)


def _project_dirs(course: Path) -> list[Path]:
    found: list[Path] = []
    for group in PROJECT_GROUPS:
        root = course / group
        if root.is_dir():
            found.extend(sorted(d for d in root.iterdir() if d.is_dir()))
    if not found:
        groups = " or ".join(f"'{g}/'" for g in PROJECT_GROUPS)
        print(f"error: no {groups} folder in {course}")
        sys.exit(1)
    return found


def _build_cmd(project_dir: Path, args) -> list[str]:
    return [sys.executable, str(MAIN_PY), str(project_dir), *forward_grading_flags(args)]


def main(argv=None) -> int:
    args = _parse_args(argv if argv is not None else sys.argv[1:])
    course = resolve_course(args.course)
    projects = _project_dirs(course)

    by_group: dict[str, list[str]] = {}
    for d in projects:
        by_group.setdefault(d.parent.name, []).append(d.name)

    separator = "#" * 70
    print(f"\n{separator}")
    print(f"  Course : {course.name}")
    print(f"  Path   : {course}")
    for group, names in by_group.items():
        print(f"  {group.capitalize():<11}: {len(names)} ({', '.join(names)})")
    flags = forward_grading_flags(args)
    print(f"  Flags  : {' '.join(flags) if flags else '(none)'}")
    print(separator)

    failed: list[tuple[str, int]] = []
    for i, project_dir in enumerate(projects, start=1):
        label = f"{project_dir.parent.name}/{project_dir.name}"
        print(f"\n{separator}")
        print(f"  Project {i}/{len(projects)}: {label}")
        print(separator)
        cmd = _build_cmd(project_dir, args)
        result = subprocess.run(cmd, cwd=str(ROOT_DIR))
        if result.returncode != 0:
            print(f"\n** {label} failed (exit code {result.returncode}) — continuing **")
            failed.append((label, result.returncode))

    print(f"\n{separator}")
    print(f"  Course pipeline complete: {len(projects) - len(failed)}/{len(projects)} project(s) succeeded")
    if failed:
        print("  Failed:")
        for name, code in failed:
            print(f"    - {name} (exit {code})")
    print(separator)

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
