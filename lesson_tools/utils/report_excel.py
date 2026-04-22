from collections import Counter
from typing import Dict, List, Tuple

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.formatting.rule import ColorScaleRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from .similarity_measures import (
    save_xlsx,
)


class ExcelReportMixin:
    def generate_excel_report(self, output_file: str, anonymize: bool = False) -> None:
        wb = Workbook()
        sheet = wb.active
        sheet.title = 'Similarity'

        all_exts    = ['.html', '.css', '.js']
        present_exts = [
            e for e in all_exts
            if any(
                data.get('files_compared', {}).get(e, {}).get('status')
                in ('success', 'no_reference')
                for data in self.results.values()
            )
        ]

        header = ['ID', 'Student', 'FileName', 'Diff', 'Char', 'Inc', 'Extra', 'Extra (C)']
        COL_EXTRA  = header.index('Extra')     + 1
        COL_EXTRAC = header.index('Extra (C)') + 1
        sheet.append(header)
        for i, cell in enumerate(sheet[1]):
            h = header[i] if i < len(header) else ''
            cell.font = Font(bold=True, color='808080') if h in ('Diff', 'Char') \
                        else Font(bold=True)

        ts_denom = self._teacher_token_denom()

        def _avg(lst):
            return round(sum(lst) / len(lst), 1) if lst else ''

        for sid in sorted(self.student_info.keys(), key=int):
            info = self.student_info[sid]
            row  = [int(sid), sid if anonymize else info['name']]
            data = self.results.get(sid)
            if not data or not data.get('files_compared'):
                sheet.append(row)
                continue

            fnames = []
            diff_vals, char_vals, inc_vals = [], [], []
            for ext in present_exts:
                fd = data['files_compared'].get(ext)
                if fd and fd.get('status') == 'success':
                    fnames.append(fd['file_name'])
                    diff_vals.append(fd['ide_sim'])
                    char_vals.append(fd['char_hist_sim'])
                    inc_vals.append(fd['inc_sim'])
                elif fd and fd.get('status') == 'no_reference':
                    fnames.append(fd['file_name'])

            extra_pct, extrac_pct, extra_kws, extrac_kws = \
                self._extra_pct_and_kws(sid, ts_denom, data)

            row.extend([
                ', '.join(fnames) if fnames else '',
                _avg(diff_vals), _avg(char_vals), _avg(inc_vals),
                extra_pct, extrac_pct,
            ])
            sheet.append(row)
            cur = sheet.max_row
            if extra_kws:
                c = Comment(', '.join(extra_kws), 'sim_check')
                c.width = 900; c.height = min(150 + 50 * len(extra_kws), 4000)
                sheet.cell(row=cur, column=COL_EXTRA).comment = c
            if extrac_kws:
                c = Comment(', '.join(extrac_kws), 'sim_check')
                c.width = 900; c.height = min(150 + 50 * len(extrac_kws), 4000)
                sheet.cell(row=cur, column=COL_EXTRAC).comment = c

        max_row    = sheet.max_row
        left_border = Border(left=Side(style='medium', color='000000'))
        for r in range(1, max_row + 1):
            sheet[f'C{r}'].border = left_border

        for col in [get_column_letter(i) for i in range(4, 7)]:
            for r in range(2, max_row + 1):
                cell = sheet[f'{col}{r}']
                if cell.value not in ('', None):
                    cell.number_format = '0.0'
                    cell.alignment = Alignment(horizontal='center')
                    if col in ('D', 'E'):
                        cell.font = Font(color='808080')
            if max_row > 1:
                sheet.conditional_formatting.add(
                    f'{col}2:{col}{max_row}',
                    ColorScaleRule(start_type='min', start_color='FFFFFF',
                                   end_type='max', end_color='5A8AC6'))

        for col_idx in (COL_EXTRA, COL_EXTRAC):
            col = get_column_letter(col_idx)
            for r in range(2, max_row + 1):
                cell = sheet[f'{col}{r}']
                if cell.value not in ('', None):
                    cell.number_format = '0.0'
                    cell.alignment = Alignment(horizontal='center')
            if max_row > 1:
                sheet.conditional_formatting.add(
                    f'{col}2:{col}{max_row}',
                    ColorScaleRule(start_type='num', start_value=0, start_color='FFFFFF',
                                   end_type='max', end_color='F8696B'))

        self._auto_column_widths(sheet)
        sheet.column_dimensions['B'].width = 18
        sheet.column_dimensions['C'].width = 20
        save_xlsx(wb, output_file)

    def generate_remarks_report(self, output_file: str, anonymize: bool = False) -> None:
        wb = Workbook()
        wb.remove(wb.active)
        self._add_remarks_sheet(wb, anonymize=anonymize)
        save_xlsx(wb, output_file)

    def _add_remarks_sheet(self, wb: Workbook, anonymize: bool = False) -> None:
        sheet   = wb.create_sheet(title='Remarks')
        has_log = bool(self._lesson_keypresses)
        has_sim = not has_log

        header = ['ID', 'Student', 'Number', 'Remarks', 'Extra', 'Extra Desc', 'Inc']
        if has_log:
            header.extend(['Follow (C)', 'Follow (C) Desc',
                            'Follow (E)', 'Follow (E) Desc', 'Interactions'])
        if has_sim:
            header.extend(['Similarity', 'Similarity Desc'])
        if self.required_items or self.not_expected_items:
            header.extend(['Expected', 'Expected Desc'])
        header.extend(['Obs', 'Grade', 'Comments'])

        COL_EXTRA   = 5
        COL_EXTRA_T = 6
        COL_INC     = 7
        _next = 8
        if has_log:
            COL_FOLLOWC   = _next; _next += 1
            COL_FOLLOWC_T = _next; _next += 1
            COL_FOLLOWE   = _next; _next += 1
            COL_FOLLOWE_T = _next; _next += 1
            COL_INTERACT  = _next; _next += 1
        else:
            COL_FOLLOWC = COL_FOLLOWC_T = COL_FOLLOWE = COL_FOLLOWE_T = COL_INTERACT = None
        if has_sim:
            COL_SIM   = _next; _next += 1
            COL_SIM_T = _next; _next += 1
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

        sids               = sorted(self.student_info.keys(), key=int)
        all_extra_counters = {
            sid: sum(self.student_simple_extra_by_ext.get(sid, {}).values(), Counter())
            for sid in sids
        }
        peer_ranking, max_sim = self._compute_peer_ranking(sids, all_extra_counters)

        teacher_agg = self._teacher_aggregates()
        _teacher_outside_all_ci = teacher_agg['outside_all']
        _teacher_inside_all_ci  = teacher_agg['inside_all']
        _teacher_all_ci         = teacher_agg['all']
        _extra_denom            = max(1, sum(_teacher_outside_all_ci.values()))

        student_interactions = self._extract_interactions() if has_log else {}

        for sid in sids:
            info          = self.student_info[sid]
            display_name  = sid if anonymize else info['name']
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
            ts_denom = self._teacher_token_denom()

            if _ts and has_submission and not code_not_found:
                follow_e_pct  = _ts['follow_e']
                comment_pct   = _ts['follow_c']
                ts_denom_r    = _ts['teacher_total_e'] or 1
                extra_pct     = (round(min(_ts['extra'] / ts_denom_r * 100, 100.0), 1)
                                 if _ts['extra'] else 0.0)
                extra_e_text  = _ts['extra_e_text']
                extra_e_count = _ts['extra_e_count']
                comment_text  = _ts['comment_text']
                comment_count = _ts['comment_count']
                extra_all     = _ts['extra_all']
            else:
                follow_e_pct = extra_e_count = ''
                comment_pct  = comment_count = ''
                extra_e_text = comment_text  = ''
                extra_pct    = (round(min(sum(extra_ctr.values()) / _extra_denom * 100, 100.0), 1)
                                if has_submission and not code_not_found else '')

            req_count, req_details, req_missing, req_fill = self._check_required(
                sid, has_submission, code_not_found
            )
            sim_items = []

            if code_not_found:
                row = [int(sid), display_name, info['number'], '⛔']
                row.extend([''] * (len(header) - 4))
            else:
                row = [int(sid), display_name, info['number'],
                       remarks_emoji, extra_pct,
                       ', '.join(extra_all) if extra_all else '',
                       inc_pct]
                if has_log:
                    row.extend([comment_pct, comment_text,
                                 follow_e_pct, extra_e_text,
                                 student_interactions.get(sid, '')])
                if has_sim:
                    sim_pct, sim_desc, sim_items = self._similarity_info(
                        sid, has_submission, code_not_found)
                    row.extend([sim_pct, sim_desc])
                if self.required_items or self.not_expected_items:
                    row.extend([req_count, req_details])
                row.extend(['_' if has_submission else '', ''])

            sheet.append(row)
            cur = sheet.max_row

            if req_fill and COL_EXPECTED:
                sheet.cell(row=cur, column=COL_EXPECTED).fill = req_fill

            ms = max_sim.get(sid, 0)
            if ms > 50:
                t = min(1.0, (ms - 50) / 50)
                g = b = int(255 * (1 - t))
                fill = PatternFill(start_color=f'FF{g:02X}{b:02X}',
                                   end_color=f'FF{g:02X}{b:02X}', fill_type='solid')
                sheet.cell(row=cur, column=1).fill = fill
                sheet.cell(row=cur, column=2).fill = fill

            peers = peer_ranking.get(sid, [])
            if peers:
                lines  = [(f"{o} ({int(s)}%)" if anonymize
                           else f"{self.student_info[o]['name']} ({int(s)}%)")
                          for o, s in peers]
                lines2 = [f"{o} ({int(s)}%)" for o, s in peers]
                for lines_, col_, w_ in [(lines, 2, 400), (lines2, 1, 300)]:
                    c = Comment(', '.join(lines_), 'sim_check')
                    c.width  = w_
                    c.height = min(100 + 30 * len(lines_), 1200)
                    sheet.cell(row=cur, column=col_).comment = c

            if code_not_found:
                c = Comment('No HTML/CSS/JS files found in submission', 'sim_check')
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

            if has_sim and sim_items and COL_SIM:
                c = Comment(', '.join(sim_items), 'sim_check')
                c.width  = 400
                c.height = min(200 + 80 * len(sim_items), 6000)
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

        self._auto_column_widths(sheet)
        sheet.column_dimensions['B'].width = 18

    def _similarity_info(self, sid: str, has_submission: bool, code_not_found: bool):
        """Returns (sim_pct, sim_desc_str, sim_items_list) for no-log Similarity column.
        sim_pct   = average inc_sim across files (same value as Inc column).
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
        for ext in ['.html', '.css', '.js']:
            fd = data['files_compared'].get(ext)
            if not fd or fd.get('status') != 'success':
                continue
            inc_vals.append(fd['inc_sim'])
            if ext == '.html':
                t_html_css = (self.teacher_html_outside_css_by_ext.get(ext, Counter())
                              or self.teacher_html_outside_by_ext.get(ext, Counter()))
                teacher_ext = (t_html_css
                               + self.teacher_script_outside_by_ext.get(ext, Counter()))
            elif ext == '.css':
                teacher_ext = self.teacher_tokens_by_ext.get(ext, Counter())
            else:
                teacher_ext = self.teacher_tokens_by_ext.get(ext, Counter())
            teacher_agg += teacher_ext
        student_agg: Counter = getattr(self, '_student_all_outside', {}).get(sid, Counter())

        parts     = []
        sim_items = []
        for kw, n in sorted((teacher_agg - student_agg).items()):
            parts.append(f'-{kw} (x{n})' if n > 1 else f'-{kw}')
            sim_items.append(f'Missing: {kw}' + (f' (x{n})' if n > 1 else ''))
        for kw, n in sorted((student_agg - teacher_agg).items()):
            parts.append(f'+{kw} (x{n})' if n > 1 else f'+{kw}')
            sim_items.append(f'Extra: {kw}' + (f' (x{n})' if n > 1 else ''))
        sim_pct  = round(sum(inc_vals) / len(inc_vals), 1) if inc_vals else ''
        sim_desc = ', '.join(parts)
        return (sim_pct, sim_desc, sim_items)

    def _teacher_token_denom(self) -> int:
        _ts_denom = next(
            (v['teacher_total_e'] for v in self._student_token_stats.values()
             if v.get('teacher_total_e')),
            None,
        )
        if _ts_denom:
            return _ts_denom
        teacher_outside = (
            sum(self.teacher_html_outside_css_by_ext.values(), Counter())
            + self.teacher_outside_by_ext.get('.css', Counter())
            + sum(self.teacher_script_outside_by_ext.values(), Counter())
            + self.teacher_outside_by_ext.get('.js', Counter())
        )
        return max(1, sum(teacher_outside.values()))

    def _teacher_aggregates(self) -> Dict:
        outside_all = (
            sum(self.teacher_html_outside_css_by_ext.values(), Counter())
            + sum(self.teacher_script_outside_by_ext.values(), Counter())
            + self.teacher_outside_by_ext.get('.css', Counter())
            + self.teacher_outside_by_ext.get('.js', Counter())
        )
        inside_all = sum(self.teacher_inside_by_ext.values(), Counter())
        return {
            'outside_all': outside_all,
            'inside_all':  inside_all,
            'all':         outside_all + inside_all,
        }

    def _extra_pct_and_kws(self, sid: str, ts_denom: int, data: dict):
        _ts = self._student_token_stats.get(sid)
        if _ts:
            denom      = _ts['teacher_total_e'] or ts_denom
            extra_pct  = round(min(_ts['extra']         / denom * 100, 100.0), 1) if _ts['extra']         else ''
            extrac_pct = round(min(_ts['n_extra_comment'] / denom * 100, 100.0), 1) if _ts['n_extra_comment'] else ''
            return extra_pct, extrac_pct, _ts['extra_all'], _ts['extra_comment_all']

        extra_ctr = sum(self.student_simple_extra_by_ext.get(sid, {}).values(), Counter())
        extra_pct = round(min(sum(extra_ctr.values()) / ts_denom * 100, 100.0), 1) if extra_ctr else ''
        extra_kws = [f'{kw} (x{n})' if n > 1 else kw for kw, n in sorted(extra_ctr.items())]
        extrac_ctr = sum(
            (fd.get('extra_inside', Counter())
             for fd in data['files_compared'].values()
             if fd.get('status') == 'success'),
            Counter()
        )
        extrac_pct = round(min(sum(extrac_ctr.values()) / ts_denom * 100, 100.0), 1) if extrac_ctr else ''
        extrac_kws = [f'{kw} (x{n})' if n > 1 else kw for kw, n in sorted(extrac_ctr.items())]
        return extra_pct, extrac_pct, extra_kws, extrac_kws

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
        iacts: List[Tuple[float, str, str]] = []
        for ev in self._lesson_interactions:
            ts_s  = ev.get('timestamp', 0) / 1000
            itype = ev.get('interaction', '')
            if itype == 'teacher-question':
                raw = ev.get('answered_by', '') or ''
                names = (
                    [s.strip() for s in raw if str(s).strip()]
                    if isinstance(raw, list)
                    else [p.strip() for p in str(raw).split(',') if p.strip()]
                )
                for n in names:
                    iacts.append((ts_s, 'A', n))
            elif itype == 'student-question':
                n = str(ev.get('asked_by') or '').strip()
                if n:
                    iacts.append((ts_s, 'Q', n))
            elif itype == 'providing-help':
                n = str(ev.get('student') or '').strip()
                if n:
                    iacts.append((ts_s, 'H', n))

        iacts.sort(key=lambda x: x[0])
        per_sid: Dict[str, List[str]] = {}
        for _, letter, nm in iacts:
            found = self.name_to_id.get(nm)
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
