import csv
import hashlib
import math
import re
import sys
from pathlib import Path
from typing import Callable, Dict, List, Optional, Set, Tuple
from collections import Counter
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, Border, Side
from openpyxl.comments import Comment
from openpyxl.formatting.rule import ColorScaleRule
from .similarity_measures import (
    _CHAR_TOKEN_RE,
    normalize_code,
    calculate_ide_diff_sim, calculate_char_histogram_similarity,
    split_code_tokens, calculate_containment,
    save_xlsx,
)
from .lesson_log import load_lesson_log
from .lv_editor import reconstruct_all_with_ghosts


_HASH_EXTS = {'.html', '.htm', '.css', '.js', '.py'}
_NGRAM_SIZE = 3


def _folder_fingerprint(folder: Path) -> Optional[str]:
    h = hashlib.sha1()
    files = sorted(
        (p for p in folder.iterdir()
         if p.is_file() and p.suffix.lower() in _HASH_EXTS),
        key=lambda p: p.name.lower(),
    )
    if not files:
        return None
    for p in files:
        h.update(p.name.lower().encode('utf-8'))
        h.update(b'\0')
        try:
            h.update(p.read_bytes())
        except Exception:
            return None
        h.update(b'\0')
    return h.hexdigest()


def _read_name_id_map(name_map_csv: Path) -> Dict[str, str]:
    """Map folder names (real name OR alter ego, whichever is used) to id."""
    out: Dict[str, str] = {}
    if not name_map_csv.is_file():
        return out
    for enc in ('utf-8-sig', 'utf-8', 'latin-1', 'cp1252'):
        try:
            with open(name_map_csv, encoding=enc) as fh:
                reader = csv.DictReader(fh, delimiter=';')
                for row in reader:
                    sid = (row.get('Student ID') or '').strip()
                    if not sid:
                        continue
                    name = (row.get('Student Name') or '').strip()
                    alter = (row.get('Alter Ego') or '').strip()
                    if name:
                        out[name] = sid
                    if alter:
                        out[alter] = sid
            return out
        except (UnicodeDecodeError, UnicodeError):
            out.clear()
            continue
        except Exception:
            return out
    return out


def _build_anon_to_id_map(anon_names_dir: Path,
                          anon_ids_dir: Path,
                          name_map_csv: Optional[Path] = None) -> Dict[str, str]:
    """Build a mapping from anon_names folder name to student id.

    Prefers the deterministic CSV mapping (name_map.csv written by sim_check);
    falls back to content fingerprinting against anon_ids/ if needed.
    """
    name_to_id: Dict[str, str] = {}
    if name_map_csv is not None:
        name_to_id = _read_name_id_map(name_map_csv)

    out: Dict[str, str] = {}
    folder_names = [d.name for d in anon_names_dir.iterdir() if d.is_dir()]
    for folder in folder_names:
        sid = name_to_id.get(folder)
        if sid:
            out[folder] = sid

    if len(out) == len(folder_names) or not anon_ids_dir.is_dir():
        return out

    id_by_fp: Dict[str, str] = {}
    for d in anon_ids_dir.iterdir():
        if not d.is_dir():
            continue
        fp = _folder_fingerprint(d)
        if fp and fp not in id_by_fp:
            id_by_fp[fp] = d.name
    for d in anon_names_dir.iterdir():
        if not d.is_dir() or d.name in out:
            continue
        fp = _folder_fingerprint(d)
        if fp and fp in id_by_fp:
            out[d.name] = id_by_fp[fp]
    return out

_HEADER_ROW_HEIGHT = 50
_BLACK_BORDER = Border(
    left=Side(style='medium', color='000000'), right=Side(style='medium', color='000000'),
    top=Side(style='medium', color='000000'),  bottom=Side(style='medium', color='000000'),
)


def _indent_pairs(text: str) -> Counter:
    pairs: Counter = Counter()
    for line in text.splitlines():
        if not line.strip():
            continue
        i = 0
        while i < len(line) and line[i] in (' ', '\t'):
            i += 1
        ws = line[:i]
        content = line[i:].rstrip()
        pairs[(ws, content)] += 1
    return pairs


