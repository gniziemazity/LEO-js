"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const lessonToolsDir = path.resolve(__dirname, "..", "lesson_tools");

const stub = `
"use strict";
const _stubEl = {
	style: {},
	classList: { toggle: () => {}, add: () => {}, remove: () => {}, contains: () => false },
	addEventListener: () => {},
	removeEventListener: () => {},
	appendChild: () => {},
	insertAdjacentHTML: () => {},
	innerHTML: "",
	textContent: "",
	getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
	offsetWidth: 0, offsetHeight: 0,
	querySelectorAll: () => [], querySelector: () => null,
	getAttribute: () => null, setAttribute: () => {},
	dispatchEvent: () => true,
	contains: () => false,
};
const document = {
	getElementById: () => _stubEl,
	addEventListener: () => {},
	removeEventListener: () => {},
	createElement: () => Object.create(_stubEl),
	body: _stubEl,
};
const window = {
	addEventListener: () => {},
	removeEventListener: () => {},
	location: { search: "" },
	getComputedStyle: () => ({ background: "", color: "", font: "" }),
	devicePixelRatio: 1,
	innerWidth: 1024, innerHeight: 768,
};
const THEME = {
	codeMuted: "#aaa", black: "#000", bg: "#fff", muted: "#888",
	ghostPair: "#888", textStrong: "#222", textFaint: "#888",
	chartBg: "#fff", chartGrid: "#eee", label: "#888",
	blue: "#007acc", orange: "#e07020", green: "#66bb6a", purple: "#8e44ad",
	red: "#cc2222", gray: "#222", paleRed: "#cc2222",
	chartAxisLine: "#ccc", chartAxisText: "#555", chartAxisTick: "#aaa",
	chartKpmActive: "#000", chartKpmSession: "#888",
	chartCumulative: "#cccccc", chartCumulativeFill: "rgba(204,204,204,0.3)",
	chartInsertMarker: "#999", chartDotMutedFill: "#a8a8a8", chartDotMutedStroke: "#777",
	barTrack: "#eee", neg: "#cc2222",
};
const MARK_COLORS = { missing: "#cc2222", extra: "#000", ghost_extra: "#888", comment: "#66bb6a" };
const LANG_COLORS = { html: "#cc2222", htm: "#cc2222", css: "#007acc", js: "#e07020", py: "#8e44ad" };
const ASSIGNMENTS = [];
function _hexToRgba() { return ""; }
function _cssVar() { return ""; }
function escHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function escAttr(s) { return escHtml(s); }
function langColorFor() { return null; }
function markColorFor() { return null; }
function openDifferentiator() {}
function openDifferentiatorWindow() {}
function showLoading() {}
function readFileText() { return Promise.resolve(""); }
function readFileDataUri() { return Promise.resolve(""); }
function readFileArray() { return Promise.resolve(new Uint8Array()); }
function readDirHandle() { return Promise.resolve(); }
function parseCsv() { return { header: [], rows: [], delim: "," }; }
function getFileExt() { return ""; }
function pickFolderWithMemory() { return Promise.resolve(null); }
function pickFilesWithMemory() { return Promise.resolve([]); }
function loadSavedDirHandle() { return Promise.resolve(null); }
function waitForXlsxBundle() { return Promise.resolve(); }
function parseStudentIdNameMap() { return {}; }
function parseAlterEgoMap() { return {}; }
function makeDraggable() {}
function newTokenRegex() { return /[a-zA-Z0-9]+|[^\\s]/gu; }
function parseFollowEvents() { return []; }
function parseFollowLabel() { return null; }
function _idbOpen() { return Promise.resolve(null); }
function _idbGet() { return Promise.resolve(null); }
function _idbSet() { return Promise.resolve(); }
const DIFF_MARKS_FILES = {};
const CURATED_MODES = new Set();
function diffModeFromFilename() { return null; }
function defaultDiffModeKey() { return null; }
function lowerBound(a, v, k) {
	let lo = 0, hi = a.length;
	while (lo < hi) { const m = (lo + hi) >> 1; if (k(a[m]) < v) lo = m + 1; else hi = m; }
	return lo;
}
function upperBound(a, v, k) {
	let lo = 0, hi = a.length;
	while (lo < hi) { const m = (lo + hi) >> 1; if (k(a[m]) <= v) lo = m + 1; else hi = m; }
	return lo;
}
function _isMistakeEvent() { return false; }
function _langBarColorOf() { return null; }
function _langClassFor() { return ""; }
function studentY() { return 0; }
`;

function loadAPI() {
	const cfgSrc = fs.readFileSync(
		path.join(lessonToolsDir, "timeline/config.js"),
		"utf-8",
	);
	const modelSrc = fs.readFileSync(
		path.join(lessonToolsDir, "shared/simulator-model.js"),
		"utf-8",
	);
	const utilsSrc = fs.readFileSync(
		path.join(lessonToolsDir, "shared/timeline-utils.js"),
		"utf-8",
	);
	const tooltipSrc = fs.readFileSync(
		path.join(lessonToolsDir, "timeline/tooltip.js"),
		"utf-8",
	);
	const burstSrc = fs.readFileSync(
		path.join(lessonToolsDir, "timeline/burst-deco.js"),
		"utf-8",
	);
	const bundle =
		stub +
		"\n" +
		modelSrc +
		"\n" +
		cfgSrc +
		"\n" +
		utilsSrc +
		"\n" +
		tooltipSrc +
		"\n" +
		burstSrc;
	return new Function(`
		${bundle}
		return { _computeBurstDecorations, _isInsertableChar, _displayCodeInsert };
	`)();
}

