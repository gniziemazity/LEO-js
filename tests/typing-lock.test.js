"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const MAIN = path.resolve(__dirname, "..", "src/main");
const state = require(path.join(MAIN, "state.js"));
const HotkeyManager = require(path.join(MAIN, "hotkey-manager.js"));
const KeyboardHandler = require(path.join(MAIN, "keyboard-handler.js"));

const settings = {
	get(key) {
		if (key === "hotkeyMode") return "single";
		if (key === "hotkeys.typing") return [];
		if (key === "platform") return "windows";
		return null;
	},
};

function harness(steps) {
	state.reset();
	state.isActive = true;

	const hotkeys = new HotkeyManager(settings);
	const keys = new KeyboardHandler(hotkeys, settings);
	const typed = [];
	keys.typeCharWithHotkeyManagement = async (char) => {
		typed.push(char);
	};

	let at = 0;
	state.send = (channel) => {
		if (channel !== "advance-cursor") return true;
		if (at >= steps.length) {
			keys.processQueue();
			return true;
		}
		const step = steps[at++];
		if (step.length === 1) keys.typeCharacter(step);
		else keys.processQueue();
		return true;
	};

	return {
		typed,
		press: (n) => {
			for (let i = 0; i < n; i++) hotkeys.handleKey("remote");
		},
		settle: () => new Promise((r) => setTimeout(r, 60)),
	};
}

test("a burst of taps types every character, in order", async () => {
	const h = harness("hello world".split(""));
	h.press(11);
	await h.settle();
	assert.equal(h.typed.join(""), "hello world");
	assert.equal(
		state.isLocked,
		false,
		"the lock is handed back when the burst drains",
	);
	assert.equal(state.advanceQueue.length, 0);
});

test("a burst that runs past the end of the lesson still hands the lock back", async () => {
	const h = harness(["a", "b"]);
	h.press(6);
	await h.settle();
	assert.equal(h.typed.join(""), "ab");
	assert.equal(
		state.isLocked,
		false,
		"tapping past the last step must not strand the lock",
	);
	assert.equal(
		state.advanceQueue.length,
		0,
		"and must not leave advances queued",
	);
});

test("blocks and anchors in the middle of a burst do not break the chain", async () => {
	const h = harness(["a", "block", "b", "anchor", "c"]);
	h.press(5);
	await h.settle();
	assert.equal(h.typed.join(""), "abc");
	assert.equal(state.isLocked, false);
});

test("a pause mid-burst ends the chain instead of stranding it", async () => {
	const h = harness("abcdef".split(""));
	h.press(1);
	await h.settle();
	state.pause();
	h.press(3);
	assert.equal(state.isLocked, false, "queued taps cannot outlive the pause");
	assert.equal(
		state.advanceQueue.length,
		0,
		"and are dropped, not replayed later",
	);

	state.unpause();
	h.press(1);
	await h.settle();
	assert.ok(
		h.typed.length > 1,
		"auto-typing resumes once the question is answered",
	);
});
