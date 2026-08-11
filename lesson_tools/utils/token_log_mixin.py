import copy
import json
import shutil
from collections import Counter
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import sys as _sys
from pathlib import Path as _Path
_sys.path.insert(0, str(_Path(__file__).resolve().parent.parent))
from languages import lesson_file_extension

from .lv_editor import reconstruct_all_headless
from .token_log import (
    _apply_star_post_pass,
    _apply_insert_at_to_unpaired_missings,
    _assemble_diff_marks,
    _build_file_ordered_ts_map,
    _build_git_diff_marks,
    _build_leo_diff_marks,
    _build_lcs_token_diff_marks,
    _build_occ_from_diff_marks,
    _build_teacher_token_timestamps,
    _parse_teacher_tokens,
    _refresh_missing_timestamps,
    _remap_marks_to_utf16,
    _strip_internal_fields,
    _ttt_pos_index,
    _write_teacher_tokens_file,
    leo_plus_config,
)
from .folder_utils import CODE_EXTS
from .token_log_lang_stats import (
    _LANG_EXT_LABEL,
    _effective_ext_at,
    _embedded_lang_ranges_for,
    _ext_of,
    _per_language_follow_stats,
)


DISABLED_DIFF_MARK_VARIANTS = frozenset({'lcs_star', 'git_star'})


def _emit_diff_marks(path: Path, marks: dict, basis: str) -> bool:
    if basis in DISABLED_DIFF_MARK_VARIANTS:
        return False
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(marks, fh, ensure_ascii=False, indent=2)
    return True


def _fmt_item(ts_str: str, s: str) -> str:
    return f'{s} ({ts_str})'


def _fmt_ctr(c: Counter) -> List[str]:
    return [f'{t} (x{n})' if n > 1 else t for t, n in sorted(c.items())]


def _stats_from_occurrences(all_occ, score_e, score_c, n_found, n_missing, n_extra) -> dict:
    n_found_e   = sum(1 for _, _, fl in all_occ if not fl)
    n_missing_e = sum(1 for _, _, fl in all_occ if fl == {'MISSING'})
    teacher_total_e = n_found_e + n_missing_e

    extra_ctr               = Counter(tok for _, tok, fl in all_occ if fl == {'EXTRA'})
    ghost_extra_ctr         = Counter(tok for _, tok, fl in all_occ if fl == {'EXTRA*'})
    extra_comment_ctr       = Counter(tok for _, tok, fl in all_occ if fl == {'COMMENT', 'EXTRA'})
    ghost_extra_comment_ctr = Counter(tok for _, tok, fl in all_occ if fl == {'COMMENT', 'EXTRA*'})

    _miss_e   = sorted((ts, f'-{tok}')  for ts, tok, fl in all_occ if fl == {'MISSING'})
    _miss_c   = sorted((ts, f'-{tok}')  for ts, tok, fl in all_occ if fl == {'MISSING', 'COMMENT'})
    _extra    = sorted((ts, f'+{tok}')  for ts, tok, fl in all_occ if fl == {'EXTRA'})
    _extra_s  = sorted((ts, f'+{tok}*') for ts, tok, fl in all_occ if fl == {'EXTRA*'})
    _extra_c  = sorted((ts, f'+{tok}')  for ts, tok, fl in all_occ if fl == {'COMMENT', 'EXTRA'})
    _extra_sc = sorted((ts, f'+{tok}*') for ts, tok, fl in all_occ if fl == {'COMMENT', 'EXTRA*'})
    _comb_e   = sorted(_miss_e + _extra + _extra_s)
    _comb_c   = sorted(_miss_c + _extra_c + _extra_sc)

    return {
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
        'ghost_extra':           sum(ghost_extra_ctr.values()),
        'ghost_extra_all':       _fmt_ctr(
            {f'{t}*': n for t, n in (ghost_extra_ctr + ghost_extra_comment_ctr).items()}
        ),
        'extra_e_count':         len(_comb_e),
        'comment_count':         len(_comb_c),
    }


