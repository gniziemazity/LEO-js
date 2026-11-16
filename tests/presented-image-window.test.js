"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadModule, fakeIpcRenderer } = require("./helpers/load-module.js");

function makeCursorManager() {
	const ipc = fakeIpcRenderer();
	const CursorManager = loadModule("src/renderer/cursor-manager.js", {
		electron: ipc.stub,
	});
	const sent = ipc.sent;
	const cm = new CursorManager({ updateProgressBar() {} }, { addEntry() {} });
	return { cm, sent, types: () => sent.map((m) => m.ch) };
}

test("an image the carousel put up is closed by the next step, like a 🖼️ block", () => {
	const { cm, types } = makeCursorManager();
	cm.markImageWindowOpen();

	cm._leaveSupportBlocksExcept("code");
	assert.ok(
		types().includes("close-image-window"),
		"carrying on auto-typing must take the image down, or it sits over the lesson forever",
	);
});

test("it is asked to close once, not on every step after", () => {
	const { cm, sent } = makeCursorManager();
	cm.markImageWindowOpen();
	cm._leaveSupportBlocksExcept("code");
	cm._leaveSupportBlocksExcept("code");
	cm._leaveSupportBlocksExcept("code");

	assert.equal(
		sent.filter((m) => m.ch === "close-image-window").length,
		1,
		"the flag is cleared by the close it caused",
	);
});

test("a 🖼️ block that follows still owns the window", () => {
	const { cm, sent } = makeCursorManager();
	cm.markImageWindowOpen();

	let asked = null;
	cm.onImageBlock = (name, pin) => (asked = { name, pin });
	cm._enterImageBlock({
		text: "🖼️ diagram.png",
		pin: true,
		globalIndex: 7,
	});

	assert.deepEqual(
		asked,
		{ name: "diagram.png", pin: true },
		"marking a presented image must not swallow the next block's own index",
	);
	assert.equal(
		sent.filter((m) => m.ch === "close-image-window").length,
		0,
		"and entering a block does not close what it is about to replace",
	);
});
