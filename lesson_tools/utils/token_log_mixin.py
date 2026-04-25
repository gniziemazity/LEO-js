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
    _build_context_first_diff_marks,
    _build_file_ordered_ts_map,
    _build_file_timeline,
    _build_ghost_contexts,
    _build_git_diff_marks,
    _build_leo_diff_marks,
    _build_lcs_token_diff_marks,
    _build_ro_diff_marks,
    _build_student_file_coloring,
    _build_student_token_occurrences,
    _build_teacher_file_coloring,
    _build_vscode_diff_marks,
    _colors_to_position_marks,
    _extract_student_tokens,
    _file_at_ts,
    _parse_teacher_tokens,
    _update_tokens_txt_extra_star,
    _update_tokens_txt_missing,
)


class TokenLogMixin:
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

        all_events = getattr(self, '_lesson_all_events', None)
        ghost_contexts = None
        ts_map_cached: Dict[str, List[str]] = {}
        if all_events:
            ts_map_cached = _build_file_ordered_ts_map(all_events)
            removed_keys = {tok for tok, _, _, is_rem, *_ in teacher_entries if is_rem}
            if removed_keys:
                ghost_contexts = _build_ghost_contexts(all_events, removed_keys)
                n_with_ctx = sum(1 for k in removed_keys if k in ghost_contexts)
                print(f'  Ghost contexts: {n_with_ctx}/{len(removed_keys)} removed tokens '
                      f'have deletion-batch context')
        self._ghost_contexts = ghost_contexts

        written = 0
        for student_dir in sorted(names_dir.iterdir()):
            if not student_dir.is_dir():
                continue
            sid = self.name_to_id.get(student_dir.name)
            if sid is None or sid not in self.results:
                continue

            anon_dir = student_dir
            if anon_names_dir is not None and anon_names_dir.is_dir():
                candidate = anon_names_dir / student_dir.name
                if candidate.is_dir():
                    anon_dir = candidate

            stu_files = self.get_all_code_files(anon_dir) or self.get_all_code_files(student_dir)
            if not stu_files:
                continue

            student_outside, student_comment = _extract_student_tokens(stu_files)
            all_occ, n_found, n_missing, n_extra, follow_e_pct, _ = _build_student_token_occurrences(
                teacher_entries, student_outside, student_comment
            )

            n_found_e   = sum(1 for _, _, fl in all_occ if not fl)
            n_missing_e = sum(1 for _, _, fl in all_occ if fl == {'MISSING'})
            teacher_total_e = n_found_e + n_missing_e

            n_found_c   = sum(1 for _, _, fl in all_occ if fl == {'COMMENT'})
            n_missing_c = sum(1 for _, _, fl in all_occ if fl == {'MISSING', 'COMMENT'})
            comment_total = n_found_c + n_missing_c
            follow_c_pct  = (round(n_found_c / comment_total * 100, 1)
                             if comment_total else 0.0)

            extra_ctr         = Counter(tok for _, tok, fl in all_occ if fl == {'EXTRA'})
            extra_star_ctr    = Counter(tok for _, tok, fl in all_occ if fl == {'EXTRA*'})
            extra_comment_ctr = Counter(tok for _, tok, fl in all_occ if fl == {'COMMENT', 'EXTRA'})
            extra_star_comment_ctr = Counter(tok for _, tok, fl in all_occ if fl == {'COMMENT', 'EXTRA*'})

            _miss_e  = sorted((ts, f'-{tok}')  for ts, tok, fl in all_occ if fl == {'MISSING'})
            _miss_c  = sorted((ts, f'-{tok}')  for ts, tok, fl in all_occ if fl == {'MISSING', 'COMMENT'})
            _extra   = sorted((ts, f'+{tok}')  for ts, tok, fl in all_occ if fl == {'EXTRA'})
            _extra_s = sorted((ts, f'+{tok}*') for ts, tok, fl in all_occ if fl == {'EXTRA*'})
            _extra_c = sorted((ts, f'+{tok}')  for ts, tok, fl in all_occ if fl == {'COMMENT', 'EXTRA'})
            _extra_sc= sorted((ts, f'+{tok}*') for ts, tok, fl in all_occ if fl == {'COMMENT', 'EXTRA*'})
            _comb_e  = sorted(_miss_e + _extra + _extra_s)
            _comb_c  = sorted(_miss_c + _extra_c + _extra_sc)

            def _fmt_item(ts_str: str, s: str) -> str:
                return f'{s} ({ts_str})'

            def _fmt_ctr(c: Counter) -> List[str]:
                return [f'{t} (x{n})' if n > 1 else t for t, n in sorted(c.items())]

            self._student_token_stats[sid] = {
                'found':                 n_found,
                'missing':               n_missing,
                'extra':                 n_extra,
                'n_extra_comment':       len(extra_comment_ctr),
                'teacher_total_e':       teacher_total_e,
                'follow_e':              follow_e_pct,
                'follow_c':              follow_c_pct,
                'extra_e_text':          ', '.join(_fmt_item(ts, s) for ts, s in _comb_e),
                'comment_text':          ', '.join(_fmt_item(ts, s) for ts, s in _comb_c),
                'extra_e_items':         [_fmt_item(ts, s) for ts, s in _comb_e],
                'comment_items':         [_fmt_item(ts, s) for ts, s in _comb_c],
                'extra_all':             _fmt_ctr(extra_ctr) + [f'{t}* (x{n})' if n > 1 else f'{t}*' for t, n in sorted(extra_star_ctr.items())],
                'extra_comment_all':     _fmt_ctr(extra_comment_ctr) + [f'{t}* (x{n})' if n > 1 else f'{t}*' for t, n in sorted(extra_star_comment_ctr.items())],
                'extra_counter':         extra_ctr,
                'extra_comment_counter': extra_comment_ctr,
                'extra_star':            sum(extra_star_ctr.values()),
                'extra_star_all':         _fmt_ctr({f'{t}*': n for t, n in (extra_star_ctr + extra_star_comment_ctr).items()}),
                'extra_e_count':         len(_comb_e),
                'comment_count':         len(_comb_c),
            }

            out_path = student_dir / 'tokens.txt'
            with open(out_path, 'w', encoding='utf-8') as fh:
                fh.write(f'# Found            : {n_found}\n')
                fh.write(f'# MISSING          : {n_missing}\n')
                fh.write(f'# EXTRA            : {n_extra}\n')
                fh.write(f'# Follow (E)       : {follow_e_pct} %\n')
                for ts, token, flags in all_occ:
                    flag_str = '\t'.join(sorted(flags))
                    suffix   = f'\t{flag_str}' if flag_str else ''
                    fh.write(f'{token}\t{ts}{suffix}\n')

            teacher_code_files = self.get_all_code_files(self.reference_dir)
            try:
                t_marks, s_marks, base_score = _build_leo_diff_marks(teacher_code_files, stu_files)
            except Exception:
                t_marks, s_marks, base_score = {}, {}, follow_e_pct

            diff_marks = {
                'token_matching': 'leo',
                'case_sensitive': True,
                'score': base_score if base_score is not None else follow_e_pct,
                'teacher_files': t_marks,
                'student_files': s_marks,
            }
            _add_log_metadata(
                diff_marks, all_events, stu_files,
                _ghost_contexts=ghost_contexts, _ts_map=ts_map_cached or None,
            )
            _update_tokens_txt_missing(out_path, diff_marks)
            corrected_miss_e = sorted(
                (m['timestamp'], f"-{m['token']}")
                for marks in diff_marks.get('teacher_files', {}).values()
                for m in marks
                if m.get('label') == 'missing' and 'timestamp' in m
            )
            if corrected_miss_e:
                _miss_e = corrected_miss_e
                _comb_e_corr = sorted(_miss_e + _extra + _extra_s)
                self._student_token_stats[sid]['extra_e_text']  = ', '.join(_fmt_item(ts, s) for ts, s in _comb_e_corr)
                self._student_token_stats[sid]['extra_e_items'] = [_fmt_item(ts, s) for ts, s in _comb_e_corr]
                self._student_token_stats[sid]['extra_e_count'] = len(_comb_e_corr)
            removal_ts_by_token = {
                tok: removal_ts
                for tok, _, _, is_rem, removal_ts in teacher_entries
                if is_rem and removal_ts
            }
            if removal_ts_by_token:
                corrected_score, extra_star_counts, steal_from_found = _update_tokens_txt_extra_star(
                    out_path, diff_marks, removal_ts_by_token
                )
            else:
                corrected_score = follow_e_pct
                extra_star_counts = Counter()
                steal_from_found = Counter()
            diff_marks['score'] = corrected_score
            self._student_token_stats[sid]['follow_e'] = corrected_score

            if anon_dir != student_dir:
                shutil.copy2(out_path, anon_dir / 'tokens.txt')

            if extra_star_counts or steal_from_found:
                stats = self._student_token_stats[sid]

                stolen_miss_items: list = []
                stolen_star_items: list = []
                if steal_from_found:
                    found_occ_by_tok: dict = {}
                    for ts_o, tok_o, fl_o in all_occ:
                        if not fl_o:
                            found_occ_by_tok.setdefault(tok_o, []).append(ts_o)
                    for tok_s, n_steal in steal_from_found.items():
                        found_ts_list = found_occ_by_tok.get(tok_s, [])
                        for i in range(n_steal):
                            ts_found = found_ts_list[i] if i < len(found_ts_list) else '00:00:00'
                            stolen_miss_items.append((ts_found, f'-{tok_s}'))
                            ts_removal = removal_ts_by_token.get(tok_s, ts_found)
                            stolen_star_items.append((ts_removal, f'+{tok_s}*'))

                used = Counter()
                new_comb_e = []
                for ts, s in sorted(_miss_e + stolen_miss_items + _extra):
                    if s.startswith('+'):
                        tok_name = s[1:]
                        if used[tok_name] < extra_star_counts.get(tok_name, 0):
                            used[tok_name] += 1
                            new_ts = removal_ts_by_token.get(tok_name, ts)
                            new_comb_e.append((new_ts, f'+{tok_name}*'))
                        else:
                            new_comb_e.append((ts, s))
                    else:
                        new_comb_e.append((ts, s))

                new_comb_e.extend(stolen_star_items)
                new_comb_e.sort(key=lambda x: x[0])

                def _fmt_item_local(ts_str: str, s: str) -> str:
                    return f'{s} ({ts_str})'

                stats['extra_e_text']  = ', '.join(_fmt_item_local(ts, s) for ts, s in new_comb_e)
                stats['extra_e_items'] = [_fmt_item_local(ts, s) for ts, s in new_comb_e]
                stats['extra_e_count'] = len(new_comb_e)

                remaining_extra = Counter(extra_ctr)
                new_extra_star_ctr: Counter = Counter()
                for tok_name, n in extra_star_counts.items():
                    promoted = min(n, remaining_extra[tok_name])
                    remaining_extra[tok_name] -= promoted
                    if remaining_extra[tok_name] <= 0:
                        del remaining_extra[tok_name]
                    if promoted:
                        new_extra_star_ctr[tok_name] += promoted
                for tok_name, n in steal_from_found.items():
                    new_extra_star_ctr[tok_name] += n

                stats['extra_all'] = _fmt_ctr(remaining_extra) + [
                    f'{t}* (x{n})' if n > 1 else f'{t}*'
                    for t, n in sorted(new_extra_star_ctr.items())
                ]
                stats['extra_star']     = sum(new_extra_star_ctr.values())
                stats['extra_star_all'] = [
                    f'{t}* (x{n})' if n > 1 else f'{t}*'
                    for t, n in sorted(new_extra_star_ctr.items())
                ]

            diff_path = anon_dir / 'diff_marks.json'
            with open(diff_path, 'w', encoding='utf-8') as fh:
                json.dump(diff_marks, fh, ensure_ascii=False, indent=2)

            written += 1

        print(f'  Written token files for {written} student(s) in {names_dir.name}/')

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

            anon_dir = student_dir
            if anon_names_dir is not None and anon_names_dir.is_dir():
                candidate = anon_names_dir / student_dir.name
                if candidate.is_dir():
                    anon_dir = candidate

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
            diff_marks = {
                'token_matching': 'similarity-containment',
                'case_sensitive': True,
                'teacher_files': _colors_to_position_marks(teacher_code_files, teacher_colors),
                'student_files': _colors_to_position_marks(stu_files, student_colors),
            }
            if sim_score is not None:
                diff_marks['score'] = sim_score
            diff_path = anon_dir / 'diff_marks.json'
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
        filename: str = 'diff_marks.json',
    ) -> None:
        teacher_code_files = self.get_all_code_files(self.reference_dir)
        if not teacher_code_files:
            print(f'  {label} skipped — no teacher code files found.')
            return

        all_events = getattr(self, '_lesson_all_events', None)
        _gc = getattr(self, '_ghost_contexts', None)
        _tm: Dict[str, List[str]] = {}
        if all_events:
            _tm = _build_file_ordered_ts_map(all_events)
            if _gc is None:
                _, _, removed_kw_ts, _, _ = reconstruct_tokens_from_keylog_full(all_events)
                removed_keys = set(removed_kw_ts.keys())
                if removed_keys:
                    _gc = _build_ghost_contexts(all_events, removed_keys)

        written = 0
        for student_dir in sorted(names_dir.iterdir()):
            if not student_dir.is_dir():
                continue
            sid = self.name_to_id.get(student_dir.name)
            if sid is None or sid not in self.results:
                continue

            anon_dir = student_dir
            if anon_names_dir is not None and anon_names_dir.is_dir():
                candidate = anon_names_dir / student_dir.name
                if candidate.is_dir():
                    anon_dir = candidate

            stu_files = self.get_all_code_files(anon_dir) or self.get_all_code_files(student_dir)
            if not stu_files:
                continue

            result = build_fn(teacher_code_files, stu_files)
            alignments = None
            line_marks = None
            if len(result) == 5:
                teacher_marks, student_marks, score, alignments, line_marks = result
            elif len(result) == 4:
                teacher_marks, student_marks, score, alignments = result
            elif len(result) == 3:
                teacher_marks, student_marks, score = result
            else:
                teacher_marks, student_marks = result
                score = None

            diff_marks = {
                'token_matching': token_matching,
                'case_sensitive': True,
                'teacher_files': teacher_marks,
                'student_files': student_marks,
            }
            if score is not None:
                diff_marks['score'] = score
            if alignments is not None:
                diff_marks['alignments'] = alignments
            if line_marks:
                diff_marks['line_marks'] = line_marks
            if all_events:
                _add_log_metadata(diff_marks, all_events, stu_files,
                                  _ghost_contexts=_gc, _ts_map=_tm or None)
            diff_path = anon_dir / filename
            with open(diff_path, 'w', encoding='utf-8') as fh:
                json.dump(diff_marks, fh, ensure_ascii=False, indent=2)
            written += 1

        print(f'  Written {label} for {written} student(s) in {names_dir.name}/')

    def write_lcs_diff_marks(self, names_dir: Path, anon_names_dir: Path = None) -> None:
        self._write_alt_diff_marks(
            names_dir, anon_names_dir,
            _build_lcs_token_diff_marks,
            'token-lcs',
            'LCS token diff marks',
            filename='diff_marks_lcs.json',
        )

    def write_ro_diff_marks(self, names_dir: Path, anon_names_dir: Path = None) -> None:
        self._write_alt_diff_marks(
            names_dir, anon_names_dir,
            _build_ro_diff_marks,
            'line-ro',
            'R/O line diff marks',
            filename='diff_marks_ro.json',
        )

    write_myers_diff_marks = write_ro_diff_marks

    def write_ro_star_diff_marks(self, names_dir: Path, anon_names_dir: Path = None) -> None:
        self._write_alt_diff_marks(
            names_dir, anon_names_dir,
            _build_ro_diff_marks,
            'line-ro-star',
            'R/O* line diff marks',
            filename='diff_marks_ro_star.json',
        )

    def write_vscode_diff_marks(self, names_dir: Path, anon_names_dir: Path = None) -> None:
        self._write_alt_diff_marks(
            names_dir, anon_names_dir,
            _build_vscode_diff_marks,
            'line-vscode',
            'VS Code line diff marks',
            filename='diff_marks_vscode.json',
        )

    def write_vscode_star_diff_marks(self, names_dir: Path, anon_names_dir: Path = None) -> None:
        self._write_alt_diff_marks(
            names_dir, anon_names_dir,
            _build_vscode_diff_marks,
            'line-vscode-star',
            'VS Code* line diff marks',
            filename='diff_marks_vscode_star.json',
        )

    def write_git_diff_marks(self, names_dir: Path, anon_names_dir: Path = None) -> None:
        self._write_alt_diff_marks(
            names_dir, anon_names_dir,
            _build_git_diff_marks,
            'line-git',
            'Git line diff marks',
            filename='diff_marks_git.json',
        )

    def write_git_star_diff_marks(self, names_dir: Path, anon_names_dir: Path = None) -> None:
        self._write_alt_diff_marks(
            names_dir, anon_names_dir,
            _build_git_diff_marks,
            'line-git-star',
            'Git* line diff marks',
            filename='diff_marks_git_star.json',
        )

    def write_lcs_star_diff_marks(self, names_dir: Path, anon_names_dir: Path = None,
                                   filename: str = 'diff_marks_lcs_star.json') -> None:
        self._write_alt_diff_marks(
            names_dir, anon_names_dir,
            _build_lcs_token_diff_marks,
            'token-lcs-star',
            'LCS* token diff marks',
            filename=filename,
        )

    def write_context_first_diff_marks(self, names_dir: Path, anon_names_dir: Path = None) -> None:
        self._write_alt_diff_marks(
            names_dir, anon_names_dir,
            _build_context_first_diff_marks,
            'context-first',
            'Context-first diff marks',
            filename='diff_marks_context_first.json',
        )
