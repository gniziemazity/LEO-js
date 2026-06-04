import argparse
import json
import math
import os
import re
import sys
from utils.folder_utils import pick_file
from utils.anonymize import load_excluded_student_ids
import warnings
from datetime import datetime

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

import numpy as np
import pandas as pd
from scipy.stats import (
    chi2_contingency,
    fisher_exact,
    pearsonr,
    spearmanr,
    mannwhitneyu,
)
import matplotlib
matplotlib.use("TkAgg")
import matplotlib.pyplot as plt

DIVIDER = "=" * 72
SUB_DIV = "-" * 72

def section(title):
    print(f"\n{DIVIDER}")
    print(f"  {title}")
    print(DIVIDER)

def subsection(title):
    print(f"\n{SUB_DIV}")
    print(f"  {title}")
    print(SUB_DIV)

def safe_corr(x, y, method="pearson"):
    mask = x.notna() & y.notna()
    xc, yc = x[mask].astype(float), y[mask].astype(float)
    n = len(xc)
    if n < 3:
        return np.nan, np.nan, n
    if xc.std() == 0 or yc.std() == 0:
        return np.nan, np.nan, n
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        if method == "spearman":
            r, p = spearmanr(xc, yc)
        else:
            r, p = pearsonr(xc, yc)
    return r, p, n

def fmt_p(p):
    if np.isnan(p):
        return "N/A"
    if p < 0.001:
        return f"{p:.2e} ***"
    if p < 0.01:
        return f"{p:.4f} **"
    if p < 0.05:
        return f"{p:.4f} *"
    return f"{p:.4f}"

def fmt_r(r):
    return f"{r:+.3f}" if not np.isnan(r) else "N/A"


LESSON_DIFFICULTY = {
    "wall":    "easy",
    "chess":   "easy",
    "sorting": "hard",
    "js":      "hard",
    "qr":      "hard",
    "web":     "project",
}

_course_root: str = ""
_artefact_flags_cache: dict = {}
_curated_moments_cache: dict = {}
_diff_marks_cache: dict = {}

_DIFF_BASIS_FILES = [
    ("ideal",    "diff_marks_ideal.json"),
    ("required", "diff_marks_required.json"),
    ("leo_star", "diff_marks_leo_star.json"),
    ("leo",      "diff_marks_leo.json"),
    ("lcs_star", "diff_marks_lcs_star.json"),
    ("lcs",      "diff_marks_lcs.json"),
    ("lev_star", "diff_marks_lev_star.json"),
    ("lev",      "diff_marks_lev.json"),
    ("ro_star",  "diff_marks_ro_star.json"),
    ("ro",       "diff_marks_ro.json"),
    ("git_star", "diff_marks_git_star.json"),
    ("git",      "diff_marks_git.json"),
]

_LANG_FROM_EXT = {
    ".html": "html", ".htm": "html",
    ".css":  "css",
    ".js":   "js",
    ".py":   "py",
}


def _find_assignment_dir(name_lower: str):
    if not _course_root:
        return None
    for sub in ("assignments", "lessons"):
        sub_path = os.path.join(_course_root, sub)
        if not os.path.isdir(sub_path):
            continue
        for entry in os.listdir(sub_path):
            if entry.lower() == name_lower:
                p = os.path.join(sub_path, entry)
                if os.path.isdir(p):
                    return p
    return None


def _read_csv_rows(path):
    import csv as _csv
    try:
        with open(path, encoding="utf-8") as fh:
            return list(_csv.DictReader(fh))
    except (OSError, ValueError):
        return []


def _load_artefact_flags(name_lower: str):
    if name_lower in _artefact_flags_cache:
        return _artefact_flags_cache[name_lower]
    folder = _find_assignment_dir(name_lower)
    out = []
    if folder:
        for row in _read_csv_rows(os.path.join(folder, "artefact_labels.csv")):
            k = (row.get("key") or "").strip()
            lbl = (row.get("label") or "").strip()
            if k and lbl:
                out.append((k, lbl))
    _artefact_flags_cache[name_lower] = out
    return out


def _load_artefact_severity(name_lower: str):
    folder = _find_assignment_dir(name_lower)
    out: dict = {}
    if folder:
        for row in _read_csv_rows(os.path.join(folder, "artefact_labels.csv")):
            k = (row.get("key") or "").strip()
            sev = (row.get("severity") or "").strip().lower()
            if k and sev in ("high", "medium", "low"):
                out[k] = sev
    return out


def _raw_flags(a):
    return _load_artefact_flags(a.get("lower", ""))


def _load_curated_moments(name_lower: str):
    if name_lower in _curated_moments_cache:
        return _curated_moments_cache[name_lower]
    folder = _find_assignment_dir(name_lower)
    out = []
    if folder:
        for row in _read_csv_rows(os.path.join(folder, "curated_moments.csv")):
            k = (row.get("key") or "").strip()
            lbl = (row.get("label") or "").strip()
            pol = (row.get("polarity") or "not_fired").strip().lower()
            if pol not in ("not_fired", "fired"):
                pol = "not_fired"
            if k and lbl:
                out.append({"key": k, "label": lbl, "polarity": pol})
    _curated_moments_cache[name_lower] = out
    return out


def _diff_marks_for_student(name_lower: str, sid: str):
    if not _course_root or not sid:
        return None, None
    cache_key = (name_lower, str(sid))
    if cache_key in _diff_marks_cache:
        return _diff_marks_cache[cache_key]
    folder = _find_assignment_dir(name_lower)
    if not folder:
        _diff_marks_cache[cache_key] = (None, None)
        return None, None
    candidates = []
    sid_dir = os.path.join(folder, "anon_ids", str(sid))
    if os.path.isdir(sid_dir):
        candidates.append(sid_dir)

    for d in candidates:
        for basis, fname in _DIFF_BASIS_FILES:
            p = os.path.join(d, fname)
            if not os.path.exists(p):
                continue
            try:
                with open(p, encoding="utf-8") as fh:
                    data = json.load(fh)
            except (OSError, ValueError):
                continue
            _diff_marks_cache[cache_key] = (basis, data)
            return basis, data
    _diff_marks_cache[cache_key] = (None, None)
    return None, None


def _count_teacher_tokens_for(name_lower: str):
    folder = _find_assignment_dir(name_lower)
    if not folder:
        return {}, 0
    sub_priority = ("reconstructed", "start", "correct")
    root = None
    for sub in sub_priority:
        p = os.path.join(folder, sub)
        if os.path.isdir(p) and any(
            fn.lower().endswith(tuple(_LANG_FROM_EXT.keys()))
            for fn in os.listdir(p)
        ):
            root = p
            break
    if root is None:
        return {}, 0
    from utils.similarity_measures import iter_code_tokens
    by_lang: dict = {}
    total = 0
    for root_dir, _dirs, files in os.walk(root):
        for fn in files:
            ext = os.path.splitext(fn)[1].lower()
            if ext == '.htm':
                ext = '.html'
            lang = _LANG_FROM_EXT.get(ext)
            if not lang:
                continue
            path = os.path.join(root_dir, fn)
            try:
                with open(path, encoding='utf-8', errors='ignore') as fh:
                    text = fh.read()
            except OSError:
                continue
            n = sum(1 for _pos, _tok, is_c in iter_code_tokens(text, ext) if not is_c)
            by_lang[lang] = by_lang.get(lang, 0) + n
            total += n
    return by_lang, total


def _count_diff_marks_by_lang(data: dict):
    totals = {"missing": 0, "extra": 0, "ghost_extra": 0}
    by_lang: dict = {}

    def _bump(lang, label, n=1):
        if label not in totals:
            return
        totals[label] += n
        if lang not in by_lang:
            by_lang[lang] = {"missing": 0, "extra": 0, "ghost_extra": 0}
        by_lang[lang][label] += n

    for fname, marks in (data.get("teacher_files") or {}).items():
        ext = os.path.splitext(fname)[1].lower()
        lang = _LANG_FROM_EXT.get(ext)
        for m in marks or []:
            if m.get("label") == "missing":
                _bump(lang, "missing")
    for fname, marks in (data.get("student_files") or {}).items():
        ext = os.path.splitext(fname)[1].lower()
        lang = _LANG_FROM_EXT.get(ext)
        for m in marks or []:
            lbl = m.get("label")
            if lbl in ("extra", "ghost_extra"):
                _bump(lang, lbl)

    def _finish(d):
        d["divergence"] = d["missing"] + d["extra"] + d["ghost_extra"]
        d["change"] = d["missing"]
        return d

    _finish(totals)
    for lang, d in by_lang.items():
        _finish(d)
    return totals, by_lang


def _parse_artefact_digits(obs_series, n):
    obs = (obs_series.fillna("").astype(str).str.strip()
           .str.replace(r"^([01])\.0$", r"\1", regex=True))
    is_code = obs.str.fullmatch(r"[01]+", na=False)
    has_some = obs.str.len() > 0
    fits = obs.str.len() <= n
    valid = is_code & fits & has_some & (n > 0)
    fired_by_pos = []
    ans_by_pos = []
    for i in range(n):
        has_digit = valid & (obs.str.len() > i)
        digit = obs.str.slice(i, i + 1)
        fired_by_pos.append(has_digit & (digit == "1"))
        ans_by_pos.append(has_digit)
    mismatched = is_code & (obs.str.len() > n) & (n > 0)
    return fired_by_pos, valid, mismatched, ans_by_pos


_HEADER_ALIASES = {
    "id":              ["ID"],
    "name":            ["Name"],
    "number":          ["Number"],
    "exam":            ["Exam"],
    "weeklies":        ["Weeklies"],
    "notes":           ["Notes"],
    "excluded":        ["Category", "Excluded", "Excluded?"],
    "pre_typing":      ["Pre Typing", "Pre KPM", "Pre-typing", "Pre K/min"],
    "post_typing":     ["Post Typing", "Post KPM", "Post-typing", "Post K/min"],
    "self_eval":       ["Self Eval", "Self Evaluation", "Self"],
    "kahoot":          ["Kahoot"],
    "quiz_stii":       ["Final Quiz", "Quiz Stii", "Stii", "Știi"],
    "final_grade":     ["Final Grade", "Grade"],
    "avg_assignments": ["Avg Assignments", "Avg Grade", "Average"],
    "participation":   ["Participation"],
    "answers":         ["Total Answers", "Answers"],
    "questions":       ["Total Questions", "Questions"],
    "help":            ["Total Help", "Help"],
}

COL: dict = {}
ASSIGNMENTS: dict = {}
POOLED_ASSIGNMENTS: dict = {}


def _build_header_map(headers):
    m = {}
    for i, h in enumerate(headers):
        if h is None or (isinstance(h, float) and math.isnan(h)):
            continue
        key = str(h).strip().lower()
        if key and key not in m:
            m[key] = i
    return m


def _find_col(header_map, aliases):
    for a in aliases:
        idx = header_map.get(a.lower())
        if idx is not None:
            return idx
    return None


def _detect_assignments(headers, header_map):
    result = []
    seen = set()
    for idx, h in enumerate(headers):
        if h is None or (isinstance(h, float) and math.isnan(h)):
            continue
        orig = str(h).strip()
        if not orig:
            continue
        m = re.match(r"^(.+?)\s+Grade$", orig, re.IGNORECASE)
        if not m:
            continue
        name = m.group(1).strip()
        lower = name.lower()
        if lower in seen:
            continue
        seen.add(lower)

        def get(suffix, _n=name):
            return (header_map.get((_n + " " + suffix).lower())
                    or header_map.get((_n + suffix).lower()))

        result.append({
            "name":        name,
            "lower":       lower,
            "difficulty":  LESSON_DIFFICULTY.get(lower, ""),
            "follow_html": get("HTML Follow"),
            "follow_css":  get("CSS Follow"),
            "follow_js":   get("JS Follow"),
            "follow":      get("Follow"),
            "inc":         get("Inc"),
            "a":           get("A"),
            "q":           get("Q"),
            "h":           get("H"),
            "c_plus":      get("C+"),
            "c_minus":     get("C-"),
            "c_diff":      get("C Diff"),
            "lesson_obs":  get("LessonObs"),
            "grade":       idx,
            "status":      get("Status"),
            "obs":         get("Obs"),
        })
    return result


def _populate_columns_from_header(df):
    global COL, ASSIGNMENTS, POOLED_ASSIGNMENTS
    if df.empty:
        return
    headers = df.iloc[0].tolist()
    header_map = _build_header_map(headers)
    COL = {k: _find_col(header_map, aliases)
           for k, aliases in _HEADER_ALIASES.items()}
    assn_list = _detect_assignments(headers, header_map)
    ASSIGNMENTS = {(i + 1): a for i, a in enumerate(assn_list)}
    POOLED_ASSIGNMENTS = {k: v for k, v in ASSIGNMENTS.items()
                          if v.get("follow") is not None}

    if ASSIGNMENTS:
        lesson_grades = [a["grade"] for a in ASSIGNMENTS.values()
                         if a.get("grade") is not None]
        first_grade = min(lesson_grades) if lesson_grades else None
        last_grade = max(lesson_grades) if lesson_grades else None

        def _find_all(lower):
            return [i for i, h in enumerate(headers)
                    if h is not None
                    and str(h).strip().lower() == lower]

        if first_grade is not None and last_grade is not None:
            km = _find_all("k/min")
            if COL.get("pre_typing") is None:
                before = next((i for i in km if i < first_grade), None)
                if before is not None:
                    COL["pre_typing"] = before
            if COL.get("post_typing") is None:
                after = next((i for i in km if i > last_grade), None)
                if after is not None:
                    COL["post_typing"] = after


def _col_series(st, col_idx, *, numeric=True):
    if col_idx is None or col_idx >= st.shape[1]:
        return pd.Series([np.nan] * len(st)) if numeric \
            else pd.Series([""] * len(st))
    s = st.iloc[:, col_idx]
    if numeric:
        return pd.to_numeric(s, errors="coerce")
    return s.fillna("").astype(str).str.strip()


