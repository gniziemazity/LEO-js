from __future__ import annotations

import argparse
import http.server
import shutil
import socketserver
import sys
import threading
import time
import webbrowser
from pathlib import Path

from utils.folder_utils import pick_folder
from build_manifest import _build_manifest, _resolve_course
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


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


def _serve(course: Path, port: int) -> socketserver.TCPServer:
    handler_cls = _QuietHandler

    class _Handler(handler_cls):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(course), **kwargs)

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

    course = _resolve_course(args.course)
    print(f"Course folder: {course}")

    manifest_path = _write_manifest(course, exclude_pii=args.exclude_pii)
    print(f"Wrote {manifest_path.name}")

    copied, skipped = _sync_tools(course)
    print(f"Tools: {copied} copied/updated, {skipped} already up-to-date in {course / 'tools'}")

    try:
        httpd = _serve(course, args.port)
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
