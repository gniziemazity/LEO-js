"use strict";

const DELAY_OPS = 15;

function _newTextState() {
	const TS =
		typeof TextState !== "undefined"
			? TextState
			: require("./text-state.js").TextState;
	return new TS();
}

function lineStartAt(text, pos) {
	return text.lastIndexOf("\n", pos - 1) + 1;
}

function lineEndAt(text, pos) {
	const i = text.indexOf("\n", pos);
	return i === -1 ? text.length : i;
}

function leadingIndent(s) {
	return (s.match(/^(\s*)/) || ["", ""])[1];
}

function currentLineIndent(text, pos) {
	return leadingIndent(text.slice(lineStartAt(text, pos), pos));
}

const PAGE_LINES = 20;
const CURSOR_MOVES = {
	"←": [0, -1],
	"→": [0, +1],
	"↑": [-1, 0],
	"↓": [+1, 0],
	"◄": "linestart",
	"►": "lineend",
	"▲": [-PAGE_LINES, 0],
	"▼": [+PAGE_LINES, 0],
};
const SHIFT_CURSOR_MOVES = {
	"⇑": [-1, 0],
	"⇓": [+1, 0],
	"⇐": "linestart",
	"⇒": "lineend",
};
const CURSOR_MOVE_LABELS = {
	"←": "Left",
	"→": "Right",
	"↑": "Up",
	"↓": "Down",
	"◄": "Home",
	"►": "End",
	"▲": "PgUp",
	"▼": "PgDown",
	"⇑": "Up",
	"⇓": "Down",
	"⇐": "Home",
	"⇒": "End",
};

const CHAR_REPLACEMENTS = { "↩": "\n", "\n": "\n", "―": "\t", "\t": "\t" };
const DELETE_LINE_CHAR = "⛔";
const IGNORED_CHARS = new Set([
	"💾",
	"🔁",
	"Ö",
	"ö",
	"Ș",
	"ñ",
	"ω",
	"Ț",
	"é",
	"🅴",
]);
const PAUSE_CHAR = "🕛";
const PAUSE_MS = 500;

const HTML_VOID_TAGS = new Set([
	"area",
	"base",
	"br",
	"col",
	"embed",
	"hr",
	"img",
	"input",
	"link",
	"meta",
	"param",
	"source",
	"track",
	"wbr",
]);

const CLR =
	typeof _cssVar !== "undefined" && typeof THEME !== "undefined"
		? {
				blue: _cssVar("--clr-text"),
				orange: _cssVar("--hl-func"),
				green: _cssVar("--hl-builtin"),
				red: THEME.red,
				accent: THEME.blue,
				move: THEME.orange,
				dim: THEME.muted,
				muted: THEME.muted,
				pale_red: THEME.paleRed,
			}
		: {};

const BACKSPACE_CHARS = new Set(["⌫", "↢"]);
const DELETE_FWRD_CHARS = new Set(["⌦"]);
const _MOVE_TO_FILE_RE = /\.[a-z0-9]+$/i;

function isMoveToFile(target) {
	return typeof target === "string" && _MOVE_TO_FILE_RE.test(target);
}

function _splitCodeWithAnchors(code) {
	const result = [];
	let last = 0;
	const re = /⚓([^⚓]*)⚓/g;
	let m;
	while ((m = re.exec(code)) !== null) {
		if (m.index > last) result.push(["text", code.slice(last, m.index)]);
		result.push(["anchor", `⚓${m[1]}⚓`]);
		last = m.index + m[0].length;
	}
	if (last < code.length) result.push(["text", code.slice(last)]);
	return result;
}

