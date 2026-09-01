"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadModule, fakeIpcRenderer } = require("./helpers/load-module.js");

function makeCursorManager(steps) {
	const ipc = fakeIpcRenderer({
		invoke: async () => ({ autoTypingSpeed: 10 }),
	});
	const CursorManager = loadModule("src/renderer/cursor-manager.js", {
		electron: ipc.stub,
	});
	const sent = ipc.sent;
	const cm = new CursorManager(
		{ updateProgressBar() {}, removeCursorClasses() {} },
		{ addEntry() {} },
	);
	cm.setExecutionSteps(steps);
	return { cm, channels: () => sent.map((m) => m.ch) };
}

function element(text) {
	return {
		classList: { add() {}, remove() {} },
		scrollIntoView() {},
		innerText: text,
		title: "",
		dataset: {},
	};
}

const BLOCKS = [
	{
		name: "question",
		step: { type: "block", element: element("❓ Why?"), globalIndex: 0 },
		closes: "close-question-window",
	},
	{
		name: "image",
		step: { type: "block", element: element("🖼️ pic.png"), globalIndex: 0 },
		closes: "close-image-window",
	},
	{
		name: "web",
		step: {
			type: "block",
			element: element("🌐 http://example.com"),
			globalIndex: 0,
		},
		closes: "close-web-window",
	},
	{
		name: "move-to",
		step: {
			type: "block",
			subtype: "move-to",
			element: element(""),
			globalIndex: 0,
			target: "MAIN",
		},
		closes: "close-move-to-window",
	},
	{
		name: "code-insert",
		step: {
			type: "block",
			element: element("📋 const x = 1;"),
			globalIndex: 0,
		},
		closes: "close-code-insert-window",
	},
];

for (const block of BLOCKS) {
	test(`resetProgress closes an open ${block.name} block`, () => {
		const { cm, channels } = makeCursorManager([block.step]);

		cm.updateCursor();
		assert.ok(
			!channels().includes(block.closes),
			"nothing is closed just by arriving",
		);

		cm.resetProgress();
		assert.ok(
			channels().includes(block.closes),
			`loading another lesson must send ${block.closes}; leaving it open ` +
				"holds the main process paused and typing dies silently",
		);
	});

	test(`moving on to a character closes an open ${block.name} block`, () => {
		const { cm, channels } = makeCursorManager([
			block.step,
			{ type: "char", char: "a", element: element("a") },
		]);

		cm.updateCursor();
		cm.currentStepIndex = 1;
		cm.updateCursor();

		assert.ok(channels().includes(block.closes));
	});
}

test("resetProgress leaves auto-typing runnable after a move-to block", async () => {
	const { cm, channels } = makeCursorManager([
		{
			type: "block",
			subtype: "move-to",
			element: element(""),
			globalIndex: 0,
			target: "MAIN",
		},
	]);

	cm.updateCursor();
	cm.resetProgress();
	await cm.startAutoTyping();

	assert.ok(
		!channels().includes("auto-typing-complete"),
		"a move-to left open makes startAutoTyping bail out immediately",
	);
	assert.ok(channels().includes("start-auto-type-block"));
});

test("a first-class move-to block is not mistaken for a legacy arrow comment", () => {
	const { cm } = makeCursorManager([
		{
			type: "block",
			subtype: "move-to",
			element: element("➡️ index.html"),
			globalIndex: 0,
			target: "index.html",
		},
	]);

	const seen = [];
	cm.onEnterMoveToBlock = (payload) => seen.push(payload);
	cm.updateCursor();

	assert.equal(seen.length, 1, "the move-to overlay must be asked to open");
	assert.equal(seen[0].mode, "file");
	assert.equal(seen[0].target, "index.html");
});

test("a legacy arrow comment is now an ordinary comment", () => {
	const logged = [];
	const { cm } = makeCursorManager([
		{ type: "block", element: element("➡️ somewhere"), globalIndex: 0 },
	]);
	cm.logManager = { addEntry: (e) => logged.push(e) };
	cm.onEnterMoveToBlock = () => assert.fail("it must open no overlay");

	cm.updateCursor();
	assert.deepEqual(
		logged,
		[],
		"no plan authored this form; move-to is a first-class block",
	);
});

for (const kind of ["move-to", "code-insert"]) {
	test(`auto-typing resumes after a ${kind} only if it was running`, () => {
		const { cm } = makeCursorManager([]);

		cm.autoTypingActive = true;
		cm.suspendAutoTypingFor(kind);
		assert.equal(cm.autoTypingActive, false, `the ${kind} stops it first`);
		assert.equal(
			cm.confirmSpecial(kind),
			true,
			"and confirming asks for it back",
		);

		cm.autoTypingActive = false;
		cm.suspendAutoTypingFor(kind);
		assert.equal(
			cm.confirmSpecial(kind),
			false,
			"but never starts it unasked",
		);
	});
}

test("one popup's suspend does not answer for the other", () => {
	const { cm } = makeCursorManager([]);

	cm.autoTypingActive = true;
	cm.suspendAutoTypingFor("move-to");
	assert.equal(
		cm.confirmSpecial("code-insert"),
		false,
		"confirming a code-insert must not resume what the move-to paused",
	);
	assert.equal(cm.confirmSpecial("move-to"), true);
});

test("confirming a move-to unblocks auto-typing", async () => {
	const { cm, channels } = makeCursorManager([
		{
			type: "block",
			subtype: "move-to",
			element: element(""),
			globalIndex: 0,
			target: "MAIN",
		},
	]);

	cm.updateCursor();
	cm.confirmSpecial("move-to");
	await cm.startAutoTyping();

	assert.ok(channels().includes("start-auto-type-block"));
});

test("an open code-insert holds auto-typing until it is confirmed", async () => {
	const step = {
		type: "block",
		element: element("📋 const x = 1;"),
		globalIndex: 0,
	};
	const { cm, channels } = makeCursorManager([step]);

	cm.updateCursor();
	await cm.startAutoTyping();
	assert.ok(
		!channels().includes("start-auto-type-block"),
		"typing must not run past a code-insert that is still open",
	);

	cm.confirmSpecial("code-insert");
	await cm.startAutoTyping();
	assert.ok(channels().includes("start-auto-type-block"));
});
