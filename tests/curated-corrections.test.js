"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const dir = path.resolve(__dirname, "..", "lesson_tools");

const stub = `
"use strict";
let _teacherFiles = {};
let _studentFiles = {};
let _curatedWorking = {};
let _diffMode = "ideal";
let _curatedFloatWin = null;
let __rows = [];
const _curatedTokenCache = new Map();
const _curatedCommentRangeCache = new Map();
function _curatedWorkingKey() { return _diffMode === "required" ? "required" : "ideal"; }
function _curatedEnsureButtons() {}
function newTokenRegex() { return /[a-zA-Z0-9]+|[^\\s]/g; }
function getFileExt(n) { const m = String(n).toLowerCase().match(/\\.([^.]+)$/); return m ? m[1] : ""; }
function _diffCommentRanges() { return []; }
function _curatedIsCommentPos() { return false; }
function escHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function escAttr(s) { return escHtml(s); }
function makeDraggable() {}
function FakeEl() { this._html = ""; this.style = {}; this.dataset = {}; this.classList = { add() {}, remove() {}, contains() { return false; } }; }
FakeEl.prototype.appendChild = function () {};
FakeEl.prototype.addEventListener = function () {};
FakeEl.prototype.querySelectorAll = function () { return []; };
FakeEl.prototype.insertAdjacentHTML = function (pos, html) { __rows.push(html); this._html += html; };
Object.defineProperty(FakeEl.prototype, "className", { set() {}, get() { return ""; } });
Object.defineProperty(FakeEl.prototype, "textContent", { set() {}, get() { return ""; } });
Object.defineProperty(FakeEl.prototype, "innerHTML", { set() {}, get() { return ""; } });
const document = { createElement: () => new FakeEl(), getElementById: () => null, body: new FakeEl() };
const window = { addEventListener() {} };
function __setState(teacher, student, marks, mode) {
	_teacherFiles = teacher;
	_studentFiles = student;
	_curatedWorking = marks;
	_diffMode = mode || "ideal";
	_curatedTokenCache.clear();
	_curatedCommentRangeCache.clear();
	_curatedFloatWin = null;
	__rows = [];
}
function __getRows() { return __rows; }
`;

function loadAPI() {
	const model = fs.readFileSync(
		path.join(dir, "differentiator/curated-model.js"),
		"utf-8",
	);
	const io = fs.readFileSync(
		path.join(dir, "differentiator/curated-io.js"),
		"utf-8",
	);
	const apply = fs.readFileSync(
		path.join(dir, "differentiator/curated-apply.js"),
		"utf-8",
	);
	const floatwin = fs.readFileSync(
		path.join(dir, "differentiator/curated-floatwin.js"),
		"utf-8",
	);
	return new Function(`
		${stub}
		${model}
		${io}
		${apply}
		${floatwin}
		return {
			_curatedApplyToStudent,
			_curatedCleanupCorrectedText,
			_curatedReindent,
			_curatedChangedGroups,
			_curatedMarkedToHtml,
			_curatedDedentSnippet,
			_curatedStudentLineMap,
			_curatedMarkedToSegLines,
			_curatedCorrectionsData,
			__setState,
			__getRows,
		};
	`)();
}

const api = loadAPI();

function applyPath({ teacher, student, marks, file, mode = "ideal" }) {
	api.__setState(teacher, student, { [mode]: marks }, mode);
	return api._curatedApplyToStudent()[file];
}

const norm = (s) => api._curatedCleanupCorrectedText(s);

const _realLP = require(path.join(dir, "languages", "profiles.js"));
const _loadProf = (id) => {
	const p = JSON.parse(
		fs.readFileSync(path.join(dir, "languages", id + ".json"), "utf-8"),
	);
	p.id = id;
	return p;
};
const reindentLP = {
	getProfile: (id) =>
		({ html: 1, css: 1, javascript: 1 })[id] ? _loadProf(id) : null,
	shouldIncreaseAfter: _realLP.shouldIncreaseAfter,
	shouldDecreaseOnLine: _realLP.shouldDecreaseOnLine,
	shouldDecreaseAfter: _realLP.shouldDecreaseAfter,
};
const _indentOf = (l) => (l.match(/^\t*/) || [""])[0].length;