def load_data(path):
    global _course_root
    _course_root = os.path.dirname(os.path.abspath(path))
    _artefact_flags_cache.clear()
    ext = os.path.splitext(path)[1].lower()
    engine = "openpyxl" if ext == ".xlsx" else "xlrd"
    df = pd.read_excel(path, engine=engine, header=None)
    if df.empty:
        return df
    _populate_columns_from_header(df)
    return df.iloc[1:].copy().reset_index(drop=True)


_LLM_NAME_TOKENS = (
    "chatgpt", "gpt-", "gpt ", "sonnet", "opus", "claude",
    "gemini", "deepseek", "ollama", "llama", "mistral",
)


def _row_is_llm(name: str, excluded: str) -> bool:
    s_excl = (excluded or "").strip().upper()
    if s_excl == "AI" or s_excl == "LLM":
        return True
    nm = (name or "").strip().lower()
    return any(tok in nm for tok in _LLM_NAME_TOKENS)


def enrich(st):
    if COL.get("name") is not None and COL.get("id") is not None:
        names = _col_series(st, COL["name"], numeric=False)
        excludeds = (_col_series(st, COL["excluded"], numeric=False)
                     if COL.get("excluded") is not None
                     else pd.Series([""] * len(st), index=st.index))
        st["is_llm"] = pd.Series(
            [_row_is_llm(n, e) for n, e in zip(names, excludeds)],
            index=st.index,
        )
    else:
        st["is_llm"] = pd.Series([False] * len(st), index=st.index)

    st["final_grade"]      = _col_series(st, COL.get("final_grade"))
    st["avg_assignments"]  = _col_series(st, COL.get("avg_assignments"))
    st["pre_typing"]       = _col_series(st, COL.get("pre_typing"))
    st["post_typing"]      = _col_series(st, COL.get("post_typing"))
    st["typing_improvement"] = st["post_typing"] - st["pre_typing"]
    st["self_eval"]        = _col_series(st, COL.get("self_eval"))
    st["answers"]          = _col_series(st, COL.get("answers"))
    st["questions"]        = _col_series(st, COL.get("questions"))
    st["help"]             = _col_series(st, COL.get("help"))
    st["participation"]    = _col_series(st, COL.get("participation"))
    st["kahoot"]           = _col_series(st, COL.get("kahoot"))
    st["quiz_stii"]        = _col_series(st, COL.get("quiz_stii"))

    passing_statuses = {"Pass", "Pass'", "Pass*"}
    all_passed = pd.Series(True, index=st.index)
    for _, a in ASSIGNMENTS.items():
        status = _col_series(st, a["status"], numeric=False)
        all_passed &= status.isin(passing_statuses)
    st["passed_course"] = all_passed

    for a_num, a in ASSIGNMENTS.items():
        obs        = _col_series(st, a["obs"], numeric=False)
        lesson_obs = _col_series(st, a["lesson_obs"], numeric=False)
        status     = _col_series(st, a["status"], numeric=False)
        grade      = _col_series(st, a["grade"])

        st[f"a{a_num}_obs"]        = obs
        st[f"a{a_num}_lesson_obs"] = lesson_obs
        st[f"a{a_num}_status"]     = status
        st[f"a{a_num}_grade"]      = grade

        raw = _raw_flags(a)
        severity_map = _load_artefact_severity(a.get("lower", ""))
        fired_pos, artefact_valid, artefact_mismatch, ans_pos = _parse_artefact_digits(
            obs, len(raw),
        )
        st[f"a{a_num}_artefact_valid"] = artefact_valid
        fired_total = pd.Series(0, index=st.index, dtype=int)
        fired_high  = pd.Series(False, index=st.index)
        for i, (key, _label) in enumerate(raw):
            fired = ans_pos[i] & fired_pos[i]
            st[f"a{a_num}_artefact_{key}"] = fired
            st[f"a{a_num}_artefact_{key}_ans"] = ans_pos[i]
            fired_total = fired_total + fired.astype(int)
            if severity_map.get(key) == "high":
                fired_high = fired_high | fired
        st[f"a{a_num}_artefacts_fired"] = fired_total.where(artefact_valid, np.nan)
        st[f"a{a_num}_any_artefact"]    = artefact_valid & (fired_total > 0)
        # AI flag derived from high-severity artefact firings only — used
        # by the overview's "AI vs Trouble" cards. The previous
        # ``a{N}_ai`` keeps mixing in the OBS-text-contains-AI marker
        # for backwards compatibility; ``a{N}_ai_high`` is the
        # severity-aware variant requested in 2026-05.
        st[f"a{a_num}_ai_high"] = artefact_valid & fired_high
        n_mismatch = int(artefact_mismatch.sum())
        if n_mismatch:
            print(f"  warning: {a['name']} has {n_mismatch} OBS code(s) longer "
                  f"than {len(raw)} artefacts; left undecoded")

        st[f"a{a_num}_ai"]         = (
            st[f"a{a_num}_any_artefact"]
            | obs.str.upper().str.contains("AI", na=False)
            | lesson_obs.str.upper().str.contains("AI", na=False)
        )
        st[f"a{a_num}_submitted"]  = grade.notna()
        st[f"a{a_num}_passed"]     = status.isin(["Pass", "Pass'"])
        st[f"a{a_num}_trouble"]    = st[f"a{a_num}_submitted"] & ~status.isin(["Pass", "Pass'"])
        st[f"a{a_num}_pass_clean"] = status == "Pass"

        st[f"a{a_num}_follow"]      = _col_series(st, a["follow"])
        st[f"a{a_num}_follow_html"] = _col_series(st, a["follow_html"])
        st[f"a{a_num}_follow_css"]  = _col_series(st, a["follow_css"])
        st[f"a{a_num}_follow_js"]   = _col_series(st, a["follow_js"])
        st[f"a{a_num}_inc"]         = _col_series(st, a["inc"])
        st[f"a{a_num}_intA"]        = _col_series(st, a["a"])
        st[f"a{a_num}_intQ"]        = _col_series(st, a["q"])
        st[f"a{a_num}_intH"]        = _col_series(st, a["h"])
        st[f"a{a_num}_cplus"]       = _col_series(st, a["c_plus"])
        st[f"a{a_num}_cminus"]      = _col_series(st, a["c_minus"])
        st[f"a{a_num}_cdiff"]       = _col_series(st, a["c_diff"])
        st[f"a{a_num}_lesson_trouble"] = lesson_obs.str.contains(
            r"C\d+[<>]", na=False, regex=True
        )

        diverge_total = []
        change_total = []
        lang_totals = {lang: {"diverge": [], "change": []}
                       for lang in ("html", "css", "js", "py")}
        bases_used = []
        for sid_val in _col_series(st, COL.get("id"), numeric=False):
            sid = str(sid_val).strip()
            if sid.endswith(".0"):
                sid = sid[:-2]
            basis, data = _diff_marks_for_student(a["lower"], sid)
            if not data:
                diverge_total.append(np.nan)
                change_total.append(np.nan)
                bases_used.append("")
                for lang in lang_totals:
                    lang_totals[lang]["diverge"].append(np.nan)
                    lang_totals[lang]["change"].append(np.nan)
                continue
            totals, by_lang = _count_diff_marks_by_lang(data)
            diverge_total.append(totals["divergence"])
            change_total.append(totals["change"])
            bases_used.append(basis or "")
            for lang in lang_totals:
                d = by_lang.get(lang)
                lang_totals[lang]["diverge"].append(
                    d["divergence"] if d else np.nan
                )
                lang_totals[lang]["change"].append(
                    d["change"] if d else np.nan
                )
        st[f"a{a_num}_diverge"] = pd.Series(diverge_total, index=st.index)
        st[f"a{a_num}_change"]  = pd.Series(change_total,  index=st.index)
        st[f"a{a_num}_diff_basis"] = pd.Series(bases_used, index=st.index)
        for lang, d in lang_totals.items():
            st[f"a{a_num}_diverge_{lang}"] = pd.Series(d["diverge"], index=st.index)
            st[f"a{a_num}_change_{lang}"]  = pd.Series(d["change"],  index=st.index)

    ai_cols = [f"a{i}_ai" for i in POOLED_ASSIGNMENTS]
    st["total_ai_flags"] = st[ai_cols].sum(axis=1) if ai_cols else 0

    valid_cols = [f"a{i}_artefact_valid" for i in ASSIGNMENTS
                  if f"a{i}_artefact_valid" in st.columns]
    st["n_artefact_assignments"] = (
        st[valid_cols].sum(axis=1) if valid_cols else 0
    )
    fired_cols = [f"a{i}_artefacts_fired" for i in ASSIGNMENTS
                  if f"a{i}_artefacts_fired" in st.columns]
    if fired_cols:
        raw = st[fired_cols].sum(axis=1, skipna=True)
        st["total_artefacts_fired"] = raw.where(st["n_artefact_assignments"] > 0, np.nan)
    else:
        st["total_artefacts_fired"] = np.nan

    trouble_cols   = [f"a{i}_trouble"   for i in POOLED_ASSIGNMENTS]
    submitted_cols = [f"a{i}_submitted" for i in POOLED_ASSIGNMENTS]
    st["total_troubles"]  = st[trouble_cols].sum(axis=1) if trouble_cols else 0
    st["total_submitted"] = st[submitted_cols].sum(axis=1) if submitted_cols else 0

    grade_cols = [f"a{i}_grade" for i in POOLED_ASSIGNMENTS]
    st["avg_submitted_only"] = (
        st[grade_cols].mean(axis=1, skipna=True) if grade_cols else np.nan
    )

    follow_cols = [f"a{i}_follow" for i in POOLED_ASSIGNMENTS]
    st["mean_follow"] = (
        st[follow_cols].mean(axis=1, skipna=True) if follow_cols else np.nan
    )

    for lang in ("html", "css", "js"):
        cols = [f"a{i}_follow_{lang}" for i in POOLED_ASSIGNMENTS]
        st[f"mean_follow_{lang}"] = (
            st[cols].mean(axis=1, skipna=True) if cols else np.nan
        )

    for key, base in (("intA", "answers"), ("intQ", "questions"), ("intH", "help")):
        cols = [f"a{i}_{key}" for i in POOLED_ASSIGNMENTS]
        st[f"total_{base}_lessons"] = st[cols].sum(axis=1, skipna=True) if cols else 0
        if COL.get(base) is None:
            all_cols = [f"a{i}_{key}" for i in ASSIGNMENTS if f"a{i}_{key}" in st.columns]
            if all_cols:
                st[base] = st[all_cols].sum(axis=1, skipna=True)

    for key, alias in (("cplus", "comment_extra"),
                        ("cminus", "comment_missing"),
                        ("cdiff", "comment_diff")):
        cols = [f"a{i}_{key}" for i in POOLED_ASSIGNMENTS]
        st[f"total_{alias}"] = st[cols].sum(axis=1, skipna=True) if cols else 0

    fallback_msgs = []
    if COL.get("avg_assignments") is None:
        grade_cols_all = [f"a{i}_grade" for i in ASSIGNMENTS
                          if f"a{i}_grade" in st.columns]
        if grade_cols_all:
            st["avg_assignments"] = st[grade_cols_all].mean(axis=1, skipna=True)
            fallback_msgs.append("avg_assignments = mean(lesson grades)")

    if COL.get("participation") is None:
        follow_cols_all = [f"a{i}_follow" for i in ASSIGNMENTS
                           if f"a{i}_follow" in st.columns]
        if follow_cols_all:
            st["participation"] = st[follow_cols_all].mean(axis=1, skipna=True)
            fallback_msgs.append("participation = mean(lesson follow %)")

    if COL.get("final_grade") is None and st["avg_assignments"].notna().any():
        st["final_grade"] = st["avg_assignments"]
        fallback_msgs.append("final_grade = avg_assignments")

    if fallback_msgs:
        print(f"Computed fallbacks: {'; '.join(fallback_msgs)}")

    return st


