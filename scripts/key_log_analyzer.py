import json
import os
import tkinter as tk
from tkinter import filedialog

import matplotlib.pyplot as plt

from utils.kla_config import Config
from utils.kla_data import load_keypress_data, load_student_data_from_xlsx
from utils.kla_vis import create_visualizations


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
        except:
            pass
    return json_files[0] if len(json_files) == 1 else None


def find_xlsx_files(directory):
    folder_name = os.path.basename(directory)
    remarks    = os.path.join(directory, f'remarks_{folder_name}.xlsx')
    similarity = os.path.join(directory, f'teacher_similarity_{folder_name}.xlsx')
    if not os.path.isfile(remarks):
        remarks    = os.path.join(directory, 'remarks.xlsx')
    if not os.path.isfile(similarity):
        similarity = os.path.join(directory, 'teacher_similarity.xlsx')
    return (
        remarks    if os.path.isfile(remarks)    else None,
        similarity if os.path.isfile(similarity) else None,
    )


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
    remarks_path, similarity_path = find_xlsx_files(json_dir)

    s_data = None
    if remarks_path and similarity_path:
        print(f'Found remarks.xlsx and teacher_similarity.xlsx in: {json_dir}')
        session_start = data['events'][0]['timestamp'] / 1000
        session_end  = data['events'][-1]['timestamp'] / 1000
        s_data = load_student_data_from_xlsx(remarks_path, similarity_path, session_start, session_end)
        if s_data:
            print(f'  Loaded {len(s_data)} students with follow data')
        else:
            print('  No student data loaded (check column names in xlsx files)')
    else:
        missing = []
        if not remarks_path:    missing.append('remarks.xlsx')
        if not similarity_path: missing.append('teacher_similarity.xlsx')
        print(f'Student chart disabled (not found in {json_dir}): {" ".join(missing)}')

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
