"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadModule, fakeIpcRenderer } = require("./helpers/load-module.js");
const { buildRemote } = require("./helpers/remote-dom.js");
const { extractGoToExcerpt } = require("../src/renderer/plan-replay.js");
const {
	buildArtificialLogEvents,
} = require("../src/renderer/log-event-builder.js");
const { expandEvents } = require("../lesson_tools/shared/simulator-model.js");

const CROSS_FILE_BLOCKS = [
	{ type: "code", text: "let x = 1;" },
	{ type: "go-to", target: "other.js" },
	{ type: "code", text: "other line ⚓3⚓ here" },
	{ type: "go-to", target: "style.css" },
	{ type: "code", text: "body { }" },
	{ type: "go-to", target: "⚓3⚓" },
];

function goToStep(target, excerpt) {
	return {
		type: "block",
		blockType: "go-to",
		target,
		excerpt,
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
		{ updateProgressBar() {} },
		{ addEntry: (entry) => logged.push(entry) },
	);
	cm.setExecutionSteps([step]);
	return { cm, logged };
}

test("the keylog opens the file before it jumps to the anchor", () => {
	const excerpt = extractGoToExcerpt("⚓3⚓", 5, CROSS_FILE_BLOCKS, 1, 1);
	assert.equal(excerpt.switchTo, "other.js");

	const { cm, logged } = cursorManagerOn(goToStep("⚓3⚓", excerpt));
	cm.updateCursor();

	assert.deepEqual(
		logged,
		[{ move_to: "other.js" }, { move_to: "⚓3⚓" }],
		"the file switch must be logged first, or replay jumps inside the wrong file",
	);
});

test("an anchor in the current file logs one move_to, as before", () => {
	const excerpt = extractGoToExcerpt("⚓3⚓", 3, CROSS_FILE_BLOCKS, 1, 1);
	assert.equal(excerpt.switchTo, null);

	const { cm, logged } = cursorManagerOn(goToStep("⚓3⚓", excerpt));
	cm.updateCursor();

	assert.deepEqual(logged, [{ move_to: "⚓3⚓" }]);
});

test("the artificial log carries the same implicit switch", () => {
	const excerpt = extractGoToExcerpt("⚓3⚓", 5, CROSS_FILE_BLOCKS, 1, 1);
	const events = buildArtificialLogEvents([goToStep("⚓3⚓", excerpt)]);

	assert.deepEqual(
		events.map((e) => e.move_to),
		["other.js", "⚓3⚓"],
		"a generated log must replay the same way a recorded one does",
	);
});

test("replay expands the pair into a file switch and then a jump", () => {
	const excerpt = extractGoToExcerpt("⚓3⚓", 5, CROSS_FILE_BLOCKS, 1, 1);
	const events = buildArtificialLogEvents([goToStep("⚓3⚓", excerpt)]);

	assert.deepEqual(
		expandEvents(events).map((m) => [m[0], m[1]]),
		[
			["switch_file", "other.js"],
			["move_anchor", "⚓3⚓"],
		],
		"move_anchor only searches the active file — the switch is what makes it land",
	);
});

test("a go-to with no excerpt at all still logs its target", () => {
	const { cm, logged } = cursorManagerOn(goToStep("MAIN", null));
	cm.updateCursor();
	assert.deepEqual(logged, [{ move_to: "MAIN" }]);
});

function showAnchor(ctx, switchTo) {
	ctx.api.showGoToOverlay({
		mode: "anchor",
		target: "⚓3⚓",
		excerpt: {
			lines: ["other line  here"],
			colored: null,
			arrowIdx: 0,
			anchorCol: 11,
			switchTo,
		},
	});
	return ctx.nodes.gtoTitle.textContent;
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

test("the excerpt shown is still the anchor's own file", () => {
	const ctx = buildRemote();
	showAnchor(ctx, "other.js");
	assert.equal(ctx.nodes.gtoExcerpt.style.display, "block");
	assert.equal(ctx.nodes.gtoTarget.style.display, "none");
});

test("a file go-to shows the name and the code where auto-typing left it", () => {
	const ctx = buildRemote();
	const excerpt = extractGoToExcerpt("other.js", 5, CROSS_FILE_BLOCKS);
	ctx.api.showGoToOverlay({ mode: "file", target: "other.js", excerpt });

	assert.equal(ctx.nodes.gtoTitle.textContent, "Go to:");
	assert.equal(ctx.nodes.gtoTarget.textContent, "other.js");
	assert.notEqual(ctx.nodes.gtoTarget.style.display, "none");
	assert.equal(ctx.nodes.gtoExcerpt.style.display, "block");
	assert.equal(ctx.nodes.gtoExcerpt.children.length, 1);

	ctx.api.showGoToOverlay({ mode: "file", target: "new.js", excerpt: null });
	assert.equal(
		ctx.nodes.gtoExcerpt.style.display,
		"none",
		"a excerpt from the last popup must not linger",
	);
});

test("a file go-to logs its target once", () => {
	const excerpt = extractGoToExcerpt("other.js", 5, CROSS_FILE_BLOCKS);
	assert.ok(excerpt);
	const { cm, logged } = cursorManagerOn(goToStep("other.js", excerpt));
	cm.updateCursor();
	assert.deepEqual(logged, [{ move_to: "other.js" }]);
});

test("file, main and dev go-tos with nothing typed just name their target", () => {
	const ctx = buildRemote();

	ctx.api.showGoToOverlay({ mode: "file", target: "index.html" });
	assert.equal(ctx.nodes.gtoTitle.textContent, "Go to:");
	assert.equal(ctx.nodes.gtoTarget.textContent, "index.html");

	ctx.api.showGoToOverlay({ mode: "main", target: "MAIN" });
	assert.equal(ctx.nodes.gtoTarget.textContent, "Main Editor");

	ctx.api.showGoToOverlay({ mode: "dev", target: "DEV" });
	assert.equal(ctx.nodes.gtoTarget.textContent, "Dev Tools");
});
