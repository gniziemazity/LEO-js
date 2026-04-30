"""
matcher.py — Standalone code diff / matching module.

Compare teacher and student code files and produce diff marks compatible
with differentiator.html (the ``diff_marks_<method>.json`` format) — without
any LEO grading-pipeline infrastructure.

Quick start
-----------
# Compare with reconstructed teacher files from a keylog (most accurate):
>>> from pathlib import Path
>>> from lesson_tools.utils.matcher import compare
>>> marks = compare(
...     teacher=None,
...     student={'index.html': Path('submission/index.html')},
...     keylog_file=Path('log.json'),    # teacher files reconstructed automatically
... )

# Or compare plain files directly (no keylog):
>>> marks = compare(
...     teacher={'index.html': Path('ref/index.html')},
...     student={'index.html': Path('submission/index.html')},
... )  # algorithm defaults to 'leo_star'

Algorithms (each plain method has a `_star` variant that promotes
``extra`` → ``ghost_extra`` for tokens whose context resembles a token the
teacher typed and later deleted; star variants require a keylog):

'leo_star' / 'leo'   Per-token Hungarian matching on cosine-similar contexts.
                     Comments excluded from matching, marked as ``comment``.
'lcs_star' / 'lcs'   ``difflib.SequenceMatcher`` (Ratcliff/Obershelp) on the
                     non-comment token sequence. Comments marked as ``comment``.
'lev_star' / 'lev'   Levenshtein edit-distance traceback on the non-comment
                     token sequence. Same comment handling as LCS.
'ro_star'  / 'ro'    ``difflib.SequenceMatcher`` on stripped lines + per-line
                     token-level diff. Treats comments as regular tokens.
'git_star' / 'git'   ``git diff --no-index --unified=0 -w`` + per-line
                     token-level diff. Treats comments as regular tokens.

See ``ideas/differentiator-algorithm.md`` for the full algorithm description.

SUPPORTED_METHODS — single authoritative list used by all callers.
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path
from typing import Dict, Optional, Union

from .lv_editor import reconstruct_all_headless
from .token_log import (
    _add_log_metadata,
    _assemble_diff_marks,
    _build_leo_diff_marks,
    _build_lcs_token_diff_marks,
    _build_lev_token_diff_marks,
    _build_ro_diff_marks,
    _build_git_diff_marks,
    _strip_internal_fields,
)

FilesArg = Dict[str, Union[str, Path]]

SUPPORTED_METHODS = [
    'leo_star',
    'leo',
    'lcs_star',
    'lcs',
    'lev_star',
    'lev',
    'git_star',
    'git',
    'ro_star',
    'ro',
]


def compare(
    teacher: Optional[FilesArg],
    student: FilesArg,
    algorithm: str = 'leo_star',
    *,
    keylog_events: Optional[list] = None,
    keylog_file: Union[str, Path, None] = None,
) -> dict:
    """Compare teacher and student code files and return diff marks.

    Parameters
    ----------
    teacher:
        ``{filename: Path}`` mapping for the teacher's reference files.
        May be ``None`` when ``keylog_file`` is given.
    student:
        Same structure for the student's submission.
    algorithm:
        Matching algorithm — one of the values in ``SUPPORTED_METHODS``
        (default ``'leo_star'``).
    keylog_events:
        Optional raw keylog event list (loaded from ``log.json``). Required
        for any ``*_star`` algorithm to actually promote ``ghost_extra``.
    keylog_file:
        Optional path to a ``log.json`` file. When given, the teacher's code
        is reconstructed from it and ``teacher`` is ignored.

    Returns
    -------
    dict
        A ``diff_marks_<method>.json``-compatible dict with keys
        ``token_matching``, ``score``, ``teacher_files``, ``student_files``,
        and (for line-based methods) ``alignments`` and ``line_marks``.
    """
    if keylog_file is not None:
        with open(keylog_file, encoding='utf-8') as fh:
            log_data = json.load(fh)
        events = log_data.get('events', log_data) if isinstance(log_data, dict) else log_data
        keylog_events = events
        reconstructed = reconstruct_all_headless(events)
        _tmpdir = tempfile.TemporaryDirectory()
        tmp_root = Path(_tmpdir.name)
        teacher_paths: Dict[str, Path] = {}
        for tab_key, text in reconstructed.items():
            if tab_key == 'MAIN':
                fname = 'reconstructed.html'
            elif '/' in tab_key or '\\' in tab_key:
                fname = Path(tab_key).name
            else:
                fname = tab_key
            p = tmp_root / fname
            p.write_text(text, encoding='utf-8')
            teacher_paths[fname] = p
    else:
        _tmpdir = None
        teacher_paths = {name: Path(p) for name, p in (teacher or {}).items()}

    student_paths = {name: Path(p) for name, p in student.items()}

    try:
        result = _dispatch(teacher_paths, student_paths, algorithm, keylog_events)
        _strip_internal_fields(result)
        return result
    finally:
        if _tmpdir is not None:
            _tmpdir.cleanup()

_BUILDERS = {
    'leo': _build_leo_diff_marks,
    'lcs': _build_lcs_token_diff_marks,
    'lev': _build_lev_token_diff_marks,
    'ro':  _build_ro_diff_marks,
    'git': _build_git_diff_marks,
}


def _dispatch(
    teacher_paths: Dict[str, Path],
    student_paths: Dict[str, Path],
    algorithm: str,
    keylog_events,
) -> dict:
    alg = algorithm.lower().replace('-', '_')
    base = alg[:-5] if alg.endswith('_star') else alg
    is_star = alg.endswith('_star')

    builder = _BUILDERS.get(base)
    if builder is None:
        raise ValueError(
            f"Unknown algorithm {algorithm!r}. "
            f"Choose from: {', '.join(repr(m) for m in SUPPORTED_METHODS)}."
        )

    result = builder(teacher_paths, student_paths)
    t, s, score, alignments, line_marks = result[:5]
    leo_assignments = result[6] if len(result) >= 7 else None
    diff = _assemble_diff_marks(
        alg, t, s, score, alignments, line_marks, leo_assignments,
    )
    if is_star and keylog_events:
        _add_log_metadata(
            diff, keylog_events, student_paths,
        )
    return diff
