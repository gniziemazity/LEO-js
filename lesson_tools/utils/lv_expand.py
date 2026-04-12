from .lv_constants import (
    CURSOR_MOVES, DELETE_LINE_CHAR, BACKSPACE_CHARS, DELETE_FWRD_CHARS,
    MAX_REAL_DELAY, DELAY_CODE, DELAY_OPS,
    split_code_with_anchors,
)

_FILE_EXTS = frozenset((".js", ".css", ".html", ".htm"))

_CI_SPECIAL = frozenset(
    list(CURSOR_MOVES.keys()) + [
        DELETE_LINE_CHAR, "↩", "\n", "―", "\t",
    ] + list(BACKSPACE_CHARS) + list(DELETE_FWRD_CHARS)
)


def expand_events(events: list) -> list:
    micro = []
    n = len(events)
    current_editor = "main"

    for i, ev in enumerate(events):
        ts  = ev.get("timestamp", 0)
        nts = events[i + 1]["timestamp"] if i + 1 < n else ts
        real_delay = min(max(nts - ts, 1), MAX_REAL_DELAY)

        if "move_to" in ev:
            target = ev["move_to"]
            if target in ("DEV", "dev"):
                current_editor = "dev"
                micro.append(("switch_editor", "dev", ts, DELAY_OPS))
            elif target in ("MAIN", "main"):
                current_editor = "main"
                micro.append(("switch_editor", "main", ts, DELAY_OPS))
            elif any(target.lower().endswith(ext) for ext in _FILE_EXTS):
                current_editor = "main"
                micro.append(("switch_file", target, ts, DELAY_OPS))
            else:
                micro.append(("move_anchor", target, ts, real_delay))
            continue

        if "switch_editor" in ev:
            current_editor = ev["switch_editor"]
            micro.append(("switch_editor", current_editor, ts, DELAY_OPS))
            continue

        editor = current_editor

        if "char" in ev:
            micro.append(("char", ev["char"], ts, real_delay, editor))

        elif "code_insert" in ev:
            micro.append(("code_insert_atomic", ev["code_insert"], ts, DELAY_OPS, editor))

        elif "anchor" in ev:
            micro.append(("set_anchor", ev["anchor"], ts, DELAY_OPS))

        elif "move" in ev:
            micro.append(("move_anchor", ev["move"], ts, real_delay))

        elif "jump_to" in ev:
            micro.append(("move_anchor", ev["jump_to"], ts, real_delay))

    return micro
