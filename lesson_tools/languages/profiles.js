"use strict";

const _PROFILE_IDS = ["javascript", "css", "html", "plaintext", "python"];
const _profiles = {};
const _extToId = {};
const _compiledRe = {};
const _compiledOpenTagRe = {};
let _readyPromise = null;

async function _loadJson(id) {
	if (typeof window !== "undefined") {
		const base = new URL("languages/", window.location.href);
		const r = await fetch(new URL(`${id}.json`, base));
		if (!r.ok) throw new Error(`Failed to fetch profile ${id}: ${r.status}`);
		return r.json();
	}
	const fs = require("node:fs");
	const path = require("node:path");
	const p = path.join(__dirname, `${id}.json`);
	return JSON.parse(fs.readFileSync(p, "utf8"));
}

function initProfiles() {
	if (_readyPromise) return _readyPromise;
	_readyPromise = (async () => {
		for (const pid of _PROFILE_IDS) {
			const data = await _loadJson(pid);
			_profiles[pid] = data;
			for (const ext of data.extensions || []) {
				_extToId[ext.toLowerCase()] = pid;
			}
		}
	})();
	return _readyPromise;
}

function _ensureLoaded(caller) {
	if (Object.keys(_profiles).length !== _PROFILE_IDS.length) {
		throw new Error(`${caller}() called before initProfiles() resolved`);
	}
}

function getProfile(extOrId) {
	_ensureLoaded("getProfile");
	const key = (extOrId || "").toLowerCase();
	if (_profiles[key]) return _profiles[key];
	if (key.startsWith(".")) {
		const pid = _extToId[key];
		if (pid) return _profiles[pid];
	}
	return null;
}

function allExtensions() {
	_ensureLoaded("allExtensions");
	return Object.keys(_extToId).sort();
}

function extensionToId(ext) {
	_ensureLoaded("extensionToId");
	return _extToId[(ext || "").toLowerCase()] || null;
}

function detectLanguageFromLessonFile(path) {
	if (!path) return null;
	_ensureLoaded("detectLanguageFromLessonFile");
	const name = String(path).replace(/\\/g, "/").split("/").pop().toLowerCase();
	const base = name.replace(/\.[^.]+$/, "");
	return base in _profiles ? base : null;
}

function lessonFileExtension(lessonFile) {
	const pid = detectLanguageFromLessonFile(lessonFile);
	if (!pid) return null;
	const exts = (_profiles[pid] || {}).extensions || [];
	return exts[0] || null;
}

function _detectRe(profile) {
	const pid = profile.id;
	if (!(pid in _compiledRe)) {
		const pat = (profile.comments || {}).detectRe;
		_compiledRe[pid] = pat ? new RegExp(pat, "g") : null;
	}
	return _compiledRe[pid];
}

const _compiledIndentRe = {};
const _compiledOpenTagRePy = {};
const _compiledVoidTagsRe = {};

function _indentRe(profile, key) {
	const cacheKey = profile.id + "::" + key;
	if (!(cacheKey in _compiledIndentRe)) {
		const pat = (profile.indent || {})[key] || "";
		_compiledIndentRe[cacheKey] = pat ? new RegExp(pat) : null;
	}
	return _compiledIndentRe[cacheKey];
}

function _openTagReFromProfile(profile) {
	const pid = profile.id;
	if (!(pid in _compiledOpenTagRePy)) {
		_compiledOpenTagRePy[pid] = profile.openTagRe
			? new RegExp(profile.openTagRe)
			: null;
	}
	return _compiledOpenTagRePy[pid];
}

function _voidTagsReFromProfile(profile) {
	const pid = profile.id;
	if (!(pid in _compiledVoidTagsRe)) {
		const tags = profile.voidTags || [];
		_compiledVoidTagsRe[pid] = tags.length
			? new RegExp(`<(${tags.join("|")})(?:\\s[^>]*)?>$`, "i")
			: null;
	}
	return _compiledVoidTagsRe[pid];
}

function shouldIncreaseAfter(profile, line) {
	if (!profile) return false;
	const pat = _indentRe(profile, "increaseAfter");
	if (pat && pat.test(line)) return true;
	const openTag = _openTagReFromProfile(profile);
	if (openTag) {
		const stripped = line.replace(/\s+$/, "");
		const voidRe = _voidTagsReFromProfile(profile);
		if (
			openTag.test(stripped) &&
			!stripped.endsWith("/>") &&
			(!voidRe || !voidRe.test(stripped))
		) {
			return true;
		}
	}
	return false;
}

