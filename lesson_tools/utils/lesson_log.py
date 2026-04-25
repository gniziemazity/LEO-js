import json
from dataclasses import dataclass
from pathlib import Path


@dataclass
class LessonLogData:
    all_events: list
    keypresses: list
    code_inserts: list
    interactions: list
    session_start: int


def load_lesson_log(project_dir: Path) -> tuple[LessonLogData | None, str | None]:
    json_files = list(project_dir.glob('*.json'))
    if len(json_files) != 1:
        if json_files:
            return None, (
                f'  Note: found {len(json_files)} JSON files in {project_dir.name}, '
                'skipping lesson timestamps (expected exactly 1).'
            )
        return None, None

    try:
        with open(json_files[0], 'r', encoding='utf-8') as f:
            data = json.load(f)
        if 'events' not in data or 'sessionStart' not in data:
            return None, None

        events = data['events']
        keypresses = [e for e in events if 'char' in e]
        code_inserts = [e for e in events if 'code_insert' in e]
        interactions = [e for e in events if 'interaction' in e]

        active_editor = 'main'
        for e in events:
            if 'switch_editor' in e:
                active_editor = e['switch_editor']
            elif 'char' in e or 'code_insert' in e or 'anchor' in e:
                e['editor'] = active_editor

        out = LessonLogData(
            all_events=events,
            keypresses=keypresses,
            code_inserts=code_inserts,
            interactions=interactions,
            session_start=data['sessionStart'],
        )
        msg = (
            f'  Loaded lesson log: {json_files[0].name} '
            f'({len(keypresses)} keypresses, {len(code_inserts)} code inserts)'
        )
        return out, msg
    except Exception as e:
        return None, f'  Warning: could not load lesson JSON: {e}'