def analyze_ai_vs_trouble(st):
    section("1. AI USAGE vs. TROUBLE DEMONSTRATING KNOWLEDGE")

    print("""
  Two outcome categories per assignment:
    Pass:    Pass or Pass' (demonstrated knowledge)
    Trouble: Fail, Fail*, Pass*, no-show (didn't demonstrate knowledge)

  OR (Odds Ratio) = how many times more likely the AI group is to have
  trouble vs. the non-AI group.
  Formula:  OR = (AI+Trouble × NoAI+Pass) ÷ (AI+Pass × NoAI+Trouble)
  OR = 1 means no difference;  OR = 4 means '4× the trouble'.

  p(Fisher) = probability this pattern is random chance.
  * p<0.05   ** p<0.01   *** p<0.001""")

    print(f"\n  Per-assignment breakdown:\n")
    print(f"  {'Assign':<10} {'AI+Trbl':>8} {'AI+Pass':>8} {'NoAI+Trbl':>10} {'NoAI+Pass':>10} "
          f"{'Rate AI':>9} {'Rate NoAI':>10} {'OR':>8} {'p(Fisher)':>12}")
    print(f"  {'-'*10} {'-'*8} {'-'*8} {'-'*10} {'-'*10} {'-'*9} {'-'*10} {'-'*8} {'-'*12}")

    totals = np.array([0, 0, 0, 0])

    for a_num, a in ASSIGNMENTS.items():
        ai = st[f"a{a_num}_ai"]
        trouble = st[f"a{a_num}_trouble"]
        passed = st[f"a{a_num}_passed"]
        has_obs = st[f"a{a_num}_obs"] != ""

        ai_t  = (ai & trouble).sum()
        ai_p  = (ai & passed).sum()
        nai_t = (~ai & trouble & has_obs).sum()
        nai_p = (~ai & passed & has_obs).sum()

        if a_num in POOLED_ASSIGNMENTS:
            totals += np.array([ai_t, ai_p, nai_t, nai_p])

        rate_ai = ai_t / (ai_t + ai_p) if (ai_t + ai_p) > 0 else float("nan")
        rate_nai = nai_t / (nai_t + nai_p) if (nai_t + nai_p) > 0 else float("nan")

        if min(ai_t + ai_p, nai_t + nai_p) > 0 and (ai_t + nai_t) > 0:
            table = np.array([[ai_t, ai_p], [nai_t, nai_p]])
            odds = (ai_t * nai_p) / (ai_p * nai_t) if ai_p * nai_t > 0 else float("inf")
            _, p_f = fisher_exact(table)
        else:
            odds = float("nan")
            p_f = float("nan")

        or_str = f"{odds:.1f}×" if not np.isnan(odds) else "N/A"
        print(f"  {a['name']:<10} {ai_t:>8} {ai_p:>8} {nai_t:>10} {nai_p:>10} "
              f"{rate_ai:>8.1%} {rate_nai:>9.1%} {or_str:>8} {fmt_p(p_f):>12}")

    subsection("Overall (assignments 1-5 pooled, excluding final project)")
    ai_t, ai_p, nai_t, nai_p = totals
    table_all = np.array([[ai_t, ai_p], [nai_t, nai_p]])

    rate_ai = ai_t / (ai_t + ai_p)
    rate_nai = nai_t / (nai_t + nai_p)
    odds_all = (ai_t * nai_p) / (ai_p * nai_t) if ai_p * nai_t > 0 else float("inf")
    chi2, p_chi, _, _ = chi2_contingency(table_all, correction=True)
    _, p_fisher = fisher_exact(table_all)

    print(f"""
  Contingency table:
                     Trouble      Pass   Total
    AI flagged:      {ai_t:>7}      {ai_p:>7}     {ai_t+ai_p:>5}
    No AI flag:      {nai_t:>7}      {nai_p:>7}     {nai_t+nai_p:>5}

  Trouble rate WITH AI:      {rate_ai:.1%}  ({ai_t}/{ai_t+ai_p})
  Trouble rate WITHOUT AI:   {rate_nai:.1%}  ({nai_t}/{nai_t+nai_p})

  Odds Ratio:        {odds_all:.2f}× the trouble
    → AI-flagged students had {odds_all:.2f}× the odds of trouble vs. non-AI.
  Formula:           ({ai_t} × {nai_p}) ÷ ({ai_p} × {nai_t}) = {odds_all:.2f}

  Chi-squared:       χ² = {chi2:.3f},  p = {fmt_p(p_chi)}
    → Only a {p_chi:.2%} chance this pattern is random coincidence.
  Fisher's exact:    p = {fmt_p(p_fisher)}
    → Exact test confirms: {p_fisher:.2%} chance of coincidence.
""")


def analyze_early_ai_and_passing(st):
    if "a1_ai" not in st.columns or "a2_ai" not in st.columns:
        return
    subsection("Early AI usage (easy assignments) and course pass rate")

    ai_a2 = st["a2_ai"]
    sub_a2 = st["a2_submitted"]
    with_ai = st[ai_a2 & sub_a2]
    without_ai = st[~ai_a2 & sub_a2]

    print(f"\n  AI in second assignment (Chess — probably easiest):")
    if len(with_ai) > 0:
        p1 = with_ai["passed_course"].sum()
        print(f"    With AI:    {p1}/{len(with_ai)} passed course ({p1/len(with_ai):.0%})")
    if len(without_ai) > 0:
        p2 = without_ai["passed_course"].sum()
        print(f"    Without AI: {p2}/{len(without_ai)} passed course ({p2/len(without_ai):.0%})")
    if len(with_ai) > 0 and len(without_ai) > 0:
        table = np.array([
            [with_ai["passed_course"].sum(), (~with_ai["passed_course"]).sum()],
            [without_ai["passed_course"].sum(), (~without_ai["passed_course"]).sum()],
        ])
        _, p_f = fisher_exact(table)
        print(f"    Fisher's exact p = {fmt_p(p_f)}")

    ai_a1 = st["a1_ai"]
    sub_a1 = st["a1_submitted"]
    with_ai = st[ai_a1 & sub_a1]
    without_ai = st[~ai_a1 & sub_a1]

    print(f"\n  AI in first assignment (Wall — easy):")
    if len(with_ai) > 0:
        p1 = with_ai["passed_course"].sum()
        print(f"    With AI:    {p1}/{len(with_ai)} passed course ({p1/len(with_ai):.0%})")
    if len(without_ai) > 0:
        p2 = without_ai["passed_course"].sum()
        print(f"    Without AI: {p2}/{len(without_ai)} passed course ({p2/len(without_ai):.0%})")
    if len(with_ai) > 0 and len(without_ai) > 0:
        table = np.array([
            [with_ai["passed_course"].sum(), (~with_ai["passed_course"]).sum()],
            [without_ai["passed_course"].sum(), (~without_ai["passed_course"]).sum()],
        ])
        _, p_f = fisher_exact(table)
        print(f"    Fisher's exact p = {fmt_p(p_f)}")

    ai_12 = st["a1_ai"] | st["a2_ai"]
    sub_12 = st["a1_submitted"] | st["a2_submitted"]
    with_ai = st[ai_12 & sub_12]
    without_ai = st[~ai_12 & sub_12]

    print(f"\n  AI in first OR second assignment (Wall / Chess — easy):")
    if len(with_ai) > 0:
        p1 = with_ai["passed_course"].sum()
        print(f"    With AI:    {p1}/{len(with_ai)} passed course ({p1/len(with_ai):.0%})")
    if len(without_ai) > 0:
        p2 = without_ai["passed_course"].sum()
        print(f"    Without AI: {p2}/{len(without_ai)} passed course ({p2/len(without_ai):.0%})")
    if len(with_ai) > 0 and len(without_ai) > 0:
        table = np.array([
            [with_ai["passed_course"].sum(), (~with_ai["passed_course"]).sum()],
            [without_ai["passed_course"].sum(), (~without_ai["passed_course"]).sum()],
        ])
        _, p_f = fisher_exact(table)
        print(f"    Fisher's exact p = {fmt_p(p_f)}")

    ai_both = st["a1_ai"] & st["a2_ai"]
    sub_both = st["a1_submitted"] & st["a2_submitted"]
    with_ai = st[ai_both & sub_both]
    without_ai = st[~ai_both & sub_both]

    print(f"\n  AI in BOTH first AND second assignment:")
    if len(with_ai) > 0:
        p1 = with_ai["passed_course"].sum()
        print(f"    With AI:    {p1}/{len(with_ai)} passed course ({p1/len(with_ai):.0%})")
    if len(without_ai) > 0:
        p2 = without_ai["passed_course"].sum()
        print(f"    Without AI: {p2}/{len(without_ai)} passed course ({p2/len(without_ai):.0%})")
    if len(with_ai) > 0 and len(without_ai) > 0:
        table = np.array([
            [with_ai["passed_course"].sum(), (~with_ai["passed_course"]).sum()],
            [without_ai["passed_course"].sum(), (~without_ai["passed_course"]).sum()],
        ])
        _, p_f = fisher_exact(table)
        print(f"    Fisher's exact p = {fmt_p(p_f)}")


def analyze_ai_grade_quality(st):
    section("2. AI GRADE QUALITY (assignments designed to resist AI)")

    print("""
  Assignments are designed so AI does not produce good answers.
  Students relying solely on AI tend to get low grades.
  Question: among AI users, does the grade predict trouble?
  (Low AI grade → couldn't improve on AI output → can't explain it either)
""")

    subsection("AI users: low grade (≤2) vs. high grade (≥3) and trouble rate")
    print(f"\n  {'Assign':<10} {'Low+Trbl':>9} {'Low+OK':>7} {'Hi+Trbl':>8} {'Hi+OK':>7} "
          f"{'Low%':>7} {'High%':>7}")
    print(f"  {'-'*10} {'-'*9} {'-'*7} {'-'*8} {'-'*7} {'-'*7} {'-'*7}")

    for a_num, a in POOLED_ASSIGNMENTS.items():
        ai = st[f"a{a_num}_ai"]
        trouble = st[f"a{a_num}_trouble"]
        grade = st[f"a{a_num}_grade"]
        submitted = st[f"a{a_num}_submitted"]

        low = ai & submitted & (grade <= 2)
        high = ai & submitted & (grade >= 3)

        lt = (low & trouble).sum()
        lok = (low & ~trouble).sum()
        ht = (high & trouble).sum()
        hok = (high & ~trouble).sum()

        lr = lt / (lt + lok) if (lt + lok) > 0 else float("nan")
        hr = ht / (ht + hok) if (ht + hok) > 0 else float("nan")

        print(f"  {a['name']:<10} {lt:>9} {lok:>7} {ht:>8} {hok:>7} "
              f"{lr:>6.0%} {hr:>6.0%}")

    all_lt = all_lok = all_ht = all_hok = 0
    for a_num in POOLED_ASSIGNMENTS:
        ai = st[f"a{a_num}_ai"]
        trouble = st[f"a{a_num}_trouble"]
        grade = st[f"a{a_num}_grade"]
        submitted = st[f"a{a_num}_submitted"]
        low = ai & submitted & (grade <= 2)
        high = ai & submitted & (grade >= 3)
        all_lt += (low & trouble).sum()
        all_lok += (low & ~trouble).sum()
        all_ht += (high & trouble).sum()
        all_hok += (high & ~trouble).sum()

    lr = all_lt / (all_lt + all_lok) if (all_lt + all_lok) > 0 else 0
    hr = all_ht / (all_ht + all_hok) if (all_ht + all_hok) > 0 else 0
    print(f"\n  Overall:   Low-grade AI: {lr:.0%} trouble ({all_lt}/{all_lt+all_lok})")
    print(f"             High-grade AI: {hr:.0%} trouble ({all_ht}/{all_ht+all_hok})")
    if (all_lt + all_lok) > 0 and (all_ht + all_hok) > 0:
        table = np.array([[all_lt, all_lok], [all_ht, all_hok]])
        _, p_f = fisher_exact(table)
        print(f"             Fisher's exact p = {fmt_p(p_f)}")
    print(f"\n  → Low AI grade likely means heavy AI reliance (couldn't improve output).")
    print(f"  → These students also can't explain the code → more trouble.")


def analyze_typing_speed(st):
    section("3. TYPING SPEED ANALYSIS")

    r, p, n = safe_corr(st["pre_typing"], st["final_grade"])
    print(f"\n  Pre-course typing speed vs. final grade:")
    print(f"    Pearson r = {fmt_r(r)},  p = {fmt_p(p)},  n = {n}")
    r, p, n = safe_corr(st["pre_typing"], st["final_grade"], method="spearman")
    print(f"    Spearman ρ = {fmt_r(r)},  p = {fmt_p(p)}")

    pass_typing = st.loc[st["passed_course"], "pre_typing"].dropna()
    fail_typing = st.loc[~st["passed_course"], "pre_typing"].dropna()
    if len(pass_typing) >= 2 and len(fail_typing) >= 2:
        u, p_u = mannwhitneyu(pass_typing, fail_typing, alternative="two-sided")
        print(f"\n  Pre-typing speed — passed vs failed course:")
        print(f"    Passed: mean = {pass_typing.mean():.1f} k/min  (n={len(pass_typing)})")
        print(f"    Failed: mean = {fail_typing.mean():.1f} k/min  (n={len(fail_typing)})")
        print(f"    Mann-Whitney U p = {fmt_p(p_u)}")

    has_both = st["pre_typing"].notna() & st["post_typing"].notna()
    if has_both.sum() >= 3:
        imp = st.loc[has_both, "typing_improvement"]
        print(f"\n  Typing speed improvement (post − pre):")
        print(f"    n = {len(imp)},  mean = {imp.mean():+.1f},  median = {imp.median():+.1f}")
        r, p, n = safe_corr(st.loc[has_both, "typing_improvement"],
                            st.loc[has_both, "final_grade"])
        print(f"    Correlation with final grade: r = {fmt_r(r)}, p = {fmt_p(p)}")

    subsection("Pre-typing speed vs. each assignment grade (does it weaken?)")
    print(f"\n  {'Assign':<10} {'r':>7} {'ρ':>7} {'p(ρ)':>12} {'n':>5}  Note")
    print(f"  {'-'*10} {'-'*7} {'-'*7} {'-'*12} {'-'*5}  {'-'*20}")
    for a_num, a in POOLED_ASSIGNMENTS.items():
        grade = st[f"a{a_num}_grade"]
        rp, _, _ = safe_corr(st["pre_typing"], grade)
        rs, ps, ns = safe_corr(st["pre_typing"], grade, method="spearman")
        tag = a["difficulty"]
        print(f"  {a['name']:<10} {fmt_r(rp):>7} {fmt_r(rs):>7} {fmt_p(ps):>12} {ns:>5}  {tag}")


def analyze_self_evaluation(st):
    section("4. SELF-EVALUATION ACCURACY")

    r, p, n = safe_corr(st["self_eval"], st["final_grade"])
    print(f"\n  Self-eval (Q) vs. final grade:")
    print(f"    Pearson r = {fmt_r(r)},  p = {fmt_p(p)},  n = {n}")
    r, p, n = safe_corr(st["self_eval"], st["final_grade"], method="spearman")
    print(f"    Spearman ρ = {fmt_r(r)},  p = {fmt_p(p)}")