def _fmt_indent_pair(pair) -> str:
    ws, content = pair
    n_sp = ws.count(' ')
    n_tab = ws.count('\t')
    if n_tab and n_sp:
        ind = f'[{n_sp}sp+{n_tab}tab]'
    elif n_tab:
        ind = f'[{n_tab}tab]'
    elif n_sp:
        ind = f'[{n_sp}sp]'
    else:
        ind = '[0]'
    return f'{ind} {content[:80]}'


def _parse_tokens_txt(path: Path) -> Tuple[Counter, Counter]:
    extra_outside: Counter = Counter()
    extra_comment: Counter = Counter()
    try:
        for line in path.read_text(encoding='utf-8', errors='ignore').splitlines():
            if line.startswith('#') or not line.strip():
                continue
            parts = line.split('\t')
            if len(parts) < 2:
                continue
            token = parts[0]
            flags = set(parts[2:]) if len(parts) > 2 else set()
            if 'EXTRA' in flags:
                if 'COMMENT' in flags:
                    extra_comment[token] += 1
                else:
                    extra_outside[token] += 1
    except Exception:
        pass
    return extra_outside, extra_comment





def _extra_comment(cA: Counter, cB: Counter, name_a: str, fmt=str) -> Optional[Comment]:
    inter = cA & cB
    if not inter:
        return None
    lines = [f'{fmt(kw)} (x{n})' if n > 1 else fmt(kw) for kw, n in sorted(inter.items())]
    only_a = cA - cB
    if only_a:
        lines.append(f'\n-- {name_a} ONLY --\n')
        lines.extend(f'{fmt(kw)} (x{n})' if n > 1 else fmt(kw) for kw, n in sorted(only_a.items()))
    cm = Comment(', '.join(lines).replace('\n,', '\n'), 'peer_sim')
    cm.width  = 500
    cm.height = min(100 + 30 * len(lines), 4000)
    return cm


def _ngram_comment(ngrams: Set[Tuple[str, ...]]) -> Optional[Comment]:
    if not ngrams:
        return None
    lines = [' '.join(ng) for ng in sorted(ngrams)]
    cm = Comment('\n'.join(lines), 'peer_sim')
    cm.width  = 500
    cm.height = min(100 + 18 * len(lines), 4000)
    return cm


def _token_seq(text: str) -> List[str]:
    return [m.group() for m in _CHAR_TOKEN_RE.finditer(text)]


def _ngrams(seq: List[str], n: int = _NGRAM_SIZE) -> Set[Tuple[str, ...]]:
    if len(seq) < n:
        return set()
    return {tuple(seq[i:i + n]) for i in range(len(seq) - n + 1)}


