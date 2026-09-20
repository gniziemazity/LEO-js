"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadModule, fakeIpcRenderer } = require("./helpers/load-module.js");
const { buildRemote } = require("./helpers/remote-dom.js");

const MAIN = path.resolve(__dirname, "..", "src/main");

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
		{ updateProgressBar() {}, removeCursorClasses() {} },
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

test("arriving at a code-insert block opens the popup with the code", () => {
	const { cm, logged } = makeCursorManager([codeStep()]);
	const seen = [];
	cm.onEnterCodeInsertBlock = (payload) => seen.push(payload);

	cm.updateCursor();

	assert.equal(seen.length, 1, "the popup must be asked to open");
	assert.equal(seen[0].text, CODE, "the 📋 prefix is stripped");
	assert.deepEqual(logged, [{ code_insert: CODE }]);
});

test("the popup carries coloured lines, one per line of code", () => {
	const { cm } = makeCursorManager([codeStep()]);
	let payload = null;
	cm.onEnterCodeInsertBlock = (p) => (payload = p);

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
	cm.onEnterCodeInsertBlock = (p) => (payload = p);

	cm.updateCursor();

	assert.equal(payload.text, CODE);
	assert.deepEqual(logged, [{ code_insert: CODE }]);
});

test("standing on the block does not re-open or re-log it", () => {
	const { cm, logged } = makeCursorManager([codeStep()]);
	const seen = [];
	cm.onEnterCodeInsertBlock = (p) => seen.push(p);

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
	cm.onEnterCodeInsertBlock = (p) => (payload = p);

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
			"and a later move-to may target it",
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

test("colour spans line up with the stripped text, not the authored text", () => {
	const { cm } = makeCursorManager([codeStep("let a = ⚓0⚓1;\nlet b = 2;")]);
	let payload = null;
	cm.onEnterCodeInsertBlock = (p) => (payload = p);

	cm.updateCursor();

	assert.equal(payload.text, "let a = 1;\nlet b = 2;");
	assert.equal(payload.colored.length, 2);
});

function openPopup(ctx, text = CODE) {
	ctx.api.showCodeInsertOverlay({
		text,
		colored: null,
	});
}

test("the remote popup renders every line of the code", () => {
	const ctx = buildRemote();
	openPopup(ctx);

	assert.equal(
		ctx.nodes.codeInsertOverlay.classList.contains("active"),
		true,
		"the overlay must open",
	);
	assert.equal(ctx.nodes.ciCode.children.length, CODE.split("\n").length);
});

test("Paste is the popup's one action: it pastes and closes", () => {
	const ctx = buildRemote();
	openPopup(ctx);
	assert.equal(ctx.nodes.ciPaste.style.display, "");
	assert.equal(
		ctx.nodes.ciConfirm.style.display,
		"none",
		"an OK beside Paste would be a second, different way to finish",
	);

	ctx.api.codeInsertPaste();
	assert.deepEqual(
		ctx.sent.map((m) => m.type),
		["code-insert-paste"],
		"the host confirms after the paste; a confirm from here would race it",
	);
	assert.equal(
		ctx.nodes.codeInsertOverlay.classList.contains("active"),
		false,
	);
});

test("with Paste off, OK is the way on", () => {
	const ctx = buildRemote();
	ctx.api.showCodeInsertOverlay({ text: CODE, colored: null, paste: false });
	assert.equal(ctx.nodes.ciPaste.style.display, "none");
	assert.equal(ctx.nodes.ciConfirm.style.display, "");

	ctx.api.closeCodeInsertOverlay();
	assert.deepEqual(
		ctx.sent.map((m) => m.type),
		["code-insert-confirmed"],
	);
	assert.equal(
		ctx.nodes.codeInsertOverlay.classList.contains("active"),
		false,
	);

	openPopup(ctx);
	assert.equal(
		ctx.nodes.ciConfirm.style.display,
		"none",
		"the next popup with Paste on hides OK again",
	);
});

test("the host ending the block closes the popup without confirming again", () => {
	const ctx = buildRemote();
	openPopup(ctx);

	ctx.api.closeCodeInsertOverlayUI();

	assert.equal(
		ctx.nodes.codeInsertOverlay.classList.contains("active"),
		false,
	);
	assert.deepEqual(
		ctx.sent.map((m) => m.type),
		[],
		"a host-driven close must not echo a confirm back",
	);
});

test("with the pad over it, the popup keeps its own Paste and OK", async () => {
	const ctx = buildRemote();
	ctx.api.setSessionActive(true);
	await ctx.api.setTouchpadMode("keyboard");
	openPopup(ctx);

	assert.equal(
		ctx.nodes.codeInsertOverlay.classList.contains("pad-lifted"),
		true,
		"the popup goes above the pad so its own buttons can be pressed",
	);
	assert.notEqual(
		ctx.nodes.ciActions.style.display,
		"none",
		"the buttons stay where the thumb last saw them",
	);

	ctx.api.closeCodeInsertOverlayUI();
	assert.equal(
		ctx.nodes.codeInsertOverlay.classList.contains("pad-lifted"),
		false,
		"and the lift is dropped with the popup",
	);
});

test("the keyboard pad stays open over a code-insert popup", async () => {
	const ctx = buildRemote();
	ctx.api.setSessionActive(true);
	await ctx.api.setTouchpadMode("keyboard");

	openPopup(ctx);

	assert.equal(
		ctx.api.padMode(),
		"keyboard",
		"there is nothing to point at, so the pad is left alone",
	);
});

test("the code is on the clipboard for exactly as long as the block is open", () => {
	const src = fs.readFileSync(path.join(MAIN, "popups.js"), "utf-8");

	const entry = /"code-insert": \{[\s\S]*?\n\t\},/.exec(src)[0];
	assert.match(entry, /onEnter: \(payload\) => holdCodeOnClipboard\(/);
	assert.match(entry, /onExit: \(\) => releaseCodeFromClipboard\(\)/);

	const hold = /function holdCodeOnClipboard\(payload\)[\s\S]*?\n\}/.exec(
		src,
	)[0];
	assert.match(
		hold,
		/previous: clipboard\.readText\(\)/,
		"what the teacher had copied must be remembered before we take the clipboard",
	);
	assert.match(hold, /clipboard\.writeText\(code\)/);
	assert.match(
		hold,
		/payload\.paste === false\) return/,
		"holding the clipboard exists to enable Ctrl+V; with Paste off it only clobbers",
	);

	const release = /function releaseCodeFromClipboard\(\)[\s\S]*?\n\}/.exec(
		src,
	)[0];
	assert.match(
		release,
		/if \(clipboard\.readText\(\) === held\.code\) clipboard\.writeText\(held\.previous\)/,
		"restoring blindly would clobber whatever was copied while the block was open",
	);
});

