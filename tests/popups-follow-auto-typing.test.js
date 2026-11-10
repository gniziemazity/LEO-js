"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildRemote } = require("./helpers/remote-dom.js");

const SRC = path.resolve(__dirname, "..", "src");
const css = fs.readFileSync(path.join(SRC, "shared/styles.css"), "utf-8");

const active = (ctx, id) => ctx.nodes[id].classList.contains("active");

test("a block popup that arrives while auto-typing is off waits, and shows when it starts", () => {
	const ctx = buildRemote();
	ctx.api.showNoteOverlay({ text: "Slow down here" });
	assert.equal(active(ctx, "noteOverlay"), false, "off: nothing on screen");
	assert.equal(ctx.nodes.ntText.textContent, "Slow down here");

	ctx.api.setAutoTypingActive(true);
	assert.equal(active(ctx, "noteOverlay"), true, "on: the note appears");
});

test("switching auto-typing off hides every open block popup, and on brings it back", () => {
	const ctx = buildRemote();
	ctx.api.setAutoTypingActive(true);
	ctx.api.showGoToOverlay({ mode: "main", target: "MAIN" });
	ctx.api.showQuestionOverlay("Why?", ["Ada"], null, null);
	assert.equal(active(ctx, "goToOverlay"), true);
	assert.equal(active(ctx, "questionOverlay"), true);

	ctx.api.setAutoTypingActive(false);
	assert.equal(active(ctx, "goToOverlay"), false);
	assert.equal(active(ctx, "questionOverlay"), false);
	assert.deepEqual(
		ctx.interactionBtns.map((b) => b.style.display),
		["", ""],
		"the question popup had hidden ❓ / 🤝; with it gone they come back",
	);
	assert.deepEqual(ctx.sent, [], "hiding confirms nothing on the host");

	ctx.api.setAutoTypingActive(true);
	assert.equal(active(ctx, "goToOverlay"), true);
	assert.equal(active(ctx, "questionOverlay"), true);
});

test("a popup the host ends while it is hidden does not come back", () => {
	const ctx = buildRemote();
	ctx.api.setAutoTypingActive(true);
	ctx.api.showSnippetOverlay({ text: "let a = 1;", colored: null });
	ctx.api.setAutoTypingActive(false);
	ctx.api.closeSnippetOverlayUI();

	ctx.api.setAutoTypingActive(true);
	assert.equal(active(ctx, "snippetOverlay"), false);
});

test("the ❓ / 🤝 picker is not a block popup: it opens whether or not auto-typing is on", () => {
	const ctx = buildRemote();
	ctx.api.setStudents(["Ada"]);
	ctx.api.handleInteractionBtn("providing-help");
	assert.equal(active(ctx, "interactionOverlay"), true);

	ctx.api.setAutoTypingActive(true);
	ctx.api.setAutoTypingActive(false);
	assert.equal(active(ctx, "interactionOverlay"), true);
});

test("the mode buttons are re-measured whenever their column changes size", () => {
	let observed = null;
	let callback = null;
	class FakeResizeObserver {
		constructor(cb) {
			callback = cb;
		}
		observe(el) {
			observed = el;
		}
	}
	const ctx = buildRemote({ ResizeObserver: FakeResizeObserver });
	ctx.api.initTouchpad();
	assert.equal(observed, ctx.nodes.modeSideBtns);

	ctx.nodes.modeSideBtns.offsetHeight = 300;
	callback();
	assert.equal(
		ctx.root.style["--modes-extent"],
		"300px",
		"entering fullscreen resizes the buttons after the pad opened; the bar must follow",
	);
});

test("the desk card sits along the bottom edge, full width", () => {
	const rule = /\n\.desk-popup \{[\s\S]*?\n\}/.exec(css)[0];
	assert.match(rule, /\n\tleft: 0;\n\tright: 0;\n\tbottom: 0;/);
	assert.doesNotMatch(rule, /translate|\n\ttop:|\n\twidth:/);
	assert.match(rule, /\n\tdisplay: none;/);
});

test("the desk card shows only while auto-typing is on, except the ❓ / 🤝 card", () => {
	assert.match(
		css,
		/body\.auto-typing-active \.desk-popup\.open,\n\.desk-popup\.open\.interaction-card \{\n\tdisplay: block;\n\}/,
	);

	const made = [];
	const makeEl = () => {
		const el = {
			style: {},
			children: [],
			className: "",
			classList: { add() {}, remove() {}, contains: () => false },
			appendChild(c) {
				el.children.push(c);
				return c;
			},
			addEventListener() {},
		};
		Object.defineProperty(el, "innerHTML", {
			set: () => (el.children.length = 0),
			get: () => "",
		});
		made.push(el);
		return el;
	};
	global.document = { createElement: makeEl, body: makeEl() };
	const DeskPopup = require("../src/renderer/desk-popup");
	const popup = new DeskPopup(() => {});

	popup.showNote({ text: "x" });
	assert.equal(popup.el.className, "desk-popup open");
	assert.equal(popup.el.style.display, undefined, "visibility is CSS's job");

	popup.close();
	assert.equal(popup.el.className, "desk-popup");

	popup.setStudents(["Ada"]);
	popup.showInteraction("providing-help");
	assert.equal(popup.el.className, "desk-popup open interaction-card");
	delete global.document;
});