class TokenLogMixin:
    def _resolve_anon_dir(self, student_dir: Path, anon_dir: Optional[Path], sid: str) -> Path:
        if anon_dir is None or not anon_dir.is_dir():
            return student_dir
        candidate = anon_dir / sid
        if candidate.is_dir():
            return candidate
        return student_dir

    def _get_teacher_code_files(self) -> Dict[str, Path]:
        all_events = getattr(self, '_lesson_all_events', None)
        if all_events:
            reco_dir = self.reference_dir.parent / 'reconstructed'
            if reco_dir.is_dir():
                files = {p.name: p for p in sorted(reco_dir.iterdir()) if p.suffix.lower() in CODE_EXTS}
                if files:
                    return files
        return self.get_all_code_files(self._effective_reference_dir())

    def write_keyword_log(self) -> None:
        all_events = getattr(self, '_lesson_all_events', None) or (
            self._lesson_keypresses + self._lesson_code_inserts
        )
        out_path = self.reference_dir / 'tokens.txt'
        n_typed, n_removed, n_unique = _write_teacher_tokens_file(
            all_events, out_path,
            lesson_file=getattr(self, '_lesson_file', None),
        )
        if not n_typed and not n_removed:
            print('  Keyword log skipped \u2014 no key-log data.')
            return

        print(f'  Written: correct/{out_path.name}  ({n_typed} occurrences, '
              f'{n_removed} removed, {n_unique} unique)')

        lesson_file = getattr(self, '_lesson_file', None)
        reco_files = reconstruct_all_headless(all_events, lesson_file=lesson_file)
        if reco_files:
            reco_dir = self.reference_dir.parent / 'reconstructed'
            reco_dir.mkdir(exist_ok=True)
            main_ext = lesson_file_extension(lesson_file) or '.html'
            main_name = f'reconstructed{main_ext}' if main_ext != '.html' else 'reconstructed.html'

            fresh_names = {
                main_name if tab_key == 'MAIN' else tab_key
                for tab_key, reco_text in reco_files.items()
                if not (tab_key == 'MAIN' and not reco_text)
            }
            for stale in reco_dir.iterdir():
                if stale.is_file() and stale.suffix.lower() in CODE_EXTS \
                        and stale.name not in fresh_names:
                    try:
                        stale.unlink()
                        print(f'  Removed stale: reconstructed/{stale.name}')
                    except OSError:
                        pass
            for tab_key, reco_text in reco_files.items():
                if tab_key == 'MAIN' and not reco_text:
                    continue
                reco_name = main_name if tab_key == 'MAIN' else tab_key
                reco_path = reco_dir / reco_name
                with open(reco_path, 'w', encoding='utf-8') as fh:
                    fh.write(reco_text)
                print(f'  Written: reconstructed/{reco_path.name}  ({len(reco_text)} chars)')

    def write_student_token_files(self, names_dir: Path, anon_ids_dir: Path = None,
                                   curated_dir: Optional[Path] = None) -> None:
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
        teacher_token_ts: Dict[str, list] = {}
        if all_events:
            ts_map_cached = _build_file_ordered_ts_map(all_events)
            teacher_token_ts = _build_teacher_token_timestamps(all_events)

        teacher_code_files = self._get_teacher_code_files()

        written_leo_star = 0
        for student_dir in sorted(names_dir.iterdir()):
            if not student_dir.is_dir():
                continue
            sid = self.name_to_id.get(student_dir.name)
            if sid is None or sid not in self.results:
                continue

            anon_dir = self._resolve_anon_dir(student_dir, anon_ids_dir, sid)

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

            if all_events:
                _apply_star_post_pass(
                    diff_marks, all_events, stu_files,
                    teacher_files=teacher_code_files,
                    _ts_map=ts_map_cached or None,
                )

            all_occ, score_e, score_c, n_found, n_missing, n_extra, _n_ghost_extra = (
                _build_occ_from_diff_marks(diff_marks, teacher_entries, removal_ts_by_token or None)
            )
            diff_marks['score'] = score_e

            if curated_dir is not None:
                ideal_src = curated_dir / sid / 'diff_marks_ideal.json'
                if ideal_src.is_file():
                    with open(ideal_src, encoding='utf-8') as _fh:
                        ideal_marks = json.load(_fh)
                    if all_events:
                        _refresh_missing_timestamps(
                            ideal_marks, all_events, _ts_map=ts_map_cached or None,
                        )
                    _fresh_removal: Dict[str, List[str]] = {}
                    for _tok, _, _, _is_rem, _rt in teacher_entries:
                        if _is_rem and _rt:
                            _fresh_removal.setdefault(_tok, []).append(_rt)
                    all_occ, score_e, score_c, n_found, n_missing, n_extra, _n_ghost_extra = (
                        _build_occ_from_diff_marks(
                            ideal_marks, teacher_entries, _fresh_removal or None,
                            teacher_ghosts=diff_marks.get('teacher_ghosts'),
                        )
                    )

            self._student_token_stats[sid] = _stats_from_occurrences(
                all_occ, score_e, score_c, n_found, n_missing, n_extra,
            )

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

            if teacher_token_ts:
                diff_marks['teacher_token_timestamps'] = teacher_token_ts

            _strip_internal_fields(diff_marks)
            written_leo_star += _emit_diff_marks(
                anon_dir / 'diff_marks_leo_star.json', diff_marks, 'leo_star')

        if written_leo_star:
            print(f'Written Leo* diff marks for {written_leo_star} student(s) in {names_dir.name}/')

    def _write_alt_diff_marks(
        self,
        names_dir: Path,
        anon_ids_dir: Optional[Path],
        build_fn,
        token_matching: str,
        label: str,
        filename: str,
        star_token_matching: Optional[str] = None,
        star_filename: Optional[str] = None,
        star_label: Optional[str] = None,
        include_line_marks: bool = True,
        needs_utf16_remap: bool = False,
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

            anon_dir = self._resolve_anon_dir(student_dir, anon_ids_dir, sid)

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
                if needs_utf16_remap:
                    _remap_marks_to_utf16(non_star, teacher_code_files, stu_files)
                written += _emit_diff_marks(anon_dir / filename, non_star, token_matching)

                diff_marks['token_matching'] = star_token_matching
                _apply_star_post_pass(diff_marks, all_events, stu_files,
                                  teacher_files=teacher_code_files,
                                  _ts_map=_tm or None)
                if teacher_total_nc:
                    n_ghost_extra_count = sum(
                        1 for marks in diff_marks.get('student_files', {}).values()
                        for m in marks if m.get('label') == 'ghost_extra'
                    )
                    n_extra_unpaired_count = sum(
                        1 for marks in diff_marks.get('student_files', {}).values()
                        for m in marks
                        if m.get('label') == 'extra' and not m.get('paired_with')
                    )
                    n_missing_nc_star = sum(
                        1 for marks in diff_marks.get('teacher_files', {}).values()
                        for m in marks if m.get('label') == 'missing'
                    )
                    n_found_nc_star = teacher_total_nc - n_missing_nc_star
                    diff_marks['score'] = round(
                        max(0.0, (n_found_nc_star - n_ghost_extra_count - n_extra_unpaired_count) / teacher_total_nc * 100), 1
                    )
                _strip_internal_fields(diff_marks)
                if needs_utf16_remap:
                    _remap_marks_to_utf16(diff_marks, teacher_code_files, stu_files)
                written_star += _emit_diff_marks(
                    anon_dir / star_filename, diff_marks, star_token_matching)
            else:
                _strip_internal_fields(diff_marks)
                if needs_utf16_remap:
                    _remap_marks_to_utf16(diff_marks, teacher_code_files, stu_files)
                written += _emit_diff_marks(anon_dir / filename, diff_marks, token_matching)

        if written:
            print(f'Written {label} for {written} student(s) in {names_dir.name}/')
        if write_star and star_label and written_star:
            print(f'Written {star_label} for {written_star} student(s) in {names_dir.name}/')

    def write_leo_diff_marks(self, names_dir: Path, anon_ids_dir: Path = None) -> None:
        self._write_alt_diff_marks(
            names_dir, anon_ids_dir,
            _build_leo_diff_marks,
            'leo_star', 'Leo* diff marks', 'diff_marks_leo_star.json',
            include_line_marks=False,
        )

    def write_leo_plus_diff_marks(self, names_dir: Path, anon_ids_dir: Path = None) -> None:
        all_events = getattr(self, '_lesson_all_events', None)
        if not all_events:
            return

        teacher_code_files = self._get_teacher_code_files()
        if not teacher_code_files:
            return

        ts_map_cached = _build_file_ordered_ts_map(all_events)
        teacher_token_ts = _build_teacher_token_timestamps(all_events)

        teacher_tokens_path = self.reference_dir / 'tokens.txt'
        teacher_entries = (
            _parse_teacher_tokens(teacher_tokens_path)
            if teacher_tokens_path.exists() else []
        )
        removal_ts_by_token: Dict[str, List[str]] = {}
        for tok, _, _, is_rem, removal_ts in teacher_entries:
            if is_rem and removal_ts:
                removal_ts_by_token.setdefault(tok, []).append(removal_ts)

        written = 0
        for student_dir in sorted(names_dir.iterdir()):
            if not student_dir.is_dir():
                continue
            sid = self.name_to_id.get(student_dir.name)
            if sid is None or sid not in self.results:
                continue

            anon_dir = self._resolve_anon_dir(student_dir, anon_ids_dir, sid)
            stu_files = self.get_all_code_files(anon_dir) or self.get_all_code_files(student_dir)
            if not stu_files:
                continue

            with leo_plus_config():
                try:
                    t_marks, s_marks, _score, alignments, _line_marks, _n_total, leo_assignments = (
                        _build_leo_diff_marks(
                            teacher_code_files, stu_files, events=all_events,
                        )
                    )
                except Exception:
                    t_marks, s_marks, alignments, leo_assignments = {}, {}, None, None

                diff_marks: dict = {
                    'token_matching': 'leo_star_plus',
                    'teacher_files':  t_marks,
                    'student_files':  s_marks,
                }
                if alignments:
                    diff_marks['alignments'] = alignments
                if leo_assignments:
                    diff_marks['leo_assignments'] = leo_assignments

                _apply_star_post_pass(
                    diff_marks, all_events, stu_files,
                    teacher_files=teacher_code_files,
                    _ts_map=ts_map_cached or None,
                )

            if teacher_entries:
                _all_occ, score_e, *_rest = _build_occ_from_diff_marks(
                    diff_marks, teacher_entries, removal_ts_by_token or None,
                )
                diff_marks['score'] = score_e

            if teacher_token_ts:
                diff_marks['teacher_token_timestamps'] = teacher_token_ts

            _strip_internal_fields(diff_marks)
            written += _emit_diff_marks(
                anon_dir / 'diff_marks_leo_star_plus.json', diff_marks, 'leo_star_plus')

        if written:
            print(f'Written Leo*+ diff marks for {written} student(s) in {names_dir.name}/')

    def write_lcs_diff_marks(self, names_dir: Path, anon_ids_dir: Path = None) -> None:
        all_events = getattr(self, '_lesson_all_events', None)
        self._write_alt_diff_marks(
            names_dir, anon_ids_dir,
            _build_lcs_token_diff_marks,
            'lcs', 'LCS diff marks', 'diff_marks_lcs.json',
            star_token_matching='lcs_star' if all_events else None,
            star_filename='diff_marks_lcs_star.json' if all_events else None,
            star_label='LCS* diff marks' if all_events else None,
            include_line_marks=False,
            needs_utf16_remap=True,
        )

    def write_git_diff_marks(self, names_dir: Path, anon_ids_dir: Path = None) -> None:
        all_events = getattr(self, '_lesson_all_events', None)
        self._write_alt_diff_marks(
            names_dir, anon_ids_dir,
            _build_git_diff_marks,
            'git', 'Git diff marks', 'diff_marks_git.json',
            star_token_matching='git_star' if all_events else None,
            star_filename='diff_marks_git_star.json' if all_events else None,
            star_label='Git* diff marks' if all_events else None,
            needs_utf16_remap=True,
        )

    def copy_curated_diff_marks(
        self,
        curated_dir: Path,
        names_dir: Path,
        anon_dir: Optional[Path],
    ) -> None:
        if not curated_dir.is_dir() or not names_dir.is_dir():
            return
        if anon_dir is None or not anon_dir.is_dir():
            return

        per_basis_copied: Dict[str, int] = {}
        for student_dir in sorted(names_dir.iterdir()):
            if not student_dir.is_dir():
                continue
            sid = self.name_to_id.get(student_dir.name)
            if sid is None:
                continue
            student_anon_dir = self._resolve_anon_dir(student_dir, anon_dir, sid)
            for basis_name in ('ideal', 'minimal'):
                src = curated_dir / sid / f'diff_marks_{basis_name}.json'
                if not src.is_file():
                    continue
                shutil.copy2(src, student_anon_dir / f'diff_marks_{basis_name}.json')
                per_basis_copied[basis_name] = per_basis_copied.get(basis_name, 0) + 1

        for basis_name, count in per_basis_copied.items():
            print(f'Copied {basis_name} diff marks for {count} student(s) into '
                  f'{anon_dir.name}/')

        root_exts = {'.json', '.txt', *CODE_EXTS}
        root_files = [
            p for p in sorted(curated_dir.iterdir())
            if p.is_file() and p.suffix.lower() in root_exts
        ]
        if not root_files:
            return
        for src in root_files:
            shutil.copy2(src, anon_dir / src.name)
        print(f'Copied {len(root_files)} curated root file(s) into '
              f'{anon_dir.name}/')

    def compute_basis_token_stats(
        self,
        basis_filename: str,
        names_dir: Path,
        anon_ids_dir: Optional[Path],
    ) -> Dict[str, dict]:
        teacher_tokens_path = self.reference_dir / 'tokens.txt'
        if not teacher_tokens_path.exists():
            return {}

        teacher_entries = _parse_teacher_tokens(teacher_tokens_path)

        all_events = getattr(self, '_lesson_all_events', None)
        ts_map_cached: Dict[str, List[str]] = (
            _build_file_ordered_ts_map(all_events) if all_events else {}
        )

        out: Dict[str, dict] = {}
        for student_dir in sorted(names_dir.iterdir()):
            if not student_dir.is_dir():
                continue
            sid = self.name_to_id.get(student_dir.name)
            if sid is None or sid not in self.results:
                continue

            anon_dir = self._resolve_anon_dir(student_dir, anon_ids_dir, sid)
            marks_path = anon_dir / basis_filename
            if not marks_path.is_file():
                continue
            try:
                with open(marks_path, encoding='utf-8') as fh:
                    diff_marks = json.load(fh)
            except Exception:
                continue

            if all_events:
                _refresh_missing_timestamps(
                    diff_marks, all_events, _ts_map=ts_map_cached or None,
                )

            teacher_ghosts = diff_marks.get('teacher_ghosts')
            teacher_token_timestamps = diff_marks.get('teacher_token_timestamps')
            if teacher_ghosts is None or teacher_token_timestamps is None:
                leo_star_path = anon_dir / 'diff_marks_leo_star.json'
                if leo_star_path.is_file():
                    try:
                        with open(leo_star_path, encoding='utf-8') as fh:
                            ls = json.load(fh)
                            if teacher_ghosts is None:
                                teacher_ghosts = ls.get('teacher_ghosts')
                            if teacher_token_timestamps is None:
                                teacher_token_timestamps = ls.get(
                                    'teacher_token_timestamps'
                                )
                    except Exception:
                        pass

            fresh_removal: Dict[str, List[str]] = {}
            for tok, _, _, is_rem, removal_ts in teacher_entries:
                if is_rem and removal_ts:
                    fresh_removal.setdefault(tok, []).append(removal_ts)

            if teacher_token_timestamps:
                ttt_lookup = _ttt_pos_index(teacher_token_timestamps)
                for fname_t, marks_t in (diff_marks.get('teacher_files') or {}).items():
                    for m in marks_t or []:
                        if m.get('label') != 'missing':
                            continue
                        if m.get('timestamp'):
                            continue
                        s = m.get('start')
                        en = m.get('end')
                        if isinstance(s, int) and isinstance(en, int):
                            ts = ttt_lookup.get((fname_t, s, en))
                            if ts:
                                m['timestamp'] = ts

            all_occ, score_e, score_c, n_found, n_missing, n_extra, _n_ghost_extra = (
                _build_occ_from_diff_marks(
                    diff_marks, teacher_entries,
                    fresh_removal or None,
                    teacher_ghosts=teacher_ghosts,
                )
            )
            stats = _stats_from_occurrences(
                all_occ, score_e, score_c, n_found, n_missing, n_extra,
            )
            teacher_code_files = self._get_teacher_code_files()
            student_code_files = {
                p.name: p for p in anon_dir.iterdir()
                if p.is_file() and p.suffix.lower() in CODE_EXTS
            }
            stats['follow_e_by_lang'] = _per_language_follow_stats(
                diff_marks, teacher_code_files, student_code_files,
                teacher_ghosts=teacher_ghosts,
                removal_ts_by_token=fresh_removal,
                teacher_entries=teacher_entries,
                teacher_token_timestamps=teacher_token_timestamps,
            )
            out[sid] = stats
        return out
