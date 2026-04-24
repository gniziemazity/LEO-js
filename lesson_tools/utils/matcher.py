"""
matcher.py — Standalone code diff / matching module.

Compare teacher and student code files and produce diff marks compatible
with differentiator.html (the ``diff_marks.json`` format) — without any
LEO or grading-pipeline infrastructure.

Quick start
-----------
# Compare with reconstructed teacher files from a keylog (most accurate):
>>> from pathlib import Path
>>> from lesson_tools.utils.matcher import compare
>>> marks = compare(
...     teacher=None,
...     student={'index.html': Path('submission/index.html')},
...     keylog_file=Path('log.json'),           # teacher files reconstructed automatically
...     teacher_tokens_file=Path('tokens.txt'), # optional; improves accuracy
... )

# Or compare plain files directly (no keylog):
>>> marks = compare(
...     teacher={'index.html': Path('ref/index.html')},
...     student={'index.html': Path('submission/index.html')},
... )  # algorithm defaults to 'contextual_star'

Algorithms
----------
'leo_star'         LEO context-cosine-Hungarian per-occurrence matching with
                   extra* promotion (default). Requires a keylog or
                   teacher_tokens_file with removal data for extra* labels;
                   falls back gracefully without them.
'leo'              Same algorithm but ghost contexts are disabled — no
                   extra_star labels are ever produced.
'lcs_star'         Token LCS excluding comments; extra tokens that match
                   teacher-removed tokens are labelled extra_star.
'lcs'              Token-level LCS (order-sensitive, comments excluded).
'ro'               Line-level Ratcliff/Obershelp diff (coarsest, fastest).
'ro_star'          R/O diff with extra* promotion for teacher-deleted tokens.
'vscode'           Line-level diff using VS Code's DefaultLinesDiffComputer.
'vscode_star'      VS Code diff with extra* promotion for teacher-deleted tokens.

Improving contextual / lcs_star accuracy
-----------------------------------------
Both algorithms benefit from a ``teacher_tokens_file`` (the ``tokens.txt``
produced by the LEO pipeline) which records teacher typing order and which
tokens were later deleted.  Providing ``keylog_events`` (raw list from
``log.json``) further enables *ghost context* reconstruction for removed
tokens.  Neither is required — the module falls back gracefully.
"""

from __future__ import annotations

import json
import tempfile
from collections import Counter
from pathlib import Path
from typing import Dict, Optional, Union

from . import similarity_measures as _sm
from .token_log import (
    _apply_ghost_star_to_diff_marks,
    _build_leo_diff_marks,
    _build_ghost_contexts,
    _build_lcs_star_diff_marks,
    _build_lcs_token_diff_marks,
    _build_ro_diff_marks,
    _build_ro_star_diff_marks,
    _build_vscode_diff_marks,
    _build_vscode_star_diff_marks,
    _colors_to_position_marks,
    _comment_ranges_for_ext,
    _extract_student_tokens,
    _parse_teacher_tokens,
    _pos_in_comment,
    _tokenize_file_ordered,
)

FilesArg = Dict[str, Union[str, Path]]
_FORMAT_VERSION = 4


def compare(
    teacher: Optional[FilesArg],
    student: FilesArg,
    algorithm: str = 'leo_star',
    *,
    teacher_tokens_file: Union[str, Path, None] = None,
    keylog_events: Optional[list] = None,
    keylog_file: Union[str, Path, None] = None,
) -> dict:
    """Compare teacher and student code files and return diff marks.

    Parameters
    ----------
    teacher:
        ``{filename: Path}`` mapping for the teacher's reference files.
        Keys are canonical filenames (e.g. ``'index.html'``); values are
        ``Path`` objects (or strings) pointing to the actual files.
        May be ``None`` when ``keylog_file`` is given — in that case the
        teacher files are reconstructed from the keylog.
    student:
        Same structure for the student's submission.
    algorithm:
        Matching algorithm — one of ``'leo_star'`` (default),
        ``'leo'``, ``'lcs_star'``, ``'lcs'``, ``'ro'``, ``'ro_star'``,
        ``'vscode'``, or ``'vscode_star'``.
    teacher_tokens_file:
        Optional path to a ``tokens.txt`` file from the LEO pipeline.
        Improves contextual and lcs_star accuracy by providing teacher
        typing order and token-removal information.
    keylog_events:
        Optional raw keylog event list (loaded from ``log.json``). Enables
        ghost-context reconstruction for removed teacher tokens.
    keylog_file:
        Optional path to a ``log.json`` file.  When given, the teacher files
        are reconstructed from the keylog events and ``keylog_events`` is
        derived automatically.  ``teacher`` may be ``None`` in this case.

    Returns
    -------
    dict
        A ``diff_marks.json``-compatible dict. Write it to disk and open
        with ``npm run diff`` to visualise the result.
    """
    if keylog_file is not None:
        with open(keylog_file, encoding='utf-8') as fh:
            log_data = json.load(fh)
        events = log_data.get('events', log_data) if isinstance(log_data, dict) else log_data
        keylog_events = events
        reconstructed = _sm.get_reconstructed_files(events)  # {tab_key: text}
        _tmpdir = tempfile.TemporaryDirectory()
        tmp_root = Path(_tmpdir.name)
        teacher_paths: Dict[str, Path] = {}
        for tab_key, text in reconstructed.items():
            fname = Path(tab_key).name if '/' in tab_key or '\\' in tab_key else tab_key
            p = tmp_root / fname
            p.write_text(text, encoding='utf-8')
            teacher_paths[fname] = p
    else:
        _tmpdir = None
        teacher_paths = {name: Path(p) for name, p in (teacher or {}).items()}

    student_paths = {name: Path(p) for name, p in student.items()}

    try:
        return _dispatch(
            teacher_paths, student_paths, algorithm,
            teacher_tokens_file, keylog_events,
        )
    finally:
        if _tmpdir is not None:
            _tmpdir.cleanup()

