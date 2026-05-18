import csv
import json
import os
import shutil
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Dict, List

from .folder_utils import LANG_EXTS
from .similarity_measures import (
    calculate_containment,
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
        self.student_simple_extra_by_ext: Dict[str, Dict[str, Counter]] = {}
        self.simple_baseline_by_ext:      Dict[str, Counter]            = {}
        self.student_raw_texts:           Dict[str, str]                = {}

        self._student_token_stats: Dict[str, dict]    = {}
        self._student_all_outside: Dict[str, Counter] = {}  # full outside tokens across all files
        self.student_dir_by_sid:   Dict[str, Path]    = {}

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
        self._real_to_display: Dict[str, str] = {}

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
            self.name_to_id[real_name] = sid
            if display_name != real_name:
                self.name_to_id[display_name] = sid
            self._real_to_display[real_name] = display_name

        def _reset():
            self.student_info.clear()
            self.name_to_id.clear()
            self._real_to_display.clear()

        open_csv_encoded(
            self.students_csv, _handle, reset_fn=_reset,
        )

    def write_name_map(self, project_dir: Path) -> None:
        name_map = getattr(self, '_real_to_display', {}) or {}
        out_path = Path(project_dir) / 'name_map.csv'
        with open(out_path, 'w', encoding='utf-8-sig', newline='') as fh:
            writer = csv.writer(fh, delimiter=';')
            writer.writerow(['Student ID', 'Student Name', 'Alter Ego'])
            for real_name, alter in name_map.items():
                sid = self.name_to_id.get(real_name, '')
                writer.writerow([sid, real_name, alter])
        print(f'Written {out_path.name} ({len(name_map)} student name mappings)')

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

        def _row(row):
            alts = [s.strip() for s in row
                    if s.strip() and not s.strip().isdigit()]
            if not alts:
                return
            if alts[0] == '!' and alts[1:]:
                self.not_expected_items.append(alts[1:])
            else:
                self.required_items.append(alts)

        def _reset():
            self.required_items.clear()
            self.not_expected_items.clear()

        open_csv_encoded(path, _row, delimiter=';',
                         reset_fn=_reset, dict_reader=False)

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
        self._lesson_file = data.lesson_file


    def get_code_files(self, directory: Path) -> Dict[str, Path]:
        files = {}
        for ext in LANG_EXTS:
            matching = list(directory.glob(f'*{ext}'))
            if matching:
                files[ext] = matching[0]
        return files

    def get_all_code_files(self, directory: Path) -> Dict[str, Path]:
        files = {}
        for ext in LANG_EXTS:
            for path in sorted(directory.glob(f'*{ext}')):
                files[path.name] = path
        return files

    def compare_files(self,
                      ref_file: Path, student_file: Path,
                      teacher_tokens: Counter,
                      baseline_outside: Counter) -> Dict:
        try:
            student_raw = student_file.read_text(encoding='utf-8', errors='ignore')

            student_outside, student_inside = split_code_tokens(student_raw)
            inc_sim       = calculate_containment(teacher_tokens, student_outside)
            extra_outside = student_outside - baseline_outside

            return {
                'status':                   'success',
                'file_name':                student_file.name,
                'inc_sim':                  inc_sim,
                'extra_outside':            extra_outside,
                'student_outside':          student_outside,
                'student_inside':           student_inside,
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

        bl_outside = self._build_baselines(ref_files, t_outside)

        for student_dir in sorted(d for d in self.participation_dir.iterdir() if d.is_dir()):
            sid = self.name_to_id.get(student_dir.name)
            if sid is None:
                continue
            self.student_dir_by_sid[sid] = student_dir

            res        = {'files_compared': {}}
            stu_files  = self.get_code_files(student_dir)

            for ext, ref_file in ref_files.items():
                if ext not in stu_files:
                    continue
                result = self.compare_files(
                    ref_file, stu_files[ext],
                    t_outside.get(ext, Counter()),
                    bl_outside.get(ext, t_outside.get(ext, Counter())),
                )
                res['files_compared'][ext] = result

            for _ext in ({'.css', '.js'} - set(ref_files.keys())):
                if _ext not in stu_files:
                    continue
                s_file = stu_files[_ext]
                t_ref = t_outside.get('.html', Counter())
                if t_ref:
                    s_raw   = s_file.read_text(encoding='utf-8', errors='ignore')
                    s_out, s_ins = split_code_tokens(s_raw)
                    _bl_out = bl_outside.get('.html', t_outside.get('.html', Counter()))
                    extra_out = s_out - _bl_out
                    res['files_compared'][_ext] = self._no_ref_result(
                        s_file, s_out, s_ins, extra_out,
                        calculate_containment(t_ref, s_out))
                    continue
                res['files_compared'][_ext] = {'status': 'no_reference',
                                               'file_name': s_file.name}

            self.results[sid] = res

            raw_parts:        List[str]          = []
            simple_extras:    Dict[str, Counter] = {}
            all_outside_parts: List[Counter]     = []

            for ext in LANG_EXTS:
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

    def _build_baselines(self, ref_files, t_outside):
        bl_outside: Dict[str, Counter] = {}

        if self.start_dir and self.start_dir.is_dir():
            for ext, sf in self.get_code_files(self.start_dir).items():
                raw = sf.read_text(encoding='utf-8', errors='ignore')
                bl_outside[ext], _ = split_code_tokens(raw)

            for ext in list(bl_outside.keys()):
                for tok, cnt in t_outside.get(ext, Counter()).items():
                    if cnt > bl_outside[ext].get(tok, 0):
                        bl_outside[ext][tok] = cnt

        for ext in LANG_EXTS:
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

        return bl_outside

    @staticmethod
    def _no_ref_result(s_file: Path, s_out: Counter, s_ins: Counter,
                       extra_out: Counter, inc_sim: float) -> Dict:
        return {
            'status':          'success',
            'file_name':       s_file.name,
            'inc_sim':         inc_sim,
            'extra_outside':   extra_out,
            'student_outside': s_out,
            'student_inside':  s_ins,
        }

_REMARKS_BASES = [
    'ideal', 'required',
    'leo_star', 'leo',
    'lcs_star', 'lcs',
    'lev_star', 'lev',
    'ro_star', 'ro',
    'git_star', 'git',
]


def _resolve_follow_basis(requested: str, generated: List[str]) -> str:
    if requested != 'auto':
        if requested in generated:
            return requested
        print(f'  --follow-basis={requested!r} not available; falling back to auto pick')
    for preferred in ('ideal', 'required', 'leo_star', 'leo'):
        if preferred in generated:
            return preferred
    return generated[0] if generated else ''


def main() -> None:
    if len(sys.argv) < 2:
        print('Usage: sim_check.py <project_dir> [--follow-basis=<basis>]')
        sys.exit(1)

    follow_basis = 'auto'
    positional: List[str] = []
    for arg in sys.argv[1:]:
        if arg.startswith('--follow-basis='):
            follow_basis = arg.split('=', 1)[1].strip() or 'auto'
        else:
            positional.append(arg)
    if not positional:
        print('Usage: sim_check.py <project_dir> [--follow-basis=<basis>]')
        sys.exit(1)

    current_dir    = Path(positional[0]).resolve()
    correct_dir    = current_dir / 'correct'
    anon_names_dir = current_dir / 'anon_names'
    anon_ids_dir   = current_dir / 'anon_ids'
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
        from .lesson_stats import write_lesson_stats_csv
        stats_path = write_lesson_stats_csv(
            checker._lesson_all_events, current_dir,
        )
        if stats_path:
            print(f'  Written: {stats_path.name}')
        checker.write_student_token_files(names_dir, anon_names_dir,
                                           curated_dir=current_dir / 'curated')
    else:
        checker.write_leo_diff_marks(names_dir, anon_names_dir)
    checker.write_lcs_diff_marks(names_dir, anon_names_dir)
    checker.write_lev_diff_marks(names_dir, anon_names_dir)
    checker.write_ro_diff_marks(names_dir, anon_names_dir)
    checker.write_git_diff_marks(names_dir, anon_names_dir)
    checker.copy_curated_diff_marks(
        current_dir / 'curated', names_dir, anon_names_dir, anon_ids_dir,
    )
    checker.mirror_diff_marks_to_anon_ids(anon_names_dir, anon_ids_dir)
    checker.write_name_map(current_dir)

    print('\nGenerating per-basis remarks reports...')
    generated_bases: List[str] = []
    for basis in _REMARKS_BASES:
        stats = checker.compute_basis_token_stats(
            f'diff_marks_{basis}.json', names_dir, anon_names_dir,
        )
        if not stats:
            continue
        out_path = current_dir / f'remarks_{basis}.xlsx'
        checker.generate_remarks_report(str(out_path), token_stats=stats)
        generated_bases.append(basis)
        print(f'  {out_path.name}  ({len(stats)} student(s))')

    if not checker._lesson_keypresses:
        checker._build_synth_teacher_timestamps()
        for basis in _REMARKS_BASES:
            if basis in generated_bases:
                continue
            basis_marks_by_sid: Dict[str, dict] = {}
            for sid_dir in anon_ids_dir.iterdir() if anon_ids_dir.is_dir() else []:
                if not sid_dir.is_dir():
                    continue
                sid = sid_dir.name
                if sid not in checker.results:
                    continue
                marks_path = sid_dir / f'diff_marks_{basis}.json'
                if not marks_path.is_file():
                    continue
                try:
                    with open(marks_path, encoding='utf-8') as fh:
                        basis_marks_by_sid[sid] = json.load(fh)
                except Exception:
                    continue
            if not basis_marks_by_sid:
                continue
            out_path = current_dir / f'remarks_{basis}.xlsx'
            checker.generate_remarks_report(
                str(out_path), basis_marks_by_sid=basis_marks_by_sid,
            )
            generated_bases.append(basis)
            print(f'  {out_path.name}  ({len(basis_marks_by_sid)} student(s))')

    chosen_basis = _resolve_follow_basis(follow_basis, generated_bases)
    remarks_path = current_dir / f'remarks_{folder_name}.xlsx'
    if chosen_basis:
        src_path = current_dir / f'remarks_{chosen_basis}.xlsx'
        shutil.copy2(str(src_path), str(remarks_path))
        print(f'\nFollow basis: {chosen_basis} -> {remarks_path.name}')
    else:
        checker.generate_remarks_report(str(remarks_path))
        print(f'\nFollow basis: (default LEO* re-scored) -> {remarks_path.name}')

    grades_ts   = int(datetime.now().timestamp())
    grades_path = current_dir / f'grades_{folder_name}_{grades_ts}.xlsx'
    shutil.copy2(str(remarks_path), str(grades_path))
    merge_existing_grades(current_dir, folder_name, grades_path)

    print(f'Done — remarks_{folder_name}.xlsx and '
          f'grades_{folder_name}_{grades_ts}.xlsx generated.')


if __name__ == '__main__':
    main()