"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadModule, fakeIpcRenderer } = require("./helpers/load-module.js");

function makeCursorManager(steps) {
	const ipc = fakeIpcRenderer({
		invoke: async () => ({ autoTypingSpeed: 10 }),
	});
	const CursorManager = loadModule("src/renderer/cursor-manager.js", {
		electron: ipc.stub,
	});
	const cm = new CursorManager({ updateProgressBar() {} }, { addEntry() {} });
	cm.setExecutionSteps(steps.map((s, i) => ({ ...s, globalIndex: i })));
	return { cm, sent: ipc.sent };
}

const element = () => ({
	classList: { add() {}, remove() {} },
	scrollIntoView() {},
	dataset: {},
});
const block = (text, extra) => ({
	type: "block",
	text,
	element: element(),
	...extra,
});
const char = (c = "a") => ({ type: "char", char: c, element: element() });

const PAUSING = [
	["note", block("Remember this")],
	["move-to", block("", { kind: "move-to", target: "MAIN" })],
	["code-insert", block("📋 const x = 1;")],
	["image", block("🖼️ pic.png")],
	["web", block("🌐 http://example.com")],
];

for (const [kind, step] of PAUSING) {
	test(`OK on a ${kind} moves on, so the next key types`, () => {
		const { cm, sent } = makeCursorManager([step, char("x")]);
		cm.updateCursor();
		cm.confirmSpecial(kind);
		assert.equal(cm.currentStepIndex, 1, "the block is passed on OK");

		sent.length = 0;
		cm.advanceCursor();
		assert.deepEqual(
			sent.find((m) => m.ch === "type-character"),
			{ ch: "type-character", payload: "x" },
			"the first key after OK types, instead of only leaving the block",
		);
	});
}

test("the popup after the one confirmed opens straight away", () => {
	const { cm } = makeCursorManager([
		block("", { kind: "move-to", target: "MAIN" }),
		block("Now explain it"),
		char(),
	]);
	const notes = [];
	cm.onEnterNoteBlock = (p) => notes.push(p.text);
	cm.updateCursor();
	cm.confirmSpecial("move-to");
	assert.deepEqual(notes, ["Now explain it"]);
	assert.equal(cm.currentStepIndex, 1);
});

test("a confirm that arrives after the cursor left moves nothing", () => {
	const { cm } = makeCursorManager([block("Remember this"), char(), char()]);
	cm.updateCursor();
	cm.currentStepIndex = 1;
	cm.updateCursor();
	cm.confirmSpecial("note");
	assert.equal(cm.currentStepIndex, 1);
});

test("a question moves on once its window has closed", () => {
	const { cm } = makeCursorManager([block("❓ Why?"), char()]);
	cm.updateCursor();
	cm.questionWindowClosed();
	assert.equal(cm.currentStepIndex, 1);
});

test("a question window closing after a key moved on changes nothing", () => {
	const { cm } = makeCursorManager([block("❓ Why?"), char(), char()]);
	cm.updateCursor();
	cm.advanceCursor();
	assert.equal(cm.currentStepIndex, 1);
	cm.questionWindowClosed();
	assert.equal(cm.currentStepIndex, 1, "the key already passed it");
});

test("two questions in a row: closing the first opens the second", () => {
	const { cm } = makeCursorManager([
		block("❓ First?"),
		block("❓ Second?"),
		char(),
	]);
	const asked = [];
	cm.onEnterQuestionBlock = (q) => asked.push(q);
	cm.updateCursor();
	cm.questionWindowClosed();
	assert.deepEqual(asked, ["First?", "Second?"]);
	cm.questionWindowClosed();
	assert.equal(cm.currentStepIndex, 2);
});

test("the renderer passes a question when its window reports closed", () => {
	const app = fs.readFileSync(
		path.resolve(__dirname, "..", "src/renderer/app.js"),
		"utf-8",
	);
	const handler =
		/ipcRenderer\.on\("question-window-closed"[\s\S]*?\n\t\}\);/.exec(app);
	assert.ok(handler);
	assert.match(handler[0], /cursorManager\.questionWindowClosed\(\)/);
	assert.ok(
		handler[0].indexOf("finalizeTeacherQuestion") <
			handler[0].indexOf("questionWindowClosed"),
		"the question is logged before the next block can open",
	);
});