def _dispatch(
    teacher_paths: Dict[str, Path],
    student_paths: Dict[str, Path],
    algorithm: str,
    teacher_tokens_file,
    keylog_events,
) -> dict:
    alg = algorithm.lower().replace('-', '_')

    if alg == 'lcs':
        t, s, score = _build_lcs_token_diff_marks(teacher_paths, student_paths)
        return _wrap('token-lcs', t, s, score)

    if alg in ('ro', 'myers'):
        t, s, score, alignments = _build_ro_diff_marks(teacher_paths, student_paths)
        return _wrap('line-ro', t, s, score, alignments)

    if alg == 'vscode':
        t, s, score, alignments = _build_vscode_diff_marks(teacher_paths, student_paths)
        return _wrap('line-vscode', t, s, score, alignments)

    if alg == 'vscode_star':
        ghost_contexts = None
        if teacher_tokens_file is not None:
            entries = _parse_teacher_tokens(Path(teacher_tokens_file))
            removed_keys = {tok for tok, _, _, is_rem, *_ in entries if is_rem}
            if removed_keys and keylog_events:
                ghost_contexts = _build_ghost_contexts(keylog_events, removed_keys)
        t, s, score, alignments = _build_vscode_star_diff_marks(
            teacher_paths, student_paths, ghost_contexts)
        return _wrap('line-vscode-star', t, s, score, alignments)

    if alg == 'ro_star':
        ghost_contexts = None
        if teacher_tokens_file is not None:
            entries = _parse_teacher_tokens(Path(teacher_tokens_file))
            removed_keys = {tok for tok, _, _, is_rem, *_ in entries if is_rem}
            if removed_keys and keylog_events:
                ghost_contexts = _build_ghost_contexts(keylog_events, removed_keys)
        t, s, score, alignments = _build_ro_star_diff_marks(
            teacher_paths, student_paths, ghost_contexts)
        return _wrap('line-ro-star', t, s, score, alignments)

    if alg == 'lcs_star':
        removal_counts: Counter = Counter()
        ghost_contexts = None
        if teacher_tokens_file is not None:
            entries = _parse_teacher_tokens(Path(teacher_tokens_file))
            for tok, _, _, is_removed, _ in entries:
                if is_removed:
                    removal_counts[tok] += 1
            if keylog_events:
                removed_keys = {tok for tok, _, _, is_rem, *_ in entries if is_rem}
                if removed_keys:
                    ghost_contexts = _build_ghost_contexts(keylog_events, removed_keys)
        t, s, score = _build_lcs_star_diff_marks(
            teacher_paths, student_paths, removal_counts, ghost_contexts,
        )
        return _wrap('token-lcs-star', t, s, score)

    if alg in ('leo_star', 'leo', 'contextual_star', 'contextual'):
        if teacher_tokens_file is not None:
            teacher_entries = _parse_teacher_tokens(Path(teacher_tokens_file))
        else:
            teacher_entries = _teacher_entries_from_files(teacher_paths)
        student_outside, student_comment = _extract_student_tokens(student_paths)
        ghost_contexts = None
        if alg in ('leo_star', 'contextual_star') and keylog_events:
            removed_keys = {tok for tok, _, _, is_rem, *_ in teacher_entries if is_rem}
            if removed_keys:
                ghost_contexts = _build_ghost_contexts(keylog_events, removed_keys)
        t_colors, s_colors = _build_leo_diff_marks(
            teacher_paths, student_paths,
            teacher_entries, student_outside, student_comment,
        )
        t = _colors_to_position_marks(teacher_paths, t_colors)
        s = _colors_to_position_marks(student_paths, s_colors)
        diff = _wrap('leo', t, s, score=None)
        if alg in ('leo_star', 'contextual_star') and ghost_contexts:
            _apply_ghost_star_to_diff_marks(diff, student_paths, ghost_contexts)
        return diff

    raise ValueError(
        f"Unknown algorithm {algorithm!r}. "
        "Choose from: 'leo_star', 'leo', 'lcs_star', 'lcs', "
        "'ro', 'ro_star', 'vscode', 'vscode_star'."
    )


def _teacher_entries_from_files(teacher_paths: Dict[str, Path]) -> list:
    entries = []
    for name, path in teacher_paths.items():
        ext = Path(name).suffix.lower()
        try:
            text = path.read_text(encoding='utf-8', errors='ignore')
        except Exception:
            continue
        c_starts, c_ends = _comment_ranges_for_ext(text, ext)
        for pos, tok in _tokenize_file_ordered(text, ext):
            is_comment = _pos_in_comment(pos, c_starts, c_ends)
            entries.append((tok, '', is_comment, False, ''))
    return entries


def _wrap(
    token_matching: str,
    teacher_files: dict,
    student_files: dict,
    score: Optional[float],
    alignments: Optional[dict] = None,
) -> dict:
    result: dict = {
        'format_version': _FORMAT_VERSION,
        'token_matching': token_matching,
        'case_sensitive': True,
        'teacher_files': teacher_files,
        'student_files': student_files,
    }
    if score is not None:
        result['score'] = score
    if alignments is not None:
        result['alignments'] = alignments
    return result
