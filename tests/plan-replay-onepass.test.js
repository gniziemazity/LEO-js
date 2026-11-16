"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
	extractGoToExcerpt,
	computeGoToExcerpts,
} = require("../src/renderer/plan-replay");

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

const PLAN = [
	{ type: "go-to", target: "app.js" },
	{
		type: "code",
		text:
			"function createWindow() {\n" +
			"\tconst canvas = 1;⚓1⚓\n" +
			"\treturn canvas;\n" +
			"}\n",
	},
	{ type: "go-to", target: "MAIN" },
	{ type: "code", text: "<html>\n<body>⚓2⚓\n</body>\n</html>\n" },
	{ type: "go-to", target: "app.js" },
	{ type: "code", text: "\nmodule.exports = createWindow;\n" },
	{ type: "go-to", target: "db.ts" },
	{
		type: "code",
		text: "export function getPool(): Pool {\n\treturn pool;⚓3⚓\n}\n",
	},
	{ type: "go-to", target: "⚓1⚓" },
	{ type: "code", text: "\n// annotated\n" },
	{ type: "go-to", target: "style.css" },
];

test("computeGoToExcerpts agrees with extractGoToExcerpt at every go-to", () => {
	const oneShot = computeGoToExcerpts(PLAN);
	for (let i = 0; i < PLAN.length; i++) {
		if (PLAN[i].type !== "go-to") continue;
		const restarted = extractGoToExcerpt(PLAN[i].target || "MAIN", i, PLAN);
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

test("computeGoToExcerpts covers every go-to block exactly once", () => {
	const snippets = computeGoToExcerpts(PLAN);
	const goToIdxs = PLAN.map((b, i) => (b.type === "go-to" ? i : -1)).filter(
		(i) => i >= 0,
	);
	assert.deepEqual(
		[...snippets.keys()].sort((a, b) => a - b),
		goToIdxs,
	);
});

test("a plan with zero go-tos returns an empty map, not a crash", () => {
	const snippets = computeGoToExcerpts([{ type: "code", text: "let a = 1;" }]);
	assert.equal(snippets.size, 0);
});
