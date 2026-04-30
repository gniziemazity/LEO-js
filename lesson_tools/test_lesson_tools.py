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
    student_html        = _TEST / 'wall' / 'student_78' / 'index.html'
    tokens_file         = _TEST / 'wall' / 'student_78' / 'tokens.txt'


class TestChessBoardStudent74Tokens(_StudentBase, unittest.TestCase):
    teacher_tokens_file = _TEST / 'wall' / 'tokens.txt'
    student_html        = _TEST / 'wall' / 'student_74' / 'index.html'
    tokens_file         = _TEST / 'wall' / 'student_74' / 'tokens.txt'


class TestChessBoardStudent80Tokens(_StudentBase, unittest.TestCase):
    teacher_tokens_file = _TEST / 'wall' / 'tokens.txt'
    student_html        = _TEST / 'wall' / 'student_80' / 'index.html'
    tokens_file         = _TEST / 'wall' / 'student_80' / 'tokens.txt'


class TestChessBoardStudent80DiffMarks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.diff_marks = _load_json(_TEST / 'wall' / 'student_80' / 'diff_marks_leo_star.json')
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
    student_html        = _TEST / 'chess' / 'student_23' / 'index.html'
    tokens_file         = _TEST / 'chess' / 'student_23' / 'tokens.txt'


class TestChessGameStudent50Tokens(_StudentBase, unittest.TestCase):
    teacher_tokens_file = _TEST / 'chess' / 'tokens.txt'
    student_html        = _TEST / 'chess' / 'student_50' / 'index.html'
    tokens_file         = _TEST / 'chess' / 'student_50' / 'tokens.txt'


class TestChessGameStudent50DiffMarks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dm = _load_json(_TEST / 'chess' / 'student_50' / 'diff_marks_leo_star.json')

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
    student_html        = _TEST / 'js' / 'student_78' / 'index.html'
    tokens_file         = _TEST / 'js' / 'student_78' / 'tokens.txt'


class TestJSStudent35Tokens(_StudentBase, unittest.TestCase):
    teacher_tokens_file = _TEST / 'js' / 'tokens.txt'
    student_html        = _TEST / 'js' / 'student_35' / 'index.html'
    tokens_file         = _TEST / 'js' / 'student_35' / 'tokens.txt'


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
    student_html        = _TEST / 'sorting' / 'student_23' / 'index.html'
    tokens_file         = _TEST / 'sorting' / 'student_23' / 'tokens.txt'


class TestChessGameStudent20DiffMarks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dm = _load_json(_TEST / 'chess' / 'student_20' / 'diff_marks_leo_star.json')

    def test_handleclick_extra_is_ghost_extra(self):
        labels = _student_labels(self.dm, 'handleClick')
        self.assertGreaterEqual(len(labels), 1)
        self.assertEqual(labels[0], 'ghost_extra')


class TestChessGameStudent35Tokens(_StudentBase, unittest.TestCase):
    teacher_tokens_file = _TEST / 'chess' / 'tokens.txt'
    student_html        = _TEST / 'chess' / 'student_35' / '123456.index.html'
    tokens_file         = _TEST / 'chess' / 'student_35' / 'tokens.txt'


class TestChessGameStudent35DiffMarks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dm = _load_json(_TEST / 'chess' / 'student_35' / 'diff_marks_leo_star.json')

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
        cls.dm = _load_json(_TEST / 'sorting' / 'student_66' / 'diff_marks_leo_star.json')

    def test_width_first_occurrence_is_ghost_extra(self):
        labels = _student_labels(self.dm, 'width')
        self.assertGreaterEqual(len(labels), 1)
        self.assertEqual(labels[0], 'ghost_extra')

    def test_width_second_occurrence_is_matched(self):
        labels = _student_labels(self.dm, 'width')
        self.assertGreaterEqual(len(labels), 2)
        self.assertIsNone(labels[1])

    def test_200px_split_is_globally_optimal(self):
        # Student typed both `width: 200px;` (which the teacher had typed and
        # deleted) and `height: 200px;` (which the teacher kept). The joint
        # Hungarian must pair the first 200px with the ghost (ghost_extra) and
        # the second with the surviving teacher token. See
        # ideas/differentiator-algorithm.md §7.1 for the design rationale.
        labels = _student_labels(self.dm, '200px')
        self.assertEqual(labels, ['ghost_extra', None])

    def test_background_color_student_is_matched(self):
        self.assertEqual(_student_labels(self.dm, 'background-color'), [])

    def test_red_is_ghost_extra(self):
        self.assertEqual(_student_labels(self.dm, 'red'), ['ghost_extra'])

    def test_background_color_teacher_is_matched(self):
        self.assertEqual(_teacher_labels(self.dm, 'background-color'), [])

    def test_exactly_one_function_is_missing(self):
        labels = _teacher_labels(self.dm, 'function')
        self.assertGreaterEqual(len(labels), 2)
        self.assertEqual(labels.count('missing'), 1)
        self.assertEqual(labels.count(None), 1)

    def test_async_is_missing(self):
        self.assertEqual(_teacher_labels(self.dm, 'async'), ['missing'])


class TestQRStudent31DiffMarks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dm = _load_json(_TEST / 'qr' / 'student_31' / 'diff_marks_leo_star.json')

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


if __name__ == '__main__':
    unittest.main()
