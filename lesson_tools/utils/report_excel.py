import os
from collections import Counter
from pathlib import Path
from typing import Dict, List, Tuple

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.formatting.rule import ColorScaleRule
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter

from .folder_utils import LANG_EXTS
from .similarity_measures import (
    calculate_containment,
    iter_code_tokens,
    save_xlsx,
)
from .token_log import _split_tokens_by_comment
from .token_log_mixin import (
    _LANG_EXT_LABEL,
    _effective_ext_at,
    _embedded_lang_ranges_for,
    _ext_of,
)


def _fmt_diff(miss_ctr: Counter, extra_ctr: Counter) -> Tuple[str, List[str]]:
    parts: List[str] = []
    items: List[str] = []
    for kw, n in sorted(miss_ctr.items()):
        suf = f' (x{n})' if n > 1 else ''
        parts.append(f'-{kw}{suf}')
        items.append(f'Missing: {kw}{suf}')
    for kw, n in sorted(extra_ctr.items()):
        suf = f' (x{n})' if n > 1 else ''
        parts.append(f'+{kw}{suf}')
        items.append(f'Extra: {kw}{suf}')
    return (', '.join(parts), items)


def _ts_str(seconds: int) -> str:
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f'{h:02d}:{m:02d}:{s:02d}'


def _build_synth_ts(files: Dict[str, Path]) -> Dict[Tuple[str, int], str]:
    out: Dict[Tuple[str, int], str] = {}
    counter = 0
    for _ext, fpath in sorted((files or {}).items(), key=lambda kv: kv[1].name):
        try:
            text = fpath.read_text(encoding='utf-8', errors='ignore')
        except Exception:
            continue
        file_ext = _ext_of(fpath.name)
        for pos, _tok, _is_comment in iter_code_tokens(text, file_ext):
            out[(fpath.name, pos)] = _ts_str(counter)
            counter += 1
    return out


def _fmt_diff_timed(
    miss_marks: List[Tuple[str, int, str]],
    extra_marks: List[Tuple[str, int, str]],
    ts_teacher: Dict[Tuple[str, int], str],
) -> Tuple[str, List[str]]:
    miss_sorted = sorted(
        ((ts_teacher.get((fn, s), '99:99:99'), tok) for fn, s, tok in miss_marks),
    )
    extra_ctr: Counter = Counter(tok for _, _, tok in extra_marks)
    parts: List[str] = []
    items: List[str] = []
    for ts, tok in miss_sorted:
        parts.append(f'-{tok} ({ts})')
        items.append(f'Missing: {tok} ({ts})')
    for kw, n in sorted(extra_ctr.items()):
        suf = f' (x{n})' if n > 1 else ''
        parts.append(f'+{kw}{suf}')
        items.append(f'Extra: {kw}{suf}')
    return (', '.join(parts), items)


