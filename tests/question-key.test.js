"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers/load-module");

function harness({ lesson = true, alive = true, paused = true } = {}) {
	const events = [];
	let key = null;
	const pauseReasons = new Set(paused ? ["question"] : []);
	const floatState = { questionWindowIsLesson: lesson, questionShown: false };
	const mod = loadModule("src/main/question-show.js", {
		"./context": {
			hotkeyManager: {
				registerConfirmPopup: (cb) => {
					key = cb;
					events.push(["arm"]);
				},
				unregisterConfirmPopup: () => {
					key = null;
					events.push(["disarm"]);
				},
			},
			broadcastServer: {
				broadcastQuestionShown: () => events.push(["broadcast-shown"]),
			},
		},
		"./state": {
			pauseReasons,
			unpause: (r) => {
				pauseReasons.delete(r);
				events.push(["unpause", r]);
			},
			send: (ch) => events.push(["send", ch]),
		},
		"./floating-window-manager": {
			floatState,
			_questionFloat: { isAlive: () => alive },
			animateQuestionWindowOnScreen: () => events.push(["animate"]),
		},
	});
	return {
		mod,
		events,
		floatState,
		pauseReasons,
		press: () => key && key(),
		armed: () => key !== null,
		names: () => events.map((e) => e.join(":")),
	};
}

test("Ctrl+Enter shows the question: window slides on, everyone is told, key drops", () => {
	const h = harness();
	h.mod.armQuestionShow();
	assert.equal(h.armed(), true);
	h.press();
	assert.deepEqual(h.names().slice(1), [
		"disarm",
		"animate",
		"broadcast-shown",
		"send:question-shown",
	]);
	assert.equal(h.floatState.questionShown, true);
	assert.equal(
		h.armed(),
		false,
		"one-shot: the next Ctrl+Enter reaches the editor",
	);
});

test("a second press before the key is dropped does nothing", () => {
	const h = harness();
	h.mod.armQuestionShow();
	const press = h.press;
	press();
	h.events.length = 0;
	h.floatState.questionShown = true;
	h.mod.armQuestionShow();
	h.press();
	assert.deepEqual(
		h.names(),
		["arm"],
		"already shown, so nothing else happens",
	);
});

test("a student-interaction window is never armed for", () => {
	const h = harness({ lesson: false });
	h.mod.armQuestionShow();
	h.press();
	assert.deepEqual(h.names(), ["arm"], "the key fires but the guard refuses");
	assert.equal(h.mod.questionAwaitingShow(), false);
});

test("a closed window or a released pause is not awaiting a Show", () => {
	assert.equal(harness({ alive: false }).mod.questionAwaitingShow(), false);
	assert.equal(harness({ paused: false }).mod.questionAwaitingShow(), false);
	assert.equal(harness().mod.questionAwaitingShow(), true);
});

test("the phone's Show button also drops the key", () => {
	const h = harness();
	h.mod.armQuestionShow();
	h.mod.showQuestion(true);
	assert.equal(h.armed(), false);
	h.mod.showQuestion(false);
	assert.equal(
		h.names().filter((n) => n === "animate").length,
		1,
		"no animate when the caller did not ask for it",
	);
});

test("a settings save re-arms only a question that is still awaiting Show", () => {
	const h = harness();
	h.mod.rearmQuestionShow();
	assert.equal(h.armed(), true);
	const shown = harness();
	shown.floatState.questionShown = true;
	shown.mod.rearmQuestionShow();
	assert.equal(
		shown.armed(),
		false,
		"unregisterAll would otherwise be undone",
	);
});
