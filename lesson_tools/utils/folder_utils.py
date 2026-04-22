import json
import sys
import tkinter as tk
from tkinter import filedialog
from pathlib import Path

_ROOT             = Path(__file__).resolve().parent.parent
_LAST_FOLDER_FILE = _ROOT / '.last_folder'
_LAST_PROJECT_JS  = _ROOT / '.last_project.js'
_LESSONS_DIR      = _ROOT / 'lessons'


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


def select_project_folder(title: str = "Select project folder") -> Path:
    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    folder = filedialog.askdirectory(title=title, initialdir=load_last_folder())
    root.destroy()
    if not folder:
        print("No folder selected. Aborting.")
        sys.exit(1)
    path = Path(folder).resolve()
    save_last_folder(path)
    return path


def select_xlsx_file(title: str = "Select Excel file") -> Path:
    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    file = filedialog.askopenfilename(
        title=title,
        initialdir=load_last_folder(),
        filetypes=[("Excel files", "*.xlsx"), ("All files", "*.*")],
    )
    root.destroy()
    if not file:
        print("No file selected. Aborting.")
        sys.exit(1)
    path = Path(file).resolve()
    save_last_folder(path)
    return path