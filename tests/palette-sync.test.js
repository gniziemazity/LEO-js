"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function rootVars(rel) {
	const text = fs.readFileSync(path.join(ROOT, rel), "utf-8");
	const start = text.indexOf(":root");
	const block = text.slice(start, text.indexOf("}", start));
	const vars = {};
	for (const m of block.matchAll(/(--[\w-]+):\s*([^;]+);/g))
		vars[m[1]] = m[2].trim();
	return vars;
}

test("the app and the lesson tools share one palette", () => {
	const app = rootVars("src/shared/styles.css");
	const tools = rootVars("lesson_tools/shared/shared.css");
	const shared = Object.keys(app).filter((name) => name in tools);
	assert.ok(shared.length > 20, "the two :root blocks overlap");
	for (const name of shared)
		assert.equal(
			app[name],
			tools[name],
			`${name} differs: the shared subset must stay in sync`,
		);
});
