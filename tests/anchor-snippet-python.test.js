"use strict";

global.window = {};

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { extractAnchorSnippet } = require("../src/renderer/anchor-snippet");
const { HL_COLORS } = require("../lesson_tools/shared/simulator-highlight");

const PY_PLAN = [
	{ type: "move-to", target: "tree.py" },
	{
		type: "code",
		text: "def f(x):\nif x:\ny = 1 # one\n⌫else:\ny = 2⚓0⚓\n\n⌫⌫print(f(1))",
	},
	{ type: "move-to", target: "⚓0⚓" },
];

test("a python move-to preview indents after a colon, so ⌫ dedents instead of joining lines", () => {
	const r = extractAnchorSnippet("⚓0⚓", 2, PY_PLAN, 10, 10);
	assert.deepEqual(
		r.lines.filter((l) => l.trim()),
		[
			"def f(x):",
			"\tif x:",
			"\t\ty = 1 # one",
			"\telse:",
			"\t\ty = 2",
			"print(f(1))",
		],
	);
	assert.equal(r.lines[r.arrowIdx], "\t\ty = 2");
});

test("a python move-to preview is highlighted as python, not html", () => {
	const r = extractAnchorSnippet("⚓0⚓", 2, PY_PLAN, 10, 10);
	const row = r.colored[r.lines.indexOf("\t\ty = 1 # one")];
	assert.ok(
		row.some((s) => s.text === "# one" && s.color === HL_COLORS.hl_comment),
		"a # comment is only a comment to the python profile",
	);
});
