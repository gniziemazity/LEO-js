import json
import tkinter as tk
from tkinter import filedialog, messagebox
from datetime import datetime
import matplotlib.pyplot as plt
from matplotlib.gridspec import GridSpec
import matplotlib.dates as mdates
import csv
import textwrap
import warnings

warnings.filterwarnings('ignore', category=UserWarning, module='tkinter')
warnings.filterwarnings('ignore', message='.*tight_layout.*')

class Config:
    BURST_GAP_THRESHOLD = 30
    MIN_BURST_CHARS = 2
    TOOLTIP_MAX_LINES = 15
    TOOLTIP_WIDTH = 60
    HOVER_DISTANCE_THRESHOLD = 15
    CLICK_DISTANCE_THRESHOLD = 0.05
    SESSION_PADDING_SECONDS = 120
    
    CROSSHAIR_KEY = ' '
    
    CHART_FIGURE_SIZE = (16, 12)
    CHART_FIGURE_SIZE_NO_STUDENTS = (16, 10)
    
    BAR_COLOR = '#777777'
    BAR_EDGE_COLOR = '#000000'
    BAR_ALPHA = 0.7
    
    SESSION_RATE_COLOR = 'red'
    ACTIVE_RATE_COLOR = 'black'
    LINE_ALPHA = 0.7
    LINE_WIDTH = 2
    
    CUMULATIVE_LINE_COLOR = '#CCCCCC'
    CUMULATIVE_LINE_WIDTH = 2
    CUMULATIVE_FILL_ALPHA = 0.3
    
    BURST_MARKER_COLOR = 'black'
    BURST_MARKER_ALPHA = 0.5
    BURST_MARKER_SIZE = 25
    
    QUESTION_ANSWERED_COLOR = 'blue'
    QUESTION_UNANSWERED_COLOR = 'red'
    QUESTION_STUDENT_COLOR = 'orange'
    QUESTION_HELP_COLOR = 'green'
    QUESTION_ALPHA = 0.3
    QUESTION_LINE_WIDTH = 3
    QUESTION_LINE_ALPHA = 0.6
    
    STUDENT_ANSWERED_COLOR = '#1565C0'
    STUDENT_NO_ANSWER_COLOR = '#CCCCCC'
    STUDENT_MARKER_SIZE = 60
    STUDENT_MARKER_SIZE_ANSWERED = 144
    STUDENT_ALPHA = 0.6
    STUDENT_ALPHA_ANSWERED = 1.0
    STUDENT_EDGE_WIDTH = 2

