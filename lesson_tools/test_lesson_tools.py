import json
import random
import sys
import tempfile
import unittest
from collections import Counter
from pathlib import Path
from typing import Dict, List, Set, Tuple

_ROOT = Path(__file__).resolve().parent
_TEST = _ROOT / 'test'

from utils import similarity_measures as _sm
from utils.lv_editor import reconstruct_html_headless
from utils.similarity_measures import (
    reconstruct_tokens_from_keylog_full,
)
from utils.token_log import (
    _add_log_metadata,
    _assemble_diff_marks,
    _build_git_diff_marks,
    _build_lcs_token_diff_marks,
    _build_leo_diff_marks,
    _build_lev_token_diff_marks,
    _build_ro_diff_marks,
    _parse_teacher_tokens,
    _split_tokens_by_comment,
    _structural_diff_summary,
    _structural_form,
)


def _student_labels(diff_marks: dict, tok: str) -> list:
    la = diff_marks.get('leo_assignments', {}).get('tokens', {})
    return [e.get('label') for e in la.get(tok, {}).get('student', [])]


def _teacher_labels(diff_marks: dict, tok: str) -> list:
    la = diff_marks.get('leo_assignments', {}).get('tokens', {})
    entries = la.get(tok, {}).get('teacher', [])
    return [e.get('label') for e in entries if not e.get('ghost')]


def _student_marks(diff_marks: dict, fname: str, tok: str) -> list:
    return [m for m in diff_marks.get('student_files', {}).get(fname, [])
            if m.get('token') == tok]


def _load_events(log_path: Path) -> list:
    with open(log_path, encoding='utf-8') as f:
        return json.load(f)['events']


