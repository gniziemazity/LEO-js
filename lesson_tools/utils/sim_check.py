import csv
import os
import shutil
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Dict, List

from .similarity_measures import (
    calculate_char_histogram_similarity,
    calculate_containment,
    calculate_ide_diff_sim,
    extract_tokens,
    normalize_code,
    open_csv_encoded,
    split_code_tokens,
)
from .grade_merge import merge_existing_grades
from .lesson_log import load_lesson_log
from .token_log_mixin import TokenLogMixin
from .report_excel import ExcelReportMixin


class CodeSimilarityChecker(TokenLogMixin, ExcelReportMixin):

    def __init__(self, reference_dir: str, participation_dir: str, students_csv: str,
                 start_dir: str = None):
        self.reference_dir     = Path(reference_dir)
        self.participation_dir = Path(participation_dir)
        self.students_csv      = Path(students_csv)
        self.start_dir         = Path(start_dir) if start_dir else None

        self.student_info: Dict[str, dict] = {}
        self.name_to_id:   Dict[str, str]  = {}

        self.results:                     Dict[str, dict]              = {}
        self.student_extra_by_ext:        Dict[str, Dict[str, Counter]] = {}
        self.student_simple_extra_by_ext: Dict[str, Dict[str, Counter]] = {}
        self.simple_baseline_by_ext:      Dict[str, Counter]            = {}
        self.student_raw_texts:           Dict[str, str]                = {}

        self._student_token_stats: Dict[str, dict]    = {}
        self._student_all_outside: Dict[str, Counter] = {}  # full outside tokens across all files

        self.teacher_tokens_by_ext:           Dict[str, Counter] = {}
        self.teacher_outside_by_ext:          Dict[str, Counter] = {}
        self.teacher_inside_by_ext:           Dict[str, Counter] = {}

        self.remarks_data:       Dict[str, str]  = {}
        self.required_items:     List[List[str]] = []
        self.not_expected_items: List[List[str]] = []

        self._lesson_keypresses:    list = []
        self._lesson_code_inserts:  list = []
        self._lesson_interactions:  list = []
        self._lesson_all_events:    list = []
        self._lesson_session_start: int  = 0

        self._load_students()

    def _load_students(self) -> None:
        use_alter_ego = os.environ.get('STUDENT_ANALYTICS_USE_ALTER_EGO') == '1'

        def _handle(row):
            sid = row['Student ID'].strip()
            real_name = row['Student Name'].strip()
            display_name = real_name
            if use_alter_ego:
                alter = (row.get('Alter Ego') or '').strip()
                if alter:
                    display_name = alter
            self.student_info[sid] = {
                'name':   display_name,
                'number': row['Student Number'].strip(),
            }
            # Folder names on disk match the real student name; map both so
            # student_dir lookups still succeed.
            self.name_to_id[real_name] = sid
            if display_name != real_name:
                self.name_to_id[display_name] = sid

        open_csv_encoded(
            self.students_csv, _handle,
            reset_fn=lambda: (self.student_info.clear(), self.name_to_id.clear()),
        )

    def load_remarks_csv(self, csv_path: str) -> None:
        path = Path(csv_path)
        if not path.exists():
            return
        open_csv_encoded(
            path,
            lambda row: self.remarks_data.__setitem__(
                row['Student Number'].strip(), row['Remarks'].strip()
            ),
            reset_fn=self.remarks_data.clear,
        )

    def load_expected_csv(self, csv_path: str) -> None:
        path = Path(csv_path)
        if not path.exists():
            return
        self.required_items.clear()
        self.not_expected_items.clear()
        for enc in ('utf-8-sig', 'utf-8', 'latin-1', 'cp1252'):
            try:
                with open(path, 'r', encoding=enc, newline='') as f:
                    for row in csv.reader(f, delimiter=';'):
                        alts = [s.strip() for s in row
                                if s.strip() and not s.strip().isdigit()]
                        if not alts:
                            continue
                        if alts[0] == '!' and alts[1:]:
                            self.not_expected_items.append(alts[1:])
                        else:
                            self.required_items.append(alts)
                break
            except (UnicodeDecodeError, UnicodeError):
                self.required_items.clear()
                self.not_expected_items.clear()

    def load_lesson_json(self, project_dir: Path) -> None:
        data, message = load_lesson_log(project_dir)
        if message:
            print(message)
        if data is None:
            return

        self._lesson_all_events = data.all_events
        self._lesson_keypresses = data.keypresses
        self._lesson_code_inserts = data.code_inserts
        self._lesson_interactions = data.interactions
        self._lesson_session_start = data.session_start


    def get_code_files(self, directory: Path) -> Dict[str, Path]:
        files = {}
        for ext in ('.html', '.css', '.js'):
            matching = list(directory.glob(f'*{ext}'))
            if matching:
                files[ext] = matching[0]
        return files

    def get_all_code_files(self, directory: Path) -> Dict[str, Path]:
        files = {}
        for ext in ('.html', '.css', '.js'):
            for path in sorted(directory.glob(f'*{ext}')):
                files[path.name] = path
        return files

    def compare_files(self,
                      ref_file: Path, student_file: Path,
                      teacher_tokens: Counter,
                      baseline_outside: Counter,
                      baseline_inside: Counter) -> Dict:
        try:
            ref_raw     = ref_file.read_text(encoding='utf-8', errors='ignore')
            student_raw = student_file.read_text(encoding='utf-8', errors='ignore')
            ref_lines   = normalize_code(ref_raw)
            stu_lines   = normalize_code(student_raw)

            ide_sim        = calculate_ide_diff_sim(ref_lines, stu_lines)
            char_hist_sim  = calculate_char_histogram_similarity(ref_lines, stu_lines)
            student_tokens = extract_tokens(stu_lines)

            student_outside, student_inside = split_code_tokens(student_raw)
            inc_sim       = calculate_containment(teacher_tokens, student_outside)
            extra_outside = student_outside - baseline_outside
            extra_inside  = student_inside  - baseline_inside

            total = sum(student_tokens.values())
            def _pct(c): return round(sum(c.values()) / total * 100, 1) if total else 0.0
            def _fmt(c): return [f'{kw} (x{n})' if n > 1 else kw
                                 for kw, n in sorted(c.items())]
            return {
                'status':                   'success',
                'file_name':                student_file.name,
                'ide_sim':                  round(ide_sim * 100, 1),
                'char_hist_sim':            round(char_hist_sim * 100, 1),
                'inc_sim':                  inc_sim,
                'extra_outside_pct':        _pct(extra_outside),
                'extra_inside_pct':         _pct(extra_inside),
                'extra_outside_keywords':   _fmt(extra_outside),
                'extra_inside_keywords':    _fmt(extra_inside),
                'extra_outside':            extra_outside,
                'extra_inside':             extra_inside,
                'extra_counter':            extra_outside + extra_inside,
                'student_outside':          student_outside,
                'student_inside':           student_inside,
                'student_html_outside':     student_outside,
                'student_html_outside_css': student_outside,
                'student_script_outside':   Counter(),
                'student_tokens':           student_tokens,
            }
        except Exception:
            return {'status': 'error'}

    def run_check(self) -> None:
        ref_files = self.get_code_files(self.reference_dir)

        t_outside:      Dict[str, Counter] = {}
        t_inside:       Dict[str, Counter] = {}
        t_tokens:       Dict[str, Counter] = {}

        for ext, ref_file in ref_files.items():
            raw = ref_file.read_text(encoding='utf-8', errors='ignore')
            out, ins = split_code_tokens(raw)
            t_outside[ext] = out
            t_inside[ext]  = ins
            t_tokens[ext]  = out + ins

        self.teacher_tokens_by_ext  = t_tokens
        self.teacher_outside_by_ext = t_outside
        self.teacher_inside_by_ext  = t_inside

        bl_outside, bl_inside = self._build_baselines(ref_files, t_outside, t_inside)

        for student_dir in sorted(d for d in self.participation_dir.iterdir() if d.is_dir()):
            sid = self.name_to_id.get(student_dir.name)
            if sid is None:
                continue

            res        = {'files_compared': {}}
            ext_extras: Dict[str, Counter] = {}
            stu_files  = self.get_code_files(student_dir)

            for ext, ref_file in ref_files.items():
                if ext in stu_files:
                    result = self.compare_files(
                        ref_file, stu_files[ext],
                        t_outside.get(ext, Counter()),
                        bl_outside.get(ext, t_outside.get(ext, Counter())),
                        bl_inside.get(ext, t_inside.get(ext, Counter())),
                    )
                    res['files_compared'][ext] = result
                    ext_extras[ext] = result.get('extra_outside', Counter())
                else:
                    ext_extras[ext] = Counter()

            for _ext in ({'.css', '.js'} - set(ref_files.keys())):
                if _ext not in stu_files:
                    continue
                s_file = stu_files[_ext]
                t_ref = t_outside.get('.html', Counter())
                if t_ref:
                    s_raw   = s_file.read_text(encoding='utf-8', errors='ignore')
                    s_out, s_ins = split_code_tokens(s_raw)
                    _bl_out = bl_outside.get('.html', t_outside.get('.html', Counter()))
                    _bl_ins = bl_inside.get('.html', t_inside.get('.html', Counter()))
                    extra_out = s_out - _bl_out
                    extra_ins = s_ins - _bl_ins
                    total     = max(1, sum(extract_tokens(normalize_code(s_raw)).values()))
                    res['files_compared'][_ext] = self._no_ref_result(
                        s_file, s_out, s_ins, extra_out, extra_ins,
                        calculate_containment(t_ref, s_out), total, is_script=_ext == '.js')
                    ext_extras[_ext] = extra_out
                    continue
                res['files_compared'][_ext] = {'status': 'no_reference',
                                               'file_name': s_file.name}

            self.results[sid]              = res
            self.student_extra_by_ext[sid] = ext_extras

            raw_parts:        List[str]          = []
            simple_extras:    Dict[str, Counter] = {}
            all_outside_parts: List[Counter]     = []

            for ext in ['.html', '.css', '.js']:
                _files = sorted(student_dir.glob(f'*{ext}'))
                if not _files:
                    simple_extras[ext] = Counter()
                    continue
                ext_out: Counter = Counter()
                for _f in _files:
                    try:
                        raw = _f.read_text(encoding='utf-8', errors='ignore')
                        raw_parts.append(raw)
                        s_out, _ = split_code_tokens(raw)
                        ext_out += s_out
                    except Exception:
                        pass
                simple_extras[ext] = ext_out - self.simple_baseline_by_ext.get(ext, Counter())
                all_outside_parts.append(ext_out)

            self.student_simple_extra_by_ext[sid] = simple_extras
            self.student_raw_texts[sid]           = ', '.join(raw_parts)
            self._student_all_outside[sid]        = sum(all_outside_parts, Counter())

    def _build_baselines(self, ref_files, t_outside, t_inside):
        bl_outside: Dict[str, Counter] = {}
        bl_inside:  Dict[str, Counter] = {}

        if self.start_dir and self.start_dir.is_dir():
            for ext, sf in self.get_code_files(self.start_dir).items():
                raw = sf.read_text(encoding='utf-8', errors='ignore')
                bl_outside[ext], bl_inside[ext] = split_code_tokens(raw)

            def _floor(bl_dict, ref_dict):
                for ext in list(bl_dict.keys()):
                    for tok, cnt in ref_dict.get(ext, Counter()).items():
                        if cnt > bl_dict[ext].get(tok, 0):
                            bl_dict[ext][tok] = cnt

            _floor(bl_outside, t_outside)
            _floor(bl_inside,  t_inside)

        for ext in ['.html', '.css', '.js']:
            src = None
            if self.start_dir and self.start_dir.is_dir():
                sf_list = list(self.start_dir.glob(f'*{ext}'))
                if sf_list:
                    src = sf_list[0]
            if src is None:
                src = ref_files.get(ext)
            if src:
                raw = src.read_text(encoding='utf-8', errors='ignore')
                bl  = split_code_tokens(raw)[0]
                self.simple_baseline_by_ext[ext] = Counter(bl)
            else:
                self.simple_baseline_by_ext[ext] = Counter()

            ref_file = ref_files.get(ext)
            if ref_file:
                raw     = ref_file.read_text(encoding='utf-8', errors='ignore')
                ref_out = split_code_tokens(raw)[0]
                for tok, cnt in ref_out.items():
                    if cnt > self.simple_baseline_by_ext[ext].get(tok, 0):
                        self.simple_baseline_by_ext[ext][tok] = cnt

        return bl_outside, bl_inside

    @staticmethod
    def _no_ref_result(s_file: Path, s_out: Counter, s_ins: Counter,
                       extra_out: Counter, extra_ins: Counter,
                       inc_sim: float, total: int, is_script: bool) -> Dict:
        def _pct(c): return round(sum(c.values()) / total * 100, 1)
        def _fmt(c): return [f'{k} (x{n})' if n > 1 else k for k, n in sorted(c.items())]
        return {
            'status':                 'success',
            'file_name':              s_file.name,
            'ide_sim':                0.0,
            'char_hist_sim':          0.0,
            'inc_sim':                inc_sim,
            'extra_outside_pct':      _pct(extra_out),
            'extra_inside_pct':       _pct(extra_ins),
            'extra_outside_keywords': _fmt(extra_out),
            'extra_inside_keywords':  _fmt(extra_ins),
            'extra_outside':          extra_out,
            'extra_inside':           extra_ins,
            'student_outside':        s_out,
            'student_inside':         s_ins,
            'student_html_outside':   Counter(),
            'student_script_outside': s_out if is_script else Counter(),
            'student_tokens':         Counter(),
        }

