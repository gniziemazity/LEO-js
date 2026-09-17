"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadModule, fakeIpcRenderer } = require("./helpers/load-module.js");
const { buildRemote } = require("./helpers/remote-dom.js");
const { extractAnchorSnippet } = require("../src/renderer/anchor-snippet.js");
const {
	buildArtificialLogEvents,
} = require("../src/renderer/log-event-builder.js");
const { expandEvents } = require("../lesson_tools/shared/simulator-model.js");

const CROSS_FILE_BLOCKS = [
	{ type: "code", text: "let x = 1;" },
	{ type: "move-to", target: "other.js" },
	{ type: "code", text: "other line ⚓3⚓ here" },
	{ type: "move-to", target: "style.css" },
	{ type: "code", text: "body { }" },
	{ type: "move-to", target: "⚓3⚓" },
];

function moveToStep(target, snippet) {
	return {
		type: "block",
		kind: "move-to",
		target,
		snippet,
		globalIndex: 0,
		element: {
			innerText: "",
			title: "",
			classList: { add() {}, remove() {} },
			scrollIntoView() {},
		},
	};
}

function cursorManagerOn(step) {
	const ipc = fakeIpcRenderer({ invoke: async () => ({}) });
	const CursorManager = loadModule("src/renderer/cursor-manager.js", {
		electron: ipc.stub,
	});
	const logged = [];
	const cm = new CursorManager(
		{ updateProgressBar() {}, removeCursorClasses() {} },
		{ addEntry: (entry) => logged.push(entry) },
	);
	cm.setExecutionSteps([step]);
	return { cm, logged };
}

test("the keylog opens the file before it jumps to the anchor", () => {
	const snippet = extractAnchorSnippet("⚓3⚓", 5, CROSS_FILE_BLOCKS, 1, 1);
	assert.equal(snippet.switchTo, "other.js");

	const { cm, logged } = cursorManagerOn(moveToStep("⚓3⚓", snippet));
	cm.updateCursor();

	assert.deepEqual(
		logged,
		[{ move_to: "other.js" }, { move_to: "⚓3⚓" }],
		"the file switch must be logged first, or replay jumps inside the wrong file",
	);
});

test("an anchor in the current file logs one move_to, as before", () => {
	const snippet = extractAnchorSnippet("⚓3⚓", 3, CROSS_FILE_BLOCKS, 1, 1);
	assert.equal(snippet.switchTo, null);

	const { cm, logged } = cursorManagerOn(moveToStep("⚓3⚓", snippet));
	cm.updateCursor();

	assert.deepEqual(logged, [{ move_to: "⚓3⚓" }]);
});

test("the artificial log carries the same implicit switch", () => {
	const snippet = extractAnchorSnippet("⚓3⚓", 5, CROSS_FILE_BLOCKS, 1, 1);
	const events = buildArtificialLogEvents([moveToStep("⚓3⚓", snippet)]);

	assert.deepEqual(
		events.map((e) => e.move_to),
		["other.js", "⚓3⚓"],
		"a generated log must replay the same way a recorded one does",
	);
});

test("replay expands the pair into a file switch and then a jump", () => {
	const snippet = extractAnchorSnippet("⚓3⚓", 5, CROSS_FILE_BLOCKS, 1, 1);
	const events = buildArtificialLogEvents([moveToStep("⚓3⚓", snippet)]);

	assert.deepEqual(
		expandEvents(events).map((m) => [m[0], m[1]]),
		[
			["switch_file", "other.js"],
			["move_anchor", "⚓3⚓"],
		],
		"move_anchor only searches the active file — the switch is what makes it land",
	);
});

test("a move-to with no snippet at all still logs its target", () => {
	const { cm, logged } = cursorManagerOn(moveToStep("MAIN", null));
	cm.updateCursor();
	assert.deepEqual(logged, [{ move_to: "MAIN" }]);
});

function showAnchor(ctx, switchTo) {
	ctx.api.showMoveToOverlay({
		mode: "anchor",
		target: "⚓3⚓",
		snippet: {
			lines: ["other line  here"],
			colored: null,
			arrowIdx: 0,
			anchorCol: 11,
			switchTo,
		},
	});
	return ctx.nodes.mtoTitle.textContent;
}

test("the popup names the file to open in its title", () => {
	assert.equal(showAnchor(buildRemote(), "other.js"), "Go to (other.js):");
	assert.equal(
		showAnchor(buildRemote(), "MAIN"),
		"Go to (Main Editor):",
		"a jump back to the main editor is a switch too",
	);
	assert.equal(showAnchor(buildRemote(), "DEV"), "Go to (Dev Tools):");
});

test("an anchor in the file already open keeps the plain title", () => {
	assert.equal(showAnchor(buildRemote(), null), "Go to:");
});

test("the snippet shown is still the anchor's own file", () => {
	const ctx = buildRemote();
	showAnchor(ctx, "other.js");
	assert.equal(ctx.nodes.mtoSnippet.style.display, "block");
	assert.equal(ctx.nodes.mtoTarget.style.display, "none");
});

test("plain file, main and dev move-tos are unchanged", () => {
	const ctx = buildRemote();

	ctx.api.showMoveToOverlay({ mode: "file", target: "index.html" });
	assert.equal(ctx.nodes.mtoTitle.textContent, "Go to:");
	assert.equal(ctx.nodes.mtoTarget.textContent, "index.html");

	ctx.api.showMoveToOverlay({ mode: "main", target: "MAIN" });
	assert.equal(ctx.nodes.mtoTarget.textContent, "Main Editor");

	ctx.api.showMoveToOverlay({ mode: "dev", target: "DEV" });
	assert.equal(ctx.nodes.mtoTarget.textContent, "Dev Tools");
});