function expandEvents(events) {
	const micro = [];
	const n = events.length;
	let currentEditor = "main";

	for (let i = 0; i < n; i++) {
		const ev = events[i];
		const ts = ev.timestamp || 0;
		const nts = i + 1 < n ? events[i + 1].timestamp || ts : ts;
		const realDelay = Math.max(nts - ts, 1);

		if ("move_to" in ev) {
			const target = ev.move_to;
			if (target === "DEV" || target === "dev") {
				currentEditor = "dev";
				micro.push(["switch_editor", "dev", ts, DELAY_OPS]);
			} else if (target === "MAIN" || target === "main") {
				currentEditor = "main";
				micro.push(["switch_editor", "main", ts, DELAY_OPS]);
			} else if (isMoveToFile(target)) {
				currentEditor = "main";
				micro.push(["switch_file", target, ts, DELAY_OPS]);
			} else {
				micro.push(["move_anchor", target, ts, realDelay]);
			}
			continue;
		}

		if ("switch_editor" in ev) {
			currentEditor = ev.switch_editor;
			micro.push(["switch_editor", currentEditor, ts, DELAY_OPS]);
			continue;
		}

		const editor = currentEditor;

		if ("char" in ev) {
			micro.push(["char", ev.char, ts, realDelay, editor]);
		} else if ("code_insert" in ev) {
			micro.push([
				"code_insert_atomic",
				ev.code_insert,
				ts,
				DELAY_OPS,
				editor,
			]);
		} else if ("anchor" in ev) {
			micro.push(["set_anchor", ev.anchor, ts, DELAY_OPS]);
		} else if ("move" in ev) {
			micro.push(["move_anchor", ev.move, ts, realDelay]);
		} else if ("jump_to" in ev) {
			micro.push(["move_anchor", ev.jump_to, ts, realDelay]);
		}
	}
	return micro;
}

function _moveByLines(text, pos, delta) {
	const before = text.slice(0, pos);
	const lineStart = lineStartAt(text, pos);
	const col = pos - lineStart;
	const lineIdx = (before.match(/\n/g) || []).length;
	const lines = text.split("\n");
	const target = Math.max(0, Math.min(lines.length - 1, lineIdx + delta));
	let offset = 0;
	for (let i = 0; i < target; i++) offset += lines[i].length + 1;
	return offset + Math.min(col, lines[target].length);
}

const CLOSING_TAG_PREFIXES = ["</style", "</script", "</html"];

function dedentOneStep(indent) {
	if (indent.startsWith("\t")) return indent.slice(1);
	if (indent.startsWith("    ")) return indent.slice(4);
	if (indent.startsWith("  ")) return indent.slice(2);
	return indent;
}

function prevLineOpensTag(state, ls) {
	if (ls === 0) return false;
	const prevEnd = ls - 1;
	const prevLs = lineStartAt(state.text, prevEnd);
	const prevLine = state.text.slice(prevLs, prevEnd).trimEnd();
	const m = prevLine.match(/<([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^>]*)?>$/);
	if (!m) return false;
	if (prevLine.endsWith("/>")) return false;
	if (HTML_VOID_TAGS.has(m[1].toLowerCase())) return false;
	return true;
}

function backspaceIsIgnored(state) {
	if (state.cursor === 0) return false;
	const prevChar = state.text[state.cursor - 1];
	if (prevChar === "\n") {
		const ahead = state.text
			.slice(state.cursor, state.cursor + 9)
			.trimStart();
		return CLOSING_TAG_PREFIXES.some((p) => ahead.startsWith(p));
	}
	if (prevChar === " " || prevChar === "\t") {
		const ls = lineStartAt(state.text, state.cursor);
		const leRaw = state.text.indexOf("\n", state.cursor);
		const le = leRaw === -1 ? state.text.length : leRaw;
		if (state.text.slice(ls, le).trim() === "") {
			const nextStart = leRaw === -1 ? state.text.length : leRaw + 1;
			const ahead = state.text.slice(nextStart, nextStart + 9).trimStart();
			if (CLOSING_TAG_PREFIXES.some((p) => ahead.startsWith(p))) return true;
			if (prevLineOpensTag(state, ls)) return true;
		}
	}
	return false;
}

