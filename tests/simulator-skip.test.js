"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
	computeSkipRegions,
	PAUSE_CAP_MS,
} = require("../lesson_tools/simulator/visualizer.js");

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
