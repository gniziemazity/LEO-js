import os
import sys
import zipfile
import shutil

def unzip_file(zip_path, extract_to):
    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        zip_ref.extractall(extract_to)

def rename_folder(folder_path):
    folder_name = os.path.basename(folder_path)
    new_name = folder_name.split('_')[0]
    new_folder_path = os.path.join(os.path.dirname(folder_path), new_name)

    try:
        if folder_path != new_folder_path:
            os.rename(folder_path, new_folder_path)
    except Exception as e:
        print(f"Error renaming folder {folder_path} to {new_folder_path}: {e}")
        return folder_path
    return new_folder_path

def move_folder_contents(src_folder, dest_folder):
    for item in os.listdir(src_folder):
        src_path = os.path.join(src_folder, item)
        dest_path = os.path.join(dest_folder, item)
        if os.path.exists(dest_path):
            base, ext = os.path.splitext(item)
            dest_path = os.path.join(dest_folder, f"{base}_copy{ext}")
        shutil.move(src_path, dest_path)

def flatten_folder(root_folder):
    while True:
        contents = os.listdir(root_folder)
        if len(contents) == 1 and os.path.isdir(os.path.join(root_folder, contents[0])):
            single_subfolder = os.path.join(root_folder, contents[0])
            move_folder_contents(single_subfolder, root_folder)
            os.rmdir(single_subfolder)
        else:
            break

def process_folder(root_folder):
    while True:
        contents = os.listdir(root_folder)
        
        if len(contents) == 1 and contents[0].endswith('.zip'):
            zip_path = os.path.join(root_folder, contents[0])
            unzip_file(zip_path, root_folder)
            os.remove(zip_path)
        else:
            flatten_folder(root_folder)
            break

def main(zip_path, extract_to):
    unzip_file(zip_path, extract_to)
    
    for folder_name in os.listdir(extract_to):
        folder_path = os.path.join(extract_to, folder_name)
        
        if os.path.isdir(folder_path):
            new_folder_path = rename_folder(folder_path)
            
            process_folder(new_folder_path)

def run():
    if len(sys.argv) < 2:
        print("Usage: extract.py <project_dir>")
        sys.exit(1)
    root_directory = sys.argv[1]
    zip_file_path = None

    for file_name in os.listdir(root_directory):
        if file_name.endswith('.zip'):
            zip_file_path = os.path.join(root_directory, file_name)
            break

    if zip_file_path:
        output_folder = os.path.join(root_directory, "students")

        try:
            os.makedirs(output_folder, exist_ok=True)
        except Exception as e:
            print(f"Error creating output directory: {e}")
            exit(1)

        main(zip_file_path, output_folder)
    else:
        print("No zip file found in the root directory.")

if __name__ == "__main__":
    run()

