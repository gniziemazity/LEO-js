import json
import sys
import tkinter as tk
from tkinter import filedialog
from pathlib import Path

_ROOT             = Path(__file__).resolve().parent.parent
_LAST_FOLDER_FILE = _ROOT / '.last_folder'
_LAST_PROJECT_JS  = _ROOT / '.last_project.js'
_LESSONS_DIR      = _ROOT / 'lessons'

CODE_EXTS = ('.html', '.htm', '.css', '.js', '.py')
LANG_EXTS = ('.html', '.css', '.js', '.py')


def code_files(directory: Path, *, first_only: bool = False) -> dict:
    files: dict = {}
    for ext in LANG_EXTS:
        if first_only:
            matching = list(directory.glob(f'*{ext}'))
            if matching:
                files[ext] = matching[0]
        else:
            for path in sorted(directory.glob(f'*{ext}')):
                files[path.name] = path
    return files


def load_last_folder() -> str:
    if _LAST_FOLDER_FILE.exists():
        saved = _LAST_FOLDER_FILE.read_text(encoding='utf-8').strip()
        if Path(saved).is_dir():
            return saved
    return str(_LESSONS_DIR) if _LESSONS_DIR.exists() else str(_ROOT)


def save_last_folder(path: Path) -> None:
    _LAST_FOLDER_FILE.write_text(str(path.parent), encoding='utf-8')
    _LAST_PROJECT_JS.write_text(
        f'window.__LAST_PROJECT__ = {json.dumps(str(path))};',
        encoding='utf-8',
    )


def pick_folder(title: str, *, initialdir: str | None = None) -> str:
    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    root.update()
    chosen = filedialog.askdirectory(title=title, initialdir=initialdir or '')
    root.destroy()
    return chosen or ''


def pick_file(title: str, *, filetypes=None,
              initialdir: str | None = None) -> str:
    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    root.update()
    chosen = filedialog.askopenfilename(
        title=title,
        filetypes=filetypes or [("All files", "*.*")],
        initialdir=initialdir or '',
    )
    root.destroy()
    return chosen or ''


def select_project_folder(title: str = "Select project folder") -> Path:
    folder = pick_folder(title, initialdir=load_last_folder())
    if not folder:
        print("No folder selected. Aborting.")
        sys.exit(1)
    path = Path(folder).resolve()
    save_last_folder(path)
    return path


_COURSE_PICK_TITLE = (
    "Select course root folder (containing lessons/ and/or assignments/)"
)


def resolve_course(course_arg, *, title: str = _COURSE_PICK_TITLE) -> Path:
    if course_arg:
        course = Path(course_arg)
        if not course.is_dir():
            print(f"Course folder not found: {course_arg}")
            sys.exit(1)
        return course.resolve()
    picked = pick_folder(title)
    if not picked:
        print("No course folder selected. Aborting.")
        sys.exit(1)
    course = Path(picked).resolve()
    if not course.is_dir():
        print(f"Course folder not found: {picked}")
        sys.exit(1)
    return course


