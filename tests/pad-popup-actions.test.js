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

async function openAutoPilot(ctx) {
	ctx.api.setSessionActive(true);
	ctx.api.setAutoPilot(true);
}

test("a manual keyboard pad never changes on its own, move-to or not", async () => {
	const ctx = build();
	await openKeyboardPad(ctx);

	ctx.api.showMoveToOverlay({ mode: "main" });
	assert.equal(
		ctx.api.padMode(),
		"keyboard",
		"the pad the teacher chose is the pad they keep",
	);

	ctx.sent.length = 0;
	ctx.api.closeMoveToOverlay();
	assert.deepEqual(
		ctx.sent.map((m) => m.type),
		["move-to-confirmed"],
	);
	assert.equal(ctx.api.padMode(), "keyboard");
});

test("a manual mouse pad stays put while the file name is typed", async () => {
	const ctx = build();
	ctx.api.setSessionActive(true);
	await ctx.api.setTouchpadMode("mouse");
	ctx.api.showMoveToOverlay({
		mode: "file",
		target: "app.js",
		typeName: true,
	});

	ctx.api.moveToTypeName();
	ctx.api.moveToSetTyped({ target: "app.js", typed: 1 });

	assert.equal(ctx.api.padMode(), "mouse");
});

test("auto-pilot is on the keyboard pad while nothing is open", async () => {
	const ctx = build();
	await openAutoPilot(ctx);

	assert.equal(ctx.api.padMode(), "keyboard");
	assert.equal(ctx.nodes.autoPilotBtn.classList.contains("mode-active"), true);
	assert.equal(
		ctx.nodes.modeBtnKeyboard.classList.contains("mode-active"),
		true,
		"and the button of the pad it is on says which one that is",
	);
});

