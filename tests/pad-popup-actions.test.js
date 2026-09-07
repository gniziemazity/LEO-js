"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildRemote: build } = require("./helpers/remote-dom.js");

async function openKeyboardPad(ctx) {
	ctx.api.setSessionActive(true);
	await ctx.api.setTouchpadMode("keyboard");
}

function lifted(overlay) {
	return overlay.classList.contains("pad-lifted");
}

test("a question opening under the pad is raised above it", async () => {
	const ctx = build();
	await openKeyboardPad(ctx);
	assert.equal(lifted(ctx.nodes.questionOverlay), false, "nothing open yet");

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
	assert.equal(
		lifted(ctx.nodes.questionOverlay),
		true,
		"so the popup goes above it and keeps its own Show and ✕",
	);
});

test("the popup's own Show is the one that gets pressed", async () => {
	const ctx = build();
	await openKeyboardPad(ctx);
	ctx.api.showQuestionOverlay("Why?", ["Ada"], null, null);
	ctx.sent.length = 0;

	ctx.api.showQuestionToTeacher();

	assert.deepEqual(
		ctx.sent.map((m) => m.type),
		["show-question"],
		"one button, one handler, wherever the teacher is standing",
	);
	assert.equal(
		ctx.nodes.qShowBtn.style.display,
		"none",
		"and it drops off once the question is on screen",
	);
	assert.equal(
		lifted(ctx.nodes.questionOverlay),
		true,
		"the rest of the popup stays reachable",
	);
});

test("closing the question drops the lift with it", async () => {
	const ctx = build();
	await openKeyboardPad(ctx);
	ctx.api.showQuestionOverlay("Why?", ["Ada"], null, null);

	ctx.api.closeQuestionOverlay();

	assert.equal(ctx.nodes.questionOverlay.classList.contains("active"), false);
	assert.equal(lifted(ctx.nodes.questionOverlay), false);
});

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
	ctx.api.closeMoveToOverlay();

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
	ctx.api.setSessionActive(true);
	ctx.api.showMoveToOverlay({ mode: "main" });
	assert.equal(ctx.nodes.touchpadOverlay.classList.contains("active"), false);

	ctx.api.closeMoveToOverlayUI();
	assert.equal(
		ctx.nodes.touchpadOverlay.classList.contains("active"),
		false,
		"nothing to restore, so nothing opens",
	);
});

test("the OK never moves: the pad is what gets out of its way", async () => {
	const ctx = build();
	await openKeyboardPad(ctx);
	ctx.api.showMoveToOverlay({ mode: "main" });

	assert.equal(lifted(ctx.nodes.moveToOverlay), true);
	assert.notEqual(
		ctx.nodes.mtoActions.style.display,
		"none",
		"the row a thumb already knows must not be taken away",
	);
	assert.notEqual(
		ctx.nodes.mtoConfirm.style.display,
		"none",
		"and there is still exactly one OK, the popup's own",
	);

	ctx.api.closeMoveToOverlayUI();
	ctx.api.showMoveToOverlay({ mode: "main" });
	assert.equal(
		lifted(ctx.nodes.moveToOverlay),
		true,
		"and it is lifted again for as long as a pad is over it",
	);
});

test("with no pad open the move-to is not lifted at all", async () => {
	const ctx = build();
	ctx.api.setSessionActive(true);
	ctx.api.showMoveToOverlay({ mode: "main" });

	assert.equal(
		lifted(ctx.nodes.moveToOverlay),
		false,
		"nothing is covering it, so there is nothing to rise above",
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
	assert.equal(lifted(ctx.nodes.interactionOverlay), false);
});

test("with the pad closed the popup is left exactly as it renders", async () => {
	const ctx = build();
	ctx.api.setSessionActive(true);
	ctx.api.showQuestionOverlay("Why?", ["Ada"], null, null);

	assert.equal(lifted(ctx.nodes.questionOverlay), false);
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
		"an overlay without the opt-in class is never lifted",
	);

	ctx.nodes.interactionOverlay.classList.remove("active");
	ctx.nodes.moveToOverlay.classList.add("active");
	assert.equal(ctx.api.activePadOverlay().overlayId, "moveToOverlay");
});

test("Auto-type hands back the keyboard pad, because the name is typed", async () => {
	const ctx = build();
	ctx.api.setSessionActive(true);
	await ctx.api.setTouchpadMode("mouse");
	ctx.api.showMoveToOverlay({
		mode: "file",
		target: "app.js",
		typeName: true,
	});
	assert.equal(ctx.api.padMode(), "mouse");

	ctx.sent.length = 0;
	ctx.api.moveToTypeName();
	await new Promise((r) => setTimeout(r, 0));

	assert.equal(
		ctx.sent.some((m) => m.type === "move-to-type-name"),
		true,
		"the host still starts typing the name",
	);
	assert.equal(
		ctx.api.padMode(),
		"keyboard",
		"and the pad becomes the tap target that types it",
	);
});