function autoDedent(state, ch, ts = 0) {
	const ls = lineStartAt(state.text, state.cursor);
	const before = state.text.slice(ls, state.cursor);
	const isCloser = "})]".includes(ch);
	const isHtmlEnd = ch === "/" && /^[ \t]*<$/.test(before);
	if (!(isCloser || isHtmlEnd)) return;
	if (isCloser && !/^[ \t]*$/.test(before)) return;
	if (!before) return;

	let newBefore;
	if (before.startsWith("\t")) newBefore = before.slice(1);
	else if (before.startsWith("    ")) newBefore = before.slice(4);
	else if (before.startsWith("  ")) newBefore = before.slice(2);
	else return;

	const n = before.length - newBefore.length;
	const savedCursor = state.cursor;
	state.cursor = ls;
	state.deleteForward(n);
	state.cursor = savedCursor - n;
}

function autoIndent(state, ts = 0, getOpensCloses = null) {
	const cur = state.cursor;
	const prevEnd = lineStartAt(state.text, cur) - 1;
	const prev2 = prevEnd > 0 ? lineStartAt(state.text, prevEnd) - 1 : -1;
	const prevLine = state.text.slice(prev2 + 1, prevEnd);
	const base = leadingIndent(prevLine);
	const after = state.text.slice(cur, lineEndAt(state.text, cur));
	const afterTrimmed = after.trimStart();

	let opens, closes, dedentAfter;
	const supplied =
		typeof getOpensCloses === "function"
			? getOpensCloses(prevLine, afterTrimmed)
			: null;
	if (supplied) {
		opens = !!supplied.opens;
		closes = !!supplied.closes;
		dedentAfter = !!supplied.dedentAfter;
	} else {
		const trimmed = prevLine.trimEnd();
		const opensWithBrace = /[{([]$/.test(trimmed);
		const opensWithTag =
			/<[a-zA-Z][a-zA-Z0-9-]*(\s[^>]*)?>$/.test(trimmed) &&
			!/\/>$/.test(trimmed) &&
			!/<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)(\s[^>]*)?>$/i.test(
				trimmed,
			);
		opens = opensWithBrace || opensWithTag;
		closes = /^[})\]]/.test(afterTrimmed) || /^<\//.test(afterTrimmed);
		dedentAfter = false;
	}

	let indent = base + (opens ? "\t" : "");
	if (dedentAfter && !opens && !closes) indent = dedentOneStep(base);

	if (opens && closes) {
		for (const c of indent) state.insert(c, ts);
		state.insert("\n", ts);
		for (const c of base) state.insert(c, ts);
		state.cursor -= base.length + 1;
	} else if (!opens && closes) {
		const closingIndent = dedentOneStep(base);
		for (const c of closingIndent) state.insert(c, ts);
	} else {
		for (const c of indent) state.insert(c, ts);
	}
}

function indentSelection(state, ts = 0) {
	const sel = state.selectionRange();
	if (!sel) return false;
	const [selStart, selEnd] = sel;

	const lineStarts = [lineStartAt(state.text, selStart)];
	let p = lineStarts[0];
	while (true) {
		const nl = state.text.indexOf("\n", p);
		if (nl === -1 || nl >= selEnd) break;
		lineStarts.push(nl + 1);
		p = nl + 1;
	}
	if (lineStarts.length > 1 && lineStarts[lineStarts.length - 1] === selEnd) {
		lineStarts.pop();
	}

	let cursor = state.cursor;
	for (let i = lineStarts.length - 1; i >= 0; i--) {
		const pos = lineStarts[i];
		state.text = state.text.slice(0, pos) + "\t" + state.text.slice(pos);
		state.charTs.splice(pos, 0, ts);
		for (const name in state.anchors) {
			if (state.anchors[name] > pos) state.anchors[name]++;
		}
		if (cursor > pos) cursor++;
	}
	state.cursor = cursor;
	state.selAnchor = null;
	return true;
}

