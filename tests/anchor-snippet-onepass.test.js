"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
	extractAnchorSnippet,
	computeMoveToSnippets,
} = require("../src/renderer/anchor-snippet");

function structKey(r) {
	return (
		r &&
		JSON.stringify({
			lines: r.lines,
			arrowIdx: r.arrowIdx,
			anchorCol: r.anchorCol,
			switchTo: r.switchTo,
		})
	);
}

function coloredText(r) {
	if (!r || !r.colored) return null;
	return r.colored.map((line) => line.map((seg) => seg.text).join(""));
}

// A synthetic plan touching MAIN, a .js file, a .ts file, and an anchor
// jump back into an already-open file - enough surface to exercise every
// branch of the replay without depending on the (gitignored) ideas/ fixtures.
const PLAN = [
	{ type: "move-to", target: "app.js" },
	{
		type: "code",
		text:
			"function createWindow() {\n" +
			"\tconst canvas = 1;⚓1⚓\n" +
			"\treturn canvas;\n" +
			"}\n",
	},
	{ type: "move-to", target: "MAIN" },
	{ type: "code", text: "<html>\n<body>⚓2⚓\n</body>\n</html>\n" },
	{ type: "move-to", target: "app.js" },
	{ type: "code", text: "\nmodule.exports = createWindow;\n" },
	{ type: "move-to", target: "db.ts" },
	{
		type: "code",
		text: "export function getPool(): Pool {\n\treturn pool;⚓3⚓\n}\n",
	},
	{ type: "move-to", target: "⚓1⚓" },
	{ type: "code", text: "\n// annotated\n" },
	{ type: "move-to", target: "style.css" },
];

test("computeMoveToSnippets agrees with extractAnchorSnippet at every move-to", () => {
	const oneShot = computeMoveToSnippets(PLAN);
	for (let i = 0; i < PLAN.length; i++) {
		if (PLAN[i].type !== "move-to") continue;
		const restarted = extractAnchorSnippet(PLAN[i].target || "MAIN", i, PLAN);
		assert.equal(
			structKey(oneShot.get(i)),
			structKey(restarted),
			`block ${i} (target=${JSON.stringify(PLAN[i].target)}) diverged`,
		);
		assert.deepEqual(
			coloredText(oneShot.get(i)),
			coloredText(restarted),
			`block ${i}: the coloured segments cover different text`,
		);
	}
});

test("computeMoveToSnippets covers every move-to block exactly once", () => {
	const snippets = computeMoveToSnippets(PLAN);
	const moveToIdxs = PLAN.map((b, i) =>
		b.type === "move-to" ? i : -1,
	).filter((i) => i >= 0);
	assert.deepEqual(
		[...snippets.keys()].sort((a, b) => a - b),
		moveToIdxs,
	);
});

test("a file that was typed into earlier shows its content, not just a null", () => {
	const snippets = computeMoveToSnippets(PLAN);
	// block 4: move-to app.js (2nd time), landing where block 1 left off
	const snippet = snippets.get(4);
	assert.ok(snippet, "expected a snippet for the app.js move-to");
	assert.ok(snippet.lines.some((l) => l.includes("createWindow")));
});

test("an anchor jump finds it in whichever editor it was typed into, not just the active one", () => {
	const snippets = computeMoveToSnippets(PLAN);
	// block 8: move-to ⚓1⚓. Active editor at that point is db.ts (from
	// block 6), but the anchor itself lives inside app.js (typed at block 1)
	// - so this only passes if the search does not stop at the active file.
	const snippet = snippets.get(8);
	assert.ok(snippet, "the anchor inside app.js was not found");
	assert.equal(
		snippet.switchTo,
		"app.js",
		"the anchor's own file was not reported as a switch",
	);
});

test("a file the plan never visited returns null, not a stale snippet", () => {
	const snippets = computeMoveToSnippets(PLAN);
	// block 10: move-to style.css, never opened or typed into
	assert.equal(snippets.get(10), null);
});

test("a plan with zero move-tos returns an empty map, not a crash", () => {
	const snippets = computeMoveToSnippets([
		{ type: "code", text: "let a = 1;" },
	]);
	assert.equal(snippets.size, 0);
});

test("the render-time snippet and the hover-preview snippet are the same computation", () => {
	// anchor-preview.js calls extractAnchorSnippet directly (hover is one
	// target at a time); lesson-renderer.js calls computeMoveToSnippets
	// (render needs all of them at once). Both must agree, always - a
	// hover preview that disagrees with what the popup will actually show
	// is worse than no preview.
	for (let i = 0; i < PLAN.length; i++) {
		if (PLAN[i].type !== "move-to") continue;
		for (const candidateTarget of ["MAIN", "app.js", "db.ts", "⚓1⚓"]) {
			const viaRender = computeMoveToSnippets(PLAN).get(i);
			const viaHover =
				candidateTarget === (PLAN[i].target || "MAIN")
					? extractAnchorSnippet(candidateTarget, i, PLAN)
					: viaRender; // only the block's own target is meaningfully comparable
			if (candidateTarget === (PLAN[i].target || "MAIN")) {
				assert.equal(structKey(viaRender), structKey(viaHover));
			}
		}
	}
});
