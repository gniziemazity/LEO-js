import json
import sys
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
    _build_student_token_occurrences,
    _build_contextual_diff_marks,
    _build_ghost_contexts,
    _extract_student_ci_split,
    _parse_teacher_tokens,
    _CONTEXT_K,
    _GHOST_K,
)


def _load_events(log_path: Path) -> list:
    with open(log_path, encoding='utf-8') as f:
        return json.load(f)['events']


def _load_json(path: Path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def _parse_tokens_file(path: Path):
    headers: dict = {}
    entries: list = []
    with open(path, encoding='utf-8') as f:
        for line in f:
            stripped = line.rstrip('\n')
            if stripped.startswith('# '):
                for key in ('Occurrences', 'Removed', 'Unique'):
                    if stripped.startswith(f'# {key}'):
                        headers[key] = int(stripped.split(':')[1].strip())
            elif stripped:
                parts = stripped.split('\t')
                tok      = parts[0]
                time_str = parts[1] if len(parts) > 1 else ''
                is_removed = 'REMOVED' in parts[2:]
                removal_ts_str = ''
                if is_removed:
                    try:
                        removed_idx = parts.index('REMOVED')
                        if removed_idx + 1 < len(parts):
                            removal_ts_str = parts[removed_idx + 1]
                    except ValueError:
                        pass
                entries.append((tok, time_str, 'COMMENT' in parts[2:], is_removed, removal_ts_str))
    return headers, entries


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


def _build_token_occurrences(events: list, has_css: bool) -> list:
    kw_ts_cs, kw_ts_ci, kw_ts_ci_comment, removed_kw_ts_ci, upper_to_display, ci_occ_with_display = (
        reconstruct_tokens_from_keylog_full(events, has_css=has_css)
    )

    occ = []
    for upper in kw_ts_ci:
        occ_sorted = sorted(ci_occ_with_display.get(upper, []))
        comment_ts = set(kw_ts_ci_comment.get(upper, []))
        for ts, disp in occ_sorted:
            occ.append((ts, disp, ts in comment_ts, False))

    for upper, ts_list in removed_kw_ts_ci.items():
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
    has_css:            bool = True

    @classmethod
    def setUpClass(cls):
        cls.events = _load_events(cls.log_file)
        cls.headers, cls.expected = _parse_tokens_file(cls.tokens_file)
        cls.occ = _build_token_occurrences(cls.events, cls.has_css)
        _kw_ts_cs, cls.kw_ts_ci, *_ = reconstruct_tokens_from_keylog_full(cls.events, has_css=cls.has_css)

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
        self.assertEqual(len(self.kw_ts_ci), self.headers['Unique'])

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
        _sm._ALL_EXTRA_STAR = True
        _teacher_headers, cls.teacher_entries = _parse_tokens_file(cls.teacher_tokens_file)
        cls.headers, cls.raw_expected = _parse_student_tokens_file(cls.tokens_file)
        cls.removal_ts_by_token = {
            tok: removal_ts
            for tok, _, _, is_rem, removal_ts in cls.teacher_entries
            if is_rem and removal_ts
        }
        tokens_with_missing    = {tok for tok, _, fl in cls.raw_expected if fl == {'MISSING'}}
        tokens_with_extra_star = {tok for tok, _, fl in cls.raw_expected if fl == {'EXTRA*'}}
        steal_tokens = tokens_with_missing & tokens_with_extra_star
        teacher_occ = [ts for _, ts, _, is_rem, *_ in cls.teacher_entries if not is_rem]
        last_ts = teacher_occ[-1] if teacher_occ else '00:00:00'
        cls.expected = []
        for tok, ts, flags in cls.raw_expected:
            if tok in steal_tokens and flags == {'MISSING'}:
                cls.expected.append((tok, ts, set()))
            elif tok in steal_tokens and flags == {'EXTRA*'}:
                pass  # not in all_occ
            elif 'EXTRA*' in flags:
                cls.expected.append((tok, last_ts, flags - {'EXTRA*'} | {'EXTRA'}))
            else:
                cls.expected.append((tok, ts, flags))
        n_found_e   = sum(1 for _, _, fl in cls.expected if not fl)
        n_missing_e = sum(1 for _, _, fl in cls.expected if fl == {'MISSING'})
        teacher_total_e = n_found_e + n_missing_e
        cls.headers['Follow'] = round(n_found_e / teacher_total_e * 100, 1) if teacher_total_e else 0.0

        outside, comment = _extract_student_ci_split({cls.student_html.name: cls.student_html})
        cls.all_occ, cls.n_found, cls.n_missing, cls.n_extra, cls.follow_e, _ = (
            _build_student_token_occurrences(cls.teacher_entries, outside, comment)
        )

    @classmethod
    def tearDownClass(cls):
        _sm._ALL_EXTRA_STAR = False

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

    def test_extra_star_timestamps(self):
        """Each EXTRA* entry in the fixture must have the teacher's removal timestamp."""
        for tok, ts, flags in self.raw_expected:
            if flags == {'EXTRA*'}:
                expected_ts = self.removal_ts_by_token.get(tok)
                if expected_ts:
                    self.assertEqual(
                        ts, expected_ts,
                        f"EXTRA* token '{tok}' has ts {ts!r}, expected removal ts {expected_ts!r}",
                    )


class TestChessBoardReconstruction(_ReconstructionBase, unittest.TestCase):
    log_file           = _TEST / 'wall' / 'log.json'
    reconstructed_file = _TEST / 'wall' / 'reconstructed.html'
    tokens_file        = _TEST / 'wall' / 'tokens.txt'
    has_css            = True


class TestChessBoardStudentATokens(_StudentBase, unittest.TestCase):
    teacher_tokens_file = _TEST / 'wall' / 'tokens.txt'
    student_html        = _TEST / 'wall' / 'student_a' / 'index.html'
    tokens_file         = _TEST / 'wall' / 'student_a' / 'tokens.txt'


class TestChessBoardStudentBTokens(_StudentBase, unittest.TestCase):
    teacher_tokens_file = _TEST / 'wall' / 'tokens.txt'
    student_html        = _TEST / 'wall' / 'student_b' / 'index.html'
    tokens_file         = _TEST / 'wall' / 'student_b' / 'tokens.txt'


class TestChessBoardStudentCTokens(_StudentBase, unittest.TestCase):
    teacher_tokens_file = _TEST / 'wall' / 'tokens.txt'
    student_html        = _TEST / 'wall' / 'student_c' / 'index.html'
    tokens_file         = _TEST / 'wall' / 'student_c' / 'tokens.txt'


class TestChessBoardStudentCDiffMarks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.diff_marks = _load_json(_TEST / 'wall' / 'student_c' / 'diff_marks.json')
        cls.teacher_occs = cls.diff_marks['teacher_files'][
            next(iter(cls.diff_marks['teacher_files']))
        ]
        cls.student_occs = cls.diff_marks['student_files'][
            next(iter(cls.diff_marks['student_files']))
        ]

    def test_format_version(self):
        self.assertEqual(self.diff_marks.get('format_version'), 4)

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

    def test_student_extra_star_example(self):
        labels_400px = [o['label'] for o in self.student_occs if o['token'] == '400px']
        self.assertEqual(labels_400px, ['extra_star'])

    def test_student_div_comment_count(self):
        div_comment = [o for o in self.student_occs if o['token'] == 'div' and o['label'] == 'comment']
        self.assertEqual(len(div_comment), 2)

    def test_no_null_labels_in_fixture(self):
        # format v4 only stores colored (non-null) occurrences
        for occ in self.teacher_occs + self.student_occs:
            self.assertIsNotNone(occ.get('label'))


class TestChessGameReconstruction(_ReconstructionBase, unittest.TestCase):
    log_file           = _TEST / 'chess' / 'log.json'
    reconstructed_file = _TEST / 'chess' / 'reconstructed.html'
    tokens_file        = _TEST / 'chess' / 'tokens.txt'
    has_css            = True


class TestChessGameStudentATokens(_StudentBase, unittest.TestCase):
    teacher_tokens_file = _TEST / 'chess' / 'tokens.txt'
    student_html        = _TEST / 'chess' / 'student_a' / 'index.html'
    tokens_file         = _TEST / 'chess' / 'student_a' / 'tokens.txt'


class TestChessGameStudentBTokens(_StudentBase, unittest.TestCase):
    teacher_tokens_file = _TEST / 'chess' / 'tokens.txt'
    student_html        = _TEST / 'chess' / 'student_b' / 'index.html'
    tokens_file         = _TEST / 'chess' / 'student_b' / 'tokens.txt'


class TestChessGameStudentBDiffMarks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _sm._ALL_EXTRA_STAR = True
        chess = _TEST / 'chess'
        cls.events = _load_events(chess / 'log.json')
        teacher_entries = _parse_teacher_tokens(chess / 'tokens.txt')
        removed_keys = {tok for tok, _, _, is_rem, *_ in teacher_entries if is_rem}
        ghost_ctx = _build_ghost_contexts(cls.events, removed_keys, k=_GHOST_K)
        stu_files = {'index.html': chess / 'student_b' / 'index.html'}
        teacher_files = {'reconstructed.html': chess / 'reconstructed.html'}
        stu_outside, stu_comment = _extract_student_ci_split(stu_files)
        _, cls.sf_colors = _build_contextual_diff_marks(
            teacher_files, stu_files, teacher_entries,
            stu_outside, stu_comment, context_k=_CONTEXT_K, ghost_contexts=ghost_ctx,
        )
        cls.student_index = cls.sf_colors.get('index.html', {})

    @classmethod
    def tearDownClass(cls):
        _sm._ALL_EXTRA_STAR = False

    def test_this_is_extra_star(self):
        self.assertEqual(self.student_index.get('this'), ['extra_star'])

    def test_onclick_first_occurrence_is_extra_star(self):
        labels = self.student_index.get('onclick', [])
        self.assertGreaterEqual(len(labels), 1)
        self.assertEqual(labels[0], 'extra_star')

    def test_handleclick_first_occurrence_is_extra_star(self):
        labels = self.student_index.get('handleClick', [])
        self.assertGreaterEqual(len(labels), 1)
        self.assertEqual(labels[0], 'extra_star')


class TestJSStudentATokens(_StudentBase, unittest.TestCase):
    teacher_tokens_file = _TEST / 'js' / 'tokens.txt'
    student_html        = _TEST / 'js' / 'student_a' / 'index.html'
    tokens_file         = _TEST / 'js' / 'student_a' / 'tokens.txt'


class TestJSStudentBTokens(_StudentBase, unittest.TestCase):
    teacher_tokens_file = _TEST / 'js' / 'tokens.txt'
    student_html        = _TEST / 'js' / 'student_b' / 'index.html'
    tokens_file         = _TEST / 'js' / 'student_b' / 'tokens.txt'


class TestJSReconstruction(_ReconstructionBase, unittest.TestCase):
    log_file           = _TEST / 'js' / 'log.json'
    reconstructed_file = _TEST / 'js' / 'reconstructed.html'
    tokens_file        = _TEST / 'js' / 'tokens.txt'
    has_css            = True


class TestQRCodeReconstruction(_ReconstructionBase, unittest.TestCase):
    log_file           = _TEST / 'qr' / 'log.json'
    reconstructed_file = _TEST / 'qr' / 'reconstructed.html'
    tokens_file        = _TEST / 'qr' / 'tokens.txt'
    has_css            = True


class TestSortingReconstruction(_ReconstructionBase, unittest.TestCase):
    log_file           = _TEST / 'sorting' / 'log.json'
    reconstructed_file = _TEST / 'sorting' / 'reconstructed.html'
    tokens_file        = _TEST / 'sorting' / 'tokens.txt'
    has_css            = True


class TestSortingStudentATokens(_StudentBase, unittest.TestCase):
    teacher_tokens_file = _TEST / 'sorting' / 'tokens.txt'
    student_html        = _TEST / 'sorting' / 'student_a' / 'index.html'
    tokens_file         = _TEST / 'sorting' / 'student_a' / 'tokens.txt'


class TestChessGameStudentCDiffMarks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        chess = _TEST / 'chess'
        cls.events = _load_events(chess / 'log.json')
        teacher_entries = _parse_teacher_tokens(chess / 'tokens.txt')
        removed_keys = {tok for tok, _, _, is_rem, *_ in teacher_entries if is_rem}
        ghost_ctx = _build_ghost_contexts(cls.events, removed_keys, k=_GHOST_K)
        stu_files = {'index.html': chess / 'student_c' / 'index.html'}
        teacher_files = {'reconstructed.html': chess / 'reconstructed.html'}
        stu_outside, stu_comment = _extract_student_ci_split(stu_files)
        _, cls.sf_colors = _build_contextual_diff_marks(
            teacher_files, stu_files, teacher_entries,
            stu_outside, stu_comment, context_k=_CONTEXT_K, ghost_contexts=ghost_ctx,
        )
        cls.student_index = cls.sf_colors.get('index.html', {})

    def test_element_extra_occurrence_is_plain_extra(self):
        labels = self.student_index.get('element', [])
        self.assertGreaterEqual(len(labels), 6)
        self.assertEqual(labels[5], 'extra')

    def test_element_extra_occurrence_is_not_extra_star(self):
        labels = self.student_index.get('element', [])
        self.assertGreaterEqual(len(labels), 6)
        self.assertNotEqual(labels[5], 'extra_star')


class TestChessGameStudentETokens(_StudentBase, unittest.TestCase):
    teacher_tokens_file = _TEST / 'chess' / 'tokens.txt'
    student_html        = _TEST / 'chess' / 'student_e' / 'index.html'
    tokens_file         = _TEST / 'chess' / 'student_e' / 'tokens.txt'


class TestChessGameStudentEDiffMarks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _sm._ALL_EXTRA_STAR = True
        chess = _TEST / 'chess'
        cls.events = _load_events(chess / 'log.json')
        teacher_entries = _parse_teacher_tokens(chess / 'tokens.txt')
        removed_keys = {tok for tok, _, _, is_rem, *_ in teacher_entries if is_rem}
        ghost_ctx = _build_ghost_contexts(cls.events, removed_keys, k=_GHOST_K)
        stu_files = {'index.html': chess / 'student_e' / 'index.html'}
        teacher_files = {'reconstructed.html': chess / 'reconstructed.html'}
        stu_outside, stu_comment = _extract_student_ci_split(stu_files)
        cls.tf_colors, cls.sf_colors = _build_contextual_diff_marks(
            teacher_files, stu_files, teacher_entries,
            stu_outside, stu_comment, context_k=_CONTEXT_K, ghost_contexts=ghost_ctx,
        )
        cls.student_index = cls.sf_colors.get('index.html', {})
        cls.teacher_index = cls.tf_colors.get('reconstructed.html', {})

    @classmethod
    def tearDownClass(cls):
        _sm._ALL_EXTRA_STAR = False

    def test_height_is_extra(self):
        self.assertEqual(self.student_index.get('height'), ['extra'])

    def test_50px_first_two_are_extra(self):
        labels = self.student_index.get('50px', [])
        self.assertGreaterEqual(len(labels), 2)
        self.assertEqual(labels[0], 'extra')
        self.assertEqual(labels[1], 'extra')

    def test_board_is_extra(self):
        labels = self.student_index.get('Board', [])
        self.assertGreaterEqual(len(labels), 1)
        self.assertEqual(labels[0], 'extra')

    def test_comment_tokens_are_comment(self):
        for tok in ('styling', 'by', 'ID'):
            labels = self.student_index.get(tok, [])
            self.assertTrue(labels, f'expected at least one occurrence of {tok!r}')
            self.assertTrue(all(l == 'comment' for l in labels),
                            f'{tok!r} labels: {labels}')

    def test_script_is_missing_from_teacher(self):
        labels = self.teacher_index.get('<script', [])
        self.assertGreaterEqual(len(labels), 1)
        self.assertEqual(labels[0], 'missing')

    def test_handleclick_is_missing_from_teacher(self):
        labels = self.teacher_index.get('handleClick', [])
        self.assertGreaterEqual(len(labels), 1)
        self.assertEqual(labels[0], 'missing')


class TestChessGameStudentFTokens(_StudentBase, unittest.TestCase):
    teacher_tokens_file = _TEST / 'chess' / 'tokens.txt'
    student_html        = _TEST / 'chess' / 'student_f' / 'index.html'
    tokens_file         = _TEST / 'chess' / 'student_f' / 'tokens.txt'


class TestChessGameStudentFDiffMarks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _sm._ALL_EXTRA_STAR = True
        chess = _TEST / 'chess'
        cls.events = _load_events(chess / 'log.json')
        teacher_entries = _parse_teacher_tokens(chess / 'tokens.txt')
        removed_keys = {tok for tok, _, _, is_rem, *_ in teacher_entries if is_rem}
        ghost_ctx = _build_ghost_contexts(cls.events, removed_keys, k=_GHOST_K)
        stu_files = {'index.html': chess / 'student_f' / 'index.html'}
        teacher_files = {'reconstructed.html': chess / 'reconstructed.html'}
        stu_outside, stu_comment = _extract_student_ci_split(stu_files)
        cls.tf_colors, cls.sf_colors = _build_contextual_diff_marks(
            teacher_files, stu_files, teacher_entries,
            stu_outside, stu_comment, context_k=_CONTEXT_K, ghost_contexts=ghost_ctx,
        )
        cls.student_index = cls.sf_colors.get('index.html', {})
        cls.teacher_index = cls.tf_colors.get('reconstructed.html', {})

    @classmethod
    def tearDownClass(cls):
        _sm._ALL_EXTRA_STAR = False

    def test_onclick_is_extra_star(self):
        labels = self.student_index.get('onclick', [])
        self.assertGreaterEqual(len(labels), 1)
        self.assertEqual(labels[0], 'extra_star')

    def test_onclick_is_missing_from_teacher(self):
        labels = self.teacher_index.get('onclick', [])
        self.assertGreaterEqual(len(labels), 1)
        self.assertEqual(labels[0], 'missing')

    def test_handleclick_is_extra_star(self):
        labels = self.student_index.get('handleClick', [])
        self.assertGreaterEqual(len(labels), 1)
        self.assertEqual(labels[0], 'extra_star')


class TestSortingStudentBDiffMarks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _sm._ALL_EXTRA_STAR = True
        sorting = _TEST / 'sorting'
        cls.events = _load_events(sorting / 'log.json')
        teacher_entries = _parse_teacher_tokens(sorting / 'tokens.txt')
        removed_keys = {tok for tok, _, _, is_rem, *_ in teacher_entries if is_rem}
        ghost_ctx = _build_ghost_contexts(cls.events, removed_keys, k=_GHOST_K)
        stu_files = {'index.html': sorting / 'student_b' / 'index.html'}
        teacher_files = {'reconstructed.html': sorting / 'reconstructed.html'}
        stu_outside, stu_comment = _extract_student_ci_split(stu_files)
        cls.tf_colors, cls.sf_colors = _build_contextual_diff_marks(
            teacher_files, stu_files, teacher_entries,
            stu_outside, stu_comment, context_k=_CONTEXT_K, ghost_contexts=ghost_ctx,
        )
        cls.student_index = cls.sf_colors.get('index.html', {})
        cls.teacher_index = cls.tf_colors.get('reconstructed.html', {})

    @classmethod
    def tearDownClass(cls):
        _sm._ALL_EXTRA_STAR = False

    def test_width_first_occurrence_is_extra_star(self):
        labels = self.student_index.get('width', [])
        self.assertGreaterEqual(len(labels), 1)
        self.assertEqual(labels[0], 'extra_star')

    def test_width_second_occurrence_is_matched(self):
        labels = self.student_index.get('width', [])
        self.assertGreaterEqual(len(labels), 2)
        self.assertIsNone(labels[1])

    def test_200px_first_occurrence_is_extra_star(self):
        labels = self.student_index.get('200px', [])
        self.assertGreaterEqual(len(labels), 1)
        self.assertEqual(labels[0], 'extra_star')

    def test_200px_second_occurrence_is_matched(self):
        labels = self.student_index.get('200px', [])
        self.assertGreaterEqual(len(labels), 2)
        self.assertIsNone(labels[1])

    def test_background_color_student_is_extra_star(self):
        labels = self.student_index.get('background-color', [])
        self.assertGreaterEqual(len(labels), 1)
        self.assertEqual(labels[0], 'extra_star')

    def test_red_is_extra_star(self):
        self.assertEqual(self.student_index.get('red'), ['extra_star'])

    def test_background_color_teacher_is_missing(self):
        labels = self.teacher_index.get('background-color', [])
        self.assertGreaterEqual(len(labels), 1)
        self.assertEqual(labels[0], 'missing')

    def test_function_updatebars_is_missing(self):
        labels = self.teacher_index.get('function', [])
        self.assertGreaterEqual(len(labels), 1)
        self.assertEqual(labels[0], 'missing')

    def test_function_bubblesort_is_matched(self):
        labels = self.teacher_index.get('function', [])
        self.assertGreaterEqual(len(labels), 2)
        self.assertIsNone(labels[1])

    def test_async_is_missing(self):
        self.assertEqual(self.teacher_index.get('async'), ['missing'])


if __name__ == '__main__':
    unittest.main()