function applyTypedChar(state, ch, ts = 0, opts = {}) {
	if (IGNORED_CHARS.has(ch) || ch === PAUSE_CHAR) return;
	if (Object.prototype.hasOwnProperty.call(CURSOR_MOVES, ch)) {
		state.selAnchor = null;
		state.moveCursor(CURSOR_MOVES[ch]);
		return;
	}
	if (Object.prototype.hasOwnProperty.call(SHIFT_CURSOR_MOVES, ch)) {
		if (state.selAnchor === null) state.selAnchor = state.cursor;
		state.moveCursor(SHIFT_CURSOR_MOVES[ch]);
		return;
	}
	if (ch === "↩" || ch === "\n") {
		state.insert("\n", ts);
		autoIndent(state, ts, opts.getOpensCloses);
		return;
	}
	if (ch === "―" || ch === "\t") {
		if (!indentSelection(state, ts)) state.insert("\t", ts);
		return;
	}
	if (BACKSPACE_CHARS.has(ch)) {
		if (backspaceIsIgnored(state)) return;
		state.deleteBack(1);
		return;
	}
	if (DELETE_FWRD_CHARS.has(ch)) {
		state.deleteForward(1);
		return;
	}
	if (ch === DELETE_LINE_CHAR) {
		state.deleteLine();
		return;
	}
	autoDedent(state, ch, ts);
	state.insert(ch, ts);
}

function applyTextSegmented(state, text, charHandler, ts = 0, opts = {}) {
	const segments = _splitCodeWithAnchors(text);
	for (const [kind, val] of segments) {
		if (kind === "text") {
			for (const ch of val) charHandler(state, ch, ts, opts);
		} else if (kind === "anchor") {
			state.setAnchor(val.slice(1, -1));
		}
	}
}

function applyTypedText(state, text, ts = 0, opts = {}) {
	applyTextSegmented(state, text, applyTypedChar, ts, opts);
}

function applyAtomicText(state, text, ts = 0, opts = {}) {
	applyTextSegmented(state, text, applyTypedChar, ts, opts);
}

function makeReplayContext(lessonFile = null) {
	const files = new Map([["MAIN", _newTextState()]]);
	return {
		files,
		dev: _newTextState(),
		activeFilename: "MAIN",
		selAnchorMain: null,
		lessonFile,
		get main() {
			return this.files.get(this.activeFilename);
		},
		switchToFile(filename) {
			if (!this.files.has(filename))
				this.files.set(filename, _newTextState());
			this.activeFilename = filename;
		},
		opensCloses() {
			return replayOpensCloses(this.activeFilename, this.lessonFile);
		},
	};
}

function replayActiveProfile(activeFilename, lessonFile) {
	const LP = typeof window !== "undefined" ? window.LanguageProfiles : null;
	if (!LP) return null;
	const fn = (activeFilename || "").toLowerCase();
	const dot = fn.lastIndexOf(".");
	if (dot > 0) {
		const p = LP.getProfile(fn.slice(dot));
		if (p) return p;
	}
	const lessonExt = LP.lessonFileExtension
		? LP.lessonFileExtension(lessonFile)
		: null;
	if (lessonExt) {
		const p = LP.getProfile(lessonExt);
		if (p) return p;
	}
	return LP.getProfile(".html");
}

function replayOpensCloses(activeFilename, lessonFile) {
	return (prevLine, afterTrimmed) => {
		const LP = typeof window !== "undefined" ? window.LanguageProfiles : null;
		if (!LP) return null;
		const profile = replayActiveProfile(activeFilename, lessonFile);
		if (!profile) return null;
		return {
			opens: LP.shouldIncreaseAfter(profile, prevLine),
			closes: LP.shouldDecreaseOnLine(profile, afterTrimmed),
			dedentAfter: LP.shouldDecreaseAfter(profile, prevLine),
		};
	};
}

function _devSemicolonNewline(dev, ts) {
	const indent = currentLineIndent(dev.text, dev.cursor);
	dev.insert("\n", ts);
	for (const c of indent) dev.insert(c, ts);
}

