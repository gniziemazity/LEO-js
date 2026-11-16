"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
	computeSkipRegions,
	visibleFileTabs,
} = require("../lesson_tools/simulator/simulator.js");

const f = (text) => ({ text });

test("computeSkipRegions: no regions when all gaps are within the cap", () => {
	const cum = Float64Array.from([0, 100, 3099, 6099]);
	assert.deepEqual(computeSkipRegions(cum, 3000), []);
});

test("computeSkipRegions: multiple long gaps among short ones", () => {
	const cum = Float64Array.from([0, 100, 30100, 30150, 38150]);
	assert.deepEqual(computeSkipRegions(cum, 3000), [
		{ start: 3100, end: 30100 }, // 100 + 3000 .. 30100
		{ start: 33150, end: 38150 }, // 30150 + 3000 .. 38150
	]);
});

test("computeSkipRegions: accepts plain arrays and empty/null input", () => {
	assert.deepEqual(computeSkipRegions([0, 5000], 3000), [
		{ start: 3000, end: 5000 },
	]);
	assert.deepEqual(computeSkipRegions([0], 3000), []);
	assert.deepEqual(computeSkipRegions(null, 3000), []);
});

test("visibleFileTabs: an unused MAIN is dropped once the lesson moves on", () => {
	const files = { MAIN: f(""), "index.html": f("<p>hi</p>") };
	assert.deepEqual(visibleFileTabs(files, "index.html"), ["index.html"]);
});

test("visibleFileTabs: MAIN stays while it is the active file, even if empty", () => {
	const files = { MAIN: f(""), "index.html": f("<p>hi</p>") };
	assert.deepEqual(visibleFileTabs(files, "MAIN"), ["MAIN", "index.html"]);
});

test("visibleFileTabs: a MAIN the teacher actually typed into is kept", () => {
	const files = { MAIN: f("const x = 1;"), "index.html": f("<p>hi</p>") };
	assert.deepEqual(visibleFileTabs(files, "index.html"), [
		"MAIN",
		"index.html",
	]);
});

test("visibleFileTabs: whitespace-only MAIN counts as empty", () => {
	const files = { MAIN: f("\n\t  \n"), "index.html": f("<p>hi</p>") };
	assert.deepEqual(visibleFileTabs(files, "index.html"), ["index.html"]);
});

test("visibleFileTabs: empty non-MAIN files are kept — the lesson named them", () => {
	const files = { MAIN: f(""), "a.js": f(""), "b.css": f("") };
	assert.deepEqual(visibleFileTabs(files, "a.js"), ["a.js", "b.css"]);
});
