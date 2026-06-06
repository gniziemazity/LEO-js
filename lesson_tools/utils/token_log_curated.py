from collections import Counter
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from .token_log_marks import _read_text_normalized


def _structural_form(tokens):
    stack = [{'kind': 'top', 'items': []}]

    def push(item):
        ctx = stack[-1]
        if ctx['kind'] == 'block':
            ctx['cur_stmt'].append(item)
        elif ctx['kind'] == 'tag':
            ctx['items'].append(item)
        else:
            ctx['items'].append(item)

    def close_block(closer):
        ctx = stack[-1]
        if ctx['kind'] == 'block' and closer == '}':
            stack.pop()
            if ctx['cur_stmt']:
                ctx['stmts'].append(tuple(ctx['cur_stmt']))
            return ('{', frozenset(Counter(ctx['stmts']).items()))
        if ctx['kind'] == 'tag' and closer == '>':
            stack.pop()
            return ('<', frozenset(Counter(ctx['items']).items()))
        return None

    for tok in tokens:
        if tok == '{':
            stack.append({'kind': 'block', 'stmts': [], 'cur_stmt': []})
        elif tok == '<':
            stack.append({'kind': 'tag', 'items': []})
        elif tok == '}':
            node = close_block('}')
            push(node if node is not None else tok)
        elif tok == '>':
            node = close_block('>')
            push(node if node is not None else tok)
        elif tok == ';' and stack[-1]['kind'] == 'block':
            ctx = stack[-1]
            if ctx['cur_stmt']:
                ctx['stmts'].append(tuple(ctx['cur_stmt']))
                ctx['cur_stmt'] = []
        else:
            push(tok)

    while stack[-1]['kind'] != 'top':
        kind = stack[-1]['kind']
        node = close_block('}' if kind == 'block' else '>')
        push(node)

    return tuple(stack[0]['items'])


def _structural_diff_summary(actual_form, expected_form):
    if actual_form == expected_form:
        return 'forms equal'
    a_len = len(actual_form)
    e_len = len(expected_form)
    if a_len != e_len:
        return f'top-level length differs: actual={a_len}, expected={e_len}'
    for i, (a, e) in enumerate(zip(actual_form, expected_form)):
        if a != e:
            a_kind = a[0] if isinstance(a, tuple) else 'tok'
            e_kind = e[0] if isinstance(e, tuple) else 'tok'
            return (f'first divergence at index {i}: '
                    f'actual={a_kind}({a!r}) vs expected={e_kind}({e!r})')
    return 'unknown divergence'


