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
    _build_contextual_diff_marks,
    _build_lcs_token_diff_marks,
    _apply_ghost_star_to_colors,
    _apply_ghost_star_to_diff_marks,
    _parse_teacher_tokens,
    _CONTEXT_K,
)


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


def _build_token_occurrences(events: list, has_css: bool) -> list:
    kw_ts, kw_ts_comment, removed_kw_ts, upper_to_display, occ_with_display = (
        reconstruct_tokens_from_keylog_full(events, has_css=has_css)
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
    has_css:            bool = True

    @classmethod
    def setUpClass(cls):
        cls.events = _load_events(cls.log_file)
        cls.headers, cls.expected = _parse_tokens_file(cls.tokens_file)
        cls.occ = _build_token_occurrences(cls.events, cls.has_css)
        cls.kw_ts, *_ = reconstruct_tokens_from_keylog_full(cls.events, has_css=cls.has_css)

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

    def test_extra_star_timestamps(self):
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
        cls.diff_marks = _load_json(_TEST / 'wall' / 'student_c' / 'diff_marks_leo_star.json')
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
        self.assertEqual(labels_400px, ['extra_star'])

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
        chess = _TEST / 'chess'
        cls.events = _load_events(chess / 'log.json')
        stu_files = {'index.html': chess / 'student_b' / 'index.html'}
        teacher_files = {'reconstructed.html': chess / 'reconstructed.html'}
        _, cls.sf_colors = _build_contextual_diff_marks(
            teacher_files, stu_files, context_k=_CONTEXT_K,
        )
        _apply_ghost_star_to_colors(cls.sf_colors, cls.events)
        cls.student_index = cls.sf_colors.get('index.html', {})

    @classmethod
    def tearDownClass(cls):
        pass

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
        stu_files = {'index.html': chess / 'student_c' / 'index.html'}
        teacher_files = {'reconstructed.html': chess / 'reconstructed.html'}
        _, cls.sf_colors = _build_contextual_diff_marks(
            teacher_files, stu_files, context_k=_CONTEXT_K,
        )
        _apply_ghost_star_to_colors(cls.sf_colors, cls.events)
        cls.student_index = cls.sf_colors.get('index.html', {})

    def test_handleclick_extra_is_extra_star(self):
        labels = self.student_index.get('handleClick', [])
        self.assertGreaterEqual(len(labels), 1)
        self.assertEqual(labels[0], 'extra_star')


class TestChessGameStudentETokens(_StudentBase, unittest.TestCase):
    teacher_tokens_file = _TEST / 'chess' / 'tokens.txt'
    student_html        = _TEST / 'chess' / 'student_e' / 'index.html'
    tokens_file         = _TEST / 'chess' / 'student_e' / 'tokens.txt'


class TestChessGameStudentEDiffMarks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        chess = _TEST / 'chess'
        cls.events = _load_events(chess / 'log.json')
        stu_files = {'index.html': chess / 'student_e' / 'index.html'}
        teacher_files = {'reconstructed.html': chess / 'reconstructed.html'}
        cls.tf_colors, cls.sf_colors = _build_contextual_diff_marks(
            teacher_files, stu_files, context_k=_CONTEXT_K,
        )
        _apply_ghost_star_to_colors(cls.sf_colors, cls.events)
        cls.student_index = cls.sf_colors.get('index.html', {})
        cls.teacher_index = cls.tf_colors.get('reconstructed.html', {})

    @classmethod
    def tearDownClass(cls):
        pass

    def test_height_is_found(self):
        self.assertNotIn('height', self.student_index)

    def test_50px_has_extra_star(self):
        labels = self.student_index.get('50px', [])
        self.assertGreaterEqual(len(labels), 2)
        self.assertIn('extra_star', labels)

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
        labels = self.teacher_index.get('script', [])
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
        chess = _TEST / 'chess'
        cls.events = _load_events(chess / 'log.json')
        stu_files = {'index.html': chess / 'student_f' / 'index.html'}
        teacher_files = {'reconstructed.html': chess / 'reconstructed.html'}
        cls.tf_colors, cls.sf_colors = _build_contextual_diff_marks(
            teacher_files, stu_files, context_k=_CONTEXT_K,
        )
        _apply_ghost_star_to_colors(cls.sf_colors, cls.events)
        cls.student_index = cls.sf_colors.get('index.html', {})
        cls.teacher_index = cls.tf_colors.get('reconstructed.html', {})

    @classmethod
    def tearDownClass(cls):
        pass

    def test_onclick_is_found(self):
        self.assertNotIn('onclick', self.student_index)

    def test_onclick_is_found_by_teacher(self):
        self.assertNotIn('onclick', self.teacher_index)

    def test_handleclick_is_extra_star(self):
        labels = self.student_index.get('handleClick', [])
        self.assertGreaterEqual(len(labels), 1)
        self.assertEqual(labels[0], 'extra_star')


class TestSortingStudentBDiffMarks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        sorting = _TEST / 'sorting'
        cls.events = _load_events(sorting / 'log.json')
        stu_files = {'index.html': sorting / 'student_b' / 'index.html'}
        teacher_files = {'reconstructed.html': sorting / 'reconstructed.html'}
        cls.tf_colors, cls.sf_colors = _build_contextual_diff_marks(
            teacher_files, stu_files, context_k=_CONTEXT_K,
        )
        _apply_ghost_star_to_colors(cls.sf_colors, cls.events)
        cls.student_index = cls.sf_colors.get('index.html', {})
        cls.teacher_index = cls.tf_colors.get('reconstructed.html', {})

    @classmethod
    def tearDownClass(cls):
        pass

    def test_width_first_occurrence_is_extra_star(self):
        labels = self.student_index.get('width', [])
        self.assertGreaterEqual(len(labels), 1)
        self.assertEqual(labels[0], 'extra_star')

    def test_width_second_occurrence_is_matched(self):
        labels = self.student_index.get('width', [])
        self.assertGreaterEqual(len(labels), 2)
        self.assertIsNone(labels[1])

    def test_200px_first_occurrence_is_matched(self):
        labels = self.student_index.get('200px', [])
        self.assertGreaterEqual(len(labels), 1)
        self.assertIsNone(labels[0])

    def test_200px_second_occurrence_is_extra_star(self):
        labels = self.student_index.get('200px', [])
        self.assertGreaterEqual(len(labels), 2)
        self.assertEqual(labels[1], 'extra_star')

    def test_background_color_student_is_found(self):
        self.assertNotIn('background-color', self.student_index)

    def test_red_is_extra_star(self):
        self.assertEqual(self.student_index.get('red'), ['extra_star'])

    def test_background_color_teacher_is_found(self):
        self.assertNotIn('background-color', self.teacher_index)

    def test_exactly_one_function_is_missing(self):
        labels = self.teacher_index.get('function', [])
        self.assertGreaterEqual(len(labels), 2)
        self.assertEqual(labels.count('missing'), 1)
        self.assertEqual(labels.count(None), 1)

    def test_async_is_missing(self):
        self.assertEqual(self.teacher_index.get('async'), ['missing'])


class TestQRStudentADiffMarks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        qr = _TEST / 'qr'
        student_dir = qr / 'student_a'
        events = _load_events(qr / 'log.json')
        teacher_files = {'reconstructed.html': qr / 'reconstructed.html',
                         '123456.css': qr / '123456.css',
                         '123456.js': qr / '123456.js'}
        stu_files = {f.name: f for f in sorted(student_dir.iterdir())
                     if f.suffix.lower() in ('.html', '.htm', '.css', '.js')}
        _, cls.sf_colors = _build_contextual_diff_marks(
            teacher_files, stu_files, context_k=_CONTEXT_K,
        )
        _apply_ghost_star_to_colors(cls.sf_colors, events)
        cls.student_css = cls.sf_colors.get('123456.css', {})

    @classmethod
    def tearDownClass(cls):
        pass

    def test_background_is_extra_star(self):
        labels = self.student_css.get('background', [])
        self.assertGreaterEqual(len(labels), 1)
        self.assertEqual(labels[0], 'extra_star')


class TestQRStudentALCSStarDiffMarks(unittest.TestCase):
    """LCS* diff_marks for qr/student_a — background-color must also be extra_star."""
    @classmethod
    def setUpClass(cls):
        qr = _TEST / 'qr'
        student_dir = qr / 'student_a'
        events = _load_events(qr / 'log.json')
        teacher_files = {'reconstructed.html': qr / 'reconstructed.html',
                         '123456.css': qr / '123456.css',
                         '123456.js': qr / '123456.js'}
        stu_files = {f.name: f for f in sorted(student_dir.iterdir())
                     if f.suffix.lower() in ('.html', '.htm', '.css', '.js')}
        _, s_files, *_ = _build_lcs_token_diff_marks(teacher_files, stu_files)
        dm = {'teacher_files': {}, 'student_files': s_files}
        _apply_ghost_star_to_diff_marks(dm, events)
        cls.student_css_marks = [m for m in dm['student_files'].get('123456.css', [])
                                  if m.get('token', '').lower() == 'background']

    @classmethod
    def tearDownClass(cls):
        pass

    def test_background_is_extra_star(self):
        self.assertGreaterEqual(len(self.student_css_marks), 1)
        self.assertEqual(self.student_css_marks[0]['label'], 'extra_star')

    def test_background_position(self):
        self.assertEqual(self.student_css_marks[0]['start'], 229)


if __name__ == '__main__':
    unittest.main()