function replayChar(ctx, ch, ts, delay, editor, hooks) {
	const log = (hooks && hooks.log) || (() => {});
	const st = editor === "dev" ? ctx.dev : ctx.main;

	if (ch in CURSOR_MOVES) {
		ctx.main.moveCursor(CURSOR_MOVES[ch]);
		ctx.selAnchorMain = null;
		const lbl = CURSOR_MOVE_LABELS[ch];
		log(ts, `⌨  ${ch}${lbl ? " " + lbl : ""}`, CLR.blue);
		return delay;
	}
	if (ch in SHIFT_CURSOR_MOVES) {
		if (ctx.selAnchorMain === null) ctx.selAnchorMain = ctx.main.cursor;
		ctx.main.moveCursor(SHIFT_CURSOR_MOVES[ch]);
		const lbl = CURSOR_MOVE_LABELS[ch];
		log(ts, `⌨  ${ch}${lbl ? " " + lbl : ""} (select)`, CLR.blue);
		return delay;
	}
	if (ch in CHAR_REPLACEMENTS) {
		const real = CHAR_REPLACEMENTS[ch];
		if (real === "\t" && editor === "main" && ctx.selAnchorMain !== null) {
			ctx.main.selAnchor = ctx.selAnchorMain;
			indentSelection(ctx.main, ts);
			ctx.selAnchorMain = null;
			log(ts, "⌨  ― Tab", CLR.blue);
			return delay;
		}
		st.insert(real, ts);
		if (real === "\n" && editor === "main") {
			autoIndent(ctx.main, ts, ctx.opensCloses());
		}
		log(ts, `⌨  ${real === "\n" ? "↩ Enter" : "― Tab"}`, CLR.blue);
		return delay;
	}
	if (BACKSPACE_CHARS.has(ch)) {
		if (backspaceIsIgnored(st)) {
			log(ts, "⌫  Backspace", CLR.pale_red);
			return delay;
		}
		st.deleteBack(1);
		log(ts, "⌫  Backspace", CLR.red);
		return delay;
	}
	if (DELETE_FWRD_CHARS.has(ch)) {
		st.deleteForward(1);
		log(ts, "⌦  Delete", CLR.blue);
		return delay;
	}
	if (ch === DELETE_LINE_CHAR) {
		st.deleteLine();
		log(ts, "⛔  Delete Line", CLR.red);
		return delay;
	}
	if (ch === PAUSE_CHAR) {
		log(ts, "🕛  Pause 500 ms", CLR.dim);
		return PAUSE_MS;
	}
	if (IGNORED_CHARS.has(ch)) return DELAY_OPS;

	if (ch === ";" && editor === "dev") {
		st.insert(ch, ts);
		_devSemicolonNewline(ctx.dev, ts);
		log(ts, `⌨  ${JSON.stringify(ch)}`, CLR.dim);
		return delay;
	}

	if (editor === "main") autoDedent(ctx.main, ch, ts);
	st.insert(ch, ts);
	log(ts, `⌨  ${JSON.stringify(ch)}`, CLR.dim);
	return delay;
}

