from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from utils.folder_utils import resolve_course

_GROUPS = ("lessons", "assignments")
_PII_FILES = {"students.csv", "name_map.csv"}
_SKIP_DIR_NAMES = {"__pycache__", ".git", ".venv", "node_modules"}
_SKIP_FILE_NAMES = {".DS_Store", "Thumbs.db"}
_ROOT_KEEP_FILES = {"grades_stats.json", "overview.json"}
_DIFF_MARKS_RE = re.compile(r"^diff_marks_.*\.json$")
_MEDIA_RE = re.compile(
    r"\.(?:png|jpe?g|gif|svg|webp|ico|bmp|mp3|wav|ogg|m4a|aac|flac|mp4|webm|ogv|mov)$",
    re.IGNORECASE,
)
_PROJECT_KEEP_DIRS = ("anon_ids", "start", "reconstructed", "correct")
_PROJECT_DROP_DIRS = ("students", "curated", "anon_names")
_MEDIA_KEEP_DIRS = ("start", "reconstructed", "correct")
_PROJECT_KEEP_FILES = {"instructions.html", "name_map.csv", "artefact_labels.csv"}


def _is_hidden(path: Path) -> bool:
    name = path.name
    if name.startswith("~$"):
        return True
    return name.startswith(".") and name not in {".gitignore"}


def _keep_root_file(name: str) -> bool:
    return name.lower() in _ROOT_KEEP_FILES


def _keep_project_file(rel: str, lesson_name: str, teacher_media=frozenset()) -> bool:
    parts = rel.split("/")
    top = parts[0]
    if top in _PROJECT_DROP_DIRS:
        return False
    lower = parts[-1].lower()
    if _DIFF_MARKS_RE.match(lower):
        return False
    if _MEDIA_RE.search(lower):
        if top in _MEDIA_KEEP_DIRS:
            return True
        if top == "anon_ids":
            return lower not in teacher_media
        return False
    if top in _PROJECT_KEEP_DIRS:
        return True
    if len(parts) == 1 and (
        parts[0] in _PROJECT_KEEP_FILES
        or lower.endswith(".log")
        or lower in {f"{lesson_name.lower()}.json", "log.json"}
    ):
        return True
    return lower.endswith(".xlsx") and "remarks" in lower


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
        if not _keep_root_file(p.name):
            continue
        out.append(p.name)
    return out


def _teacher_media_basenames(lesson_dir: Path) -> set:
    names: set = set()
    for d in _MEDIA_KEEP_DIRS:
        base = lesson_dir / d
        if not base.is_dir():
            continue
        for p in base.rglob("*"):
            if p.is_file() and _MEDIA_RE.search(p.name.lower()):
                names.add(p.name.lower())
    return names


def _build_lesson_entry(lesson_dir: Path) -> dict:
    teacher_media = _teacher_media_basenames(lesson_dir)
    files = [
        f for f in _list_files_relative(lesson_dir)
        if _keep_project_file(f, lesson_dir.name, teacher_media)
    ]
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


def _file_mtime_ms(path: Path) -> int:
    try:
        return int(path.stat().st_mtime * 1000)
    except OSError:
        return 0


def _collect_mtimes(course: Path, manifest: dict) -> dict:
    mtimes: dict = {}
    for rf in manifest["rootFiles"]:
        if rf.lower().endswith(".xlsx"):
            mtimes[rf.lower()] = _file_mtime_ms(course / rf)
    for group, entries in manifest["groups"].items():
        for lesson, info in entries.items():
            for rel in info.get("files", []):
                if not rel.lower().endswith(".xlsx"):
                    continue
                key = f"{group}/{lesson}/{rel}".lower()
                mtimes[key] = _file_mtime_ms(course / group / lesson / rel)
    return mtimes


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
    manifest["mtimes"] = _collect_mtimes(course, manifest)
    return manifest




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
    course = resolve_course(args.course)
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