const api = loadAPI();

function makeReplay({
	files = {},
	commentRanges = {},
	tsToPositions = {},
} = {}) {
	return {
		files: new Map(
			Object.entries(files).map(([name, text]) => [name, { text }]),
		),
		commentRangesByFile: new Map(Object.entries(commentRanges)),
		tsToPos: new Map(
			Object.entries(tsToPositions).map(([ts, hits]) => [Number(ts), hits]),
		),
	};
}

test("_isInsertableChar: cursor moves (including PgUp ▲) excluded", () => {
	assert.equal(api._isInsertableChar("a"), true);
	assert.equal(api._isInsertableChar("\n"), true);
	assert.equal(api._isInsertableChar("←"), false); // ←
	assert.equal(api._isInsertableChar("→"), false); // →
	assert.equal(api._isInsertableChar("↑"), false); // ↑
	assert.equal(api._isInsertableChar("↓"), false); // ↓
	assert.equal(api._isInsertableChar("▲"), false); // ▲ (PgUp via CURSOR_MOVES)
	assert.equal(api._isInsertableChar("▼"), false); // ▼ (PgDown via CURSOR_MOVES)
	assert.equal(api._isInsertableChar("⌫"), false); // ⌫ backspace (DELETE_CHARS)
});

test("_displayCodeInsert: strips anchors + converts ↩", () => {
	assert.equal(api._displayCodeInsert("a⚓anchor1⚓b"), "ab");
	assert.equal(api._displayCodeInsert("a↩b"), "a\nb"); // ↩
});

test("code-insert ghost: entire payload deleted → all insertable offsets marked ghost", () => {
	const parts = [{ type: "code_insert", t: "abc" }];
	const evs = [{ timestamp: 100, code_insert: "abc" }];
	const replay = makeReplay({
		files: { "f.css": "xyz" }, // file doesn't contain "abc"
		tsToPositions: { 100: [] }, // no positions for this ts (chars never survived)
	});
	const deco = api._computeBurstDecorations(parts, evs, replay);
	const ghost = deco.ghostInserts.get(0) || new Set();
	assert.deepEqual(
		[...ghost].sort((a, b) => a - b),
		[0, 1, 2],
	);
	assert.equal(deco.commentInserts.has(0), false);
});

test("code-insert ghost: middle line deleted → LCS leaves only that line unmatched", () => {
	// Display: "abc\nXYZ\ndef" — middle "XYZ" deleted; "abc" and "def" survive.
	const text = "abc\nXYZ\ndef";
	const parts = [{ type: "code_insert", t: text }];
	const evs = [{ timestamp: 200, code_insert: text }];
	const fileText = "abc\ndef";
	const replay = makeReplay({
		files: { "f.css": fileText },
		tsToPositions: {
			200: [...fileText].map((_, i) => ({ file: "f.css", pos: i })),
		},
	});
	const deco = api._computeBurstDecorations(parts, evs, replay);
	const ghost = deco.ghostInserts.get(0) || new Set();
	// 4 chars are ghost: 'X', 'Y', 'Z', and exactly one of the two '\n's
	// (LCS has two equally-good tracebacks for the newline pair).
	assert.equal(ghost.size, 4);
	assert.ok(ghost.has(4)); // X
	assert.ok(ghost.has(5)); // Y
	assert.ok(ghost.has(6)); // Z
	assert.ok(ghost.has(3) || ghost.has(7)); // one of the newlines
});

test("code-insert ghost: duplicate chars across deleted/surviving regions (the wall-lesson case)", () => {
	// Display: "height\nbg\nwidth" — middle line "bg" deleted; height + width survive.
	// "height" and "width" share chars 'h','i','t' — FIFO would mis-attribute, LCS won't.
	const text = "height\nbg\nwidth";
	const parts = [{ type: "code_insert", t: text }];
	const evs = [{ timestamp: 300, code_insert: text }];
	const fileText = "height\nwidth";
	const replay = makeReplay({
		files: { "f.css": fileText },
		tsToPositions: {
			300: [...fileText].map((_, i) => ({ file: "f.css", pos: i })),
		},
	});
	const deco = api._computeBurstDecorations(parts, evs, replay);
	const ghost = deco.ghostInserts.get(0) || new Set();
	// 3 chars ghost: 'b', 'g', and exactly one of the two '\n's.
	assert.equal(ghost.size, 3);
	assert.ok(ghost.has(7)); // 'b'
	assert.ok(ghost.has(8)); // 'g'
	assert.ok(ghost.has(6) || ghost.has(9)); // one newline
	// Confirm width's chars (10-14) are NOT ghost — the key wall-lesson regression check.
	for (const k of [10, 11, 12, 13, 14]) assert.ok(!ghost.has(k));
});

