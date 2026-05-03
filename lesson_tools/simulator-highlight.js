"use strict";

const HL_COLORS = {
	hl_comment: _cssVar("--hl-comment"),
	hl_doctype: _cssVar("--hl-doctype"),
	hl_tag: _cssVar("--hl-tag"),
	hl_attr: _cssVar("--hl-attr"),
	hl_value: _cssVar("--hl-value"),
	hl_keyword: _cssVar("--hl-keyword"),
	hl_builtin: _cssVar("--hl-builtin"),
	hl_number: _cssVar("--hl-number"),
	hl_string: _cssVar("--hl-string"),
	hl_func: _cssVar("--hl-func"),
	hl_css_sel: _cssVar("--hl-css-sel"),
	hl_css_prop: _cssVar("--hl-css-prop"),
	hl_css_num: _cssVar("--hl-css-num"),
	hl_css_at: _cssVar("--hl-css-at"),
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

function buildHighlightSpans(content, fileType = "html") {
	if (fileType === "none") return [];

	const spans = {};
	for (const k of Object.keys(HL_COLORS)) spans[k] = [];

	if (fileType === "css") {
		_hlCss(content, 0, spans);
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

	if (fileType === "js") {
		_hlJs(content, 0, spans);
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
		/(?:^|(?<=[;}]))\s*([^{}\s@/][^{}@/]*?)(?=\s*\{)/gm,
	))
		if (!p.has(m.index + css.slice(m.index).search(/\S/))) {
			const s = m.index + m[0].indexOf(m[1]),
				e = s + m[1].trimEnd().length;
			if (e > s) spans.hl_css_sel.push({ start: off + s, end: off + e });
		}
	for (const m of css.matchAll(/(?:^|\{|;)\s*([a-zA-Z-]+)\s*(?=:)/gm)) {
		const propStart = m.index + (m[0].length - m[1].length);
		if (!p.has(propStart))
			spans.hl_css_prop.push({
				start: off + propStart,
				end: off + m.index + m[0].length,
			});
	}
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

function renderEditorHtml(textState, cursorVisible = true, fileType = "html") {
	const text = textState.text;
	const cur = textState.cursor;

	let hlSpans = [];
	try {
		hlSpans = buildHighlightSpans(text, fileType);
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
