from __future__ import annotations

import argparse
import sys
import tkinter as tk
from collections import defaultdict
from pathlib import Path
from tkinter import filedialog
from typing import Dict, Optional, Tuple

try:
    from openpyxl import Workbook, load_workbook
    from openpyxl.formatting.rule import ColorScaleRule, FormulaRule
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter
except ImportError:
    print('error: openpyxl required. pip install openpyxl', file=sys.stderr)
    sys.exit(1)


_FONT_DEFAULT = Font(name='Arial', size=10)
_FONT_BOLD = Font(name='Arial', size=10, bold=True)
_FONT_GREY = Font(name='Arial', size=10, color='808080')
_ALIGN_CENTER = Alignment(horizontal='center', vertical='center')
_ALIGN_LEFT = Alignment(horizontal='left', vertical='center')

_FOLLOW_INC_COLOR_SCALE = dict(
    start_type='min',        start_color='F86B6B',
    mid_type='percentile',   mid_value=50, mid_color='FCFFFF',
    end_type='max',          end_color='5A8CC6',
)
_STATUS_COLORS = {
    'Pass':  '33CC33',
    "Pass'": '99CC00',
    'Pass*': 'FFC000',
    'Fail':  'FF4D50',
    'Fail*': 'C00000',
}

_COL_WIDTHS = {
    0:  4.7,   # ID
    1:  17.9,  # Name
    3:  9.0,   # Number
}
_FOLLOW_INC_WIDTHS = {0: 10.2, 1: 7.7, 2: 7.4, 3: 7.4, 4: 7.4}
_LESSON_OBS_WIDTH = 6.8
_GRADE_WIDTH = 10.3
_STATUS_WIDTH = 7.1
_ASSIGN_OBS_WIDTH = 6.8


LESSON_TO_COLS: Dict[str, Dict[str, int]] = {
    'wall':    {'follow_first': 17, 'follow_last': 21,
                'lesson_obs': 22, 'grade': 23, 'status': 24, 'obs': 25},
    'chess':   {'follow_first': 26, 'follow_last': 30,
                'lesson_obs': 31, 'grade': 32, 'status': 33, 'obs': 34},
    'sorting': {'follow_first': 35, 'follow_last': 39,
                'lesson_obs': 40, 'grade': 41, 'status': 42, 'obs': 43},
    'js':      {'follow_first': 44, 'follow_last': 48,
                'lesson_obs': 49, 'grade': 50, 'status': 51, 'obs': 52},
    'qr':      {'follow_first': 53, 'follow_last': 57,
                'lesson_obs': 58, 'grade': 59, 'status': 60, 'obs': 61},
}

LESSON_LANG_OFFSETS = {'follow_html': 0, 'follow_css': 1, 'follow_js': 2}
LESSON_FOLLOW_OFFSET = 3
LESSON_INC_OFFSET = 4
_LANG_HEADER_BY_OFFSET = {0: 'HTML Follow', 1: 'CSS Follow', 2: 'JS Follow'}


def _pick_folder() -> Optional[Path]:
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)
    root.update()
    chosen = filedialog.askdirectory(title='Select the course root folder')
    root.destroy()
    return Path(chosen) if chosen else None


def _find_subdir(parent: Path, name: str) -> Optional[Path]:
    if not parent.is_dir():
        return None
    for entry in parent.iterdir():
        if entry.is_dir() and entry.name.lower() == name.lower():
            return entry
    return None


def _latest_grades_xlsx(folder: Path) -> Optional[Path]:
    if not folder.is_dir():
        return None
    candidates = list(folder.glob('grades_*.xlsx'))
    if candidates:
        return max(candidates, key=lambda p: p.stat().st_mtime)
    fallback = list(folder.glob('remarks_*.xlsx'))
    if fallback:
        return max(fallback, key=lambda p: p.stat().st_mtime)
    return None