test("the Paste button re-asserts the code before pressing Ctrl+V", () => {
	const src = fs.readFileSync(path.join(MAIN, "popups.js"), "utf-8");
	const fn = /async function pasteCodeInsert\(\)[\s\S]*?\n\}/.exec(src)[0];

	assert.match(
		fn,
		/if \(!held\) return;/,
		"no open block means nothing to paste",
	);
	assert.match(
		fn,
		/if \(clipboard\.readText\(\) !== held\.code\) clipboard\.writeText\(held\.code\)/,
		"the button means paste THIS, even if something else took the clipboard",
	);
	assert.match(fn, /keyboard\.type\(modifier, Key\.V\)/);
});

test("on the phone the Paste button is the one that shows", () => {
	const ctx = buildRemote();
	openPopup(ctx);

	assert.equal(ctx.nodes.ciPaste.style.display, "");
});

test("the code never reaches the remote as a keystroke stream", () => {
	const src = fs.readFileSync(
		path.resolve(__dirname, "..", "src/shared/remote/code-insert-overlay.js"),
		"utf-8",
	);
	assert.match(src, /sendMessage\("code-insert-paste", \{\}\)/);
	assert.doesNotMatch(
		src,
		/remote-edit-key/,
		"a bare Ctrl\\+V would paste whatever the teacher had copied, not the block",
	);
});
