"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const dir = path.resolve(__dirname, "..", "lesson_tools", "differentiator");

const stub = `
"use strict";
let _teacherFiles = {};
let _studentFiles = {};
let _diffMode = "ideal";
let _curatedFloatWin = null;
const _DIFF_TOKEN_RE = /[a-zA-Z0-9]+|[^\\s]/g;
const _DIFF_FALLBACK_DETECT_RE = /\\/\\*[\\s\\S]*?\\*\\/|<!--[\\s\\S]*?-->|(?<!:)\\/\\/[^\\n]*/g;
const window = { addEventListener() {}, LanguageProfiles: { getProfile: () => null } };
const document = { getElementById: () => null };
function newTokenRegex() { return /[a-zA-Z0-9]+|[^\\s]/g; }
function getFileExt(n) { const m = String(n).toLowerCase().match(/\\.([^.]+)$/); return m ? m[1] : ""; }
function _curatedEnsureButtons() {}
function __setState(teacher, student, marks) {
	_teacherFiles = teacher;
	_studentFiles = student;
	_curatedSel.working = { ideal: marks };
	_curatedSel.tokenCache.clear();
	_curatedSel.commentRangeCache.clear();
}
`;

const api = new Function(`
	${stub}
	${fs.readFileSync(path.join(dir, "curated-model.js"), "utf-8")}
	${fs.readFileSync(path.join(dir, "curated-io.js"), "utf-8")}
	${fs.readFileSync(path.join(dir, "curated-apply.js"), "utf-8")}
	${fs.readFileSync(path.join(dir, "score.js"), "utf-8")}
	return {
		_curatedAlignTokens,
		_curatedTokenParity,
		_curatedParityProblems,
		_curatedParityContext,
		__setState,
	};
`)();

const noMarks = (extra = {}) => ({
	token_matching: "ideal",
	teacher_files: {},
	student_files: {},
	...extra,
});

function check(teacher, student, marks = noMarks()) {
	api.__setState(teacher, student, marks);
	return {
		parity: api._curatedTokenParity(),
		probs: api._curatedParityProblems(),
	};
}

test("align: matched pairs are equal, in order, and maximal", () => {
	const a = ["x", "a", "b", "c", "y"];
	const b = ["x", "a", "c", "b", "y"];
	const { aToB, bToA, approximate } = api._curatedAlignTokens(a, b);
	assert.equal(approximate, false);
	let last = -1;
	let matched = 0;
	aToB.forEach((j, i) => {
		if (j < 0) return;
		assert.equal(a[i], b[j]);
		assert.ok(j > last, "matches keep their order");
		assert.equal(bToA[j], i);
		last = j;
		matched++;
	});
	assert.equal(matched, 4, "x, a, one of b/c, y");
});

test("align: too many cells leaves the middle unmatched and says so", () => {
	const a = Array.from({ length: 3000 }, (_, i) => "a" + i);
	const b = Array.from({ length: 3000 }, (_, i) => "b" + i);
	const { aToB, approximate } = api._curatedAlignTokens(
		["s", ...a, "e"],
		["s", ...b, "e"],
	);
	assert.equal(approximate, true);
	assert.equal(aToB[0], 0);
	assert.equal(aToB[3001], 3001);
	assert.equal(aToB[1], -1);
});

test("missing: names the teacher tokens the corrections never produce", () => {
	const teacher = { "f.css": ".a {\n\tx: 1;\n\ty: 2;\n}" };
	const student = { "f.css": ".a {\n\tx: 1;\n}" };
	const { parity, probs } = check(teacher, student);
	assert.equal(parity.missing, 4);
	assert.deepEqual(
		probs.missing.map((it) => it.token),
		["y", ":", "2", ";"],
	);
	const y = probs.missing[0].teacher;
	assert.equal(y.file, "f.css");
	assert.equal(y.start, teacher["f.css"].indexOf("y"));
	const ctx = api._curatedParityContext(teacher["f.css"], y.start, y.end);
	assert.deepEqual(ctx, { line: 3, before: "", token: "y", after: ": 2;" });
	assert.deepEqual(probs.extra, []);
	assert.deepEqual(probs.moved, []);
});

test("surplus left by the student points back into the student's file", () => {
	const teacher = { "f.css": ".a {\n\tx: 1;\n}" };
	const student = { "f.css": ".a {\n\tx: 1;\n\tz;\n}" };
	const { parity, probs } = check(teacher, student);
	assert.equal(parity.extra, 2);
	assert.deepEqual(
		probs.extra.map((it) => [it.token, it.student.file, it.student.start]),
		[
			["z", "f.css", student["f.css"].indexOf("z")],
			[";", "f.css", student["f.css"].lastIndexOf(";")],
		],
	);
});

test("surplus added by a correction has no student position", () => {
	const teacher = { "f.js": "a();" };
	const student = { "f.js": "a();" };
	const marks = noMarks({
		teacher_files: {
			"f.js": [
				{
					token: ";",
					label: "missing",
					start: 3,
					end: 4,
					insert_at: { file: "f.js", pos: 4 },
				},
			],
		},
	});
	const { parity, probs } = check(teacher, student, marks);
	assert.equal(parity.extra, 1);
	assert.equal(probs.extra.length, 1);
	assert.equal(probs.extra[0].token, ";");
	assert.equal(probs.extra[0].student, undefined);
	assert.equal(probs.extra[0].out.file, "f.js");
});

test("surplus maps through file_pairs to the student's own file name", () => {
	const teacher = { "123456.js": "x();" };
	const student = { "654321.js": "x();z" };
	const marks = noMarks({ file_pairs: { "654321.js": "123456.js" } });
	const { probs } = check(teacher, student, marks);
	assert.equal(probs.extra.length, 1);
	assert.deepEqual(probs.extra[0].student, {
		file: "654321.js",
		start: 4,
		end: 5,
	});
});

test("same tokens in another order are listed as moved, not missing", () => {
	const teacher = { "f.js": "x(); y();" };
	const student = { "f.js": "y(); x();" };
	const { parity, probs } = check(teacher, student);
	assert.equal(parity.sameSet, true);
	assert.equal(parity.sameOrder, false);
	assert.deepEqual(probs.missing, []);
	assert.deepEqual(probs.extra, []);
	assert.deepEqual(probs.moved.map((it) => it.token).sort(), ["x", "y"]);
	for (const it of probs.moved) {
		assert.equal(it.teacher.start, teacher["f.js"].indexOf(it.token));
		assert.equal(it.student.start, student["f.js"].indexOf(it.token));
	}
});

test("the pill and the list always count the same tokens", () => {
	const teacher = { "a.js": "p(1); q(2); r(3);", "s.css": ".a { b: c; }" };
	const student = { "a.js": "q(2); p(9); r(3); r;", "s.css": ".a { }" };
	const { parity, probs } = check(teacher, student);
	assert.equal(probs.missing.length, parity.missing);
	assert.equal(probs.extra.length, parity.extra);
});

test("files sharing an extension pair by name, so identical code matches", () => {
	const teacher = { "a.js": "x();", "b.js": "y();" };
	const { parity, probs } = check(teacher, { ...teacher });
	assert.equal(parity.sameOrder, true);
	assert.deepEqual([probs.missing, probs.extra, probs.moved], [[], [], []]);
});

test("comments never count as surplus", () => {
	const { parity } = check({ "f.js": "x();" }, { "f.js": "x(); // y z" });
	assert.equal(parity.sameOrder, true);
});
