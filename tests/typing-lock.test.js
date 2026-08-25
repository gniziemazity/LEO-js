"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

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

test("repeated characters survive a burst — the old debounce ate them", async () => {
	for (const text of ["hello", "a  b", "aa", "==", "\t\tif"]) {
		const h = harness(text.split(""));
		h.press(text.length);
		await h.settle();
		assert.equal(
			h.typed.join(""),
			text,
			JSON.stringify(text) + " must type in full",
		);
		assert.equal(
			state.isLocked,
			false,
			JSON.stringify(text) + " must not wedge",
		);
	}
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
		"typing resumes once the question is answered",
	);
});

test("every character the renderer sends is either typed or explicitly ends the chain", () => {
	const src = fs.readFileSync(path.join(MAIN, "keyboard-handler.js"), "utf-8");
	const fn = /async typeCharacter\(char\)[\s\S]*?\n\t\}/.exec(src)[0];
	const bareReturns = fn.match(/\n\t\t\treturn;/g) || [];
	assert.equal(
		bareReturns.length,
		2,
		"only the pause branch and the queue branch may return early",
	);
	assert.match(
		fn,
		/if \(state\.isPaused\) \{\s*state\.unlock\(\);\s*state\.clearQueue\(\);/,
		"the pause branch must hand the lock back",
	);
	assert.match(
		fn,
		/if \(this\.isProcessing\) \{\s*state\.queueChar\(char\);/,
		"the queue branch keeps the character, so the chain continues through it",
	);
	assert.doesNotMatch(
		src,
		/lastTypedChar|debounceMs/,
		"the char/time debounce could not tell a duplicate from a real repeat",
	);
});

test("advanceCursor answers on every path, including past the end", () => {
	const src = fs.readFileSync(
		path.resolve(__dirname, "..", "src/renderer/cursor-manager.js"),
		"utf-8",
	);
	const fn = /\tadvanceCursor\(\)[\s\S]*?\n\t\}/.exec(src)[0];
	assert.match(
		fn,
		/currentStepIndex >= this\.executionSteps\.length\) \{\s*ipcRenderer\.send\("input-complete"\)/,
		"running off the end must still answer, or the lock is never returned",
	);
	assert.match(
		fn,
		/\} else \{\s*this\.currentStepIndex\+\+;\s*ipcRenderer\.send\("input-complete"\)/,
		"an unknown step type must answer too, rather than silently stalling",
	);
	assert.equal(
		(fn.match(/ipcRenderer\.send\(/g) || []).length,
		5,
		"one reply per branch: past-the-end, char, anchor, block, unknown",
	);
});
