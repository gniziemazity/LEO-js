import math, os, sys, warnings
import tkinter as tk
from tkinter import filedialog, messagebox

import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from matplotlib.ticker import MultipleLocator

warnings.filterwarnings("ignore")
                                                                                    
WHISKER_IQR = 25

INCLUDE_FOLLOW = True
INCLUDE_INC = False # now in agreement with Follow, so not needed
INCLUDE_ASSIGNMENTS = True

SHOW_OBSERVATIONS = True

C_FOLLOW = "black"
C_SIM    = "#888888"
C_ASSIGN = "#2563EB"         
                                                                            
PAD_PCT    = 5                                             
PAD_ASSIGN = 0.25                                        
                                                                          
BLOCK_SIZE = 9
OFF_SFOL   = 0
OFF_SSIM   = 2
OFF_OBS    = 5
OFF_LNAME  = 6
OFF_LOBS   = 8
                                                                      
GRID_ROWS = 3
GRID_COLS = 3
GRID_SIZE = GRID_ROWS * GRID_COLS
                                      
def pick_file() -> str:
    root = tk.Tk(); root.withdraw()
    root.attributes("-topmost", True)
    path = filedialog.askopenfilename(
        title="Open Grades File",
        filetypes=[("Excel files", "*.xlsx *.xls *.xlsm"), ("All files", "*.*")],
    )
    root.destroy()
    return path

                                             
def read_file(path: str) -> pd.DataFrame:
    ext = os.path.splitext(path)[1].lower()
    try:
        if ext == ".xls":
            try:
                return pd.read_excel(path, engine="xlrd", header=0)
            except ImportError:
                raise ImportError("xlrd required for .xls — run: pip install xlrd")
        return pd.read_excel(path, engine="openpyxl", header=0)
    except Exception as e:
        messagebox.showerror("Error reading file", str(e)); sys.exit(1)

                                                    
def find_lesson_blocks(cols: list) -> list:
    blocks = []
    for i, c in enumerate(cols):
        s = str(c).strip()
        if s.startswith("L") and s.endswith("Follow") and i + BLOCK_SIZE - 1 < len(cols):
            blocks.append({
                "label":      s,
                "lesson":     str(cols[i + OFF_LNAME]).strip(),
                "col_follow": i + OFF_SFOL,
                "col_sim":    i + OFF_SSIM,
                "col_score":  i + OFF_LNAME,
                "col_obs":    i + OFF_OBS,
                "col_lobs":   i + OFF_LOBS,
            })
    return blocks

                                               
def is_valid_id(val) -> bool:
    try:
        f = float(str(val).strip())
        return not math.isnan(f) and f == int(f)
    except (ValueError, TypeError):
        return False

def to_float(val):
    try:
        f = float(val); return None if pd.isna(f) else f
    except (ValueError, TypeError):
        return None

def obs_text(val) -> str:
    s = str(val).strip()
    return "" if s.lower() in ("nan", "none", "", "_") else s

def student_name(row: pd.Series) -> str:
    v = str(row.get("Name", "")).strip()
    return "" if v.lower() in ("nan", "none", "") else v

def student_id(row: pd.Series) -> str:
    v = str(row.get("ID", "")).strip().removesuffix(".0")
    return "" if v.lower() in ("nan", "none", "") else v

def truncate_name(name: str, max_len: int = 25) -> str:
    return name if len(name) <= max_len else name[:max_len - 1] + "…"

def row_has_data(row: pd.Series, blocks: list) -> bool:
    for b in blocks:
        selected_values = []
        if INCLUDE_FOLLOW:
            selected_values.append(to_float(row.iloc[b["col_follow"]]))
        if INCLUDE_INC:
            selected_values.append(to_float(row.iloc[b["col_sim"]]))
        if INCLUDE_ASSIGNMENTS:
            selected_values.append(to_float(row.iloc[b["col_score"]]))
        if any(v is not None for v in selected_values):
            return True
    return False       
                                               
