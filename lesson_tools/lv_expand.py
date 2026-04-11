import io
import json
import os
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

sys.path.insert(0, os.path.dirname(__file__))

from utils.lv_expand import expand_events

if len(sys.argv) < 2:
    print("Usage: lv_expand.py <log.json>", file=sys.stderr)
    sys.exit(1)

path = sys.argv[1]
try:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
except Exception as e:
    print(f"Error reading {path}: {e}", file=sys.stderr)
    sys.exit(1)

events = data.get("events", [])
micro = expand_events(events)

print(json.dumps(micro, ensure_ascii=False))
