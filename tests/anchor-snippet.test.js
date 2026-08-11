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
	]);
	// anchor sits at end of "const b = 2;" (col 12); marker is stripped from the text
	assert.deepEqual(r.lines, ["const a = 1;", "const b = 2;", "const c = 3;"]);
	assert.equal(r.arrowIdx, 1);
	assert.equal(r.anchorCol, 12);
});

test("extractAnchorSnippet: before/after clamp at file boundaries", () => {
	const r = extractAnchorSnippet("⚓5⚓", 1, codeBlocks, 5, 5);
	assert.ok(r);
	// only 4 lines exist; window clamps to the whole file
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
	// currentBlockIdx 1 means only block 0 is replayed — anchor 7 not yet typed
	assert.equal(extractAnchorSnippet("⚓7⚓", 1, blocks), null);
	// currentBlockIdx 2 replays both blocks — anchor 7 is found
	assert.ok(extractAnchorSnippet("⚓7⚓", 2, blocks));
});
