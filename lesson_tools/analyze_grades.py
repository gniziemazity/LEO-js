"""
Web Programming Course — Grade Analysis Tool
=============================================
Opens a file dialog to select the .xls grades file, then runs a comprehensive
analysis covering AI usage, typing speed, self-evaluation, engagement,
assignment progression, and participation/follow-score patterns.

Requirements:  pip install pandas xlrd scipy numpy matplotlib
"""

import sys
import tkinter as tk
from tkinter import filedialog
import warnings

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

# ── Helpers ──────────────────────────────────────────────────────────────────

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
    """Return (corr, p, n) dropping NaN pairs."""
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


# ── Column map ───────────────────────────────────────────────────────────────

COL = {
    "id": 0,
    "exam": 4,
    "weeklies": 5,
    "notes": 8,
    "pre_typing": 12,
    "kahoot": 15,
    "self_eval": 16,
    "post_typing": 74,
    "quiz_stii": 71,
    "avg_assignments": 75,  # BX
    "participation": 76,    # BY (0-1 bonus from follow scores)
    "final_grade": 77,      # BZ = BX + BY
    "answers": 83,
    "questions": 84,
    "help": 85,
}

ASSIGNMENTS = {
    1: {"follow": 20, "lesson_obs": 22, "grade": 23, "status": 24, "obs": 25,
        "name": "Wall", "difficulty": "easy"},
    2: {"follow": 29, "lesson_obs": 31, "grade": 32, "status": 33, "obs": 34,
        "name": "Chess", "difficulty": "easy"},
    3: {"follow": 38, "lesson_obs": 40, "grade": 41, "status": 42, "obs": 43,
        "name": "Sorting", "difficulty": "hard"},
    4: {"follow": 47, "lesson_obs": 49, "grade": 50, "status": 51, "obs": 52,
        "name": "JS", "difficulty": "hard"},
    5: {"follow": 56, "lesson_obs": 58, "grade": 59, "status": 60, "obs": 61,
        "name": "QR", "difficulty": "hard"},
    6: {"follow": None, "lesson_obs": None, "grade": 68, "status": 69, "obs": 70,
        "name": "Web", "difficulty": "project"},
}

POOLED_ASSIGNMENTS = {k: v for k, v in ASSIGNMENTS.items() if k != 6}

DATA_ROWS = slice(1, 85)


# ── Data loading & enrichment ────────────────────────────────────────────────

def load_data(path):
    df = pd.read_excel(path, engine="xlrd", header=None)
    return df.iloc[DATA_ROWS].copy().reset_index(drop=True)