test("code-insert comment: per-char (chars whose final position lands in comment range)", () => {
	// Display: "abc". Final file is "ab/*c*/" → 'a' at 0, 'b' at 1, 'c' at 4 (inside comment).
	const text = "abc";
	const parts = [{ type: "code_insert", t: text }];
	const evs = [{ timestamp: 400, code_insert: text }];
	const fileText = "ab/*c*/";
	const replay = makeReplay({
		files: { "f.css": fileText },
		tsToPositions: {
			400: [
				{ file: "f.css", pos: 0 },
				{ file: "f.css", pos: 1 },
				{ file: "f.css", pos: 4 },
			],
		},
		commentRanges: { "f.css": [[2, 7]] }, // single range [2, 7)
	});
	const deco = api._computeBurstDecorations(parts, evs, replay);
	const comment = deco.commentInserts.get(0) || new Set();
	const ghost = deco.ghostInserts.get(0) || new Set();
	assert.deepEqual(
		[...comment].sort((a, b) => a - b),
		[2],
	); // only 'c'
	assert.equal(ghost.size, 0);
});

test("code-insert comment: full payload inside a comment range marks all chars", () => {
	// Display: "ab". Final file is "/*ab*/" — both chars inside comment.
	const text = "ab";
	const parts = [{ type: "code_insert", t: text }];
	const evs = [{ timestamp: 500, code_insert: text }];
	const fileText = "/*ab*/";
	const replay = makeReplay({
		files: { "f.css": fileText },
		tsToPositions: {
			500: [
				{ file: "f.css", pos: 2 },
				{ file: "f.css", pos: 3 },
			],
		},
		commentRanges: { "f.css": [[0, 6]] },
	});
	const deco = api._computeBurstDecorations(parts, evs, replay);
	const comment = deco.commentInserts.get(0) || new Set();
	assert.ok(comment.has(0));
	assert.ok(comment.has(1));
});

test("code-insert comment: no false-positive when only some survivor positions are in comment", () => {
	// Display: "border". Final file is "/* bo */ rder" — only 'b','o' positions are in comment,
	// 'r','d','e','r' are outside. With per-char comment marking, only 'b','o' are tagged.
	// (This is the "bor green" case from the wall lesson.)
	const text = "border";
	const parts = [{ type: "code_insert", t: text }];
	const evs = [{ timestamp: 600, code_insert: text }];
	const fileText = "/* bo */ rder";
	// Map display chars to positions in fileText:
	//   b → pos 3, o → pos 4, r → pos 9, d → pos 10, e → pos 11, r → pos 12
	const replay = makeReplay({
		files: { "f.css": fileText },
		tsToPositions: {
			600: [
				{ file: "f.css", pos: 3 },
				{ file: "f.css", pos: 4 },
				{ file: "f.css", pos: 9 },
				{ file: "f.css", pos: 10 },
				{ file: "f.css", pos: 11 },
				{ file: "f.css", pos: 12 },
			],
		},
		commentRanges: { "f.css": [[0, 8]] }, // [0, 8) — covers '/* bo */'
	});
	const deco = api._computeBurstDecorations(parts, evs, replay);
	const comment = deco.commentInserts.get(0) || new Set();
	assert.deepEqual(
		[...comment].sort((a, b) => a - b),
		[0, 1],
	); // 'b','o' only
});

test("code-insert ghost+comment: cursor-char (←) in display does not get marked ghost", () => {
	// Display contains a cursor char that should be skipped by _isInsertableChar.
	const text = "ab←cd"; // "ab←cd"
	const parts = [{ type: "code_insert", t: text }];
	const evs = [{ timestamp: 700, code_insert: text }];
	const fileText = "abcd"; // cursor move doesn't write a position
	const replay = makeReplay({
		files: { "f.css": fileText },
		tsToPositions: {
			700: [
				{ file: "f.css", pos: 0 },
				{ file: "f.css", pos: 1 },
				{ file: "f.css", pos: 2 },
				{ file: "f.css", pos: 3 },
			],
		},
	});
	const deco = api._computeBurstDecorations(parts, evs, replay);
	const ghost = deco.ghostInserts.get(0) || new Set();
	assert.equal(ghost.size, 0); // cursor offset 2 is skipped (not insertable), no ghosts
});

test("code-insert all four chars unmatched but cursor-char in middle is not ghost", () => {
	// Display: "x←y" but file has no surviving x/y. Cursor should still be skipped.
	const text = "x←y";
	const parts = [{ type: "code_insert", t: text }];
	const evs = [{ timestamp: 800, code_insert: text }];
	const replay = makeReplay({
		files: { "f.css": "" },
		tsToPositions: { 800: [] },
	});
	const deco = api._computeBurstDecorations(parts, evs, replay);
	const ghost = deco.ghostInserts.get(0) || new Set();
	// Only display offsets 0 ('x') and 2 ('y') should be ghost; offset 1 (←) is skipped.
	assert.deepEqual(
		[...ghost].sort((a, b) => a - b),
		[0, 2],
	);
});