def _read_grades_rows(xlsx_path: Path,
                      wanted_headers: Tuple[str, ...]
                      ) -> Tuple[Dict[str, int], list]:
    wb = load_workbook(xlsx_path, data_only=True, read_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    wb.close()
    if not rows:
        return {}, []
    header = [str(c).strip() if c is not None else '' for c in rows[0]]
    col_idx = {}
    for h in wanted_headers:
        try:
            col_idx[h] = header.index(h)
        except ValueError:
            col_idx[h] = None
    out_rows = []
    for r in rows[1:]:
        if not r or all(c is None for c in r):
            continue
        d = {}
        for h, idx in col_idx.items():
            d[h] = r[idx] if idx is not None and idx < len(r) else None
        out_rows.append(d)
    return col_idx, out_rows


def _to_str(v) -> str:
    if v is None:
        return ''
    s = str(v).strip()
    return s


def _normalize_sid(v) -> str:
    s = _to_str(v)
    if not s:
        return ''
    if s.endswith('.0'):
        try:
            s = str(int(float(s)))
        except (ValueError, TypeError):
            pass
    return s


def main(argv) -> int:
    description = __doc__.split('\n')[0] if __doc__ else 'Build overview spreadsheet'
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument('root', nargs='?',
                        help='Course root folder (containing lessons/ and assignments/).')
    parser.add_argument('--output', default='Overview.xlsx',
                        help='Output filename (relative to root).')
    args = parser.parse_args(argv[1:])

    root = Path(args.root) if args.root else _pick_folder()
    if root is None or not root.is_dir():
        print('No root folder selected.', file=sys.stderr)
        return 1
    root = root.resolve()

    lessons_root = _find_subdir(root, 'lessons')
    assignments_root = _find_subdir(root, 'assignments')
    if lessons_root is None and assignments_root is None:
        print(f'error: no lessons/ or assignments/ folder in {root}',
              file=sys.stderr)
        return 1

    print(f'Root:        {root}')
    print(f'Lessons:     {lessons_root or "(missing)"}')
    print(f'Assignments: {assignments_root or "(missing)"}')
    print()

    student_data: Dict[str, dict] = defaultdict(dict)

    if lessons_root is not None:
        for lesson_dir in sorted(d for d in lessons_root.iterdir() if d.is_dir()):
            lesson_key = lesson_dir.name.lower()
            if lesson_key not in LESSON_TO_COLS:
                print(f'  [lesson/{lesson_dir.name}] skipped: no column mapping')
                continue
            xlsx = _latest_grades_xlsx(lesson_dir)
            if xlsx is None:
                print(f'  [lesson/{lesson_dir.name}] skipped: no grades_*.xlsx or remarks_*.xlsx')
                continue
            wanted = ('ID', 'Student', 'Number', 'Inc', 'Follow (E)',
                      'HTML (E)', 'CSS (E)', 'JS (E)', 'Obs')
            col_idx, rows = _read_grades_rows(xlsx, wanted)
            missing = [h for h in wanted if col_idx.get(h) is None]
            for h in ('Inc', 'Follow (E)', 'Obs'):
                if h in missing:
                    print(f'  [lesson/{lesson_dir.name}] WARNING: column '
                          f'{h!r} not found in {xlsx.name}')
            n = 0
            for r in rows:
                sid = _normalize_sid(r.get('ID'))
                if not sid:
                    continue
                name = _to_str(r.get('Student'))
                number = _to_str(r.get('Number'))
                if name and 'name' not in student_data[sid]:
                    student_data[sid]['name'] = name
                if number and 'number' not in student_data[sid]:
                    student_data[sid]['number'] = number
                student_data[sid][f'lesson_{lesson_key}'] = {
                    'follow':      r.get('Follow (E)'),
                    'follow_html': r.get('HTML (E)'),
                    'follow_css':  r.get('CSS (E)'),
                    'follow_js':   r.get('JS (E)'),
                    'inc':         r.get('Inc'),
                    'obs':         _to_str(r.get('Obs')),
                }
                n += 1
            print(f'  [lesson/{lesson_dir.name}] {n} student row(s) from {xlsx.name}')

    if assignments_root is not None:
        for assign_dir in sorted(d for d in assignments_root.iterdir() if d.is_dir()):
            assign_key = assign_dir.name.lower()
            if assign_key not in LESSON_TO_COLS:
                print(f'  [assign/{assign_dir.name}] skipped: no column mapping')
                continue
            xlsx = _latest_grades_xlsx(assign_dir)
            if xlsx is None:
                print(f'  [assign/{assign_dir.name}] skipped: no grades_*.xlsx or remarks_*.xlsx')
                continue
            wanted = ('ID', 'Student', 'Number', 'Grade', 'Obs')
            col_idx, rows = _read_grades_rows(xlsx, wanted)
            missing = [h for h in wanted if col_idx.get(h) is None]
            for h in ('Grade', 'Obs'):
                if h in missing:
                    print(f'  [assign/{assign_dir.name}] WARNING: column '
                          f'{h!r} not found in {xlsx.name}')
            n = 0
            for r in rows:
                sid = _normalize_sid(r.get('ID'))
                if not sid:
                    continue
                name = _to_str(r.get('Student'))
                number = _to_str(r.get('Number'))
                if name and 'name' not in student_data[sid]:
                    student_data[sid]['name'] = name
                if number and 'number' not in student_data[sid]:
                    student_data[sid]['number'] = number
                student_data[sid][f'assign_{assign_key}'] = {
                    'grade': r.get('Grade'),
                    'obs':   _to_str(r.get('Obs')),
                }
                n += 1
            print(f'  [assign/{assign_dir.name}] {n} student row(s) from {xlsx.name}')

    if not student_data:
        print('\nNo student rows collected.', file=sys.stderr)
        return 1

    n_cols = max(c for cols in LESSON_TO_COLS.values() for c in cols.values()) + 1

    column_styles: Dict[int, dict] = {}
    column_widths: Dict[int, float] = {}

    def _set_col_style(col: int, header_font: Font, data_font: Font,
                       align: Alignment, fmt: Optional[str], width: float):
        column_styles[col] = {
            'header_font': header_font,
            'data_font': data_font,
            'align': align,
            'fmt': fmt,
        }
        column_widths[col] = width

    _set_col_style(0, _FONT_BOLD, _FONT_DEFAULT, _ALIGN_CENTER, None, _COL_WIDTHS[0])
    _set_col_style(1, _FONT_BOLD, _FONT_GREY,    _ALIGN_LEFT,   None, _COL_WIDTHS[1])
    _set_col_style(3, _FONT_BOLD, _FONT_GREY,    _ALIGN_LEFT,   None, _COL_WIDTHS[3])

    header = [''] * n_cols
    header[0] = 'ID'
    header[1] = 'Name'
    header[3] = 'Number'
    for lk, cols in LESSON_TO_COLS.items():
        first = cols['follow_first']
        for off in (0, 1, 2):
            col = first + off
            header[col] = f'{lk.title()} {_LANG_HEADER_BY_OFFSET[off]}'
            _set_col_style(col, _FONT_BOLD, _FONT_DEFAULT, _ALIGN_CENTER, '0',
                           _FOLLOW_INC_WIDTHS[off])
        col = first + LESSON_FOLLOW_OFFSET
        header[col] = f'{lk.title()} Follow'
        _set_col_style(col, _FONT_BOLD, _FONT_DEFAULT, _ALIGN_CENTER, '0',
                       _FOLLOW_INC_WIDTHS[LESSON_FOLLOW_OFFSET])
        col = first + LESSON_INC_OFFSET
        header[col] = f'{lk.title()} Inc'
        _set_col_style(col, _FONT_BOLD, _FONT_DEFAULT, _ALIGN_CENTER, '0',
                       _FOLLOW_INC_WIDTHS[LESSON_INC_OFFSET])

        header[cols['lesson_obs']] = f'{lk.title()} LessonObs'
        _set_col_style(cols['lesson_obs'], _FONT_BOLD, _FONT_DEFAULT,
                       _ALIGN_CENTER, None, _LESSON_OBS_WIDTH)

        header[cols['grade']] = f'{lk.title()} Grade'
        _set_col_style(cols['grade'], _FONT_BOLD, _FONT_DEFAULT,
                       _ALIGN_CENTER, None, _GRADE_WIDTH)

        header[cols['status']] = f'{lk.title()} Status'
        _set_col_style(cols['status'], _FONT_BOLD, _FONT_DEFAULT,
                       _ALIGN_CENTER, None, _STATUS_WIDTH)

        header[cols['obs']] = f'{lk.title()} Obs'
        _set_col_style(cols['obs'], _FONT_BOLD, _FONT_DEFAULT,
                       _ALIGN_CENTER, None, _ASSIGN_OBS_WIDTH)

    wb = Workbook()
    ws = wb.active
    ws.title = 'Grades'
    ws.append(header)
    for col_idx, cell in enumerate(ws[1]):
        style = column_styles.get(col_idx)
        if style:
            cell.font = style['header_font']
            cell.alignment = _ALIGN_CENTER

    for col_idx, width in column_widths.items():
        ws.column_dimensions[get_column_letter(col_idx + 1)].width = width

    def _sid_sort_key(sid: str):
        try:
            return (0, int(sid))
        except (ValueError, TypeError):
            return (1, sid)

    for sid in sorted(student_data.keys(), key=_sid_sort_key):
        info = student_data[sid]
        row = [None] * n_cols
        row[0] = sid
        row[1] = info.get('name', '')
        row[3] = info.get('number', '')
        for lk, cols in LESSON_TO_COLS.items():
            first = cols['follow_first']
            lesson_info = info.get(f'lesson_{lk}')
            if lesson_info:
                row[first + 0] = lesson_info.get('follow_html')
                row[first + 1] = lesson_info.get('follow_css')
                row[first + 2] = lesson_info.get('follow_js')
                row[first + LESSON_FOLLOW_OFFSET] = lesson_info.get('follow')
                row[first + LESSON_INC_OFFSET] = lesson_info.get('inc')
                row[cols['lesson_obs']] = lesson_info.get('obs', '')
            assign_info = info.get(f'assign_{lk}')
            if assign_info:
                row[cols['grade']] = assign_info.get('grade')
                row[cols['obs']] = assign_info.get('obs', '')
        ws.append(row)

        excel_row = ws.max_row
        for col_idx, style in column_styles.items():
            cell = ws.cell(row=excel_row, column=col_idx + 1)
            cell.font = style['data_font']
            cell.alignment = style['align']
            if style['fmt']:
                cell.number_format = style['fmt']

    ws.freeze_panes = 'B2'

    last_row = ws.max_row
    if last_row >= 2:
        for lk, cols in LESSON_TO_COLS.items():
            first = cols['follow_first']
            for off in range(0, 5):
                col_letter = get_column_letter(first + off + 1)
                ws.conditional_formatting.add(
                    f'{col_letter}2:{col_letter}{last_row}',
                    ColorScaleRule(**_FOLLOW_INC_COLOR_SCALE),
                )
            grade_letter = get_column_letter(cols['grade'] + 1)
            status_letter = get_column_letter(cols['status'] + 1)
            grade_range = f'{grade_letter}2:{grade_letter}{last_row}'
            for status_value, color in _STATUS_COLORS.items():
                escaped = status_value.replace('"', '""')
                formula = f'={status_letter}2="{escaped}"'
                fill = PatternFill(start_color=color, end_color=color,
                                   fill_type='solid')
                ws.conditional_formatting.add(
                    grade_range,
                    FormulaRule(formula=[formula], fill=fill),
                )

    out_path = root / args.output
    wb.save(out_path)
    print(f'\nWrote {out_path}')
    print(f'  {len(student_data)} student row(s)')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
