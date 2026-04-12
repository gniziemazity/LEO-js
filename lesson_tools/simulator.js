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
	bg: "#ffffff",
	sidebar: "#f3f3f3",
	toolbar: "#e8e8e8",
	fg: "#1e1e1e",
	cursor: "#000000",
	select: "#add6ff",
	blue: "#0000ff",
	purple: "#af00db",
	orange: "#795e26",
	yellow: "#795e26",
	move: "#e07020",
	green: "#267f99",
	red: "#d40000",
	pink: "#d40000",
	comment: "#008000",
	accent: "#007acc",
	dim: "#717171",
	muted: "#999999",
	devbg: "#f5f5f5",
	devborder: "#007acc",
	settingsbg: "#f0f0f8",
};

const _EXPAND_BACKSPACE = new Set(["↢", "⌫"]);
const _EXPAND_FWD_DEL = new Set(["↣", "⌦"]);
const _EXPAND_FILE_EXTS = [".js", ".css", ".html", ".htm"];
const _EXPAND_DELAY_CODE = 30;
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

const HL_COLORS = {
	hl_comment: "#008000",
	hl_doctype: "#0000ff",
	hl_tag: "#800000",
	hl_attr: "#ff0000",
	hl_value: "#0000ff",
	hl_keyword: "#0000ff",
	hl_builtin: "#267f99",
	hl_number: "#098658",
	hl_string: "#a31515",
	hl_func: "#795e26",
	hl_css_sel: "#800000",
	hl_css_prop: "#ff0000",
	hl_css_num: "#098658",
	hl_css_at: "#af00db",
};

const HL_PRIORITY = [
	"hl_comment",
	"hl_value",
	"hl_string",
	"hl_css_at",
	"hl_css_num",
	"hl_number",
	"hl_keyword",
	"hl_doctype",
	"hl_tag",
	"hl_css_sel",
	"hl_builtin",
	"hl_func",
	"hl_css_prop",
	"hl_attr",
];

const JS_KW = new Set([
	"var",
	"let",
	"const",
	"function",
	"return",
	"if",
	"else",
	"for",
	"while",
	"do",
	"switch",
	"case",
	"break",
	"continue",
	"new",
	"this",
	"typeof",
	"instanceof",
	"null",
	"undefined",
	"true",
	"false",
	"class",
	"extends",
	"import",
	"export",
	"default",
	"try",
	"catch",
	"finally",
	"throw",
	"async",
	"await",
	"of",
	"in",
	"from",
	"static",
	"super",
	"yield",
	"delete",
	"void",
	"debugger",
]);
const JS_BUILTINS = new Set([
	"console",
	"document",
	"window",
	"Array",
	"Object",
	"String",
	"Number",
	"Boolean",
	"Math",
	"JSON",
	"Promise",
	"setTimeout",
	"setInterval",
	"clearTimeout",
	"clearInterval",
	"parseInt",
	"parseFloat",
	"isNaN",
	"isFinite",
	"alert",
	"confirm",
	"prompt",
	"addEventListener",
	"fetch",
	"querySelector",
	"querySelectorAll",
	"getElementById",
	"getElementsByClassName",
	"getElementsByTagName",
]);

function buildHighlightSpans(content) {
	const spans = {};
	for (const k of Object.keys(HL_COLORS)) spans[k] = [];

	const styleRegions = [];
	const scriptRegions = [];
	for (const m of content.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi))
		styleRegions.push([
			m.index + m[0].indexOf(m[1]),
			m.index + m[0].indexOf(m[1]) + m[1].length,
		]);
	for (const m of content.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))
		scriptRegions.push([
			m.index + m[0].indexOf(m[1]),
			m.index + m[0].indexOf(m[1]) + m[1].length,
		]);

	const mask = new Uint8Array(content.length);
	for (const [s, e] of styleRegions) mask.fill(1, s, e);
	for (const [s, e] of scriptRegions) mask.fill(2, s, e);

	for (const m of content.matchAll(/<!--[\s\S]*?-->/g))
		if (mask[m.index] === 0)
			spans.hl_comment.push({ start: m.index, end: m.index + m[0].length });
	for (const m of content.matchAll(/<!DOCTYPE\b[^>]*>/gi))
		if (mask[m.index] === 0)
			spans.hl_doctype.push({ start: m.index, end: m.index + m[0].length });
	for (const m of content.matchAll(/="([^"]*)"/g))
		if (mask[m.index] === 0)
			spans.hl_value.push({
				start: m.index + 2,
				end: m.index + 2 + m[1].length,
			});
	for (const m of content.matchAll(/='([^']*)'/g))
		if (mask[m.index] === 0)
			spans.hl_value.push({
				start: m.index + 2,
				end: m.index + 2 + m[1].length,
			});
	for (const m of content.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)/g))
		if (mask[m.index] === 0)
			spans.hl_tag.push({
				start: m.index + (m[0].length - m[1].length),
				end: m.index + m[0].length,
			});
	for (const m of content.matchAll(/\b([a-zA-Z][a-zA-Z0-9-:]*)(?=\s*=)/g))
		if (mask[m.index] === 0)
			spans.hl_attr.push({ start: m.index, end: m.index + m[1].length });

	for (const [off, end] of styleRegions) {
		const css = content.slice(off, end);
		_hlCss(css, off, spans);
	}
	for (const [off, end] of scriptRegions) {
		const js = content.slice(off, end);
		_hlJs(js, off, spans);
	}

	const result = [];
	const used = new Uint8Array(content.length);
	for (const cls of HL_PRIORITY) {
		for (const { start, end } of spans[cls]) {
			if (end <= start) continue;
			let ok = true;
			for (let i = start; i < end; i++) {
				if (used[i]) {
					ok = false;
					break;
				}
			}
			if (ok) {
				for (let i = start; i < end; i++) used[i] = 1;
				result.push({ start, end, cls });
			}
		}
	}
	result.sort((a, b) => a.start - b.start);
	return result;
}

function _protect(protected_, s, e) {
	for (let i = s; i < e; i++) protected_.add(i);
}

