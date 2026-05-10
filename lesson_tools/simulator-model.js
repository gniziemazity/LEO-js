"use strict";

const ANCHOR_RE = /⚓([^⚓]*)⚓/g;
const DELAY_OPS = 15;

const CURSOR_MOVES = {
	"←": [0, -1],
	"→": [0, +1],
	"↑": [-1, 0],
	"↓": [+1, 0],
	"◄": "linestart",
	"►": "lineend",
	"▲": [-20, 0],
	"▼": [+20, 0],
};
const SHIFT_CURSOR_MOVES = {
	"⇑": [-1, 0],
	"⇓": [+1, 0],
	"⇐": "linestart",
	"⇒": "lineend",
};

const CHAR_REPLACEMENTS = { "↩": "\n", "\n": "\n", "―": "\t", "\t": "\t" };
const DELETE_LINE_CHAR = "⛔";
const DELETE_FWRD_CHAR = "⌦";
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

const CLR = {
	blue: _cssVar("--clr-accent"),
	orange: _cssVar("--hl-func"),
	move: _cssVar("--clr-orange"),
	green: _cssVar("--hl-builtin"),
	red: _cssVar("--clr-red"),
	accent: _cssVar("--clr-accent"),
	dim: _cssVar("--clr-muted"),
	muted: _cssVar("--clr-muted"),
	pale_red: _cssVar("--clr-pale-red"),
};