def enrich(st):
    st["final_grade"] = pd.to_numeric(st.iloc[:, COL["final_grade"]], errors="coerce")
    st["avg_assignments"] = pd.to_numeric(st.iloc[:, COL["avg_assignments"]], errors="coerce")

    passing_statuses = {"Pass", "Pass'", "Pass*"}
    all_passed = pd.Series(True, index=st.index)
    for a_num, a_info in ASSIGNMENTS.items():
        status = st.iloc[:, a_info["status"]].fillna("").astype(str).str.strip()
        all_passed &= status.isin(passing_statuses)
    st["passed_course"] = all_passed

    st["pre_typing"] = pd.to_numeric(st.iloc[:, COL["pre_typing"]], errors="coerce")
    st["post_typing"] = pd.to_numeric(st.iloc[:, COL["post_typing"]], errors="coerce")
    st["typing_improvement"] = st["post_typing"] - st["pre_typing"]

    st["self_eval"] = pd.to_numeric(st.iloc[:, COL["self_eval"]], errors="coerce")
    st["answers"] = pd.to_numeric(st.iloc[:, COL["answers"]], errors="coerce")
    st["questions"] = pd.to_numeric(st.iloc[:, COL["questions"]], errors="coerce")
    st["help"] = pd.to_numeric(st.iloc[:, COL["help"]], errors="coerce")
    st["participation"] = pd.to_numeric(st.iloc[:, COL["participation"]], errors="coerce")
    st["kahoot"] = pd.to_numeric(st.iloc[:, COL["kahoot"]], errors="coerce")
    st["quiz_stii"] = pd.to_numeric(st.iloc[:, COL["quiz_stii"]], errors="coerce")

    for a_num, a in ASSIGNMENTS.items():
        obs = st.iloc[:, a["obs"]].fillna("").astype(str).str.strip()
        status = st.iloc[:, a["status"]].fillna("").astype(str).str.strip()
        grade = pd.to_numeric(st.iloc[:, a["grade"]], errors="coerce")

        st[f"a{a_num}_obs"] = obs
        st[f"a{a_num}_status"] = status
        st[f"a{a_num}_grade"] = grade
        st[f"a{a_num}_ai"] = obs.str.upper().str.contains("AI", na=False)
        st[f"a{a_num}_submitted"] = grade.notna()

        # Two-way classification:
        #   Pass:    Pass or Pass' (demonstrated knowledge)
        #   Trouble: everything else — Fail, Fail*, Pass*, no-show
        st[f"a{a_num}_passed"] = status.isin(["Pass", "Pass'"])
        st[f"a{a_num}_trouble"] = st[f"a{a_num}_submitted"] & ~status.isin(["Pass", "Pass'"])
        st[f"a{a_num}_pass_clean"] = status == "Pass"

        if a["follow"] is not None:
            st[f"a{a_num}_follow"] = pd.to_numeric(st.iloc[:, a["follow"]], errors="coerce")

        if a["lesson_obs"] is not None:
            lobs = st.iloc[:, a["lesson_obs"]].fillna("").astype(str).str.strip()
            st[f"a{a_num}_lesson_obs"] = lobs

    ai_cols = [f"a{i}_ai" for i in POOLED_ASSIGNMENTS]
    st["total_ai_flags"] = st[ai_cols].sum(axis=1)

    trouble_cols = [f"a{i}_trouble" for i in POOLED_ASSIGNMENTS]
    submitted_cols = [f"a{i}_submitted" for i in POOLED_ASSIGNMENTS]
    st["total_troubles"] = st[trouble_cols].sum(axis=1)
    st["total_submitted"] = st[submitted_cols].sum(axis=1)

    # Average of SUBMITTED assignments only (ignoring non-submissions)
    grade_cols = [f"a{i}_grade" for i in POOLED_ASSIGNMENTS]
    st["avg_submitted_only"] = st[grade_cols].mean(axis=1, skipna=True)

    return st