function _hlCss(css, off, spans) {
	const p = new Set();
	for (const m of css.matchAll(/\/\*[\s\S]*?\*\//g)) {
		spans.hl_comment.push({
			start: off + m.index,
			end: off + m.index + m[0].length,
		});
		_protect(p, m.index, m.index + m[0].length);
	}
	for (const m of css.matchAll(/"[^"]*"|'[^']*'/g))
		if (!p.has(m.index)) {
			spans.hl_string.push({
				start: off + m.index,
				end: off + m.index + m[0].length,
			});
			_protect(p, m.index, m.index + m[0].length);
		}
	for (const m of css.matchAll(/@[a-zA-Z-]+/g))
		if (!p.has(m.index))
			spans.hl_css_at.push({
				start: off + m.index,
				end: off + m.index + m[0].length,
			});
	for (const m of css.matchAll(
		/(?:^|(?<=[}]))\s*([^{@/][^{@/]*?)(?=\s*\{)/gms,
	))
		if (!p.has(m.index + css.slice(m.index).search(/\S/))) {
			const s = m.index + m[0].indexOf(m[1]),
				e = s + m[1].length;
			if (e > s) spans.hl_css_sel.push({ start: off + s, end: off + e });
		}
	for (const m of css.matchAll(/(?:^|\{|;)\s*([a-zA-Z-]+)\s*(?=:)/gm))
		if (!p.has(m.index))
			spans.hl_css_prop.push({
				start: off + m.index + (m[0].length - m[1].length),
				end: off + m.index + m[0].length,
			});
	for (const m of css.matchAll(
		/-?\b\d+\.?\d*(%|px|em|rem|vh|vw|vmin|vmax|pt|pc|cm|mm|in|ex|ch|deg|rad|turn|s|ms|fr)?/g,
	))
		if (m[0] && !p.has(m.index))
			spans.hl_css_num.push({
				start: off + m.index,
				end: off + m.index + m[0].length,
			});
}

function _hlJs(js, off, spans) {
	const p = new Set();
	for (const m of js.matchAll(/\/\*[\s\S]*?\*\//g)) {
		spans.hl_comment.push({
			start: off + m.index,
			end: off + m.index + m[0].length,
		});
		_protect(p, m.index, m.index + m[0].length);
	}
	for (const m of js.matchAll(/\/\/[^\n]*/g))
		if (!p.has(m.index)) {
			spans.hl_comment.push({
				start: off + m.index,
				end: off + m.index + m[0].length,
			});
			_protect(p, m.index, m.index + m[0].length);
		}
	for (const m of js.matchAll(/`(?:[^`\\]|\\.)*`/gs))
		if (!p.has(m.index)) {
			spans.hl_string.push({
				start: off + m.index,
				end: off + m.index + m[0].length,
			});
			_protect(p, m.index, m.index + m[0].length);
		}
	for (const m of js.matchAll(/"(?:[^"\\]|\\.)*"/g))
		if (!p.has(m.index)) {
			spans.hl_string.push({
				start: off + m.index,
				end: off + m.index + m[0].length,
			});
			_protect(p, m.index, m.index + m[0].length);
		}
	for (const m of js.matchAll(/'(?:[^'\\]|\\.)*'/g))
		if (!p.has(m.index)) {
			spans.hl_string.push({
				start: off + m.index,
				end: off + m.index + m[0].length,
			});
			_protect(p, m.index, m.index + m[0].length);
		}
	for (const m of js.matchAll(
		/\b0x[0-9a-fA-F]+|\b\d+\.?\d*([eE][+-]?\d+)?\b/g,
	))
		if (!p.has(m.index))
			spans.hl_number.push({
				start: off + m.index,
				end: off + m.index + m[0].length,
			});
	for (const m of js.matchAll(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)(?=\s*\()/g))
		if (!p.has(m.index))
			spans.hl_func.push({
				start: off + m.index,
				end: off + m.index + m[1].length,
			});
	for (const m of js.matchAll(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g)) {
		if (p.has(m.index)) continue;
		const w = m[0];
		if (JS_BUILTINS.has(w))
			spans.hl_builtin.push({
				start: off + m.index,
				end: off + m.index + w.length,
			});
		else if (JS_KW.has(w))
			spans.hl_keyword.push({
				start: off + m.index,
				end: off + m.index + w.length,
			});
	}
}

function fmtTs(tsMs) {
	try {
		const d = new Date(tsMs);
		const dd = String(d.getDate()).padStart(2, "0");
		const mm = String(d.getMonth() + 1).padStart(2, "0");
		const yyyy = d.getFullYear();
		const hh = String(d.getHours()).padStart(2, "0");
		const min = String(d.getMinutes()).padStart(2, "0");
		const ss = String(d.getSeconds()).padStart(2, "0");
		const ms = String(d.getMilliseconds()).padStart(3, "0");
		return `${dd}.${mm}.${yyyy}  ${hh}:${min}:${ss}.${ms}`;
	} catch {
		return String(tsMs);
	}
}

function esc(s) {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderEditorHtml(textState, cursorVisible = true) {
	const text = textState.text;
	const cur = textState.cursor;

	let hlSpans = [];
	try {
		hlSpans = buildHighlightSpans(text);
	} catch (_) {}

	const colorAt = new Array(text.length).fill(null);
	for (const { start, end, cls } of hlSpans) {
		const col = HL_COLORS[cls];
		for (let i = start; i < end; i++) colorAt[i] = col;
	}

	let html = "";
	let currentColor = null;

	function closeSpan() {
		if (currentColor) {
			html += "</span>";
			currentColor = null;
		}
	}
	function openSpan(col) {
		if (col !== currentColor) {
			closeSpan();
			html += `<span style="color:${col}">`;
			currentColor = col;
		}
	}

	for (let i = 0; i <= text.length; i++) {
		if (i === cur && cursorVisible) {
			closeSpan();
			html += '<span class="vis-cursor">|</span>';
		}
		if (i === text.length) break;
		const ch = text[i];
		const col = colorAt[i];
		if (col) openSpan(col);
		else closeSpan();
		if (ch === "\n") html += "<br>";
		else if (ch === "\t") {
			closeSpan();
			html += '<span class="vis-tab">    </span>';
		} else html += esc(ch);
	}
	closeSpan();
	return html;
}

class LogVisualizer {
	constructor() {
		this.micro = [];
		this.microIdx = 0;
		this.playing = false;
		this.timerId = null;
		this.speed = 8.0;
		this._silent = false;

		this._imageUris = {};
		this.main = new TextState();
		this.dev = new TextState();
		this._files = { MAIN: this.main };
		this._activeFilename = "MAIN";
		this._activeEditor = "main";
		this._ciBaseIndent = "";
		this._anchorFlashTimer = null;

		this._logBuf = [];
		this._microCumDelay = null;
		this._totalDelay = 0;

		this._seeking = false;
		this._seekWasPlaying = false;
		this._dragFrac = 0;
		this._dragTimer = null;

		this._stepStartWall = 0;
		this._stepDurS = 0.001;
		this._seekbarRaf = null;

		this.vscode = new VSCodeSettings();
		this._selAnchorMain = null;

		this._previewDirty = false;
		this._previewRafId = null;

		this._buildUI();
	}

	_buildUI() {
		const root = document.getElementById("vis-root");
		root.innerHTML = `
        <div id="vis-left">
          <div id="vis-toolbar">
            <button id="btn-play" disabled>▶  Play</button>
            <button id="btn-reset" disabled>⏮  Reset</button>
            <div class="sep"></div>
            <button id="btn-settings">⚙ VS Code: defaults</button>
            <div class="sep"></div>
            <button id="btn-toggle-log" title="Toggle event log">📋</button>
            <button id="btn-toggle-devtools" title="Toggle dev tools">🔧</button>
            <div class="sep"></div>
            <label>Speed: <input id="speed-slider" type="range" min="1" max="60" value="8" step="0.5"></label>
            <span id="speed-label">8×</span>
            <div class="sep"></div>
            <label><input id="chk-autoscroll" type="checkbox" checked> Auto-scroll</label>
            <span id="ts-label" style="margin-left:auto;color:${CLR.accent};font-family:Consolas,monospace;font-size:12px"></span>
            <span id="prog-label" style="margin-left:12px;color:${CLR.muted};font-size:12px">No file loaded</span>
          </div>
          <div id="vis-seekbar"><div id="vis-seekfill"></div></div>
          <div id="vis-main">
            <div id="vis-editor-wrap">
              <div id="vis-file-tabs"></div>
              <pre id="vis-editor"></pre>
            </div>
            <div id="vis-event-log-wrap">
              <div class="pane-title">Event Log</div>
              <div id="vis-event-log"></div>
            </div>
          </div>
        </div>
        <div id="vis-right">
          <div id="vis-right-main">
            <iframe id="vis-preview" sandbox="allow-scripts allow-same-origin"></iframe>
            <div id="vis-dev-outer">
              <div class="pane-title">DevTools</div>
              <pre id="vis-dev-editor"></pre>
            </div>
          </div>
        </div>
        `;

		this.elPlay = document.getElementById("btn-play");
		this.elReset = document.getElementById("btn-reset");
		this.elSettings = document.getElementById("btn-settings");
		this.elSpeed = document.getElementById("speed-slider");
		this.elSpeedLbl = document.getElementById("speed-label");
		this.elAutoScroll = document.getElementById("chk-autoscroll");
		this.elTsLbl = document.getElementById("ts-label");
		this.elProgLbl = document.getElementById("prog-label");
		this.elSeekbar = document.getElementById("vis-seekbar");
		this.elSeekFill = document.getElementById("vis-seekfill");
		this.elFileTabs = document.getElementById("vis-file-tabs");
		this.elEditor = document.getElementById("vis-editor");
		this.elDevEditor = document.getElementById("vis-dev-editor");
		this.elDevOuter = document.getElementById("vis-dev-outer");
		this.elEventLog = document.getElementById("vis-event-log");
		this.elEventLogWrap = document.getElementById("vis-event-log-wrap");
		this.elPreview = document.getElementById("vis-preview");

		this._devExpanded = true;

		this.elPlay.onclick = () => this.togglePlay();
		this.elReset.onclick = () => this.resetPlayback();
		this.elSettings.onclick = () => this._showSettings();
		document.getElementById("btn-toggle-log").onclick = () => {
			const hidden = this.elEventLogWrap.style.display === "none";
			this.elEventLogWrap.style.display = hidden ? "" : "none";
		};
		document.getElementById("btn-toggle-devtools").onclick = () =>
			this._toggleDevPanel();

		this.elSpeed.addEventListener("input", () => {
			this.speed = parseFloat(this.elSpeed.value);
			this.elSpeedLbl.textContent = `${this.speed.toFixed(0)}×`;
		});

		this.elSeekbar.addEventListener("pointerdown", (e) => {
			this.elSeekbar.setPointerCapture(e.pointerId);
			this._onSeekPress(e);
		});
		document.addEventListener("pointermove", (e) => this._onSeekDrag(e));
		document.addEventListener("pointerup", (e) => this._onSeekRelease(e));
		document.addEventListener("pointercancel", (e) => this._onSeekRelease(e));

		this._initHoverTooltip();
	}

	_toggleDevPanel() {
		this._devExpanded = !this._devExpanded;
		this.elDevOuter.style.display = this._devExpanded ? "" : "none";
	}

	loadFile({ filePath, micro, error, imageUris }) {
		if (error) {
			console.error("expand error:\n" + error);
			return;
		}

		this.vscode = VSCodeSettings.load();
		this._updateSettingsBadge();
		this._imageUris = imageUris || {};

		this.micro = micro;

		this._tsOrigin = 0;
		for (const act of micro) {
			const ts = act[2];
			if (ts && ts > 1_000_000_000_000) {
				this._tsOrigin = ts;
				break;
			}
		}

		this._microCumDelay = new Float64Array(micro.length + 1);
		let cumD = 0;
		for (let i = 0; i < micro.length; i++) {
			this._microCumDelay[i] = cumD;
			const act = micro[i];
			let d;
			switch (act[0]) {
				case "code_insert_begin":
				case "code_insert_end":
					d = act[2];
					break;
				default:
					d = act[3] !== undefined ? act[3] : DELAY_OPS;
					break;
			}
			cumD += Math.max(1, d);
		}
		this._microCumDelay[micro.length] = cumD;
		this._totalDelay = cumD;

		this._seekTo(this.micro.length);
		this.elPlay.disabled = false;
		this.elReset.disabled = false;
	}

	_updateSettingsBadge() {
		const s = this.vscode.source;
		if (s === "defaults") this.elSettings.textContent = "⚙ VS Code: defaults";
		else if (s.startsWith("parse error"))
			this.elSettings.textContent = "⚙ VS Code: error ⚠";
		else this.elSettings.textContent = "⚙ VS Code: settings.json ✓";
	}

	togglePlay() {
		if (this.playing) this._pause();
		else {
			if (this.microIdx >= this.micro.length && this.micro.length)
				this._seekTo(0);
			this._play();
		}
	}

	_play() {
		this.playing = true;
		this.elPlay.textContent = "⏸  Pause";
		this.elPlay.style.background = "#9a7000";
		this._stepStartWall = performance.now();
		this._stepDurS = 0.001;
		this._scheduleSeekbarUpdate();
		this._schedule(0);
	}

	_pause() {
		this.playing = false;
		if (this.timerId) {
			clearTimeout(this.timerId);
			this.timerId = null;
		}
		if (this._seekbarRaf) {
			cancelAnimationFrame(this._seekbarRaf);
			this._seekbarRaf = null;
		}
		this.elPlay.textContent = "▶  Play";
		this.elPlay.style.background = "#2d8f2d";
	}

	resetPlayback() {
		this._pause();
		this.microIdx = 0;
		this._resetAllFiles();
		this.dev.reset();
		this._ciBaseIndent = "";
		this._activeEditor = "main";
		this._selAnchorMain = null;
		this._logBuf = [];
		this._renderEditors();
		this._clearEventLog();
		this._updateProgress();
	}

	_resetAllFiles() {
		for (const st of Object.values(this._files)) st.reset();
		this._files = { MAIN: this._files["MAIN"] };
		this.main = this._files["MAIN"];
		this._activeFilename = "MAIN";
		this._updateFileTabs();
	}

	_schedule(delayMs) {
		if (this.playing)
			this.timerId = setTimeout(() => this._step(), Math.max(1, delayMs));
	}

	_step() {
		if (!this.playing) return;
		if (this.microIdx >= this.micro.length) {
			this.playing = false;
			this.elPlay.textContent = "▶  Play";
			this.elPlay.style.background = "#2d8f2d";
			this._renderEditors();
			this._schedulePreview();
			return;
		}
		const act = this.micro[this.microIdx++];
		const delayBase = this._handle(act);
		this._renderEditors();
		this._schedulePreview();
		this._updateProgress();
		const delayMs = Math.max(
			1,
			Math.round(delayBase / Math.max(0.1, this.speed)),
		);
		this._stepStartWall = performance.now();
		this._stepDurS = delayMs / 1000;
		this._schedule(delayMs);
	}

	_handle(act) {
		const kind = act[0];

		if (kind === "switch_editor") {
			const [, target, , delay] = act;
			const label = target === "dev" ? "DevTools" : "Main Editor";
			this._log(act[2], `⇄  switch to ${label}`, CLR.move);
			this._activeEditor = target;
			if (target === "main") this._switchToFile("MAIN");

			return delay;
		} else if (kind === "char") {
			const [, ch, ts, delay, editor] = act;
			return this._handleChar(ch, ts, delay, editor);
		} else if (kind === "code_insert_begin") {
			const lineStart =
				this.main.text.lastIndexOf("\n", this.main.cursor - 1) + 1;
			const m = this.main.text
				.slice(lineStart, this.main.cursor)
				.match(/^(\s*)/);
			this._ciBaseIndent = m ? m[1] : "";
			return act[2];
		} else if (kind === "code_insert_end") {
			this._ciBaseIndent = "";
			return act[2];
		} else if (kind === "code_char") {
			const [, ch, ts, delay, editor] = act;
			const st = editor === "dev" ? this.dev : this.main;
			if (editor === "main") this._autoDedent(ch, ts);
			st.insert(ch, ts);
			return delay;
		} else if (kind === "log_code_insert") {
			const clean = act[1].replace(ANCHOR_RE, "");
			this._log(
				act[2],
				`⬇  code_insert: ${JSON.stringify(clean.slice(0, 50))}`,
				CLR.orange,
			);
			return act[3];
		} else if (kind === "set_anchor") {
			const [, name, ts, delay] = act;
			this.main.setAnchor(name);
			this._log(ts, `⚓  anchor ${name} → ${this.main.cursor}`, CLR.accent);
			return delay;
		} else if (kind === "move_anchor") {
			const [, name, ts, delay] = act;
			const ok = this.main.jumpToAnchor(name);
			if (ok) {
				this._log(
					ts,
					`→  move to ${name} (pos ${this.main.cursor})`,
					CLR.move,
				);
				this._flashAnchor();
			} else {
				this._log(ts, `⚠  unknown anchor: ${name}`, CLR.red);
			}
			return delay;
		} else if (kind === "switch_file") {
			const [, filename, ts, delay] = act;
			this._switchToFile(filename);
			this._log(ts, `⇄  switch to file: ${filename}`, CLR.move);
			return delay;
		} else if (kind === "code_insert_newline") {
			const [, ts, delay, editor] = act;
			const st = editor === "dev" ? this.dev : this.main;
			st.insert("\n", ts);
			if (editor === "main") {
				this._autoIndent(ts);
				const lineStart =
					this.main.text.lastIndexOf("\n", this.main.cursor - 1) + 1;
				const m = this.main.text
					.slice(lineStart, this.main.cursor)
					.match(/^(\s*)/);
				this._ciBaseIndent = m ? m[1] : "";
			}
			this._log(ts, "↩  Insert Newline (in code_insert)", CLR.orange);
			return delay;
		} else if (kind === "code_cursor_move") {
			const [, ch, ts, delay, editor] = act;
			const st = editor === "dev" ? this.dev : this.main;
			if (ch in CURSOR_MOVES) {
				st.moveCursor(CURSOR_MOVES[ch]);
			}
			if (editor === "main") {
				const lineStart =
					this.main.text.lastIndexOf("\n", this.main.cursor - 1) + 1;
				const m = this.main.text
					.slice(lineStart, this.main.cursor)
					.match(/^(\s*)/);
				this._ciBaseIndent = m ? m[1] : "";
			}
			this._log(ts, `  ${ch} (in code_insert)`, CLR.orange);
			return delay;
		} else if (kind === "code_backspace") {
			const [, ts, delay, editor] = act;
			const st = editor === "dev" ? this.dev : this.main;
			if (this._backspaceIsIgnored(st)) {
				this._log(ts, "⌫  Backspace (ignored — in code_insert)", "#FFAAAA");
			} else {
				st.deleteBack(1);
				this._log(ts, "⌫  Backspace (in code_insert)", CLR.red);
			}
			return delay;
		} else if (kind === "code_fwd_delete") {
			const [, ts, delay, editor] = act;
			const st = editor === "dev" ? this.dev : this.main;
			st.deleteForward(1);
			this._log(ts, "⌦  Delete (in code_insert)", CLR.red);
			return delay;
		} else if (kind === "code_delete_line") {
			const [, ts, delay, editor] = act;
			const st = editor === "dev" ? this.dev : this.main;
			st.deleteLine();
			this._log(ts, "⛔  Delete Line (in code_insert)", CLR.red);
			return delay;
		} else if (kind === "code_insert_atomic") {
			return this._handleCodeInsertAtomic(act);
		}

		return DELAY_OPS;
	}

	_handleChar(ch, ts, delay, editor) {
		const st = editor === "dev" ? this.dev : this.main;

		if (ch in CURSOR_MOVES) {
			this.main.moveCursor(CURSOR_MOVES[ch]);
			this._selAnchorMain = null;
			this._log(ts, `⌨  ${ch}`, CLR.blue);
			return delay;
		}
		if (ch in SHIFT_CURSOR_MOVES) {
			if (this._selAnchorMain === null)
				this._selAnchorMain = this.main.cursor;
			this.main.moveCursor(SHIFT_CURSOR_MOVES[ch]);
			this._log(ts, `⌨  ${ch} (select)`, CLR.blue);
			return delay;
		}

		if (ch in CHAR_REPLACEMENTS) {
			const real = CHAR_REPLACEMENTS[ch];
			if (
				real === "\t" &&
				editor === "main" &&
				this._selAnchorMain !== null
			) {
				this._indentSelection(ts);
				this._log(ts, "⇥ Tab (indent selection)", CLR.blue);
				return delay;
			}
			st.insert(real, ts);
			if (real === "\n" && editor === "main") this._autoIndent(ts);
			this._log(ts, `⌨  ${real === "\n" ? "↩ Enter" : "⇥ Tab"}`, CLR.blue);
			return delay;
		}

		if (ch === "⌫" || ch === "↢") {
			if (this._backspaceIsIgnored(st)) {
				this._log(
					ts,
					"⌫  Backspace (ignored — before closing tag)",
					"#FFAAAA",
				);
				return delay;
			}
			st.deleteBack(1);
			this._log(ts, "⌫  Backspace", CLR.red);
			return delay;
		}

		if (ch === DELETE_FWRD_CHAR) {
			st.deleteForward(1);
			this._log(ts, "⌦  Delete (forward)", CLR.blue);
			return delay;
		}

		if (ch === DELETE_LINE_CHAR) {
			st.deleteLine();
			this._log(ts, "⛔  Delete Line (Ctrl+Shift+K)", CLR.blue);
			return delay;
		}

		if (ch === PAUSE_CHAR) {
			this._log(ts, "🕛  pause 500 ms", CLR.dim);
			return PAUSE_MS;
		}

		if (IGNORED_CHARS.has(ch)) return DELAY_OPS;

		if (ch === ";" && editor === "dev") {
			st.insert(ch, ts);
			this._devSemicolonNewline(ts);
			this._log(ts, `⌨  ${JSON.stringify(ch)}`, CLR.dim);
			return delay;
		}

		if (editor === "main") this._autoDedent(ch, ts);
		st.insert(ch, ts);
		if (editor === "main") this._applyVscodeAuto(ch, ts);

		this._log(ts, `⌨  ${JSON.stringify(ch)}`, CLR.dim);
		return delay;
	}

	_handleCodeInsertAtomic(act) {
		const [, code, ts, delay, editor] = act;
		const clean = code.replace(ANCHOR_RE, "");
		this._log(
			ts,
			`⬇  code_insert: ${JSON.stringify(clean.slice(0, 50))}`,
			CLR.orange,
		);

		const lineStart =
			this.main.text.lastIndexOf("\n", this.main.cursor - 1) + 1;
		const m = this.main.text
			.slice(lineStart, this.main.cursor)
			.match(/^(\s*)/);
		this._ciBaseIndent = m ? m[1] : "";

		const segments = _splitCodeWithAnchors(code);
		for (const [segKind, segVal] of segments) {
			if (segKind === "text") {
				for (const ch of segVal) {
					const st = editor === "dev" ? this.dev : this.main;
					if (ch === DELETE_LINE_CHAR) {
						st.deleteLine();
					} else if (
						Object.prototype.hasOwnProperty.call(CURSOR_MOVES, ch)
					) {
						st.moveCursor(CURSOR_MOVES[ch]);
						if (editor === "main") {
							const ls =
								this.main.text.lastIndexOf("\n", this.main.cursor - 1) +
								1;
							const mc = this.main.text
								.slice(ls, this.main.cursor)
								.match(/^(\s*)/);
							this._ciBaseIndent = mc ? mc[1] : "";
						}
					} else if (ch === "↩" || ch === "\n") {
						st.insert("\n", ts);
						if (editor === "main") {
							this._autoIndent(ts);
							const ls =
								this.main.text.lastIndexOf("\n", this.main.cursor - 1) +
								1;
							const mc = this.main.text
								.slice(ls, this.main.cursor)
								.match(/^(\s*)/);
							this._ciBaseIndent = mc ? mc[1] : "";
						}
					} else if (ch === "―" || ch === "\t") {
						st.insert("\t", ts);
					} else if (_EXPAND_BACKSPACE.has(ch)) {
						if (!this._backspaceIsIgnored(st)) st.deleteBack(1);
					} else if (_EXPAND_FWD_DEL.has(ch)) {
						st.deleteForward(1);
					} else {
						if (editor === "main") this._autoDedent(ch, ts);
						st.insert(ch, ts);
					}
				}
			} else {
				this.main.setAnchor(segVal);
			}
		}

		this._ciBaseIndent = "";
		return delay;
	}

	_applyVscodeAuto(ch, ts) {
		const textBefore = this.main.text.slice(0, this.main.cursor);
		const textAfter = this.main.text.slice(this.main.cursor);
		const lineEnd = textAfter.indexOf("\n");
		const afterLine =
			lineEnd === -1 ? textAfter : textAfter.slice(0, lineEnd);

		let auto = this.vscode.autoCreateQuotes(ch, textBefore.slice(0, -1));
		if (auto) {
			for (const c of auto) this.main.insert(c, ts);
			this.main.cursor -= auto.length;
			this._log(ts, `  ↳ auto-quotes: ${JSON.stringify(auto)}`, CLR.green);
			return;
		}

		auto = this.vscode.autoCloseHtmlTag(ch, textBefore.slice(0, -1));
		if (auto) {
			for (const c of auto) this.main.insert(c, ts);
			this.main.cursor -= auto.length;
			this._log(ts, `  ↳ auto-tag: ${JSON.stringify(auto)}`, CLR.green);
			return;
		}

		auto = this.vscode.autoCloseBracket(ch, afterLine);
		if (auto) {
			for (const c of auto) this.main.insert(c, ts);
			this.main.cursor -= auto.length;
			this._log(ts, `  ↳ auto-bracket: ${JSON.stringify(auto)}`, CLR.green);
			return;
		}

		auto = this.vscode.autoCloseQuote(ch, textBefore, afterLine);
		if (auto) {
			for (const c of auto) this.main.insert(c, ts);
			this.main.cursor -= auto.length;
			this._log(ts, `  ↳ auto-quote: ${JSON.stringify(auto)}`, CLR.green);
			return;
		}
	}

	_autoIndent(ts) {
		const cur = this.main.cursor;
		const prevEnd = this.main.text.lastIndexOf("\n", cur - 1);
		const prev2 =
			prevEnd > 0 ? this.main.text.lastIndexOf("\n", prevEnd - 1) : -1;
		const prevLine = this.main.text.slice(prev2 + 1, prevEnd);
		const base = (prevLine.match(/^(\s*)/) || ["", ""])[1];
		const trimmed = prevLine.trimEnd();

		const opensWithBrace = /[{([]$/.test(trimmed);
		const opensWithTag =
			/<[a-zA-Z][a-zA-Z0-9-]*(\s[^>]*)?>$/.test(trimmed) &&
			!/\/>$/.test(trimmed) &&
			!/<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)(\s[^>]*)?>$/i.test(
				trimmed,
			);
		const opens = opensWithBrace || opensWithTag;
		const indent = base + (opens ? "\t" : "");

		const lineEnd = this.main.text.indexOf("\n", cur);
		const after =
			lineEnd === -1
				? this.main.text.slice(cur)
				: this.main.text.slice(cur, lineEnd);
		const afterTrimmed = after.trimStart();
		const closes = /^[})\]]/.test(afterTrimmed) || /^<\//.test(afterTrimmed);

		if (opens && closes) {
			for (const c of indent) this.main.insert(c, ts);
			this.main.insert("\n", ts);
			for (const c of base) this.main.insert(c, ts);
			this.main.cursor -= base.length + 1;
		} else if (!opens && closes) {
			let closingIndent;
			if (base.startsWith("\t")) closingIndent = base.slice(1);
			else if (base.startsWith("    ")) closingIndent = base.slice(4);
			else if (base.startsWith("  ")) closingIndent = base.slice(2);
			else closingIndent = base;
			for (const c of closingIndent) this.main.insert(c, ts);
		} else {
			for (const c of indent) this.main.insert(c, ts);
		}
	}

	_indentSelection(ts) {
		const selStart = Math.min(this._selAnchorMain, this.main.cursor);
		const selEnd = Math.max(this._selAnchorMain, this.main.cursor);
		const text = this.main.text;

		const lineStarts = [];
		let p = text.lastIndexOf("\n", selStart - 1) + 1;
		lineStarts.push(p);
		while (true) {
			const nl = text.indexOf("\n", p);
			if (nl === -1 || nl >= selEnd) break;
			lineStarts.push(nl + 1);
			p = nl + 1;
		}
		if (lineStarts.length > 1 && lineStarts[lineStarts.length - 1] === selEnd)
			lineStarts.pop();

		let cursor = this.main.cursor;

		for (let i = lineStarts.length - 1; i >= 0; i--) {
			const pos = lineStarts[i];
			this.main.text =
				this.main.text.slice(0, pos) + "\t" + this.main.text.slice(pos);
			this.main.charTs.splice(pos, 0, ts);
			for (const name in this.main.anchors) {
				if (this.main.anchors[name] > pos) this.main.anchors[name]++;
			}
			if (cursor > pos) cursor++;
		}

		this.main.cursor = cursor;
		this._selAnchorMain = null;
	}

	_initHoverTooltip() {
		this._hoverTip = document.createElement("div");
		this._hoverTip.id = "vis-hover-tip";
		document.body.appendChild(this._hoverTip);

		const showTip = (e, st) => {
			const idx = this._charIndexAtPoint(
				e.clientX,
				e.clientY,
				e.currentTarget,
			);
			if (idx !== null && idx < st.charTs.length) {
				const ts = st.charTs[idx];
				if (ts) {
					const timeStr = fmtTs(ts).split("  ")[1] ?? fmtTs(ts);
					this._hoverTip.textContent = timeStr;
					this._hoverTip.style.left = `${e.clientX + 14}px`;
					this._hoverTip.style.top = `${e.clientY + 18}px`;
					this._hoverTip.style.display = "block";
					return;
				}
			}
			this._hoverTip.style.display = "none";
		};
		const hideTip = () => {
			this._hoverTip.style.display = "none";
		};

		this.elEditor.addEventListener("mousemove", (e) => showTip(e, this.main));
		this.elEditor.addEventListener("mouseleave", hideTip);
		this.elDevEditor.addEventListener("mousemove", (e) =>
			showTip(e, this.dev),
		);
		this.elDevEditor.addEventListener("mouseleave", hideTip);
	}

	_charIndexAtPoint(x, y, root) {
		let range;
		if (document.caretPositionFromPoint) {
			const pos = document.caretPositionFromPoint(x, y);
			if (!pos) return null;
			range = document.createRange();
			range.setStart(pos.offsetNode, pos.offset);
		} else {
			const doc = /** @type {any} */ (document);
			if (doc.caretRangeFromPoint) range = doc.caretRangeFromPoint(x, y);
		}
		if (!range) return null;
		return this._countCharsToNode(
			root,
			range.startContainer,
			range.startOffset,
		);
	}

	_countCharsToNode(root, targetNode, targetOffset) {
		let srcIdx = 0;
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
		let node = walker.nextNode();
		while (node) {
			if (node === targetNode) {
				if (node.nodeType !== Node.TEXT_NODE) return srcIdx;
				const p = node.parentElement;
				if (p?.classList.contains("vis-cursor")) return srcIdx;
				if (p?.classList.contains("vis-tab")) return srcIdx;
				return srcIdx + targetOffset;
			}
			if (node.nodeType === Node.TEXT_NODE) {
				const p = node.parentElement;
				if (p?.classList.contains("vis-cursor")) {
					node = walker.nextNode();
					continue;
				}
				if (p?.classList.contains("vis-tab")) {
					srcIdx += 1;
					node = walker.nextNode();
					continue;
				}
				srcIdx += node.textContent.length;
			} else if (node.nodeName === "BR") {
				srcIdx += 1;
			}
			node = walker.nextNode();
		}
		return null;
	}

	_switchToFile(filename) {
		if (!(filename in this._files)) {
			this._files[filename] = new TextState();
		}
		this._activeFilename = filename;
		this.main = this._files[filename];
		if (!this._silent) this._updateFileTabs();
	}

	_updateFileTabs() {
		if (!this.elFileTabs) return;
		const keys = Object.keys(this._files);
		if (keys.length <= 1) {
			this.elFileTabs.innerHTML = "";
			return;
		}
		this.elFileTabs.innerHTML = "";
		for (const name of keys) {
			const btn = document.createElement("button");
			btn.className =
				"file-tab" +
				(name === this._activeFilename ? " file-tab-active" : "");
			btn.textContent =
				name === "MAIN" ? "MAIN" : name.split("/").pop().split("\\").pop();
			btn.title = name;
			btn.onclick = () => {
				this._switchToFile(name);
				this._renderEditors();
			};
			this.elFileTabs.appendChild(btn);
		}
	}

	_flashAnchor() {
		if (this._anchorFlashTimer) clearTimeout(this._anchorFlashTimer);
		this.elEditor.classList.add("anchor-flash");
		this._anchorFlashTimer = setTimeout(() => {
			this.elEditor.classList.remove("anchor-flash");
			this._anchorFlashTimer = null;
		}, 500);
	}

	_prevLineOpensTag(st, ls) {
		if (ls === 0) return false;
		const prevEnd = ls - 1;
		const prevLs = st.text.lastIndexOf("\n", prevEnd - 1) + 1;
		const prevLine = st.text.slice(prevLs, prevEnd).trimEnd();
		const m = prevLine.match(/<([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^>]*)?>$/);
		if (!m) return false;
		if (prevLine.endsWith("/>")) return false;
		if (HTML_VOID_TAGS.has(m[1].toLowerCase())) return false;
		return true;
	}

	_backspaceIsIgnored(st) {
		if (st.cursor === 0) return false;
		const CLOSING = ["</style", "</script", "</html"];
		const prevChar = st.text[st.cursor - 1];
		if (prevChar === "\n") {
			const ahead = st.text.slice(st.cursor, st.cursor + 9).trimStart();
			return CLOSING.some((p) => ahead.startsWith(p));
		}
		if (prevChar === " " || prevChar === "\t") {
			const ls = st.text.lastIndexOf("\n", st.cursor - 1) + 1;
			const leRaw = st.text.indexOf("\n", st.cursor);
			const le = leRaw === -1 ? st.text.length : leRaw;
			if (st.text.slice(ls, le).trim() === "") {
				const nextStart = leRaw === -1 ? st.text.length : leRaw + 1;
				const ahead = st.text.slice(nextStart, nextStart + 9).trimStart();
				if (CLOSING.some((p) => ahead.startsWith(p))) return true;
				if (this._prevLineOpensTag(st, ls)) return true;
			}
		}
		return false;
	}

	_autoDedent(ch, ts) {
		const lineStart =
			this.main.text.lastIndexOf("\n", this.main.cursor - 1) + 1;
		const before = this.main.text.slice(lineStart, this.main.cursor);

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
		const savedCursor = this.main.cursor;
		this.main.cursor = lineStart;
		this.main.deleteForward(n);
		this.main.cursor = savedCursor - n;
	}

	_devSemicolonNewline(ts) {
		const lineStart =
			this.dev.text.lastIndexOf("\n", this.dev.cursor - 1) + 1;
		const line = this.dev.text.slice(lineStart, this.dev.cursor);
		const indent = (line.match(/^(\s*)/) || ["", ""])[1];
		this.dev.insert("\n", ts);
		for (const c of indent) this.dev.insert(c, ts);
	}

	_renderEditors() {
		this.elEditor.innerHTML = renderEditorHtml(this.main);
		this.elDevEditor.innerHTML = renderEditorHtml(this.dev);
		if (this.elAutoScroll.checked) {
			const cur = this.elEditor.querySelector(".vis-cursor");
			if (cur) cur.scrollIntoView({ block: "nearest" });
		}
		const ts = this.main.tsAtCursor() || this.dev.tsAtCursor();
		if (ts && !this._silent) this.elTsLbl.textContent = fmtTs(ts).slice(-12);
	}

	_schedulePreview() {
		this._previewDirty = true;
		if (!this._previewRafId)
			this._previewRafId = requestAnimationFrame(() => {
				this._previewRafId = null;
				if (this._previewDirty) {
					this._updatePreview();
					this._previewDirty = false;
				}
			});
	}

	_updatePreview(force = false) {
		if (!force && this.playing && this.microIdx % 300 !== 0) {
			this._previewDirty = true;
			return;
		}
		try {
			const html = (this._files["MAIN"] || this.main).text;
			this.elPreview.srcdoc = this._inlineFiles(html) || "";
		} catch (_) {}
		this._previewDirty = false;
	}

	_inlineFiles(html) {
		const filesMap = { ...this._imageUris };
		for (const [key, st] of Object.entries(this._files)) {
			if (key === "MAIN") continue;
			const base = key.replace(/\\/g, "/").split("/").pop();
			filesMap[base] = st.text;
		}
		if (!Object.keys(filesMap).length) return html;
		return inlineFilesInHtml(html, filesMap);
	}

	_log(ts, msg, color = CLR.blue) {
		const tShort = ts ? fmtTs(ts).slice(-12) : "??:??:??.???";
		const text = `[${tShort}] ${msg}\n`;
		this._logBuf.push([this.microIdx, text, color]);
		if (!this._silent) this._appendLogEntry(text, color);
	}

	_appendLogEntry(text, color) {
		const span = document.createElement("span");
		span.style.color = color;
		span.textContent = text;
		this.elEventLog.appendChild(span);
		this.elEventLog.scrollTop = this.elEventLog.scrollHeight;
	}

	_clearEventLog() {
		this.elEventLog.innerHTML = "";
	}

	_drawSeekbar(frac) {
		this.elSeekFill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
	}

	_idxToFrac(idx) {
		if (!this._totalDelay || !this._microCumDelay)
			return this.micro.length ? idx / this.micro.length : 0;
		const i = Math.max(0, Math.min(idx, this._microCumDelay.length - 1));
		return this._microCumDelay[i] / this._totalDelay;
	}

	_fracToIdx(frac) {
		if (!this._totalDelay || !this._microCumDelay) {
			return Math.max(
				0,
				Math.min(this.micro.length, Math.round(frac * this.micro.length)),
			);
		}
		const target = frac * this._totalDelay;
		let lo = 0,
			hi = this.micro.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (this._microCumDelay[mid] < target) lo = mid + 1;
			else hi = mid;
		}
		return Math.max(0, Math.min(this.micro.length, lo));
	}

	_scheduleSeekbarUpdate() {
		if (this._seekbarRaf) cancelAnimationFrame(this._seekbarRaf);
		if (!this.playing || this._seeking) return;
		this._seekbarRaf = requestAnimationFrame(() => {
			this._seekbarRaf = null;
			if (!this.playing) return;
			const elapsed = (performance.now() - this._stepStartWall) / 1000;
			const t =
				this._stepDurS > 0 ? Math.min(1, elapsed / this._stepDurS) : 1;
			const prevFrac = this._idxToFrac(Math.max(0, this.microIdx - 1));
			const nextFrac = this._idxToFrac(this.microIdx);
			const frac = Math.min(1, prevFrac + (nextFrac - prevFrac) * t);
			this._drawSeekbar(frac);
			this._scheduleSeekbarUpdate();
		});
	}

	_onSeekPress(e) {
		if (!this.micro.length) return;
		this._seeking = true;
		this._seekWasPlaying = this.playing;
		if (this.playing) this._pause();
		const frac = e.offsetX / this.elSeekbar.offsetWidth;
		this._drawSeekbar(frac);
	}

	_onSeekDrag(e) {
		if (!this._seeking) return;
		const rect = this.elSeekbar.getBoundingClientRect();
		const frac = Math.max(
			0,
			Math.min(1, (e.clientX - rect.left) / rect.width),
		);
		this._dragFrac = frac;
		this._drawSeekbar(frac);
		if (!this._dragTimer)
			this._dragTimer = setTimeout(() => {
				this._dragTimer = null;
				if (this._seeking) {
					this._seekTo(this._fracToIdx(this._dragFrac));
					this._drawSeekbar(this._dragFrac);
				}
			}, 150);
	}

	_onSeekRelease(e) {
		if (!this._seeking) return;
		if (this._dragTimer) {
			clearTimeout(this._dragTimer);
			this._dragTimer = null;
		}
		this._seeking = false;
		let frac;
		if (e.type === "pointercancel") {
			frac = this._dragFrac;
		} else {
			const rect = this.elSeekbar.getBoundingClientRect();
			frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		}
		this._seekTo(this._fracToIdx(frac));
		if (this._seekWasPlaying) this._play();
	}

	_seekTo(targetIdx) {
		if (!this.micro.length) return;
		targetIdx = Math.max(0, Math.min(targetIdx, this.micro.length));

		this._silent = true;
		this.microIdx = 0;
		this._resetAllFiles();
		this.dev.reset();
		this._ciBaseIndent = "";
		this._activeEditor = "main";
		this._selAnchorMain = null;
		this._logBuf = [];

		while (this.microIdx < targetIdx) {
			this._handle(this.micro[this.microIdx]);
			this.microIdx++;
		}
		this._silent = false;
		this._updateFileTabs();

		this._clearEventLog();
		const frag = document.createDocumentFragment();
		for (const [, text, color] of this._logBuf) {
			const span = document.createElement("span");
			span.style.color = color;
			span.textContent = text;
			frag.appendChild(span);
		}
		this.elEventLog.appendChild(frag);
		this.elEventLog.scrollTop = this.elEventLog.scrollHeight;

		this._renderEditors();
		this._updatePreview(true);
		this._updateProgress();
	}

	_updateProgress() {
		const t = this.micro.length,
			i = this.microIdx;
		if (!this._silent) this.elProgLbl.textContent = `${i} / ${t}`;
		if (!this.playing || this._seeking) this._drawSeekbar(this._idxToFrac(i));
	}

	_showSettings() {
		const existing = document.getElementById("settings-modal");
		if (existing) {
			existing.remove();
			return;
		}

		const modal = document.createElement("div");
		modal.id = "settings-modal";
		modal.innerHTML = `
        <div id="settings-box">
          <div style="font-weight:bold;font-size:14px;margin-bottom:6px">⚙ VS Code Editor Settings</div>
          <div style="font-size:11px;color:${CLR.muted};margin-bottom:8px">Source: ${this.vscode.source}</div>
          <table id="settings-table"></table>
          <button id="btn-close-settings" style="margin-top:12px">Close</button>
        </div>`;
		document.body.appendChild(modal);

		const tbl = document.getElementById("settings-table");
		const keys = [
			"editor.autoClosingBrackets",
			"editor.autoClosingQuotes",
			"html.autoClosingTags",
			"html.autoCreateQuotes",
			"editor.minimap.enabled",
			"editor.parameterHints.enabled",
			"editor.quickSuggestions",
		];
		for (const key of keys) {
			const v = this.vscode.raw[key];
			let active, valStr;
			if (typeof v === "boolean") {
				active = v;
				valStr = v ? "ON" : "off";
			} else if (typeof v === "object") {
				active = Object.values(v).some((x) => x !== false && x !== "off");
				valStr = active ? "mixed" : "off";
			} else {
				active = !["never", "off", "false", "0"].includes(
					String(v).toLowerCase(),
				);
				valStr = String(v);
			}
			const tr = document.createElement("tr");
			tr.innerHTML = `<td style="color:${active ? CLR.green : CLR.dim}">●</td>
                <td style="font-family:Consolas;font-size:11px">${key}</td>
                <td style="font-family:Consolas;font-size:11px;color:${active ? CLR.orange : CLR.muted};text-align:right;padding-left:12px">${valStr}</td>`;
			tbl.appendChild(tr);
		}
		document.getElementById("btn-close-settings").onclick = () =>
			modal.remove();
		modal.addEventListener("click", (e) => {
			if (e.target === modal) modal.remove();
		});
	}
}

let vis;

function _simIdbOpen() {
	return new Promise((res, rej) => {
		const req = indexedDB.open("kla", 1);
		req.onupgradeneeded = (e) => e.target.result.createObjectStore("state");
		req.onsuccess = (e) => res(e.target.result);
		req.onerror = () => rej(req.error);
	});
}
async function _simIdbGet(key) {
	try {
		const db = await _simIdbOpen();
		return await new Promise((res) => {
			const r = db.transaction("state").objectStore("state").get(key);
			r.onsuccess = () => res(r.result ?? null);
			r.onerror = () => res(null);
		});
	} catch {
		return null;
	}
}
async function _simIdbSet(key, value) {
	try {
		const db = await _simIdbOpen();
		await new Promise((res, rej) => {
			const tx = db.transaction("state", "readwrite");
			tx.objectStore("state").put(value, key);
			tx.oncomplete = res;
			tx.onerror = rej;
		});
	} catch {}
}

const _SIM_IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|ico|bmp)$/i;
const _SIM_LOG_SKIP = new Set(["diff_marks.json", "tokens_positions.json"]);
const _SIM_LOG_RANK = (name) => {
	const n = name.toLowerCase();
	if (n === "log.json") return 0;
	if (n.endsWith("_log.json")) return 1;
	if (n.includes("log")) return 2;
	return 3;
};

async function _simReadDir(handle, prefix, pathMap, files) {
	for await (const [name, entry] of handle) {
		const path = prefix ? `${prefix}/${name}` : name;
		if (entry.kind === "directory") {
			await _simReadDir(entry, path, pathMap, files);
		} else {
			const file = await entry.getFile();
			files.push(file);
			pathMap.set(path, file);
		}
	}
}

async function _simReadImageUris(pathMap) {
	const imageUris = {};
	await Promise.all(
		[...pathMap.entries()]
			.filter(([p]) => _SIM_IMAGE_EXT.test(p))
			.map(
				([, f]) =>
					new Promise((res) => {
						const r = new FileReader();
						r.onload = (e) => {
							imageUris[f.name] = e.target.result;
							res();
						};
						r.onerror = res;
						r.readAsDataURL(f);
					}),
			),
	);
	return imageUris;
}

document.addEventListener("DOMContentLoaded", () => {
	vis = new LogVisualizer();

	const landing = document.getElementById("lv-landing");
	const btnOpen = document.getElementById("btn-open-log");
	const btnFolder = document.getElementById("btn-open-folder");

	function loadFromData(data) {
		landing.style.display = "none";
		vis.loadFile(data);
	}

	const isReload =
		performance.getEntriesByType("navigation")[0]?.type === "reload";
	if (!isReload) {
		try {
			const logData = window.__LOG_DATA__;
			const logTs = logData?.loadedAt || 0;
			let parsed = null;
			try {
				const stored = localStorage.getItem("kla_sim_data");
				if (stored) parsed = JSON.parse(stored);
			} catch {}
			const storedTs = parsed?.loadedAt || 0;

			if (logData && logTs >= storedTs) {
				loadFromData(logData);
			} else if (parsed) {
				const { filePath, events } = parsed;
				let imageUris = {};
				try {
					const raw = localStorage.getItem("kla_sim_images");
					if (raw) imageUris = JSON.parse(raw);
				} catch {}
				const micro = expandEvents(events || []);
				loadFromData({ filePath, micro, error: null, imageUris });
			} else if (logData) {
				loadFromData(logData);
			}
		} catch {}
	}

	btnFolder.addEventListener("click", async () => {
		try {
			const lastDir = await _simIdbGet("lastDir");
			const opts = { mode: "read" };
			if (lastDir) opts.startIn = lastDir;
			const dirHandle = await window.showDirectoryPicker(opts);
			_simIdbSet("lastDir", dirHandle);
			const files = [];
			const pathMap = new Map();
			await _simReadDir(dirHandle, "", pathMap, files);

			const jsonFiles = files.filter(
				(f) =>
					f.name.toLowerCase().endsWith(".json") &&
					!_SIM_LOG_SKIP.has(f.name.toLowerCase()),
			);
			if (!jsonFiles.length) {
				alert("No JSON log file found in this folder.");
				return;
			}

			const candidates = [...jsonFiles].sort(
				(a, b) => _SIM_LOG_RANK(a.name) - _SIM_LOG_RANK(b.name),
			);
			let loaded = false;
			for (const file of candidates) {
				try {
					const data = JSON.parse(await file.text());
					const events = data?.events || data?.keyPresses || [];
					if (Array.isArray(events) && events.length) {
						const imageUris = await _simReadImageUris(pathMap);
						const micro = expandEvents(events);
						loadFromData({
							filePath: file.name,
							micro,
							error: null,
							imageUris,
						});
						loaded = true;
						break;
					}
				} catch {}
			}
			if (!loaded) alert("No JSON log file with events found.");
		} catch (e) {
			if (e.name !== "AbortError")
				alert("Could not open folder: " + e.message);
		}
	});

	btnOpen.addEventListener("click", async () => {
		try {
			const lastDir = await _simIdbGet("lastDir");
			const opts = {
				types: [
					{
						description: "Log files",
						accept: { "application/json": [".json"] },
					},
				],
			};
			if (lastDir) opts.startIn = lastDir;
			const [fh] = await window.showOpenFilePicker(opts);
			_simIdbSet("lastDir", fh);
			const file = await fh.getFile();
			const json = JSON.parse(await file.text());
			const events = json.events || [];
			const micro = expandEvents(events);
			loadFromData({ filePath: file.name, micro, error: null });
		} catch (e) {
			if (e.name !== "AbortError") alert("Failed to load log: " + e.message);
		}
	});
});