def draw_chart(ax1, title: str, blocks: list, row: pd.Series,
               compact: bool = False, show_legend: bool = False,
               prefix_title: bool = False):
    fs_title  = 15  if compact else 20
    fs_ylabel = 12  if compact else 17
    fs_tick   = 11  if compact else 14
    fs_annot  = 10  if compact else 13
    ms        = 4   if compact else 7
    lw        = 1.5 if compact else 2.2

    labels=[]; follow_y=[]; sim_y=[]; score_y=[]; obs_data=[]
    for i, b in enumerate(blocks):
        labels.append(b["lesson"])
        follow_y.append(to_float(row.iloc[b["col_follow"]]))
        sim_y.append(   to_float(row.iloc[b["col_sim"]]))
        score_y.append( to_float(row.iloc[b["col_score"]]))
        obs_data.append((
            i, follow_y[-1], sim_y[-1], score_y[-1],
            obs_text(row.iloc[b["col_obs"]]),
            obs_text(row.iloc[b["col_lobs"]]),
        ))

    x   = list(range(len(labels)))
    ax2 = ax1.twinx()

    def _plot(ax, series, color, marker, ls="-"):
        xs = [xi for xi, v in zip(x, series) if v is not None]
        ys = [v  for v in series              if v is not None]
        if xs:
            ax.plot(xs, ys, color=color, marker=marker,
                    linewidth=lw, markersize=ms, linestyle=ls, zorder=3)

    if INCLUDE_FOLLOW:
        _plot(ax1, follow_y, C_FOLLOW, "o")
    if INCLUDE_INC:
        _plot(ax1, sim_y, C_SIM, "s")
    if INCLUDE_ASSIGNMENTS:
        _plot(ax2, score_y, C_ASSIGN, "^", ls="--")

                                                                       
    def _annotate(ax, x_pos, yval, text):
        if not text or yval is None:
            return
        if compact:
            ax.text(x_pos, yval, text, fontsize=fs_annot, color="black",
                    fontweight="bold", ha="center", va="bottom", clip_on=True,
                    bbox=dict(boxstyle="round,pad=0.15", fc="white",
                              ec="#aaaaaa", alpha=0.88, lw=0.5))
        else:
            ax.annotate(text, xy=(x_pos, yval), xytext=(0, 13),
                textcoords="offset points", fontsize=fs_annot,
                color="black", fontweight="bold", ha="center", va="bottom",
                arrowprops=dict(arrowstyle="-", color="#777777", lw=0.8, alpha=0.7),
                bbox=dict(boxstyle="round,pad=0.25", fc="white",
                          ec="#aaaaaa", alpha=0.92, lw=0.7), clip_on=True)

    if SHOW_OBSERVATIONS:
        for x_pos, fy, sy, sc, obs, lobs in obs_data:
            if obs:
                series_for_obs = []
                if INCLUDE_FOLLOW:
                    series_for_obs.append(fy)
                if INCLUDE_INC:
                    series_for_obs.append(sy)
                yval = next((v for v in series_for_obs if v is not None), None)
                _annotate(ax1, x_pos, yval, obs)
            if INCLUDE_ASSIGNMENTS and lobs:
                _annotate(ax2, x_pos, sc, lobs)

                                                                         
    ax1.set_facecolor("white")
    for sp in list(ax1.spines.values()) + list(ax2.spines.values()):
        sp.set_visible(False)
    ax1.yaxis.grid(True, linestyle="--", linewidth=0.5, color="#DDDDDD", zorder=0)
    ax1.set_axisbelow(True)

    ax1.set_xticks(x)
    ax1.set_xticklabels(labels, fontsize=fs_tick)
                                                                                   
    ax1.set_xlim(-0.6, len(x) - 0.4)
                                                
    ax1.set_ylim(-PAD_PCT, 100 + PAD_PCT)
    ax2.set_ylim(-PAD_ASSIGN, 5 + PAD_ASSIGN)
    ax2.yaxis.set_major_locator(MultipleLocator(1))

    if INCLUDE_FOLLOW or INCLUDE_INC:
        ax1.set_ylabel("Lesson (%)", fontsize=fs_ylabel, color="#333333")
        ax1.tick_params(axis="y", labelsize=fs_tick)
    else:
        ax1.set_ylabel("")
        ax1.set_yticks([])

    if INCLUDE_ASSIGNMENTS:
        ax2.set_ylabel("Assignment (0-5)", fontsize=fs_ylabel, color=C_ASSIGN)
        ax2.tick_params(axis="y", colors=C_ASSIGN, labelsize=fs_tick)
    else:
        ax2.set_ylabel("")
        ax2.set_yticks([])

    display_title = f"Student: {truncate_name(title)}" if prefix_title else truncate_name(title)
    ax1.set_title(display_title, fontsize=fs_title, fontweight="bold", pad=6)
                                                                   
    if show_legend:
        legend_items = []
        if INCLUDE_FOLLOW:
            legend_items.append(Line2D([0], [0], color=C_FOLLOW, marker="o", lw=2, label="Follow"))
        if INCLUDE_INC:
            legend_items.append(Line2D([0], [0], color=C_SIM, marker="s", lw=2, label="Inc"))
        if INCLUDE_ASSIGNMENTS:
            legend_items.append(Line2D([0], [0], color=C_ASSIGN, marker="^", lw=2, linestyle="--", label="Assignments"))
                                                                                              
        if legend_items:
            ax1.legend(handles=legend_items, loc="lower right",
                       bbox_to_anchor=(1.0, 0.05),
                       fontsize=max(fs_tick, 7), framealpha=0.95,
                       edgecolor="#cccccc")

                                              