test("reindent normalizes HTML + embedded CSS nesting", () => {
	const src =
		"<html>\n<head>\n<style>\n.a {\nmargin: 0;\n}\n</style>\n</head>\n</html>";
	const lines = api._curatedReindent(src, "html", reindentLP).split("\n");
	const find = (s) => lines.find((l) => l.includes(s));
	assert.equal(_indentOf(find("<head>")), 1, "<head> at depth 1");
	assert.equal(_indentOf(find("<style>")), 2, "<style> at depth 2");
	assert.equal(_indentOf(find(".a {")), 3, ".a { at depth 3");
	assert.equal(_indentOf(find("margin: 0;")), 4, "margin at depth 4");
	assert.equal(_indentOf(find("</style>")), 2, "</style> back to depth 2");
});

test("reindent preserves insertion markers and ignores them for depth", () => {
	const OPEN = String.fromCharCode(0xe000);
	const CLOSE = String.fromCharCode(0xe001);
	const src = "<div>\n" + OPEN + "<p>x</p>" + CLOSE + "\n</div>";
	const out = api._curatedReindent(src, "html", reindentLP);
	assert.ok(out.includes(OPEN) && out.includes(CLOSE), "markers preserved");
	const pLine = out.split("\n").find((l) => l.includes("<p>"));
	assert.equal(
		_indentOf(pLine),
		1,
		"<p> indented inside <div> despite the marker",
	);
});

test("reindent strips deletion-marker content for depth, keeps the marker", () => {
	const DO = String.fromCharCode(0xe002);
	const DC = String.fromCharCode(0xe003);
	// a deleted "{" must not increase the indent of the next line
	const src = "a" + DO + "{" + DC + "\nb";
	const out = api._curatedReindent(src, "css", reindentLP);
	const lines = out.split("\n");
	assert.equal(_indentOf(lines[1]), 0, "deleted { does not increase indent");
	assert.ok(out.includes(DO) && out.includes(DC), "deletion marker preserved");
});

test("reindent collapses consecutive blank lines", () => {
	const src = "<div>\n\n\n\n<p>x</p>\n</div>";
	const out = api._curatedReindent(src, "html", reindentLP);
	assert.ok(
		!/\n\n\n/.test(out),
		"blank-line runs collapsed: " + JSON.stringify(out),
	);
	assert.ok(/\n\n/.test(out), "a single blank line is kept");
});

test("changed-line groups merge across small gaps, split on large ones", () => {
	const c = (n) => String.fromCharCode(n);
	const ins = (s) => c(0xe000) + s + c(0xe001);
	const lines = [
		"a" + ins("x"), // 0 changed
		"b", // 1 unchanged (gap 1)
		"c" + ins("y"), // 2 changed -> merges with 0
		"d", // 3
		"e", // 4
		"f" + ins("z"), // 5 changed -> separate (gap 2)
	];
	assert.deepEqual(api._curatedChangedGroups(lines), [
		[0, 2],
		[5, 5],
	]);
});

test("changed-line groups span multi-line insertions", () => {
	const c = (n) => String.fromCharCode(n);
	const lines = [
		"x", // 0 unchanged
		"}" + c(0xe000), // 1 insertion opens
		".a {", // 2 inside (no marker)
		"\tb: 1;", // 3 inside
		"}" + c(0xe001), // 4 insertion closes
		"y", // 5 unchanged
	];
	assert.deepEqual(api._curatedChangedGroups(lines), [[1, 4]]);
});

test("student-line map: insertions don't advance, deletions do", () => {
	const c = (n) => String.fromCharCode(n);
	const marked = "a\n" + c(0xe000) + "X\nY" + c(0xe001) + "b\nc";
	assert.deepEqual(api._curatedStudentLineMap(marked), [1, 2, 2, 3]);
});