def main() -> None:
    if len(sys.argv) < 2:
        print('Usage: sim_check.py <project_dir>')
        sys.exit(1)

    current_dir    = Path(sys.argv[1]).resolve()
    correct_dir    = current_dir / 'correct'
    anon_names_dir = current_dir / 'anon_names'
    names_dir      = current_dir / 'students'
    students_csv   = current_dir.parent.parent / 'students.csv'
    start_dir      = current_dir / 'start'

    missing = [p for p in (correct_dir, anon_names_dir, students_csv) if not p.exists()]
    if missing:
        print(f'Missing: {", ".join(str(p) for p in missing)}')
        return

    checker = CodeSimilarityChecker(
        str(correct_dir), str(anon_names_dir), str(students_csv),
        start_dir=str(start_dir) if start_dir.exists() else None,
    )
    checker.run_check()

    remarks_csv = current_dir / 'remarks.csv'
    checker.load_remarks_csv(str(remarks_csv))
    if remarks_csv.exists():
        remarks_csv.unlink()

    expected_csv = current_dir / 'expected.csv'
    if not expected_csv.exists():
        expected_csv = current_dir / 'required.csv'
    checker.load_expected_csv(str(expected_csv))
    checker.load_lesson_json(current_dir)

    folder_name = current_dir.name
    print('\nWriting diff mark files...')
    if checker._lesson_keypresses:
        checker.write_keyword_log()
        checker.write_student_token_files(names_dir, anon_names_dir)
    else:
        checker.write_leo_diff_marks(names_dir, anon_names_dir)
    checker.write_lcs_diff_marks(names_dir, anon_names_dir)
    checker.write_lev_diff_marks(names_dir, anon_names_dir)
    checker.write_ro_diff_marks(names_dir, anon_names_dir)
    checker.write_git_diff_marks(names_dir, anon_names_dir)
    checker.copy_truth_diff_marks(current_dir / 'truth', names_dir, anon_names_dir)

    checker.generate_excel_report(
        str(current_dir / f'teacher_similarity_{folder_name}.xlsx')
    )
    remarks_path = current_dir / f'remarks_{folder_name}.xlsx'
    checker.generate_remarks_report(str(remarks_path))

    grades_ts   = int(datetime.now().timestamp())
    grades_path = current_dir / f'grades_{folder_name}_{grades_ts}.xlsx'
    shutil.copy2(str(remarks_path), str(grades_path))
    merge_existing_grades(current_dir, folder_name, grades_path)

    print(f'Done — teacher_similarity_{folder_name}.xlsx, '
          f'remarks_{folder_name}.xlsx and '
          f'grades_{folder_name}_{grades_ts}.xlsx generated.')


if __name__ == '__main__':
    main()