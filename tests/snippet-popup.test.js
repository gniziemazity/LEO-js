"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadModule, fakeIpcRenderer } = require("./helpers/load-module.js");
const { buildRemote } = require("./helpers/remote-dom.js");

function element(text) {
	return {
		classList: { add() {}, remove() {} },
		scrollIntoView() {},
		innerText: text,
		dataset: {},
	};
}

function makeCursorManager(steps) {
	const ipc = fakeIpcRenderer({ invoke: async () => ({}) });
	const CursorManager = loadModule("src/renderer/cursor-manager.js", {
		electron: ipc.stub,
	});
	const logged = [];
	const cm = new CursorManager(
		{ updateProgressBar() {} },
		{ addEntry: (entry) => logged.push(entry) },
	);
	cm.setExecutionSteps(steps);
	return { cm, logged, channels: () => ipc.sent.map((m) => m.ch) };
}

const CODE = "function greet(name) {\n\tconsole.log(name);\n}";

function codeStep(text = CODE) {
	return {
		type: "block",
		text: "📋 " + text,
		element: element("📋 " + text),
		globalIndex: 0,
	};
}

test("arriving at a snippet block opens the popup with the code", () => {
	const { cm, logged } = makeCursorManager([codeStep()]);
	const seen = [];
	cm.onEnterSnippetBlock = (payload) => seen.push(payload);

	cm.updateCursor();

	assert.equal(seen.length, 1, "the popup must be asked to open");
	assert.equal(seen[0].text, CODE, "the 📋 prefix is stripped");
	assert.deepEqual(logged, [{ code_insert: CODE }]);
});

test("the popup carries coloured lines, one per line of code", () => {
	const { cm } = makeCursorManager([codeStep()]);
	let payload = null;
	cm.onEnterSnippetBlock = (p) => (payload = p);

	cm.updateCursor();

	assert.ok(Array.isArray(payload.colored));
	assert.equal(
		payload.colored.length,
		CODE.split("\n").length,
		"the remote renders line i from colored[i]",
	);
});

test("a collapsed multi-line block sends the full text, not the preview", () => {
	const step = codeStep();
	step.element.innerText = "📋 function greet(name) {...";
	step.text = "📋 " + CODE;
	const { cm, logged } = makeCursorManager([step]);
	let payload = null;
	cm.onEnterSnippetBlock = (p) => (payload = p);

	cm.updateCursor();

	assert.equal(payload.text, CODE);
	assert.deepEqual(logged, [{ code_insert: CODE }]);
});

test("standing on the block does not re-open or re-log it", () => {
	const { cm, logged } = makeCursorManager([codeStep()]);
	const seen = [];
	cm.onEnterSnippetBlock = (p) => seen.push(p);

	cm.updateCursor();
	cm.updateCursor();
	cm.updateCursor();

	assert.equal(seen.length, 1);
	assert.equal(logged.length, 1);
});

test("anchors are stripped from what is shown and pasted, but kept in the log", () => {
	const withAnchors = "function f() {\n\treturn ⚓0⚓1;\n}⚓7⚓";
	const { cm, logged } = makeCursorManager([codeStep(withAnchors)]);
	let payload = null;
	cm.onEnterSnippetBlock = (p) => (payload = p);

	cm.updateCursor();

	assert.equal(
		payload.text,
		"function f() {\n\treturn 1;\n}",
		"a ⚓id⚓ marker pasted literally would land in the student's editor",
	);
	assert.deepEqual(
		logged,
		[{ code_insert: withAnchors }],
		"the log keeps them: replay sets the anchor at that spot instead of typing it, " +
			"and a later go-to may target it",
	);
});

test("stripping drops exactly what the replay drops (one line: no auto-indent in play)", () => {
	const { stripAnchors } = require("../src/shared/code-text.js");
	const {
		TextState,
		applyAtomicText,
	} = require("../lesson_tools/shared/simulator-model.js");

	for (const text of [
		"a⚓0⚓b",
		"⚓1⚓start",
		"end⚓2⚓",
		"⚓⚓empty",
		"none at all",
		"two⚓3⚓in⚓4⚓one",
	]) {
		const state = new TextState();
		applyAtomicText(state, text);
		assert.equal(
			stripAnchors(text),
			state.text,
			`${JSON.stringify(text)}: the popup must show the same text replay ` +
				"inserts — the anchor becomes a position, never characters",
		);
	}
});

function openPopup(ctx, text = CODE) {
	ctx.api.setAutoTypingActive(true);
	ctx.api.showSnippetOverlay({
		text,
		colored: null,
	});
}

test("the remote popup renders every line of the code", () => {
	const ctx = buildRemote();
	openPopup(ctx);

	assert.equal(
		ctx.nodes.snippetOverlay.classList.contains("active"),
		true,
		"the overlay must open",
	);
	assert.equal(ctx.nodes.snCode.children.length, CODE.split("\n").length);
});

test("Paste is the popup's one action: it pastes and closes", () => {
	const ctx = buildRemote();
	openPopup(ctx);
	assert.equal(ctx.nodes.snPaste.style.display, "");
	assert.equal(
		ctx.nodes.snConfirm.style.display,
		"none",
		"an OK beside Paste would be a second, different way to finish",
	);

	ctx.api.snippetPaste();
	assert.deepEqual(
		ctx.sent.map((m) => m.type),
		["snippet-paste"],
		"the host confirms after the paste; a confirm from here would race it",
	);
	assert.equal(ctx.nodes.snippetOverlay.classList.contains("active"), false);
});

test("with Paste off, OK is the way on", () => {
	const ctx = buildRemote();
	ctx.api.showSnippetOverlay({ text: CODE, colored: null, paste: false });
	assert.equal(ctx.nodes.snPaste.style.display, "none");
	assert.equal(ctx.nodes.snConfirm.style.display, "");

	ctx.api.closeSnippetOverlay();
	assert.deepEqual(
		ctx.sent.map((m) => m.type),
		["snippet-confirmed"],
	);
	assert.equal(ctx.nodes.snippetOverlay.classList.contains("active"), false);

	openPopup(ctx);
	assert.equal(
		ctx.nodes.snConfirm.style.display,
		"none",
		"the next popup with Paste on hides OK again",
	);
});

test("the host ending the block closes the popup without confirming again", () => {
	const ctx = buildRemote();
	openPopup(ctx);

	ctx.api.closeSnippetOverlayUI();

	assert.equal(ctx.nodes.snippetOverlay.classList.contains("active"), false);
	assert.deepEqual(
		ctx.sent.map((m) => m.type),
		[],
		"a host-driven close must not echo a confirm back",
	);
});