def analyze_participation(st):
    section("5. PARTICIPATION & FOLLOW SCORES")

    print("\n  Participation (BY) = how closely the student's code matched the")
    print("  teacher's code at the end of each lesson (0-1 bonus added to grade).")
    print("  Assignment average (BX) = mean of assignment grades (independent of BY).")
    print("  NOTE: BX uses 0 for non-submitted assignments, so dropouts pull BX")
    print("  down heavily. This inflates correlations with participation (also ~0")
    print("  for dropouts). 'Avg submitted only' below excludes non-submissions.\n")

    r, p, n = safe_corr(st["participation"], st["avg_assignments"])
    print(f"  Participation vs assignment average (BX, includes 0s for missing):")
    print(f"    Pearson r = {fmt_r(r)},  p = {fmt_p(p)},  n = {n}")

    r, p, n = safe_corr(st["participation"], st["avg_submitted_only"])
    print(f"\n  Participation vs avg of SUBMITTED assignments only:")
    print(f"    Pearson r = {fmt_r(r)},  p = {fmt_p(p)},  n = {n}")
    r, p, n = safe_corr(st["participation"], st["avg_submitted_only"], method="spearman")
    print(f"    Spearman ρ = {fmt_r(r)},  p = {fmt_p(p)}")

    pass_p = st.loc[st["passed_course"], "participation"].dropna()
    fail_p = st.loc[~st["passed_course"], "participation"].dropna()
    if len(pass_p) >= 2 and len(fail_p) >= 2:
        u, pu = mannwhitneyu(pass_p, fail_p, alternative="two-sided")
        print(f"\n  Participation (passed vs failed):")
        print(f"    Passed: mean = {pass_p.mean():.3f}  (n={len(pass_p)})")
        print(f"    Failed: mean = {fail_p.mean():.3f}  (n={len(fail_p)})")
        print(f"    Mann-Whitney p = {fmt_p(pu)}")
        print(f"      → Tests whether the two groups differ significantly.")
        print(f"        Unlike t-test, does not assume normal distribution.")
        print(f"        Compares ranks: how often a random passer's score")
        print(f"        exceeds a random failer's score.")

    r, p, n = safe_corr(st["participation"], st["total_ai_flags"])
    print(f"\n  Participation vs total AI flags:")
    print(f"    Pearson r = {fmt_r(r)},  p = {fmt_p(p)},  n = {n}")

    r, p, n = safe_corr(st["self_eval"], st["participation"])
    print(f"\n  Self-eval vs participation:")
    print(f"    Pearson r = {fmt_r(r)},  p = {fmt_p(p)},  n = {n}")

    r, p, n = safe_corr(st["participation"], st["pre_typing"])
    print(f"\n  Participation vs pre-typing speed:")
    print(f"    Pearson r = {fmt_r(r)},  p = {fmt_p(p)},  n = {n}")

    subsection("Does typing along in lessons improve typing speed?")

    print(f"\n  Typing tests: one game at the start, one at the end of the course.")
    print(f"  Students type along with the teacher during every lesson.")
    print(f"  Question: does following along at all (vs not) lead to improvement?\n")

    r, p, n = safe_corr(st["participation"], st["typing_improvement"])
    print(f"  Follow amount vs typing improvement (does following MORE help?):")
    print(f"    Pearson r = {fmt_r(r)},  p = {fmt_p(p)},  n = {n}")

    has_both = st["pre_typing"].notna() & st["post_typing"].notna()
    followed = has_both & (st["participation"] > 0.1)  # meaningful participation
    not_followed = has_both & (st["participation"] <= 0.1)

    f_imp = st.loc[followed, "typing_improvement"].dropna()
    nf_imp = st.loc[not_followed, "typing_improvement"].dropna()

    print(f"\n  Followed along (participation > 0.1) vs didn't:")
    if len(f_imp) >= 1:
        print(f"    Followed:      mean = {f_imp.mean():+.1f} k/min  (n={len(f_imp)})")
    if len(nf_imp) >= 1:
        print(f"    Didn't follow: mean = {nf_imp.mean():+.1f} k/min  (n={len(nf_imp)})")
    if len(f_imp) >= 2 and len(nf_imp) >= 2:
        _, p_mw = mannwhitneyu(f_imp, nf_imp, alternative="two-sided")
        print(f"    Mann-Whitney p = {fmt_p(p_mw)}")
    elif len(nf_imp) < 2:
        print(f"    (Too few non-followers with both typing tests to compare)")

    subsection("Per-lesson follow score vs. its paired assignment grade")
    print(f"\n  {'Lesson':<14} {'r':>7} {'ρ':>7} {'p(ρ)':>12} {'n':>5}")
    print(f"  {'-'*14} {'-'*7} {'-'*7} {'-'*12} {'-'*5}")
    for a_num, a in POOLED_ASSIGNMENTS.items():
        follow = st[f"a{a_num}_follow"]
        grade = st[f"a{a_num}_grade"]
        rp, _, _ = safe_corr(follow, grade)
        rs, ps, ns = safe_corr(follow, grade, method="spearman")
        print(f"  L{a_num} → {a['name']:<8} {fmt_r(rp):>7} {fmt_r(rs):>7} {fmt_p(ps):>12} {ns:>5}")

    subsection("Per-lesson follow score vs. assignment average (BX)")
    print(f"\n  {'Lesson':<14} {'r':>7} {'ρ':>7} {'p(ρ)':>12} {'n':>5}")
    print(f"  {'-'*14} {'-'*7} {'-'*7} {'-'*12} {'-'*5}")
    for a_num, a in POOLED_ASSIGNMENTS.items():
        follow = st[f"a{a_num}_follow"]
        rp, _, _ = safe_corr(follow, st["avg_assignments"])
        rs, ps, ns = safe_corr(follow, st["avg_assignments"], method="spearman")
        print(f"  L{a_num} → AvgAss  {fmt_r(rp):>7} {fmt_r(rs):>7} {fmt_p(ps):>12} {ns:>5}")


def analyze_engagement(st):
    section("6. ENGAGEMENT (answers, questions, help)")

    print("""
  Engagement during lessons is naturally low — students type along
  with the teacher, leaving little time for questions. The data is
  sparse (n=4-11), so correlations with grades are unreliable.
  Instead: does ANY engagement predict passing?""")

    for metric in ["answers", "questions", "help"]:
        has = st[metric].notna() & (st[metric] > 0)
        n_engaged = has.sum()
        if n_engaged > 0:
            passed = st.loc[has, "passed_course"].sum()
            label = metric.capitalize()
            print(f"\n  {label}: {n_engaged} students had any, {passed} passed ({passed/n_engaged:.0%})")
        else:
            print(f"\n  {metric.capitalize()}: no data")

    any_engagement = (
        (st["answers"].notna() & (st["answers"] > 0)) |
        (st["questions"].notna() & (st["questions"] > 0)) |
        (st["help"].notna() & (st["help"] > 0))
    )
    n_any = any_engagement.sum()
    if n_any > 0:
        p_any = st.loc[any_engagement, "passed_course"].sum()
        n_none = (~any_engagement).sum()
        p_none = st.loc[~any_engagement, "passed_course"].sum()
        print(f"\n  Any engagement at all: {p_any}/{n_any} passed ({p_any/n_any:.0%})")
        print(f"  No engagement:         {p_none}/{n_none} passed ({p_none/n_none:.0%})")
        if n_any >= 2 and n_none >= 2:
            table = np.array([
                [p_any, n_any - p_any],
                [p_none, n_none - p_none],
            ])
            _, p_f = fisher_exact(table)
            print(f"  Fisher's exact p = {fmt_p(p_f)}")


def analyze_ai_persistence(st):
    section("7. AI USAGE PATTERNS OVER TIME")

    subsection("AI flag rate per assignment")
    print()
    for a_num, a in POOLED_ASSIGNMENTS.items():
        submitted = st[f"a{a_num}_submitted"].sum()
        ai = st[f"a{a_num}_ai"].sum()
        rate = ai / submitted if submitted > 0 else 0
        tag = " ← easy" if a["difficulty"] == "easy" else ""
        print(f"    {a['name']:<10} {ai:>3}/{submitted:<3}  ({rate:.0%}){tag}")


def analyze_assignment_difficulty(st):
    section("8. ASSIGNMENT DIFFICULTY PROGRESSION")

    subsection("Average grade & trouble rate per assignment")
    print(f"\n  {'Assign':<10} {'Avg grade':>10} {'Submitted':>10} {'Trouble%':>10} {'NoShow':>8}")
    print(f"  {'-'*10} {'-'*10} {'-'*10} {'-'*10} {'-'*8}")

    for a_num, a in POOLED_ASSIGNMENTS.items():
        grades = st[f"a{a_num}_grade"].dropna()
        submitted = st[f"a{a_num}_submitted"].sum()
        troubles = st[f"a{a_num}_trouble"].sum()
        no_show_count = submitted - st[f"a{a_num}_pass_clean"].sum() - \
                        (st[f"a{a_num}_status"].isin(["Pass*", "Pass'", "Fail", "Fail*"])).sum()
        trouble_rate = troubles / submitted if submitted > 0 else 0
        print(f"  {a['name']:<10} {grades.mean():>10.2f} {submitted:>10} {trouble_rate:>9.0%} {no_show_count:>8}")

    subsection("Grade comparison: AI users vs. non-AI users")
    print(f"\n  {'Assign':<10} {'AI avg':>8} {'n':>4} {'NoAI avg':>10} {'n':>4} {'Diff':>8}")
    print(f"  {'-'*10} {'-'*8} {'-'*4} {'-'*10} {'-'*4} {'-'*8}")

    for a_num, a in POOLED_ASSIGNMENTS.items():
        ai_grades = st.loc[st[f"a{a_num}_ai"], f"a{a_num}_grade"].dropna()
        noai_mask = (~st[f"a{a_num}_ai"]) & (st[f"a{a_num}_submitted"]) & (st[f"a{a_num}_obs"] != "")
        noai_grades = st.loc[noai_mask, f"a{a_num}_grade"].dropna()

        ai_m = ai_grades.mean() if len(ai_grades) > 0 else float("nan")
        nai_m = noai_grades.mean() if len(noai_grades) > 0 else float("nan")
        diff = ai_m - nai_m if not (np.isnan(ai_m) or np.isnan(nai_m)) else float("nan")
        print(f"  {a['name']:<10} {ai_m:>8.2f} {len(ai_grades):>4} {nai_m:>10.2f} {len(noai_grades):>4} {diff:>+8.2f}")


def analyze_per_language_follow(st):
    section("LANGUAGE-SPECIFIC FOLLOW SCORES")

    print("""
  Each lesson tracks how closely the student followed the teacher
  separately for HTML, CSS, and JS. This breakdown reveals which
  language a student struggled with even when the overall follow
  score looks fine.""")

    subsection("Per-lesson, per-language follow vs assignment grade")
    print(f"\n  {'Lesson':<12} {'Lang':<5} {'r':>7} {'ρ':>7} {'p(ρ)':>12} {'n':>5}")
    print(f"  {'-'*12} {'-'*5} {'-'*7} {'-'*7} {'-'*12} {'-'*5}")
    for a_num, a in POOLED_ASSIGNMENTS.items():
        grade = st[f"a{a_num}_grade"]
        for lang in ("html", "css", "js"):
            col = f"a{a_num}_follow_{lang}"
            if col not in st.columns:
                continue
            follow = st[col]
            if follow.notna().sum() < 3:
                continue
            rp, _, _ = safe_corr(follow, grade)
            rs, ps, ns = safe_corr(follow, grade, method="spearman")
            print(f"  {a['name']:<12} {lang.upper():<5} {fmt_r(rp):>7} "
                  f"{fmt_r(rs):>7} {fmt_p(ps):>12} {ns:>5}")

    subsection("Mean follow per language (across all lessons) vs final grade")
    print(f"\n  {'Lang':<6} {'mean':>7} {'r':>7} {'ρ':>7} {'p(ρ)':>12} {'n':>5}")
    print(f"  {'-'*6} {'-'*7} {'-'*7} {'-'*7} {'-'*12} {'-'*5}")
    for lang in ("html", "css", "js"):
        mf = st.get(f"mean_follow_{lang}")
        if mf is None or mf.notna().sum() < 3:
            continue
        rp, _, _ = safe_corr(mf, st["final_grade"])
        rs, ps, ns = safe_corr(mf, st["final_grade"], method="spearman")
        mean_s = f"{mf.mean():.1f}" if mf.notna().any() else "—"
        print(f"  {lang.upper():<6} {mean_s:>7} {fmt_r(rp):>7} "
              f"{fmt_r(rs):>7} {fmt_p(ps):>12} {ns:>5}")


def analyze_lesson_interactions(st):
    section("LESSON-LEVEL INTERACTIONS (A / Q / H)")

    print("""
  Per-lesson counts of A (answers given), Q (questions asked), and
  H (help received). Sparse per student, but pooled across lessons
  might reveal engagement effects on outcomes.""")

    subsection("Mean interactions per lesson — passed vs failed students")
    print(f"\n  {'Lesson':<12} {'Pass A':>8} {'Fail A':>8} {'Pass Q':>8} "
          f"{'Fail Q':>8} {'Pass H':>8} {'Fail H':>8}")
    print(f"  {'-'*12} {'-'*8} {'-'*8} {'-'*8} {'-'*8} {'-'*8} {'-'*8}")
    for a_num, a in POOLED_ASSIGNMENTS.items():
        passed = st["passed_course"]
        cells = []
        for k in ("intA", "intQ", "intH"):
            col = f"a{a_num}_{k}"
            if col not in st.columns:
                cells.extend(["—", "—"])
                continue
            pa = st.loc[passed, col].dropna()
            fa = st.loc[~passed, col].dropna()
            cells.append(f"{pa.mean():.2f}" if len(pa) else "—")
            cells.append(f"{fa.mean():.2f}" if len(fa) else "—")
        print(f"  {a['name']:<12} {cells[0]:>8} {cells[1]:>8} {cells[2]:>8} "
              f"{cells[3]:>8} {cells[4]:>8} {cells[5]:>8}")

    subsection("Total lesson interactions vs final grade")
    for key, label in (("answers", "Answers"),
                       ("questions", "Questions"),
                       ("help", "Help")):
        tot = st.get(f"total_{key}_lessons")
        if tot is None or (isinstance(tot, pd.Series) and tot.sum() == 0):
            continue
        rp, _, _ = safe_corr(tot, st["final_grade"])
        rs, ps, ns = safe_corr(tot, st["final_grade"], method="spearman")
        print(f"  {label:<10} → final grade   r = {fmt_r(rp)}  "
              f"ρ = {fmt_r(rs)}  p = {fmt_p(ps)}  n = {ns}")