class ExcelReportMixin:
    def generate_remarks_report(
        self,
        output_file: str,
        anonymize: bool = False,
        token_stats: 'Dict[str, dict] | None' = None,
        basis_marks_by_sid: 'Dict[str, dict] | None' = None,
    ) -> None:
        wb = Workbook()
        wb.remove(wb.active)
        prev_stats = None
        prev_basis = getattr(self, '_basis_marks_by_sid', None)
        if token_stats is not None:
            prev_stats = self._student_token_stats
            self._student_token_stats = token_stats
        if basis_marks_by_sid is not None:
            self._basis_marks_by_sid = basis_marks_by_sid
        try:
            self._add_remarks_sheet(wb, anonymize=anonymize)
            save_xlsx(wb, output_file)
        finally:
            if prev_stats is not None:
                self._student_token_stats = prev_stats
            self._basis_marks_by_sid = prev_basis

    def _add_remarks_sheet(self, wb: Workbook, anonymize: bool = False) -> None:
        sheet   = wb.create_sheet(title='Remarks')
        has_log = bool(self._lesson_keypresses)
        has_sim = not has_log

        _LANG_COLS = tuple(
            (ext, f'{label} (E)') for ext, label in _LANG_EXT_LABEL
        )
        if has_log:
            present_lang_exts = []
            for ext, _label in _LANG_COLS:
                if any(
                    (v.get('follow_e_by_lang') or {}).get(ext) is not None
                    for v in self._student_token_stats.values()
                ):
                    present_lang_exts.append(ext)
        else:
            teacher_by_lang = self._teacher_tokens_by_lang()
            present_lang_exts = [
                ext for ext, _label in _LANG_COLS if teacher_by_lang.get(ext)
            ]

        lang_label_by_ext = dict(_LANG_COLS)
        header = ['ID', 'Student', 'Number', 'Remarks', 'Extra', 'Extra Desc', 'Inc']
        if has_log:
            header.extend(['Follow (C)', 'Follow (C) Desc',
                            'Follow (E)', 'Follow (E) Desc', 'Interactions'])
            for ext in present_lang_exts:
                header.append(lang_label_by_ext[ext])
                header.append(f'{lang_label_by_ext[ext]} Desc')
        if has_sim:
            header.extend(['Similarity', 'Similarity Desc'])
            for ext in present_lang_exts:
                header.append(lang_label_by_ext[ext])
                header.append(f'{lang_label_by_ext[ext]} Desc')
        if self.required_items or self.not_expected_items:
            header.extend(['Expected', 'Expected Desc'])
        header.extend(['Obs', 'Grade', 'Comments', 'Category'])

        COL_EXTRA   = 5
        COL_EXTRA_T = 6
        COL_INC     = 7
        _next = 8
        COL_LANG_BY_EXT: Dict[str, int] = {}
        COL_LANG_DESC_BY_EXT: Dict[str, int] = {}
        if has_log:
            COL_FOLLOWC   = _next; _next += 1
            COL_FOLLOWC_T = _next; _next += 1
            COL_FOLLOWE   = _next; _next += 1
            COL_FOLLOWE_T = _next; _next += 1
            COL_INTERACT  = _next; _next += 1
            for ext in present_lang_exts:
                COL_LANG_BY_EXT[ext] = _next; _next += 1
                COL_LANG_DESC_BY_EXT[ext] = _next; _next += 1
        else:
            COL_FOLLOWC = COL_FOLLOWC_T = COL_FOLLOWE = COL_FOLLOWE_T = COL_INTERACT = None
        if has_sim:
            COL_SIM    = _next; _next += 1
            COL_SIM_T  = _next; _next += 1
            for ext in present_lang_exts:
                COL_LANG_BY_EXT[ext] = _next; _next += 1
                COL_LANG_DESC_BY_EXT[ext] = _next; _next += 1
        else:
            COL_SIM = COL_SIM_T = None
        if self.required_items or self.not_expected_items:
            COL_EXPECTED   = _next; _next += 1
            COL_EXPECTED_T = _next; _next += 1
        else:
            COL_EXPECTED = COL_EXPECTED_T = None

        sheet.append(header)
        for cell in sheet[1]:
            cell.font = Font(bold=True)

        excluded = getattr(self, 'excluded_ids', set()) or set()
        ai_ids   = getattr(self, 'ai_ids', set()) or set()
        anon_mode = (
            os.environ.get('STUDENT_ANALYTICS_USE_ALTER_EGO') == '1'
            or anonymize
        )
        sids               = sorted(self.student_info.keys(), key=int)
        active_sids        = [s for s in sids if s not in excluded]
        all_extra_counters = {
            sid: sum(self.student_simple_extra_by_ext.get(sid, {}).values(), Counter())
            for sid in active_sids
        }

        _extra_denom = max(
            1, sum(sum(c.values()) for c in self.teacher_outside_by_ext.values())
        )

        student_interactions = self._extract_interactions() if has_log else {}

        for sid in sids:
            info          = self.student_info[sid]
            display_name  = sid if anonymize else info['name']
            display_number = (
                '123456'
                if anon_mode and sid not in ai_ids
                else info['number']
            )
            if sid in excluded:
                row = [int(sid), display_name, display_number]
                row.extend([''] * (len(header) - len(row) - 1))
                row.append('EXCLUDED')
                sheet.append(row)
                continue
            extra_ctr     = all_extra_counters.get(sid, Counter())
            extra_all     = [f'{kw} (x{n})' if n > 1 else kw
                             for kw, n in sorted(extra_ctr.items())]
            has_submission = sid in self.results
            code_not_found = has_submission and not self.student_raw_texts.get(sid, '').strip()

            remarks_emoji, details = self._remarks_emoji(
                info['number'], has_submission, code_not_found
            )

            inc_pct = self._avg_inc(sid) if has_submission and not code_not_found else ''

            _ts = self._student_token_stats.get(sid)

            if _ts and has_submission and not code_not_found:
                follow_e_pct  = _ts['follow_e']
                comment_pct   = _ts['follow_c']
                ts_denom_r    = _ts['teacher_total_e'] or 1
                extra_pct     = (round(min(_ts['extra'] / ts_denom_r * 100, 100.0), 1)
                                 if _ts['extra'] else 0.0)
                extra_e_text  = _ts['extra_e_text']
                comment_text  = _ts['comment_text']
                extra_all     = _ts['extra_all']
            else:
                follow_e_pct = comment_pct = ''
                extra_e_text = comment_text  = ''
                extra_pct    = (round(min(sum(extra_ctr.values()) / _extra_denom * 100, 100.0), 1)
                                if has_submission and not code_not_found else '')

            req_count, req_details, req_missing, req_fill = self._check_required(
                sid, has_submission, code_not_found
            )
            sim_items = []
            sim_by_lang: Dict[str, Dict] = {}

            if code_not_found:
                row = [int(sid), display_name, display_number, '⛔']
                row.extend([''] * (len(header) - 4))
            else:
                row = [int(sid), display_name, display_number,
                       remarks_emoji, extra_pct,
                       ', '.join(extra_all) if extra_all else '',
                       inc_pct]
                if has_log:
                    row.extend([comment_pct, comment_text,
                                 follow_e_pct, extra_e_text,
                                 student_interactions.get(sid, '')])
                    lang_scores = (_ts or {}).get('follow_e_by_lang') or {}
                    for ext in present_lang_exts:
                        v = lang_scores.get(ext)
                        if v is None:
                            row.append('')
                            row.append('')
                        else:
                            row.append(v.get('score', ''))
                            row.append(v.get('text', ''))
                if has_sim:
                    basis_marks = (getattr(self, '_basis_marks_by_sid', None) or {}).get(sid)
                    pb_info = (
                        self._per_basis_sim_info(sid, basis_marks)
                        if basis_marks else None
                    )
                    if pb_info is not None:
                        sim_pct, sim_desc, sim_items = pb_info
                    else:
                        sim_pct, sim_desc, sim_items = self._similarity_info(
                            sid, has_submission, code_not_found)
                    row.extend([sim_pct, sim_desc])
                    sim_by_lang = (
                        self._similarity_info_by_lang_from_marks(
                            sid, has_submission, code_not_found, basis_marks)
                        if basis_marks
                        else self._similarity_info_by_lang(
                            sid, has_submission, code_not_found)
                    )
                    for ext in present_lang_exts:
                        v = sim_by_lang.get(ext)
                        if v is None:
                            row.append('')
                            row.append('')
                        else:
                            row.append(v['score'])
                            row.append(v['desc'])
                if self.required_items or self.not_expected_items:
                    row.extend([req_count, req_details])
                row.extend(['_' if has_submission else '', ''])

            sheet.append(row)
            cur = sheet.max_row

            if sid in ai_ids:
                sheet.cell(row=cur, column=len(header)).value = 'LLM'

            if req_fill and COL_EXPECTED:
                sheet.cell(row=cur, column=COL_EXPECTED).fill = req_fill

            if code_not_found:
                c = Comment('No code files found in submission', 'sim_check')
                c.width = 400; c.height = 80
                sheet.cell(row=cur, column=4).comment = c
                sheet.cell(row=cur, column=4).font = Font(name='Segoe UI Emoji')
            elif details:
                items = [r for r in details.split('; ') if r]
                c = Comment(', '.join(items), 'sim_check')
                c.width = 500; c.height = min(100 + 30 * len(items), 1200)
                sheet.cell(row=cur, column=4).comment = c
            else:
                sheet.cell(row=cur, column=4).font = Font(name='Segoe UI Emoji')

            if extra_all and not code_not_found:
                c = Comment(', '.join(extra_all), 'sim_check')
                c.width  = 400
                c.height = min(200 + 80 * len(extra_all), 6000)
                sheet.cell(row=cur, column=COL_EXTRA).comment = c

            if has_log and comment_text and COL_FOLLOWC:
                _c_items = (_ts['comment_items'] if _ts and _ts.get('comment_items')
                            else comment_text.split(', '))
                c = Comment(', '.join(_c_items), 'sim_check')
                c.width  = 400
                c.height = min(200 + 80 * len(_c_items), 6000)
                sheet.cell(row=cur, column=COL_FOLLOWC).comment = c

            if has_log and extra_e_text and COL_FOLLOWE:
                _e_items = (_ts['extra_e_items'] if _ts and _ts.get('extra_e_items')
                            else extra_e_text.split(', '))
                c = Comment(', '.join(_e_items), 'sim_check')
                c.width  = 400
                c.height = min(200 + 80 * len(_e_items), 6000)
                sheet.cell(row=cur, column=COL_FOLLOWE).comment = c

            if has_log and not code_not_found and _ts:
                _lang_scores = _ts.get('follow_e_by_lang') or {}
                for ext, col_n in COL_LANG_BY_EXT.items():
                    lang_v = _lang_scores.get(ext)
                    if not lang_v:
                        continue
                    text = lang_v.get('text') or ''
                    if not text:
                        continue
                    items = lang_v.get('items') or [text]
                    c = Comment(text, 'sim_check')
                    c.width  = 400
                    c.height = min(200 + 80 * len(items), 6000)
                    sheet.cell(row=cur, column=col_n).comment = c

            if has_sim and not code_not_found and sim_by_lang:
                for ext, col_n in COL_LANG_BY_EXT.items():
                    v = sim_by_lang.get(ext)
                    if not v:
                        continue
                    desc = v.get('desc') or ''
                    if not desc:
                        continue
                    items = v.get('items') or [desc]
                    c = Comment(desc, 'sim_check')
                    c.width  = 400
                    c.height = min(200 + 80 * len(items), 6000)
                    sheet.cell(row=cur, column=col_n).comment = c

            if has_sim and sim_desc and COL_SIM:
                c = Comment(sim_desc, 'sim_check')
                c.width  = 400
                c.height = 200
                sheet.cell(row=cur, column=COL_SIM).comment = c

            if (self.required_items or self.not_expected_items) and req_missing and COL_EXPECTED:
                c = Comment(', '.join(req_missing), 'sim_check')
                c.width = 500; c.height = min(100 + 30 * len(req_missing), 1200)
                sheet.cell(row=cur, column=COL_EXPECTED).comment = c

        _hidden = [get_column_letter(COL_EXTRA_T)]
        if has_log:
            _hidden += [get_column_letter(COL_FOLLOWC_T), get_column_letter(COL_FOLLOWE_T)]
        if has_sim and COL_SIM_T:
            _hidden.append(get_column_letter(COL_SIM_T))
        for col_n in COL_LANG_DESC_BY_EXT.values():
            _hidden.append(get_column_letter(col_n))
        if self.required_items and COL_EXPECTED_T:
            _hidden.append(get_column_letter(COL_EXPECTED_T))
        for col in _hidden:
            sheet.column_dimensions[col].hidden = True

        max_row     = sheet.max_row
        GREEN_FILL  = PatternFill(start_color='CCFFCC', end_color='CCFFCC', fill_type='solid')
        RED_FILL    = PatternFill(start_color='FFCCCC', end_color='FFCCCC', fill_type='solid')
        for r in range(2, max_row + 1):
            val = sheet.cell(row=r, column=4).value
            if val == '✅':
                sheet.cell(row=r, column=4).fill = GREEN_FILL
            elif val == '⛔':
                sheet.cell(row=r, column=4).fill = RED_FILL

        if max_row > 1:
            L_EXTRA = get_column_letter(COL_EXTRA)
            L_INC   = get_column_letter(COL_INC)
            sheet.conditional_formatting.add(
                f'{L_EXTRA}2:{L_EXTRA}{max_row}',
                ColorScaleRule(start_type='num', start_value=0, start_color='FFFFFF',
                               end_type='max', end_color='F8696B'))
            sheet.conditional_formatting.add(
                f'{L_INC}2:{L_INC}{max_row}',
                ColorScaleRule(start_type='num', start_value=0, start_color='F8696B',
                               end_type='num', end_value=100, end_color='FFFFFF'))
            if has_log:
                for col_n in [COL_FOLLOWC, COL_FOLLOWE]:
                    if col_n:
                        ltr = get_column_letter(col_n)
                        sheet.conditional_formatting.add(
                            f'{ltr}2:{ltr}{max_row}',
                            ColorScaleRule(start_type='min', start_color='F8696B',
                                           end_type='max', end_color='FFFFFF'))
            if has_sim and COL_SIM:
                ltr = get_column_letter(COL_SIM)
                sheet.conditional_formatting.add(
                    f'{ltr}2:{ltr}{max_row}',
                    ColorScaleRule(start_type='min', start_color='F8696B',
                                   end_type='max', end_color='FFFFFF'))
            if has_sim and COL_SIM_T:
                ltr = get_column_letter(COL_SIM_T)
                sheet.conditional_formatting.add(
                    f'{ltr}2:{ltr}{max_row}',
                    ColorScaleRule(start_type='min', start_color='F8696B',
                                   end_type='max', end_color='FFFFFF'))
            for col_n in COL_LANG_BY_EXT.values():
                ltr = get_column_letter(col_n)
                sheet.conditional_formatting.add(
                    f'{ltr}2:{ltr}{max_row}',
                    ColorScaleRule(start_type='min', start_color='F8696B',
                                   end_type='max', end_color='FFFFFF'))

        self._auto_column_widths(sheet)
        sheet.column_dimensions['B'].width = 18

    def _similarity_info(self, sid: str, has_submission: bool, code_not_found: bool):
        """Returns (sim_pct, sim_desc_str, sim_items_list) for no-log Similarity column.
        sim_pct   = average inc_sim across files.
        sim_desc  = '-TOKEN / +TOKEN' formatted string for students.html mismatch rendering.
        sim_items = human-readable comment items.
        """
        if not has_submission or code_not_found:
            return ('', '', [])
        data = self.results.get(sid, {})
        if not data or not data.get('files_compared'):
            return ('', '', [])
        inc_vals    = []
        teacher_agg: Counter = Counter()
        for ext in LANG_EXTS:
            fd = data['files_compared'].get(ext)
            if not fd or fd.get('status') != 'success':
                continue
            inc_vals.append(fd['inc_sim'])
            if ext == '.html':
                teacher_ext = self.teacher_outside_by_ext.get(ext, Counter())
            elif ext == '.css':
                teacher_ext = self.teacher_tokens_by_ext.get(ext, Counter())
            else:
                teacher_ext = self.teacher_tokens_by_ext.get(ext, Counter())
            teacher_agg += teacher_ext
        student_agg: Counter = getattr(self, '_student_all_outside', {}).get(sid, Counter())

        sim_desc, sim_items = _fmt_diff(teacher_agg - student_agg, student_agg - teacher_agg)
        sim_pct = round(sum(inc_vals) / len(inc_vals), 1) if inc_vals else ''
        return (sim_pct, sim_desc, sim_items)

    def _build_synth_teacher_timestamps(self) -> None:
        self._synth_ts_teacher = _build_synth_ts(
            self.get_code_files(self._effective_reference_dir())
        )

    def _per_basis_sim_info(self, sid: str, basis_marks: dict):
        if not basis_marks:
            return None
        miss_marks: List[Tuple[str, int, str]] = []
        extra_marks: List[Tuple[str, int, str]] = []
        n_extra_unpaired = 0
        n_ghost_extra = 0
        for fname, marks in (basis_marks.get('teacher_files') or {}).items():
            for m in marks or []:
                if m.get('label') == 'missing':
                    miss_marks.append((fname, m.get('start', 0), m.get('token', '')))
        for fname, marks in (basis_marks.get('student_files') or {}).items():
            for m in marks or []:
                lbl = m.get('label')
                if lbl not in ('extra', 'ghost_extra'):
                    continue
                extra_marks.append((fname, m.get('start', 0), m.get('token', '')))
                if lbl == 'ghost_extra':
                    n_ghost_extra += 1
                elif not m.get('paired_with'):
                    n_extra_unpaired += 1
        teacher_by_lang = self._teacher_tokens_by_lang()
        teacher_total = sum(sum(ctr.values()) for ctr in teacher_by_lang.values())
        if not teacher_total:
            return None
        deduction = len(miss_marks) + n_extra_unpaired + n_ghost_extra
        score = round(max(0.0, (teacher_total - deduction) / teacher_total * 100), 1)
        ts_teacher = getattr(self, '_synth_ts_teacher', None) or {}
        miss_sorted = sorted(
            ((ts_teacher.get((fn, s), '99:99:99'), tok)
             for fn, s, tok in miss_marks),
        )
        extras_sorted = sorted(extra_marks, key=lambda t: (t[0], t[1]))
        parts: List[str] = []
        items: List[str] = []
        for ts, tok in miss_sorted:
            ts_s = '' if ts == '99:99:99' else f' ({ts})'
            parts.append(f'-{tok}{ts_s}')
            items.append(f'Missing: {tok}{ts_s}')
        for _fname, _pos, tok in extras_sorted:
            parts.append(f'+{tok} (00:00:00)')
            items.append(f'Extra: {tok}')
        desc = ', '.join(parts)
        return (score, desc, items)

    def _similarity_info_by_lang_from_marks(
        self, sid: str, has_submission: bool, code_not_found: bool, basis_marks: dict,
    ) -> Dict[str, Dict]:
        if not has_submission or code_not_found or not basis_marks:
            return {}
        teacher_by_lang = self._teacher_tokens_by_lang()
        teacher_files = self.get_code_files(self._effective_reference_dir())
        teacher_texts: Dict[str, str] = {}
        teacher_ranges: Dict[str, Dict[str, List[Tuple[int, int]]]] = {}
        for ext, fpath in (teacher_files or {}).items():
            try:
                text = fpath.read_text(encoding='utf-8', errors='ignore')
            except Exception:
                continue
            teacher_texts[fpath.name] = text
            teacher_ranges[fpath.name] = _embedded_lang_ranges_for(text, ext)
        student_dir = getattr(self, 'student_dir_by_sid', {}).get(sid)
        student_files = self.get_code_files(student_dir) if student_dir else {}
        student_ranges: Dict[str, Dict[str, List[Tuple[int, int]]]] = {}
        for ext, fpath in (student_files or {}).items():
            try:
                text = fpath.read_text(encoding='utf-8', errors='ignore')
            except Exception:
                continue
            student_ranges[fpath.name] = _embedded_lang_ranges_for(text, ext)


        miss_by_lang: Dict[str, List[Tuple[str, int, str]]] = {}
        extra_by_lang: Dict[str, List[Tuple[str, int, str]]] = {}
        n_extra_unpaired_by_lang: Dict[str, int] = {}
        n_ghost_extra_by_lang: Dict[str, int] = {}
        for fname, marks in (basis_marks.get('teacher_files') or {}).items():
            file_ext = _ext_of(fname)
            if not file_ext:
                continue
            ranges = teacher_ranges.get(fname, {})
            for m in marks or []:
                if m.get('label') != 'missing':
                    continue
                pos = m.get('start', 0)
                eff = _effective_ext_at(pos, file_ext, ranges) if ranges else file_ext
                miss_by_lang.setdefault(eff, []).append((fname, pos, m.get('token', '')))
        for fname, marks in (basis_marks.get('student_files') or {}).items():
            file_ext = _ext_of(fname)
            if not file_ext:
                continue
            ranges = student_ranges.get(fname, {})
            for m in marks or []:
                lbl = m.get('label')
                if lbl not in ('extra', 'ghost_extra'):
                    continue
                pos = m.get('start', 0)
                eff = _effective_ext_at(pos, file_ext, ranges) if ranges else file_ext
                extra_by_lang.setdefault(eff, []).append((fname, pos, m.get('token', '')))
                if lbl == 'ghost_extra':
                    n_ghost_extra_by_lang[eff] = n_ghost_extra_by_lang.get(eff, 0) + 1
                elif not m.get('paired_with'):
                    n_extra_unpaired_by_lang[eff] = n_extra_unpaired_by_lang.get(eff, 0) + 1

        ts_teacher = getattr(self, '_synth_ts_teacher', None) or {}

        out: Dict[str, Dict] = {}
        for ext in LANG_EXTS:
            teacher_ext_total = sum(teacher_by_lang.get(ext, Counter()).values())
            miss = miss_by_lang.get(ext, [])
            extra = extra_by_lang.get(ext, [])
            if not teacher_ext_total and not miss and not extra:
                continue
            n_miss = len(miss)
            n_extra_unpaired = n_extra_unpaired_by_lang.get(ext, 0)
            n_ghost_extra = n_ghost_extra_by_lang.get(ext, 0)
            deduction = n_miss + n_extra_unpaired + n_ghost_extra
            score = (
                round(max(0.0, (teacher_ext_total - deduction) / teacher_ext_total * 100), 1)
                if teacher_ext_total else 0.0
            )
            miss_sorted = sorted(
                ((ts_teacher.get((fn, s), '99:99:99'), tok)
                 for fn, s, tok in miss),
            )
            extras_sorted = sorted(extra, key=lambda t: (t[0], t[1]))
            parts: List[str] = []
            items: List[str] = []
            for ts, tok in miss_sorted:
                ts_s = '' if ts == '99:99:99' else f' ({ts})'
                parts.append(f'-{tok}{ts_s}')
                items.append(f'Missing: {tok}{ts_s}')
            for _fname, _pos, tok in extras_sorted:
                parts.append(f'+{tok} (00:00:00)')
                items.append(f'Extra: {tok}')
            desc = ', '.join(parts)
            out[ext] = {
                'score': score,
                'desc':  desc,
                'items': items,
            }
        return out

    def _tokens_by_effective_lang(self, files: Dict[str, Path]) -> Dict[str, Counter]:
        by_lang: Dict[str, Counter] = {}
        for ext, file_path in (files or {}).items():
            try:
                text = file_path.read_text(encoding='utf-8', errors='ignore')
            except Exception:
                continue
            ranges = _embedded_lang_ranges_for(text, ext)
            nc, _cm = _split_tokens_by_comment(text, ext)
            for pos, tok in nc:
                eff = _effective_ext_at(pos, ext, ranges) if ranges else ext
                by_lang.setdefault(eff, Counter())[tok] += 1
        return by_lang

    def _teacher_tokens_by_lang(self) -> Dict[str, Counter]:
        cache = getattr(self, '_teacher_by_lang_cache', None)
        if cache is None:
            cache = self._tokens_by_effective_lang(
                self.get_code_files(self._effective_reference_dir())
            )
            self._teacher_by_lang_cache = cache
        return cache

    def _student_tokens_by_lang(self, sid: str) -> Dict[str, Counter]:
        student_dir = getattr(self, 'student_dir_by_sid', {}).get(sid)
        if student_dir is None:
            return {}
        return self._tokens_by_effective_lang(self.get_code_files(student_dir))

    def _similarity_info_by_lang(self, sid: str, has_submission: bool, code_not_found: bool) -> Dict[str, Dict]:
        if not has_submission or code_not_found:
            return {}
        teacher_by_lang = self._teacher_tokens_by_lang()
        student_by_lang = self._student_tokens_by_lang(sid)
        out: Dict[str, Dict] = {}
        for ext in LANG_EXTS:
            teacher_ext = teacher_by_lang.get(ext, Counter())
            student_ext = student_by_lang.get(ext, Counter())
            if not teacher_ext and not student_ext:
                continue
            score = calculate_containment(teacher_ext, student_ext)
            desc, items = _fmt_diff(teacher_ext - student_ext, student_ext - teacher_ext)
            out[ext] = {
                'score': score,
                'desc':  desc,
                'items': items,
            }
        return out

    def _avg_inc(self, sid: str) -> str:
        inc_vals = [fd['inc_sim']
                    for fd in self.results[sid]['files_compared'].values()
                    if fd.get('status') == 'success']
        return round(sum(inc_vals) / len(inc_vals), 1) if inc_vals else ''

    def _remarks_emoji(self, student_number: str, has_submission: bool, code_not_found: bool):
        if not has_submission:
            return '', ''
        if code_not_found:
            return '⛔', ''
        raw = self.remarks_data.get(student_number, '')
        if not raw or raw == 'OK':
            return '✅', ''
        items     = [r for r in raw.split('; ') if r]
        emoji_map = []
        for item in items:
            il = item.lower()
            if 'student number not found' in il:
                emoji_map.append('🪪')
            elif 'redacted' in il:
                emoji_map.append('◼️')
            elif 'another student number' in il or 'unknown digit sequence' in il:
                emoji_map.append('🤥')
            else:
                emoji_map.append('⚠️')
        seen = set()
        deduped = []
        for e in emoji_map:
            if e not in seen:
                seen.add(e); deduped.append(e)
        return ''.join(deduped), raw

    def _compute_peer_ranking(self, sids, all_extra_counters):
        pair_sims: Dict[tuple, float] = {}
        for sid_a in sids:
            ea      = all_extra_counters.get(sid_a, Counter())
            a_total = sum(ea.values())
            for sid_b in sids:
                if sid_a == sid_b:
                    continue
                eb    = all_extra_counters.get(sid_b, Counter())
                inter = sum((ea & eb).values())
                pair_sims[(sid_a, sid_b)] = round(inter / a_total * 100, 2) if a_total else 0

        peer_ranking: Dict[str, list] = {}
        max_sim:      Dict[str, float] = {}
        for sid in sids:
            others = sorted(
                [(o, pair_sims.get((sid, o), 0)) for o in sids if o != sid and pair_sims.get((sid, o), 0) > 0],
                key=lambda x: -x[1],
            )
            peer_ranking[sid] = others
            max_sim[sid]      = others[0][1] if others else 0
        return peer_ranking, max_sim

    def _extract_interactions(self) -> Dict[str, str]:
        def _names_from(raw) -> List[str]:
            if raw is None or raw == '':
                return []
            if isinstance(raw, list):
                return [str(s).strip() for s in raw if str(s).strip()]
            return [p.strip() for p in str(raw).split(',') if p.strip()]

        iacts: List[Tuple[float, str, str]] = []
        for ev in self._lesson_interactions:
            ts_s  = ev.get('timestamp', 0) / 1000
            itype = ev.get('interaction', '')
            if itype == 'teacher-question':
                for n in _names_from(ev.get('answered_by')):
                    iacts.append((ts_s, 'A', n))
            elif itype == 'student-question':
                for n in _names_from(ev.get('asked_by')):
                    iacts.append((ts_s, 'Q', n))
            elif itype == 'providing-help':
                for n in _names_from(ev.get('student')):
                    iacts.append((ts_s, 'H', n))

        iacts.sort(key=lambda x: x[0])
        per_sid: Dict[str, List[str]] = {}
        for _, letter, nm in iacts:
            found = self.name_to_id.get(nm)
            if not found and nm in self.student_info:
                found = nm
            if not found:
                try:
                    candidate = str(int(nm))
                    if candidate in self.student_info:
                        found = candidate
                except (ValueError, TypeError):
                    pass
            if found:
                per_sid.setdefault(found, []).append(letter)
        return {s: ', '.join(v) for s, v in per_sid.items()}

    def _check_required(self, sid: str, has_submission: bool, code_not_found: bool):
        if not (self.required_items or self.not_expected_items) \
                or not has_submission or code_not_found:
            return '', '', [], None

        raw_text       = self.student_raw_texts.get(sid, '').lower()
        raw_no_space   = raw_text.replace(' ', '')
        missing = [
            ' / '.join(alts)
            for alts in self.required_items
            if not any(
                a.lower() in raw_text or a.lower().replace(' ', '') in raw_no_space
                for a in alts
            )
        ]
        forbidden = [
            ' / '.join(alts)
            for alts in self.not_expected_items
            if any(
                a.lower() in raw_text or a.lower().replace(' ', '') in raw_no_space
                for a in alts
            )
        ]
        total      = len(self.required_items)
        found_cnt  = total - len(missing)
        count_parts = []
        if self.required_items:
            count_parts.append(f'{found_cnt}/{total}')
        if forbidden:
            count_parts.append(f'!{len(forbidden)}')
        req_count   = ', '.join(count_parts)
        req_missing = missing + [f'!{kw}' for kw in forbidden]
        req_details = ', '.join(req_missing)

        req_fill = None
        if total > 0 and found_cnt < total:
            intensity = 1.0 - found_cnt / total
            gb = int(255 - intensity * 148)
            req_fill = PatternFill(start_color=f'FF{gb:02X}{gb:02X}',
                                   end_color=f'FF{gb:02X}{gb:02X}', fill_type='solid')
        elif forbidden:
            req_fill = PatternFill(start_color='FFDD88', end_color='FFDD88', fill_type='solid')
        return req_count, req_details, req_missing, req_fill

    @staticmethod
    def _auto_column_widths(sheet) -> None:
        for column in sheet.columns:
            col_letter = column[0].column_letter
            max_length = 0
            for cell in column:
                try:
                    if cell.value:
                        max_length = max(max_length, len(str(cell.value)))
                except Exception:
                    pass
            sheet.column_dimensions[col_letter].width = min(max_length + 2, 50)
