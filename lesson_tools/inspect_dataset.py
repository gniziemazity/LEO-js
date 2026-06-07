from __future__ import annotations

import argparse
import http
import http.server
import io
import os
import shutil
import socketserver
import sys
import threading
import time
import urllib.parse
import webbrowser
import zipfile
from pathlib import Path

from utils.folder_utils import resolve_course
from build_manifest import _build_manifest
import json

ROOT_DIR = Path(__file__).resolve().parent
REPO_ROOT = ROOT_DIR.parent
CHARTS_SRC = REPO_ROOT / "src" / "shared" / "charts"

_TOOL_FILE_EXTS = (".html", ".js", ".css")
_TOOL_SKIP_FILES = {"server.js", "open.js"}
_LANGUAGES_KEEP = (".json", ".js")
_CHARTS_KEEP = (".js",)


def _list_tool_files() -> list[tuple[Path, Path]]:
    out: list[tuple[Path, Path]] = []
    for p in sorted(ROOT_DIR.iterdir()):
        if p.is_file() and p.suffix.lower() in _TOOL_FILE_EXTS:
            if p.name in _TOOL_SKIP_FILES:
                continue
            out.append((p, Path(p.name)))
    for sub in ("shared", "differentiator", "overview", "students", "timeline", "simulator"):
        sub_dir = ROOT_DIR / sub
        if sub_dir.is_dir():
            for p in sorted(sub_dir.iterdir()):
                if p.is_file() and p.suffix.lower() in _TOOL_FILE_EXTS:
                    out.append((p, Path(sub) / p.name))
    languages_dir = ROOT_DIR / "languages"
    if languages_dir.is_dir():
        for p in sorted(languages_dir.iterdir()):
            if p.is_file() and p.suffix.lower() in _LANGUAGES_KEEP:
                out.append((p, Path("languages") / p.name))
    return out


def _list_chart_files() -> list[Path]:
    if not CHARTS_SRC.is_dir():
        return []
    return [p for p in sorted(CHARTS_SRC.rglob("*"))
            if p.is_file() and p.suffix.lower() in _CHARTS_KEEP]


def _copy_if_newer(src: Path, dst: Path) -> bool:
    if dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime:
        return False
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    return True


def _sync_tools(course: Path) -> tuple[int, int]:
    copied = 0
    skipped = 0
    tools_dir = course / "tools"
    for src, rel_dst in _list_tool_files():
        dst = tools_dir / rel_dst
        if _copy_if_newer(src, dst):
            copied += 1
        else:
            skipped += 1
    for src in _list_chart_files():
        rel = src.relative_to(REPO_ROOT)
        dst = course / rel
        if _copy_if_newer(src, dst):
            copied += 1
        else:
            skipped += 1
    return copied, skipped


def _write_manifest(course: Path, *, exclude_pii: bool) -> Path:
    manifest = _build_manifest(course, exclude_pii=exclude_pii)
    out_path = course / "manifest.json"
    out_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return out_path


def _build_plans_zip(course: Path) -> Path | None:
    lessons_dir = course / "lessons"
    if not lessons_dir.is_dir():
        return None
    plans = []
    for lesson_dir in sorted(lessons_dir.iterdir()):
        if not lesson_dir.is_dir():
            continue
        plan_file = lesson_dir / f"{lesson_dir.name}.log"
        if not plan_file.is_file():
            plan_file = lesson_dir / f"{lesson_dir.name}.json"
        if plan_file.is_file():
            plans.append(plan_file)
    if not plans:
        return None
    out_path = course / "plans.zip"
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for plan in plans:
            zf.write(plan, arcname=plan.name)
    return out_path


_ALWAYS_BLOCK_DIRS = {"students", "curated"}
_PII_FILES = {"students.csv", "name_map.csv"}


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    exclude_pii = False

    def log_message(self, fmt, *args):
        pass

    def _is_blocked_name(self, name):
        if name in _ALWAYS_BLOCK_DIRS:
            return True
        return self.exclude_pii and name in _PII_FILES

    def _request_is_blocked(self):
        url_path = urllib.parse.urlsplit(self.path).path
        segs = [urllib.parse.unquote(p) for p in url_path.split("/") if p]
        if segs and segs[0] == "tools":
            return False
        return any(self._is_blocked_name(s) for s in segs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def send_head(self):
        if self._request_is_blocked():
            self.send_error(http.HTTPStatus.FORBIDDEN, "Blocked path")
            return None
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            parts = urllib.parse.urlsplit(self.path)
            if not parts.path.endswith("/"):
                self.send_response(http.HTTPStatus.MOVED_PERMANENTLY)
                new_url = urllib.parse.urlunsplit(
                    (parts[0], parts[1], parts[2] + "/", parts[3], parts[4])
                )
                self.send_header("Location", new_url)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return None
            return self.list_directory(path)
        return super().send_head()

    def list_directory(self, path):
        try:
            names = sorted(os.listdir(path))
        except OSError:
            self.send_error(
                http.HTTPStatus.NOT_FOUND, "No permission to list directory"
            )
            return None
        entries = [
            {
                "name": n,
                "kind": "directory" if os.path.isdir(os.path.join(path, n)) else "file",
            }
            for n in names
            if not self._is_blocked_name(n)
        ]
        body = json.dumps(entries).encode("utf-8")
        self.send_response(http.HTTPStatus.OK)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        return io.BytesIO(body)


def _serve(course: Path, port: int, exclude_pii: bool = False) -> socketserver.TCPServer:
    handler_cls = _QuietHandler

    class _Handler(handler_cls):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(course), **kwargs)

    _Handler.exclude_pii = exclude_pii

    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", port), _Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Generate manifest, copy tools, and serve a course folder in the browser"
    )
    parser.add_argument("course", nargs="?", help="Course folder path")
    parser.add_argument("--port", type=int, default=8000, help="HTTP server port (default 8000)")
    parser.add_argument("--no-open", action="store_true", help="Don't auto-open the browser")
    parser.add_argument(
        "--exclude-pii",
        action="store_true",
        help="Drop students.csv and name_map.csv from the manifest",
    )
    args = parser.parse_args(argv if argv is not None else sys.argv[1:])

    course = resolve_course(args.course)
    print(f"Course folder: {course}")

    manifest_path = _write_manifest(course, exclude_pii=args.exclude_pii)
    print(f"Wrote {manifest_path.name}")

    plans_zip = _build_plans_zip(course)
    if plans_zip is not None:
        print(f"Wrote {plans_zip.name}")

    copied, skipped = _sync_tools(course)
    print(f"Tools: {copied} copied/updated, {skipped} already up-to-date in {course / 'tools'}")

    try:
        httpd = _serve(course, args.port, exclude_pii=args.exclude_pii)
    except OSError as e:
        print(f"Could not start server on port {args.port}: {e}")
        print("Try a different port with --port=<n>")
        return 1

    url = f"http://127.0.0.1:{args.port}/tools/overview.html"
    print(f"\nServing at {url}")
    print("Press Ctrl+C to stop.\n")

    if not args.no_open:
        time.sleep(0.3)
        webbrowser.open(url)

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nStopping server…")
        httpd.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
