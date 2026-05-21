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
    _build_teacher_token_timestamps,
    _parse_teacher_tokens,
    _read_text_normalized,
    _refresh_missing_timestamps,
    _remap_marks_to_utf16,
    _split_tokens_by_comment,
    _strip_internal_fields,
    _write_teacher_tokens_file,
)
from .folder_utils import CODE_EXTS


_LANG_EXT_LABEL = (('.html', 'HTML'), ('.css', 'CSS'), ('.js', 'JS'), ('.py', 'Py'))
_EMBEDDED_LANG_TO_EXT = {'javascript': '.js', 'css': '.css'}


def _ext_of(fname: str) -> Optional[str]:
    s = (fname or '').lower()
    for ext, _ in _LANG_EXT_LABEL:
        if s.endswith(ext):
            return ext
    return None


def _embedded_lang_ranges_for(text: str, file_ext: Optional[str]) -> Dict[str, List[Tuple[int, int]]]:
    if not file_ext or file_ext.lower() not in ('.html', '.htm'):
        return {}
    from languages import get_profile
    from languages import _embedded_tag_ranges
    profile = get_profile(file_ext)
    if profile is None or not profile.get('embeddedTags'):
        return {}
    by_tag = _embedded_tag_ranges(text, profile)
    out: Dict[str, List[Tuple[int, int]]] = {}
    for entry in profile.get('embeddedTags', []) or []:
        ext = _EMBEDDED_LANG_TO_EXT.get(entry.get('language', ''))
        if ext is None:
            continue
        ranges = by_tag.get(entry['tag'], [])
        if ranges:
            out.setdefault(ext, []).extend(ranges)
    return out


def _effective_ext_at(pos: int, file_ext: str, ranges_by_ext: Dict[str, List[Tuple[int, int]]]) -> str:
    for ext, ranges in (ranges_by_ext or {}).items():
        for lo, hi in ranges:
            if lo <= pos < hi:
                return ext
    return file_ext


