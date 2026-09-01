"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadModule, fakeIpcRenderer } = require("./helpers/load-module.js");

function makeCursorManager(steps) {
	const ipc = fakeIpcRenderer();
	const CursorManager = loadModule("src/renderer/cursor-manager.js", {
		electron: ipc.stub,
		"../shared/blocks": {
			...require("../src/shared/blocks"),
			getBlockSubtype: () => null,
		},
	});
	const sent = ipc.sent;
	const cm = new CursorManager(
		{ updateProgressBar() {}, removeCursorClasses() {} },
		{ addEntry() {} },
	);
	cm.updateCursor = () => {};
	cm.setExecutionSteps(steps);
	return { cm, sent, replies: () => sent.map((m) => m.ch) };
}

function element() {
	const classes = new Set();
	return {
		classList: {
			add: (c) => classes.add(c),
			remove: (c) => classes.delete(c),
		},
		classes,
		dataset: {},
	};
}

const charStep = (ch) => ({ type: "char", char: ch, element: element() });
const blockStep = () => ({ type: "block", element: element() });
const anchorStep = (v) => ({ type: "anchor", value: v, element: element() });

test("a character step sends the character, and only that", () => {
	const { cm, sent } = makeCursorManager([charStep("a")]);
	cm.advanceCursor();
	assert.deepEqual(sent, [{ ch: "type-character", payload: "a" }]);
	assert.equal(cm.getCurrentStep(), 1, "and moves on");
});

test("a block step reports completion, since there is nothing to type", () => {
	const { cm, replies } = makeCursorManager([blockStep()]);
	cm.advanceCursor();
	assert.deepEqual(replies(), ["input-complete"]);
	assert.equal(cm.getCurrentStep(), 1);
});

test("an anchor step reports completion too", () => {
	const { cm, replies } = makeCursorManager([anchorStep("⚓1⚓")]);
	cm.advanceCursor();
	assert.deepEqual(replies(), ["input-complete"]);
	assert.equal(cm.getCurrentStep(), 1);
});

test("running past the last step still answers — this is the lock-leak guard", () => {
	const { cm, replies } = makeCursorManager([charStep("a")]);
	cm.advanceCursor();
	cm.advanceCursor();
	cm.advanceCursor();
	assert.deepEqual(
		replies(),
		["type-character", "input-complete", "input-complete"],
		"every advance answers, or main waits on a reply that never comes",
	);
});

test("a step type nobody recognises answers rather than stalling", () => {
	const { cm, replies } = makeCursorManager([
		{ type: "something-new", element: element() },
	]);
	cm.advanceCursor();
	assert.deepEqual(replies(), ["input-complete"]);
	assert.equal(cm.getCurrentStep(), 1, "and does not sit on the same step");
});

test("every step of a mixed lesson answers exactly once", () => {
	const steps = [
		charStep("h"),
		charStep("i"),
		blockStep(),
		anchorStep("⚓1⚓"),
		charStep("!"),
	];
	const { cm, replies } = makeCursorManager(steps);
	for (let i = 0; i < steps.length; i++) cm.advanceCursor();
	assert.equal(
		replies().length,
		steps.length,
		"one reply per advance: no step may be silent",
	);
	assert.deepEqual(replies(), [
		"type-character",
		"type-character",
		"input-complete",
		"input-complete",
		"type-character",
	]);
});

test("the characters come out in order, which is the whole feature", () => {
	const text = "hello  world";
	const { cm, sent } = makeCursorManager([...text].map(charStep));
	for (let i = 0; i < text.length; i++) cm.advanceCursor();
	assert.equal(
		sent
			.filter((m) => m.ch === "type-character")
			.map((m) => m.payload)
			.join(""),
		text,
	);
});

test("a consumed step is marked consumed, whatever kind it is", () => {
	const steps = [charStep("a"), blockStep(), anchorStep("⚓1⚓")];
	const { cm } = makeCursorManager(steps);
	for (let i = 0; i < steps.length; i++) cm.advanceCursor();
	for (const s of steps)
		assert.ok(s.element.classes.has("consumed"), s.type + " must be marked");
});

test("an anchor is logged once, even if the lesson is re-run over it", () => {
	const logged = [];
	const step = anchorStep("⚓7⚓");
	const { cm } = makeCursorManager([step]);
	cm.logManager = { addEntry: (e) => logged.push(e) };
	cm.advanceCursor();
	cm.currentStepIndex = 0;
	cm.advanceCursor();
	assert.equal(
		logged.filter((e) => e.anchor).length,
		1,
		"the _logged flag is what stops a duplicate entry",
	);
});