function replayCodeInsert(ctx, code, ts, delay, editor, hooks) {
	const log = (hooks && hooks.log) || (() => {});
	log(ts, "⬇  Code Insert", CLR.orange);

	for (const [segKind, segVal] of _splitCodeWithAnchors(code)) {
		if (segKind !== "text") {
			ctx.main.setAnchor(segVal);
			continue;
		}
		for (const ch of segVal) {
			const st = editor === "dev" ? ctx.dev : ctx.main;
			if (IGNORED_CHARS.has(ch) || ch === PAUSE_CHAR) continue;
			if (ch === DELETE_LINE_CHAR) {
				st.deleteLine();
			} else if (Object.prototype.hasOwnProperty.call(CURSOR_MOVES, ch)) {
				st.selAnchor = null;
				st.moveCursor(CURSOR_MOVES[ch]);
			} else if (
				Object.prototype.hasOwnProperty.call(SHIFT_CURSOR_MOVES, ch)
			) {
				if (st.selAnchor === null) st.selAnchor = st.cursor;
				st.moveCursor(SHIFT_CURSOR_MOVES[ch]);
			} else if (ch === "↩" || ch === "\n") {
				st.insert("\n", ts);
				if (editor === "main") autoIndent(ctx.main, ts, ctx.opensCloses());
			} else if (ch === "―" || ch === "\t") {
				if (!indentSelection(st, ts)) st.insert("\t", ts);
			} else if (BACKSPACE_CHARS.has(ch)) {
				if (!backspaceIsIgnored(st)) st.deleteBack(1);
			} else if (DELETE_FWRD_CHARS.has(ch)) {
				st.deleteForward(1);
			} else {
				if (editor === "main") autoDedent(ctx.main, ch, ts);
				st.insert(ch, ts);
			}
		}
	}
	return delay;
}

function replayStep(ctx, act, hooks = {}) {
	const log = hooks.log || (() => {});
	const kind = act[0];

	if (kind === "switch_editor") {
		const [, target, ts, delay] = act;
		log(ts, `→  ${target === "dev" ? "Dev Tools" : "Main Editor"}`, CLR.move);
		if (hooks.onEditor) hooks.onEditor(target);
		if (target === "main") ctx.switchToFile("MAIN");
		return delay;
	}
	if (kind === "char") {
		const [, ch, ts, delay, editor] = act;
		return replayChar(ctx, ch, ts, delay, editor, hooks);
	}
	if (kind === "set_anchor") {
		const [, name, ts, delay] = act;
		ctx.main.setAnchor(name);
		log(ts, `⚓  ${name}`, CLR.accent);
		return delay;
	}
	if (kind === "move_anchor") {
		const [, name, ts, delay] = act;
		if (ctx.main.jumpToAnchor(name)) {
			log(ts, `→  ${name}`, CLR.move);
			if (hooks.flashAnchor) hooks.flashAnchor();
		} else {
			log(ts, `⚠  Unknown anchor: ${name}`, CLR.red);
		}
		return delay;
	}
	if (kind === "switch_file") {
		const [, filename, ts, delay] = act;
		ctx.switchToFile(filename);
		log(ts, `→  ${filename}`, CLR.move);
		return delay;
	}
	if (kind === "code_insert_atomic") {
		const [, code, ts, delay, editor] = act;
		return replayCodeInsert(ctx, code, ts, delay, editor, hooks);
	}
	return DELAY_OPS;
}

if (typeof module !== "undefined" && module.exports) {
	globalThis.lineStartAt = lineStartAt;
	globalThis.lineEndAt = lineEndAt;
	globalThis._moveByLines = _moveByLines;
	module.exports = {
		TextState: require("./text-state.js").TextState,
		PAGE_LINES,
		CURSOR_MOVES,
		SHIFT_CURSOR_MOVES,
		CURSOR_MOVE_LABELS,
		CHAR_REPLACEMENTS,
		DELETE_LINE_CHAR,
		BACKSPACE_CHARS,
		DELETE_FWRD_CHARS,
		IGNORED_CHARS,
		PAUSE_CHAR,
		isMoveToFile,
		indentSelection,
		PAUSE_MS,
		HTML_VOID_TAGS,
		CLOSING_TAG_PREFIXES,
		lineStartAt,
		lineEndAt,
		leadingIndent,
		currentLineIndent,
		dedentOneStep,
		prevLineOpensTag,
		backspaceIsIgnored,
		autoDedent,
		autoIndent,
		applyTypedChar,
		applyTypedText,
		makeReplayContext,
		replayStep,
		replayChar,
		replayCodeInsert,
		applyAtomicText,
		_splitCodeWithAnchors,
		expandEvents,
	};
}
