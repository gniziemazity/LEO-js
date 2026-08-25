"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
	computeSkipRegions,
	PAUSE_CAP_MS,
	visibleFileTabs,
} = require("../lesson_tools/simulator/visualizer.js");

const f = (text) => ({ text });

test("PAUSE_CAP_MS is 3000ms", () => {
	assert.equal(PAUSE_CAP_MS, 3000);
});

test("computeSkipRegions: no regions when all gaps are within the cap", () => {
	// gaps: 100, 2999, 3000 — none strictly greater than 3000
	const cum = Float64Array.from([0, 100, 3099, 6099]);
	assert.deepEqual(computeSkipRegions(cum, 3000), []);
});

test("computeSkipRegions: a gap exactly at the cap is not skipped (strict >)", () => {
	const cum = Float64Array.from([0, 3000]);
	assert.deepEqual(computeSkipRegions(cum, 3000), []);
});

test("computeSkipRegions: one long gap yields one region [prevCum + cap, cum]", () => {
	const cum = Float64Array.from([0, 10000]); // single 10s pause
	assert.deepEqual(computeSkipRegions(cum, 3000), [
		{ start: 3000, end: 10000 },
	]);
});

test("computeSkipRegions: multiple long gaps among short ones", () => {
	// gaps: 100 (ok), 30000 (skip), 50 (ok), 8000 (skip)
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

test("visibleFileTabs: a lesson that only ever uses MAIN keeps it", () => {
	assert.deepEqual(visibleFileTabs({ MAIN: f("code") }, "MAIN"), ["MAIN"]);
	assert.deepEqual(visibleFileTabs({ MAIN: f("") }, "MAIN"), ["MAIN"]);
});

test("visibleFileTabs: empty non-MAIN files are kept — the lesson named them", () => {
	const files = { MAIN: f(""), "a.js": f(""), "b.css": f("") };
	assert.deepEqual(visibleFileTabs(files, "a.js"), ["a.js", "b.css"]);
});
