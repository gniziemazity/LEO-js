"""
Tkinter-based key-press analyzer. Alternative to the LEO timeline (timeline.html).
"""
import json
import os
import tkinter as tk
from tkinter import filedialog

import matplotlib.pyplot as plt

from utils.lv_timeline_config import Config
from utils.lv_timeline_data import load_keypress_data, load_student_data_from_xlsx
from utils.lv_timeline_chart import create_visualizations


def find_files_in_directory():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    json_files = []
    for filename in os.listdir(script_dir):
        full_path = os.path.join(script_dir, filename)
        if not os.path.isfile(full_path) or not filename.endswith('.json'):
            continue
        try:
            with open(full_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if 'events' in data and isinstance(data['events'], list):
                    json_files.append(full_path)
        except (json.JSONDecodeError, OSError, ValueError):
            pass
    return json_files[0] if len(json_files) == 1 else None


def find_xlsx_files(directory):
    folder_name = os.path.basename(directory)
    for base in (os.path.join(directory, 'excels'), directory):
        for name in ('remarks.xlsx', f'remarks_{folder_name}.xlsx'):
            candidate = os.path.join(base, name)
            if os.path.isfile(candidate):
                return candidate
    return None


def select_file():
    root = tk.Tk()
    root.withdraw()
    file_path = filedialog.askopenfilename(
        title="Select Key Press Log File",
        filetypes=[("JSON files", "*.json"), ("All files", "*.*")]
    )
    return file_path


def main():
    print('Key Press Analyzer Started...')

    json_path = find_files_in_directory()
    if json_path:
        print(f'Auto-detected JSON file: {json_path}')
        fp = json_path
    else:
        fp = select_file()
        if not fp:
            return

    data = load_keypress_data(fp)

    json_dir = os.path.dirname(os.path.abspath(fp))
    remarks_path = find_xlsx_files(json_dir)

    s_data = None
    id_to_name = {}
    if remarks_path:
        print(f'Found remarks.xlsx in: {json_dir}')
        session_start = data['events'][0]['timestamp'] / 1000
        session_end  = data['events'][-1]['timestamp'] / 1000
        s_data, id_to_name = load_student_data_from_xlsx(remarks_path, session_start, session_end)
        if s_data:
            print(f'  Loaded {len(s_data)} students with follow data')
        else:
            print('  No student data loaded (check column names in remarks.xlsx)')
    else:
        print(f'Student chart disabled (remarks.xlsx not found in {json_dir})')

    create_visualizations(data, s_data, id_to_name)

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
    except Exception:
        pass

    plt.show()


if __name__ == "__main__":
    main()
