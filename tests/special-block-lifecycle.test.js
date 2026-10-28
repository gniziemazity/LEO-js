"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadModule, fakeIpcRenderer } = require("./helpers/load-module.js");

function makeCursorManager(steps) {
	const ipc = fakeIpcRenderer({
		invoke: async () => ({ autoRunSpeed: 10 }),
	});
	const CursorManager = loadModule("src/renderer/cursor-manager.js", {
		electron: ipc.stub,
	});
	const sent = ipc.sent;
	const cm = new CursorManager({ updateProgressBar() {} }, { addEntry() {} });
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

function blockStep(text, extra) {
	return {
		type: "block",
		text,
		element: element(text),
		globalIndex: 0,
		...extra,
	};
}

const BLOCKS = [
	{
		name: "note",
		step: blockStep("Remember the semicolon"),
		closes: "close-note-popup",
	},
	{
		name: "question",
		step: blockStep("❓ Why?"),
		closes: "close-question-window",
	},
	{
		name: "image",
		step: blockStep("🖼️ pic.png"),
		closes: "close-image-window",
	},
	{
		name: "web",
		step: blockStep("🌐 http://example.com"),
		closes: "close-web-window",
	},
	{
		name: "go-to",
		step: blockStep("", { blockType: "go-to", target: "MAIN" }),
		closes: "close-go-to-popup",
	},
	{
		name: "snippet",
		step: blockStep("📋 const x = 1;"),
		closes: "close-snippet-popup",
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
				"holds the main process paused and auto-typing dies silently",
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

test("resetProgress leaves auto-run runnable after a go-to block", async () => {
	const { cm, channels } = makeCursorManager([
		{
			type: "block",
			blockType: "go-to",
			element: element(""),
			globalIndex: 0,
			target: "MAIN",
		},
	]);

	cm.updateCursor();
	cm.resetProgress();
	await cm.startAutoRun();

	assert.ok(
		!channels().includes("auto-run-complete"),
		"a go-to left open makes startAutoRun bail out immediately",
	);
	assert.ok(channels().includes("start-auto-run-block"));
});

test("a first-class go-to block is not mistaken for a legacy arrow comment", () => {
	const { cm } = makeCursorManager([
		{
			type: "block",
			blockType: "go-to",
			element: element("➡️ index.html"),
			globalIndex: 0,
			target: "index.html",
		},
	]);

	const seen = [];
	cm.onEnterGoToBlock = (payload) => seen.push(payload);
	cm.updateCursor();

	assert.equal(seen.length, 1, "the go-to overlay must be asked to open");
	assert.equal(seen[0].mode, "file");
	assert.equal(seen[0].target, "index.html");
});

test("a legacy arrow comment is now an ordinary comment", () => {
	const logged = [];
	const { cm } = makeCursorManager([
		{ type: "block", element: element("➡️ somewhere"), globalIndex: 0 },
	]);
	cm.logManager = { addEntry: (e) => logged.push(e) };
	cm.onEnterGoToBlock = () => assert.fail("it must open no overlay");

	cm.updateCursor();
	assert.deepEqual(
		logged,
		[],
		"no plan authored this form; go-to is a first-class block",
	);
});

for (const type of ["go-to", "snippet"]) {
	test(`auto-run resumes after a ${type} only if it was running`, () => {
		const { cm } = makeCursorManager([]);

		cm.autoRunActive = true;
		cm.suspendAutoRunFor(type);
		assert.equal(cm.autoRunActive, false, `the ${type} stops it first`);
		assert.equal(
			cm.confirmSpecial(type),
			true,
			"and confirming asks for it back",
		);

		cm.autoRunActive = false;
		cm.suspendAutoRunFor(type);
		assert.equal(
			cm.confirmSpecial(type),
			false,
			"but never starts it unasked",
		);
	});
}

test("one popup's suspend does not answer for the other", () => {
	const { cm } = makeCursorManager([]);

	cm.autoRunActive = true;
	cm.suspendAutoRunFor("go-to");
	assert.equal(
		cm.confirmSpecial("snippet"),
		false,
		"confirming a snippet must not resume what the go-to paused",
	);
	assert.equal(cm.confirmSpecial("go-to"), true);
});

test("confirming a go-to unblocks auto-run", async () => {
	const { cm, channels } = makeCursorManager([
		{
			type: "block",
			blockType: "go-to",
			element: element(""),
			globalIndex: 0,
			target: "MAIN",
		},
	]);

	cm.updateCursor();
	cm.confirmSpecial("go-to");
	await cm.startAutoRun();

	assert.ok(channels().includes("start-auto-run-block"));
});

test("an open snippet holds auto-run until it is confirmed", async () => {
	const step = blockStep("📋 const x = 1;");
	const { cm, channels } = makeCursorManager([step]);

	cm.updateCursor();
	await cm.startAutoRun();
	assert.ok(
		!channels().includes("start-auto-run-block"),
		"auto-typing must not run past a snippet that is still open",
	);

	cm.confirmSpecial("snippet");
	await cm.startAutoRun();
	assert.ok(channels().includes("start-auto-run-block"));
});
