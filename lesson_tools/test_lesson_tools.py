import json
import random
import tempfile
import unittest
from collections import Counter
from pathlib import Path
from typing import Dict, List, Set, Tuple

_ROOT = Path(__file__).resolve().parent
_TEST = _ROOT / 'test' / 'lessons'

from utils import similarity_measures as _sm
from utils.folder_utils import LANG_EXTS
from utils.lv_editor import reconstruct_html_headless
from utils.similarity_measures import (
    reconstruct_tokens_from_keylog_full,
)
from utils.token_log import (
    _apply_star_post_pass,
    _apply_insert_at_to_unpaired_missings,
    _assemble_diff_marks,
    _build_git_diff_marks,
    _build_lcs_token_diff_marks,
    _build_leo_diff_marks,
    _CONTEXT_MATCH_THRESHOLD,
    _parse_teacher_tokens,
    _read_text_normalized,
    _remap_marks_to_utf16,
    _split_tokens_by_comment,
    _strip_internal_fields,
    _structural_diff_summary,
    _structural_form,
    _SWAP_TOKEN_SIM_WEIGHT,
    _validate_curated_schema,
)
from utils.token_log_leo import _split_real_and_ghost_assignments
from utils.token_log_starpass import _swap_pair_score


def _load_events(log_path: Path) -> list:
    with open(log_path, encoding='utf-8') as f:
        return json.load(f)['events']


