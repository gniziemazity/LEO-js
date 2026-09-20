"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadModule } = require("./helpers/load-module");

const SRC = path.resolve(__dirname, "..", "src");
const read = (rel) =>
	fs.readFileSync(path.join(SRC, rel), "utf-8").replace(/\r\n/g, "\n");

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
		"./float-windows": {
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

test("ending the question releases the pause and the key", () => {
	const h = harness();
	h.mod.armQuestionShow();
	h.mod.endQuestion();
	assert.equal(h.armed(), false);
	assert.equal(h.pauseReasons.has("question"), false);
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

test("main.js routes every entry and every exit through the one module", () => {
	const main = read("main/main.js");
	assert.match(
		main,
		/broadcastServer\.on\("client-show-question", \(animate\) => showQuestion\(animate\)\)/,
		"the phone, the desk card and the key share one handler",
	);
	for (const exit of [
		'broadcastServer.on("client-student-answered"',
		'broadcastServer.on("client-dismiss-question"',
		'ipcMain.on("close-question-window"',
	]) {
		const at = main.indexOf(exit);
		assert.ok(at > 0, exit);
		assert.match(
			main.slice(at, at + 160),
			/endQuestion\(\)/,
			`${exit} must release the key that Show armed`,
		);
	}
	const enter = main.slice(
		main.indexOf('"enter-question-block"'),
		main.indexOf('ipcMain.on("randomizer-done"'),
	);
	assert.match(enter, /openQuestionWindow\([\s\S]*armQuestionShow\(\)/);
	assert.match(
		main,
		/if \(kind\) hotkeyManager\.registerConfirmPopup\(confirmKeyFor\(kind\)\);\n\telse rearmQuestionShow\(\);/,
		"a settings save calls unregisterAll",
	);
	assert.equal(
		/state\.unpause\("question"\)/.test(main),
		false,
		"a bare unpause would leave the key registered system-wide",
	);
});

test("the question window forgets it was shown when the next one opens", () => {
	const fw = read("main/float-windows.js");
	assert.match(fw, /questionShown: false,/);
	assert.match(
		/function openQuestionWindow[\s\S]*?\n\}/.exec(fw)[0],
		/floatState\.questionShown = false;/,
	);
});

test("the server remembers Show, so a reconnecting phone shows the grid", () => {
	const ws = read("main/websocket-server.js");
	assert.match(
		ws,
		/broadcastQuestionShown\(\) \{\n\t\tthis\.currentState\.activeQuestionShown = true;/,
	);
	assert.match(
		/broadcastQuestionStarted[\s\S]*?\n\t\}/.exec(ws)[0],
		/activeQuestionShown = false/,
	);
	assert.match(
		/broadcastQuestionEnded[\s\S]*?\n\t\}/.exec(ws)[0],
		/activeQuestionShown = false/,
	);
	const remote = read("remote.html");
	assert.match(
		remote,
		/case "question-shown":\n\s*revealQuestionOverlay\(\);/,
	);
	assert.match(
		remote,
		/state\.activeQuestion && state\.activeQuestionShown\)\n\s*revealQuestionOverlay\(\)/,
	);
});

test("the phone's reveal is the UI half of Show, without sending it again", () => {
	const src = read("shared/remote/question-overlay.js");
	const reveal = /\treveal\(\) \{[\s\S]*?\n\t\}/.exec(src)[0];
	assert.equal(/sendMessage/.test(reveal), false);
	assert.match(reveal, /qGrid[\s\S]*display = "flex"/);
	const show = /\tshowToTeacher\(animate\) \{[\s\S]*?\n\t\}/.exec(src)[0];
	assert.match(show, /sendMessage\("show-question"/);
	assert.match(show, /this\.reveal\(\)/);
});