def analyze_comment_diff(st):
    section("COMMENT WRITING (C+ / C- / C Diff)")

    print("""
  C+     = extra comment-tokens beyond the teacher's
  C-     = comment-tokens the student is missing vs teacher
  C Diff = C+ - C- (positive: wrote more comments than teacher;
                   negative: wrote fewer)""")

    subsection("Per-lesson — Spearman ρ vs paired assignment grade")
    print(f"\n  {'Lesson':<12} "
          f"{'mean C+':>8} {'ρ(C+)':>8} {'p':>10}  "
          f"{'mean C-':>8} {'ρ(C-)':>8} {'p':>10}  "
          f"{'mean Δ':>8} {'ρ(Δ)':>8} {'p':>10}  {'n':>4}")
    print(f"  {'-'*12} "
          f"{'-'*8} {'-'*8} {'-'*10}  "
          f"{'-'*8} {'-'*8} {'-'*10}  "
          f"{'-'*8} {'-'*8} {'-'*10}  {'-'*4}")
    for a_num, a in POOLED_ASSIGNMENTS.items():
        col = f"a{a_num}_cdiff"
        if col not in st.columns:
            continue
        cdiff = st[col]
        if cdiff.notna().sum() < 3:
            continue
        grade = st[f"a{a_num}_grade"]
        cp = st.get(f"a{a_num}_cplus")
        cm = st.get(f"a{a_num}_cminus")

        rs_d, ps_d, ns = safe_corr(cdiff, grade, method="spearman")
        rs_p, ps_p, _ = (
            safe_corr(cp, grade, method="spearman") if cp is not None
            else (float("nan"), float("nan"), 0)
        )
        rs_m, ps_m, _ = (
            safe_corr(cm, grade, method="spearman") if cm is not None
            else (float("nan"), float("nan"), 0)
        )

        cp_s = f"{cp.mean():.1f}" if cp is not None and cp.notna().any() else "—"
        cm_s = f"{cm.mean():.1f}" if cm is not None and cm.notna().any() else "—"
        cd_s = f"{cdiff.mean():+.1f}"

        print(f"  {a['name']:<12} "
              f"{cp_s:>8} {fmt_r(rs_p):>8} {fmt_p(ps_p):>10}  "
              f"{cm_s:>8} {fmt_r(rs_m):>8} {fmt_p(ps_m):>10}  "
              f"{cd_s:>8} {fmt_r(rs_d):>8} {fmt_p(ps_d):>10}  {ns:>4}")

    subsection("Totals across lessons vs final grade & assignment average")
    print(f"\n  {'Metric':<24} "
          f"{'mean':>8} "
          f"{'ρ→Final':>10} {'p':>10}  "
          f"{'ρ→Avg':>10} {'p':>10}  {'n':>4}")
    print(f"  {'-'*24} {'-'*8} "
          f"{'-'*10} {'-'*10}  {'-'*10} {'-'*10}  {'-'*4}")

    for label, key in (
        ("Total C+ (extra)",        "total_comment_extra"),
        ("Total C- (missing)",      "total_comment_missing"),
        ("Total C Diff (surplus)",  "total_comment_diff"),
    ):
        if key not in st.columns:
            continue
        tot = st[key]
        if tot.notna().sum() < 3:
            continue

        def _corr_against(target_col):
            if target_col not in st.columns:
                return float("nan"), float("nan"), 0
            return safe_corr(tot, st[target_col], method="spearman")

        rs_f, ps_f, n_f = _corr_against("final_grade")
        rs_a, ps_a, _   = _corr_against("avg_assignments")

        mean_s = f"{tot.mean():+.1f}" if "Diff" in label else f"{tot.mean():.1f}"
        print(f"  {label:<24} {mean_s:>8} "
              f"{fmt_r(rs_f):>10} {fmt_p(ps_f):>10}  "
              f"{fmt_r(rs_a):>10} {fmt_p(ps_a):>10}  {n_f:>4}")


def analyze_correlations_summary(st):
    section("9. CORRELATION SUMMARY TABLE")

    pairs = [
        ("pre_typing",      "final_grade",         "Pre-typing speed → Final grade"),
        ("self_eval",        "final_grade",         "Self-evaluation → Final grade"),
        ("participation",    "avg_assignments",     "Participation → Assign. avg (BX)"),
        ("participation",    "avg_submitted_only",  "Participation → Avg submitted only"),
        ("participation",    "pre_typing",          "Participation → Pre-typing speed"),
        ("participation",    "typing_improvement",  "Participation → Typing improvement"),
        ("participation",    "quiz_stii",           "Participation → Final quiz"),
        ("answers",          "final_grade",         "Answers given → Final grade"),
        ("questions",        "final_grade",         "Questions asked → Final grade"),
        ("help",             "final_grade",         "Help received → Final grade"),
        ("kahoot",           "final_grade",         "Kahoot score → Final grade"),
        ("quiz_stii",        "final_grade",         "Final quiz (Știi) → Final grade"),
        ("pre_typing",       "total_ai_flags",      "Pre-typing speed → AI flags"),
        ("self_eval",        "total_ai_flags",      "Self-evaluation → AI flags"),
        ("total_ai_flags",   "final_grade",         "Total AI flags → Final grade"),
        ("self_eval",        "participation",        "Self-evaluation → Participation"),
    ]

    print(f"\n  {'Relationship':<40} {'r':>7} {'ρ':>7} {'p(ρ)':>12} {'n':>5}")
    print(f"  {'-'*40} {'-'*7} {'-'*7} {'-'*12} {'-'*5}")

    for col_x, col_y, label in pairs:
        r_p, _, _ = safe_corr(st[col_x], st[col_y])
        r_s, p_s, n_s = safe_corr(st[col_x], st[col_y], method="spearman")
        print(f"  {label:<40} {fmt_r(r_p):>7} {fmt_r(r_s):>7} {fmt_p(p_s):>12} {n_s:>5}")


def _artefact_schema_for(a):
    return _raw_flags(a)


def analyze_artefacts(st):
    have = [a_num for a_num, a in ASSIGNMENTS.items()
            if _artefact_schema_for(a) and st.get(f"a{a_num}_artefact_valid") is not None
            and st[f"a{a_num}_artefact_valid"].any()]
    if not have:
        return

    section("ASSIGNMENT ARTEFACTS (OBS flags)")
    print("""
  Each assignment hides 'artefacts' that fire when a student likely leaned on AI
  (pasted the task, accepted the answer, never ran or read it). In the OBS
  column, digit 1 = the artefact FIRED; digit 0 = the student did the human thing.
  A 'hit' is a fired artefact. 'Any' = at least one artefact fired in that submission.""")

    subsection("Per-artefact hit rate per assignment (of valid OBS codes)")
    print(f"\n  {'Assign':<10} {'Artefact':<26} {'Fired':>6} {'Valid':>6} {'Hit rate':>9}")
    print(f"  {'-'*10} {'-'*26} {'-'*6} {'-'*6} {'-'*9}")
    for a_num in have:
        a = ASSIGNMENTS[a_num]
        valid = st[f"a{a_num}_artefact_valid"]
        n_valid = int(valid.sum())
        for key, label in _artefact_schema_for(a):
            fired = int(st[f"a{a_num}_artefact_{key}"].sum())
            ans_col = f"a{a_num}_artefact_{key}_ans"
            n_ans = int(st[ans_col].sum()) if ans_col in st.columns else n_valid
            rate = fired / n_ans if n_ans else float("nan")
            print(f"  {a['name']:<10} {label[:26]:<26} {fired:>6} {n_ans:>6} {rate:>8.0%}")
        any_fired = int(st[f"a{a_num}_any_artefact"].sum())
        any_rate = any_fired / n_valid if n_valid else float("nan")
        tag = " ← easy" if a["difficulty"] == "easy" else ""
        print(f"  {a['name']:<10} {'ANY artefact fired':<26} {any_fired:>6} {n_valid:>6} "
              f"{any_rate:>8.0%}{tag}")

    subsection("Artefact fired vs. trouble (per artefact) — Fisher exact + odds ratio")
    print(f"\n  {'Assign':<10} {'Artefact':<24} {'Fire+Trbl':>9} {'Fire+OK':>8} "
          f"{'Ok+Trbl':>8} {'Ok+OK':>6} {'OR':>7} {'p':>10}")
    print(f"  {'-'*10} {'-'*24} {'-'*9} {'-'*8} {'-'*8} {'-'*6} {'-'*7} {'-'*10}")
    for a_num in have:
        a = ASSIGNMENTS[a_num]
        trouble = st[f"a{a_num}_trouble"]
        valid = st[f"a{a_num}_artefact_valid"]
        for key, label in _artefact_schema_for(a):
            fired = st[f"a{a_num}_artefact_{key}"]
            ans_col = f"a{a_num}_artefact_{key}_ans"
            ans = st[ans_col] if ans_col in st.columns else valid
            ok = ans & ~fired
            ft = int((fired & trouble).sum())
            fo = int((fired & ~trouble).sum())
            ot = int((ok & trouble).sum())
            oo = int((ok & ~trouble).sum())
            if fo * ot > 0:
                orv = (ft * oo) / (fo * ot)
            elif (ft + ot) > 0 and (fo + oo) >= 0:
                orv = float("inf") if ft > 0 else float("nan")
            else:
                orv = float("nan")
            if min(ft + fo, ot + oo) > 0:
                _, p_f = fisher_exact(np.array([[ft, fo], [ot, oo]]))
            else:
                p_f = float("nan")
            or_s = f"{orv:.1f}×" if not (np.isnan(orv) or np.isinf(orv)) else (
                "inf" if np.isinf(orv) else "N/A")
            print(f"  {a['name']:<10} {label[:24]:<24} {ft:>9} {fo:>8} {ot:>8} "
                  f"{oo:>6} {or_s:>7} {fmt_p(p_f):>10}")

    subsection("Artefact fired vs. grade (per artefact) — mean assignment grade")
    print(f"\n  {'Assign':<10} {'Artefact':<26} {'Fired avg':>10} {'n':>4} "
          f"{'Ok avg':>8} {'n':>4} {'Diff':>7}")
    print(f"  {'-'*10} {'-'*26} {'-'*10} {'-'*4} {'-'*8} {'-'*4} {'-'*7}")
    for a_num in have:
        a = ASSIGNMENTS[a_num]
        grade = st[f"a{a_num}_grade"]
        valid = st[f"a{a_num}_artefact_valid"]
        for key, label in _artefact_schema_for(a):
            fired = st[f"a{a_num}_artefact_{key}"]
            ans_col = f"a{a_num}_artefact_{key}_ans"
            ans = st[ans_col] if ans_col in st.columns else valid
            fg = grade[fired].dropna()
            og = grade[ans & ~fired].dropna()
            fm = fg.mean() if len(fg) else float("nan")
            om = og.mean() if len(og) else float("nan")
            diff = fm - om if not (np.isnan(fm) or np.isnan(om)) else float("nan")
            print(f"  {a['name']:<10} {label[:26]:<26} {fm:>10.2f} {len(fg):>4} "
                  f"{om:>8.2f} {len(og):>4} {diff:>+7.2f}")

    subsection("Per-student total artefacts fired")
    tot = st["total_artefacts_fired"]
    has_tot = tot.notna()
    if has_tot.any():
        print(f"\n  Students with any decoded OBS: {int(has_tot.sum())}")
        print(f"  Total artefacts fired — mean = {tot[has_tot].mean():.2f}, "
              f"max = {int(tot[has_tot].max())}")
        r, p, n = safe_corr(tot, st["final_grade"], method="spearman")
        print(f"  Total artefacts fired vs final grade:  ρ = {fmt_r(r)}, "
              f"p = {fmt_p(p)}, n = {n}")
        r, p, n = safe_corr(tot, st["participation"], method="spearman")
        print(f"  Total artefacts fired vs participation: ρ = {fmt_r(r)}, "
              f"p = {fmt_p(p)}, n = {n}")
        pass_t = tot[st["passed_course"] & has_tot].dropna()
        fail_t = tot[~st["passed_course"] & has_tot].dropna()
        if len(pass_t) >= 2 and len(fail_t) >= 2:
            _, p_mw = mannwhitneyu(pass_t, fail_t, alternative="two-sided")
            print(f"\n  Passed course: mean artefacts fired = {pass_t.mean():.2f} (n={len(pass_t)})")
            print(f"  Failed course: mean artefacts fired = {fail_t.mean():.2f} (n={len(fail_t)})")
            print(f"  Mann-Whitney p = {fmt_p(p_mw)}")


def _basic_quartiles(vals):
    s = pd.Series(vals).dropna()
    if s.empty:
        return None
    return {
        "count":  int(s.shape[0]),
        "mean":   float(s.mean()),
        "min":    float(s.min()),
        "q1":     float(s.quantile(0.25)),
        "median": float(s.quantile(0.50)),
        "q3":     float(s.quantile(0.75)),
        "max":    float(s.max()),
    }


def _ids_of(st_subset, COL_ID):
    if COL_ID is None or st_subset is None or len(st_subset) == 0:
        return []
    out = []
    for v in _col_series(st_subset, COL_ID, numeric=False):
        s = str(v).strip()
        if s.endswith(".0"):
            s = s[:-2]
        if s:
            out.append(s)
    return out