function shouldDecreaseOnLine(profile, line) {
	if (!profile) return false;
	const pat = _indentRe(profile, "decreaseOnLine");
	return !!(pat && pat.test(line));
}

function shouldDecreaseAfter(profile, line) {
	if (!profile) return false;
	const pat = _indentRe(profile, "decreaseAfter");
	return !!(pat && pat.test(line));
}

const _WS_ONLY_RE = /^[ \t]*$/;
const _WS_LT_RE = /^[ \t]*<$/;

function shouldAutoDedentOnChar(profile, ch, before) {
	if (ch === "}" || ch === ")" || ch === "]") {
		return _WS_ONLY_RE.test(before);
	}
	if (profile && profile.openTagRe && ch === "/") {
		return _WS_LT_RE.test(before);
	}
	return false;
}

function _embeddedOpenRe(profile) {
	const pid = profile.id;
	if (!(pid in _compiledOpenTagRe)) {
		const tags = (profile.embeddedTags || []).map((e) => e.tag);
		_compiledOpenTagRe[pid] = tags.length
			? new RegExp(`<\\s*(${tags.join("|")})\\b[^>]*>`, "gi")
			: null;
	}
	return _compiledOpenTagRe[pid];
}

function _embeddedTagRanges(text, profile) {
	const byTag = {};
	for (const e of profile.embeddedTags || []) byTag[e.tag] = [];
	const openRe = _embeddedOpenRe(profile);
	if (!openRe) return byTag;
	openRe.lastIndex = 0;
	let om;
	while ((om = openRe.exec(text)) !== null) {
		const tag = om[1].toLowerCase();
		const innerStart = om.index + om[0].length;
		const closeRe = new RegExp(
			`<\\/\\s*${tag}\\s*>|<\\s*\\\\\\s*\\/?\\s*${tag}\\s*>|\\/\\s*${tag}\\s*>`,
			"i",
		);
		const sub = text.slice(innerStart);
		const cm = sub.match(closeRe);
		let innerEnd, nextPos;
		if (cm) {
			innerEnd = innerStart + cm.index;
			nextPos = innerEnd + cm[0].length;
		} else {
			innerEnd = text.length;
			nextPos = text.length;
		}
		(byTag[tag] = byTag[tag] || []).push([innerStart, innerEnd]);
		openRe.lastIndex = nextPos;
	}
	return byTag;
}

function _inRanges(pos, ranges) {
	for (const [lo, hi] of ranges) {
		if (lo <= pos && pos < hi) return true;
		if (pos < lo) return false;
	}
	return false;
}

function commentRangesOf(profile, text) {
	if (!profile) return [];
	const pat = _detectRe(profile);
	if (!pat) return [];
	const ranges = [];
	const embedded = profile.embeddedTags || [];
	if (embedded.length === 0) {
		pat.lastIndex = 0;
		let m;
		while ((m = pat.exec(text)) !== null) {
			ranges.push([m.index, m.index + m[0].length]);
		}
		return ranges;
	}
	const byTag = _embeddedTagRanges(text, profile);
	const scriptRanges = byTag.script || [];
	const styleRanges = byTag.style || [];
	pat.lastIndex = 0;
	let m;
	while ((m = pat.exec(text)) !== null) {
		const kind = m[0].slice(0, 2);
		const pos = m.index;
		if (kind === "//" && !_inRanges(pos, scriptRanges)) continue;
		if (
			kind === "/*" &&
			!(_inRanges(pos, styleRanges) || _inRanges(pos, scriptRanges))
		)
			continue;
		ranges.push([pos, pos + m[0].length]);
	}
	return ranges;
}

function _reEscape(s) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function _reEscapeForCharClass(s) {
	return s.replace(/[\]\\^]/g, "\\$&");
}

