"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
	extractGoToExcerpt,
	extractCodeInsertPaste,
} = require("../src/renderer/plan-replay");

const codeBlocks = [
	{
		type: "code",
		text: "const a = 1;\nconst b = 2;⚓5⚓\nconst c = 3;\nconst d = 4;",
	},
];

test("extractGoToExcerpt: returns null when nothing was typed where it goes", () => {
	assert.equal(extractGoToExcerpt("foo", 0, codeBlocks), null);
	assert.equal(extractGoToExcerpt("", 0, codeBlocks), null);
	assert.equal(extractGoToExcerpt(null, 0, codeBlocks), null);
	assert.equal(extractGoToExcerpt("⚓⚓", 1, []), null);
});

const FILE_PLAN = [
	{ type: "go-to", target: "app.js" },
	{ type: "code", text: "let a = 1;\nlet b = 2;\nlet c = 3;↑" },
	{ type: "go-to", target: "MAIN" },
	{ type: "code", text: "<p>" },
	{ type: "go-to", target: "app.js" },
];

test("a go-to into a file shows the file where auto-typing left it", () => {
	const r = extractGoToExcerpt("app.js", 4, FILE_PLAN, 1, 1);
	assert.deepEqual(r.lines, ["let a = 1;", "let b = 2;", "let c = 3;"]);
	assert.equal(r.arrowIdx, 1, "the ↑ left the caret on the middle line");
	assert.equal(r.anchorCol, 10);
	assert.equal(
		r.switchTo,
		null,
		"the target already names the file; a switchTo would log it twice",
	);
});

test("the first visit to a file has nothing to show", () => {
	assert.equal(
		extractGoToExcerpt("app.js", 0, FILE_PLAN),
		null,
		"that is the go-to that offers to type the name, which owns the body",
	);
	assert.equal(
		extractGoToExcerpt("style.css", 4, FILE_PLAN),
		null,
		"nor does a file the plan never opened",
	);
});

test("MAIN and DEV show their own editor the same way", () => {
	const r = extractGoToExcerpt("MAIN", 4, FILE_PLAN, 0, 0);
	assert.deepEqual(r.lines, ["<p>"]);
	assert.equal(r.anchorCol, 3);
	assert.equal(extractGoToExcerpt("DEV", 4, FILE_PLAN), null);
	assert.equal(
		extractGoToExcerpt("MAIN", 2, FILE_PLAN),
		null,
		"the go-to itself sees the plan only up to where it stands",
	);
});

test("extractGoToExcerpt: returns null for a file-like anchor id (has extension)", () => {
	assert.equal(extractGoToExcerpt("⚓a.js⚓", 1, codeBlocks), null);
	assert.equal(extractGoToExcerpt("⚓index.html⚓", 1, codeBlocks), null);
});

test("extractGoToExcerpt: returns null when the anchor id is not present", () => {
	assert.equal(extractGoToExcerpt("⚓9⚓", 1, codeBlocks), null);
});

test("extractGoToExcerpt: extracts the windowed snippet around the anchor", () => {
	const r = extractGoToExcerpt("⚓5⚓", 1, codeBlocks, 1, 1);
	assert.ok(r);
	assert.deepEqual(Object.keys(r), [
		"lines",
		"colored",
		"arrowIdx",
		"anchorCol",
		"file",
		"switchTo",
	]);
	assert.deepEqual(r.lines, ["const a = 1;", "const b = 2;", "const c = 3;"]);
	assert.equal(r.arrowIdx, 1);
	assert.equal(r.anchorCol, 12);
	assert.equal(
		r.file,
		"MAIN",
		"the editor the anchor is in, for the hover header",
	);
});

test("extractGoToExcerpt: before/after clamp at file boundaries", () => {
	const r = extractGoToExcerpt("⚓5⚓", 1, codeBlocks, 5, 5);
	assert.ok(r);
	assert.deepEqual(r.lines, [
		"const a = 1;",
		"const b = 2;",
		"const c = 3;",
		"const d = 4;",
	]);
	assert.equal(r.arrowIdx, 1);
});

test("extractGoToExcerpt: a bare-filename go-to switches the active editor", () => {
	const blocks = [
		{ type: "code", text: "main line;" },
		{ type: "go-to", target: "other.js" },
		{ type: "code", text: "other line ⚓3⚓ here" },
	];
	const r = extractGoToExcerpt("⚓3⚓", 3, blocks, 1, 1);
	assert.ok(r);
	assert.deepEqual(r.lines, ["other line  here"]);
	assert.equal(r.arrowIdx, 0);
});

test("extractGoToExcerpt: only blocks before currentBlockIdx are replayed", () => {
	const blocks = [
		{ type: "code", text: "first;" },
		{ type: "code", text: "second;⚓7⚓" },
	];
	assert.equal(extractGoToExcerpt("⚓7⚓", 1, blocks), null);
	assert.ok(extractGoToExcerpt("⚓7⚓", 2, blocks));
});

test("extractGoToExcerpt: an anchor in the current file asks for no switch", () => {
	const blocks = [
		{ type: "go-to", target: "a.js" },
		{ type: "code", text: "here ⚓3⚓ now" },
	];
	const r = extractGoToExcerpt("⚓3⚓", 2, blocks, 1, 1);
	assert.ok(r);
	assert.equal(r.switchTo, null);
});

test("extractGoToExcerpt: an anchor in another file names the file to open first", () => {
	const blocks = [
		{ type: "code", text: "main line;" },
		{ type: "go-to", target: "other.js" },
		{ type: "code", text: "other line ⚓3⚓ here" },
		{ type: "go-to", target: "style.css" },
		{ type: "code", text: "body { }" },
	];
	const r = extractGoToExcerpt("⚓3⚓", 5, blocks, 1, 1);
	assert.ok(r);
	assert.equal(r.switchTo, "other.js");
	assert.deepEqual(
		r.lines,
		["other line  here"],
		"and the snippet is the other file's text, not the current one's",
	);
});

test("extractGoToExcerpt: a jump back to the main editor reads as MAIN", () => {
	const blocks = [
		{ type: "code", text: "main line ⚓1⚓ here" },
		{ type: "go-to", target: "other.js" },
		{ type: "code", text: "other line;" },
	];
	const r = extractGoToExcerpt("⚓1⚓", 3, blocks, 1, 1);
	assert.ok(r);
	assert.equal(r.switchTo, "MAIN");
});

test("extractGoToExcerpt: an anchor in the dev console reads as DEV", () => {
	const blocks = [
		{ type: "go-to", target: "DEV" },
		{ type: "code", text: "console.log(x)⚓4⚓" },
		{ type: "go-to", target: "MAIN" },
		{ type: "code", text: "let x = 1;" },
	];
	const r = extractGoToExcerpt("⚓4⚓", 4, blocks, 1, 1);
	assert.ok(r);
	assert.equal(r.switchTo, "DEV");
});

test("extractGoToExcerpt: a second file switch back makes the anchor local again", () => {
	const blocks = [
		{ type: "go-to", target: "other.js" },
		{ type: "code", text: "other ⚓2⚓ line" },
		{ type: "go-to", target: "main.css" },
		{ type: "code", text: "body{}" },
		{ type: "go-to", target: "other.js" },
	];
	const here = extractGoToExcerpt("⚓2⚓", 5, blocks, 1, 1);
	assert.equal(here.switchTo, null, "back in other.js, no switch needed");
	const away = extractGoToExcerpt("⚓2⚓", 4, blocks, 1, 1);
	assert.equal(away.switchTo, "other.js", "but from main.css it is a switch");
});