test("student-line map: deleted content counts toward student lines", () => {
	const c = (n) => String.fromCharCode(n);
	const marked = "a\n" + c(0xe002) + "XX" + c(0xe004) + c(0xe003) + "b";
	assert.deepEqual(api._curatedStudentLineMap(marked), [1, 2]);
});

test("marked-to-seglines tokenizes insertions, deletions, and newlines", () => {
	const c = (n) => String.fromCharCode(n);
	const marked =
		"a" +
		c(0xe000) +
		"I" +
		c(0xe001) +
		c(0xe002) +
		"D" +
		c(0xe004) +
		"E" +
		c(0xe003) +
		"b";
	assert.deepEqual(api._curatedMarkedToSegLines(marked), [
		[
			{ text: "a", style: "normal" },
			{ text: "I", style: "ins" },
			{ text: "D", style: "del" },
		],
		[
			{ text: "E", style: "del" },
			{ text: "b", style: "normal" },
		],
	]);
});

test("snippet dedent removes common indent so content touches the left", () => {
	const src = "\t\t\t.a {\n\t\t\t\tx: 1;\n\t\t\t}";
	assert.equal(api._curatedDedentSnippet(src), ".a {\n\tx: 1;\n}");
});

test("marked-to-html renders insertions blue and deletions struck red", () => {
	const c = (n) => String.fromCharCode(n);
	const text =
		"a" + c(0xe000) + "ins" + c(0xe001) + "b" + c(0xe002) + "del" + c(0xe003);
	const html = api._curatedMarkedToHtml(text);
	assert.ok(
		html.includes('<span class="tw-ins">ins</span>'),
		"insertion span",
	);
	assert.ok(html.includes('<span class="tw-del">del</span>'), "deletion span");
	const hasMarker = [...html].some((ch) => {
		const cp = ch.codePointAt(0);
		return cp >= 0xe000 && cp <= 0xe004;
	});
	assert.ok(!hasMarker, "no raw markers remain");
});

test("reindent leaves non-brace languages (python) untouched", () => {
	const src = "def f():\n        return 1";
	assert.equal(api._curatedReindent(src, "py", reindentLP), src);
});

test("apply mark option wraps insertions for the colored preview", () => {
	const OPEN = String.fromCharCode(0xe000);
	const CLOSE = String.fromCharCode(0xe001);
	const student = { "f.css": ".a{}" };
	const teacher = { "f.css": ".a{}\n\t\t\t.b{}" };
	const marks = {
		token_matching: "ideal",
		teacher_files: {
			"f.css": [
				{
					token: ".",
					label: "missing",
					start: 8,
					end: 9,
					insert_at: { file: "f.css", pos: 4 },
				},
				{
					token: "b",
					label: "missing",
					start: 9,
					end: 10,
					insert_at: { file: "f.css", pos: 4 },
				},
				{
					token: "{",
					label: "missing",
					start: 10,
					end: 11,
					insert_at: { file: "f.css", pos: 4 },
				},
				{
					token: "}",
					label: "missing",
					start: 11,
					end: 12,
					insert_at: { file: "f.css", pos: 4 },
				},
			],
		},
		student_files: { "f.css": [] },
	};
	api.__setState(teacher, student, { ideal: marks }, "ideal");
	const marked = api._curatedApplyToStudent({ mark: true });
	api.__setState(teacher, student, { ideal: marks }, "ideal");
	const plain = api._curatedApplyToStudent();
	assert.ok(marked["f.css"].includes(OPEN), "marked output wraps insertions");
	assert.ok(!plain["f.css"].includes(OPEN), "plain output has no sentinel");
	assert.equal(
		marked["f.css"].split(OPEN).join("").split(CLOSE).join(""),
		plain["f.css"],
		"marked minus sentinels equals plain (preview text unchanged)",
	);
});