def _load_json(path: Path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


class TestStarPassHelpers(unittest.TestCase):
    def test_swap_pair_score_identical_tokens_full_bonus(self):
        self.assertAlmostEqual(
            _swap_pair_score('border', 'border', 0.5),
            0.5 + _SWAP_TOKEN_SIM_WEIGHT,
        )

    def test_swap_pair_score_disjoint_tokens_no_bonus(self):
        self.assertAlmostEqual(_swap_pair_score('a', 'b', 0.5), 0.5)

    def test_swap_pair_score_typo_partial_bonus(self):
        score = _swap_pair_score('border', 'boder', 0.5)
        self.assertGreater(score, 0.5)
        self.assertLess(score, 0.5 + _SWAP_TOKEN_SIM_WEIGHT)

    def test_split_assignments_real_vs_ghost(self):
        pairs = [(0, 0), (1, 2), (2, 3)]
        sim = [
            [0.0, 0.0, 0.0, 0.0],
            [0.0, 0.0, _CONTEXT_MATCH_THRESHOLD, 0.0],
            [0.0, 0.0, 0.0, _CONTEXT_MATCH_THRESHOLD - 0.1],
        ]
        real, ghost = _split_real_and_ghost_assignments(pairs, 2, sim)
        self.assertEqual(real, [(0, 0)])
        self.assertEqual(ghost, [(1, 0)])

    def test_split_assignments_empty_matrix_drops_ghost(self):
        real, ghost = _split_real_and_ghost_assignments([(0, 2)], 2, [])
        self.assertEqual(real, [])
        self.assertEqual(ghost, [])


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
    from datetime import datetime
    try:
        from utils.lv_constants import FINLAND_TZ
        if FINLAND_TZ is not None:
            dt = datetime.fromtimestamp(ts_ms / 1000, tz=FINLAND_TZ)
            return dt.strftime('%H:%M:%S') + f'.{dt.microsecond // 1000:03d}'
    except Exception:
        pass
    dt = datetime.fromtimestamp(ts_ms / 1000)
    return dt.strftime('%H:%M:%S') + f'.{dt.microsecond // 1000:03d}'


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


class TestWallReconstruction(_ReconstructionBase, unittest.TestCase):
    log_file           = _TEST / 'wall' / 'log.json'
    reconstructed_file = _TEST / 'wall' / 'reconstructed.html'
    tokens_file        = _TEST / 'wall' / 'tokens.txt'


class TestWallStudent78Tokens(_StudentBase, unittest.TestCase):
    teacher_tokens_file = _TEST / 'wall' / 'tokens.txt'
    student_html        = _TEST / 'wall' / '78' / 'index.html'
    tokens_file         = _TEST / 'wall' / '78' / 'tokens.txt'


class TestWallStudent74Tokens(_StudentBase, unittest.TestCase):
    teacher_tokens_file = _TEST / 'wall' / 'tokens.txt'
    student_html        = _TEST / 'wall' / '74' / 'index.html'
    tokens_file         = _TEST / 'wall' / '74' / 'tokens.txt'


class TestWallStudent80Tokens(_StudentBase, unittest.TestCase):
    teacher_tokens_file = _TEST / 'wall' / 'tokens.txt'
    student_html        = _TEST / 'wall' / '80' / 'index.html'
    tokens_file         = _TEST / 'wall' / '80' / 'tokens.txt'


class TestChessReconstruction(_ReconstructionBase, unittest.TestCase):
    log_file           = _TEST / 'chess' / 'log.json'
    reconstructed_file = _TEST / 'chess' / 'reconstructed.html'
    tokens_file        = _TEST / 'chess' / 'tokens.txt'


class TestChessStudent23Tokens(_StudentBase, unittest.TestCase):
    teacher_tokens_file = _TEST / 'chess' / 'tokens.txt'
    student_html        = _TEST / 'chess' / '23' / 'index.html'
    tokens_file         = _TEST / 'chess' / '23' / 'tokens.txt'


class TestChessStudent50Tokens(_StudentBase, unittest.TestCase):
    teacher_tokens_file = _TEST / 'chess' / 'tokens.txt'
    student_html        = _TEST / 'chess' / '50' / 'index.html'
    tokens_file         = _TEST / 'chess' / '50' / 'tokens.txt'


class TestJSStudent78Tokens(_StudentBase, unittest.TestCase):
    teacher_tokens_file = _TEST / 'gallery' / 'tokens.txt'
    student_html        = _TEST / 'gallery' / '78' / 'index.html'
    tokens_file         = _TEST / 'gallery' / '78' / 'tokens.txt'


class TestJSStudent35Tokens(_StudentBase, unittest.TestCase):
    teacher_tokens_file = _TEST / 'gallery' / 'tokens.txt'
    student_html        = _TEST / 'gallery' / '35' / 'index.html'
    tokens_file         = _TEST / 'gallery' / '35' / 'tokens.txt'


class TestJSReconstruction(_ReconstructionBase, unittest.TestCase):
    log_file           = _TEST / 'gallery' / 'log.json'
    reconstructed_file = _TEST / 'gallery' / 'reconstructed.html'
    tokens_file        = _TEST / 'gallery' / 'tokens.txt'


class TestQRReconstruction(_ReconstructionBase, unittest.TestCase):
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


class TestChessStudent35Tokens(_StudentBase, unittest.TestCase):
    teacher_tokens_file = _TEST / 'chess' / 'tokens.txt'
    student_html        = _TEST / 'chess' / '35' / '123456.index.html'
    tokens_file         = _TEST / 'chess' / '35' / 'tokens.txt'


def _shuffle_non_comment_tokens(text: str, seed: int) -> str:
    nc, _ = _split_tokens_by_comment(text)
    if len(nc) <= 1:
        return text
    new_texts = [tok for _, tok in nc]
    random.Random(seed).shuffle(new_texts)
    return '\n'.join(new_texts)


def _to_utf16_units(s: str):
    out = []
    for ch in s:
        o = ord(ch)
        if o > 0xFFFF:
            o -= 0x10000
            out.extend((0xD800 + (o >> 10), 0xDC00 + (o & 0x3FF)))
        else:
            out.append(o)
    return out


class TestUtf16OffsetRemap(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        root = Path(cls._tmp.name)
        t = root / 'teacher'; t.mkdir()
        s = root / 'student'; s.mkdir()
        teacher_src = (
            'const moto = "\U0001F3CD️";\n'
            'const count = 50;\n'
            'let speed = slider.value;\n'
        )
        student_src = (
            'const moto = "\U0001F3CD️";\n'
            'const count = 100;\n'
            'let velocity = box.value;\n'
        )
        (t / 'script.js').write_text(teacher_src, encoding='utf-8')
        (s / 'script.js').write_text(student_src, encoding='utf-8')
        cls.tf = {'script.js': t / 'script.js'}
        cls.sf = {'script.js': s / 'script.js'}

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def _count_mis_sliced(self, diff_marks):
        bad = 0
        for files, side in ((self.tf, 'teacher_files'), (self.sf, 'student_files')):
            for fname, marks in (diff_marks.get(side) or {}).items():
                units = _to_utf16_units(_read_text_normalized(files[fname]))
                for m in marks or []:
                    if units[m['start']:m['end']] != _to_utf16_units(m['token']):
                        bad += 1
        return bad

    def _build(self, build_fn):
        res = build_fn(self.tf, self.sf)
        tmarks, smarks, score = res[0], res[1], res[2]
        aligns = res[3] if len(res) > 3 else None
        lmarks = res[4] if len(res) > 4 else None
        dm = _assemble_diff_marks('m', tmarks, smarks, score,
                                  alignments=aligns, line_marks=lmarks)
        _apply_insert_at_to_unpaired_missings(
            dm.get('teacher_files', {}), dm.get('student_files', {}),
            self.tf, self.sf,
        )
        _strip_internal_fields(dm)
        return dm

    def test_codepoint_offsets_break_then_remap_fixes(self):
        for fn, name in ((_build_git_diff_marks, 'git'),
                         (_build_lcs_token_diff_marks, 'lcs')):
            with self.subTest(method=name):
                dm = self._build(fn)
                self.assertGreater(
                    self._count_mis_sliced(dm), 0,
                    f'{name}: expected raw code-point offsets to mis-slice '
                    'past the emoji (test would be meaningless otherwise)',
                )
                _remap_marks_to_utf16(dm, self.tf, self.sf)
                self.assertEqual(
                    self._count_mis_sliced(dm), 0,
                    f'{name}: remap should make every mark slice correctly '
                    'in UTF-16 space',
                )

    def test_leo_already_utf16(self):
        res = _build_leo_diff_marks(self.tf, self.sf)
        dm = _assemble_diff_marks('leo_star', res[0], res[1], res[2])
        _strip_internal_fields(dm)
        self.assertEqual(
            self._count_mis_sliced(dm), 0,
            'LEO already emits UTF-16 offsets (via _colors_to_position_marks)',
        )


class TestEffectiveReferenceDir(unittest.TestCase):
    def _checker(self, root: Path):
        from utils.sim_check import CodeSimilarityChecker
        c = CodeSimilarityChecker.__new__(CodeSimilarityChecker)
        c.reference_dir = root / 'correct'
        sd = root / 'start'
        c.start_dir = sd if sd.exists() else None
        c._lesson_all_events = []
        return c

    def test_prefers_start_when_present(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / 'correct').mkdir(); (root / 'start').mkdir()
            (root / 'correct' / 'index.html').write_text('<p>correct</p>', encoding='utf-8')
            (root / 'start' / 'index.html').write_text('<p>start</p>', encoding='utf-8')
            self.assertEqual(self._checker(root)._effective_reference_dir().name, 'start')

    def test_prefers_start_even_with_keylog(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / 'correct').mkdir(); (root / 'start').mkdir()
            (root / 'correct' / 'index.html').write_text('x', encoding='utf-8')
            (root / 'start' / 'index.html').write_text('y', encoding='utf-8')
            c = self._checker(root)
            c._lesson_all_events = [{'timestamp': 1}]
            self.assertEqual(c._effective_reference_dir().name, 'start')

    def test_falls_back_to_correct_when_no_start(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / 'correct').mkdir()
            (root / 'correct' / 'index.html').write_text('x', encoding='utf-8')
            self.assertEqual(self._checker(root)._effective_reference_dir().name, 'correct')

    def test_falls_back_to_correct_when_start_has_no_code(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / 'correct').mkdir(); (root / 'start').mkdir()
            (root / 'correct' / 'index.html').write_text('x', encoding='utf-8')
            (root / 'start' / 'notes.txt').write_text('not code', encoding='utf-8')
            self.assertEqual(self._checker(root)._effective_reference_dir().name, 'correct')


class TestAssignmentCommentColumn(unittest.TestCase):
    def _checker(self):
        from utils.sim_check import CodeSimilarityChecker
        c = CodeSimilarityChecker.__new__(CodeSimilarityChecker)
        c.required_items = []
        c.not_expected_items = []
        return c

    def test_assignment_remarks_include_sim_c_columns(self):
        cols = self._checker()._remarks_columns(is_assignment=True, present_lang_exts=[])
        by_key = {col.key: col for col in cols}
        self.assertEqual(by_key['sim_c'].header, 'Sim (C)')
        self.assertEqual(by_key['sim_c_t'].header, 'Sim (C) Desc')
        self.assertFalse(by_key['sim_c'].hidden)
        self.assertTrue(by_key['sim_c_t'].hidden)
        keys = [col.key for col in cols]
        self.assertEqual(keys.index('sim_c'), keys.index('sim_t') + 1)

    def test_lesson_remarks_have_no_sim_c(self):
        keys = [col.key for col in self._checker()._remarks_columns(False, [])]
        self.assertNotIn('sim_c', keys)
        self.assertNotIn('sim_c_t', keys)

    def test_per_basis_comment_info_extra_minus_teacher(self):
        marks = {
            'teacher_files': {'a.js': [
                {'label': 'comment', 'token': 'hello'},
                {'label': 'comment', 'token': 'world'},
                {'label': 'missing', 'token': 'x'},
            ]},
            'student_files': {'a.js': [
                {'label': 'comment', 'token': 'hello'},
                {'label': 'comment', 'token': 'mine'},
                {'label': 'comment', 'token': 'mine'},
                {'label': 'extra', 'token': 'y'},
            ]},
        }
        pct, desc, items = self._checker()._per_basis_comment_info(marks)
        self.assertEqual(desc.count('+'), 2)
        self.assertIn('+mine (00:00:00)', desc)
        self.assertIn('-world', desc)
        self.assertEqual(len(items), 3)
        self.assertEqual(pct, 0.0)

    def test_per_basis_comment_info_blank_pct_when_no_teacher_comments(self):
        marks = {
            'teacher_files': {},
            'student_files': {'a.js': [{'label': 'comment', 'token': 'note'}]},
        }
        pct, desc, _items = self._checker()._per_basis_comment_info(marks)
        self.assertEqual(pct, '')
        self.assertEqual(desc, '+note (00:00:00)')

    def test_per_basis_comment_info_none_without_marks(self):
        c = self._checker()
        self.assertIsNone(c._per_basis_comment_info({}))
        self.assertIsNone(c._per_basis_comment_info(None))


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
            (_build_leo_diff_marks,        'leo_star'),
            (_build_lcs_token_diff_marks,  'lcs'),
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
        _apply_star_post_pass(
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
        n_extra_unpaired = sum(
            1 for marks in diff['student_files'].values()
            for m in marks
            if m.get('label') == 'extra' and not m.get('paired_with')
        )
        score_star = round(
            max(0.0, (n_total - n_missing - n_ghost_extra - n_extra_unpaired) / n_total * 100), 1,
        )
        self.assertLess(
            score_star, 100.0,
            'LEO* should be < 100% under shuffle: Phase 1 joint Hungarian '
            'with ghosts can pull real teachers out of pairing; '
            f'got {score_star} (n_missing={n_missing}, '
            f'n_ghost_extra={n_ghost_extra}, '
            f'n_extra_unpaired={n_extra_unpaired}).',
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
    s_ext = Path(s_fname).suffix.lower() if s_fname else None
    if include_comment_tokens:
        s_token_seq = [(m.start(), m.group())
                       for m in _sm._CHAR_TOKEN_RE.finditer(s_text)]
    else:
        s_nc, _ = _split_tokens_by_comment(s_text, s_ext)
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


def _expected_teacher_tokens(t_text: str, *, include_comment_tokens: bool,
                              ext: str = None) -> List[str]:
    if include_comment_tokens:
        return [m.group() for m in _sm._CHAR_TOKEN_RE.finditer(t_text)]
    t_nc, _ = _split_tokens_by_comment(t_text, ext)
    return [tok for _, tok in t_nc]


def _project_code_files(d: Path) -> Dict[str, Path]:
    return {p.name: p for p in d.iterdir()
            if p.is_file() and p.suffix.lower() in LANG_EXTS}


def _pair_student_file(t_path: Path, t_name: str,
                       student_files: Dict[str, Path]) -> Path:
    if t_name in student_files:
        return student_files[t_name]
    ext = t_path.suffix.lower()
    candidates = [p for p in student_files.values() if p.suffix.lower() == ext]
    return candidates[0] if len(candidates) == 1 else None


_NON_STAR_RECONSTRUCT_METHODS = [
    ('lcs', _build_lcs_token_diff_marks, False),
    ('git', _build_git_diff_marks,       False),
]


# (project, sid, method, file) tuples where applying diff marks doesn't yield
# the teacher's non-comment token bag under language-aware tokenization. These
# are pre-existing method limitations exposed by stricter (language-aware)
# tokenization in the test.
_CORRECTION_TEXT_EXCEPTIONS: Set[Tuple[str, str, str, str]] = set()


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
            if pw:
                return f"er|{pw['file']}|{pw['start']}"
            mt = m.get('move_to')
            if mt:
                return f"em|{mt['file']}|{mt['pos']}"
            return 'e'
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
                if m.get('paired_with'):
                    cur['kind'] = 'extra-replace'
                    cur['pair_file'] = m['paired_with']['file']
                    cur['pair_lo'] = m['paired_with']['start']
                    cur['pair_hi'] = m['paired_with']['end']
                elif m.get('move_to'):
                    cur['kind'] = 'extra-move'
                    cur['move_file'] = m['move_to']['file']
                    cur['move_pos'] = m['move_to']['pos']
                else:
                    cur['kind'] = 'extra'
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
    can_extend_left=None, can_extend_right=None,
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
        new_start = dst_start - len(d_lead)
        if can_extend_left is None or can_extend_left(new_start):
            a_start = new_start
    if s_trail and not d_trail:
        body = body + s_trail
    elif not s_trail and d_trail and '\n' not in d_trail:
        new_end = dst_end + len(d_trail)
        if can_extend_right is None or can_extend_right(new_end):
            a_end = new_end
    return body, a_start, a_end


def _curated_apply_to_student_text(
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

    raw_ops = []
    order = 0
    for g in groups:
        if g['side'] == 'teacher' and g['kind'] == 'missing-insert' \
                and g.get('insert_file') == s_fname:
            if id(g) in consumed_missings:
                order += 1
                continue
            raw_ops.append({
                'kind': 'insert',
                'orig_start': g['insert_pos'], 'orig_end': g['insert_pos'],
                'src_start': g['lo'], 'src_end': g['hi'],
                'body': t_text[g['lo']:g['hi']], 'order': order,
            })
        elif g['side'] == 'student' and g['kind'] == 'extra-replace' \
                and g['file'] == s_fname:
            raw_ops.append({
                'kind': 'swap',
                'orig_start': g['lo'], 'orig_end': g['hi'],
                'src_start': g['pair_lo'], 'src_end': g['pair_hi'],
                'body': t_text[g['pair_lo']:g['pair_hi']], 'order': order,
            })
        elif g['side'] == 'student' and g['kind'] in ('extra', 'ghost_extra') \
                and g['file'] == s_fname:
            if '_coalesced' in g:
                _, _, body = g.pop('_coalesced')
                raw_ops.append({
                    'kind': 'coal',
                    'orig_start': g['lo'], 'orig_end': g['hi'],
                    'body': body, 'order': order,
                })
            else:
                raw_ops.append({
                    'kind': 'del',
                    'orig_start': g['lo'], 'orig_end': g['hi'],
                    'body': '', 'order': order,
                })
        elif g['side'] == 'student' and g['kind'] == 'extra-move' \
                and g['file'] == s_fname:
            move_body = s_text[g['lo']:g['hi']]
            raw_ops.append({
                'kind': 'del',
                'orig_start': g['lo'], 'orig_end': g['hi'],
                'body': '', 'order': order,
            })
            if g.get('move_file') == s_fname:
                order += 1
                raw_ops.append({
                    'kind': 'move-ins',
                    'orig_start': g['move_pos'], 'orig_end': g['move_pos'],
                    'body': move_body, 'order': order,
                })
        order += 1

    siblings = [(op['orig_start'], op['orig_end']) for op in raw_ops]
    ops = []
    for i, op in enumerate(raw_ops):
        if op['kind'] in ('insert', 'swap'):
            def _make_left(idx, lo_orig):
                def can(new_start, idx=idx, lo_orig=lo_orig):
                    if new_start >= lo_orig:
                        return True
                    for j, (b_lo, b_hi) in enumerate(siblings):
                        if j == idx:
                            continue
                        if new_start <= b_lo <= lo_orig:
                            return False
                        if new_start <= b_hi <= lo_orig:
                            return False
                    return True
                return can
            def _make_right(idx, hi_orig):
                def can(new_end, idx=idx, hi_orig=hi_orig):
                    if new_end <= hi_orig:
                        return True
                    for j, (b_lo, b_hi) in enumerate(siblings):
                        if j == idx:
                            continue
                        if hi_orig <= b_lo <= new_end:
                            return False
                        if hi_orig <= b_hi <= new_end:
                            return False
                    return True
                return can
            body, a, b = _align_whitespace(
                t_text, op['src_start'], op['src_end'],
                s_text, op['orig_start'], op['orig_end'],
                can_extend_left=_make_left(i, op['orig_start']),
                can_extend_right=_make_right(i, op['orig_end']),
            )
            ops.append([a, b, body, op['order']])
        else:
            ops.append([op['orig_start'], op['orig_end'],
                        op['body'], op['order']])
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
        else:
            before = text[start - 1] if start > 0 else ''
            after = text[end] if end < len(text) else ''
            if before and after and _ALNUM_RE.match(before) \
                    and _ALNUM_RE.match(after):
                deleted = text[start:end]
                is_all_whitespace = deleted and all(c.isspace() for c in deleted)
                if not is_all_whitespace and any(
                    not _ALNUM_RE.match(c) for c in deleted
                ):
                    body = ' '
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
                t_ext = Path(t_name).suffix.lower()
                actual = _reconstruct_tokens_from_marks(
                    t_res.get(t_name, []),
                    s_res.get(s_path.name, []),
                    s_text, s_path.name,
                    include_comment_tokens=include_cm,
                )
                expected = _expected_teacher_tokens(
                    t_text, include_comment_tokens=include_cm, ext=t_ext,
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
            if (project_dir.name, student_dir.name, mid, t_name) in _CORRECTION_TEXT_EXCEPTIONS:
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
                t_ext = Path(t_name).suffix.lower()
                spliced = _curated_apply_to_student_text(
                    diff_marks, t_text, s_text, t_name, s_path.name,
                )
                expected = _expected_teacher_tokens(
                    t_text, include_comment_tokens=include_cm, ext=t_ext,
                )
                if include_cm:
                    actual = [m.group()
                              for m in _sm._CHAR_TOKEN_RE.finditer(spliced)]
                else:
                    actual = [tok for _, tok in
                              _split_tokens_by_comment(spliced, t_ext)[0]]
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


def _curated_pair_teacher_to_student(t_name, t_marks, student_files):
    refs = set()
    for m in t_marks or []:
        ia = m.get('insert_at')
        if ia and ia.get('file'):
            refs.add(ia['file'])
        pw = m.get('paired_with')
        if pw and not pw.get('ghost') and pw.get('file'):
            refs.add(pw['file'])
    if len(refs) == 1:
        only = next(iter(refs))
        if only in student_files:
            return only
    if t_name in student_files:
        return t_name
    t_ext = Path(t_name).suffix.lower()
    same_ext = [n for n in student_files if Path(n).suffix.lower() == t_ext]
    if len(same_ext) == 1:
        return same_ext[0]
    return None


def _curated_collect_marks(diff_marks: dict) -> set:
    out = set()
    for side in ('teacher_files', 'student_files'):
        for fname, marks in (diff_marks.get(side, {}) or {}).items():
            for m in marks or []:
                out.add((side, fname, m['start'], m['end'],
                         m['label'], m['token']))
    return out


def _curated_nc_token_bag(text: str, ext: str = None) -> Counter:
    nc, _cm = _split_tokens_by_comment(text, ext)
    return Counter(t for _, t in nc)


# (project_name, student_dir_name) pairs whose `minimal <= ideal` check is
# intentionally skipped. Use only when the curator decided the minimal marks
# should fix the student via a different approach than ideal — e.g.,
# sorting/67: student wrote a different bubble-sort variant, so the
# minimum-fix marks legitimately diverge from ideal's recommended fix.
# gallery/59: student renamed a variable consistently and the minimal marks keep
# that rename everywhere except one spot where ideal suggests a different fix.
_MINIMAL_SUBSET_EXCEPTIONS: Set[Tuple[str, str]] = {
    ('sorting', '67'),
    ('gallery', '59'),
}


class TestCuratedSanity(unittest.TestCase):
    def _check_ideal_token_bag(self, project_dir: Path, student_dir: Path) -> None:
        ideal_path = student_dir / 'diff_marks_ideal.json'
        if not ideal_path.exists():
            self.skipTest('no diff_marks_ideal.json')
        teacher_files = _project_code_files(project_dir)
        if not teacher_files:
            self.skipTest('project has no code files')
        student_files = _project_code_files(student_dir)
        ideal = _load_json(ideal_path)
        for t_name, t_marks in (ideal.get('teacher_files', {}) or {}).items():
            if t_name not in teacher_files:
                continue
            s_name = _curated_pair_teacher_to_student(
                t_name, t_marks, student_files,
            )
            if s_name is None:
                continue
            t_text = teacher_files[t_name].read_text(
                encoding='utf-8', errors='ignore',
            ).replace('\r\n', '\n')
            s_text = student_files[s_name].read_text(
                encoding='utf-8', errors='ignore',
            ).replace('\r\n', '\n')
            with self.subTest(project=project_dir.name,
                              student=student_dir.name,
                              pair=f'{t_name}->{s_name}'):
                spliced = _curated_apply_to_student_text(
                    ideal, t_text, s_text, t_name, s_name,
                )
                ext = Path(t_name).suffix.lower()
                actual = _curated_nc_token_bag(spliced, ext)
                expected = _curated_nc_token_bag(t_text, ext)
                self.assertEqual(
                    actual, expected,
                    f'applying ideal marks did not yield teacher token bag '
                    f'(extra={dict(actual - expected)}, '
                    f'missing={dict(expected - actual)})',
                )

    def _check_schema_valid(self, project_dir: Path, student_dir: Path,
                            mode: str) -> None:
        marks_path = student_dir / f'diff_marks_{mode}.json'
        if not marks_path.exists():
            self.skipTest(f'no diff_marks_{mode}.json')
        teacher_files = _project_code_files(project_dir)
        if not teacher_files:
            self.skipTest('project has no code files')
        student_files = _project_code_files(student_dir)
        marks = _load_json(marks_path)
        errors = _validate_curated_schema(marks, teacher_files, student_files)
        with self.subTest(project=project_dir.name,
                          student=student_dir.name,
                          mode=mode):
            self.assertEqual(
                errors, [],
                f'{mode} schema violations: {errors}',
            )

    def _check_minimal_subset_of_ideal(self, project_dir: Path,
                                        student_dir: Path) -> None:
        ideal_path = student_dir / 'diff_marks_ideal.json'
        minimal_path = student_dir / 'diff_marks_minimal.json'
        if not ideal_path.exists() or not minimal_path.exists():
            self.skipTest('missing ideal or minimal file')
        if (project_dir.name, student_dir.name) in _MINIMAL_SUBSET_EXCEPTIONS:
            self.skipTest(
                f'{project_dir.name}/{student_dir.name}: known acceptable '
                f'divergence (see _MINIMAL_SUBSET_EXCEPTIONS)'
            )
        ideal = _load_json(ideal_path)
        minimal = _load_json(minimal_path)
        ideal_set = _curated_collect_marks(ideal)
        minimal_set = _curated_collect_marks(minimal)
        extra = minimal_set - ideal_set
        with self.subTest(project=project_dir.name,
                          student=student_dir.name,
                          check='minimal<=ideal'):
            self.assertFalse(
                extra,
                f'minimal has {len(extra)} mark(s) not in ideal '
                f'(sample: {sorted(extra)[:3]})',
            )


def _attach_curated_sanity_tests() -> None:
    for project_dir in sorted(_TEST.iterdir()):
        if not project_dir.is_dir() or '-' in project_dir.name:
            continue
        for student_dir in sorted(d for d in project_dir.iterdir()
                                  if d.is_dir() and d.name.isdigit()):
            base = f'{project_dir.name}_{student_dir.name}'

            def make_bag(p=project_dir, s=student_dir):
                def test(self):
                    self._check_ideal_token_bag(p, s)
                return test

            def make_subset(p=project_dir, s=student_dir):
                def test(self):
                    self._check_minimal_subset_of_ideal(p, s)
                return test

            def make_schema(p=project_dir, s=student_dir, mode='ideal'):
                def test(self):
                    self._check_schema_valid(p, s, mode)
                return test

            setattr(TestCuratedSanity,
                    f'test_ideal_token_bag_{base}', make_bag())
            setattr(TestCuratedSanity,
                    f'test_minimal_subset_{base}', make_subset())
            setattr(TestCuratedSanity,
                    f'test_schema_ideal_{base}',
                    make_schema(mode='ideal'))
            setattr(TestCuratedSanity,
                    f'test_schema_minimal_{base}',
                    make_schema(mode='minimal'))


_attach_curated_sanity_tests()


import shutil
import subprocess

_PARITY_RUNNER = _ROOT / '_parity_runner.js'
_NODE_BIN = shutil.which('node')
_PARITY_READY = bool(_NODE_BIN) and _PARITY_RUNNER.is_file()
_PARITY_SKIP_COLS = {
    'tokens', 'tokens_html', 'tokens_css', 'tokens_js', 'tokens_py',
    'tokens_comment',
}


def _parse_lesson_stats_csv(csv_text: str) -> Dict[str, str]:
    header, row = csv_text.strip().splitlines()
    return dict(zip(header.split(','), row.split(',')))


@unittest.skipUnless(_PARITY_READY,
                     'node executable or _parity_runner.js not available')
class TestJsPythonParity(unittest.TestCase):

    def _run_node(self, log_path: Path) -> str:
        res = subprocess.run(
            [_NODE_BIN, str(_PARITY_RUNNER), str(log_path)],
            capture_output=True, text=True, encoding='utf-8',
        )
        if res.returncode != 0:
            self.fail(f'JS parity runner failed (rc={res.returncode}):\n'
                      f'{res.stderr}')
        return res.stdout

    def _run_python(self, log_path: Path) -> str:
        from utils.lesson_stats import compute_lesson_stats_csv
        events = _load_events(log_path)
        csv = compute_lesson_stats_csv(events, log_path.parent)
        self.assertIsNotNone(csv, 'compute_lesson_stats_csv returned None')
        return csv

    def _check_parity(self, log_path: Path):
        js = _parse_lesson_stats_csv(self._run_node(log_path))
        py = _parse_lesson_stats_csv(self._run_python(log_path))
        self.assertEqual(set(js), set(py), 'CSV columns differ')
        for col in sorted(set(js)):
            if col in _PARITY_SKIP_COLS:
                continue
            self.assertEqual(
                js[col], py[col],
                f'Column {col!r} differs: JS={js[col]!r} PY={py[col]!r}',
            )


def _attach_parity_tests() -> None:
    for project_dir in sorted(_TEST.iterdir()):
        if not project_dir.is_dir() or '-' in project_dir.name:
            continue
        log_path = project_dir / 'log.json'
        if not log_path.is_file():
            continue

        def make_test(p=log_path):
            def test(self):
                self._check_parity(p)
            return test

        setattr(TestJsPythonParity,
                f'test_parity_{project_dir.name}', make_test())


_attach_parity_tests()


_REPLAY_RUNNER = _ROOT / '_replay_runner.js'
_REPLAY_READY = bool(_NODE_BIN) and _REPLAY_RUNNER.is_file()


@unittest.skipUnless(_REPLAY_READY,
                     'node executable or _replay_runner.js not available')
class TestJsReplayParity(unittest.TestCase):
    def _check_replay(self, log_path: Path, expected_file: Path):
        res = subprocess.run(
            [_NODE_BIN, str(_REPLAY_RUNNER), str(log_path)],
            capture_output=True, text=True, encoding='utf-8',
        )
        if res.returncode != 0:
            self.fail(f'JS replay runner failed (rc={res.returncode}):\n'
                      f'{res.stderr}')
        js_text = res.stdout
        py_text = expected_file.read_text(encoding='utf-8').replace(
            '\r\n', '\n'
        )
        self.assertEqual(js_text, py_text,
                         f'JS replay text differs from {expected_file.name}')


def _attach_replay_parity_tests() -> None:
    for project_dir in sorted(_TEST.iterdir()):
        if not project_dir.is_dir() or '-' in project_dir.name:
            continue
        log_path = project_dir / 'log.json'
        if not log_path.is_file():
            continue
        expected = None
        for cand in sorted(project_dir.iterdir()):
            if cand.is_file() and cand.name.startswith('reconstructed'):
                expected = cand
                break
        if expected is None:
            continue

        def make_test(p=log_path, e=expected):
            def test(self):
                self._check_replay(p, e)
            return test

        setattr(TestJsReplayParity,
                f'test_replay_{project_dir.name}', make_test())


_attach_replay_parity_tests()


if __name__ == '__main__':
    unittest.main()