def _divergence_stats_for(st_subset, a_num, COL_ID=None, name_lower=None):
    div_col = f"a{a_num}_diverge"
    chg_col = f"a{a_num}_change"
    if div_col not in st_subset.columns or st_subset[div_col].notna().sum() == 0:
        return None
    teacher_by_lang, teacher_total = (
        _count_teacher_tokens_for(name_lower) if name_lower else ({}, 0)
    )
    payload = {
        "teacher_total": teacher_total,
        "teacher_total_by_lang": teacher_by_lang,
        "divergence": _basic_quartiles(st_subset[div_col]),
        "change":     _basic_quartiles(st_subset[chg_col]),
        "by_lang":    {},
        "basis":      "",
        "per_student": [],
    }
    bases = st_subset.get(f"a{a_num}_diff_basis")
    if bases is not None:
        counts = bases[bases.astype(str).str.len() > 0].value_counts()
        if not counts.empty:
            payload["basis"] = counts.idxmax()
    for lang in ("html", "css", "js", "py"):
        dcol = f"a{a_num}_diverge_{lang}"
        ccol = f"a{a_num}_change_{lang}"
        if dcol not in st_subset.columns: continue
        d_summary = _basic_quartiles(st_subset[dcol])
        c_summary = _basic_quartiles(st_subset[ccol])
        if d_summary is None and c_summary is None: continue
        payload["by_lang"][lang] = {
            "divergence": d_summary, "change": c_summary,
        }
    if COL_ID is not None:
        ids = _col_series(st_subset, COL_ID, numeric=False)
        for sid_val, d, c in zip(ids, st_subset[div_col], st_subset[chg_col]):
            if pd.isna(d) and pd.isna(c): continue
            sid = str(sid_val).strip()
            if sid.endswith(".0"): sid = sid[:-2]
            if not sid: continue
            entry = {
                "id": sid,
                "divergence": int(d) if not pd.isna(d) else None,
                "change":     int(c) if not pd.isna(c) else None,
            }
            if teacher_total > 0:
                if entry["divergence"] is not None:
                    entry["divergence_pct"] = round(
                        100.0 * entry["divergence"] / teacher_total, 2
                    )
                if entry["change"] is not None:
                    entry["change_pct"] = round(
                        100.0 * entry["change"] / teacher_total, 2
                    )
            payload["per_student"].append(entry)
    return payload


def _build_cofiring(st_subset, COL_ID):
    if len(st_subset) == 0:
        return []
    out = []
    for a_num, a in ASSIGNMENTS.items():
        valid_col = f"a{a_num}_artefact_valid"
        if valid_col not in st_subset.columns:
            continue
        valid = st_subset[valid_col].astype(bool)
        schema = _artefact_schema_for(a)
        if not schema:
            continue
        severity_map = _load_artefact_severity(a.get("lower", ""))
        marks = []
        for key, label in schema:
            col = f"a{a_num}_artefact_{key}"
            if col not in st_subset.columns: continue
            marks.append({
                "key":      key,
                "label":    label,
                "severity": severity_map.get(key, ""),
                "fired":    st_subset[col].astype(bool),
            })
        for mx in marks:
            n_x = int(mx["fired"].sum())
            if n_x == 0:
                continue
            for my in marks:
                if my["key"] == mx["key"]:
                    continue
                joint = mx["fired"] & my["fired"] & valid
                n_xy = int(joint.sum())
                if n_xy < 3:
                    continue
                base_n = int(my["fired"].sum())
                base_total = int(valid.sum())
                p_y = base_n / base_total if base_total else None
                xy_universe = int((mx["fired"] & valid).sum())
                p_y_given_x = (n_xy / xy_universe) if xy_universe else None
                lift = (p_y_given_x / p_y) if (p_y and p_y > 0) else None
                out.append({
                    "assignment": a["lower"],
                    "assn_name":  a["name"],
                    "x_key":      mx["key"],
                    "x_label":    mx["label"],
                    "x_severity": mx["severity"],
                    "y_key":      my["key"],
                    "y_label":    my["label"],
                    "y_severity": my["severity"],
                    "n_x":        n_x,
                    "n_xy":       n_xy,
                    "p_y":          round(p_y, 6) if p_y is not None else None,
                    "p_y_given_x":  round(p_y_given_x, 6) if p_y_given_x is not None else None,
                    "lift":         round(lift, 4) if lift is not None else None,
                    "joint_ids":    _ids_of(st_subset[joint], COL_ID),
                })
    return out


def _build_curated_moments(st_subset, COL_ID):
    moments_out = []
    for a_num, a in ASSIGNMENTS.items():
        moments = _load_curated_moments(a["lower"])
        if not moments: continue
        valid_col = f"a{a_num}_artefact_valid"
        if valid_col not in st_subset.columns: continue
        valid = st_subset[valid_col].astype(bool)
        n_valid = int(valid.sum())
        if n_valid == 0: continue
        per_moment = []
        for m in moments:
            col = f"a{a_num}_artefact_{m['key']}"
            if col not in st_subset.columns: continue
            fired = st_subset[col].astype(bool) & valid
            if m["polarity"] == "fired":
                reached_mask = fired
            else:  # not_fired
                reached_mask = valid & ~fired
            missed_mask = valid & ~reached_mask
            per_moment.append({
                "key":          m["key"],
                "label":        m["label"],
                "polarity":     m["polarity"],
                "n_valid":      n_valid,
                "n_reached":    int(reached_mask.sum()),
                "n_missed":     int(missed_mask.sum()),
                "missed_ids":   _ids_of(st_subset[missed_mask], COL_ID),
                "reached_ids":  _ids_of(st_subset[reached_mask], COL_ID),
            })
        if per_moment:
            moments_out.append({
                "assignment": a["lower"],
                "name":       a["name"],
                "moments":    per_moment,
            })
    return moments_out