def save_grid_chart(students: list, blocks: list, out_path: str,
                    prefix_title: bool = False):
    fig, axes = plt.subplots(
        GRID_ROWS, GRID_COLS,
        figsize=(GRID_COLS * 5.5, GRID_ROWS * 5.0),
    )
    fig.patch.set_facecolor("white")

    for i, ax1 in enumerate(axes.flat):
        ax1.set_facecolor("white")
        if i < len(students):
            is_last = (i == len(students) - 1)
            draw_chart(ax1, students[i][0], blocks, students[i][1],
                       compact=True, show_legend=is_last,
                       prefix_title=prefix_title)
        else:
            ax1.set_visible(False)                                                        
                                                                             
    fig.subplots_adjust(left=0.09, right=0.91, top=0.94, bottom=0.07,
                        hspace=0.30, wspace=0.38)
                                                                                     
    fig.savefig(out_path, dpi=130, facecolor="white")
    plt.close(fig)
                                 
def save_totals_chart(data_rows: list, blocks: list, out_path: str):
    groups = []
    for b in blocks:
        lesson = b["lesson"]
        def _collect(key, b=b):
            return [v for r in data_rows
                    if (v := to_float(r.iloc[b[key]])) is not None]
        if INCLUDE_FOLLOW:
            groups.append((f"{lesson}\nFollow", _collect("col_follow"), C_FOLLOW, "left"))
        if INCLUDE_INC:
            groups.append((f"{lesson}\nInc", _collect("col_sim"), C_SIM, "left"))
        if INCLUDE_ASSIGNMENTS:
            groups.append((f"{lesson}\nAssignment", _collect("col_score"), C_ASSIGN, "right"))

    n = len(groups)
    if n == 0:
        return

    fig, ax_l = plt.subplots(figsize=(max(10, n * 1.6), 7))
    ax_r = ax_l.twinx()
    fig.patch.set_facecolor("white")
    ax_l.set_facecolor("white")

    for sp in list(ax_l.spines.values()) + list(ax_r.spines.values()):
        sp.set_visible(False)
    ax_l.yaxis.grid(True, linestyle="--", linewidth=0.6, color="#DDDDDD", zorder=0)
    ax_l.set_axisbelow(True)

    positions = list(range(1, n + 1))

    for pos, (label, vals, color, side) in zip(positions, groups):
        if not vals:
            continue
        ax = ax_l if side == "left" else ax_r
        ax.boxplot(
            vals,
            positions=[pos],
            widths=0.55,
            patch_artist=True,
            notch=False,
            showfliers=True,
            whis=WHISKER_IQR,
            boxprops=     dict(facecolor=color, color=color, alpha=0.35),
            medianprops=  dict(color=color, linewidth=2.5),
            whiskerprops= dict(color=color, linewidth=1.5),
            capprops=     dict(color=color, linewidth=1.5),
            flierprops=   dict(marker="o", markerfacecolor=color,
                               markeredgecolor=color, markersize=4, alpha=0.5),
        )
        if side == "right":
            mean_val = sum(vals) / len(vals)
            ax.plot(pos, mean_val, marker="D", color=color,
                    markersize=7, zorder=5, markeredgecolor="white",
                    markeredgewidth=0.8)
                                                                 
    ax_l.set_xticks(positions)
    ax_l.set_xticklabels([""] * len(positions))
    ax_l.set_xlim(0, n + 1)

    xform_bot = ax_l.get_xaxis_transform()
    xform_top = ax_l.get_xaxis_transform()

    metric_color = {"Follow": C_FOLLOW, "Inc": C_SIM, "Assignment": C_ASSIGN}
    lesson_positions: dict = {}
    for pos, (label, *_) in zip(positions, groups):
        lesson, metric = label.split("\n", 1)
        lesson_positions.setdefault(lesson, []).append(pos)
        ax_l.text(pos, -0.03, metric, transform=xform_bot,
                  ha="center", va="top", fontsize=12,
                  color=metric_color.get(metric, "#444444"),
                  clip_on=False)
    for lesson, pos_list in lesson_positions.items():
        center = sum(pos_list) / len(pos_list)
        ax_l.text(center, 1.02, lesson, transform=xform_top,
                  ha="center", va="bottom", fontsize=12, fontweight="bold",
                  color="#111111", clip_on=False)

                   
    if INCLUDE_FOLLOW or INCLUDE_INC:
        ax_l.set_ylim(-PAD_PCT, 100 + PAD_PCT)
    else:
        ax_l.set_yticks([])

    if INCLUDE_ASSIGNMENTS:
        ax_r.set_ylim(-PAD_ASSIGN, 5 + PAD_ASSIGN)
        ax_r.yaxis.set_major_locator(MultipleLocator(1))
    else:
        ax_r.set_yticks([])

    if INCLUDE_FOLLOW or INCLUDE_INC:
        ax_l.set_ylabel("Lesson (%)", fontsize=17, color="#333333")
        ax_l.tick_params(axis="y", labelsize=12)
    else:
        ax_l.set_ylabel("")

    if INCLUDE_ASSIGNMENTS:
        ax_r.set_ylabel("Assignment (0-5)", fontsize=17, color=C_ASSIGN)
        ax_r.tick_params(axis="y", colors=C_ASSIGN, labelsize=12)
    else:
        ax_r.set_ylabel("")
                           
    metrics_per_lesson = int(INCLUDE_FOLLOW) + int(INCLUDE_INC) + int(INCLUDE_ASSIGNMENTS)
    if metrics_per_lesson > 0:
        for i in range(1, len(blocks)):
            ax_l.axvline(i * metrics_per_lesson + 0.5, color="#CCCCCC", linewidth=1, linestyle=":")

    fig.tight_layout(rect=[0, 0.10, 1, 0.94])
    fig.savefig(out_path, dpi=150, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print(f"  ✓  {os.path.basename(out_path)}")                                   
                                
def main():
    if not any((INCLUDE_FOLLOW, INCLUDE_INC, INCLUDE_ASSIGNMENTS)):
        messagebox.showwarning(
            "Nothing selected",
            "Enable at least one metric at the top of scripts/charts.py."
        )
        return

    file_path = pick_file()
    if not file_path:
        print("No file selected."); return

    file_dir   = os.path.dirname(os.path.abspath(file_path))
    charts_dir = os.path.join(file_dir, "charts")
    anon_dir   = os.path.join(file_dir, "anon_charts")
    os.makedirs(charts_dir, exist_ok=True)
    os.makedirs(anon_dir,   exist_ok=True)

    df     = read_file(file_path)
    cols   = list(df.columns)
    blocks = find_lesson_blocks(cols)

    if not blocks:
        messagebox.showwarning("No lessons found",
            "Could not find any 'Lx Follow' columns.\nCheck the file format.")
        return

    print(f"\nFile   : {file_path}")
    print(f"Lessons: {[b['lesson'] for b in blocks]}")
    print(f"Output : {file_dir}\n")

                                                                        
    named_students = []
    data_rows      = []

    for _, row in df.iterrows():
        if not is_valid_id(row.get("ID")):
            break
        sid  = student_id(row)
        name = student_name(row) or sid or "Unknown"
        named_students.append((sid, name, row))
        if row_has_data(row, blocks):
            data_rows.append(row)

    print(f"Valid student rows  : {len(named_students)}")
    print(f"Rows with chart data: {len(data_rows)}\n")

    chart_students = [(s[0], s[1], s[2]) for s in named_students
                      if row_has_data(s[2], blocks)]

    def _total_score(student_tuple):
        _row = student_tuple[2]
        score = 0.0
        for b in blocks:
            if INCLUDE_FOLLOW:
                v = to_float(_row.iloc[b["col_follow"]])
                score += v if v is not None else 0.0
            if INCLUDE_INC:
                v = to_float(_row.iloc[b["col_sim"]])
                score += v if v is not None else 0.0
            if INCLUDE_ASSIGNMENTS:
                v = to_float(_row.iloc[b["col_score"]])
                score += (v * 20.0) if v is not None else 0.0
        return score

    chart_students.sort(key=_total_score, reverse=True)

                                                                        
    grids_done = 0
    for batch_start in range(0, len(chart_students), GRID_SIZE):
        batch     = chart_students[batch_start : batch_start + GRID_SIZE]
        fname     = f"batch_{grids_done + 1}"

                                      
        named_batch = [(s[1], s[2]) for s in batch]
        out = os.path.join(charts_dir, f"{fname}.png")
        try:
            save_grid_chart(named_batch, blocks, out, prefix_title=False)
            print(f"  ✓  charts/{fname}.png")
        except Exception as e:
            print(f"  ✗  charts/{fname}.png  — {e}")

                                              
        anon_batch = [(s[0] or "?", s[2]) for s in batch]
        out_anon = os.path.join(anon_dir, f"{fname}.png")
        try:
            save_grid_chart(anon_batch, blocks, out_anon, prefix_title=True)
            print(f"  ✓  anon_charts/{fname}.png")
        except Exception as e:
            print(f"  ✗  anon_charts/{fname}.png  — {e}")

        grids_done += 1

                                                                        
    print()
    for folder in (charts_dir, anon_dir):
        try:
            save_totals_chart(data_rows, blocks, os.path.join(folder, "totals.png"))
        except Exception as e:
            print(f"  ✗  totals in {os.path.basename(folder)}  — {e}")

    msg = (
        f"Done!\n\n"
        f"Valid students    : {len(named_students)}\n"
        f"With chart data   : {len(data_rows)}\n"
        f"Grid images       : {grids_done} × 2 folders\n"
        f"Totals plot       : in each folder\n\n"
        f"Output folder:\n{file_dir}"
    )
    print("\n" + msg)
    
    sys.exit(0)

if __name__ == "__main__":
    main()