def _validate_curated_schema(
    curated: dict,
    teacher_files: Dict[str, Path],
    student_files: Dict[str, Path],
) -> List[str]:
    errors: List[str] = []
    ALLOWED_TEACHER = {'missing', 'comment'}
    ALLOWED_STUDENT = {'extra', 'ghost_extra', 'comment'}
    REQ = ('token', 'label', 'start', 'end')

    t_text_cache: Dict[str, str] = {}
    s_text_cache: Dict[str, str] = {}
    for fname, p in (teacher_files or {}).items():
        try:
            t_text_cache[fname] = _read_text_normalized(p)
        except Exception:
            pass
    for fname, p in (student_files or {}).items():
        try:
            s_text_cache[fname] = _read_text_normalized(p)
        except Exception:
            pass

    def check_mark(side: str, fname: str, m, allowed_labels: set) -> bool:
        for k in REQ:
            if k not in m:
                errors.append(f'{side}/{fname}: mark missing field {k!r}: {m}')
                return False
        if m['label'] not in allowed_labels:
            errors.append(
                f'{side}/{fname}: bad label {m["label"]!r} '
                f'(allowed: {sorted(allowed_labels)})'
            )
            return False
        if not (isinstance(m['start'], int) and isinstance(m['end'], int)):
            errors.append(f'{side}/{fname}: start/end must be ints: {m}')
            return False
        if m['start'] >= m['end']:
            errors.append(f'{side}/{fname}: start>=end: {m}')
            return False
        text = (t_text_cache if side == 'teacher' else s_text_cache).get(fname)
        if text is None:
            errors.append(f'{side}/{fname}: file not in {side}_files')
            return False
        if m['end'] > len(text):
            errors.append(f'{side}/{fname}: end {m["end"]} past file len {len(text)}: {m}')
            return False
        if text[m['start']:m['end']] != m['token']:
            errors.append(
                f'{side}/{fname}: substring at [{m["start"]},{m["end"]}] is '
                f'{text[m["start"]:m["end"]]!r}, not token {m["token"]!r}'
            )
            return False
        return True

    teacher_marks_by_file = curated.get('teacher_files', {}) or {}
    student_marks_by_file = curated.get('student_files', {}) or {}
    missing_files_raw = curated.get('missing_files', []) or []
    if not isinstance(missing_files_raw, list):
        errors.append(f'missing_files must be a list, got {type(missing_files_raw).__name__}')
        missing_files_raw = []
    missing_files: set = set()
    for entry in missing_files_raw:
        if not isinstance(entry, str):
            errors.append(f'missing_files entry must be a string: {entry!r}')
            continue
        if entry not in (teacher_files or {}):
            errors.append(
                f'missing_files entry {entry!r} is not a teacher file'
            )
            continue
        if entry in (student_files or {}):
            errors.append(
                f'missing_files entry {entry!r} is also in student_files — '
                f'student did submit it'
            )
            continue
        missing_files.add(entry)

    for fname, marks in teacher_marks_by_file.items():
        for m in marks or []:
            check_mark('teacher', fname, m, ALLOWED_TEACHER)
    for fname, marks in student_marks_by_file.items():
        for m in marks or []:
            check_mark('student', fname, m, ALLOWED_STUDENT)

    t_index = {(fname, m['start']): m
               for fname, marks in teacher_marks_by_file.items()
               for m in marks or [] if 'start' in m}
    s_index = {(fname, m['start']): m
               for fname, marks in student_marks_by_file.items()
               for m in marks or [] if 'start' in m}

    t_paired_to: Dict[Tuple[str, int], Tuple[str, int]] = {}
    s_paired_to: Dict[Tuple[str, int], Tuple[str, int]] = {}

    for fname, marks in teacher_marks_by_file.items():
        for m in marks or []:
            pw = m.get('paired_with')
            if pw is None:
                continue
            if m.get('label') != 'missing':
                errors.append(
                    f'teacher/{fname}: only `missing` may have paired_with, '
                    f'got label {m.get("label")!r}'
                )
                continue
            partner_key = (pw.get('file'), pw.get('start'))
            partner = s_index.get(partner_key)
            if partner is None:
                errors.append(
                    f'teacher/{fname}: paired_with refers to non-existent '
                    f'student mark at {pw.get("file")}:{pw.get("start")}'
                )
                continue
            if partner.get('label') != 'extra':
                errors.append(
                    f'teacher/{fname}: paired_with partner at {partner_key} '
                    f'has label {partner.get("label")!r}, expected `extra`'
                )
                continue
            ppw = partner.get('paired_with') or {}
            if (ppw.get('file') != fname or ppw.get('start') != m['start']):
                errors.append(
                    f'teacher/{fname}: paired_with not bidirectional — '
                    f'partner at {partner_key} does not point back'
                )
                continue
            t_paired_to[(fname, m['start'])] = partner_key

    for fname, marks in student_marks_by_file.items():
        for m in marks or []:
            pw = m.get('paired_with')
            if pw is None:
                continue
            if pw.get('ghost'):
                if m.get('label') != 'ghost_extra':
                    errors.append(
                        f'student/{fname}: ghost paired_with only allowed on '
                        f'`ghost_extra`, got label {m.get("label")!r}'
                    )
                    continue
                if not (
                    isinstance(pw.get('file'), str)
                    and isinstance(pw.get('start'), int)
                    and isinstance(pw.get('end'), int)
                    and isinstance(pw.get('token'), str)
                ):
                    errors.append(
                        f'student/{fname}: ghost paired_with must include '
                        f'file/start/end/token strings/ints'
                    )
                continue
            if m.get('label') != 'extra':
                errors.append(
                    f'student/{fname}: only `extra` may have paired_with, '
                    f'got label {m.get("label")!r}'
                )
                continue
            partner_key = (pw.get('file'), pw.get('start'))
            partner = t_index.get(partner_key)
            if partner is None:
                errors.append(
                    f'student/{fname}: paired_with refers to non-existent '
                    f'teacher mark at {pw.get("file")}:{pw.get("start")}'
                )
                continue
            if partner.get('label') != 'missing':
                errors.append(
                    f'student/{fname}: paired_with partner at {partner_key} '
                    f'has label {partner.get("label")!r}, expected `missing`'
                )
                continue
            s_paired_to[(fname, m['start'])] = partner_key

    seen: Dict[Tuple[str, int], Tuple[str, int]] = {}
    for src, dst in t_paired_to.items():
        if dst in seen:
            errors.append(
                f'student mark at {dst} is the paired_with target of '
                f'multiple teacher missings: {seen[dst]} and {src}'
            )
        else:
            seen[dst] = src
    seen.clear()
    for src, dst in s_paired_to.items():
        if dst in seen:
            errors.append(
                f'teacher mark at {dst} is the paired_with target of '
                f'multiple student extras: {seen[dst]} and {src}'
            )
        else:
            seen[dst] = src

    for fname, marks in teacher_marks_by_file.items():
        for m in marks or []:
            ia = m.get('insert_at')
            if ia is None:
                continue
            if m.get('label') != 'missing':
                errors.append(
                    f'teacher/{fname}: only `missing` may have insert_at, '
                    f'got label {m.get("label")!r}'
                )
                continue
            if m.get('paired_with'):
                continue
            ifile = ia.get('file')
            ipos = ia.get('pos')
            if ifile not in s_text_cache:
                errors.append(
                    f'teacher/{fname}: insert_at.file {ifile!r} not in student_files'
                )
                continue
            if not isinstance(ipos, int) or ipos < 0 or ipos > len(s_text_cache[ifile]):
                errors.append(
                    f'teacher/{fname}: insert_at.pos {ipos} out of range '
                    f'[0, {len(s_text_cache[ifile])}] for {ifile}'
                )

    for fname, marks in student_marks_by_file.items():
        for m in marks or []:
            mt = m.get('move_to')
            if mt is None:
                continue
            if m.get('label') != 'extra':
                errors.append(
                    f'student/{fname}: only `extra` may have move_to, '
                    f'got label {m.get("label")!r}'
                )
                continue
            if m.get('paired_with'):
                errors.append(
                    f'student/{fname}: extra at {m.get("start")} cannot have '
                    f'both paired_with and move_to'
                )
                continue
            mfile = mt.get('file')
            mpos = mt.get('pos')
            if mfile not in s_text_cache:
                errors.append(
                    f'student/{fname}: move_to.file {mfile!r} not in student_files'
                )
                continue
            if not isinstance(mpos, int) or mpos < 0 or mpos > len(s_text_cache[mfile]):
                errors.append(
                    f'student/{fname}: move_to.pos {mpos} out of range '
                    f'[0, {len(s_text_cache[mfile])}] for {mfile}'
                )

    for fname, marks in teacher_marks_by_file.items():
        if fname in missing_files:
            continue
        for m in marks or []:
            if m.get('label') != 'missing':
                continue
            if m.get('paired_with'):
                continue
            if not m.get('insert_at'):
                errors.append(
                    f'teacher/{fname}: unpaired missing {m.get("token")!r} '
                    f'at {m.get("start")} has no insert_at — undefined where '
                    f'to splice'
                )

    for side, marks_by_file in (
        ('teacher', teacher_marks_by_file),
        ('student', student_marks_by_file),
    ):
        for fname, marks in marks_by_file.items():
            seen_spans: Dict[Tuple[int, int], str] = {}
            for m in marks or []:
                if 'start' not in m or 'end' not in m:
                    continue
                key = (m['start'], m['end'])
                if key in seen_spans:
                    errors.append(
                        f'{side}/{fname}: duplicate marks at span '
                        f'[{key[0]},{key[1]}] — labels {seen_spans[key]!r} '
                        f'and {m.get("label")!r}'
                    )
                else:
                    seen_spans[key] = m.get('label')

    return errors