function _buildStringPattern(sd) {
	const open = _reEscape(sd.open);
	const close = _reEscape(sd.close);
	if (sd.escape && sd.open === sd.close && sd.open.length === 1) {
		const opEC = _reEscapeForCharClass(sd.open);
		const escEC = _reEscapeForCharClass(sd.escape);
		const escRe = _reEscape(sd.escape);
		return `${open}(?:[^${opEC}${escEC}]|${escRe}.)*${close}`;
	}
	return `${open}[\\s\\S]*?${close}`;
}

function emptyHighlightSpans() {
	return {
		hl_comment: [],
		hl_string: [],
		hl_keyword: [],
		hl_builtin: [],
		hl_number: [],
		hl_func: [],
		hl_doctype: [],
		hl_tag: [],
		hl_attr: [],
		hl_value: [],
		hl_css_sel: [],
		hl_css_prop: [],
		hl_css_num: [],
		hl_css_at: [],
	};
}

function _protect(set, lo, hi) {
	for (let i = lo; i < hi; i++) set.add(i);
}

function highlight(profile, content, offset = 0, spans = null) {
	if (!spans) spans = emptyHighlightSpans();
	if (!profile) return spans;
	const protected_ = new Set();
	const cs = profile.comments || {};

	if (cs.block) {
		const o = _reEscape(cs.block.open);
		const c = _reEscape(cs.block.close);
		const re = new RegExp(`${o}[\\s\\S]*?${c}`, "g");
		for (const m of content.matchAll(re)) {
			spans.hl_comment.push({
				start: offset + m.index,
				end: offset + m.index + m[0].length,
			});
			_protect(protected_, m.index, m.index + m[0].length);
		}
	}
	if (cs.line) {
		const l = _reEscape(cs.line);
		const re = new RegExp(`${l}[^\\n]*`, "g");
		for (const m of content.matchAll(re)) {
			if (protected_.has(m.index)) continue;
			spans.hl_comment.push({
				start: offset + m.index,
				end: offset + m.index + m[0].length,
			});
			_protect(protected_, m.index, m.index + m[0].length);
		}
	}

	for (const sd of profile.strings || []) {
		const flags = "g" + (sd.multiline ? "s" : "");
		const re = new RegExp(_buildStringPattern(sd), flags);
		for (const m of content.matchAll(re)) {
			if (protected_.has(m.index)) continue;
			spans.hl_string.push({
				start: offset + m.index,
				end: offset + m.index + m[0].length,
			});
			_protect(protected_, m.index, m.index + m[0].length);
		}
	}

	if (profile.numberRe) {
		const re = new RegExp(`\\b(?:${profile.numberRe})\\b`, "g");
		for (const m of content.matchAll(re)) {
			if (protected_.has(m.index)) continue;
			spans.hl_number.push({
				start: offset + m.index,
				end: offset + m.index + m[0].length,
			});
		}
	}

	if (profile.identifierRe) {
		const funcRe = new RegExp(`\\b(${profile.identifierRe})(?=\\s*\\()`, "g");
		for (const m of content.matchAll(funcRe)) {
			if (protected_.has(m.index)) continue;
			spans.hl_func.push({
				start: offset + m.index,
				end: offset + m.index + m[1].length,
			});
		}

		const idRe = new RegExp(`\\b${profile.identifierRe}\\b`, "g");
		const kw = new Set(profile.keywords || []);
		const bi = new Set(profile.builtins || []);
		for (const m of content.matchAll(idRe)) {
			if (protected_.has(m.index)) continue;
			const w = m[0];
			if (bi.has(w)) {
				spans.hl_builtin.push({
					start: offset + m.index,
					end: offset + m.index + w.length,
				});
			} else if (kw.has(w)) {
				spans.hl_keyword.push({
					start: offset + m.index,
					end: offset + m.index + w.length,
				});
			}
		}
	}

	return spans;
}

const _api = {
	initProfiles,
	getProfile,
	allExtensions,
	extensionToId,
	detectLanguageFromLessonFile,
	lessonFileExtension,
	commentRangesOf,
	embeddedTagRanges: (profile, text) => _embeddedTagRanges(text, profile),
	highlight,
	emptyHighlightSpans,
	shouldIncreaseAfter,
	shouldDecreaseOnLine,
	shouldDecreaseAfter,
	shouldAutoDedentOnChar,
};

if (typeof module !== "undefined" && module.exports) {
	module.exports = _api;
}
if (typeof window !== "undefined") {
	window.LanguageProfiles = _api;
}
