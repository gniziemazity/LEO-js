import copy
import json
import shutil
from collections import Counter
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from .lv_editor import reconstruct_all_headless
from .token_log import (
    _add_log_metadata,
    _apply_insert_at_to_unpaired_missings,
    _assemble_diff_marks,
    _build_file_ordered_ts_map,
    _build_git_diff_marks,
    _build_leo_diff_marks,
    _build_lcs_token_diff_marks,
    _build_lev_token_diff_marks,
    _build_occ_from_diff_marks,
    _build_ro_diff_marks,
    _parse_teacher_tokens,
    _strip_internal_fields,
    _write_teacher_tokens_file,
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
        return self.get_all_code_files(self.reference_dir)

    def write_keyword_log(self) -> None:
        all_events = getattr(self, '_lesson_all_events', None) or (
            self._lesson_keypresses + self._lesson_code_inserts
        )
        out_path = self.reference_dir / 'tokens.txt'
        n_typed, n_removed, n_unique = _write_teacher_tokens_file(
            all_events, out_path,
        )
        if not n_typed and not n_removed:
            print('  Keyword log skipped \u2014 no key-log data.')
            return

        print(f'  Written: correct/{out_path.name}  ({n_typed} occurrences, '
              f'{n_removed} removed, {n_unique} unique)')

        reco_files = reconstruct_all_headless(all_events)
        if reco_files:
            reco_dir = self.reference_dir.parent / 'reconstructed'
            reco_dir.mkdir(exist_ok=True)
            for tab_key, reco_text in reco_files.items():
                reco_name = 'reconstructed.html' if tab_key == 'MAIN' else tab_key
                reco_path = reco_dir / reco_name
                with open(reco_path, 'w', encoding='utf-8') as fh:
                    fh.write(reco_text)
                print(f'  Written: reconstructed/{reco_path.name}  ({len(reco_text)} chars)')

    def write_student_token_files(self, names_dir: Path, anon_names_dir: Path = None,
                                   truth_dir: Optional[Path] = None) -> None:
        teacher_tokens_path = self.reference_dir / 'tokens.txt'
        if not teacher_tokens_path.exists():
            print('  Student token files skipped \u2014 tokens.txt not found.')
            return

        teacher_entries = _parse_teacher_tokens(teacher_tokens_path)
        removal_ts_by_token: Dict[str, List[str]] = {}
        for tok, _, _, is_rem, removal_ts in teacher_entries:
            if is_rem and removal_ts:
                removal_ts_by_token.setdefault(tok, []).append(removal_ts)

        all_events = getattr(self, '_lesson_all_events', None)
        ts_map_cached: Dict[str, List[str]] = {}
        if all_events:
            ts_map_cached = _build_file_ordered_ts_map(all_events)

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
                t_marks, s_marks, _score, alignments, _line_marks, _n_total, leo_assignments = (
                    _build_leo_diff_marks(
                        teacher_code_files, stu_files, events=all_events,
                    )
                )
            except Exception:
                t_marks, s_marks, alignments, leo_assignments = {}, {}, None, None

            diff_marks: dict = {
                'token_matching': 'leo_star',
                'teacher_files':  t_marks,
                'student_files':  s_marks,
            }
            if alignments:
                diff_marks['alignments'] = alignments
            if leo_assignments:
                diff_marks['leo_assignments'] = leo_assignments

            non_star = copy.deepcopy(diff_marks)
            non_star['token_matching'] = 'leo'
            _, ns_score_e, *_ = _build_occ_from_diff_marks(non_star, teacher_entries, None)
            non_star['score'] = ns_score_e
            _strip_internal_fields(non_star)
            with open(anon_dir / 'diff_marks_leo.json', 'w', encoding='utf-8') as fh:
                json.dump(non_star, fh, ensure_ascii=False, indent=2)

            if all_events:
                _add_log_metadata(
                    diff_marks, all_events, stu_files,
                    teacher_files=teacher_code_files,
                    _ts_map=ts_map_cached or None,
                )

            all_occ, score_e, score_c, n_found, n_missing, n_extra, _n_ghost_extra = (
                _build_occ_from_diff_marks(diff_marks, teacher_entries, removal_ts_by_token or None)
            )
            diff_marks['score'] = score_e

            if truth_dir is not None:
                truth_src = truth_dir / sid / 'diff_marks_truth.json'
                if truth_src.is_file():
                    with open(truth_src, encoding='utf-8') as _fh:
                        truth_marks = json.load(_fh)
                    _fresh_removal: Dict[str, List[str]] = {}
                    for _tok, _, _, _is_rem, _rt in teacher_entries:
                        if _is_rem and _rt:
                            _fresh_removal.setdefault(_tok, []).append(_rt)
                    all_occ, score_e, score_c, n_found, n_missing, n_extra, _n_ghost_extra = (
                        _build_occ_from_diff_marks(
                            truth_marks, teacher_entries, _fresh_removal or None,
                        )
                    )

            n_found_e   = sum(1 for _, _, fl in all_occ if not fl)
            n_missing_e = sum(1 for _, _, fl in all_occ if fl == {'MISSING'})
            teacher_total_e = n_found_e + n_missing_e

            extra_ctr              = Counter(tok for _, tok, fl in all_occ if fl == {'EXTRA'})
            ghost_extra_ctr         = Counter(tok for _, tok, fl in all_occ if fl == {'EXTRA*'})
            extra_comment_ctr      = Counter(tok for _, tok, fl in all_occ if fl == {'COMMENT', 'EXTRA'})
            ghost_extra_comment_ctr = Counter(tok for _, tok, fl in all_occ if fl == {'COMMENT', 'EXTRA*'})

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
                    for t, n in sorted(ghost_extra_ctr.items())
                ],
                'extra_comment_all':     _fmt_ctr(extra_comment_ctr) + [
                    f'{t}* (x{n})' if n > 1 else f'{t}*'
                    for t, n in sorted(ghost_extra_comment_ctr.items())
                ],
                'extra_counter':         extra_ctr,
                'extra_comment_counter': extra_comment_ctr,
                'ghost_extra':            sum(ghost_extra_ctr.values()),
                'ghost_extra_all':        _fmt_ctr(
                    {f'{t}*': n for t, n in (ghost_extra_ctr + ghost_extra_comment_ctr).items()}
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
        _tm: Dict[str, List[str]] = {}
        if write_star:
            _tm = _build_file_ordered_ts_map(all_events)

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
            leo_assignments = None
            if len(result) == 7:
                teacher_marks, student_marks, score, alignments, line_marks, teacher_total_nc, leo_assignments = result
            elif len(result) == 6:
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

            diff_marks = _assemble_diff_marks(
                token_matching, teacher_marks, student_marks, score,
                alignments=alignments,
                line_marks=line_marks if include_line_marks else None,
                leo_assignments=leo_assignments,
            )

            _apply_insert_at_to_unpaired_missings(
                diff_marks.get('teacher_files', {}),
                diff_marks.get('student_files', {}),
                teacher_code_files,
                stu_files,
            )

            if write_star:
                non_star = copy.deepcopy(diff_marks)
                _strip_internal_fields(non_star)
                with open(anon_dir / filename, 'w', encoding='utf-8') as fh:
                    json.dump(non_star, fh, ensure_ascii=False, indent=2)
                written += 1

                diff_marks['token_matching'] = star_token_matching
                _add_log_metadata(diff_marks, all_events, stu_files,
                                  teacher_files=teacher_code_files,
                                  _ts_map=_tm or None)
                if teacher_total_nc:
                    n_ghost_extra_count = sum(
                        1 for marks in diff_marks.get('student_files', {}).values()
                        for m in marks if m.get('label') == 'ghost_extra'
                    )
                    n_missing_nc_star = sum(
                        1 for marks in diff_marks.get('teacher_files', {}).values()
                        for m in marks if m.get('label') == 'missing'
                    )
                    n_found_nc_star = teacher_total_nc - n_missing_nc_star
                    diff_marks['score'] = round(
                        max(0.0, (n_found_nc_star - n_ghost_extra_count) / teacher_total_nc * 100), 1
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

    def copy_truth_diff_marks(
        self,
        truth_dir: Path,
        names_dir: Path,
        anon_names_dir: Optional[Path],
    ) -> None:
        if not truth_dir.is_dir() or not names_dir.is_dir():
            return
        if anon_names_dir is None or not anon_names_dir.is_dir():
            return

        copied = 0
        for student_dir in sorted(names_dir.iterdir()):
            if not student_dir.is_dir():
                continue
            sid = self.name_to_id.get(student_dir.name)
            if sid is None:
                continue
            src = truth_dir / sid / 'diff_marks_truth.json'
            if not src.is_file():
                continue
            anon_dir = self._resolve_anon_dir(student_dir, anon_names_dir, sid)
            shutil.copy2(src, anon_dir / 'diff_marks_truth.json')
            copied += 1

        if copied:
            print(f'Copied truth diff marks for {copied} student(s) into '
                  f'{anon_names_dir.name}/')

    def mirror_diff_marks_to_anon_ids(
        self,
        anon_names_dir: Optional[Path],
        anon_ids_dir: Optional[Path],
    ) -> None:
        if anon_names_dir is None or not anon_names_dir.is_dir():
            return
        if anon_ids_dir is None or not anon_ids_dir.is_dir():
            return

        copied = 0
        for name_dir in sorted(anon_names_dir.iterdir()):
            if not name_dir.is_dir():
                continue
            sid = self.name_to_id.get(name_dir.name)
            if sid is None:
                continue
            ids_dir = anon_ids_dir / sid
            if not ids_dir.is_dir():
                continue
            for src in name_dir.iterdir():
                if not src.is_file():
                    continue
                if src.name.startswith('diff_marks_') and src.name.endswith('.json'):
                    shutil.copy2(src, ids_dir / src.name)
                    copied += 1

        if copied:
            print(f'Mirrored {copied} diff_marks file(s) from '
                  f'{anon_names_dir.name}/ to {anon_ids_dir.name}/')
