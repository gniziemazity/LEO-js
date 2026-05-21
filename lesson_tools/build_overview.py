from __future__ import annotations

import argparse
import sys
import tkinter as tk
from collections import defaultdict
from pathlib import Path
from tkinter import filedialog
from typing import Dict, Optional, Tuple

from utils.anonymize import load_excluded_student_ids

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
_INTERACT_COLOR_SCALE = dict(
    start_type='min', start_color='FCFFFF',
    end_type='max',   end_color='5A8CC6',
)
_CDIFF_COLOR_SCALE = dict(
    start_type='min', start_color='F86B6B',
    mid_type='num',   mid_value=0, mid_color='FCFFFF',
    end_type='max',   end_color='5A8CC6',
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
_INTERACT_WIDTHS = {0: 5.0, 1: 5.0, 2: 5.0, 3: 5.5, 4: 5.5, 5: 6.0}
_LESSON_OBS_WIDTH = 6.8
_GRADE_WIDTH = 10.3
_STATUS_WIDTH = 7.1
_ASSIGN_OBS_WIDTH = 6.8


LESSON_TO_COLS: Dict[str, Dict[str, int]] = {
    'wall':    {'follow_first': 17, 'interact_first': 22,
                'lesson_obs': 28, 'grade': 29, 'status': 30, 'obs': 31},
    'chess':   {'follow_first': 32, 'interact_first': 37,
                'lesson_obs': 43, 'grade': 44, 'status': 45, 'obs': 46},
    'sorting': {'follow_first': 47, 'interact_first': 52,
                'lesson_obs': 58, 'grade': 59, 'status': 60, 'obs': 61},
    'js':      {'follow_first': 62, 'interact_first': 67,
                'lesson_obs': 73, 'grade': 74, 'status': 75, 'obs': 76},
    'qr':      {'follow_first': 77, 'interact_first': 82,
                'lesson_obs': 88, 'grade': 89, 'status': 90, 'obs': 91},
}

LESSON_LANG_OFFSETS = {'follow_html': 0, 'follow_css': 1, 'follow_js': 2}
LESSON_FOLLOW_OFFSET = 3
LESSON_INC_OFFSET = 4
INTERACT_A_OFFSET = 0
INTERACT_Q_OFFSET = 1
INTERACT_H_OFFSET = 2
INTERACT_CPLUS_OFFSET = 3
INTERACT_CMINUS_OFFSET = 4
INTERACT_CDIFF_OFFSET = 5
INTERACT_COL_COUNT = 6
_LANG_HEADER_BY_OFFSET = {0: 'HTML Follow', 1: 'CSS Follow', 2: 'JS Follow'}
_INTERACT_HEADER_BY_OFFSET = {0: 'A', 1: 'Q', 2: 'H', 3: 'C+', 4: 'C-', 5: 'C Diff'}


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


def _count_interactions(raw) -> Tuple[int, int, int]:
    s = _to_str(raw)
    if not s:
        return (0, 0, 0)
    parts = [p.strip() for p in s.split(',') if p.strip()]
    a = sum(1 for p in parts if p == 'A')
    q = sum(1 for p in parts if p == 'Q')
    h = sum(1 for p in parts if p == 'H')
    return (a, q, h)


def _count_extra_missing(desc) -> Tuple[int, int]:
    s = _to_str(desc)
    if not s:
        return (0, 0)
    plus, minus = 0, 0
    for item in s.split(','):
        item = item.strip()
        if not item or item[0] not in '+-':
            continue
        n = 1
        if item.endswith(')') and ' (x' in item:
            try:
                n = int(item[item.rindex('(x') + 2 : -1])
            except (ValueError, IndexError):
                n = 1
        if item[0] == '+':
            plus += n
        else:
            minus += n
    return (plus, minus)


def _read_lesson_stats_csv(csv_path: Path) -> Optional[Dict[str, object]]:
    if not csv_path.is_file():
        return None
    try:
        text = csv_path.read_text(encoding='utf-8')
    except OSError:
        return None
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if len(lines) < 2:
        return None
    header = [c.strip() for c in lines[0].split(',')]
    values = [c.strip() for c in lines[1].split(',')]
    out: Dict[str, object] = {}
    for k, v in zip(header, values):
        if not k:
            continue
        if v == '':
            out[k] = ''
            continue
        try:
            if '.' in v:
                out[k] = float(v)
            else:
                out[k] = int(v)
        except ValueError:
            out[k] = v
    return out


_LESSON_STATS_SOURCES = ('lesson_stats_py.csv', 'lesson_stats.csv')


def _add_lesson_stats_sheet(wb: 'Workbook',
                            lessons_root: Optional[Path]) -> None:
    if lessons_root is None or not lessons_root.is_dir():
        return
    rows: list = []
    column_order: list = []
    seen = set()
    dirs_by_lower = {
        d.name.lower(): d
        for d in lessons_root.iterdir()
        if d.is_dir()
    }
    ordered_keys = [lk for lk in LESSON_TO_COLS.keys() if lk in dirs_by_lower]
    ordered_keys += sorted(
        lk for lk in dirs_by_lower if lk not in LESSON_TO_COLS
    )
    for lk in ordered_keys:
        lesson_dir = dirs_by_lower[lk]
        data = None
        for fname in _LESSON_STATS_SOURCES:
            data = _read_lesson_stats_csv(lesson_dir / fname)
            if data is not None:
                break
        if data is None:
            continue
        rows.append((lk.title(), data))
        for k in data.keys():
            if k not in seen:
                seen.add(k)
                column_order.append(k)
    if not rows:
        return
    ws = wb.create_sheet(title='Lesson Stats')
    header = ['Lesson'] + column_order
    ws.append(header)
    for cell in ws[1]:
        cell.font = _FONT_BOLD
        cell.alignment = _ALIGN_CENTER
    for lesson_name, data in rows:
        ws.append([lesson_name] + [data.get(k, '') for k in column_order])
    ws.column_dimensions['A'].width = 12
    for i, k in enumerate(column_order, start=2):
        ws.column_dimensions[get_column_letter(i)].width = max(len(k) + 2, 8)
    ws.freeze_panes = 'B2'


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

    excluded_ids = load_excluded_student_ids(str(root / 'students.csv'))
    if excluded_ids:
        print(f'Excluded:    {len(excluded_ids)} student(s) per '
              f'students.csv (Include != OK)')
        print()

    student_data: Dict[str, dict] = defaultdict(dict)
    lesson_meta: Dict[str, dict] = {}

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
            wanted = ('ID', 'Student', 'Number', 'Inc', 'Interactions',
                      'Follow (C) Desc', 'Follow (E)',
                      'HTML (E)', 'CSS (E)', 'JS (E)', 'Obs')
            col_idx, rows = _read_grades_rows(xlsx, wanted)
            missing = [h for h in wanted if col_idx.get(h) is None]
            for h in ('Inc', 'Interactions', 'Follow (E)', 'Obs'):
                if h in missing:
                    print(f'  [lesson/{lesson_dir.name}] WARNING: column '
                          f'{h!r} not found in {xlsx.name}')
            lesson_meta[lesson_key] = {
                'has_interactions':  col_idx.get('Interactions') is not None,
                'has_follow_c_desc': col_idx.get('Follow (C) Desc') is not None,
            }
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
                if sid in excluded_ids:
                    continue
                student_data[sid][f'lesson_{lesson_key}'] = {
                    'follow':         r.get('Follow (E)'),
                    'follow_html':    r.get('HTML (E)'),
                    'follow_css':     r.get('CSS (E)'),
                    'follow_js':      r.get('JS (E)'),
                    'inc':            r.get('Inc'),
                    'interactions':   _to_str(r.get('Interactions')),
                    'follow_c_desc':  _to_str(r.get('Follow (C) Desc')),
                    'obs':            _to_str(r.get('Obs')),
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
                if sid in excluded_ids:
                    continue
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
    header[4] = 'Excluded'
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

        interact_first = cols['interact_first']
        for off in range(INTERACT_COL_COUNT):
            col = interact_first + off
            header[col] = f'{lk.title()} {_INTERACT_HEADER_BY_OFFSET[off]}'
            _set_col_style(col, _FONT_BOLD, _FONT_DEFAULT, _ALIGN_CENTER, '0',
                           _INTERACT_WIDTHS[off])

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
        if sid in excluded_ids:
            row[4] = 'EXCLUDED'
        for lk, cols in LESSON_TO_COLS.items():
            first = cols['follow_first']
            interact_first = cols['interact_first']
            lesson_info = info.get(f'lesson_{lk}')
            meta = lesson_meta.get(lk, {})
            if lesson_info:
                row[first + 0] = lesson_info.get('follow_html')
                row[first + 1] = lesson_info.get('follow_css')
                row[first + 2] = lesson_info.get('follow_js')
                row[first + LESSON_FOLLOW_OFFSET] = lesson_info.get('follow')
                row[first + LESSON_INC_OFFSET] = lesson_info.get('inc')
                attended = lesson_info.get('follow') not in (None, '')
                if attended and meta.get('has_interactions'):
                    a, q, h = _count_interactions(lesson_info.get('interactions'))
                    row[interact_first + INTERACT_A_OFFSET] = a
                    row[interact_first + INTERACT_Q_OFFSET] = q
                    row[interact_first + INTERACT_H_OFFSET] = h
                if attended and meta.get('has_follow_c_desc'):
                    cplus, cminus = _count_extra_missing(lesson_info.get('follow_c_desc'))
                    row[interact_first + INTERACT_CPLUS_OFFSET] = cplus
                    row[interact_first + INTERACT_CMINUS_OFFSET] = cminus
                    row[interact_first + INTERACT_CDIFF_OFFSET] = cplus - cminus
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
            interact_first = cols['interact_first']
            for off in range(INTERACT_COL_COUNT):
                col_letter = get_column_letter(interact_first + off + 1)
                scale = (
                    _CDIFF_COLOR_SCALE
                    if off == INTERACT_CDIFF_OFFSET
                    else _INTERACT_COLOR_SCALE
                )
                ws.conditional_formatting.add(
                    f'{col_letter}2:{col_letter}{last_row}',
                    ColorScaleRule(**scale),
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

    _add_lesson_stats_sheet(wb, lessons_root)

    out_path = root / args.output
    wb.save(out_path)
    print(f'\nWrote {out_path}')
    print(f'  {len(student_data)} student row(s)')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
