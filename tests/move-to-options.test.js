"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const LessonManager = require("../src/renderer/lesson-manager");
const LessonRenderer = require("../src/renderer/lesson-renderer");

const PLAN = [
	{ type: "move-to", target: "index.html" },
	{ type: "code", text: "<h1>hi</h1>⚓1⚓" },
	{ type: "move-to", target: "app.js" },
	{ type: "code", text: "const a = 1;⚓2⚓" },
	{ type: "move-to", target: "⚓1⚓" },
	{ type: "code", text: "const b = 2;⚓3⚓" },
];

function manager(blocks = PLAN) {
	const lm = new LessonManager();
	lm.data = blocks.map((b) => ({ ...b }));
	return lm;
}

function options(lm, blockIdx, current = "MAIN") {
	const renderer = new LessonRenderer(lm, {}, {});
	return renderer._moveToOptions(current, blockIdx).map((o) => o.value);
}

const ids = (lm, i) => lm.anchorIdsBefore(i).sort();

test("anchorIdsBefore only counts anchors the plan has reached", () => {
	const lm = manager();
	assert.deepEqual(ids(lm, 0), []);
	assert.deepEqual(ids(lm, 2), ["1"]);
	assert.deepEqual(ids(lm, 4), ["1", "2"]);
	assert.deepEqual(ids(lm, 6), ["1", "2", "3"]);
});

test("an anchor counts wherever it was typed, not only in the open file", () => {
	const lm = manager();
	// block 4 jumps into index.html, so block 5 types anchor 3 there
	assert.deepEqual(lm.anchorIdsBefore(6), ["1", "3", "2"]);
});

test("the dropdown offers no anchor the plan has not created yet", () => {
	const lm = manager();
	assert.deepEqual(options(lm, 4), [
		"⚓1⚓",
		"⚓2⚓",
		"index.html",
		"app.js",
		"MAIN",
		"DEV",
		"__new__",
	]);
});

test("the first block can jump to no anchor at all", () => {
	const lm = manager();
	assert.deepEqual(options(lm, 0), [
		"index.html",
		"app.js",
		"MAIN",
		"DEV",
		"__new__",
	]);
});

test("an anchor from a later block is not offered", () => {
	const lm = manager();
	assert.equal(options(lm, 4).includes("⚓3⚓"), false);
	assert.equal(options(lm, 5).includes("⚓3⚓"), false);
	assert.equal(options(lm, 6).includes("⚓3⚓"), true);
});

test("a target that points at a later anchor is still shown, flagged", () => {
	const lm = manager();
	const opts = new LessonRenderer(lm, {}, {})._moveToOptions("⚓3⚓", 4);
	const stray = opts.find((o) => o.value === "⚓3⚓");
	assert.ok(stray, "the plan's own value must stay pickable");
	assert.equal(stray.label, "? ⚓3⚓");
});

test("anchors typed inside a code-insert body count as created", () => {
	const lm = manager([
		{ type: "move-to", target: "app.js" },
		{ type: "comment", text: "📋 const a = 1;⚓9⚓" },
		{ type: "move-to", target: "MAIN" },
	]);
	assert.deepEqual(lm.anchorIdsBefore(2), ["9"]);
	assert.equal(options(lm, 2).includes("⚓9⚓"), true);
});

test("files stay offered wherever they appear - a move-to opens one", () => {
	const lm = manager();
	assert.equal(options(lm, 0).includes("app.js"), true);
});
