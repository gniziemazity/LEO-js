"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers/load-module");

function harness() {
	const events = [];
	let clip = "";
	let confirmKey = null;
	const paused = new Set();
	const popups = loadModule("src/main/popups.js", {
		electron: {
			clipboard: {
				readText: () => clip,
				writeText: (t) => (clip = t),
			},
		},
		"@computer-use/nut-js": {
			keyboard: { type: async () => {} },
			Key: { LeftControl: "Ctrl", LeftCmd: "Cmd", V: "V", Enter: "Enter" },
		},
		"./context": {
			settingsManager: { get: () => undefined },
			broadcastServer: new Proxy(
				{},
				{
					get:
						(_, name) =>
						(...args) =>
							events.push([name, ...args]),
				},
			),
			hotkeyManager: {
				registerConfirmPopup: (cb) => (confirmKey = cb),
				unregisterConfirmPopup: () => (confirmKey = null),
				releaseTypingHotkeysFor: () => [],
				restoreTypingHotkeys() {},
			},
		},
		"./state": {
			pause: (r) => paused.add(r),
			unpause: (r) => paused.delete(r),
			send: (ch) => events.push(["send", ch]),
		},
		"./remote-input": { warnRemoteInput() {} },
	});
	return {
		popups,
		events,
		paused,
		hasConfirmKey: () => confirmKey !== null,
		sends: () => events.filter((e) => e[0] === "send").map((e) => e[1]),
	};
}

test("a confirm for a popup that is not open cannot tear down the one that is", () => {
	const h = harness();
	h.popups.enterPopup("code-insert", { text: "let x = 1;", paste: true });

	assert.equal(h.hasConfirmKey(), true);
	assert.equal(h.paused.has("popup"), true);

	const handled = h.popups.confirmPopup("note");
	assert.equal(handled, false, "a stale note confirm must be refused");

	assert.equal(
		h.hasConfirmKey(),
		true,
		"it unregistered the open popup's confirm key",
	);
	assert.equal(
		h.paused.has("popup"),
		true,
		"it unpaused the main process under an open popup",
	);
	assert.equal(
		h.sends().includes("note-confirmed"),
		false,
		"it told the renderer to advance past a block that is not current",
	);
});

test("the popup that is open still confirms normally", () => {
	const h = harness();
	h.popups.enterPopup("note", { text: "hello" });
	assert.equal(h.popups.confirmPopup("note"), true);
	assert.equal(h.hasConfirmKey(), false);
	assert.equal(h.paused.has("popup"), false);
	assert.equal(h.sends().includes("note-confirmed"), true);
});

test("a close arriving after its own popup was confirmed is a no-op", () => {
	const h = harness();
	h.popups.enterPopup("note", { text: "hello" });
	h.popups.confirmPopup("note");
	const before = h.events.length;
	assert.equal(h.popups.endPopup("note"), false);
	assert.equal(h.events.length, before, "it broadcast a second note-ended");
});

test("a code-insert releases the clipboard only for its own teardown", () => {
	const h = harness();
	h.popups.enterPopup("code-insert", { text: "SNIPPET", paste: true });
	h.popups.endPopup("move-to");
	assert.equal(
		h.popups.hasPendingName(),
		false,
		"sanity: no name is armed here",
	);
	assert.equal(h.popups.confirmPopup("code-insert"), true);
});