test("apply mark option wraps deletions with the removed text", () => {
	const DOPEN = String.fromCharCode(0xe002);
	const DCLOSE = String.fromCharCode(0xe003);
	const student = { "f.css": ".a{x}" };
	const teacher = { "f.css": ".a{}" };
	const marks = {
		token_matching: "ideal",
		teacher_files: { "f.css": [] },
		student_files: {
			"f.css": [{ token: "x", label: "extra", start: 3, end: 4 }],
		},
	};
	api.__setState(teacher, student, { ideal: marks }, "ideal");
	const marked = api._curatedApplyToStudent({ mark: true });
	api.__setState(teacher, student, { ideal: marks }, "ideal");
	const plain = api._curatedApplyToStudent();
	assert.ok(
		marked["f.css"].includes(DOPEN + "x" + DCLOSE),
		"deletion marker wraps the removed token",
	);
	assert.ok(!plain["f.css"].includes(DOPEN), "plain output has no marker");
	assert.ok(!plain["f.css"].includes("x"), "plain output removes the token");
});

test("adjacent extras + inline insert: no stray space survives the gap", () => {
	const student = { "f.js": "a.replace Children(x);" };
	const teacher = { "f.js": "a.replaceChildren(x);" };
	const sChildren = student["f.js"].indexOf("Children"); // 10
	const marks = {
		token_matching: "ideal",
		teacher_files: {
			"f.js": [
				{
					token: "replaceChildren",
					label: "missing",
					start: 2,
					end: 17,
					insert_at: { file: "f.js", pos: sChildren },
				},
			],
		},
		student_files: {
			"f.js": [
				{ token: "replace", label: "extra", start: 2, end: 9 },
				{ token: "Children", label: "extra", start: 10, end: 18 },
			],
		},
	};
	const apply = applyPath({
		teacher,
		student,
		marks,
		file: "f.js",
	});
	const expected = "a.replaceChildren(x);";
	assert.equal(norm(apply), expected, "apply path");
});

test("inline missing-insert does not add a spurious blank line", () => {
	const student = { "f.js": "const selectedpiece = null;" };
	const teacher = { "f.js": "\tlet selectedPiece = null;" };
	const marks = {
		token_matching: "ideal",
		teacher_files: {
			"f.js": [
				{
					token: "let",
					label: "missing",
					start: 1,
					end: 4,
					insert_at: { file: "f.js", pos: 5 },
				},
				{
					token: "selectedPiece",
					label: "missing",
					start: 5,
					end: 18,
					paired_with: {
						file: "f.js",
						start: 6,
						end: 19,
						token: "selectedpiece",
						label: "extra",
					},
				},
			],
		},
		student_files: {
			"f.js": [
				{ token: "const", label: "extra", start: 0, end: 5 },
				{
					token: "selectedpiece",
					label: "extra",
					start: 6,
					end: 19,
					paired_with: {
						file: "f.js",
						start: 5,
						end: 18,
						token: "selectedPiece",
						label: "missing",
					},
				},
			],
		},
	};
	const apply = applyPath({
		teacher,
		student,
		marks,
		file: "f.js",
	});
	const expected = "let selectedPiece = null;";
	assert.equal(norm(apply), expected, "apply path");
});

test("group<->group swap removes all extras and inserts the missing block", () => {
	const teacher = { "f.js": "X foo bar Y" };
	const student = { "f.js": "A old1 old2 B" };
	const marks = {
		token_matching: "ideal",
		teacher_files: {
			"f.js": [
				{
					token: "foo",
					label: "missing",
					start: 2,
					end: 5,
					paired_with: {
						file: "f.js",
						start: 2,
						end: 11,
						token: "old1old2",
						label: "extra",
					},
				},
				{
					token: "bar",
					label: "missing",
					start: 6,
					end: 9,
					paired_with: {
						file: "f.js",
						start: 2,
						end: 11,
						token: "old1old2",
						label: "extra",
					},
				},
			],
		},
		student_files: {
			"f.js": [
				{
					token: "old1",
					label: "extra",
					start: 2,
					end: 6,
					paired_with: {
						file: "f.js",
						start: 2,
						end: 9,
						token: "foobar",
						label: "missing",
					},
				},
				{
					token: "old2",
					label: "extra",
					start: 7,
					end: 11,
					paired_with: {
						file: "f.js",
						start: 2,
						end: 9,
						token: "foobar",
						label: "missing",
					},
				},
			],
		},
	};
	api.__setState(teacher, student, { ideal: marks }, "ideal");
	const out = api._curatedApplyToStudent();
	assert.equal(norm(out["f.js"]), "A foo bar B");
});

