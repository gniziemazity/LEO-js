import json
import re
from pathlib import Path
from typing import List, Optional, Tuple

_DIR = Path(__file__).parent
_PROFILE_IDS = ("javascript", "css", "html", "plaintext", "python")
_profiles: dict = {}
_ext_to_id: dict = {}
_compiled_re: dict = {}
_compiled_open_tag_re: dict = {}


def _load() -> None:
    if len(_profiles) == len(_PROFILE_IDS):
        return
    for pid in _PROFILE_IDS:
        with open(_DIR / f"{pid}.json", encoding="utf-8") as f:
            data = json.load(f)
        _profiles[pid] = data
        for ext in data.get("extensions", []):
            _ext_to_id[ext.lower()] = pid


def get_profile(ext_or_id: str) -> Optional[dict]:
    _load()
    key = (ext_or_id or "").lower()
    if key in _profiles:
        return _profiles[key]
    if key.startswith("."):
        pid = _ext_to_id.get(key)
        if pid:
            return _profiles[pid]
    return None


def all_extensions() -> list:
    _load()
    return sorted(_ext_to_id.keys())


def extension_to_id(ext: str) -> Optional[str]:
    _load()
    return _ext_to_id.get((ext or "").lower())


def detect_language_from_lesson_file(path: Optional[str]) -> Optional[str]:
    if not path:
        return None
    _load()
    name = path.replace("\\", "/").rsplit("/", 1)[-1].lower()
    base = name.rsplit(".", 1)[0]
    if base in _profiles:
        return base
    return None


def lesson_file_extension(lesson_file: Optional[str]) -> Optional[str]:
    pid = detect_language_from_lesson_file(lesson_file)
    if pid is None:
        return None
    exts = (_profiles.get(pid) or {}).get("extensions") or []
    return exts[0] if exts else None


def _detect_re(profile: dict):
    pid = profile["id"]
    if pid not in _compiled_re:
        pat = (profile.get("comments") or {}).get("detectRe")
        _compiled_re[pid] = re.compile(pat) if pat else None
    return _compiled_re[pid]


def _embedded_open_re(profile: dict):
    pid = profile["id"]
    if pid not in _compiled_open_tag_re:
        tags = [e["tag"] for e in (profile.get("embeddedTags") or [])]
        if tags:
            _compiled_open_tag_re[pid] = re.compile(
                rf'<\s*({"|".join(tags)})\b[^>]*>', re.IGNORECASE
            )
        else:
            _compiled_open_tag_re[pid] = None
    return _compiled_open_tag_re[pid]


def _embedded_tag_ranges(text: str, profile: dict) -> dict:
    open_re = _embedded_open_re(profile)
    by_tag: dict = {e["tag"]: [] for e in (profile.get("embeddedTags") or [])}
    if open_re is None:
        return by_tag
    pos = 0
    while True:
        om = open_re.search(text, pos)
        if not om:
            break
        tag = om.group(1).lower()
        inner_start = om.end()
        close_re = re.compile(
            rf'</\s*{tag}\s*>|<\s*\\\s*/?\s*{tag}\s*>|/\s*{tag}\s*>',
            re.IGNORECASE,
        )
        cm = close_re.search(text, inner_start)
        inner_end = cm.start() if cm else len(text)
        by_tag.setdefault(tag, []).append((inner_start, inner_end))
        pos = cm.end() if cm else len(text)
    return by_tag


def _in_ranges(pos: int, ranges) -> bool:
    for lo, hi in ranges:
        if lo <= pos < hi:
            return True
        if pos < lo:
            return False
    return False


_compiled_indent_re: dict = {}
_compiled_void_re: dict = {}


def _indent_re(profile: dict, key: str):
    cache_key = (profile["id"], key)
    if cache_key not in _compiled_indent_re:
        pat = ((profile.get("indent") or {}).get(key) or "")
        _compiled_indent_re[cache_key] = re.compile(pat) if pat else None
    return _compiled_indent_re[cache_key]


def _void_tags_re(profile: dict):
    pid = profile["id"]
    if pid not in _compiled_void_re:
        tags = profile.get("voidTags") or []
        if tags:
            _compiled_void_re[pid] = re.compile(
                rf'<({"|".join(tags)})(?:\s[^>]*)?>$', re.IGNORECASE
            )
        else:
            _compiled_void_re[pid] = None
    return _compiled_void_re[pid]


def _open_tag_re(profile: dict):
    pat = profile.get("openTagRe")
    return re.compile(pat) if pat else None


def should_increase_after(profile: Optional[dict], line: str) -> bool:
    if profile is None:
        return False
    pat = _indent_re(profile, "increaseAfter")
    if pat and pat.search(line):
        return True
    open_tag = _open_tag_re(profile)
    if open_tag:
        stripped = line.rstrip()
        void_re = _void_tags_re(profile)
        if (
            open_tag.search(stripped)
            and not stripped.endswith("/>")
            and (void_re is None or not void_re.search(stripped))
        ):
            return True
    return False


def should_decrease_on_line(profile: Optional[dict], line: str) -> bool:
    if profile is None:
        return False
    pat = _indent_re(profile, "decreaseOnLine")
    return bool(pat and pat.search(line))


def should_decrease_after(profile: Optional[dict], line: str) -> bool:
    if profile is None:
        return False
    pat = _indent_re(profile, "decreaseAfter")
    return bool(pat and pat.search(line))


_WS_ONLY_RE = re.compile(r"^[ \t]*$")
_WS_LT_RE = re.compile(r"^[ \t]*<$")


def should_auto_dedent_on_char(
    profile: Optional[dict], ch: str, before: str
) -> bool:
    if ch in "})]":
        return bool(_WS_ONLY_RE.match(before))
    if profile is not None and profile.get("openTagRe") and ch == "/":
        return bool(_WS_LT_RE.match(before))
    return False


def comment_ranges(profile: Optional[dict], text: str) -> Tuple[List[int], List[int]]:
    if profile is None:
        return [], []
    pat = _detect_re(profile)
    if pat is None:
        return [], []

    starts: List[int] = []
    ends: List[int] = []
    embedded = profile.get("embeddedTags") or []
    if not embedded:
        for m in pat.finditer(text):
            starts.append(m.start())
            ends.append(m.end())
        return starts, ends

    by_tag = _embedded_tag_ranges(text, profile)
    script_ranges = by_tag.get("script", [])
    style_ranges = by_tag.get("style", [])
    for m in pat.finditer(text):
        kind = m.group()[:2]
        pos = m.start()
        if kind == "//" and not _in_ranges(pos, script_ranges):
            continue
        if kind == "/*" and not (
            _in_ranges(pos, style_ranges) or _in_ranges(pos, script_ranges)
        ):
            continue
        starts.append(pos)
        ends.append(m.end())
    return starts, ends
