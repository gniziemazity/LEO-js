from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from utils.folder_utils import pick_folder

_GROUPS = ("lessons", "assignments")
_PII_FILES = {"students.csv", "name_map.csv"}
_SKIP_DIR_NAMES = {"__pycache__", ".git", ".venv", "node_modules"}
_SKIP_FILE_NAMES = {".DS_Store", "Thumbs.db"}


def _is_hidden(path: Path) -> bool:
    return path.name.startswith(".") and path.name not in {".gitignore"}


def _list_files_relative(root: Path) -> list[str]:
    out: list[str] = []
    for p in sorted(root.rglob("*")):
        if p.is_dir():
            if p.name in _SKIP_DIR_NAMES:
                continue
            continue
        if any(part in _SKIP_DIR_NAMES for part in p.relative_to(root).parts):
            continue
        if p.name in _SKIP_FILE_NAMES:
            continue
        if _is_hidden(p):
            continue
        out.append(p.relative_to(root).as_posix())
    return out


def _list_root_files(course: Path, *, exclude_pii: bool) -> list[str]:
    out: list[str] = []
    for p in sorted(course.iterdir()):
        if p.is_dir():
            continue
        if p.name in _SKIP_FILE_NAMES or _is_hidden(p):
            continue
        if exclude_pii and p.name in _PII_FILES:
            continue
        out.append(p.name)
    return out


def _build_lesson_entry(lesson_dir: Path) -> dict:
    files = _list_files_relative(lesson_dir)
    students: list[str] = []
    anon = lesson_dir / "anon_ids"
    if anon.is_dir():
        students = sorted(d.name for d in anon.iterdir() if d.is_dir())
    return {"students": students, "files": files}


def _build_group(group_dir: Path) -> dict:
    if not group_dir.is_dir():
        return {}
    out: dict = {}
    for d in sorted(group_dir.iterdir()):
        if not d.is_dir():
            continue
        out[d.name] = _build_lesson_entry(d)
    return out


def _build_manifest(course: Path, *, exclude_pii: bool) -> dict:
    manifest = {
        "rootName": course.name,
        "rootFiles": _list_root_files(course, exclude_pii=exclude_pii),
        "groups": {},
    }
    for g in _GROUPS:
        entries = _build_group(course / g)
        if entries:
            manifest["groups"][g] = entries
    return manifest


def _resolve_course(course_arg) -> Path:
    if course_arg:
        course = Path(course_arg)
        if not course.is_dir():
            print(f"Course folder not found: {course_arg}")
            sys.exit(1)
        return course.resolve()
    picked = pick_folder(
        "Select course root folder (containing lessons/ and/or assignments/)"
    )
    if not picked:
        print("No course folder selected. Aborting.")
        sys.exit(1)
    course = Path(picked).resolve()
    if not course.is_dir():
        print(f"Course folder not found: {picked}")
        sys.exit(1)
    return course


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Generate manifest.json for the web tools to browse a course folder"
    )
    parser.add_argument("course", nargs="?", help="Course folder path")
    parser.add_argument(
        "--exclude-pii",
        action="store_true",
        help="Drop students.csv and name_map.csv from the manifest (for public publishing)",
    )
    parser.add_argument(
        "--output",
        "-o",
        default=None,
        help="Path to write manifest.json (defaults to <course>/manifest.json)",
    )
    args = parser.parse_args(argv if argv is not None else sys.argv[1:])
    course = _resolve_course(args.course)
    manifest = _build_manifest(course, exclude_pii=args.exclude_pii)
    out_path = Path(args.output) if args.output else (course / "manifest.json")
    out_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    n_lessons = len(manifest["groups"].get("lessons", {}))
    n_assigns = len(manifest["groups"].get("assignments", {}))
    n_root = len(manifest["rootFiles"])
    print(
        f"Wrote {out_path} : {n_root} root file(s), {n_lessons} lesson(s), "
        f"{n_assigns} assignment(s)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