test("_curatedCleanupCorrectedText collapses runs and trims blank lines", () => {
	assert.equal(
		api._curatedCleanupCorrectedText("\n\n  a   b  \n\n"),
		"  a b ",
	);
	assert.equal(api._curatedCleanupCorrectedText("x();\n\n\n"), "x();");
	assert.equal(api._curatedCleanupCorrectedText("\n\nx();"), "x();");
	assert.equal(
		api._curatedCleanupCorrectedText("    foo  bar"),
		"    foo bar",
	);
});

test("missing word-token insert keeps a space before a surviving word-char", () => {
	const student = { "f.html": '<div class="cell dark"></div>' };
	const teacher = { "f.html": '<div class="cell dark left-offset"></div>' };
	const insPos = student["f.html"].indexOf('"></div>');
	const tLeft = teacher["f.html"].indexOf("left");
	const marks = {
		token_matching: "ideal",
		teacher_files: {
			"f.html": [
				{
					token: "left",
					label: "missing",
					start: tLeft,
					end: tLeft + 4,
					insert_at: { file: "f.html", pos: insPos },
				},
				{
					token: "-",
					label: "missing",
					start: tLeft + 4,
					end: tLeft + 5,
					insert_at: { file: "f.html", pos: insPos },
				},
				{
					token: "offset",
					label: "missing",
					start: tLeft + 5,
					end: tLeft + 11,
					insert_at: { file: "f.html", pos: insPos },
				},
			],
		},
		student_files: { "f.html": [] },
	};
	const apply = applyPath({
		teacher,
		student,
		marks,
		file: "f.html",
	});
	const expected = '<div class="cell dark left-offset"></div>';
	assert.equal(norm(apply), expected, "apply path");
});

test("missing tokens on their own line keep the line break", () => {
	const student = { "f.css": "a{}" };
	const teacher = { "f.css": "a{}\nb{}" };
	const marks = {
		token_matching: "ideal",
		teacher_files: {
			"f.css": [
				{
					token: "b",
					label: "missing",
					start: 4,
					end: 5,
					insert_at: { file: "f.css", pos: 3 },
				},
				{
					token: "{",
					label: "missing",
					start: 5,
					end: 6,
					insert_at: { file: "f.css", pos: 3 },
				},
				{
					token: "}",
					label: "missing",
					start: 6,
					end: 7,
					insert_at: { file: "f.css", pos: 3 },
				},
			],
		},
		student_files: { "f.css": [] },
	};
	const apply = applyPath({
		teacher,
		student,
		marks,
		file: "f.css",
	});
	const expected = "a{}\nb{}";
	assert.equal(norm(apply), expected, "apply path");
});