def find_files_in_directory():
    """
    Look for JSON keypress log and CSV student data files in the script's directory.
    Returns tuple of (json_path, csv_path) where either can be None.
    """
    import os
    script_dir = os.path.dirname(os.path.abspath(__file__))
    
    json_files = []
    csv_files = []
    
    for filename in os.listdir(script_dir):
        full_path = os.path.join(script_dir, filename)
        if not os.path.isfile(full_path):
            continue
        
        if filename.endswith('.json'):
            try:
                with open(full_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    if 'keyPresses' in data and isinstance(data['keyPresses'], list):
                        json_files.append(full_path)
            except:
                pass
        
        elif filename.endswith('.csv'):
            csv_files.append(full_path)
    
    json_path = json_files[0] if len(json_files) == 1 else None
    csv_path = csv_files[0] if len(csv_files) == 1 else None
    
    return json_path, csv_path

def select_file():
    root = tk.Tk()
    root.withdraw()
    file_path = filedialog.askopenfilename(
        title="Select Key Press Log File",
        filetypes=[("JSON files", "*.json"), ("All files", "*.*")]
    )
    return file_path

def select_csv_file():
    root = tk.Tk()
    root.withdraw()
    file_path = filedialog.askopenfilename(
        title="Select Student Follow Data CSV File",
        filetypes=[("CSV files", "*.csv"), ("All files", "*.*")]
    )
    return file_path

def load_keypress_data(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return data

def load_student_data(csv_path, total_keypresses):
    students = []
    try:
        with open(csv_path, 'r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f, delimiter=';')
            for row in reader:
                student_name = row.get('Student', '').strip()
                if not student_name:
                    continue
                
                try:
                    fs_str = row.get('Follow Score', '').strip()
                    follow_score = float(fs_str.replace(',', '.')) if fs_str else None
                except ValueError:
                    follow_score = None
                
                try:
                    ch_str = row.get('Char Hist', '').strip()
                    char_hist = float(ch_str.replace(',', '.')) if ch_str else None
                except ValueError:
                    char_hist = None
                
                if follow_score is None or char_hist is None:
                    continue
                
                error_pos = None
                if follow_score is not None and total_keypresses > 0:
                    fraction = min(follow_score / 100.0, 0.999)
                    error_pos = int(fraction * total_keypresses)
                    error_pos = max(0, min(error_pos, total_keypresses - 1))
                
                students.append({
                    'name': student_name,
                    'follow_score': follow_score,
                    'char_hist': char_hist,
                    'error_position': error_pos
                })
    except Exception as e:
        print(f"Error loading student data: {e}")
        return []
    return students

def extract_interactions(key_presses):
    interactions = {
        'teacher-question': [],
        'student-question': [],
        'providing-help': []
    }
    for kp in key_presses:
        if 'interaction' in kp:
            itype = kp['interaction']
            if itype in interactions:
                interactions[itype].append({
                    'timestamp': kp['timestamp'] / 1000,
                    'info': kp.get('info', ''),
                    'answered_by': kp.get('answered_by', None)
                })
    return interactions

def calculate_intervals(key_presses):
    intervals = []
    for i in range(1, len(key_presses)):
        intervals.append((key_presses[i]['timestamp'] - key_presses[i-1]['timestamp']) / 1000)
    return intervals

def find_keypress_at_position(key_presses, position):
    if position is None or position < 0 or position >= len(key_presses):
        return None
    return key_presses[position]['timestamp'] / 1000

def analyze_typing_blocks(key_presses):
    """
    Analyze typing into continuous blocks based on gaps between keypresses.
    Each block starts at the first character and ends at the last character.
    """
    if not key_presses:
        return [], [], []
    
    char_presses = [kp for kp in key_presses if 'char' in kp]
    if not char_presses:
        return [], [], []
    
    blocks = []
    current_block = [char_presses[0]]
    
    for i in range(1, len(char_presses)):
        time_gap = (char_presses[i]['timestamp'] - char_presses[i-1]['timestamp']) / 1000
        
        if time_gap < Config.BURST_GAP_THRESHOLD:
            current_block.append(char_presses[i])
        else:
            if len(current_block) >= Config.MIN_BURST_CHARS:
                blocks.append(current_block)
            current_block = [char_presses[i]]
    
    if len(current_block) >= Config.MIN_BURST_CHARS:
        blocks.append(current_block)
    
    timestamps = []
    rates = []
    texts = []
    widths = []
    
    for block in blocks:
        start_time = block[0]['timestamp'] / 1000
        end_time = block[-1]['timestamp'] / 1000
        duration = end_time - start_time
        
        if duration == 0:
            duration = 1
        
        char_count = len(block)
        rate = (char_count / duration) * 60
        text = "".join([kp.get('char', '') for kp in block])
        
        center_time = (start_time + end_time) / 2
        width_days = duration / (24 * 3600)
        
        timestamps.append(center_time)
        rates.append(rate)
        texts.append(text)
        widths.append(width_days)
    
    return timestamps, rates, texts, widths

def create_visualizations(data, student_data=None):
    key_presses = data['keyPresses']
    session_start = key_presses[0]['timestamp'] / 1000
    session_end = key_presses[-1]['timestamp'] / 1000
    
    timestamps, rates, texts, widths = analyze_typing_blocks(key_presses)
    intervals = calculate_intervals(key_presses)
    interactions = extract_interactions(key_presses)
    
    datetime_stamps = [datetime.fromtimestamp(ts) for ts in timestamps]
    
    char_count = len([kp for kp in key_presses if 'char' in kp])
    actual_avg_rate = char_count / ((session_end - session_start) / 60)
    
    if rates and widths:
        total_chars = sum(rate * (width * 24 * 60) for rate, width in zip(rates, widths))
        total_time = sum(width * 24 * 60 for width in widths)
        active_rate = total_chars / total_time if total_time > 0 else 0
    else:
        active_rate = 0
    
    has_student_data = student_data and len(student_data) > 0
    figsize = Config.CHART_FIGURE_SIZE if has_student_data else Config.CHART_FIGURE_SIZE_NO_STUDENTS
    fig = plt.figure(figsize=figsize)
    gs = GridSpec(3 if has_student_data else 2, 1, figure=fig, hspace=0.3)
    
    ax1 = fig.add_subplot(gs[0])
    
    bars = ax1.bar(
        datetime_stamps, rates, width=widths,
        alpha=Config.BAR_ALPHA,
        color=Config.BAR_COLOR,
        edgecolor=Config.BAR_EDGE_COLOR
    )
    
    ax1.set_ylabel('Keys per Minute (kpm)', fontsize=11)
    ax1.set_yscale('log')
    ax1.yaxis.set_major_formatter(plt.ScalarFormatter())
    ax1.yaxis.set_minor_formatter(plt.NullFormatter())
    ax1.yaxis.set_major_locator(plt.FixedLocator([10, 100, 1000]))
    ax1.grid(True, alpha=0.3, axis='y')
    ax1.xaxis.set_major_formatter(mdates.DateFormatter('%H:%M:%S'))
    plt.setp(ax1.xaxis.get_majorticklabels(), rotation=45)
    
    ax1.axhline(
        y=actual_avg_rate,
        color=Config.SESSION_RATE_COLOR,
        linestyle='--',
        alpha=Config.LINE_ALPHA,
        linewidth=Config.LINE_WIDTH,
        label=f'Session Rate : {actual_avg_rate:.1f} kpm'
    )
    ax1.axhline(
        y=active_rate,
        color=Config.ACTIVE_RATE_COLOR,
        linestyle='--',
        alpha=Config.LINE_ALPHA,
        linewidth=Config.LINE_WIDTH,
        label=f'Active Rate   : {active_rate:.1f} kpm'
    )
    ax1.legend(loc='upper right')
    
    ax1.set_xlim(
        datetime.fromtimestamp(session_start - Config.SESSION_PADDING_SECONDS),
        datetime.fromtimestamp(session_end + Config.SESSION_PADDING_SECONDS)
    )
    
    bar_artists = []
    for i, bar in enumerate(bars):
        bar_artists.append({
            'rect': bar,
            'text': texts[i],
            'rate': rates[i],
            'time': datetime_stamps[i],
            'width': widths[i]
        })

    ax2 = fig.add_subplot(gs[1], sharex=ax1)
    
    cum_dates = [datetime.fromtimestamp(kp['timestamp']/1000) for kp in key_presses]
    cum_keys = list(range(1, len(key_presses) + 1))
    
    burst_groups = []
    current_burst = []
    for i, interval in enumerate(intervals):
        if interval < Config.BURST_GAP_THRESHOLD:
            if not current_burst:
                current_burst = [i]
            current_burst.append(i + 1)
        else:
            if len(current_burst) > 1:
                filtered = [idx for idx in current_burst if 'char' in key_presses[idx]]
                if len(filtered) > 1:
                    burst_groups.append(filtered)
            current_burst = []
    
    if len(current_burst) > 1:
        filtered = [idx for idx in current_burst if 'char' in key_presses[idx]]
        if len(filtered) > 1:
            burst_groups.append(filtered)
            
    ax2.plot(
        cum_dates, cum_keys,
        linewidth=Config.CUMULATIVE_LINE_WIDTH,
        color=Config.CUMULATIVE_LINE_COLOR,
        zorder=2
    )
    ax2.fill_between(
        cum_dates, cum_keys,
        alpha=Config.CUMULATIVE_FILL_ALPHA,
        color=Config.CUMULATIVE_LINE_COLOR,
        zorder=1
    )
    
    burst_artists = []
    for b_indices in burst_groups:
        b_times = [cum_dates[i] for i in b_indices]
        b_counts = [cum_keys[i] for i in b_indices]
        scatter = ax2.scatter(
            b_times, b_counts,
            color=Config.BURST_MARKER_COLOR,
            alpha=Config.BURST_MARKER_ALPHA,
            s=Config.BURST_MARKER_SIZE,
            zorder=3,
            edgecolors='none'
        )
        for i, idx in enumerate(b_indices):
            burst_artists.append({
                'scatter': scatter,
                'x': b_times[i],
                'y': b_counts[i],
                'keypress': key_presses[idx]
            })

    question_artists = []
    for q in interactions['teacher-question']:
        q_ts = q['timestamp']
        next_kp_ts = None
        for kp in key_presses:
            if kp['timestamp']/1000 > q_ts:
                next_kp_ts = kp['timestamp']/1000
                break
        
        color = Config.QUESTION_ANSWERED_COLOR if q['answered_by'] else Config.QUESTION_UNANSWERED_COLOR
        
        if next_kp_ts:
            start = datetime.fromtimestamp(q_ts)
            end = datetime.fromtimestamp(next_kp_ts)
            rect = ax2.axvspan(start, end, color=color, alpha=Config.QUESTION_ALPHA, zorder=4)
            
            question_artists.append({
                'rect': rect,
                'data': q,
                'start': start,
                'end': end,
                'x': start
            })
        else:
            line = ax2.axvline(
                datetime.fromtimestamp(q_ts),
                color=color,
                linewidth=Config.QUESTION_LINE_WIDTH,
                alpha=Config.QUESTION_LINE_ALPHA
            )
            question_artists.append({
                'line': line,
                'data': q,
                'x': datetime.fromtimestamp(q_ts)
            })

    for q in interactions['student-question']:
        color = Config.QUESTION_ANSWERED_COLOR if q['answered_by'] else Config.QUESTION_UNANSWERED_COLOR
        line = ax2.axvline(
            datetime.fromtimestamp(q['timestamp']),
            color=color,
            linewidth=Config.QUESTION_LINE_WIDTH,
            alpha=Config.QUESTION_LINE_ALPHA,
            linestyle='--'
        )
        question_artists.append({
            'line': line,
            'data': q,
            'x': datetime.fromtimestamp(q['timestamp'])
        })
    
    for q in interactions['providing-help']:
        line = ax2.axvline(
            datetime.fromtimestamp(q['timestamp']),
            color=Config.QUESTION_HELP_COLOR,
            linewidth=Config.QUESTION_LINE_WIDTH,
            alpha=Config.QUESTION_LINE_ALPHA,
            linestyle='--'
        )
        question_artists.append({
            'line': line,
            'data': q,
            'x': datetime.fromtimestamp(q['timestamp'])
        })

    ax2.set_ylabel('Total Key Presses', fontsize=11)
    ax2.grid(True, alpha=0.3)
    ax2.xaxis.set_major_formatter(mdates.DateFormatter('%H:%M:%S'))
    plt.setp(ax2.xaxis.get_majorticklabels(), rotation=45)
    
    ax2.text(
        0.006, 0.96, f'Total: {char_count}',
        transform=ax2.transAxes,
        fontsize=10,
        verticalalignment='top',
        horizontalalignment='left',
        bbox=dict(boxstyle='round', facecolor='white', alpha=0.8)
    )

    student_artists = []
    ax3 = None
    if has_student_data:
        ax3 = fig.add_subplot(gs[2], sharex=ax1)
        
        students_answering = {}
        for q in interactions['teacher-question']:
            if q['answered_by']:
                name = str(q['answered_by'])
                if name not in students_answering:
                    students_answering[name] = []
                students_answering[name].append(q.get('info', 'Question'))
        
        students_with_answers = []
        students_without_answers = []
        
        for s in student_data:
            if s['error_position'] is not None:
                err_ts = find_keypress_at_position(key_presses, s['error_position'])
                if err_ts:
                    err_dt = datetime.fromtimestamp(err_ts)
                    val = s.get('char_hist', s.get('follow_score', 0))
                    ans_list = students_answering.get(s['name'], [])
                    
                    student_info = {
                        'data': s,
                        'x': err_dt,
                        'y': val,
                        'answered': ans_list
                    }
                    
                    if ans_list:
                        students_with_answers.append(student_info)
                    else:
                        students_without_answers.append(student_info)
        
        for s_info in students_without_answers:
            sc = ax3.scatter(
                s_info['x'], s_info['y'],
                s=Config.STUDENT_MARKER_SIZE,
                color=Config.STUDENT_NO_ANSWER_COLOR,
                alpha=Config.STUDENT_ALPHA,
                edgecolors='black',
                linewidths=1,
                zorder=5
            )
            s_info['scatter'] = sc
            student_artists.append(s_info)
        
        for s_info in students_with_answers:
            sc = ax3.scatter(
                s_info['x'], s_info['y'],
                s=Config.STUDENT_MARKER_SIZE_ANSWERED,
                color=Config.STUDENT_ANSWERED_COLOR,
                alpha=Config.STUDENT_ALPHA_ANSWERED,
                marker='*',
                edgecolors='darkblue',
                linewidths=Config.STUDENT_EDGE_WIDTH,
                zorder=10
            )
            s_info['scatter'] = sc
            student_artists.append(s_info)
        
        ax3.set_xlabel('Time of First Error', fontsize=11)
        ax3.set_ylabel('Similarity to Teacher\'s Code', fontsize=11)
        ax3.grid(True, alpha=0.3)
        ax3.xaxis.set_major_formatter(mdates.DateFormatter('%H:%M:%S'))
        plt.setp(ax3.xaxis.get_majorticklabels(), rotation=45)

    curr_ann = {'ax1': None, 'ax2': None, 'ax3': None}
    crosshair = {
        'ax1_line': None,
        'ax2_line': None,
        'ax3_line': None,
        'time_label': None
    }
    keyboard_state = {'space_pressed': False}

    def on_key_press(event):
        if event.key == Config.CROSSHAIR_KEY:
            keyboard_state['space_pressed'] = True

    def on_key_release(event):
        if event.key == Config.CROSSHAIR_KEY:
            keyboard_state['space_pressed'] = False
            if crosshair['ax1_line']:
                crosshair['ax1_line'].remove()
                crosshair['ax1_line'] = None
            if crosshair['ax2_line']:
                crosshair['ax2_line'].remove()
                crosshair['ax2_line'] = None
            if crosshair['ax3_line']:
                crosshair['ax3_line'].remove()
                crosshair['ax3_line'] = None
            if crosshair['time_label']:
                crosshair['time_label'].remove()
                crosshair['time_label'] = None
            fig.canvas.draw_idle()

    def on_hover(event):
        if keyboard_state['space_pressed'] and (event.inaxes in [ax1, ax2] or (has_student_data and event.inaxes == ax3)):
            if event.xdata:
                if crosshair['ax1_line']:
                    crosshair['ax1_line'].remove()
                if crosshair['ax2_line']:
                    crosshair['ax2_line'].remove()
                if crosshair['ax3_line']:
                    crosshair['ax3_line'].remove()
                if crosshair['time_label']:
                    crosshair['time_label'].remove()
                
                crosshair['ax1_line'] = ax1.axvline(event.xdata, color='black', linewidth=1, alpha=0.5, zorder=1)
                crosshair['ax2_line'] = ax2.axvline(event.xdata, color='black', linewidth=1, alpha=0.5, zorder=1)
                if has_student_data and ax3:
                    crosshair['ax3_line'] = ax3.axvline(event.xdata, color='black', linewidth=1, alpha=0.5, zorder=1)
                
                time_dt = mdates.num2date(event.xdata)
                time_str = time_dt.strftime('%H:%M:%S')
                if event.inaxes == ax1:
                    y_pos = ax1.get_ylim()[0]
                    crosshair['time_label'] = ax1.text(
                        event.xdata, y_pos, time_str,
                        ha='center', va='top', fontsize=8,
                        bbox=dict(boxstyle='round,pad=0.3', facecolor='white', alpha=0.9, edgecolor='black'),
                        zorder=15
                    )
                elif event.inaxes == ax2:
                    y_pos = ax2.get_ylim()[0]
                    crosshair['time_label'] = ax2.text(
                        event.xdata, y_pos, time_str,
                        ha='center', va='top', fontsize=8,
                        bbox=dict(boxstyle='round,pad=0.3', facecolor='white', alpha=0.9, edgecolor='black'),
                        zorder=15
                    )
                elif has_student_data and event.inaxes == ax3:
                    y_pos = ax3.get_ylim()[0]
                    crosshair['time_label'] = ax3.text(
                        event.xdata, y_pos, time_str,
                        ha='center', va='top', fontsize=8,
                        bbox=dict(boxstyle='round,pad=0.3', facecolor='white', alpha=0.9, edgecolor='black'),
                        zorder=15
                    )
                
                fig.canvas.draw_idle()
        elif not keyboard_state['space_pressed']:
            changed = False
            if crosshair['ax1_line']:
                crosshair['ax1_line'].remove()
                crosshair['ax1_line'] = None
                changed = True
            if crosshair['ax2_line']:
                crosshair['ax2_line'].remove()
                crosshair['ax2_line'] = None
                changed = True
            if crosshair['ax3_line']:
                crosshair['ax3_line'].remove()
                crosshair['ax3_line'] = None
                changed = True
            if crosshair['time_label']:
                crosshair['time_label'].remove()
                crosshair['time_label'] = None
                changed = True
            if changed:
                fig.canvas.draw_idle()
        
        if event.inaxes not in [ax1, ax2] and (not has_student_data or event.inaxes != ax3):
            if crosshair['ax1_line']:
                crosshair['ax1_line'].remove()
                crosshair['ax1_line'] = None
            if crosshair['ax2_line']:
                crosshair['ax2_line'].remove()
                crosshair['ax2_line'] = None
            if crosshair['ax3_line']:
                crosshair['ax3_line'].remove()
                crosshair['ax3_line'] = None
            if crosshair['time_label']:
                crosshair['time_label'].remove()
                crosshair['time_label'] = None
            
            for k in curr_ann:
                if curr_ann[k]:
                    curr_ann[k].remove()
                    curr_ann[k] = None
            
            fig.canvas.draw_idle()
            return
        
        if event.inaxes == ax1:
            for k in curr_ann:
                if curr_ann[k]:
                    curr_ann[k].remove()
                    curr_ann[k] = None
            
            mouse_pt = (event.x, event.y)
            closest = None
            for ba in bar_artists:
                if ba['rect'].get_window_extent(fig.canvas.get_renderer()).contains(*mouse_pt):
                    closest = ba
                    break
            
            if closest:
                raw = closest['text'].replace('\r', '')
                lines = raw.split('\n')
                display_lines = []
                line_count = 0
                
                for line in lines:
                    if line_count >= Config.TOOLTIP_MAX_LINES:
                        display_lines.append("[... more text ...]")
                        break
                    
                    if not line:
                        display_lines.append("")
                        line_count += 1
                        continue
                    
                    wrapped = textwrap.wrap(
                        line,
                        width=Config.TOOLTIP_WIDTH,
                        break_long_words=False,
                        replace_whitespace=False
                    )
                    display_lines.extend(wrapped)
                    line_count += len(wrapped)
                
                final_text = "\n".join(display_lines)
                duration_seconds = closest['width'] * 24 * 60 * 60
                duration_minutes = int(duration_seconds // 60)
                duration_secs = int(duration_seconds % 60)
                duration_str = f"{duration_minutes}:{duration_secs:02d}"
                
                char_count = len(closest['text'])
                
                label = f"Duration: {duration_str}\nRate: {closest['rate']:.1f} kpm\nChars: {char_count}\n\n{final_text}"
                
                y_pos = ax1.transData.inverted().transform((0, event.y))[1]
                
                ann = ax1.annotate(
                    label,
                    xy=(closest['time'], y_pos),
                    xytext=(10, 10),
                    textcoords='offset points',
                    fontsize=8,
                    fontname='monospace',
                    bbox=dict(boxstyle='round,pad=0.5', facecolor='white', alpha=0.95),
                    arrowprops=dict(arrowstyle='->'),
                    zorder=20
                )
                curr_ann['ax1'] = ann
                fig.canvas.draw_idle()

        elif event.inaxes == ax2:
            for k in curr_ann:
                if curr_ann[k]:
                    curr_ann[k].remove()
                    curr_ann[k] = None
            
            closest_b, min_d = None, float('inf')
            for ba in burst_artists:
                px = ax2.transData.transform((mdates.date2num(ba['x']), ba['y']))
                dist = ((event.x - px[0])**2 + (event.y - px[1])**2)**0.5
                if dist < min_d:
                    min_d = dist
                    closest_b = ba
            
            if closest_b and min_d < Config.HOVER_DISTANCE_THRESHOLD:
                char = closest_b['keypress'].get('char', '?')
                
                if char in ['\n', '\r']:
                    char_disp = '\\n'
                elif char == '\t':
                    char_disp = '\\t'
                elif char == ' ':
                    char_disp = "' '"
                else:
                    char_disp = f"'{char}'"
                
                lbl = f"Char: {char_disp}"
                ann = ax2.annotate(
                    lbl,
                    xy=(closest_b['x'], closest_b['y']),
                    xytext=(10, 10),
                    textcoords='offset points',
                    fontsize=9,
                    bbox=dict(boxstyle='round', facecolor='white', alpha=0.9),
                    arrowprops=dict(arrowstyle='->'),
                    zorder=10
                )
                curr_ann['ax2'] = ann
                fig.canvas.draw_idle()
                return

            closest_q = None
            if event.x is not None:
                for qa in question_artists:
                    if 'rect' in qa:
                        x0 = ax2.transData.transform((mdates.date2num(qa['start']), 0))[0]
                        x1 = ax2.transData.transform((mdates.date2num(qa['end']), 0))[0]
                        if x0 <= event.x <= x1:
                            closest_q = qa
                            break
            
            if closest_q:
                q = closest_q['data']
                if q.get('answered_by'):
                    txt = f"{q.get('info','')}\nAnswered by: {q.get('answered_by')}"
                else:
                    txt = q.get('info','')
                y_pos = ax2.transData.inverted().transform((0, event.y))[1]
                ann = ax2.annotate(
                    txt,
                    xy=(closest_q['x'], y_pos),
                    xytext=(10, 10),
                    textcoords='offset points',
                    fontsize=9,
                    bbox=dict(boxstyle='round', facecolor='white', alpha=0.9),
                    arrowprops=dict(arrowstyle='->'),
                    zorder=10
                )
                curr_ann['ax2'] = ann
                fig.canvas.draw_idle()

        elif has_student_data and event.inaxes == ax3:
            for k in curr_ann:
                if curr_ann[k]:
                    curr_ann[k].remove()
                    curr_ann[k] = None
            
            closest_s, min_d = None, float('inf')
            for sa in student_artists:
                px = ax3.transData.transform((mdates.date2num(sa['x']), sa['y']))
                dist = ((event.x - px[0])**2 + (event.y - px[1])**2)**0.5
                if dist < min_d:
                    min_d = dist
                    closest_s = sa
            
            if closest_s and min_d < 20:
                d = closest_s['data']
                lbl = f"{d['name']} ({d.get('follow_score',0):.0f}%, {d.get('char_hist',0):.1f}%)"
                if closest_s['answered']:
                    lbl += "\n\nAnswered:\n" + "\n".join([f"- {x}" for x in closest_s['answered']])
                ann = ax3.annotate(
                    lbl,
                    xy=(closest_s['x'], closest_s['y']),
                    xytext=(10, 10),
                    textcoords='offset points',
                    fontsize=9,
                    bbox=dict(boxstyle='round', facecolor='white', alpha=0.8),
                    arrowprops=dict(arrowstyle='->')
                )
                curr_ann['ax3'] = ann
                fig.canvas.draw_idle()

    def on_click(event):
        if has_student_data and event.inaxes == ax3 and event.xdata:
            closest_s, min_d = None, float('inf')
            xr = ax3.get_xlim()[1] - ax3.get_xlim()[0]
            yr = ax3.get_ylim()[1] - ax3.get_ylim()[0]
            for sa in student_artists:
                dx = abs(mdates.date2num(sa['x']) - mdates.date2num(event.xdata)) / xr
                dy = abs(sa['y'] - event.ydata) / yr
                dist = (dx**2 + dy**2)**0.5
                if dist < min_d:
                    min_d = dist
                    closest_s = sa
            
            if closest_s and min_d < Config.CLICK_DISTANCE_THRESHOLD:
                d = closest_s['data']
                print(f"\n{'='*30}\nSTUDENT: {d['name']}\nFollow: {d.get('follow_score')}\nCharHist: {d.get('char_hist')}\n{'='*30}\n")

    fig.canvas.mpl_connect('motion_notify_event', on_hover)
    fig.canvas.mpl_connect('button_press_event', on_click)
    fig.canvas.mpl_connect('key_press_event', on_key_press)
    fig.canvas.mpl_connect('key_release_event', on_key_release)
    
    print("Visualizations generated.")
    plt.tight_layout()
    plt.subplots_adjust(left=0.06, right=0.98, top=0.98, bottom=0.08)
    return fig

def main():
    print("Key Press Analyzer Started...")
    
    json_path, csv_path = find_files_in_directory()
    
    if json_path:
        print(f"Auto-detected JSON file: {json_path}")
        fp = json_path
    else:
        fp = select_file()
        if not fp:
            return
    
    data = load_keypress_data(fp)
    
    s_data = None
    if csv_path:
        print(f"Auto-detected CSV file: {csv_path}")
        s_data = load_student_data(csv_path, len(data['keyPresses']))
    else:
        if messagebox.askyesno("Load Student Data", "Load CSV?"):
            cp = select_csv_file()
            if cp:
                s_data = load_student_data(cp, len(data['keyPresses']))
    
    create_visualizations(data, s_data)
    
    plt.draw()
    plt.pause(0.1)
    
    manager = plt.get_current_fig_manager()
    try:
        if hasattr(manager, 'window'):
            manager.window.state('zoomed')
        elif hasattr(manager, 'frame'):
            manager.frame.Maximize(True)
        elif hasattr(manager, 'full_screen_toggle'):
            manager.full_screen_toggle()
    except:
        pass
    
    plt.show()

if __name__ == "__main__":
    main()