def save_stats_json(st, grades_path):

    def sf(v):
        if v is None: return None
        try:
            f = float(v)
            return None if math.isnan(f) or math.isinf(f) else round(f, 6)
        except (TypeError, ValueError):
            return None

    is_llm = (st["is_llm"] if "is_llm" in st.columns
              else pd.Series([False] * len(st), index=st.index))
    st_students = st[~is_llm].reset_index(drop=True)
    st_llm      = st[is_llm].reset_index(drop=True)

    result = {
        "generated": datetime.now().isoformat(),
        "n_students": int(len(st_students)),
        "n_llm":      int(len(st_llm)),
        "n_passed":   int(st_students["passed_course"].sum()),
        "n_failed":   int((~st_students["passed_course"]).sum()),
        "assignments": [],
        "llm_assignments": [],
        "correlations": [],
        "typing": {},
        "ai_overall": {},
        "artefact_schema": {
            a["lower"]: [
                {
                    "key":      k,
                    "label":    lbl,
                    "severity": _load_artefact_severity(a["lower"]).get(k, ""),
                }
                for k, lbl in _raw_flags(a)
            ]
            for a in ASSIGNMENTS.values() if _raw_flags(a)
        },
        "llm_rows": [
            {
                "id": str(_id).strip(),
                "name": str(_name).strip(),
            }
            for _id, _name in zip(
                _col_series(st_llm, COL.get("id"), numeric=False)
                if COL.get("id") is not None else pd.Series([], dtype=object),
                _col_series(st_llm, COL.get("name"), numeric=False)
                if COL.get("name") is not None else pd.Series([], dtype=object),
            )
        ],
    }

    for a_num, a in ASSIGNMENTS.items():
        sub_mask   = st_students[f"a{a_num}_submitted"]
        n_sub      = int(sub_mask.sum())
        n_total    = len(st_students)
        grades     = st_students.loc[sub_mask, f"a{a_num}_grade"].dropna()
        n_pass     = int(st_students[f"a{a_num}_passed"].sum())  if f"a{a_num}_passed"  in st_students.columns else 0
        n_trouble  = int(st_students[f"a{a_num}_trouble"].sum()) if f"a{a_num}_trouble" in st_students.columns else 0
        n_ai       = int(st_students[f"a{a_num}_ai"].sum())      if f"a{a_num}_ai"      in st_students.columns else 0

        n_lesson_trouble = (
            int(st_students[f"a{a_num}_lesson_trouble"].sum())
            if f"a{a_num}_lesson_trouble" in st_students.columns else 0
        )
        entry = {
            "name":            a["name"],
            "difficulty":      a.get("difficulty", ""),
            "n_submitted":     n_sub,
            "n_total":         n_total,
            "n_trouble":       n_trouble,
            "n_lesson_trouble":n_lesson_trouble,
            "n_ai":            n_ai,
            "avg_grade":       sf(grades.mean()) if len(grades) > 0 else None,
            "pass_rate":       sf(n_pass / n_total) if n_total > 0 else None,
            "trouble_rate":    sf(n_trouble / n_sub) if n_sub > 0 else None,
            "ai_rate":         sf(n_ai / n_sub) if n_sub > 0 else None,
            "follow_avg":      None,
            "odds_ratio":      None,
            "fisher_p":        None,
        }

        if a["follow"] is not None:
            fv = st_students[f"a{a_num}_follow"].dropna()
            entry["follow_avg"] = sf(fv.mean()) if len(fv) > 0 else None
            entry["n_followed"] = int((fv > 0).sum())

            gv     = st_students[f"a{a_num}_grade"]
            ai_col = st_students[f"a{a_num}_ai"]
            mask   = fv.notna() & gv.notna()
            entry["scatter"] = [
                {"x": round(float(fx), 1), "y": round(float(gx), 2), "ai": bool(ax)}
                for fx, gx, ax in zip(fv[mask], gv[mask], ai_col[mask])
            ]

        if a_num in POOLED_ASSIGNMENTS:
            ai       = st_students[f"a{a_num}_ai"]
            trouble  = st_students[f"a{a_num}_trouble"]
            passed   = st_students[f"a{a_num}_passed"]
            has_obs  = st_students[f"a{a_num}_obs"] != ""

            ai_t  = int((ai & trouble).sum())
            ai_p  = int((ai & passed).sum())
            nai_t = int((~ai & trouble & has_obs).sum())
            nai_p = int((~ai & passed & has_obs).sum())

            entry["ai_trouble"]    = ai_t
            entry["ai_pass"]       = ai_p
            entry["no_ai_trouble"] = nai_t
            entry["no_ai_pass"]    = nai_p

            if ai_p > 0 and nai_t > 0:
                entry["odds_ratio"] = sf((ai_t * nai_p) / (ai_p * nai_t))
            if min(ai_t + ai_p, nai_t + nai_p) > 0 and (ai_t + nai_t) > 0:
                _, p_f = fisher_exact(np.array([[ai_t, ai_p], [nai_t, nai_p]]))
                entry["fisher_p"] = sf(p_f)

            ai_grades   = st_students.loc[ai, f"a{a_num}_grade"].dropna()
            noai_mask   = (~ai) & sub_mask & has_obs
            noai_grades = st_students.loc[noai_mask, f"a{a_num}_grade"].dropna()
            entry["ai_avg_grade"]   = sf(ai_grades.mean())   if len(ai_grades)   > 0 else None
            entry["no_ai_avg_grade"]= sf(noai_grades.mean()) if len(noai_grades) > 0 else None

        schema = _artefact_schema_for(a)
        severity_map = _load_artefact_severity(a.get("lower", ""))
        if schema and f"a{a_num}_artefact_valid" in st_students.columns:
            valid   = st_students[f"a{a_num}_artefact_valid"]
            n_valid = int(valid.sum())
            trouble = st_students[f"a{a_num}_trouble"]
            grade   = st_students[f"a{a_num}_grade"]
            entry["lower"]        = a["lower"]
            entry["n_artefact_valid"] = n_valid
            entry["any_artefact_fired"] = int(st_students[f"a{a_num}_any_artefact"].sum())
            entry["any_artefact_rate"]  = sf(entry["any_artefact_fired"] / n_valid) if n_valid else None
            if f"a{a_num}_ai_high" in st_students.columns:
                entry["n_ai_high"]    = int(st_students[f"a{a_num}_ai_high"].sum())
                entry["ai_high_rate"] = sf(entry["n_ai_high"] / n_valid) if n_valid else None
            llm_hit_by_key: dict = {}
            if len(st_llm) > 0 and f"a{a_num}_artefact_valid" in st_llm.columns:
                llm_valid = st_llm[f"a{a_num}_artefact_valid"]
                for key, _lbl in schema:
                    fcol = f"a{a_num}_artefact_{key}"
                    acol = f"a{a_num}_artefact_{key}_ans"
                    if fcol not in st_llm.columns: continue
                    f_llm = st_llm[fcol]
                    a_llm = st_llm[acol] if acol in st_llm.columns else llm_valid
                    n_a = int(a_llm.sum()); n_f = int(f_llm.sum())
                    llm_hit_by_key[key] = {
                        "n_answered": n_a,
                        "n_fired":    n_f,
                        "hit_rate":   sf(n_f / n_a) if n_a else None,
                    }
            artefacts = []
            for key, label in schema:
                fired = st_students[f"a{a_num}_artefact_{key}"]
                ans_col = f"a{a_num}_artefact_{key}_ans"
                ans = st_students[ans_col] if ans_col in st_students.columns else valid
                ok    = ans & ~fired
                n_ans = int(ans.sum())
                n_f   = int(fired.sum())
                ft, fo = int((fired & trouble).sum()), int((fired & ~trouble).sum())
                ot, oo = int((ok & trouble).sum()),    int((ok & ~trouble).sum())
                orv = (ft * oo) / (fo * ot) if fo * ot > 0 else None
                p_f = None
                if min(ft + fo, ot + oo) > 0:
                    _, p_f = fisher_exact(np.array([[ft, fo], [ot, oo]]))
                fg = grade[fired].dropna()
                og = grade[ok].dropna()
                fired_ids = _ids_of(st_students[fired], COL.get("id"))
                artefacts.append({
                    "key":           key,
                    "label":         label,
                    "severity":      severity_map.get(key, ""),
                    "n_answered":    n_ans,
                    "n_fired":       n_f,
                    "hit_rate":      sf(n_f / n_ans) if n_ans else None,
                    "fired_trouble": ft, "fired_ok": fo,
                    "ok_trouble":    ot, "safe_ok": oo,
                    "odds_ratio":    sf(orv),
                    "fisher_p":      sf(p_f),
                    "fired_avg_grade": sf(fg.mean()) if len(fg) else None,
                    "ok_avg_grade":    sf(og.mean()) if len(og) else None,
                    "fired_ids":     fired_ids,
                    "llm_hit_rate":  llm_hit_by_key.get(key, {}).get("hit_rate"),
                    "llm_n_fired":   llm_hit_by_key.get(key, {}).get("n_fired"),
                    "llm_n_answered":llm_hit_by_key.get(key, {}).get("n_answered"),
                })
            entry["artefacts"] = artefacts

        div_payload = _divergence_stats_for(
            st_students, a_num, COL.get("id"), name_lower=a["lower"],
        )
        if div_payload is not None:
            entry["divergence"] = div_payload

        result["assignments"].append(entry)

    for a_num, a in ASSIGNMENTS.items():
        if len(st_llm) == 0:
            break
        entry = {
            "name":    a["name"],
            "lower":   a["lower"],
            "n_total": len(st_llm),
            "artefacts":   [],
        }
        schema = _artefact_schema_for(a)
        valid_col = f"a{a_num}_artefact_valid"
        if schema and valid_col in st_llm.columns:
            valid = st_llm[valid_col]
            n_valid = int(valid.sum())
            entry["n_artefact_valid"]   = n_valid
            entry["any_artefact_fired"] = int(st_llm[f"a{a_num}_any_artefact"].sum())
            if n_valid:
                entry["any_artefact_rate"] = sf(entry["any_artefact_fired"] / n_valid)
            for key, label in schema:
                fired = st_llm[f"a{a_num}_artefact_{key}"]
                ans_col = f"a{a_num}_artefact_{key}_ans"
                ans = st_llm[ans_col] if ans_col in st_llm.columns else valid
                n_ans = int(ans.sum()); n_f = int(fired.sum())
                entry["artefacts"].append({
                    "key":       key,
                    "label":     label,
                    "n_answered":n_ans,
                    "n_fired":   n_f,
                    "hit_rate":  sf(n_f / n_ans) if n_ans else None,
                    "fired_ids": _ids_of(st_llm[fired], COL.get("id")),
                })
        div_payload = _divergence_stats_for(
            st_llm, a_num, COL.get("id"), name_lower=a["lower"],
        )
        if div_payload is not None:
            entry["divergence"] = div_payload
        result["llm_assignments"].append(entry)

    result["cofiring"] = _build_cofiring(st_students, COL.get("id"))
    result["curated_moments"] = _build_curated_moments(st_students, COL.get("id"))

    st = st_students

    corr_pairs = [
        ("pre_typing",      "final_grade",        "Pre-typing KPM → Final grade"),
        ("post_typing",     "final_grade",        "Post-typing KPM → Final grade"),
        ("self_eval",       "final_grade",        "Self-evaluation → Final grade"),
        ("participation",   "avg_assignments",    "Participation → Assign. avg (BX)"),
        ("participation",   "avg_submitted_only", "Participation → Avg submitted only"),
        ("participation",   "pre_typing",         "Participation → Pre-typing speed"),
        ("participation",   "typing_improvement", "Participation → Typing improvement"),
        ("participation",   "quiz_stii",          "Participation → Final quiz"),
        ("answers",         "final_grade",        "Answers given → Final grade"),
        ("questions",       "final_grade",        "Questions asked → Final grade"),
        ("help",            "final_grade",        "Help received → Final grade"),
        ("kahoot",          "final_grade",        "Kahoot score → Final grade"),
        ("quiz_stii",       "final_grade",        "Final quiz → Final grade"),
        ("pre_typing",      "total_ai_flags",     "Pre-typing KPM → AI flags"),
        ("self_eval",       "total_ai_flags",     "Self-evaluation → AI flags"),
        ("total_ai_flags",  "final_grade",        "Total AI flags → Final grade"),
        ("self_eval",       "participation",      "Self-evaluation → Participation"),
    ]
    for col_x, col_y, label in corr_pairs:
        if col_x not in st.columns or col_y not in st.columns:
            continue
        r_p, p_p, _ = safe_corr(st[col_x], st[col_y])
        r_s, p_s, n_s = safe_corr(st[col_x], st[col_y], method="spearman")
        result["correlations"].append({
            "label": label,
            "r": sf(r_p), "p_r": sf(p_p),
            "rho": sf(r_s), "p_rho": sf(p_s),
            "n": n_s,
        })

    result["follow_vs_grade"] = []
    for a_num, a in POOLED_ASSIGNMENTS.items():
        follow = st[f"a{a_num}_follow"]
        grade  = st[f"a{a_num}_grade"]
        r_p, p_p, _ = safe_corr(follow, grade)
        r_s, p_s, n_s = safe_corr(follow, grade, method="spearman")
        result["follow_vs_grade"].append({
            "name": a["name"], "n": n_s,
            "r": sf(r_p), "p_r": sf(p_p),
            "rho": sf(r_s), "p_rho": sf(p_s),
        })

    result["per_language_follow"] = []
    for lang in ("html", "css", "js"):
        mf = st.get(f"mean_follow_{lang}")
        if mf is None or mf.notna().sum() < 3:
            continue
        r_p, p_p, _ = safe_corr(mf, st["final_grade"])
        r_s, p_s, n_s = safe_corr(mf, st["final_grade"], method="spearman")
        result["per_language_follow"].append({
            "lang": lang.upper(),
            "mean": sf(mf.mean()),
            "n": n_s,
            "r": sf(r_p), "p_r": sf(p_p),
            "rho": sf(r_s), "p_rho": sf(p_s),
        })

    result["per_language_follow_per_lesson"] = []
    for a_num, a in POOLED_ASSIGNMENTS.items():
        grade = st[f"a{a_num}_grade"]
        for lang in ("html", "css", "js"):
            col = f"a{a_num}_follow_{lang}"
            if col not in st.columns:
                continue
            follow = st[col]
            if follow.notna().sum() < 3:
                continue
            r_p, _, _ = safe_corr(follow, grade)
            r_s, p_s, n_s = safe_corr(follow, grade, method="spearman")
            result["per_language_follow_per_lesson"].append({
                "lesson": a["name"], "lang": lang.upper(), "n": n_s,
                "r": sf(r_p), "rho": sf(r_s), "p_rho": sf(p_s),
                "mean": sf(follow.mean()),
            })

    result["lesson_interactions"] = []
    for a_num, a in POOLED_ASSIGNMENTS.items():
        entry = {"lesson": a["name"]}
        for key, label in (("intA", "A"), ("intQ", "Q"), ("intH", "H")):
            col = f"a{a_num}_{key}"
            if col not in st.columns:
                continue
            s = st[col].dropna()
            entry[f"{label}_sum"] = int(s.sum()) if len(s) else 0
            entry[f"{label}_mean"] = sf(s.mean()) if len(s) else None
        result["lesson_interactions"].append(entry)

    result["comment_diff_per_lesson"] = []
    for a_num, a in POOLED_ASSIGNMENTS.items():
        col = f"a{a_num}_cdiff"
        if col not in st.columns:
            continue
        cdiff = st[col]
        if cdiff.notna().sum() < 3:
            continue
        grade = st[f"a{a_num}_grade"]
        cp = st.get(f"a{a_num}_cplus")
        cm = st.get(f"a{a_num}_cminus")

        r_p, _, _ = safe_corr(cdiff, grade)
        r_s, p_s, n_s = safe_corr(cdiff, grade, method="spearman")
        r_p_p, _, _ = (safe_corr(cp, grade) if cp is not None
                       else (float("nan"), float("nan"), 0))
        r_s_p, p_s_p, _ = (safe_corr(cp, grade, method="spearman")
                            if cp is not None
                            else (float("nan"), float("nan"), 0))
        r_p_m, _, _ = (safe_corr(cm, grade) if cm is not None
                       else (float("nan"), float("nan"), 0))
        r_s_m, p_s_m, _ = (safe_corr(cm, grade, method="spearman")
                            if cm is not None
                            else (float("nan"), float("nan"), 0))

        result["comment_diff_per_lesson"].append({
            "lesson":       a["name"],
            "n":            n_s,
            "r":            sf(r_p),
            "rho":          sf(r_s),
            "p_rho":        sf(p_s),
            "r_cplus":      sf(r_p_p),
            "rho_cplus":    sf(r_s_p),
            "p_cplus":      sf(p_s_p),
            "r_cminus":     sf(r_p_m),
            "rho_cminus":   sf(r_s_m),
            "p_cminus":     sf(p_s_m),
            "mean_cdiff":   sf(cdiff.mean()),
            "mean_cplus":   sf(cp.mean()) if cp is not None and cp.notna().any() else None,
            "mean_cminus":  sf(cm.mean()) if cm is not None and cm.notna().any() else None,
        })

    result["comment_totals"] = []
    for label, key in (
        ("Total C+ (extra)",       "total_comment_extra"),
        ("Total C- (missing)",     "total_comment_missing"),
        ("Total C Diff (surplus)", "total_comment_diff"),
    ):
        if key not in st.columns:
            continue
        tot = st[key]
        if tot.notna().sum() < 3:
            continue
        entry = {"label": label, "mean": sf(tot.mean())}
        for target_label, target_col in (
            ("final_grade",     "final_grade"),
            ("avg_assignments", "avg_assignments"),
        ):
            if target_col not in st.columns:
                continue
            r_p, p_p, _ = safe_corr(tot, st[target_col])
            r_s, p_s, n_s = safe_corr(tot, st[target_col],
                                       method="spearman")
            entry[f"{target_label}_n"]     = n_s
            entry[f"{target_label}_r"]     = sf(r_p)
            entry[f"{target_label}_rho"]   = sf(r_s)
            entry[f"{target_label}_p_rho"] = sf(p_s)
        result["comment_totals"].append(entry)

    pre  = st["pre_typing"].dropna()
    post = st["post_typing"].dropna()
    has_both = st["pre_typing"].notna() & st["post_typing"].notna()
    imp = st.loc[has_both, "typing_improvement"].dropna()
    pass_t = st.loc[st["passed_course"], "pre_typing"].dropna()
    fail_t = st.loc[~st["passed_course"], "pre_typing"].dropna()

    typing = {
        "pre_avg":         sf(pre.mean())  if len(pre)  > 0 else None,
        "post_avg":        sf(post.mean()) if len(post) > 0 else None,
        "improvement_avg": sf(imp.mean())  if len(imp)  > 0 else None,
        "n_with_both":     int(has_both.sum()),
        "passed_pre_avg":  sf(pass_t.mean()) if len(pass_t) > 0 else None,
        "failed_pre_avg":  sf(fail_t.mean()) if len(fail_t) > 0 else None,
    }
    if len(pass_t) >= 2 and len(fail_t) >= 2:
        from scipy.stats import mannwhitneyu as _mwu
        _, p_mw = _mwu(pass_t, fail_t, alternative="two-sided")
        typing["pass_fail_mannwhitney_p"] = sf(p_mw)
    r_p, p_p, _ = safe_corr(st["pre_typing"], st["final_grade"])
    r_s, p_s, n_s = safe_corr(st["pre_typing"], st["final_grade"], method="spearman")
    typing["corr_pre_grade"] = {"r": sf(r_p), "rho": sf(r_s), "p_rho": sf(p_s), "n": n_s}
    r_p, p_p, _ = safe_corr(st["post_typing"], st["final_grade"])
    r_s, p_s, n_s = safe_corr(st["post_typing"], st["final_grade"], method="spearman")
    typing["corr_post_grade"] = {"r": sf(r_p), "rho": sf(r_s), "p_rho": sf(p_s), "n": n_s}
    r_p, p_p, _ = safe_corr(st["typing_improvement"], st["final_grade"])
    r_s, p_s, n_s = safe_corr(st["typing_improvement"], st["final_grade"], method="spearman")
    typing["corr_improvement_grade"] = {"r": sf(r_p), "rho": sf(r_s), "p_rho": sf(p_s), "n": n_s}
    result["typing"] = typing

    se = st["self_eval"].dropna()
    r_p, p_p, _ = safe_corr(st["self_eval"], st["final_grade"])
    r_s, p_s, n_s = safe_corr(st["self_eval"], st["final_grade"], method="spearman")
    result["self_eval"] = {
        "avg": sf(se.mean()) if len(se) > 0 else None,
        "corr_grade": {"r": sf(r_p), "rho": sf(r_s), "p_rho": sf(p_s), "n": n_s},
    }

    result["early_ai"] = []
    early_checks = []
    if "a1_ai" in st.columns and "a2_ai" in st.columns:
        early_checks = [
            ("AI in Wall (A1)",      st["a1_ai"], st["a1_submitted"]),
            ("AI in Chess (A2)",     st["a2_ai"], st["a2_submitted"]),
            ("AI in Wall OR Chess",  st["a1_ai"] | st["a2_ai"],
                                     st["a1_submitted"] | st["a2_submitted"]),
            ("AI in Wall AND Chess", st["a1_ai"] & st["a2_ai"],
                                     st["a1_submitted"] & st["a2_submitted"]),
        ]
    for label, ai_flag, sub_flag in early_checks:
        with_ai    = st[ai_flag & sub_flag]
        without_ai = st[~ai_flag & sub_flag]
        n_with, n_without = len(with_ai), len(without_ai)
        entry = {"label": label, "n_with": n_with, "n_without": n_without}
        if n_with > 0:
            entry["with_ai_pass_rate"]    = sf(with_ai["passed_course"].sum() / n_with)
        if n_without > 0:
            entry["without_ai_pass_rate"] = sf(without_ai["passed_course"].sum() / n_without)
        if n_with >= 2 and n_without >= 2:
            tbl = np.array([
                [with_ai["passed_course"].sum(),    n_with    - with_ai["passed_course"].sum()],
                [without_ai["passed_course"].sum(), n_without - without_ai["passed_course"].sum()],
            ])
            _, p_f = fisher_exact(tbl)
            entry["fisher_p"] = sf(p_f)
        result["early_ai"].append(entry)

    result["engagement"] = []
    _engagement_sources = (
        ("Answers",   "total_answers_lessons",   "answers"),
        ("Questions", "total_questions_lessons", "questions"),
        ("Help",      "total_help_lessons",      "help"),
    )
    for label, agg_col, legacy_col in _engagement_sources:
        if agg_col in st.columns and (st[agg_col].fillna(0) > 0).any():
            col = agg_col
        elif legacy_col in st.columns:
            col = legacy_col
        else:
            continue
        s = st[col]
        has = s.notna() & (s > 0)
        n_eng = int(has.sum())
        passed = int(st.loc[has, "passed_course"].sum()) if n_eng > 0 else 0
        result["engagement"].append({
            "label":   label,
            "n":       n_eng,
            "n_passed":passed,
            "pass_rate": sf(passed / n_eng) if n_eng > 0 else None,
        })

    totals = np.array([0, 0, 0, 0])
    for a_num in POOLED_ASSIGNMENTS:
        ai     = st[f"a{a_num}_ai"]
        trouble= st[f"a{a_num}_trouble"]
        passed = st[f"a{a_num}_passed"]
        has_obs= st[f"a{a_num}_obs"] != ""
        totals += np.array([(ai & trouble).sum(), (ai & passed).sum(),
                            (~ai & trouble & has_obs).sum(), (~ai & passed & has_obs).sum()])

    ai_t, ai_p, nai_t, nai_p = [int(x) for x in totals]
    ao = {
        "ai_trouble":       ai_t,  "ai_pass":    ai_p,
        "no_ai_trouble":    nai_t, "no_ai_pass": nai_p,
        "trouble_rate_ai":  sf(ai_t  / (ai_t + ai_p))   if (ai_t + ai_p)   > 0 else None,
        "trouble_rate_no_ai": sf(nai_t/ (nai_t+ nai_p)) if (nai_t+ nai_p)  > 0 else None,
        "odds_ratio":       None,
        "fisher_p":         None,
        "chi2":             None,
        "chi2_p":           None,
    }
    if ai_p > 0 and nai_t > 0:
        ao["odds_ratio"] = sf((ai_t * nai_p) / (ai_p * nai_t))
    tbl = np.array([[ai_t, ai_p], [nai_t, nai_p]])
    try:
        chi2, p_chi, _, _ = chi2_contingency(tbl, correction=True)
        _, p_fisher = fisher_exact(tbl)
        ao["fisher_p"] = sf(p_fisher)
        ao["chi2"]     = sf(chi2)
        ao["chi2_p"]   = sf(p_chi)
    except Exception:
        pass
    result["ai_overall"] = ao

    if "total_artefacts_fired" in st.columns and st["total_artefacts_fired"].notna().any():
        tot     = st["total_artefacts_fired"]
        has_tot = tot.notna()
        pass_t  = tot[st["passed_course"] & has_tot].dropna()
        fail_t  = tot[~st["passed_course"] & has_tot].dropna()
        ts = {
            "n_students":    int(has_tot.sum()),
            "mean_fired":    sf(tot[has_tot].mean()),
            "max_fired":     int(tot[has_tot].max()) if has_tot.any() else None,
            "passed_mean":   sf(pass_t.mean()) if len(pass_t) else None,
            "failed_mean":   sf(fail_t.mean()) if len(fail_t) else None,
        }
        r_p, _, _   = safe_corr(tot, st["final_grade"])
        r_s, p_s, n = safe_corr(tot, st["final_grade"], method="spearman")
        ts["grade_corr"] = {"r": sf(r_p), "rho": sf(r_s), "p_rho": sf(p_s), "n": n}
        r_p, _, _   = safe_corr(tot, st["participation"])
        r_s, p_s, n = safe_corr(tot, st["participation"], method="spearman")
        ts["participation_corr"] = {"r": sf(r_p), "rho": sf(r_s), "p_rho": sf(p_s), "n": n}

        for ext_key, ext_col in (
            ("self_eval", "self_eval"),
            ("answers",   "answers"),
            ("questions", "questions"),
            ("help",      "help"),
            ("kahoot",    "kahoot"),
            ("quiz_stii", "quiz_stii"),
        ):
            if ext_col not in st.columns or st[ext_col].notna().sum() < 3:
                continue
            r_p, _, _   = safe_corr(tot, st[ext_col])
            r_s, p_s, n = safe_corr(tot, st[ext_col], method="spearman")
            ts[f"{ext_key}_corr"] = {
                "r":    sf(r_p),
                "rho":  sf(r_s),
                "p_rho":sf(p_s),
                "n":    n,
            }
        if len(pass_t) >= 2 and len(fail_t) >= 2:
            _, p_mw = mannwhitneyu(pass_t, fail_t, alternative="two-sided")
            ts["pass_fail_mannwhitney_p"] = sf(p_mw)

        per_artefact = []
        for a_num, a in ASSIGNMENTS.items():
            schema = _artefact_schema_for(a)
            if not schema: continue
            for key, label in schema:
                fcol = f"a{a_num}_artefact_{key}"
                if fcol not in st.columns: continue
                fired = st[fcol].astype(int)
                if fired.sum() < 3: continue
                row = {
                    "assignment": a["lower"],
                    "assn_name":  a["name"],
                    "key":        key,
                    "label":      label,
                    "severity":   _load_artefact_severity(a["lower"]).get(key, ""),
                    "n_fired":    int(fired.sum()),
                }
                for ext_key, ext_col in (
                    ("participation", "participation"),
                    ("self_eval",     "self_eval"),
                    ("answers",       "answers"),
                    ("questions",     "questions"),
                    ("help",          "help"),
                ):
                    if ext_col not in st.columns: continue
                    r_p, _, _   = safe_corr(fired, st[ext_col])
                    r_s, p_s, n = safe_corr(fired, st[ext_col], method="spearman")
                    row[f"{ext_key}_corr"] = {
                        "r":    sf(r_p),
                        "rho":  sf(r_s),
                        "p_rho":sf(p_s),
                        "n":    n,
                    }
                per_artefact.append(row)
        if per_artefact:
            ts["per_artefact_engagement"] = per_artefact

        result["artefact_summary"] = ts

    folder   = os.path.dirname(os.path.abspath(grades_path))
    out_path = os.path.join(folder, "grades_stats.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
    print(f"\n  [Stats JSON saved → {out_path}]")

    session_path = os.path.join(os.path.dirname(__file__), ".grades_session.json")
    with open(session_path, "w", encoding="utf-8") as f:
        json.dump({"folder": folder}, f)

    return out_path


def plot_follow_vs_grade(st):
    fig, axes = plt.subplots(2, 3, figsize=(14, 9))

    last_data_ax = None

    for idx, (a_num, a) in enumerate(POOLED_ASSIGNMENTS.items()):
        row, col = divmod(idx, 3)
        ax = axes[row][col]
        last_data_ax = ax

        follow = st[f"a{a_num}_follow"]
        grade = st[f"a{a_num}_grade"]
        ai = st[f"a{a_num}_ai"]

        mask = follow.notna() & grade.notna()
        f_vals = follow[mask].values
        g_vals = grade[mask].values
        ai_vals = ai[mask].values

        jitter = np.random.default_rng(42).uniform(-0.15, 0.15, len(g_vals))
        g_jittered = g_vals + jitter

        colors = ["red" if a else "steelblue" for a in ai_vals]
        ax.scatter(f_vals, g_jittered, c=colors, alpha=0.6, edgecolors="white", s=50)

        if len(f_vals) >= 3:
            z = np.polyfit(f_vals, g_vals, 1)
            x_line = np.linspace(f_vals.min(), f_vals.max(), 50)
            ax.plot(x_line, np.polyval(z, x_line), "k--", alpha=0.5)

        rp, _, _ = safe_corr(follow, grade)
        rs, ps, ns = safe_corr(follow, grade, method="spearman")

        rp_s = f"{rp:+.2f}" if not np.isnan(rp) else "N/A"
        rs_s = f"{rs:+.2f}" if not np.isnan(rs) else "N/A"
        avg_f = f_vals.mean()
        avg_g = g_vals.mean()

        tag = " (easy)" if a["difficulty"] == "easy" else ""
        ax.set_title(f"{a['name']}{tag}", fontsize=12, fontweight="bold", pad=18)
        ax.text(0.5, 1.01, f"r={rp_s}   ρ={rs_s}   n={ns}   avg follow={avg_f:.0f}   avg grade={avg_g:.1f}",
                transform=ax.transAxes, ha="center", va="bottom", fontsize=9, color="black")
        ax.set_xlabel("Follow Score")
        ax.set_ylabel("Assignment Grade")
        ax.set_xlim(0, None)
        ax.set_ylim(-0.5, 5.5)
        ax.set_yticks(range(6))

    axes[1][2].axis("off")

    from matplotlib.lines import Line2D
    legend_elements = [
        Line2D([0], [0], marker='o', color='w', markerfacecolor='steelblue',
               markersize=10, label='No AI'),
        Line2D([0], [0], marker='o', color='w', markerfacecolor='red',
               markersize=10, label='AI'),
    ]
    last_data_ax.legend(handles=legend_elements, loc='lower right', fontsize=11,
                        frameon=True, fancybox=True, shadow=True)

    plt.tight_layout()
    plt.show()


def main():
    parser = argparse.ArgumentParser(
        description="Analyse a grades_*.xlsx / Overview*.xlsx file and write "
                    "grades_stats.json next to it."
    )
    parser.add_argument("path", nargs="?",
                        help="Path to the xlsx (skips the file picker).")
    parser.add_argument("--no-plot", action="store_true",
                        help="Skip the interactive matplotlib plot at the end "
                             "(used when chained from build_overview.py).")
    args = parser.parse_args()
    path = args.path

    if not path:
        session_path = os.path.join(os.path.dirname(__file__),
                                     ".grades_session.json")
        last_folder = None
        try:
            with open(session_path, encoding="utf-8") as f:
                last_folder = json.load(f).get("folder")
        except (OSError, ValueError):
            pass

        path = pick_file(
            "Select OverviewPlus.xlsx or Overview.xlsx",
            filetypes=[("Excel files", "*.xlsx"), ("All files", "*.*")],
            initialdir=last_folder or "",
        )

    if not path:
        print("No file selected. Exiting.")
        sys.exit(0)

    print(f"Loading: {path}\n")
    st = load_data(path)
    if st.empty or not ASSIGNMENTS:
        print("error: could not detect assignment columns "
              "(expected '<Name> Grade' headers).", file=sys.stderr)
        sys.exit(1)
    detected = ", ".join(a["name"] for a in ASSIGNMENTS.values())
    print(f"Detected assignments: {detected}")
    print(f"Pooled (with follow): "
          f"{', '.join(a['name'] for a in POOLED_ASSIGNMENTS.values())}")

    excluded_ids = load_excluded_student_ids(
        os.path.join(os.path.dirname(path), 'students.csv')
    )
    if excluded_ids:
        id_col_idx = COL.get('id')
        if id_col_idx is not None:
            ids = _col_series(st, id_col_idx, numeric=False).apply(
                lambda s: s[:-2] if s.endswith('.0') else s
            )
            n_before = len(st)
            st = st[~ids.isin(excluded_ids)].reset_index(drop=True)
            n_excluded = n_before - len(st)
            if n_excluded:
                print(
                    f"Excluded {n_excluded} student row(s) per "
                    f"students.csv (Category=Excluded)"
                )

    st = enrich(st)
    st_full = st

    if "is_llm" in st.columns and st["is_llm"].any():
        n_llm = int(st["is_llm"].sum())
        st = st[~st["is_llm"]].reset_index(drop=True)
        print(f"  ({n_llm} LLM probe row(s) kept aside for save_stats_json)")

    print(f"Students loaded: {len(st)}")
    print(f"Passed course:   {st['passed_course'].sum()}")
    print(f"Failed course:   {(~st['passed_course']).sum()}")

    analyze_ai_vs_trouble(st)
    analyze_early_ai_and_passing(st)
    analyze_ai_grade_quality(st)
    analyze_typing_speed(st)
    analyze_self_evaluation(st)
    analyze_participation(st)
    analyze_engagement(st)
    analyze_ai_persistence(st)
    analyze_assignment_difficulty(st)
    analyze_artefacts(st)
    analyze_per_language_follow(st)
    analyze_lesson_interactions(st)
    analyze_comment_diff(st)
    analyze_correlations_summary(st)
    save_stats_json(st_full, path)

    section("INTERPRETATION GUIDE")
    print("""
  Statistical significance markers:
    *   p < 0.05  (likely real effect)
    **  p < 0.01  (strong evidence)
    *** p < 0.001 (very strong evidence)

  Correlation strength (|r| or |ρ|):
    0.0 - 0.2  negligible
    0.2 - 0.4  weak
    0.4 - 0.6  moderate
    0.6 - 0.8  strong
    0.8 - 1.0  very strong

  Odds Ratio (OR):
    1.0        no association
    > 1.0      AI group has OR× the trouble of non-AI group
    < 1.0      AI group less likely to have trouble
""")

    if not args.no_plot:
        plot_follow_vs_grade(st)



if __name__ == "__main__":
    main()