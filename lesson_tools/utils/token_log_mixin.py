import copy
import json
import shutil
from collections import Counter
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from .similarity_measures import (
    get_reconstructed_files,
    reconstruct_tokens_from_keylog_full,
    ts_to_local,
)
from .token_log import (
    _add_log_metadata,
    _build_file_ordered_ts_map,
    _build_file_timeline,
    _build_ghost_contexts,
    _build_git_diff_marks,
    _build_leo_diff_marks,
    _build_lcs_token_diff_marks,
    _build_lev_token_diff_marks,
    _build_occ_from_diff_marks,
    _build_ro_diff_marks,
    _build_student_file_coloring,
    _build_teacher_file_coloring,
    _colors_to_position_marks,
    _extract_student_tokens,
    _file_at_ts,
    _parse_teacher_tokens,
    _strip_internal_fields,
)


_RECO_EXTS = {'.html', '.htm', '.css', '.js'}


class TokenLogMixin:
    def _resolve_anon_dir(self, student_dir: Path, anon_names_dir: Optional[Path], sid: str) -> Path:
        if anon_names_dir is None or not anon_names_dir.is_dir():
            return student_dir
        display = (self.student_info.get(sid) or {}).get('name')
        if display and display != student_dir.name:
            candidate = anon_names_dir / display
            if candidate.is_dir():
                return candidate
        candidate = anon_names_dir / student_dir.name
        if candidate.is_dir():
            return candidate
        return student_dir

    def _get_teacher_code_files(self) -> Dict[str, Path]:
        all_events = getattr(self, '_lesson_all_events', None)
        if all_events:
            reco_dir = self.reference_dir.parent / 'reconstructed'
            if reco_dir.is_dir():
                files = {p.name: p for p in sorted(reco_dir.iterdir()) if p.suffix.lower() in _RECO_EXTS}
                if files:
                    return files
            reco_html = self.reference_dir / 'reconstructed.html'
            if reco_html.exists():
                return {'reconstructed.html': reco_html}
        return self.get_all_code_files(self.reference_dir)

    def write_keyword_log(self) -> None:
        has_css = bool(
            self.teacher_tokens_by_ext.get('.css')
            or self.teacher_tokens_by_ext.get('.html')
        )

        all_events = getattr(self, '_lesson_all_events', None) or (
            self._lesson_keypresses + self._lesson_code_inserts
        )
        kw_ts, kw_ts_comment, removed_kw_ts, upper_to_display, occ_with_display = (
            reconstruct_tokens_from_keylog_full(all_events, has_css=has_css)
        )

        if not kw_ts and not removed_kw_ts:
            print('  Keyword log skipped \u2014 no key-log data.')
            return

        all_occ: List[Tuple[int, int, str, bool, bool]] = []

        for tok, ts_list in kw_ts.items():
            occ_sorted = sorted(occ_with_display.get(tok, []))
            comment_ts_set = set(kw_ts_comment.get(tok, []))
            for ts, disp in occ_sorted:
                all_occ.append((ts, 0, disp, ts in comment_ts_set, False))

        for tok, ts_list in removed_kw_ts.items():
            disp = upper_to_display.get(tok, tok)
            for ins_ts, del_ts in ts_list:
                all_occ.append((ins_ts, del_ts, disp, False, True))

        all_occ.sort(key=lambda x: x[0])

        n_typed   = sum(1 for _, _, _, _, is_removed in all_occ if not is_removed)
        n_removed = sum(1 for _, _, _, _, is_removed in all_occ if is_removed)

        file_timeline   = _build_file_timeline(all_events)
        active_files    = {f for _, f in file_timeline}
        has_multi_files = active_files - {"MAIN"}

        out_path = self.reference_dir / 'tokens.txt'
        with open(out_path, 'w', encoding='utf-8') as fh:
            fh.write(f'# Occurrences: {n_typed}\n')
            fh.write(f'# Removed    : {n_removed}\n')
            fh.write(f'# Unique     : {len(kw_ts)}\n')
            for ins_ts, del_ts, token, is_comment, is_removed in all_occ:
                flags: List[str] = []
                if is_comment:
                    flags.append('COMMENT')
                if is_removed:
                    flags.append('REMOVED')
                file_col    = f'\t{_file_at_ts(ins_ts, file_timeline)}' if has_multi_files else ''
                removal_col = f'\t{ts_to_local(del_ts)}' if is_removed else ''
                suffix      = ('\t' + '\t'.join(flags)) if flags else ''
                fh.write(f'{token}\t{ts_to_local(ins_ts)}{file_col}{suffix}{removal_col}\n')

        print(f'  Written: correct/{out_path.name}  ({n_typed} occurrences, '
              f'{n_removed} removed, {len(kw_ts)} unique)')

        reco_files = get_reconstructed_files(all_events)
        if reco_files:
            reco_dir = self.reference_dir.parent / 'reconstructed'
            reco_dir.mkdir(exist_ok=True)
            for tab_key, reco_text in reco_files.items():
                reco_name = 'reconstructed.html' if tab_key == 'MAIN' else tab_key
                reco_path = reco_dir / reco_name
                with open(reco_path, 'w', encoding='utf-8') as fh:
                    fh.write(reco_text)
                print(f'  Written: reconstructed/{reco_path.name}  ({len(reco_text)} chars)')

    def write_student_token_files(self, names_dir: Path, anon_names_dir: Path = None) -> None:
        teacher_tokens_path = self.reference_dir / 'tokens.txt'
        if not teacher_tokens_path.exists():
            print('  Student token files skipped \u2014 tokens.txt not found.')
            return

        teacher_entries = _parse_teacher_tokens(teacher_tokens_path)
        removal_ts_by_token = {
            tok: removal_ts
            for tok, _, _, is_rem, removal_ts in teacher_entries
            if is_rem and removal_ts
        }

        all_events = getattr(self, '_lesson_all_events', None)
        ghost_contexts = None
        ts_map_cached: Dict[str, List[str]] = {}
        if all_events:
            ts_map_cached = _build_file_ordered_ts_map(all_events)
            removed_keys = {tok for tok, _, _, is_rem, *_ in teacher_entries if is_rem}
            if removed_keys:
                ghost_contexts = _build_ghost_contexts(all_events, removed_keys)
                n_with_ctx = sum(1 for k in removed_keys if k in ghost_contexts)
                print(f'Ghost contexts: {n_with_ctx}/{len(removed_keys)} removed tokens '
                      f'have deletion-batch context')
        self._ghost_contexts = ghost_contexts

        teacher_code_files = self._get_teacher_code_files()

        def _fmt_item(ts_str: str, s: str) -> str:
            return f'{s} ({ts_str})'

        def _fmt_ctr(c: Counter) -> List[str]:
            return [f'{t} (x{n})' if n > 1 else t for t, n in sorted(c.items())]

        written = 0
        for student_dir in sorted(names_dir.iterdir()):
            if not student_dir.is_dir():
                continue
            sid = self.name_to_id.get(student_dir.name)
            if sid is None or sid not in self.results:
                continue

            anon_dir = self._resolve_anon_dir(student_dir, anon_names_dir, sid)

            stu_files = self.get_all_code_files(anon_dir) or self.get_all_code_files(student_dir)
            if not stu_files:
                continue

            try:
                t_marks, s_marks, _score, alignments, *_ = _build_leo_diff_marks(
                    teacher_code_files, stu_files
                )
            except Exception:
                t_marks, s_marks, alignments = {}, {}, None

            diff_marks: dict = {
                'token_matching': 'leo_star',
                'teacher_files':  t_marks,
                'student_files':  s_marks,
            }
            if alignments:
                diff_marks['alignments'] = alignments

            _, ns_score_e, *_ = _build_occ_from_diff_marks(diff_marks, teacher_entries, None)
            non_star = copy.deepcopy(diff_marks)
            non_star['token_matching'] = 'leo'
            non_star['score'] = ns_score_e
            _strip_internal_fields(non_star)
            with open(anon_dir / 'diff_marks_leo.json', 'w', encoding='utf-8') as fh:
                json.dump(non_star, fh, ensure_ascii=False, indent=2)

            if all_events:
                _add_log_metadata(
                    diff_marks, all_events, stu_files,
                    _ghost_contexts=ghost_contexts, _ts_map=ts_map_cached or None,
                )

            all_occ, score_e, score_c, n_found, n_missing, n_extra, _n_extra_star = (
                _build_occ_from_diff_marks(diff_marks, teacher_entries, removal_ts_by_token or None)
            )
            diff_marks['score'] = score_e

            n_found_e   = sum(1 for _, _, fl in all_occ if not fl)
            n_missing_e = sum(1 for _, _, fl in all_occ if fl == {'MISSING'})
            teacher_total_e = n_found_e + n_missing_e

            extra_ctr              = Counter(tok for _, tok, fl in all_occ if fl == {'EXTRA'})
            extra_star_ctr         = Counter(tok for _, tok, fl in all_occ if fl == {'EXTRA*'})
            extra_comment_ctr      = Counter(tok for _, tok, fl in all_occ if fl == {'COMMENT', 'EXTRA'})
            extra_star_comment_ctr = Counter(tok for _, tok, fl in all_occ if fl == {'COMMENT', 'EXTRA*'})

            _miss_e  = sorted((ts, f'-{tok}')  for ts, tok, fl in all_occ if fl == {'MISSING'})
            _miss_c  = sorted((ts, f'-{tok}')  for ts, tok, fl in all_occ if fl == {'MISSING', 'COMMENT'})
            _extra   = sorted((ts, f'+{tok}')  for ts, tok, fl in all_occ if fl == {'EXTRA'})
            _extra_s = sorted((ts, f'+{tok}*') for ts, tok, fl in all_occ if fl == {'EXTRA*'})
            _extra_c = sorted((ts, f'+{tok}')  for ts, tok, fl in all_occ if fl == {'COMMENT', 'EXTRA'})
            _extra_sc = sorted((ts, f'+{tok}*') for ts, tok, fl in all_occ if fl == {'COMMENT', 'EXTRA*'})
            _comb_e  = sorted(_miss_e + _extra + _extra_s)
            _comb_c  = sorted(_miss_c + _extra_c + _extra_sc)

            self._student_token_stats[sid] = {
                'found':                 n_found,
                'missing':               n_missing,
                'extra':                 n_extra,
                'n_extra_comment':       len(extra_comment_ctr),
                'teacher_total_e':       teacher_total_e,
                'follow_e':              score_e,
                'follow_c':              score_c,
                'extra_e_text':          ', '.join(_fmt_item(ts, s) for ts, s in _comb_e),
                'comment_text':          ', '.join(_fmt_item(ts, s) for ts, s in _comb_c),
                'extra_e_items':         [_fmt_item(ts, s) for ts, s in _comb_e],
                'comment_items':         [_fmt_item(ts, s) for ts, s in _comb_c],
                'extra_all':             _fmt_ctr(extra_ctr) + [
                    f'{t}* (x{n})' if n > 1 else f'{t}*'
                    for t, n in sorted(extra_star_ctr.items())
                ],
                'extra_comment_all':     _fmt_ctr(extra_comment_ctr) + [
                    f'{t}* (x{n})' if n > 1 else f'{t}*'
                    for t, n in sorted(extra_star_comment_ctr.items())
                ],
                'extra_counter':         extra_ctr,
                'extra_comment_counter': extra_comment_ctr,
                'extra_star':            sum(extra_star_ctr.values()),
                'extra_star_all':        _fmt_ctr(
                    {f'{t}*': n for t, n in (extra_star_ctr + extra_star_comment_ctr).items()}
                ),
                'extra_e_count':         len(_comb_e),
                'comment_count':         len(_comb_c),
            }

            out_path = student_dir / 'tokens.txt'
            with open(out_path, 'w', encoding='utf-8') as fh:
                fh.write(f'# Found            : {n_found}\n')
                fh.write(f'# MISSING          : {n_missing}\n')
                fh.write(f'# EXTRA            : {n_extra}\n')
                fh.write(f'# Follow (E)       : {score_e} %\n')
                for ts, token, flags in all_occ:
                    flag_str = '\t'.join(sorted(flags))
                    suffix   = f'\t{flag_str}' if flag_str else ''
                    fh.write(f'{token}\t{ts}{suffix}\n')

            if anon_dir != student_dir:
                shutil.copy2(out_path, anon_dir / 'tokens.txt')

            _strip_internal_fields(diff_marks)
            with open(anon_dir / 'diff_marks_leo_star.json', 'w', encoding='utf-8') as fh:
                json.dump(diff_marks, fh, ensure_ascii=False, indent=2)

            written += 1

        print(f'Written LEO diff marks for {written} student(s) in {names_dir.name}/')
        print(f'Written LEO* diff marks for {written} student(s) in {names_dir.name}/')

    def write_similarity_diff_marks(self, names_dir: Path, anon_names_dir: Path = None) -> None:
        teacher_code_files = self.get_all_code_files(self.reference_dir)
        if not teacher_code_files:
            print('  Similarity diff marks skipped — no teacher code files found.')
            return

        written = 0
        for student_dir in sorted(names_dir.iterdir()):
            if not student_dir.is_dir():
                continue
            sid = self.name_to_id.get(student_dir.name)
            if sid is None or sid not in self.results:
                continue

            anon_dir = self._resolve_anon_dir(student_dir, anon_names_dir, sid)

            stu_files = self.get_all_code_files(anon_dir) or self.get_all_code_files(student_dir)
            if not stu_files:
                continue

            data = self.results.get(sid, {})
            if not data or not data.get('files_compared'):
                continue

            teacher_agg: Counter = Counter()
            for ext in ['.html', '.css', '.js']:
                teacher_agg += self.teacher_outside_by_ext.get(ext, Counter())
            student_agg, _ = _extract_student_tokens(stu_files)

            miss_budget: Dict[str, int] = {
                tok: teacher_agg[tok] - student_agg.get(tok, 0)
                for tok in teacher_agg
                if teacher_agg[tok] > student_agg.get(tok, 0)
            }
            found_out: Dict[str, int] = dict(teacher_agg & student_agg)
            extra_budget: Dict[str, int] = dict(student_agg - teacher_agg)

            teacher_colors: Dict[str, dict] = {}
            for t_name, t_path in teacher_code_files.items():
                t_ext = Path(t_name).suffix.lower()
                try:
                    raw = t_path.read_text(encoding='utf-8', errors='ignore')
                    _, file_comm = _extract_student_tokens({t_name: t_path})
                    result = _build_teacher_file_coloring(raw, t_ext, miss_budget, dict(file_comm))
                    if result:
                        teacher_colors[t_path.name] = result
                except Exception:
                    pass

            student_colors: Dict[str, dict] = {}
            for s_name, s_path in stu_files.items():
                s_ext = Path(s_name).suffix.lower()
                try:
                    raw = s_path.read_text(encoding='utf-8', errors='ignore')
                    _, file_comm = _extract_student_tokens({s_name: s_path})
                    result = _build_student_file_coloring(
                        raw, s_ext,
                        found_out, dict(file_comm),
                        {}, extra_budget, {}
                    )
                    if result:
                        student_colors[s_path.name] = result
                except Exception:
                    pass

            teacher_total = sum(teacher_agg.values())
            sim_score = round(sum(found_out.values()) / teacher_total * 100, 1) if teacher_total else None
            diff_marks: dict = {'token_matching': 'similarity-containment'}
            if sim_score is not None:
                diff_marks['score'] = sim_score
            diff_marks['teacher_files'] = _colors_to_position_marks(teacher_code_files, teacher_colors)
            diff_marks['student_files'] = _colors_to_position_marks(stu_files, student_colors)
            diff_path = anon_dir / 'diff_marks_leo_star.json'
            with open(diff_path, 'w', encoding='utf-8') as fh:
                json.dump(diff_marks, fh, ensure_ascii=False, indent=2)
            written += 1

        print(f'  Written similarity diff marks for {written} student(s) in {names_dir.name}/')

    def _write_alt_diff_marks(
        self,
        names_dir: Path,
        anon_names_dir: Optional[Path],
        build_fn,
        token_matching: str,
        label: str,
        filename: str,
        star_token_matching: Optional[str] = None,
        star_filename: Optional[str] = None,
        star_label: Optional[str] = None,
        include_line_marks: bool = True,
    ) -> None:
        teacher_code_files = self._get_teacher_code_files()
        if not teacher_code_files:
            print(f'{label} skipped — no teacher code files found.')
            return

        all_events = getattr(self, '_lesson_all_events', None)
        write_star = star_token_matching is not None and bool(all_events)
        _gc: Optional[dict] = None
        _tm: Dict[str, List[str]] = {}
        if write_star:
            _gc = getattr(self, '_ghost_contexts', None)
            _tm = _build_file_ordered_ts_map(all_events)
            if _gc is None:
                _, _, removed_kw_ts, _, _ = reconstruct_tokens_from_keylog_full(all_events)
                removed_keys = set(removed_kw_ts.keys())
                if removed_keys:
                    _gc = _build_ghost_contexts(all_events, removed_keys)

        written = 0
        written_star = 0
        for student_dir in sorted(names_dir.iterdir()):
            if not student_dir.is_dir():
                continue
            sid = self.name_to_id.get(student_dir.name)
            if sid is None or sid not in self.results:
                continue

            anon_dir = self._resolve_anon_dir(student_dir, anon_names_dir, sid)

            stu_files = self.get_all_code_files(anon_dir) or self.get_all_code_files(student_dir)
            if not stu_files:
                continue

            result = build_fn(teacher_code_files, stu_files)
            alignments = None
            line_marks = None
            teacher_total_nc = None
            if len(result) == 6:
                teacher_marks, student_marks, score, alignments, line_marks, teacher_total_nc = result
            elif len(result) == 5:
                teacher_marks, student_marks, score, alignments, line_marks = result
            elif len(result) == 4:
                teacher_marks, student_marks, score, alignments = result
            elif len(result) == 3:
                teacher_marks, student_marks, score = result
            else:
                teacher_marks, student_marks = result
                score = None

            diff_marks: dict = {'token_matching': token_matching}
            if score is not None:
                diff_marks['score'] = score
            diff_marks['teacher_files'] = teacher_marks
            diff_marks['student_files'] = student_marks
            if alignments is not None:
                diff_marks['alignments'] = alignments
            if include_line_marks and line_marks:
                diff_marks['line_marks'] = line_marks

            if write_star:
                non_star = copy.deepcopy(diff_marks)
                _strip_internal_fields(non_star)
                with open(anon_dir / filename, 'w', encoding='utf-8') as fh:
                    json.dump(non_star, fh, ensure_ascii=False, indent=2)
                written += 1

                diff_marks['token_matching'] = star_token_matching
                _add_log_metadata(diff_marks, all_events, stu_files,
                                  _ghost_contexts=_gc, _ts_map=_tm or None)
                if teacher_total_nc:
                    n_extra_star_count = sum(
                        1 for marks in diff_marks.get('student_files', {}).values()
                        for m in marks if m.get('label') == 'extra_star'
                    )
                    n_missing_nc_star = sum(
                        1 for marks in diff_marks.get('teacher_files', {}).values()
                        for m in marks if m.get('label') == 'missing'
                    )
                    n_found_nc_star = teacher_total_nc - n_missing_nc_star
                    diff_marks['score'] = round(
                        max(0.0, (n_found_nc_star - n_extra_star_count) / teacher_total_nc * 100), 1
                    )
                _strip_internal_fields(diff_marks)
                with open(anon_dir / star_filename, 'w', encoding='utf-8') as fh:
                    json.dump(diff_marks, fh, ensure_ascii=False, indent=2)
                written_star += 1
            else:
                _strip_internal_fields(diff_marks)
                with open(anon_dir / filename, 'w', encoding='utf-8') as fh:
                    json.dump(diff_marks, fh, ensure_ascii=False, indent=2)
                written += 1

        print(f'Written {label} for {written} student(s) in {names_dir.name}/')
        if write_star and star_label:
            print(f'Written {star_label} for {written_star} student(s) in {names_dir.name}/')

    def write_leo_diff_marks(self, names_dir: Path, anon_names_dir: Path = None) -> None:
        self._write_alt_diff_marks(
            names_dir, anon_names_dir,
            _build_leo_diff_marks,
            'leo', 'LEO diff marks', 'diff_marks_leo.json',
            include_line_marks=False,
        )

    def write_lcs_diff_marks(self, names_dir: Path, anon_names_dir: Path = None) -> None:
        all_events = getattr(self, '_lesson_all_events', None)
        self._write_alt_diff_marks(
            names_dir, anon_names_dir,
            _build_lcs_token_diff_marks,
            'lcs', 'LCS diff marks', 'diff_marks_lcs.json',
            star_token_matching='lcs_star' if all_events else None,
            star_filename='diff_marks_lcs_star.json' if all_events else None,
            star_label='LCS* diff marks' if all_events else None,
            include_line_marks=False,
        )

    def write_lev_diff_marks(self, names_dir: Path, anon_names_dir: Path = None) -> None:
        all_events = getattr(self, '_lesson_all_events', None)
        self._write_alt_diff_marks(
            names_dir, anon_names_dir,
            _build_lev_token_diff_marks,
            'lev', 'Lev diff marks', 'diff_marks_lev.json',
            star_token_matching='lev_star' if all_events else None,
            star_filename='diff_marks_lev_star.json' if all_events else None,
            star_label='Lev* diff marks' if all_events else None,
            include_line_marks=False,
        )

    def write_ro_diff_marks(self, names_dir: Path, anon_names_dir: Path = None) -> None:
        all_events = getattr(self, '_lesson_all_events', None)
        self._write_alt_diff_marks(
            names_dir, anon_names_dir,
            _build_ro_diff_marks,
            'ro', 'R/O diff marks', 'diff_marks_ro.json',
            star_token_matching='ro_star' if all_events else None,
            star_filename='diff_marks_ro_star.json' if all_events else None,
            star_label='R/O* diff marks' if all_events else None,
        )

    write_myers_diff_marks = write_ro_diff_marks

    def write_git_diff_marks(self, names_dir: Path, anon_names_dir: Path = None) -> None:
        all_events = getattr(self, '_lesson_all_events', None)
        self._write_alt_diff_marks(
            names_dir, anon_names_dir,
            _build_git_diff_marks,
            'git', 'Git diff marks', 'diff_marks_git.json',
            star_token_matching='git_star' if all_events else None,
            star_filename='diff_marks_git_star.json' if all_events else None,
            star_label='Git* diff marks' if all_events else None,
        )
