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
	const summary = fs.readFileSync(
		path.join(dir, "differentiator/curated-summary.js"),
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
		${summary}
		${floatwin}
		return {
			_curatedApplyToStudent,
			_curatedSummarize,
			_curatedCleanupCorrectedText,
			__setState,
			__getRows,
		};
	`)();
}

const api = loadAPI();

function stripTags(html) {
	return html
		.replace(/<[^>]*>/g, "")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&");
}

function summaryAfterText(rows) {
	const out = [];
	for (const r of rows) {
		const m = r.match(/<div class="tw-mid">[\s\S]*?<\/div>([\s\S]*)$/);
		if (!m) continue;
		out.push(stripTags(m[1]));
	}
	return out.join("\n");
}

function bothPaths({ teacher, student, marks, file, mode = "ideal" }) {
	api.__setState(teacher, student, { [mode]: marks }, mode);
	const applyOut = api._curatedApplyToStudent();
	api.__setState(teacher, student, { [mode]: marks }, mode);
	api._curatedSummarize();
	const summary = summaryAfterText(api.__getRows());
	return { apply: applyOut[file], summary };
}

const norm = (s) => api._curatedCleanupCorrectedText(s);

test("adjacent extras + inline insert: no stray space survives the gap", () => {
	// student wrote `a.replace Children(x);` (split identifier + space);
	// teacher has `a.replaceChildren(x);`. insert_at lands on `Children` start
	// (10) so the two extras stay separate groups — exercising gap-absorption.
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
	const { apply, summary } = bothPaths({
		teacher,
		student,
		marks,
		file: "f.js",
	});
	const expected = "a.replaceChildren(x);";
	assert.equal(norm(apply), expected, "apply path");
	assert.equal(norm(summary), expected, "summary path");
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
	const { apply, summary } = bothPaths({
		teacher,
		student,
		marks,
		file: "f.js",
	});
	const expected = "let selectedPiece = null;";
	assert.equal(norm(apply), expected, "apply path");
	assert.equal(norm(summary), expected, "summary path");
	assert.ok(!/\n/.test(summary.trim()), "summary must be a single line");
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