const _EXPAND_BACKSPACE = new Set(["↢", "⌫"]);
const _EXPAND_FWD_DEL = new Set(["↣", "⌦"]);
const _EXPAND_FILE_EXTS = [".js", ".css", ".html", ".htm"];
const _EXPAND_MAX_DELAY = 3000;
const _CI_SPECIAL = new Set([
	...Object.keys(CURSOR_MOVES),
	DELETE_LINE_CHAR,
	"↩",
	"\n",
	"―",
	"\t",
	"↢",
	"⌫",
	"↣",
	"⌦",
]);

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
		const realDelay = Math.min(Math.max(nts - ts, 1), _EXPAND_MAX_DELAY);

		if ("move_to" in ev) {
			const target = ev.move_to;
			if (target === "DEV" || target === "dev") {
				currentEditor = "dev";
				micro.push(["switch_editor", "dev", ts, DELAY_OPS]);
			} else if (target === "MAIN" || target === "main") {
				currentEditor = "main";
				micro.push(["switch_editor", "main", ts, DELAY_OPS]);
			} else if (
				_EXPAND_FILE_EXTS.some((ext) => target.toLowerCase().endsWith(ext))
			) {
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

class TextState {
	constructor() {
		this.reset();
	}

	reset() {
		this.text = "";
		this.cursor = 0;
		this.anchors = {};
		this.charTs = [];
		this.selAnchor = null;
		this._followingAnchor = null;
		this._anchorHadBackspace = false;
	}

	insert(ch, ts) {
		const pos = this.cursor;
		this.text = this.text.slice(0, pos) + ch + this.text.slice(pos);
		this.charTs.splice(pos, 0, ts);
		for (const name in this.anchors) {
			const p = this.anchors[name];
			if (
				p > pos ||
				(p === pos &&
					name === this._followingAnchor &&
					this._anchorHadBackspace)
			) {
				this.anchors[name]++;
			}
		}
		this.cursor++;
	}

	deleteBack(n = 1) {
		if (this.cursor < n) return;
		const start = this.cursor - n;
		if (
			this._followingAnchor !== null &&
			this.anchors[this._followingAnchor] === this.cursor
		) {
			this._anchorHadBackspace = true;
		}
		this.text = this.text.slice(0, start) + this.text.slice(this.cursor);
		this.charTs.splice(start, n);
		for (const name in this.anchors) {
			const p = this.anchors[name];
			if (p >= this.cursor) this.anchors[name] = p - n;
			else if (p > start) this.anchors[name] = start;
		}
		this.cursor = start;
	}

	deleteForward(n = 1) {
		if (this.cursor + n > this.text.length) return;
		const end = this.cursor + n;
		this.text = this.text.slice(0, this.cursor) + this.text.slice(end);
		this.charTs.splice(this.cursor, n);
		for (const name in this.anchors) {
			const p = this.anchors[name];
			if (p >= end) this.anchors[name] = p - n;
			else if (p > this.cursor) this.anchors[name] = this.cursor;
		}
	}

	deleteLine() {
		const ls = this.text.lastIndexOf("\n", this.cursor - 1) + 1;
		const raw = this.text.indexOf("\n", this.cursor);
		const le = raw === -1 ? this.text.length : raw;
		const end = raw === -1 ? le : le + 1;
		const len = end - ls;
		this.text = this.text.slice(0, ls) + this.text.slice(end);
		this.charTs.splice(ls, len);
		for (const name in this.anchors) {
			const p = this.anchors[name];
			if (p >= end) this.anchors[name] = p - len;
			else if (p >= ls) this.anchors[name] = ls;
		}
		this.cursor = ls;
	}

	moveCursor(dir) {
		this._followingAnchor = null;
		this._anchorHadBackspace = false;
		if (dir === "linestart") {
			const ls = this.text.lastIndexOf("\n", this.cursor - 1) + 1;
			const leRaw = this.text.indexOf("\n", ls);
			const le = leRaw === -1 ? this.text.length : leRaw;
			const indent =
				this.text.slice(ls, le).length -
				this.text.slice(ls, le).trimStart().length;
			this.cursor = ls + indent;
		} else if (dir === "lineend") {
			const e = this.text.indexOf("\n", this.cursor);
			this.cursor = e === -1 ? this.text.length : e;
		} else {
			const [dl, dc] = dir;
			if (dl === 0) {
				this.cursor = Math.max(
					0,
					Math.min(this.text.length, this.cursor + dc),
				);
			} else {
				this.cursor = _moveByLines(this.text, this.cursor, dl);
			}
		}
		this.cursor = Math.max(0, Math.min(this.text.length, this.cursor));
	}

	setAnchor(name) {
		this.anchors[name] = this.cursor;
	}

	jumpToAnchor(name) {
		if (name in this.anchors) {
			this.cursor = this.anchors[name];
			this._followingAnchor = name;
			this._anchorHadBackspace = false;
			return true;
		}
		return false;
	}

	tsAtCursor() {
		const i = Math.min(this.cursor, this.charTs.length - 1);
		return i >= 0 ? this.charTs[i] : null;
	}
}

function _moveByLines(text, pos, delta) {
	const before = text.slice(0, pos);
	const lineStart = before.lastIndexOf("\n") + 1;
	const col = pos - lineStart;
	const lineIdx = (before.match(/\n/g) || []).length;
	const lines = text.split("\n");
	const target = Math.max(0, Math.min(lines.length - 1, lineIdx + delta));
	let offset = 0;
	for (let i = 0; i < target; i++) offset += lines[i].length + 1;
	return offset + Math.min(col, lines[target].length);
}

const VSCODE_DEFAULTS = {
	"editor.autoClosingBrackets": "never",
	"editor.autoClosingQuotes": "never",
	"html.autoClosingTags": false,
	"html.autoCreateQuotes": false,
};
const BRACKET_PAIRS = { "(": ")", "[": "]", "{": "}" };
const QUOTE_PAIRS = { '"': '"', "'": "'", "`": "`" };

class VSCodeSettings {
	constructor(raw = {}, source = "defaults") {
		this.raw = { ...VSCODE_DEFAULTS, ...raw };
		this.source = source;
	}

	static load() {
		return new VSCodeSettings({}, "defaults");
	}

	_closingMode(key) {
		const v = this.raw[key];
		if (typeof v === "boolean") return v ? "always" : "never";
		return String(v).toLowerCase();
	}

	_shouldClose(mode, textAfter) {
		if (mode === "never") return false;
		if (mode === "always") return true;
		if (mode === "languagedefined" || mode === "beforewhitespace")
			return !textAfter || " \t\n\r)]}>\"'".includes(textAfter[0]);
		return false;
	}

	autoCloseBracket(ch, textAfter) {
		const closing = BRACKET_PAIRS[ch];
		if (!closing) return null;
		const mode = this._closingMode("editor.autoClosingBrackets");
		if (textAfter && textAfter[0] === closing) return null;
		return this._shouldClose(mode, textAfter) ? closing : null;
	}

	autoCloseQuote(ch, textBefore, textAfter) {
		if (!(ch in QUOTE_PAIRS)) return null;
		const closing = QUOTE_PAIRS[ch];
		const mode = this._closingMode("editor.autoClosingQuotes");
		if (textAfter && textAfter[0] === closing) return null;
		if ((textBefore.split(ch).length - 1) % 2 === 1) return null;
		return this._shouldClose(mode, textAfter) ? closing : null;
	}

	autoCloseHtmlTag(ch, textBefore) {
		if (ch !== ">") return null;
		if (!this.raw["html.autoClosingTags"]) return null;
		const m = textBefore.match(/<([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^<>]*)?$/);
		if (!m) return null;
		if (HTML_VOID_TAGS.has(m[1].toLowerCase())) return null;
		if (textBefore.lastIndexOf("</") > textBefore.lastIndexOf("<" + m[1]))
			return null;
		return `</${m[1]}>`;
	}

	autoCreateQuotes(ch, textBefore) {
		if (ch !== "=") return null;
		if (!this.raw["html.autoCreateQuotes"]) return null;
		const lt = textBefore.lastIndexOf("<"),
			gt = textBefore.lastIndexOf(">");
		if (lt <= gt) return null;
		const tag = textBefore.slice(lt);
		if (tag.startsWith("<!") || tag.startsWith("</")) return null;
		return '""';
	}
}
