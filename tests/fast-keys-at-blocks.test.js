"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModule, fakeIpcRenderer } = require("./helpers/load-module.js");

const MAIN = path.resolve(__dirname, "..", "src/main");
const state = require(path.join(MAIN, "state.js"));
const KeyboardHandler = require(path.join(MAIN, "keyboard-handler.js"));

const settings = {
	get(key) {
		if (key === "hotkeyMode") return "single";
		if (key === "hotkeys.typing") return [];
		if (key === "platform") return "windows";
		return null;
	},
};

const PAUSES = {
	"enter-question-block": "question",
	"enter-popup": "popup",
};
const RESUMES = {
	"close-question-window": "question",
	"close-note-popup": "popup",
	"close-go-to-popup": "popup",
	"close-snippet-popup": "popup",
};

const element = () => ({
	classList: { add() {}, remove() {} },
	scrollIntoView() {},
	dataset: {},
});
const char = (c) => ({ type: "char", char: c, element: element() });
const codeEnd = () => ({
	type: "block",
	blockType: "code",
	element: element(),
});
const block = (text, extra) => ({
	type: "block",
	text,
	element: element(),
	...extra,
});

function wire(steps) {
	const messages = [];
	const toMain = (ch, payload) => messages.push({ to: "main", ch, payload });

	const ipc = fakeIpcRenderer({ send: toMain });
	const CursorManager = loadModule("src/renderer/cursor-manager.js", {
		electron: ipc.stub,
	});
	const cm = new CursorManager({ updateProgressBar() {} }, { addEntry() {} });
	cm.setExecutionSteps(steps.map((s, i) => ({ ...s, globalIndex: i })));
	cm.onEnterQuestionBlock = () => toMain("enter-question-block");
	cm.onEnterNoteBlock = () => toMain("enter-popup");
	cm.onEnterGoToBlock = () => toMain("enter-popup");
	cm.onEnterSnippetBlock = () => toMain("enter-popup");

	state.reset();
	state.isActive = true;
	const HotkeyManager = loadModule("src/main/hotkey-manager.js", {
		electron: { globalShortcut: {} },
	});
	const hotkeys = new HotkeyManager(settings);
	const keys = new KeyboardHandler(hotkeys, settings);
	const typed = [];
	keys.typeCharWithHotkeyManagement = async (c) => {
		typed.push(c);
	};
	const send = state.send;
	state.send = (ch) => {
		messages.push({ to: "renderer", ch });
		return true;
	};

	function deliver({ to, ch, payload }) {
		if (to === "renderer") {
			if (ch === "advance-cursor") cm.advanceCursor();
			return;
		}
		if (ch === "type-character") keys.typeCharacter(payload);
		else if (ch === "input-complete") keys.processQueue();
		else if (PAUSES[ch]) state.pause(PAUSES[ch]);
		else if (RESUMES[ch]) state.unpause(RESUMES[ch]);
	}

	async function settle() {
		while (messages.length) {
			deliver(messages.shift());
			await new Promise((resolve) => setImmediate(resolve));
		}
	}

	cm.updateCursor();
	messages.length = 0;

	return {
		cm,
		typed,
		press: async (times) => {
			for (let i = 0; i < times; i++) hotkeys.handleKey("a");
			await settle();
		},
		settle,
		restore: () => {
			state.send = send;
			state.reset();
		},
	};
}

const STOPPERS = [
	["question", block("❓ Why does this work?")],
	["note", block("Explain the loop")],
	["go-to", block("", { blockType: "go-to", target: "MAIN" })],
	["snippet", block("📋 const x = 1;")],
];

for (const [type, stopper] of STOPPERS) {
	test(`keys pressed faster than LEO types do not run past a ${type} block`, async () => {
		const h = wire([
			char("a"),
			codeEnd(),
			stopper,
			char("↩"),
			char("b"),
			codeEnd(),
		]);
		try {
			await h.press(6);

			assert.deepEqual(
				h.typed,
				["a"],
				"the presses queued behind the last character used to be spent on " +
					"the block itself, and the next block's first character with it",
			);
			assert.equal(
				h.cm.currentStepIndex,
				2,
				"the cursor waits on the block",
			);
			assert.equal(state.isPaused, true);
			assert.equal(
				state.isLocked,
				false,
				"and the next press is not locked out",
			);
			assert.equal(
				state.hasQueuedAdvances(),
				false,
				"nothing is left queued",
			);
		} finally {
			h.restore();
		}
	});
}

test("the character after a question is still there once the question is over", async () => {
	const h = wire([
		char("a"),
		codeEnd(),
		block("❓ Why does this work?"),
		char("↩"),
		char("b"),
		codeEnd(),
	]);
	try {
		await h.press(6);
		state.unpause("question");
		h.cm.questionWindowClosed();
		await h.settle();

		await h.press(2);
		assert.deepEqual(
			h.typed,
			["a", "↩", "b"],
			"stopping at the question loses nothing: what follows it is typed once it is over",
		);
	} finally {
		h.restore();
	}
});

test("a plain block boundary still takes a queued press each", async () => {
	const h = wire([char("a"), codeEnd(), char("b"), codeEnd(), char("c")]);
	try {
		await h.press(5);
		assert.deepEqual(h.typed, ["a", "b", "c"]);
		assert.equal(h.cm.currentStepIndex, 5);
		assert.equal(state.isLocked, false);
	} finally {
		h.restore();
	}
});

test("the renderer says what the next block needs before it reports the step done", () => {
	const sent = [];
	const ipc = fakeIpcRenderer({ send: (ch) => sent.push(ch) });
	const CursorManager = loadModule("src/renderer/cursor-manager.js", {
		electron: ipc.stub,
	});
	const cm = new CursorManager({ updateProgressBar() {} }, { addEntry() {} });
	cm.setExecutionSteps(
		[codeEnd(), block("❓ Why?")].map((s, i) => ({ ...s, globalIndex: i })),
	);
	cm.onEnterQuestionBlock = () => sent.push("enter-question-block");
	cm.updateCursor();
	sent.length = 0;

	cm.advanceCursor();

	assert.ok(
		sent.indexOf("enter-question-block") < sent.indexOf("input-complete"),
		"main answers input-complete with the next queued press, so the pause " +
			"has to be on its way first",
	);
});
