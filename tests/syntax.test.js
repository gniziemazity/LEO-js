"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");

function tracked() {
	const out = execFileSync("git", ["ls-files", "*.js"], {
		cwd: ROOT,
		encoding: "utf-8",
		maxBuffer: 1 << 26,
	});
	return out
		.split("\n")
		.map((s) => s.trim())
		.filter(Boolean)
		.filter((f) => !f.includes("node_modules"))
		.filter((f) => !/\.min\.js$/.test(f));
}

test("every tracked script parses", () => {
	const broken = [];
	for (const rel of tracked()) {
		const abs = path.join(ROOT, rel);
		let src;
		try {
			src = fs.readFileSync(abs, "utf-8");
		} catch (e) {
			continue;
		}
		try {
			new vm.Script(src, { filename: abs });
		} catch (e) {
			broken.push(`${rel}: ${e.message}`);
		}
	}
	assert.deepEqual(
		broken,
		[],
		"a main-process file is never require()d by a test, so a syntax error " +
			"in it reaches the user as a startup dialog instead of a red test",
	);
});

test("the main process is more than a parse: its top level must load", () => {
	const main = fs.readFileSync(path.join(ROOT, "src/main/main.js"), "utf-8");
	assert.match(
		main,
		/^async function createWindow\(\) \{/m,
		"createWindow awaits inside; losing its async keyword is a silent break",
	);
	assert.equal(
		/^async const /m.test(main),
		false,
		"an insertion that lands between `async` and `function` strands it",
	);
});
