import argparse
import os
import subprocess
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
LESSONS_DIR = ROOT_DIR / "lessons"

if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from utils.folder_utils import select_project_folder


_parser = argparse.ArgumentParser(description='Student analytics grading pipeline')
_parser.add_argument('project', nargs='?', help='Project folder path or name under lessons/')
_parser.add_argument('--extra-star', action='store_true',
                     help='Mark teacher-removed tokens found in student code as EXTRA* '
                          'instead of plain EXTRA')
_args = _parser.parse_args()

ALL_EXTRA_STAR = _args.extra_star

STEPS = [
    ("1. Extract submissions",    "extract"),
    ("2. Anonymize submissions",  "anonymize"),
    ("3. Similarity check",       "sim_check"),
    ("4. Peer similarity check",  "peer_sim_check"),
]



def run_step(label: str, module: str, project_dir: Path) -> bool:
    separator = "=" * 60
    print(f"\n{separator}")
    print(f"  {label}")
    print(f"  Running: utils.{module}")
    print(separator)

    env = os.environ.copy()
    env['STUDENT_ANALYTICS_EXTRA_STAR'] = '1' if ALL_EXTRA_STAR else '0'
    result = subprocess.run(
        [sys.executable, "-m", f"utils.{module}", str(project_dir)],
        cwd=str(ROOT_DIR),
        env=env,
    )

    if result.returncode != 0:
        print(f"\n** {label} failed (exit code {result.returncode}) **")
        return False
    return True

def main():
    if _args.project:
        project_dir = Path(_args.project)
        if not project_dir.is_dir():
            project_dir = LESSONS_DIR / _args.project
        if not project_dir.is_dir():
            print(f"Folder not found: {_args.project}")
            sys.exit(1)
        project_dir = project_dir.resolve()
    else:
        project_dir = select_project_folder(
            "Select project folder (must contain students/ and correct/)"
        )

    print(f"\nGrading pipeline")
    print(f"  Project : {project_dir.name}")
    print(f"  Path    : {project_dir}")
    print(f"  Python  : {sys.executable}")

    students_dir = project_dir / "students"

    for label, module in STEPS:
        if module == "extract" and students_dir.is_dir():
            print(f"\n{'=' * 60}")
            print(f"  Skipping extraction — students/ already exists")
            print(f"{'=' * 60}")
            continue

        success = run_step(label, module, project_dir)
        if not success:
            proceed = input("Continue with the next step? (y/n): ").strip().lower()
            if proceed != "y":
                print("Pipeline aborted.")
                sys.exit(1)

    print("\n" + "=" * 60)
    print("  All steps completed!")
    print("=" * 60)

if __name__ == "__main__":
    main()