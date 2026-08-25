"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { extractAnchorSnippet } = require("../src/renderer/anchor-snippet");

const codeBlocks = [
	{
		type: "code",
		text: "const a = 1;\nconst b = 2;⚓5⚓\nconst c = 3;\nconst d = 4;",
	},
];

test("extractAnchorSnippet: returns null for non-anchor targets", () => {
	assert.equal(extractAnchorSnippet("foo", 1, codeBlocks), null);
	assert.equal(extractAnchorSnippet("", 1, codeBlocks), null);
	assert.equal(extractAnchorSnippet(null, 1, codeBlocks), null);
	assert.equal(extractAnchorSnippet("⚓⚓", 1, []), null);
});

test("extractAnchorSnippet: returns null for a file-like anchor id (has extension)", () => {
	assert.equal(extractAnchorSnippet("⚓a.js⚓", 1, codeBlocks), null);
	assert.equal(extractAnchorSnippet("⚓index.html⚓", 1, codeBlocks), null);
});

test("extractAnchorSnippet: returns null when the anchor id is not present", () => {
	assert.equal(extractAnchorSnippet("⚓9⚓", 1, codeBlocks), null);
});

test("extractAnchorSnippet: extracts the windowed snippet around the anchor", () => {
	const r = extractAnchorSnippet("⚓5⚓", 1, codeBlocks, 1, 1);
	assert.ok(r);
	assert.deepEqual(Object.keys(r), [
		"lines",
		"colored",
		"arrowIdx",
		"anchorCol",
		"switchTo",
	]);
	assert.deepEqual(r.lines, ["const a = 1;", "const b = 2;", "const c = 3;"]);
	assert.equal(r.arrowIdx, 1);
	assert.equal(r.anchorCol, 12);
});

test("extractAnchorSnippet: before/after clamp at file boundaries", () => {
	const r = extractAnchorSnippet("⚓5⚓", 1, codeBlocks, 5, 5);
	assert.ok(r);
	assert.deepEqual(r.lines, [
		"const a = 1;",
		"const b = 2;",
		"const c = 3;",
		"const d = 4;",
	]);
	assert.equal(r.arrowIdx, 1);
});

test("extractAnchorSnippet: a bare-filename move-to switches the active editor", () => {
	const blocks = [
		{ type: "code", text: "main line;" },
		{ type: "move-to", target: "other.js" },
		{ type: "code", text: "other line ⚓3⚓ here" },
	];
	const r = extractAnchorSnippet("⚓3⚓", 3, blocks, 1, 1);
	assert.ok(r);
	assert.deepEqual(r.lines, ["other line  here"]);
	assert.equal(r.arrowIdx, 0);
});

test("extractAnchorSnippet: a legacy ⚓file.ext⚓ move-to switches the editor too", () => {
	const blocks = [
		{ type: "code", text: "main line;" },
		{ type: "move-to", target: "⚓other.js⚓" },
		{ type: "code", text: "other line ⚓3⚓ here" },
	];
	const r = extractAnchorSnippet("⚓3⚓", 3, blocks, 1, 1);
	assert.ok(r);
	assert.deepEqual(r.lines, ["other line  here"]);
});

test("extractAnchorSnippet: only blocks before currentBlockIdx are replayed", () => {
	const blocks = [
		{ type: "code", text: "first;" },
		{ type: "code", text: "second;⚓7⚓" },
	];
	assert.equal(extractAnchorSnippet("⚓7⚓", 1, blocks), null);
	assert.ok(extractAnchorSnippet("⚓7⚓", 2, blocks));
});

test("extractAnchorSnippet: an anchor in the current file asks for no switch", () => {
	const blocks = [
		{ type: "move-to", target: "a.js" },
		{ type: "code", text: "here ⚓3⚓ now" },
	];
	const r = extractAnchorSnippet("⚓3⚓", 2, blocks, 1, 1);
	assert.ok(r);
	assert.equal(r.switchTo, null);
});

test("extractAnchorSnippet: an anchor in another file names the file to open first", () => {
	const blocks = [
		{ type: "code", text: "main line;" },
		{ type: "move-to", target: "other.js" },
		{ type: "code", text: "other line ⚓3⚓ here" },
		{ type: "move-to", target: "style.css" },
		{ type: "code", text: "body { }" },
	];
	const r = extractAnchorSnippet("⚓3⚓", 5, blocks, 1, 1);
	assert.ok(r);
	assert.equal(r.switchTo, "other.js");
	assert.deepEqual(
		r.lines,
		["other line  here"],
		"and the snippet is the other file's text, not the current one's",
	);
});

test("extractAnchorSnippet: a jump back to the main editor reads as MAIN", () => {
	const blocks = [
		{ type: "code", text: "main line ⚓1⚓ here" },
		{ type: "move-to", target: "other.js" },
		{ type: "code", text: "other line;" },
	];
	const r = extractAnchorSnippet("⚓1⚓", 3, blocks, 1, 1);
	assert.ok(r);
	assert.equal(r.switchTo, "MAIN");
});

test("extractAnchorSnippet: an anchor in the dev console reads as DEV", () => {
	const blocks = [
		{ type: "move-to", target: "DEV" },
		{ type: "code", text: "console.log(x)⚓4⚓" },
		{ type: "move-to", target: "MAIN" },
		{ type: "code", text: "let x = 1;" },
	];
	const r = extractAnchorSnippet("⚓4⚓", 4, blocks, 1, 1);
	assert.ok(r);
	assert.equal(r.switchTo, "DEV");
});

test("extractAnchorSnippet: a second file switch back makes the anchor local again", () => {
	const blocks = [
		{ type: "move-to", target: "other.js" },
		{ type: "code", text: "other ⚓2⚓ line" },
		{ type: "move-to", target: "main.css" },
		{ type: "code", text: "body{}" },
		{ type: "move-to", target: "other.js" },
	];
	const here = extractAnchorSnippet("⚓2⚓", 5, blocks, 1, 1);
	assert.equal(here.switchTo, null, "back in other.js, no switch needed");
	const away = extractAnchorSnippet("⚓2⚓", 4, blocks, 1, 1);
	assert.equal(away.switchTo, "other.js", "but from main.css it is a switch");
});
