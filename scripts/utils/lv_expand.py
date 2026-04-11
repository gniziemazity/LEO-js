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
            segments = split_code_with_anchors(ev["code_insert"])
            micro.append(("log_code_insert", ev["code_insert"][:60], ts, DELAY_OPS))
            micro.append(("code_insert_begin", ts, DELAY_OPS))
            total_chars = sum(
                sum(1 for ch in v if ch not in _CI_SPECIAL)
                for k, v in segments if k == "text"
            )
            char_i = 0
            for seg_kind, seg_val in segments:
                if seg_kind == "text":
                    for ch in seg_val:
                        if ch == DELETE_LINE_CHAR:
                            micro.append(("code_delete_line", ts, DELAY_OPS, editor))
                        elif ch in CURSOR_MOVES:
                            micro.append(("code_cursor_move", ch, ts, DELAY_OPS, editor))
                        elif ch in ("↩", "\n"):
                            micro.append(("code_insert_newline", ts, DELAY_OPS, editor))
                        elif ch in ("―", "\t"):
                            micro.append(("code_char", "\t", ts, DELAY_CODE, editor))
                        elif ch in BACKSPACE_CHARS:
                            micro.append(("code_backspace", ts, DELAY_OPS, editor))
                        elif ch in DELETE_FWRD_CHARS:
                            micro.append(("code_fwd_delete", ts, DELAY_OPS, editor))
                        else:
                            char_i += 1
                            d = real_delay if char_i == total_chars else DELAY_CODE
                            micro.append(("code_char", ch, ts, d, editor))
                else:
                    micro.append(("set_anchor", seg_val, ts, DELAY_OPS))
            micro.append(("code_insert_end", ts, DELAY_OPS))

        elif "code_remove" in ev:
            micro.append(("code_remove", ev["code_remove"], ts, real_delay))

        elif "anchor" in ev:
            micro.append(("set_anchor", ev["anchor"], ts, DELAY_OPS))

        elif "move" in ev:
            micro.append(("move_anchor", ev["move"], ts, real_delay))

        elif "jump_to" in ev:
            micro.append(("move_anchor", ev["jump_to"], ts, real_delay))

    return micro
