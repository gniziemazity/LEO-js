"use strict";

const HL_FALLBACK_COLORS = {
	hl_comment: "#66bb6a",
	hl_doctype: "#007acc",
	hl_tag: "#e07020",
	hl_attr: "#cc2222",
	hl_value: "#007acc",
	hl_keyword: "#007acc",
	hl_builtin: "#007acc",
	hl_number: "#007acc",
	hl_string: "#cc2222",
	hl_func: "#e07020",
	hl_css_sel: "#e07020",
	hl_css_prop: "#cc2222",
	hl_css_num: "#007acc",
	hl_css_at: "#005a9e",
};

const HL_COLORS = (function () {
	if (typeof _cssVar !== "function") return { ...HL_FALLBACK_COLORS };
	const out = {};
	for (const k of Object.keys(HL_FALLBACK_COLORS)) {
		const cssName = "--" + k.replace(/_/g, "-");
		const v = _cssVar(cssName);
		out[k] = v || HL_FALLBACK_COLORS[k];
	}
	return out;
})();

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

function _collapseSpans(content, spans) {
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

function buildHighlightSpans(content, fileType = "html") {
	if (fileType === "none") return [];

	const spans = {};
	for (const k of Object.keys(HL_COLORS)) spans[k] = [];

	if (fileType === "css") {
		_hlCss(content, 0, spans);
		return _collapseSpans(content, spans);
	}

	if (fileType === "js" || fileType === "py" || fileType === "python") {
		const profId = fileType === "js" ? ".js" : "python";
		const LP = typeof window !== "undefined" ? window.LanguageProfiles : null;
		const prof = LP ? LP.getProfile(profId) : null;
		if (prof) LP.highlight(prof, content, 0, spans);
		return _collapseSpans(content, spans);
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

	return _collapseSpans(content, spans);
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
	if (typeof window === "undefined" || !window.LanguageProfiles) return;
	const prof = window.LanguageProfiles.getProfile(".js");
	if (prof) window.LanguageProfiles.highlight(prof, js, off, spans);
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
		} else html += escHtml(ch);
	}
	closeSpan();
	return html;
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = { HL_COLORS, HL_PRIORITY, buildHighlightSpans };
}
