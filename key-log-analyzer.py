import json
import tkinter as tk
from tkinter import filedialog
from datetime import datetime
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.gridspec import GridSpec
import matplotlib.dates as mdates


def select_file():
    root = tk.Tk()
    root.withdraw()  # hide the main window before selecting file
    file_path = filedialog.askopenfilename(
        title="Select Key Press Log File",
        filetypes=[("JSON files", "*.json"), ("All files", "*.*")]
    )
    return file_path


def load_keypress_data(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return data


def extract_interactions(key_presses):
    """
    Extract interaction events from key presses.
    Returns dict with lists of timestamps for each interaction type.
    """
    interactions = {
        'teacher-question': [],
        'student-question': [],
        'providing-help': []
    }
    
    for kp in key_presses:
        if 'interaction' in kp:
            interaction_type = kp['interaction']
            timestamp = kp['timestamp'] / 1000
            if interaction_type in interactions:
                interactions[interaction_type].append(timestamp)
    
    return interactions


def analyze_typing_rate(key_presses, window_seconds=60):
    if not key_presses:
        return [], []
    
    start_time = key_presses[0]['timestamp'] / 1000
    end_time = key_presses[-1]['timestamp'] / 1000
    
    current_time = start_time
    buckets = []
    
    while current_time <= end_time:
        bucket_end = current_time + window_seconds
        
        count = sum(1 for kp in key_presses 
                   if current_time <= kp['timestamp'] / 1000 < bucket_end)
        
        rate = (count / window_seconds) * 60
        
        buckets.append({
            'timestamp': current_time + window_seconds / 2,
            'rate': rate,
            'count': count
        })
        
        current_time = bucket_end
    
    timestamps = [b['timestamp'] for b in buckets]
    rates = [b['rate'] for b in buckets]
    
    return timestamps, rates


def calculate_intervals(key_presses):
    intervals = []
    for i in range(1, len(key_presses)):
        interval = (key_presses[i]['timestamp'] - key_presses[i-1]['timestamp']) / 1000
        intervals.append(interval)
    return intervals


def calculate_active_typing_stats(key_presses, pause_threshold=60):
    """
    Calculate typing statistics excluding long pauses.
    
    Args:
        key_presses: List of key press events
        pause_threshold: Threshold in seconds to consider a pause as "long"
    
    Returns:
        Dictionary with active typing time and rate
    """
    if len(key_presses) < 2:
        return {
            'active_time_seconds': 0,
            'active_time_minutes': 0,
            'active_rate': 0,
            'pause_time_seconds': 0,
            'pause_time_minutes': 0
        }
    
    intervals = calculate_intervals(key_presses)
    
    active_time = sum(interval for interval in intervals if interval <= pause_threshold)
    pause_time = sum(interval for interval in intervals if interval > pause_threshold)
    
    active_time_minutes = active_time / 60
    pause_time_minutes = pause_time / 60
    
    active_rate = len(key_presses) / active_time_minutes if active_time_minutes > 0 else 0
    
    return {
        'active_time_seconds': active_time,
        'active_time_minutes': active_time_minutes,
        'active_rate': active_rate,
        'pause_time_seconds': pause_time,
        'pause_time_minutes': pause_time_minutes
    }


def create_visualizations(data):
    key_presses = data['keyPresses']
    session_start = key_presses[0]['timestamp'] / 1000
    session_end = key_presses[-1]['timestamp'] / 1000
    
    long_pause_threshold = 60  # seconds - define this at the top for consistency
    
    timestamps, rates = analyze_typing_rate(key_presses, window_seconds=60)
    intervals = calculate_intervals(key_presses)
    active_stats = calculate_active_typing_stats(key_presses, pause_threshold=long_pause_threshold)
    interactions = extract_interactions(key_presses)
    
    datetime_stamps = [datetime.fromtimestamp(ts) for ts in timestamps]
    
    session_duration_minutes = (session_end - session_start) / 60
    actual_avg_rate = len(key_presses) / session_duration_minutes
    
    fig = plt.figure(figsize=(16, 10))
    gs = GridSpec(2, 1, figure=fig, hspace=0.25)
    
    ax1 = fig.add_subplot(gs[0])
    
    bar_width = (timestamps[1] - timestamps[0]) / (24 * 3600)  # convert to days for matplotlib
    
    ax1.bar(datetime_stamps, rates, width=bar_width, alpha=0.7, color='#2E86AB', edgecolor='#1a5a7a')
    ax1.set_title('Typing Rate Over Time', fontsize=14, fontweight='bold')
    ax1.set_xlabel('Time', fontsize=11)
    ax1.set_ylabel('Keys per Minute', fontsize=11)
    ax1.grid(True, alpha=0.3, axis='y')
    ax1.xaxis.set_major_formatter(mdates.DateFormatter('%H:%M:%S'))
    plt.setp(ax1.xaxis.get_majorticklabels(), rotation=45)
    
    ax1.axhline(y=actual_avg_rate, color='red', linestyle='--', alpha=0.7, linewidth=2,
                label=f'Session Average: {actual_avg_rate:.1f} kpm')
    ax1.axhline(y=active_stats['active_rate'], color='green', linestyle='--', alpha=0.7, linewidth=2,
                label=f'Active Typing Rate: {active_stats["active_rate"]:.1f} kpm')
    
    ymax = ax1.get_ylim()[1]
    
    ax1.legend(loc='upper right')
    
    ax2 = fig.add_subplot(gs[1])
    
    cumulative_timestamps = [kp['timestamp'] / 1000 for kp in key_presses]
    cumulative_datetime = [datetime.fromtimestamp(ts) for ts in cumulative_timestamps]
    cumulative_keys = list(range(1, len(key_presses) + 1))
    
    burst_threshold = 60          # seconds
    long_pause_min_duration = 60  # seconds
    
    burst_groups = []
    pause_indices = []
    current_burst = []
    
    for i, interval in enumerate(intervals):
        if interval < burst_threshold:
            if not current_burst:
                current_burst = [i]
            current_burst.append(i + 1)
        else:
            if current_burst and len(current_burst) > 1:
                burst_groups.append(current_burst)
            current_burst = []
            
            if interval > long_pause_min_duration:
                pause_indices.append(i)
    
    if current_burst and len(current_burst) > 1:
        burst_groups.append(current_burst)
    
    ax2.plot(cumulative_datetime, cumulative_keys, linewidth=2, color='#6A4C93', zorder=2)
    ax2.fill_between(cumulative_datetime, cumulative_keys, alpha=0.3, color='#6A4C93', zorder=1)
    
    burst_colors = ['#2196F3', '#FFFF00']  # Blue and Yellow
    for burst_idx, burst_indices in enumerate(burst_groups):
        color = burst_colors[burst_idx % 2]
        burst_times = [cumulative_datetime[i] for i in burst_indices]
        burst_counts = [cumulative_keys[i] for i in burst_indices]
        label = None
        if burst_idx == 0:
            label = 'Typing Bursts'
        ax2.scatter(burst_times, burst_counts, color=color, alpha=0.5, s=25, 
                   label=label, zorder=3, edgecolors='none')
    
    ymax_cumulative = max(cumulative_keys)
    
    if interactions['teacher-question']:
        teacher_times = [datetime.fromtimestamp(ts) for ts in interactions['teacher-question']]
        ax2.vlines(teacher_times, 0, ymax_cumulative, colors='red', linestyles='solid', 
                  alpha=0.6, linewidth=3, label='Teacher Question', zorder=4)
    
    if interactions['student-question']:
        student_times = [datetime.fromtimestamp(ts) for ts in interactions['student-question']]
        ax2.vlines(student_times, 0, ymax_cumulative, colors='orange', linestyles='solid', 
                  alpha=0.6, linewidth=3, label='Student Question', zorder=4)
    
    if interactions['providing-help']:
        help_times = [datetime.fromtimestamp(ts) for ts in interactions['providing-help']]
        ax2.vlines(help_times, 0, ymax_cumulative, colors='green', linestyles='solid', 
                  alpha=0.6, linewidth=3, label='Help Provided', zorder=4)
    
    ax2.set_xlabel('Time', fontsize=11)
    ax2.set_ylabel('Total Key Presses', fontsize=11)
    ax2.grid(True, alpha=0.3)
    ax2.xaxis.set_major_formatter(mdates.DateFormatter('%H:%M:%S'))
    plt.setp(ax2.xaxis.get_majorticklabels(), rotation=45)
    
    ax2.legend(loc='upper left', fontsize=10)
    
    lesson_file = data.get('lessonFile', 'Unknown')
    fig.suptitle(f'Key Press Analysis: {lesson_file}', 
                 fontsize=16, fontweight='bold', y=0.995)
    
    max_rate = np.max(rates) if rates else 0
    
    bursts = []
    current_burst = []
    
    for i, interval in enumerate(intervals):
        if interval < burst_threshold:
            if not current_burst:
                current_burst = [i]
            current_burst.append(i + 1)
        else:
            if current_burst and len(current_burst) > 1:
                bursts.append(current_burst)
            current_burst = []
    
    if current_burst and len(current_burst) > 1:
        bursts.append(current_burst)
    
    long_pauses = [i for i in intervals if i > long_pause_min_duration]
    
    total_interactions = sum(len(v) for v in interactions.values())
    
    print(f"\n{'='*60}")
    print(f"SESSION STATISTICS")
    print(f"{'='*60}")
    print(f"\nGeneral Information:")
    print(f"  Lesson File: {lesson_file}")
    print(f"  Session Start: {datetime.fromtimestamp(session_start).strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  Session End: {datetime.fromtimestamp(session_end).strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  Total Duration: {session_duration_minutes:.1f} minutes ({session_duration_minutes/60:.2f} hours)")
    print(f"  Total Key Presses: {len(key_presses):,}")
    
    print(f"\nTyping Rate:")
    print(f"  Average: {actual_avg_rate:.2f} keys/min")
    print(f"  Average (excluding pauses >{long_pause_threshold}s): {active_stats['active_rate']:.2f} keys/min")
    print(f"  Maximum: {max_rate:.2f} keys/min")
    print(f"  Active Typing: {active_stats['active_time_minutes']:.1f} / {session_duration_minutes:.1f} minutes ({(active_stats['active_time_minutes']/session_duration_minutes*100):.1f}%)")
    print(f"  Typing Bursts: {len(bursts)}")
    print(f"  Long Pauses (>{long_pause_min_duration}s): {len(long_pauses)}")
    print(f"  Longest Pause: {max(intervals):.1f} seconds")
    if long_pauses:
        print(f"  Average Long Pause Duration: {np.mean(long_pauses):.1f} seconds")
    
    print(f"\nInteractions:")
    print(f"  Total Interactions: {total_interactions}")
    print(f"  Teacher Questions: {len(interactions['teacher-question'])}")
    print(f"  Student Questions: {len(interactions['student-question'])}")
    print(f"  Help Provided: {len(interactions['providing-help'])}")
    
    if total_interactions > 0:
        print(f"\n  Interaction Timeline:")
        all_interactions = []
        for itype, timestamps in interactions.items():
            for ts in timestamps:
                all_interactions.append((ts, itype))
        all_interactions.sort()
        
        for ts, itype in all_interactions:
            time_str = datetime.fromtimestamp(ts).strftime('%H:%M:%S')
            print(f"    {time_str} - {itype.replace('-', ' ').title()}")
    
    print(f"\n{'='*60}\n")
    
    plt.tight_layout()
    return fig


def main():
    print("Key Press Log Analyzer with Interactions")
    print("=" * 50)
    
    file_path = select_file()
    
    if not file_path:
        print("No file selected. Exiting.")
        return
    
    print(f"\nLoading data from: {file_path}")
    
    try:
        data = load_keypress_data(file_path)
        
        print(f"Total key presses: {data.get('totalKeyPresses', 0)}")
        print(f"Session start: {datetime.fromtimestamp(data['sessionStart']/1000)}")
        
        print("\nGenerating visualizations...")
        fig = create_visualizations(data)
        
        print("Done! Close the plot window to exit.")
        plt.show()
        
    except Exception as e:
        print(f"\nError: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()