test("auto-pilot takes the mouse pad for a move-to, and hands the keyboard back on OK", async () => {
	const ctx = build();
	await openAutoPilot(ctx);

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
	assert.equal(ctx.nodes.autoPilotBtn.classList.contains("mode-active"), true);

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

test("auto-pilot hands the keyboard pad back when the host ends the move-to", async () => {
	const ctx = build();
	await openAutoPilot(ctx);
	ctx.api.showMoveToOverlay({ mode: "main" });
	assert.equal(ctx.api.padMode(), "mouse");

	ctx.api.closeMoveToOverlayUI();
	assert.equal(ctx.api.padMode(), "keyboard");
});

test("auto-pilot leaves the keyboard pad alone for a question, code insert, note or media", async () => {
	const opens = {
		question: (api) => api.showQuestionOverlay("Why?", ["Ada"], null, null),
		"code insert": (api) => api.showCodeInsertOverlay({ text: "x" }),
		note: (api) => api.showNoteOverlay({ text: "Slow down" }),
		media: (api) => api.showMediaOverlay({ kind: "image", name: "a.png" }),
	};
	const closes = {
		question: (api) => api.closeQuestionOverlayUI(),
		"code insert": (api) => api.closeCodeInsertOverlayUI(),
		note: (api) => api.closeNoteOverlayUI(),
		media: (api) => api.closeMediaOverlayUI(),
	};
	for (const name of Object.keys(opens)) {
		const ctx = build();
		await openAutoPilot(ctx);

		opens[name](ctx.api);
		assert.equal(
			ctx.api.padMode(),
			"keyboard",
			name + " is not about pointing, so the pad stays as it was",
		);

		closes[name](ctx.api);
		assert.equal(
			ctx.api.padMode(),
			"keyboard",
			name + " is over, so type on",
		);
	}
});

test("auto-pilot types the file name on the keyboard pad, then goes back on the last character", async () => {
	const ctx = build();
	await openAutoPilot(ctx);
	ctx.api.showMoveToOverlay({
		mode: "file",
		target: "app.js",
		typeName: true,
	});
	assert.equal(ctx.api.padMode(), "mouse");

	ctx.sent.length = 0;
	ctx.api.moveToTypeName();

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

	ctx.api.closeMoveToOverlayUI();
	assert.equal(ctx.api.padMode(), "keyboard", "the name done, typing goes on");
	ctx.api.showMoveToOverlay({ mode: "main" });
	assert.equal(
		ctx.api.padMode(),
		"mouse",
		"and the next move-to starts on the mouse pad again",
	);
});

test("a name the host starts itself (desk card, Ctrl+Enter) also gets the keyboard pad", async () => {
	const ctx = build();
	await openAutoPilot(ctx);
	ctx.api.showMoveToOverlay({
		mode: "file",
		target: "app.js",
		typeName: true,
	});
	assert.equal(ctx.api.padMode(), "mouse");

	ctx.api.moveToSetTyped({ target: "app.js", typed: 0 });
	assert.equal(ctx.api.padMode(), "keyboard");

	ctx.api.closeMoveToOverlayUI();
	assert.equal(ctx.api.padMode(), "keyboard");
});

test("a progress message with no name pending does not steal the mouse pad", async () => {
	const ctx = build();
	await openAutoPilot(ctx);
	ctx.api.showMoveToOverlay({
		mode: "file",
		target: "app.js",
		typeName: true,
	});

	ctx.api.moveToSetTyped({ target: "app.js", typed: null });
	assert.equal(ctx.api.padMode(), "mouse");
});

test("auto-pilot waits on the mouse pad until typing starts, then moves to the keyboard", async () => {
	const ctx = build();
	ctx.api.setAutoPilot(true);
	assert.equal(
		ctx.api.padMode(),
		"mouse",
		"the keyboard pad is unavailable before the first block, so it must not be picked",
	);

	ctx.api.setSessionActive(true);
	assert.equal(ctx.api.padMode(), "keyboard");

	ctx.api.setSessionActive(false);
	assert.equal(
		ctx.api.padMode(),
		"mouse",
		"and back again when typing stops, instead of the pad vanishing",
	);
});

test("under auto-pilot the pad buttons still work, as a temporary override", async () => {
	const ctx = build();
	await openAutoPilot(ctx);
	assert.equal(ctx.api.padMode(), "keyboard");

	await ctx.api.setTouchpadMode("mouse");
	assert.equal(
		ctx.api.padMode(),
		"mouse",
		"the teacher can take the mouse pad",
	);
	assert.equal(
		ctx.nodes.autoPilotBtn.classList.contains("mode-active"),
		true,
		"and auto-pilot stays on",
	);

	await ctx.api.setTouchpadMode("keyboard");
	assert.equal(ctx.api.padMode(), "keyboard", "and hand it back");
});

test("pressing the live pad's button under auto-pilot turns that pad off", async () => {
	const ctx = build();
	await openAutoPilot(ctx);
	assert.equal(ctx.api.padMode(), "keyboard");

	await ctx.api.setTouchpadMode("keyboard");
	assert.equal(
		ctx.api.padMode(),
		null,
		"the same press that closes a manual pad closes this one",
	);
	assert.equal(
		ctx.nodes.autoPilotBtn.classList.contains("mode-active"),
		true,
		"auto-pilot itself stays on",
	);
	assert.equal(ctx.nodes.modeSideBtns.classList.contains("has-pad"), false);
});

test("a pad turned off stays off while nothing changes, and the other button opens that one", async () => {
	const ctx = build();
	await openAutoPilot(ctx);
	ctx.api.updateCursor({ currentStep: 0 });
	await ctx.api.setTouchpadMode("keyboard");
	assert.equal(ctx.api.padMode(), null);

	ctx.api.setPinnedWindows({ image: true, web: false });
	ctx.api.setStudents(["Ada"]);
	ctx.api.updateCursor({ currentStep: 0 });
	assert.equal(ctx.api.padMode(), null, "unrelated messages do not reopen it");

	await ctx.api.setTouchpadMode("mouse");
	assert.equal(
		ctx.api.padMode(),
		"mouse",
		"pressing the other button takes that pad",
	);
});

test("auto-pilot reopens a pad the teacher turned off once the plan advances", async () => {
	const ctx = build();
	await openAutoPilot(ctx);
	ctx.api.updateCursor({ currentStep: 3 });
	await ctx.api.setTouchpadMode("keyboard");
	assert.equal(ctx.api.padMode(), null);

	ctx.api.updateCursor({ currentStep: 3 });
	assert.equal(ctx.api.padMode(), null, "the same step is not an advance");

	ctx.api.updateCursor({ currentStep: 4 });
	assert.equal(
		ctx.api.padMode(),
		"keyboard",
		"the next step hands the pad back",
	);
});

test("a popup opening or closing also ends a turned-off pad, and so does the mouse pad's own button", async () => {
	const ctx = build();
	await openAutoPilot(ctx);
	await ctx.api.setTouchpadMode("keyboard");
	ctx.api.showMoveToOverlay({ mode: "main" });
	assert.equal(ctx.api.padMode(), "mouse", "a move-to wants the mouse pad");

	await ctx.api.setTouchpadMode("mouse");
	assert.equal(ctx.api.padMode(), null, "and its button turns that off too");

	ctx.api.closeMoveToOverlayUI();
	assert.equal(ctx.api.padMode(), "keyboard", "confirming moves the plan on");
});

test("turning auto-pilot off and on forgets a turned-off pad", async () => {
	const ctx = build();
	await openAutoPilot(ctx);
	await ctx.api.setTouchpadMode("keyboard");

	ctx.api.setAutoPilot(false);
	ctx.api.setAutoPilot(true);
	assert.equal(ctx.api.padMode(), "keyboard");
});

test("an override holds while nothing changes, and a popup opening ends it", async () => {
	const ctx = build();
	await openAutoPilot(ctx);
	await ctx.api.setTouchpadMode("mouse");

	ctx.api.setPinnedWindows({ image: true, web: false });
	ctx.api.setStudents(["Ada"]);
	assert.equal(
		ctx.api.padMode(),
		"mouse",
		"unrelated messages do not undo it",
	);

	ctx.api.showMoveToOverlay({ mode: "main" });
	assert.equal(
		ctx.api.padMode(),
		"mouse",
		"the move-to wants the mouse anyway",
	);
	ctx.api.closeMoveToOverlayUI();
	assert.equal(
		ctx.api.padMode(),
		"keyboard",
		"the plan moved on, so auto-pilot is back in charge",
	);
});

test("a popup ends an override that disagrees with it", async () => {
	const ctx = build();
	await openAutoPilot(ctx);
	ctx.api.showMoveToOverlay({ mode: "main" });
	assert.equal(ctx.api.padMode(), "mouse");

	await ctx.api.setTouchpadMode("keyboard");
	assert.equal(
		ctx.api.padMode(),
		"keyboard",
		"the teacher may want the keyboard here",
	);

	ctx.api.closeMoveToOverlayUI();
	assert.equal(ctx.api.padMode(), "keyboard", "confirming moves the plan on");

	await ctx.api.setTouchpadMode("mouse");
	ctx.api.showMoveToOverlay({ mode: "main" });
	assert.equal(ctx.api.padMode(), "mouse");
});

test("the plan advancing ends an override, and only a new step counts", async () => {
	const ctx = build();
	await openAutoPilot(ctx);
	ctx.api.updateCursor({ currentStep: 4 });
	await ctx.api.setTouchpadMode("mouse");

	ctx.api.updateCursor({ currentStep: 4 });
	assert.equal(
		ctx.api.padMode(),
		"mouse",
		"the same step again is not an advance",
	);

	ctx.api.updateCursor({ currentStep: 5 });
	assert.equal(
		ctx.api.padMode(),
		"keyboard",
		"the next step resumes auto-pilot",
	);
});

test("typing being switched on or off ends an override too", async () => {
	const ctx = build();
	await openAutoPilot(ctx);
	await ctx.api.setTouchpadMode("mouse");

	ctx.api.setSessionActive(true);
	assert.equal(ctx.api.padMode(), "keyboard");

	await ctx.api.setTouchpadMode("mouse");
	ctx.api.setSessionActive(false);
	assert.equal(
		ctx.api.padMode(),
		"mouse",
		"not typing, so the mouse pad it is",
	);
});

test("an override never outlives auto-pilot", async () => {
	const ctx = build();
	await openAutoPilot(ctx);
	await ctx.api.setTouchpadMode("mouse");

	ctx.api.setAutoPilot(false);
	ctx.api.setAutoPilot(true);
	assert.equal(
		ctx.api.padMode(),
		"keyboard",
		"a fresh start follows the lesson",
	);
});

test("under auto-pilot the keyboard pad is refused before typing starts, like anywhere", async () => {
	const ctx = build();
	ctx.api.setAutoPilot(true);
	assert.equal(ctx.api.padMode(), "mouse");

	await ctx.api.setTouchpadMode("keyboard");
	assert.equal(ctx.api.padMode(), "mouse");
});

test("a popup that needs typing into is not overridden under auto-pilot", async () => {
	const ctx = build();
	await openAutoPilot(ctx);
	ctx.api.setStudents(["Ada", "Linus"]);
	ctx.api.handleInteractionBtn("student-question");
	assert.equal(ctx.api.padMode(), null);

	await ctx.api.setTouchpadMode("mouse");
	assert.equal(
		ctx.api.padMode(),
		null,
		"the pad stays out of the way of its text input",
	);
});

test("the auto-pilot button asks the host and waits for the answer", () => {
	const ctx = build();
	ctx.api.setSessionActive(true);
	ctx.api.requestAutoPilot();
	assert.deepEqual(ctx.sent, [
		{ type: "set-auto-pilot", data: { autoPilot: true } },
	]);
	assert.equal(
		ctx.nodes.autoPilotBtn.classList.contains("mode-active"),
		false,
		"the host owns the switch, so nothing lights up until it says so",
	);

	ctx.api.setAutoPilot(true);
	assert.equal(ctx.nodes.autoPilotBtn.classList.contains("mode-active"), true);

	ctx.sent.length = 0;
	ctx.api.requestAutoPilot();
	assert.deepEqual(ctx.sent, [
		{ type: "set-auto-pilot", data: { autoPilot: false } },
	]);
});

test("the host turning auto-pilot off closes the pad and gives the buttons back", async () => {
	const ctx = build();
	await openAutoPilot(ctx);

	ctx.api.setAutoPilot(false);
	assert.equal(ctx.api.padMode(), null);
	assert.equal(ctx.nodes.autoPilotBtn.classList.contains("mode-active"), false);

	ctx.api.showMoveToOverlay({ mode: "main" });
	assert.equal(ctx.api.padMode(), null, "a closed pad stays closed");

	await ctx.api.setTouchpadMode("mouse");
	assert.equal(ctx.api.padMode(), "mouse", "and the buttons work again");
});

test("repeating the host's value changes nothing", async () => {
	const ctx = build();
	await openAutoPilot(ctx);
	ctx.api.showMoveToOverlay({ mode: "main" });

	ctx.api.setAutoPilot(true);
	assert.equal(ctx.api.padMode(), "mouse", "no restart, no reset");
});

test("auto-pilot gives way to a popup that needs typing into, and comes back after it", async () => {
	const ctx = build();
	await openAutoPilot(ctx);
	ctx.api.setStudents(["Ada", "Linus"]);

	ctx.api.handleInteractionBtn("student-question");
	assert.equal(ctx.api.padMode(), null);
	assert.equal(
		ctx.nodes.autoPilotBtn.classList.contains("mode-active"),
		true,
		"the switch is the host's, so it stays on",
	);

	ctx.nodes.iMicBtn.blur = () => {};
	ctx.api.closeInteractionOverlay();
	assert.equal(
		ctx.api.padMode(),
		"keyboard",
		"and the pad follows the lesson again",
	);
});

test("a popup opened under auto-pilot is lifted above the pad it is on", async () => {
	const ctx = build();
	await openAutoPilot(ctx);

	ctx.api.showMoveToOverlay({ mode: "main" });
	assert.equal(lifted(ctx.nodes.moveToOverlay), true);
	assert.equal(
		ctx.nodes.touchpadOverlay.classList.contains("keyboard-mode"),
		false,
	);
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

test("the auto-pilot button is only pressable while auto-typing is on", () => {
	const ctx = build();
	assert.equal(
		ctx.nodes.autoPilotBtn.disabled,
		undefined,
		"the page ships it disabled; nothing has touched it yet",
	);

	ctx.api.setSessionActive(false);
	assert.equal(ctx.nodes.autoPilotBtn.disabled, true);
	ctx.api.requestAutoPilot();
	assert.deepEqual(ctx.sent, [], "a press that gets through asks for nothing");

	ctx.api.setSessionActive(true);
	assert.equal(ctx.nodes.autoPilotBtn.disabled, false);
	ctx.api.requestAutoPilot();
	assert.deepEqual(ctx.sent, [
		{ type: "set-auto-pilot", data: { autoPilot: true } },
	]);

	ctx.api.setSessionActive(false);
	assert.equal(
		ctx.nodes.autoPilotBtn.disabled,
		true,
		"and it goes again when typing stops",
	);
});

test("the phone's auto-pilot button ships disabled", () => {
	const fs = require("node:fs");
	const path = require("node:path");
	const html = fs.readFileSync(
		path.join(__dirname, "..", "src", "remote.html"),
		"utf-8",
	);
	assert.match(html, /id="autoPilotBtn"[^>]*\bdisabled\b/);
});