test("missing indented block: apply keeps teacher indent", () => {
	const student = { "f.css": ".a{}" };
	const teacher = { "f.css": ".a{}\n\t\t\t.b{\n\t\t\t\tx:1;\n\t\t\t}" };
	const marks = {
		token_matching: "ideal",
		teacher_files: {
			"f.css": [
				{
					token: ".",
					label: "missing",
					start: 8,
					end: 9,
					insert_at: { file: "f.css", pos: 4 },
				},
				{
					token: "b",
					label: "missing",
					start: 9,
					end: 10,
					insert_at: { file: "f.css", pos: 4 },
				},
				{
					token: "{",
					label: "missing",
					start: 10,
					end: 11,
					insert_at: { file: "f.css", pos: 4 },
				},
				{
					token: "x",
					label: "missing",
					start: 16,
					end: 17,
					insert_at: { file: "f.css", pos: 4 },
				},
				{
					token: ":",
					label: "missing",
					start: 17,
					end: 18,
					insert_at: { file: "f.css", pos: 4 },
				},
				{
					token: "1",
					label: "missing",
					start: 18,
					end: 19,
					insert_at: { file: "f.css", pos: 4 },
				},
				{
					token: ";",
					label: "missing",
					start: 19,
					end: 20,
					insert_at: { file: "f.css", pos: 4 },
				},
				{
					token: "}",
					label: "missing",
					start: 24,
					end: 25,
					insert_at: { file: "f.css", pos: 4 },
				},
			],
		},
		student_files: { "f.css": [] },
	};
	const apply = applyPath({
		teacher,
		student,
		marks,
		file: "f.css",
	});
	assert.match(apply, /\t\t\t\.b\{/, "apply keeps teacher indent (preview)");
});

test("missing block insert: apply keeps teacher indent", () => {
	const student = { "f.css": ".a{}" };
	const teacher = { "f.css": ".a{}\n\t\t\t.b{}" };
	const marks = {
		token_matching: "ideal",
		teacher_files: {
			"f.css": [
				{
					token: ".",
					label: "missing",
					start: 8,
					end: 9,
					insert_at: { file: "f.css", pos: 4 },
				},
				{
					token: "b",
					label: "missing",
					start: 9,
					end: 10,
					insert_at: { file: "f.css", pos: 4 },
				},
				{
					token: "{",
					label: "missing",
					start: 10,
					end: 11,
					insert_at: { file: "f.css", pos: 4 },
				},
				{
					token: "}",
					label: "missing",
					start: 11,
					end: 12,
					insert_at: { file: "f.css", pos: 4 },
				},
			],
		},
		student_files: { "f.css": [] },
	};
	const apply = applyPath({
		teacher,
		student,
		marks,
		file: "f.css",
	});
	assert.match(apply, /\t\t\t\.b\{\}/, "apply keeps teacher indent (preview)");
});

test("missing multi-line block at line-start uses student indent, not teacher's", () => {
	const student = { "f.css": ".a{}\n" };
	const teacher = { "f.css": ".a{}\n\t\t\tb{\n}" };
	const marks = {
		token_matching: "ideal",
		teacher_files: {
			"f.css": [
				{
					token: "b",
					label: "missing",
					start: 8,
					end: 9,
					insert_at: { file: "f.css", pos: 5 },
				},
				{
					token: "{",
					label: "missing",
					start: 9,
					end: 10,
					insert_at: { file: "f.css", pos: 5 },
				},
				{
					token: "}",
					label: "missing",
					start: 11,
					end: 12,
					insert_at: { file: "f.css", pos: 5 },
				},
			],
		},
		student_files: { "f.css": [] },
	};
	const apply = applyPath({
		teacher,
		student,
		marks,
		file: "f.css",
	});
	assert.ok(
		!apply.includes("\t\t\t"),
		"apply has teacher indent: " + JSON.stringify(apply),
	);
});

test("stray whitespace: apply keeps it (preview)", () => {
	const student = { "f.css": ".a{}\n        " };
	const teacher = { "f.css": ".a{}\n        b{\n}" };
	const marks = {
		token_matching: "ideal",
		teacher_files: {
			"f.css": [
				{
					token: "b",
					label: "missing",
					start: 13,
					end: 14,
					insert_at: { file: "f.css", pos: 13 },
				},
				{
					token: "{",
					label: "missing",
					start: 14,
					end: 15,
					insert_at: { file: "f.css", pos: 13 },
				},
				{
					token: "}",
					label: "missing",
					start: 16,
					end: 17,
					insert_at: { file: "f.css", pos: 13 },
				},
			],
		},
		student_files: { "f.css": [] },
	};
	const apply = applyPath({
		teacher,
		student,
		marks,
		file: "f.css",
	});
	assert.ok(
		/ {8}b/.test(apply),
		"apply keeps stray indent (preview): " + JSON.stringify(apply),
	);
});