def _per_language_follow_stats(
    diff_marks: dict,
    teacher_files: Dict[str, Path],
    student_files: Optional[Dict[str, Path]] = None,
    teacher_ghosts: Optional[dict] = None,
    removal_ts_by_token: Optional[Dict[str, List[str]]] = None,
    teacher_entries: Optional[list] = None,
    teacher_token_timestamps: Optional[Dict[str, list]] = None,
) -> Dict[str, dict]:
    student_files = student_files or {}

    ghost_ts_by_pair: dict = {}
    if teacher_ghosts:
        from .similarity_measures import ts_to_local
        from .token_log_marks import iter_ghost_tokens
        for fname, blob_pos, start_rel, tok, raw_ts in iter_ghost_tokens(teacher_ghosts):
            if raw_ts is None:
                continue
            ts_str = (ts_to_local(raw_ts)
                      if isinstance(raw_ts, (int, float)) else raw_ts)
            ghost_ts_by_pair[(fname, blob_pos + start_rel, tok)] = ts_str

    ghost_blobs_sorted: Dict[str, list] = {}
    if teacher_ghosts:
        for fname, blobs in teacher_ghosts.items():
            ghost_blobs_sorted[fname] = sorted(
                (b for b in (blobs or []) if b.get('pos') is not None),
                key=lambda b: b.get('pos') or 0,
            )

    def _ghost_final_pos(paired_with: dict) -> Optional[Tuple[str, int]]:
        if not paired_with or not paired_with.get('ghost'):
            return None
        fname = paired_with.get('file')
        pos = paired_with.get('start')
        if fname is None or not isinstance(pos, int):
            return None
        for blob in ghost_blobs_sorted.get(fname) or []:
            bp = blob.get('pos')
            bp_end = bp + len(blob.get('text') or '')
            if bp <= pos < bp_end:
                return (fname, bp)
        return None

    missing_ts_pool: Dict[str, List[str]] = {}
    for entry in teacher_entries or []:
        tok = entry[0] if len(entry) > 0 else ''
        ts = entry[1] if len(entry) > 1 else ''
        is_cm = entry[2] if len(entry) > 2 else False
        is_rem = entry[3] if len(entry) > 3 else False
        if is_cm or is_rem:
            continue
        missing_ts_pool.setdefault(tok, []).append(ts)

    ttt_by_pos: Dict[Tuple[str, int, int], str] = {}
    if teacher_token_timestamps:
        for fname, entries in teacher_token_timestamps.items():
            for e in entries or []:
                s = e.get('start')
                t_end = e.get('end')
                ts = e.get('ts')
                if isinstance(s, int) and isinstance(t_end, int) and ts:
                    ttt_by_pos[(fname, s, t_end)] = ts

    def _resolve_missing_ts(mark: dict, fname: str) -> str:
        ts = mark.get('timestamp')
        if ts:
            return ts
        s = mark.get('start')
        e = mark.get('end')
        if isinstance(s, int) and isinstance(e, int):
            pos_ts = ttt_by_pos.get((fname, s, e))
            if pos_ts:
                return pos_ts
        tok = mark.get('token', '')
        pool = missing_ts_pool.get(tok)
        if pool:
            return pool.pop(0)
        return '00:00:00'

    removal_pool: Dict[str, List[str]] = {
        tok: list(lst) for tok, lst in (removal_ts_by_token or {}).items()
    }

    def _resolve_ghost_ts(mark: dict) -> str:
        pw = mark.get('paired_with') or {}
        if pw.get('ghost'):
            key = (pw.get('file'), pw.get('start'), pw.get('token'))
            ts = ghost_ts_by_pair.get(key)
            if ts:
                return ts
        existing = mark.get('removal_ts')
        if existing:
            return existing
        tok = mark.get('token', '')
        pool = removal_pool.get(tok)
        if pool:
            return pool.pop(0)
        return '00:00:00'

    def _load(files: Dict[str, Path]):
        texts: Dict[str, str] = {}
        ranges: Dict[str, dict] = {}
        for fname, p in (files or {}).items():
            if _ext_of(fname) is None:
                continue
            try:
                text = _read_text_normalized(p)
            except Exception:
                continue
            texts[fname] = text
            ranges[fname] = _embedded_lang_ranges_for(text, _ext_of(fname))
        return texts, ranges

    teacher_texts, teacher_ranges = _load(teacher_files)
    student_texts, student_ranges = _load(student_files)

    totals: Dict[str, int] = {ext: 0 for ext, _ in _LANG_EXT_LABEL}
    per_file_nc: Dict[str, list] = {}
    for fname, text in teacher_texts.items():
        file_ext = _ext_of(fname)
        ranges = teacher_ranges.get(fname, {})
        nc, _cm = _split_tokens_by_comment(text, file_ext)
        per_file_nc[fname] = list(nc)
        for pos, _tok in nc:
            totals[_effective_ext_at(pos, file_ext, ranges)] += 1

    missing_files = set(diff_marks.get('missing_files') or [])
    n_missing: Dict[str, int] = {ext: 0 for ext, _ in _LANG_EXT_LABEL}
    n_ghost_extra: Dict[str, int] = {ext: 0 for ext, _ in _LANG_EXT_LABEL}
    n_extra_unpaired: Dict[str, int] = {ext: 0 for ext, _ in _LANG_EXT_LABEL}
    items_by_ext: Dict[str, list] = {ext: [] for ext, _ in _LANG_EXT_LABEL}
    extras_by_ext: Dict[str, list] = {ext: [] for ext, _ in _LANG_EXT_LABEL}

    def _add_whole_file_missing(fname: str, file_ext: str) -> None:
        nc = per_file_nc.get(fname) or []
        ranges = teacher_ranges.get(fname, {})
        for pos, _tok in nc:
            n_missing[_effective_ext_at(pos, file_ext, ranges)] += 1
        if nc:
            items_by_ext[file_ext].append(
                ('99:99:99', f'(whole file missing: {fname} — {len(nc)} tokens)')
            )

    counted_missing_for: set = set()
    for fname, marks in (diff_marks.get('teacher_files') or {}).items():
        file_ext = _ext_of(fname)
        if file_ext is None:
            continue
        missing_marks = [m for m in (marks or []) if m.get('label') == 'missing']
        if fname in missing_files and not missing_marks:
            _add_whole_file_missing(fname, file_ext)
            counted_missing_for.add(fname)
        else:
            ranges = teacher_ranges.get(fname, {})
            for m in missing_marks:
                pos = m.get('start', 0)
                eff_ext = _effective_ext_at(pos, file_ext, ranges)
                n_missing[eff_ext] += 1
                ts = _resolve_missing_ts(m, fname)
                items_by_ext[eff_ext].append((ts, f'-{m.get("token", "")}'))
            if fname in missing_files:
                counted_missing_for.add(fname)
    for fname in missing_files:
        file_ext = _ext_of(fname)
        if file_ext is None or fname in counted_missing_for:
            continue
        _add_whole_file_missing(fname, file_ext)

    for fname, marks in (diff_marks.get('student_files') or {}).items():
        file_ext = _ext_of(fname)
        if file_ext is None:
            continue
        ranges = student_ranges.get(fname, {})
        for m in marks or []:
            pos = m.get('start', 0)
            eff_ext = _effective_ext_at(pos, file_ext, ranges)
            lbl = m.get('label')
            if lbl == 'ghost_extra':
                ghost_final = _ghost_final_pos(m.get('paired_with') or {})
                ge_ext = None
                if ghost_final is not None:
                    t_fname, t_pos = ghost_final
                    t_file_ext = _ext_of(t_fname)
                    if t_file_ext:
                        t_ranges = teacher_ranges.get(t_fname, {})
                        ge_ext = _effective_ext_at(t_pos, t_file_ext, t_ranges)
                if ge_ext is None:
                    ge_ext = eff_ext
                n_ghost_extra[ge_ext] += 1
                ts = _resolve_ghost_ts(m)
                items_by_ext[ge_ext].append((ts, f'+{m.get("token", "")}*'))
            elif lbl == 'extra':
                if not m.get('paired_with'):
                    n_extra_unpaired[eff_ext] += 1
                extras_by_ext[eff_ext].append(
                    (fname, pos, f'+{m.get("token", "")}')
                )

    out: Dict[str, dict] = {}
    for ext, _label in _LANG_EXT_LABEL:
        total = totals[ext]
        if total <= 0:
            out[ext] = None
            continue
        deduction = n_missing[ext] + n_ghost_extra[ext] + n_extra_unpaired[ext]
        score = round(max(0.0, (total - deduction) / total * 100), 1)
        sorted_items = sorted(items_by_ext[ext])
        items_text = [
            s if ts == '99:99:99' else f'{s} ({ts})'
            for ts, s in sorted_items
        ]
        sorted_extras = sorted(extras_by_ext[ext], key=lambda t: (t[0], t[1]))
        for _fname, _pos, label in sorted_extras:
            items_text.append(f'{label} (00:00:00)')
        out[ext] = {
            'score': score,
            'items': items_text,
            'text': ', '.join(items_text),
        }
    return out


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

    def write_student_token_files(self, names_dir: Path, anon_names_dir: Path = None,
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
                if needs_utf16_remap:
                    _remap_marks_to_utf16(non_star, teacher_code_files, stu_files)
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
                with open(anon_dir / star_filename, 'w', encoding='utf-8') as fh:
                    json.dump(diff_marks, fh, ensure_ascii=False, indent=2)
                written_star += 1
            else:
                _strip_internal_fields(diff_marks)
                if needs_utf16_remap:
                    _remap_marks_to_utf16(diff_marks, teacher_code_files, stu_files)
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
            needs_utf16_remap=True,
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
            needs_utf16_remap=True,
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
            needs_utf16_remap=True,
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
            needs_utf16_remap=True,
        )

    def copy_curated_diff_marks(
        self,
        curated_dir: Path,
        names_dir: Path,
        anon_names_dir: Optional[Path],
        anon_ids_dir: Optional[Path] = None,
    ) -> None:
        if not curated_dir.is_dir() or not names_dir.is_dir():
            return
        if anon_names_dir is None or not anon_names_dir.is_dir():
            return

        per_basis_copied: Dict[str, int] = {}
        for student_dir in sorted(names_dir.iterdir()):
            if not student_dir.is_dir():
                continue
            sid = self.name_to_id.get(student_dir.name)
            if sid is None:
                continue
            anon_dir = self._resolve_anon_dir(student_dir, anon_names_dir, sid)
            for basis_name in ('ideal', 'required'):
                src = curated_dir / sid / f'diff_marks_{basis_name}.json'
                if not src.is_file():
                    continue
                shutil.copy2(src, anon_dir / f'diff_marks_{basis_name}.json')
                per_basis_copied[basis_name] = per_basis_copied.get(basis_name, 0) + 1

        for basis_name, count in per_basis_copied.items():
            print(f'Copied {basis_name} diff marks for {count} student(s) into '
                  f'{anon_names_dir.name}/')

        root_exts = {'.json', '.txt', *CODE_EXTS}
        root_files = [
            p for p in sorted(curated_dir.iterdir())
            if p.is_file() and p.suffix.lower() in root_exts
        ]
        if not root_files:
            return
        targets = [anon_names_dir]
        if anon_ids_dir is not None and anon_ids_dir.is_dir():
            targets.append(anon_ids_dir)
        root_copied = 0
        for target in targets:
            for src in root_files:
                shutil.copy2(src, target / src.name)
                root_copied += 1
        if root_copied:
            target_names = ', '.join(t.name for t in targets)
            print(f'Copied {len(root_files)} curated root file(s) into '
                  f'{target_names}/')

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

    def compute_basis_token_stats(
        self,
        basis_filename: str,
        names_dir: Path,
        anon_names_dir: Optional[Path],
    ) -> Dict[str, dict]:
        teacher_tokens_path = self.reference_dir / 'tokens.txt'
        if not teacher_tokens_path.exists():
            return {}

        teacher_entries = _parse_teacher_tokens(teacher_tokens_path)
        removal_ts_by_token: Dict[str, List[str]] = {}
        for tok, _, _, is_rem, removal_ts in teacher_entries:
            if is_rem and removal_ts:
                removal_ts_by_token.setdefault(tok, []).append(removal_ts)

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

            anon_dir = self._resolve_anon_dir(student_dir, anon_names_dir, sid)
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
                ttt_lookup: Dict[Tuple[str, int, int], str] = {}
                for fname_t, entries in teacher_token_timestamps.items():
                    for e in entries or []:
                        s = e.get('start')
                        en = e.get('end')
                        ts = e.get('ts')
                        if isinstance(s, int) and isinstance(en, int) and ts:
                            ttt_lookup[(fname_t, s, en)] = ts
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
                    fresh_removal or removal_ts_by_token or None,
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
                removal_ts_by_token=fresh_removal or removal_ts_by_token,
                teacher_entries=teacher_entries,
                teacher_token_timestamps=teacher_token_timestamps,
            )
            out[sid] = stats
        return out