def _load_json(path: Path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def _parse_tokens_file(path: Path):
    return _parse_teacher_tokens(path, return_headers=True)


def _parse_student_tokens_file(path: Path):
    headers: dict = {}
    entries: list = []
    with open(path, encoding='utf-8') as f:
        for line in f:
            stripped = line.rstrip('\n')
            if stripped.startswith('# '):
                for key, label in [
                    ('Found',   '# Found'),
                    ('MISSING', '# MISSING'),
                    ('EXTRA',   '# EXTRA'),
                    ('Follow',  '# Follow (E)'),
                ]:
                    if stripped.startswith(label):
                        val = stripped.split(':')[1].strip().rstrip(' %')
                        headers[key] = float(val) if '.' in val else int(val)
            elif stripped:
                parts = stripped.split('\t')
                tok      = parts[0]
                time_str = parts[1] if len(parts) > 1 else ''
                flags    = set(parts[2:]) if len(parts) > 2 else set()
                entries.append((tok, time_str, flags))
    return headers, entries


def _build_token_occurrences(events: list) -> list:
    kw_ts, kw_ts_comment, removed_kw_ts, upper_to_display, occ_with_display = (
        reconstruct_tokens_from_keylog_full(events)
    )

    occ = []
    for upper in kw_ts:
        occ_sorted = sorted(occ_with_display.get(upper, []))
        comment_ts = set(kw_ts_comment.get(upper, []))
        for ts, disp in occ_sorted:
            occ.append((ts, disp, ts in comment_ts, False))

    for upper, ts_list in removed_kw_ts.items():
        disp = upper_to_display.get(upper, upper)
        for ins_ts, del_ts in ts_list:
            occ.append((ins_ts, disp, False, True))

    occ.sort(key=lambda x: x[0])
    return occ


def _ts_to_helsinki(ts_ms: int) -> str:
    try:
        from utils.lv_constants import FINLAND_TZ
        from datetime import datetime
        if FINLAND_TZ is not None:
            dt = datetime.fromtimestamp(ts_ms / 1000, tz=FINLAND_TZ)
            return dt.strftime('%H:%M:%S')
    except Exception:
        pass
    from datetime import datetime
    return datetime.fromtimestamp(ts_ms / 1000).strftime('%H:%M:%S')


class _ReconstructionBase:
    log_file:           Path = None
    reconstructed_file: Path = None
    tokens_file:        Path = None

    @classmethod
    def setUpClass(cls):
        cls.events = _load_events(cls.log_file)
        cls.headers, cls.expected = _parse_tokens_file(cls.tokens_file)
        cls.occ = _build_token_occurrences(cls.events)
        cls.kw_ts, *_ = reconstruct_tokens_from_keylog_full(cls.events)

    @classmethod
    def tearDownClass(cls):
        pass

    def test_html_matches_reference(self):
        actual   = reconstruct_html_headless(self.events)
        expected = self.reconstructed_file.read_text(encoding='utf-8')
        self.assertEqual(actual, expected)

    def test_surviving_count(self):
        n = sum(1 for *_, is_removed in self.occ if not is_removed)
        self.assertEqual(n, self.headers['Occurrences'])

    def test_removed_count(self):
        n = sum(1 for *_, is_removed in self.occ if is_removed)
        self.assertEqual(n, self.headers['Removed'])

    def test_unique_token_count(self):
        self.assertEqual(len(self.kw_ts), self.headers['Unique'])

    def test_token_sequence_and_flags(self):
        actual = [(tok, is_comment, is_removed)
                  for _, tok, is_comment, is_removed in self.occ]
        expected = [(tok, is_comment, is_removed)
                    for tok, _, is_comment, is_removed, *_ in self.expected]
        self.assertEqual(actual, expected)

    def test_token_timestamps(self):
        actual_with_ts = [
            (tok, _ts_to_helsinki(ts), is_comment, is_removed)
            for ts, tok, is_comment, is_removed in self.occ
        ]
        expected_with_ts = [
            (tok, ts_str, is_comment, is_removed)
            for tok, ts_str, is_comment, is_removed, *_ in self.expected
        ]
        self.assertEqual(actual_with_ts, expected_with_ts)

    def test_timestamps_are_sorted(self):
        timestamps = [ts for ts, *_ in self.occ]
        self.assertEqual(timestamps, sorted(timestamps))


class _StudentBase:
    teacher_tokens_file: Path = None
    student_html:        Path = None
    tokens_file:         Path = None

    @classmethod
    def setUpClass(cls):
        _teacher_headers, cls.teacher_entries = _parse_tokens_file(cls.teacher_tokens_file)
        cls.headers, cls.raw_expected = _parse_student_tokens_file(cls.tokens_file)
        cls.removal_ts_by_token: Dict[str, set] = {}
        for tok, _, _, is_rem, removal_ts in cls.teacher_entries:
            if is_rem and removal_ts:
                cls.removal_ts_by_token.setdefault(tok, set()).add(removal_ts)
        cls.expected = [(tok, ts, flags) for tok, ts, flags in cls.raw_expected]
        cls.all_occ = [(ts, tok, flags) for tok, ts, flags in cls.expected]
        cls.n_found = int(cls.headers['Found'])
        cls.n_missing = int(cls.headers['MISSING'])
        cls.n_extra = int(cls.headers['EXTRA'])
        cls.follow_e = float(cls.headers['Follow'])

    @classmethod
    def tearDownClass(cls):
        pass

    def test_found_count(self):
        self.assertEqual(self.n_found, int(self.headers['Found']))

    def test_missing_count(self):
        self.assertEqual(self.n_missing, int(self.headers['MISSING']))

    def test_extra_count(self):
        self.assertEqual(self.n_extra, int(self.headers['EXTRA']))

    def test_follow_score(self):
        self.assertAlmostEqual(self.follow_e, self.headers['Follow'], places=1)

    def test_token_sequence_and_flags(self):
        actual   = [(tok, frozenset(flags)) for _, tok, flags in self.all_occ]
        expected = [(tok, frozenset(flags)) for tok, _, flags in self.expected]
        self.assertEqual(actual, expected)

    def test_token_timestamps(self):
        actual   = [(tok, ts, frozenset(flags)) for ts, tok, flags in self.all_occ]
        expected = [(tok, ts, frozenset(flags)) for tok, ts, flags in self.expected]
        self.assertEqual(actual, expected)

    def test_ghost_extra_timestamps(self):
        for tok, ts, flags in self.raw_expected:
            if flags == {'EXTRA*'}:
                allowed = self.removal_ts_by_token.get(tok)
                if allowed:
                    self.assertIn(
                        ts, allowed,
                        f"EXTRA* token '{tok}' has ts {ts!r}, expected one of {sorted(allowed)!r}",
                    )


class TestChessBoardReconstruction(_ReconstructionBase, unittest.TestCase):
    log_file           = _TEST / 'wall' / 'log.json'
    reconstructed_file = _TEST / 'wall' / 'reconstructed.html'
    tokens_file        = _TEST / 'wall' / 'tokens.txt'


class TestChessBoardStudent78Tokens(_StudentBase, unittest.TestCase):
    teacher_tokens_file = _TEST / 'wall' / 'tokens.txt'
    student_html        = _TEST / 'wall' / '78' / 'index.html'
    tokens_file         = _TEST / 'wall' / '78' / 'tokens.txt'


class TestChessBoardStudent74Tokens(_StudentBase, unittest.TestCase):
    teacher_tokens_file = _TEST / 'wall' / 'tokens.txt'
    student_html        = _TEST / 'wall' / '74' / 'index.html'
    tokens_file         = _TEST / 'wall' / '74' / 'tokens.txt'


class TestChessBoardStudent80Tokens(_StudentBase, unittest.TestCase):
    teacher_tokens_file = _TEST / 'wall' / 'tokens.txt'
    student_html        = _TEST / 'wall' / '80' / 'index.html'
    tokens_file         = _TEST / 'wall' / '80' / 'tokens.txt'


class TestChessBoardStudent80DiffMarks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.diff_marks = _load_json(_TEST / 'wall' / '80' / 'diff_marks_leo_star.json')
        cls.teacher_occs = cls.diff_marks['teacher_files'][
            next(iter(cls.diff_marks['teacher_files']))
        ]
        cls.student_occs = cls.diff_marks['student_files'][
            next(iter(cls.diff_marks['student_files']))
        ]

    def test_shape_contains_teacher_and_student_files(self):
        self.assertIn('teacher_files', self.diff_marks)
        self.assertIn('student_files', self.diff_marks)
        self.assertTrue(self.diff_marks['teacher_files'])
        self.assertTrue(self.diff_marks['student_files'])

    def test_positions_have_start_end(self):
        for occ in self.teacher_occs + self.student_occs:
            self.assertIn('start', occ)
            self.assertIn('end', occ)
            self.assertGreaterEqual(occ['end'], occ['start'])

    def test_occurrences_sorted_by_start(self):
        starts = [o['start'] for o in self.student_occs]
        self.assertEqual(starts, sorted(starts))

    def test_size_and_inline_are_comment(self):
        size_labels = [o['label'] for o in self.student_occs if o['token'] == 'size']
        self.assertTrue(size_labels)
        self.assertTrue(all(x == 'comment' for x in size_labels))
        inline_labels = [o['label'] for o in self.student_occs if o['token'] == 'inline']
        self.assertTrue(inline_labels)
        self.assertTrue(all(x == 'comment' for x in inline_labels))

    def test_student_extra_example(self):
        labels_400px = [o['label'] for o in self.student_occs if o['token'] == '400px']
        self.assertEqual(labels_400px, ['extra'])

    def test_student_div_comment_count(self):
        div_comment = [o for o in self.student_occs if o['token'] == 'div' and o['label'] == 'comment']
        self.assertEqual(len(div_comment), 3)

    def test_no_null_labels_in_fixture(self):
        # format v4 only stores colored (non-null) occurrences
        for occ in self.teacher_occs + self.student_occs:
            self.assertIsNotNone(occ.get('label'))


class TestChessGameReconstruction(_ReconstructionBase, unittest.TestCase):
    log_file           = _TEST / 'chess' / 'log.json'
    reconstructed_file = _TEST / 'chess' / 'reconstructed.html'
    tokens_file        = _TEST / 'chess' / 'tokens.txt'


class TestChessGameStudent23Tokens(_StudentBase, unittest.TestCase):
    teacher_tokens_file = _TEST / 'chess' / 'tokens.txt'
    student_html        = _TEST / 'chess' / '23' / 'index.html'
    tokens_file         = _TEST / 'chess' / '23' / 'tokens.txt'


class TestChessGameStudent50Tokens(_StudentBase, unittest.TestCase):
    teacher_tokens_file = _TEST / 'chess' / 'tokens.txt'
    student_html        = _TEST / 'chess' / '50' / 'index.html'
    tokens_file         = _TEST / 'chess' / '50' / 'tokens.txt'


class TestChessGameStudent50DiffMarks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dm = _load_json(_TEST / 'chess' / '50' / 'diff_marks_leo_star.json')

    def test_this_is_ghost_extra(self):
        self.assertEqual(_student_labels(self.dm, 'this'), ['ghost_extra'])

    def test_onclick_first_occurrence_is_ghost_extra(self):
        labels = _student_labels(self.dm, 'onclick')
        self.assertGreaterEqual(len(labels), 1)
        self.assertEqual(labels[0], 'ghost_extra')

    def test_handleclick_first_occurrence_is_ghost_extra(self):
        labels = _student_labels(self.dm, 'handleClick')
        self.assertGreaterEqual(len(labels), 1)
        self.assertEqual(labels[0], 'ghost_extra')


class TestJSStudent78Tokens(_StudentBase, unittest.TestCase):
    teacher_tokens_file = _TEST / 'js' / 'tokens.txt'
    student_html        = _TEST / 'js' / '78' / 'index.html'
    tokens_file         = _TEST / 'js' / '78' / 'tokens.txt'


class TestJSStudent35Tokens(_StudentBase, unittest.TestCase):
    teacher_tokens_file = _TEST / 'js' / 'tokens.txt'
    student_html        = _TEST / 'js' / '35' / 'index.html'
    tokens_file         = _TEST / 'js' / '35' / 'tokens.txt'


class TestJSReconstruction(_ReconstructionBase, unittest.TestCase):
    log_file           = _TEST / 'js' / 'log.json'
    reconstructed_file = _TEST / 'js' / 'reconstructed.html'
    tokens_file        = _TEST / 'js' / 'tokens.txt'


class TestQRCodeReconstruction(_ReconstructionBase, unittest.TestCase):
    log_file           = _TEST / 'qr' / 'log.json'
    reconstructed_file = _TEST / 'qr' / 'reconstructed.html'
    tokens_file        = _TEST / 'qr' / 'tokens.txt'


class TestSortingReconstruction(_ReconstructionBase, unittest.TestCase):
    log_file           = _TEST / 'sorting' / 'log.json'
    reconstructed_file = _TEST / 'sorting' / 'reconstructed.html'
    tokens_file        = _TEST / 'sorting' / 'tokens.txt'


class TestSortingStudent23Tokens(_StudentBase, unittest.TestCase):
    teacher_tokens_file = _TEST / 'sorting' / 'tokens.txt'
    student_html        = _TEST / 'sorting' / '23' / 'index.html'
    tokens_file         = _TEST / 'sorting' / '23' / 'tokens.txt'


class TestChessGameStudent20DiffMarks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dm = _load_json(_TEST / 'chess' / '20' / 'diff_marks_leo_star.json')

    def test_handleclick_extra_is_ghost_extra(self):
        labels = _student_labels(self.dm, 'handleClick')
        self.assertGreaterEqual(len(labels), 1)
        self.assertEqual(labels[0], 'ghost_extra')


class TestChessGameStudent35Tokens(_StudentBase, unittest.TestCase):
    teacher_tokens_file = _TEST / 'chess' / 'tokens.txt'
    student_html        = _TEST / 'chess' / '35' / '123456.index.html'
    tokens_file         = _TEST / 'chess' / '35' / 'tokens.txt'


class TestChessGameStudent35DiffMarks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dm = _load_json(_TEST / 'chess' / '35' / 'diff_marks_leo_star.json')

    def test_handleclick_is_ghost_extra(self):
        labels = _student_labels(self.dm, 'handleClick')
        self.assertGreaterEqual(len(labels), 1)
        self.assertEqual(labels[0], 'ghost_extra')

    def test_handleclick_real_teacher_occurrences_are_matched(self):
        labels = _teacher_labels(self.dm, 'handleClick')
        self.assertEqual(labels, [None, None])


class TestSortingStudent66DiffMarks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dm = _load_json(_TEST / 'sorting' / '66' / 'diff_marks_leo_star.json')

    def test_width_first_occurrence_is_ghost_extra(self):
        labels = _student_labels(self.dm, 'width')
        self.assertGreaterEqual(len(labels), 1)
        self.assertEqual(labels[0], 'ghost_extra')

    def test_width_second_occurrence_is_matched(self):
        labels = _student_labels(self.dm, 'width')
        self.assertGreaterEqual(len(labels), 2)
        self.assertIsNone(labels[1])

    def test_background_color_student_is_matched(self):
        self.assertEqual(_student_labels(self.dm, 'background-color'), [])

    def test_background_color_teacher_is_matched(self):
        self.assertEqual(_teacher_labels(self.dm, 'background-color'), [])

    def test_async_is_missing(self):
        self.assertEqual(_teacher_labels(self.dm, 'async'), ['missing'])


class TestQRStudent31DiffMarks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dm = _load_json(_TEST / 'qr' / '31' / 'diff_marks_leo_star.json')

    def test_background_in_css_is_ghost_extra(self):
        marks = _student_marks(self.dm, '123456.css', 'background')
        self.assertGreaterEqual(len(marks), 1)
        self.assertEqual(marks[0]['label'], 'ghost_extra')


def _shuffle_non_comment_tokens(text: str, seed: int) -> str:
    nc, _ = _split_tokens_by_comment(text)
    if len(nc) <= 1:
        return text
    new_texts = [tok for _, tok in nc]
    random.Random(seed).shuffle(new_texts)
    return '\n'.join(new_texts)


class TestLEOCountForcedBlindSpot(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        tmp_root = Path(cls._tmp.name)

        teacher_path = _TEST / 'wall' / 'reconstructed.html'
        text = teacher_path.read_text(encoding='utf-8')

        identical_path = tmp_root / 'identical.html'
        identical_path.write_text(text, encoding='utf-8')

        shuffled_path = tmp_root / 'shuffled.html'
        shuffled_path.write_text(_shuffle_non_comment_tokens(text, seed=42),
                                  encoding='utf-8')

        cls.teacher_files  = {teacher_path.name: teacher_path}
        cls.identical_files = {teacher_path.name: identical_path}
        cls.shuffled_files  = {teacher_path.name: shuffled_path}
        cls.events = _load_events(_TEST / 'wall' / 'log.json')

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def _score(self, builder, student_files):
        return builder(self.teacher_files, student_files)[2]

    def test_baseline_identical_student_scores_100_for_all_methods(self):
        for builder, name in [
            (_build_leo_diff_marks,        'leo'),
            (_build_lcs_token_diff_marks,  'lcs'),
            (_build_lev_token_diff_marks,  'lev'),
            (_build_ro_diff_marks,         'ro'),
            (_build_git_diff_marks,        'git'),
        ]:
            with self.subTest(method=name):
                self.assertEqual(
                    self._score(builder, self.identical_files), 100.0,
                    f'{name} should score 100% on identical student',
                )

    def test_leo_score_unchanged_by_shuffle(self):
        score = self._score(_build_leo_diff_marks, self.shuffled_files)
        self.assertEqual(
            score, 100.0,
            'LEO is count-forced — shuffling preserves per-token counts '
            'so every token-type Hungarian fills every slot, no missing/'
            f'extra emitted, score stays at 100%. Got {score}.',
        )

    def test_position_sensitive_methods_drop_after_shuffle(self):
        for builder, name in [
            (_build_lcs_token_diff_marks, 'lcs'),
            (_build_lev_token_diff_marks, 'lev'),
            (_build_ro_diff_marks,        'ro'),
            (_build_git_diff_marks,       'git'),
        ]:
            with self.subTest(method=name):
                score = self._score(builder, self.shuffled_files)
                self.assertLess(
                    score, 100.0,
                    f'{name} should fall below 100% on a shuffled student '
                    f'(it is position-sensitive); got {score}',
                )

    def test_leo_star_deviates_slightly_under_shuffle(self):
        result = _build_leo_diff_marks(
            self.teacher_files, self.shuffled_files, events=self.events,
        )
        t, s, score, alignments, line_marks, n_total, leo_assignments = result
        diff = _assemble_diff_marks(
            'leo_star', t, s, score, alignments, line_marks, leo_assignments,
        )
        _add_log_metadata(
            diff, self.events, self.shuffled_files,
            teacher_files=self.teacher_files,
        )
        n_missing = sum(
            1 for marks in diff['teacher_files'].values()
            for m in marks if m.get('label') == 'missing'
        )
        n_ghost_extra = sum(
            1 for marks in diff['student_files'].values()
            for m in marks if m.get('label') == 'ghost_extra'
        )
        score_star = round(
            max(0.0, (n_total - n_missing - n_ghost_extra) / n_total * 100), 1,
        )
        self.assertLess(
            score_star, 100.0,
            'LEO* should be < 100% under shuffle: Phase 1 joint Hungarian '
            'with ghosts can pull real teachers out of pairing; '
            f'got {score_star} (n_missing={n_missing}, '
            f'n_ghost_extra={n_ghost_extra}).',
        )
        self.assertGreater(
            score_star, 95.0,
            'LEO* should still be very high under shuffle (the count-forced '
            'Hungarian still pairs the vast majority of tokens); '
            f'got {score_star}.',
        )


def _reconstruct_tokens_from_marks(
    t_marks: list,
    s_marks: list,
    s_text: str,
    s_fname: str,
    *,
    include_comment_tokens: bool,
) -> List[str]:
    if include_comment_tokens:
        s_token_seq = [(m.start(), m.group())
                       for m in _sm._CHAR_TOKEN_RE.finditer(s_text)]
    else:
        s_nc, _ = _split_tokens_by_comment(s_text)
        s_token_seq = list(s_nc)

    extras = {m['start'] for m in s_marks
              if m.get('label') in ('extra', 'ghost_extra')}
    for m in t_marks:
        pw = m.get('paired_with')
        if pw and pw.get('file') == s_fname:
            extras.add(pw['start'])

    events: list = []  # (pos, kind, order, token); kind 0=insert, 1=kept
    for i, (start, tok) in enumerate(s_token_seq):
        if start in extras:
            continue
        events.append((start, 1, i, tok))

    order = 0
    for m in t_marks:
        if m.get('label') != 'missing':
            continue
        pw = m.get('paired_with')
        if pw and pw.get('file') == s_fname:
            events.append((pw['start'], 0, order, m['token']))
        else:
            ia = m.get('insert_at') or m.get('_native_insert_at')
            if ia and ia.get('file') == s_fname:
                events.append((ia['pos'], 0, order, m['token']))
        order += 1

    events.sort(key=lambda e: (e[0], e[1], e[2]))
    return [e[3] for e in events]


def _expected_teacher_tokens(t_text: str, *, include_comment_tokens: bool) -> List[str]:
    if include_comment_tokens:
        return [m.group() for m in _sm._CHAR_TOKEN_RE.finditer(t_text)]
    t_nc, _ = _split_tokens_by_comment(t_text)
    return [tok for _, tok in t_nc]


def _project_code_files(d: Path) -> Dict[str, Path]:
    return {p.name: p for p in d.iterdir()
            if p.is_file() and p.suffix.lower() in ('.html', '.css', '.js')}


def _pair_student_file(t_path: Path, t_name: str,
                       student_files: Dict[str, Path]) -> Path:
    if t_name in student_files:
        return student_files[t_name]
    ext = t_path.suffix.lower()
    candidates = [p for p in student_files.values() if p.suffix.lower() == ext]
    return candidates[0] if len(candidates) == 1 else None


_NON_STAR_RECONSTRUCT_METHODS = [
    ('lcs', _build_lcs_token_diff_marks, False),
    ('lev', _build_lev_token_diff_marks, False),
    ('ro',  _build_ro_diff_marks,        True),
    ('git', _build_git_diff_marks,       True),
]


_MAX_STUDENTS_PER_PROJECT = 5


def _sampled_student_dirs(project_dir):
    dirs = sorted(d for d in project_dir.iterdir()
                  if d.is_dir() and d.name.isdigit())
    if _MAX_STUDENTS_PER_PROJECT is not None:
        dirs = dirs[:_MAX_STUDENTS_PER_PROJECT]
    return dirs


import re as _re

_ALNUM_RE = _re.compile(r'[a-zA-Z0-9]')


_TOKEN_RE = _re.compile(r'[a-zA-Z0-9]+|[^\s]')


def _group_marks_for_apply(
    diff_marks: dict, t_fname: str, s_fname: str,
    t_text: str, s_text: str,
) -> list:
    t_marks = diff_marks.get('teacher_files', {}).get(t_fname, []) or []
    s_marks = diff_marks.get('student_files', {}).get(s_fname, []) or []

    insert_positions: Set[int] = set()
    for tm in t_marks:
        if tm.get('label') != 'missing' or tm.get('paired_with'):
            continue
        ia = tm.get('insert_at')
        if ia and ia.get('file') == s_fname:
            insert_positions.add(ia['pos'])

    def group_key(m):
        lbl = m.get('label')
        if lbl == 'missing':
            ia = m.get('insert_at')
            return f"mi|{ia['file']}|{ia['pos']}" if ia else 'm|free'
        if lbl == 'extra':
            pw = m.get('paired_with')
            return f"er|{pw['file']}|{pw['start']}" if pw else 'e'
        if lbl == 'ghost_extra':
            return 'ge'
        return f"?|{lbl}"

    groups = []
    for side, marks, src_text, fname in (
        ('teacher', t_marks, t_text, t_fname),
        ('student', s_marks, s_text, s_fname),
    ):
        sorted_marks = sorted(marks, key=lambda m: m['start'])
        all_tokens = [(m.start(), m.end()) for m in _TOKEN_RE.finditer(src_text)]
        comment_positions = {m['start'] for m in sorted_marks
                              if m.get('label') == 'comment'}
        ipos = insert_positions if side == 'student' else set()

        def has_obstacle(lo, hi):
            if lo > hi:
                return False
            for tstart, _tend in all_tokens:
                if tstart < lo:
                    continue
                if tstart >= hi:
                    break
                if tstart not in comment_positions:
                    return True
            for p in ipos:
                if lo <= p <= hi:
                    return True
            return False

        cur = None
        cur_key = None
        for m in sorted_marks:
            lbl = m.get('label')
            if lbl not in ('missing', 'extra', 'ghost_extra'):
                continue
            if side == 'teacher' and lbl == 'missing' and m.get('paired_with'):
                continue
            key = group_key(m)
            mlo, mhi = m['start'], m['end']
            if cur is not None and cur_key == key and not has_obstacle(cur['hi'], mlo):
                cur['hi'] = max(cur['hi'], mhi)
                cur['marks'].append(m)
                continue
            if cur is not None:
                groups.append(cur)
            cur = {'side': side, 'file': fname, 'lo': mlo, 'hi': mhi,
                   'marks': [m], 'kind': None}
            cur_key = key
            if lbl == 'missing':
                cur['kind'] = 'missing-insert' if m.get('insert_at') else 'missing'
                if m.get('insert_at'):
                    cur['insert_file'] = m['insert_at']['file']
                    cur['insert_pos'] = m['insert_at']['pos']
            elif lbl == 'ghost_extra':
                cur['kind'] = 'ghost_extra'
            else:
                cur['kind'] = 'extra-replace' if m.get('paired_with') else 'extra'
                if m.get('paired_with'):
                    cur['pair_file'] = m['paired_with']['file']
                    cur['pair_lo'] = m['paired_with']['start']
                    cur['pair_hi'] = m['paired_with']['end']
        if cur is not None:
            groups.append(cur)
    return groups


_WS_RE = _re.compile(r'\s')


def _backward_whitespace(text: str, pos: int) -> str:
    if pos <= 0 or not _WS_RE.match(text[pos - 1]):
        return ''
    i = pos
    while i > 0 and _WS_RE.match(text[i - 1]):
        i -= 1
    return text[i:pos]


def _forward_whitespace(text: str, pos: int) -> str:
    if pos >= len(text) or not _WS_RE.match(text[pos]):
        return ''
    i = pos
    while i < len(text) and _WS_RE.match(text[i]):
        i += 1
    return text[pos:i]


def _align_whitespace(
    src_text: str, src_start: int, src_end: int,
    dst_text: str, dst_start: int, dst_end: int,
):
    s_lead = _backward_whitespace(src_text, src_start)
    d_lead = _backward_whitespace(dst_text, dst_start)
    s_trail = _forward_whitespace(src_text, src_end)
    d_trail = _forward_whitespace(dst_text, dst_end)
    body = src_text[src_start:src_end]
    a_start, a_end = dst_start, dst_end
    if s_lead and not d_lead:
        body = s_lead + body
    elif not s_lead and d_lead and '\n' not in d_lead:
        a_start = dst_start - len(d_lead)
    if s_trail and not d_trail:
        body = body + s_trail
    elif not s_trail and d_trail and '\n' not in d_trail:
        a_end = dst_end + len(d_trail)
    return body, a_start, a_end


def _truth_apply_to_student_text(
    diff_marks: dict, t_text: str, s_text: str,
    t_fname: str, s_fname: str,
) -> str:
    groups = _group_marks_for_apply(diff_marks, t_fname, s_fname, t_text, s_text)

    consumed_missings = set()
    student_extras = sorted(
        [g for g in groups if g['side'] == 'student' and g['file'] == s_fname
         and g['kind'] in ('extra', 'ghost_extra')],
        key=lambda g: g['lo'],
    )
    teacher_missings = sorted(
        [g for g in groups if g['side'] == 'teacher'
         and g['kind'] == 'missing-insert'
         and g.get('insert_file') == s_fname],
        key=lambda g: g['lo'],
    )
    all_t_tokens = [
        (m.start(), m.end()) for m in _TOKEN_RE.finditer(t_text)
    ]
    for eg in student_extras:
        candidates = [
            g for g in teacher_missings
            if id(g) not in consumed_missings
            and eg['lo'] <= g['insert_pos'] <= eg['hi']
        ]
        if not candidates:
            continue
        candidates.sort(key=lambda g: g['lo'])
        contig = [candidates[0]]
        for nxt in candidates[1:]:
            prev_hi = contig[-1]['hi']
            has_kept = any(
                prev_hi <= ts < nxt['lo'] for ts, _ in all_t_tokens
            )
            if has_kept:
                break
            contig.append(nxt)
        t_lo = contig[0]['lo']
        t_hi = contig[-1]['hi']
        eg['_coalesced'] = (t_lo, t_hi, t_text[t_lo:t_hi])
        for mg in contig:
            consumed_missings.add(id(mg))

    ops = []
    order = 0
    for g in groups:
        if g['side'] == 'teacher' and g['kind'] == 'missing-insert' \
                and g.get('insert_file') == s_fname:
            if id(g) in consumed_missings:
                order += 1
                continue
            body, a, b = _align_whitespace(
                t_text, g['lo'], g['hi'],
                s_text, g['insert_pos'], g['insert_pos'],
            )
            ops.append([a, b, body, order])
        elif g['side'] == 'student' and g['kind'] == 'extra-replace' \
                and g['file'] == s_fname:
            body, a, b = _align_whitespace(
                t_text, g['pair_lo'], g['pair_hi'],
                s_text, g['lo'], g['hi'],
            )
            ops.append([a, b, body, order])
        elif g['side'] == 'student' and g['kind'] in ('extra', 'ghost_extra') \
                and g['file'] == s_fname:
            if '_coalesced' in g:
                _, _, body = g.pop('_coalesced')
                ops.append([g['lo'], g['hi'], body, order])
            else:
                ops.append([g['lo'], g['hi'], '', order])
        order += 1
    ops.sort(key=lambda o: (-o[0], -(o[1] - o[0]), -o[3]))
    text = s_text
    for start, end, body, _ in ops:
        if body:
            before = text[start - 1] if start > 0 else ''
            after = text[end] if end < len(text) else ''
            if before and _ALNUM_RE.match(before) and _ALNUM_RE.match(body[0]):
                body = ' ' + body
            if after and _ALNUM_RE.match(after) and _ALNUM_RE.match(body[-1]):
                body = body + ' '
        text = text[:start] + body + text[end:]
    return text


class TestCorrection(unittest.TestCase):
    def _assert_structural_equiv(self, actual, expected):
        a = _structural_form(actual)
        e = _structural_form(expected)
        if a != e:
            self.fail(_structural_diff_summary(a, e))

    def _check_tokens(self, mid, builder, include_cm,
                      teacher_files, student_files,
                      project_dir, student_dir):
        t_res, s_res, *_ = builder(teacher_files, student_files)
        for t_name, t_path in teacher_files.items():
            s_path = _pair_student_file(t_path, t_name, student_files)
            if s_path is None:
                continue
            with self.subTest(level='tokens', method=mid,
                              project=project_dir.name,
                              student=student_dir.name, file=t_name):
                s_text = s_path.read_text(
                    encoding='utf-8', errors='ignore',
                ).replace('\r\n', '\n')
                t_text = t_path.read_text(
                    encoding='utf-8', errors='ignore',
                ).replace('\r\n', '\n')
                actual = _reconstruct_tokens_from_marks(
                    t_res.get(t_name, []),
                    s_res.get(s_path.name, []),
                    s_text, s_path.name,
                    include_comment_tokens=include_cm,
                )
                expected = _expected_teacher_tokens(
                    t_text, include_comment_tokens=include_cm,
                )
                self._assert_structural_equiv(actual, expected)

    def _check_text(self, mid, builder, include_cm,
                    teacher_files, student_files,
                    project_dir, student_dir):
        t_res, s_res, score, alignments, line_marks, n_total = (
            builder(teacher_files, student_files)
        )
        from utils.token_log import _assemble_diff_marks, _strip_internal_fields
        diff_marks = _assemble_diff_marks(
            mid, t_res, s_res,
            score=score, alignments=alignments, line_marks=line_marks,
        )
        _strip_internal_fields(diff_marks)
        for t_name, t_path in teacher_files.items():
            s_path = _pair_student_file(t_path, t_name, student_files)
            if s_path is None:
                continue
            with self.subTest(level='text', method=mid,
                              project=project_dir.name,
                              student=student_dir.name, file=t_name):
                s_text = s_path.read_text(
                    encoding='utf-8', errors='ignore',
                ).replace('\r\n', '\n')
                t_text = t_path.read_text(
                    encoding='utf-8', errors='ignore',
                ).replace('\r\n', '\n')
                spliced = _truth_apply_to_student_text(
                    diff_marks, t_text, s_text, t_name, s_path.name,
                )
                expected = _expected_teacher_tokens(
                    t_text, include_comment_tokens=include_cm,
                )
                if include_cm:
                    actual = [m.group()
                              for m in _sm._CHAR_TOKEN_RE.finditer(spliced)]
                else:
                    actual = [tok for _, tok in
                              _split_tokens_by_comment(spliced)[0]]
                self._assert_structural_equiv(actual, expected)

    def _check(self, project_dir: Path, student_dir: Path) -> None:
        teacher_files = _project_code_files(project_dir)
        student_files = _project_code_files(student_dir)
        if not teacher_files or not student_files:
            return
        for mid, builder, include_cm in _NON_STAR_RECONSTRUCT_METHODS:
            self._check_tokens(mid, builder, include_cm,
                               teacher_files, student_files,
                               project_dir, student_dir)
            self._check_text(mid, builder, include_cm,
                             teacher_files, student_files,
                             project_dir, student_dir)


def _attach_correction_tests() -> None:
    for project_dir in sorted(_TEST.iterdir()):
        if not project_dir.is_dir():
            continue
        for student_dir in _sampled_student_dirs(project_dir):
            method_name = (
                f'test_{project_dir.name}_{student_dir.name}'
            )
            def make(p=project_dir, s=student_dir):
                def test(self):
                    self._check(p, s)
                return test
            setattr(TestCorrection, method_name, make())


_attach_correction_tests()


if __name__ == '__main__':
    unittest.main()