class PeerSimilarityChecker:
    def __init__(self, students_dir: str, teacher_dir: str,
                 start_dir: str = None,
                 id_map: Optional[Dict[str, str]] = None,
                 events: Optional[list] = None,
                 lesson_file: Optional[str] = None):
        self.students_dir = Path(students_dir)
        self.teacher_dir  = Path(teacher_dir)
        self.start_dir    = Path(start_dir) if start_dir else None
        self.id_map       = id_map or {}
        self.events       = events
        self.lesson_file  = lesson_file
        self.student_data:           Dict[str, Dict[str, Optional[List[str]]]] = {}
        self.student_extra_outside:  Dict[str, Dict[str, Counter]] = {}
        self.student_extra_inside:   Dict[str, Dict[str, Counter]] = {}
        self.student_indent_extras:  Dict[str, Dict[str, Counter]] = {}
        self.student_outside_full:   Dict[str, Counter] = {}
        self.baseline_outside: Dict[str, Counter] = {}
        self.baseline_inside:  Dict[str, Counter] = {}
        self.baseline_indent:  Dict[str, Counter] = {}
        self.teacher_ngrams: Set[Tuple[str, ...]] = set()
        self.student_extra_ngrams:  Dict[str, Set[Tuple[str, ...]]] = {}
        self.ngram_df: Counter = Counter()
        self.indent_df: Counter = Counter()
        self.idf: Dict[str, float] = {}
        self.rare_threshold = 0
        self.extensions = ['.html', '.css', '.js', '.py']

    def _read_file(self, directory: Path, ext: str) -> Optional[str]:
        files = list(directory.glob(f'*{ext}'))
        return files[0].read_text(encoding='utf-8', errors='ignore') if files else None

    def _load_baseline(self) -> None:
        for ext in self.extensions:
            src_raw = (self._read_file(self.start_dir, ext)
                       if self.start_dir and self.start_dir.is_dir() else None)
            if src_raw is None:
                src_raw = self._read_file(self.teacher_dir, ext)

            if src_raw is not None:
                self.baseline_outside[ext], self.baseline_inside[ext] = \
                    split_code_tokens(src_raw)
                self.baseline_indent[ext] = _indent_pairs(src_raw)
            else:
                self.baseline_outside[ext] = Counter()
                self.baseline_inside[ext]  = Counter()
                self.baseline_indent[ext]  = Counter()

            t_raw = self._read_file(self.teacher_dir, ext)
            if t_raw is not None:
                t_out, t_ins = split_code_tokens(t_raw)
                for tok, cnt in t_out.items():
                    if cnt > self.baseline_outside[ext].get(tok, 0):
                        self.baseline_outside[ext][tok] = cnt
                for tok, cnt in t_ins.items():
                    if cnt > self.baseline_inside[ext].get(tok, 0):
                        self.baseline_inside[ext][tok] = cnt
                t_ind = _indent_pairs(t_raw)
                for key, cnt in t_ind.items():
                    if cnt > self.baseline_indent[ext].get(key, 0):
                        self.baseline_indent[ext][key] = cnt

        if self.events:
            self._augment_baseline_with_ghosts()

        self._build_teacher_ngrams()

    def _augment_baseline_with_ghosts(self) -> None:
        try:
            reco = reconstruct_all_with_ghosts(
                self.events, lesson_file=self.lesson_file,
            )
        except Exception:
            return
        for tab_key, info in reco.items():
            ghosts = info.get('ghosts', []) if isinstance(info, dict) else []
            for g in ghosts:
                gtext = g.get('text', '') if isinstance(g, dict) else ''
                if not gtext.strip():
                    continue
                g_out, g_ins = split_code_tokens(gtext)
                g_ind = _indent_pairs(gtext)
                for ext in self.extensions:
                    for tok, cnt in g_out.items():
                        if cnt > self.baseline_outside[ext].get(tok, 0):
                            self.baseline_outside[ext][tok] = cnt
                    for tok, cnt in g_ins.items():
                        if cnt > self.baseline_inside[ext].get(tok, 0):
                            self.baseline_inside[ext][tok] = cnt
                    for key, cnt in g_ind.items():
                        if cnt > self.baseline_indent[ext].get(key, 0):
                            self.baseline_indent[ext][key] = cnt

    def _build_teacher_ngrams(self) -> None:
        seqs: List[str] = []
        for ext in self.extensions:
            t_raw = self._read_file(self.teacher_dir, ext)
            if t_raw:
                seqs.extend(_token_seq(t_raw))
        if self.events:
            try:
                reco = reconstruct_all_with_ghosts(
                    self.events, lesson_file=self.lesson_file,
                )
            except Exception:
                reco = {}
            for info in reco.values():
                ghosts = info.get('ghosts', []) if isinstance(info, dict) else []
                for g in ghosts:
                    gtext = g.get('text', '') if isinstance(g, dict) else ''
                    if gtext.strip():
                        seqs.extend(_token_seq(gtext))
        self.teacher_ngrams = _ngrams(seqs)

    def load_student_data(self) -> None:
        print("Loading student files...")
        self._load_baseline()

        for s_dir in sorted(d for d in self.students_dir.iterdir() if d.is_dir()):
            name = s_dir.name
            self.student_data[name]           = {}
            self.student_extra_outside[name]  = {}
            self.student_extra_inside[name]   = {}
            self.student_indent_extras[name]  = {}
            student_seq: List[str] = []

            tokens_path = s_dir / 'tokens.txt'
            if tokens_path.exists():
                tok_extra_out, tok_extra_in = _parse_tokens_txt(tokens_path)
                self.student_extra_outside[name] = {'_tokens': tok_extra_out}
                self.student_extra_inside[name]  = {'_tokens': tok_extra_in}
                full_outside: Counter = Counter()
                for ext in self.extensions:
                    raw = self._read_file(s_dir, ext)
                    self.student_data[name][ext] = normalize_code(raw) if raw else None
                    if raw:
                        out, _ = split_code_tokens(raw)
                        full_outside += out
                        self.student_indent_extras[name][ext] = _indent_pairs(raw) - self.baseline_indent[ext]
                        student_seq.extend(_token_seq(raw))
                    else:
                        self.student_indent_extras[name][ext] = Counter()
                self.student_outside_full[name] = full_outside
                self.student_extra_ngrams[name] = (
                    _ngrams(student_seq) - self.teacher_ngrams
                )
                continue

            full_outside = Counter()
            for ext in self.extensions:
                raw = self._read_file(s_dir, ext)
                if raw is None:
                    self.student_data[name][ext]          = None
                    self.student_extra_outside[name][ext] = Counter()
                    self.student_extra_inside[name][ext]  = Counter()
                    self.student_indent_extras[name][ext] = Counter()
                    continue
                try:
                    self.student_data[name][ext] = normalize_code(raw)
                    out, ins = split_code_tokens(raw)
                    self.student_extra_outside[name][ext] = out - self.baseline_outside[ext]
                    self.student_extra_inside[name][ext] = ins - self.baseline_inside[ext]
                    self.student_indent_extras[name][ext] = _indent_pairs(raw) - self.baseline_indent[ext]
                    full_outside += out
                    student_seq.extend(_token_seq(raw))
                except Exception:
                    self.student_data[name][ext]          = None
                    self.student_extra_outside[name][ext] = Counter()
                    self.student_extra_inside[name][ext]  = Counter()
                    self.student_indent_extras[name][ext] = Counter()
            self.student_outside_full[name] = full_outside
            self.student_extra_ngrams[name] = (
                _ngrams(student_seq) - self.teacher_ngrams
            )

        self._compute_document_frequencies()

    def _compute_document_frequencies(self) -> None:
        n = max(1, len(self.student_data))
        self.rare_threshold = max(2, min(4, n // 10))

        ext_token_df: Counter = Counter()
        for name, exts in self.student_extra_outside.items():
            seen = set()
            for ext_ctr in exts.values():
                for tok in ext_ctr:
                    seen.add(tok)
            for tok in seen:
                ext_token_df[tok] += 1
        self.idf = {
            tok: math.log((n + 1) / (cnt + 1)) + 1.0
            for tok, cnt in ext_token_df.items()
        }

        for ngrams in self.student_extra_ngrams.values():
            for ng in ngrams:
                self.ngram_df[ng] += 1

        for name, exts in self.student_indent_extras.items():
            seen_pairs = set()
            for ext_ctr in exts.values():
                for pair in ext_ctr:
                    seen_pairs.add(pair)
            for pair in seen_pairs:
                self.indent_df[pair] += 1


    def _fill_matrix_sheet(
        self,
        wb: Workbook,
        title: str,
        student_names: List[str],
        scorer: Callable[[str, str], Tuple[Optional[float], Optional[Comment]]],
    ) -> None:
        ws = wb.create_sheet(title=title)
        has_ids = bool(self.id_map)
        student_ids = ([self.id_map.get(n, '') for n in student_names]
                       if has_ids else None)
        self._init_matrix_header(ws, student_names, student_ids)
        row_off = 3 if has_ids else 2
        col_off = 3 if has_ids else 2
        for r, sA in enumerate(student_names):
            for c, sB in enumerate(student_names):
                if sA == sB:
                    continue
                cell = ws.cell(row=r + row_off, column=c + col_off)
                cell.alignment = Alignment(horizontal='center')
                value, comment = scorer(sA, sB)
                cell.value = value
                if comment:
                    cell.comment = comment
        self._format_asymmetric_sheet(ws, student_names, has_ids)

    def generate_matrix_report(self, output_file: str) -> None:
        if not self.student_data:
            self.load_student_data()

        wb = Workbook()
        if 'Sheet' in wb.sheetnames:
            wb.remove(wb['Sheet'])

        def _sort_key(n):
            sid = self.id_map.get(n, '')
            try:
                return (0, int(sid), n)
            except (TypeError, ValueError):
                return (1, sid, n)

        student_names = sorted(self.student_data.keys(), key=_sort_key)
        active_exts = [ext for ext in self.extensions
                       if any(self.student_data[n].get(ext) is not None
                              for n in self.student_data)] or self.extensions

        print("Generating similarity matrices...")

        def _avg_score(sA, sB, fn):
            scores = [fn(self.student_data[sA][ext], self.student_data[sB][ext])
                      for ext in active_exts
                      if self.student_data[sA].get(ext) and self.student_data[sB].get(ext)]
            return (round(sum(scores) / len(scores), 2) or None) if scores else None

        def _score_diff(sA, sB):
            return _avg_score(sA, sB, lambda a, b: calculate_ide_diff_sim(a, b) * 100), None

        def _score_char(sA, sB):
            return _avg_score(sA, sB, lambda a, b: calculate_char_histogram_similarity(a, b) * 100), None

        def _score_inc(sA, sB):
            fA = self.student_outside_full.get(sA, Counter())
            fB = self.student_outside_full.get(sB, Counter())
            if fA and fB:
                return round(calculate_containment(fA, fB), 2) or None, None
            return None, None

        def _score_extra(sA, sB):
            eA = sum(self.student_extra_outside[sA].values(), Counter())
            eB = sum(self.student_extra_outside[sB].values(), Counter())
            overlap = sum((eA & eB).values())
            return overlap or None, _extra_comment(eA, eB, sA)

        def _score_extra_c(sA, sB):
            iA = sum(self.student_extra_inside[sA].values(), Counter())
            iB = sum(self.student_extra_inside[sB].values(), Counter())
            overlap = sum((iA & iB).values())
            return overlap or None, _extra_comment(iA, iB, sA)

        def _score_indent(sA, sB):
            iA = sum(self.student_indent_extras[sA].values(), Counter())
            iB = sum(self.student_indent_extras[sB].values(), Counter())
            overlap = sum((iA & iB).values())
            return overlap or None, _extra_comment(iA, iB, sA, fmt=_fmt_indent_pair)

        def _score_idf_extra(sA, sB):
            eA = sum(self.student_extra_outside[sA].values(), Counter())
            eB = sum(self.student_extra_outside[sB].values(), Counter())
            inter = eA & eB
            if not inter:
                return None, None
            score = sum(
                min(eA[t], eB[t]) * self.idf.get(t, 1.0) for t in inter
            )
            return round(score, 1) or None, _extra_comment(eA, eB, sA)

        def _score_rare_ngram(sA, sB):
            ngA = self.student_extra_ngrams.get(sA, set())
            ngB = self.student_extra_ngrams.get(sB, set())
            inter = ngA & ngB
            rare = {ng for ng in inter
                    if self.ngram_df.get(ng, 0) <= self.rare_threshold}
            if not rare:
                return None, None
            return len(rare), _ngram_comment(rare)

        def _score_rare_indent(sA, sB):
            iA = sum(self.student_indent_extras[sA].values(), Counter())
            iB = sum(self.student_indent_extras[sB].values(), Counter())
            inter = iA & iB
            rare_ctr = Counter({
                pair: cnt for pair, cnt in inter.items()
                if self.indent_df.get(pair, 0) <= self.rare_threshold
            })
            overlap = sum(rare_ctr.values())
            if not overlap:
                return None, None
            return overlap, _extra_comment(rare_ctr, rare_ctr, sA, fmt=_fmt_indent_pair)

        for title, scorer in [
            ('Diff',       _score_diff),
            ('Char',       _score_char),
            ('Inc',        _score_inc),
            ('Extra',      _score_extra),
            ('Extra (C)',  _score_extra_c),
            ('Indent',     _score_indent),
            ('IDF Extra',  _score_idf_extra),
            ('Rare NGram', _score_rare_ngram),
            ('Rare Indent', _score_rare_indent),
        ]:
            self._fill_matrix_sheet(wb, title, student_names, scorer)

        save_xlsx(wb, output_file)
        print(f"Report saved to {output_file}")


    @staticmethod
    def _init_matrix_header(ws, student_names, student_ids=None):
        has_ids = student_ids is not None
        name_row = 2 if has_ids else 1
        name_col = 2 if has_ids else 1
        first_data_col = name_col + 1
        ws.row_dimensions[name_row].height = _HEADER_ROW_HEIGHT
        if has_ids:
            ws.row_dimensions[1].height = _HEADER_ROW_HEIGHT
        for idx, name in enumerate(student_names):
            data_col = idx + first_data_col
            c = ws.cell(row=name_row, column=data_col, value=name)
            c.font = Font(bold=True)
            c.alignment = Alignment(text_rotation=90, vertical='bottom',
                                    horizontal='center')
            ws.cell(row=idx + name_row + 1, column=name_col,
                    value=name).font = Font(bold=True)
            if has_ids:
                sid = student_ids[idx]
                ic = ws.cell(row=1, column=data_col, value=sid)
                ic.font = Font(bold=True)
                ic.alignment = Alignment(text_rotation=90, vertical='bottom',
                                         horizontal='center')
                ws.cell(row=idx + name_row + 1, column=1,
                        value=sid).font = Font(bold=True)

    @staticmethod
    def _format_asymmetric_sheet(ws, student_names, has_ids=False):
        n = len(student_names)
        name_row = 2 if has_ids else 1
        name_col = 2 if has_ids else 1
        first_data_col = name_col + 1
        first_data_row = name_row + 1
        data_col_ltr = ws.cell(row=name_row, column=first_data_col).column_letter
        max_col_idx  = first_data_col + n - 1
        max_col_ltr  = ws.cell(row=name_row, column=max_col_idx).column_letter
        max_row      = first_data_row + n - 1
        ws.freeze_panes = f'{data_col_ltr}{first_data_row}'
        ws.conditional_formatting.add(
            f'{data_col_ltr}{first_data_row}:{max_col_ltr}{max_row}',
            ColorScaleRule(start_type='num', start_value=0, start_color='FFFFFF',
                           end_type='max', end_color='F8696B'),
        )
        ws.column_dimensions['A'].width = 6 if has_ids else 20
        if has_ids:
            ws.column_dimensions[ws.cell(row=1, column=name_col).column_letter].width = 20
        for col_idx in range(first_data_col, max_col_idx + 1):
            ws.column_dimensions[ws.cell(row=1, column=col_idx).column_letter].width = 6
        for row_cells in ws.iter_rows(min_row=first_data_row, max_row=max_row,
                                      min_col=first_data_col, max_col=max_col_idx):
            for cell in row_cells:
                if isinstance(cell.value, (int, float)):
                    cell.number_format = '0'
                    if cell.value >= 100:
                        cell.border = _BLACK_BORDER
                        cell.font   = Font(bold=True, color='FFFF00')


def main():
    if len(sys.argv) < 2:
        print('Usage: peer_sim_check.py <project_dir>'); sys.exit(1)
    current_dir    = Path(sys.argv[1]).resolve()
    anon_names_dir = current_dir / 'anon_names'
    correct_dir    = current_dir / 'correct'
    start_dir      = current_dir / 'start'

    if not correct_dir.exists():
        print(f"Missing: {correct_dir}"); sys.exit(1)

    if anon_names_dir.exists():
        anon_ids_dir = current_dir / 'anon_ids'
        name_map_csv = current_dir / 'name_map.csv'
        id_map = _build_anon_to_id_map(
            anon_names_dir, anon_ids_dir, name_map_csv,
        )
        if id_map:
            print(f"Resolved {len(id_map)} anon name -> id mapping(s).")
        log_data, log_msg = load_lesson_log(current_dir)
        if log_msg:
            print(log_msg)
        events = log_data.all_events if log_data else None
        lesson_file = log_data.lesson_file if log_data else None
        checker = PeerSimilarityChecker(
            str(anon_names_dir), str(correct_dir),
            start_dir=str(start_dir) if start_dir.exists() else None,
            id_map=id_map,
            events=events,
            lesson_file=lesson_file,
        )
        folder_name = current_dir.name
        checker.generate_matrix_report(
            str(current_dir / f'student_similarity_{folder_name}.xlsx')
        )
    else:
        print(f"Missing: {anon_names_dir}")


if __name__ == "__main__":
    main()