# ── Analysis functions ───────────────────────────────────────────────────────

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
        submitted = st[f"a{a_num}_submitted"]
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

    # ─ Overall (1-5) ─
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
    subsection("Early AI usage (easy assignments) and course pass rate")

    # AI in second assignment (Chess — easiest)
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

    # AI in first assignment
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

    # AI in first OR second
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

    # AI in BOTH
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

    # Overall
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

    # Typing speed vs each assignment grade (does it weaken?)
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

    # Passed vs failed
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

    # Participation vs AI
    r, p, n = safe_corr(st["participation"], st["total_ai_flags"])
    print(f"\n  Participation vs total AI flags:")
    print(f"    Pearson r = {fmt_r(r)},  p = {fmt_p(p)},  n = {n}")

    # Self-eval vs participation
    r, p, n = safe_corr(st["self_eval"], st["participation"])
    print(f"\n  Self-eval vs participation:")
    print(f"    Pearson r = {fmt_r(r)},  p = {fmt_p(p)},  n = {n}")

    # Participation vs typing speed
    r, p, n = safe_corr(st["participation"], st["pre_typing"])
    print(f"\n  Participation vs pre-typing speed:")
    print(f"    Pearson r = {fmt_r(r)},  p = {fmt_p(p)},  n = {n}")

    # Does typing along in lessons improve typing speed?
    subsection("Does typing along in lessons improve typing speed?")

    print(f"\n  Typing tests: one game at the start, one at the end of the course.")
    print(f"  Students type along with the teacher during every lesson.")
    print(f"  Question: does following along at all (vs not) lead to improvement?\n")

    # How well they follow vs improvement (amount)
    r, p, n = safe_corr(st["participation"], st["typing_improvement"])
    print(f"  Follow amount vs typing improvement (does following MORE help?):")
    print(f"    Pearson r = {fmt_r(r)},  p = {fmt_p(p)},  n = {n}")

    # Followed at all vs didn't follow: compare improvement
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

    # Per-lesson follow score vs paired assignment grade
    subsection("Per-lesson follow score vs. its paired assignment grade")
    print(f"\n  {'Lesson':<14} {'r':>7} {'ρ':>7} {'p(ρ)':>12} {'n':>5}")
    print(f"  {'-'*14} {'-'*7} {'-'*7} {'-'*12} {'-'*5}")
    for a_num, a in POOLED_ASSIGNMENTS.items():
        follow = st[f"a{a_num}_follow"]
        grade = st[f"a{a_num}_grade"]
        rp, _, _ = safe_corr(follow, grade)
        rs, ps, ns = safe_corr(follow, grade, method="spearman")
        print(f"  L{a_num} → {a['name']:<8} {fmt_r(rp):>7} {fmt_r(rs):>7} {fmt_p(ps):>12} {ns:>5}")

    # Per-lesson follow score vs assignment average (BX)
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

    # Overall: any engagement at all
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


def analyze_correlations_summary(st):
    section("9. CORRELATION SUMMARY TABLE")

    pairs = [
        ("pre_typing",      "final_grade",         "Pre-typing speed → Final grade"),
        ("self_eval",        "final_grade",         "Self-evaluation → Final grade"),
        ("participation",    "avg_assignments",     "Participation → Assign. avg (BX)"),
        ("participation",    "avg_submitted_only",  "Participation → Avg submitted only"),
        ("participation",    "pre_typing",          "Participation → Pre-typing speed"),
        ("participation",    "typing_improvement",  "Participation → Typing improvement"),
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


def plot_follow_vs_grade(st):
    """Scatter plots: follow score vs assignment grade, 2×3 grid (5 plots + legend)."""
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

        # Add jitter to grade (integer values overlap)
        jitter = np.random.default_rng(42).uniform(-0.15, 0.15, len(g_vals))
        g_jittered = g_vals + jitter

        # Color by AI flag
        colors = ["red" if a else "steelblue" for a in ai_vals]
        ax.scatter(f_vals, g_jittered, c=colors, alpha=0.6, edgecolors="white", s=50)

        # Trend line
        if len(f_vals) >= 3:
            z = np.polyfit(f_vals, g_vals, 1)
            x_line = np.linspace(f_vals.min(), f_vals.max(), 50)
            ax.plot(x_line, np.polyval(z, x_line), "k--", alpha=0.5)

        rp, pp, np_ = safe_corr(follow, grade)
        rs, ps, ns = safe_corr(follow, grade, method="spearman")

        # 2 decimal precision for correlations
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

    # Hide the empty 6th slot
    axes[1][2].axis("off")

    # Legend on the last data chart (QR, bottom-right with data)
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


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)

    path = filedialog.askopenfilename(
        title="Select the Grades .xls file",
        filetypes=[("Excel files", "*.xls *.xlsx"), ("All files", "*.*")],
    )

    if not path:
        print("No file selected. Exiting.")
        sys.exit(0)

    print(f"Loading: {path}\n")
    st = load_data(path)
    st = enrich(st)

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
    analyze_correlations_summary(st)

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

    # Show scatter plots
    plot_follow_vs_grade(st)

    input("\nPress Enter to close...")


if __name__ == "__main__":
    main()