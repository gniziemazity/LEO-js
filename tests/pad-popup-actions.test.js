"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildRemote: build } = require("./helpers/remote-dom.js");

async function openKeyboardPad(ctx) {
	ctx.api.setAutoTypingActive(true);
	await ctx.api.setTouchpadMode("keyboard");
}

function barLabels(nodes) {
	return nodes.touchpadActionBar.children.map(
		(btn) => btn.children[0].textContent,
	);
}

test("a question opening under the pad hands its buttons to the pad", async () => {
	const ctx = build();
	await openKeyboardPad(ctx);
	assert.deepEqual(barLabels(ctx.nodes), [], "nothing to mirror yet");

	ctx.api.showQuestionOverlay(
		"What is a closure?",
		["Ada", "Linus"],
		null,
		null,
	);

	assert.equal(
		ctx.nodes.touchpadOverlay.classList.contains("active"),
		true,
		"the pad stays open over a question",
	);
	assert.deepEqual(barLabels(ctx.nodes), ["Show", "✕"]);
	assert.equal(
		ctx.nodes.touchpadActionBar.classList.contains("visible"),
		true,
	);
});

test("pressing the mirrored Show does the real thing and the bar follows along", async () => {
	const ctx = build();
	await openKeyboardPad(ctx);
	ctx.api.showQuestionOverlay("Why?", ["Ada"], null, null);
	ctx.sent.length = 0;

	ctx.nodes.touchpadActionBar.children[0].onclick();

	assert.deepEqual(
		ctx.sent.map((m) => m.type),
		["show-question"],
		"the mirror is the same action, not a copy of it",
	);
	assert.deepEqual(
		barLabels(ctx.nodes),
		["✕"],
		"and Show drops off once the question is on screen",
	);
});

test("dismissing from the pad closes the popup and clears the bar", async () => {
	const ctx = build();
	await openKeyboardPad(ctx);
	ctx.api.showQuestionOverlay("Why?", ["Ada"], null, null);
	ctx.sent.length = 0;

	const close = ctx.nodes.touchpadActionBar.children[1];
	close.onclick();

	assert.equal(
		ctx.sent.some((m) => m.type === "dismiss-question"),
		true,
	);
	assert.equal(ctx.nodes.questionOverlay.classList.contains("active"), false);
	assert.deepEqual(barLabels(ctx.nodes), []);
	assert.equal(
		ctx.nodes.touchpadActionBar.classList.contains("visible"),
		false,
	);
});

function confirmLabels(nodes) {
	return nodes.touchpadConfirmBar.children.map(
		(btn) => btn.children[0].textContent,
	);
}

test("a move-to swaps the keyboard pad for the mouse one, and swaps back on OK", async () => {
	const ctx = build();
	await openKeyboardPad(ctx);
	assert.equal(ctx.api.padMode(), "keyboard");

	ctx.api.showMoveToOverlay({ mode: "main" });
	assert.equal(
		ctx.api.padMode(),
		"mouse",
		"a move-to is about pointing at a place, so the pointer is what you need",
	);
	assert.equal(
		ctx.nodes.touchpadEditKeys.classList.contains("visible"),
		true,
		"and the edit keys come with the mouse pad",
	);

	ctx.sent.length = 0;
	ctx.nodes.touchpadConfirmBar.children[0].onclick();

	assert.deepEqual(
		ctx.sent.map((m) => m.type),
		["move-to-confirmed"],
	);
	assert.equal(ctx.nodes.moveToOverlay.classList.contains("active"), false);
	assert.equal(
		ctx.api.padMode(),
		"keyboard",
		"and typing carries on where it left off, without a second press",
	);
});

test("a move-to that ends from the host hands the keyboard pad back too", async () => {
	const ctx = build();
	await openKeyboardPad(ctx);
	ctx.api.showMoveToOverlay({ mode: "main" });
	assert.equal(ctx.api.padMode(), "mouse");

	ctx.api.closeMoveToOverlayUI();
	assert.equal(ctx.api.padMode(), "keyboard");
});

test("a move-to with no pad open leaves the pad closed", async () => {
	const ctx = build();
	ctx.api.setAutoTypingActive(true);
	ctx.api.showMoveToOverlay({ mode: "main" });
	assert.equal(ctx.nodes.touchpadOverlay.classList.contains("active"), false);

	ctx.api.closeMoveToOverlayUI();
	assert.equal(
		ctx.nodes.touchpadOverlay.classList.contains("active"),
		false,
		"nothing to restore, so nothing opens",
	);
});

test("the OK goes to the pad's side stack, and the popup drops its own", async () => {
	const ctx = build();
	await openKeyboardPad(ctx);
	ctx.api.showMoveToOverlay({ mode: "main" });

	assert.deepEqual(confirmLabels(ctx.nodes), ["OK"]);
	assert.deepEqual(barLabels(ctx.nodes), [], "not in the top bar as well");
	assert.equal(
		ctx.nodes.mtoConfirm.style.display,
		"none",
		"two OKs a thumb apart is one too many",
	);

	ctx.api.closeMoveToOverlayUI();
	ctx.api.showMoveToOverlay({ mode: "main" });
	assert.equal(
		ctx.nodes.mtoConfirm.style.display,
		"none",
		"and it stays hidden for as long as a pad is over it",
	);
});

test("with no pad open the move-to keeps its own OK", async () => {
	const ctx = build();
	ctx.api.setAutoTypingActive(true);
	ctx.api.showMoveToOverlay({ mode: "main" });

	assert.deepEqual(
		confirmLabels(ctx.nodes),
		[],
		"no pad, nothing to mirror onto",
	);
	assert.notEqual(
		ctx.nodes.mtoConfirm.style.display,
		"none",
		"the popup is the only way to dismiss it, so its button must stay",
	);
});

test("the interaction overlay still takes the pad away: it owns a text input", async () => {
	const ctx = build();
	await openKeyboardPad(ctx);
	ctx.api.setStudents(["Ada", "Linus"]);

	ctx.api.handleInteractionBtn("student-question");

	assert.equal(
		ctx.nodes.touchpadOverlay.classList.contains("active"),
		false,
		"the pad gets out of the way of a popup that needs typing into it",
	);
	assert.deepEqual(barLabels(ctx.nodes), []);
});

test("with the pad closed the popup keeps its buttons to itself", async () => {
	const ctx = build();
	ctx.api.setAutoTypingActive(true);
	ctx.api.showQuestionOverlay("Why?", ["Ada"], null, null);

	assert.deepEqual(
		barLabels(ctx.nodes),
		[],
		"no pad open means nothing to mirror onto",
	);
	assert.equal(
		ctx.nodes.touchpadEditKeys.classList.contains("visible"),
		false,
	);
});

test("only the overlays that opt in are handed to the pad", () => {
	const ctx = build();
	ctx.nodes.interactionOverlay.classList.add("active");
	assert.equal(
		ctx.api.activePadOverlay(),
		null,
		"an overlay without the opt-in class is never mirrored",
	);

	ctx.nodes.interactionOverlay.classList.remove("active");
	ctx.nodes.moveToOverlay.classList.add("active");
	assert.equal(ctx.api.activePadOverlay().overlayId, "moveToOverlay");
});
