"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModule } = require("./helpers/load-module");

const MAIN = path.resolve(__dirname, "..", "src/main");
const state = require(path.join(MAIN, "state.js"));

function harness(hotkeys, { active = true } = {}) {
	state.isActive = active;
	const registered = new Map();
	const globalShortcut = {
		register: (accel, cb) => {
			registered.set(accel, cb);
			return true;
		},
		unregister: (accel) => registered.delete(accel),
		unregisterAll: () => registered.clear(),
		isRegistered: (accel) => registered.has(accel),
	};
	const HotkeyManager = loadModule("src/main/hotkey-manager.js", {
		electron: { globalShortcut },
	});
	const settings = { get: (key) => hotkeys[key] };
	return { manager: new HotkeyManager(settings), registered };
}

test("opening a popup arms the key, leaving it hands the key back", () => {
	const h = harness({ "hotkeys.confirmPopup": "CommandOrControl+Enter" });
	let confirmed = 0;

	h.manager.registerConfirmPopup(() => confirmed++);
	assert.ok(
		h.registered.has("CommandOrControl+Enter"),
		"the hotkey must be live while the popup is open",
	);

	h.registered.get("CommandOrControl+Enter")();
	assert.equal(confirmed, 1, "pressing it presses OK");

	h.manager.unregisterConfirmPopup();
	assert.equal(
		h.registered.size,
		0,
		"holding Ctrl+Enter globally would swallow it in the editor",
	);
});

test("a rebound key is released with the key it was taken with", () => {
	const hotkeys = { "hotkeys.confirmPopup": "CommandOrControl+Enter" };
	const h = harness(hotkeys);

	h.manager.registerConfirmPopup(() => {});
	hotkeys["hotkeys.confirmPopup"] = "CommandOrControl+K";
	h.manager.unregisterConfirmPopup();

	assert.equal(h.registered.size, 0, "the old accelerator must not linger");
});

test("no accelerator configured means nothing is registered", () => {
	const h = harness({ "hotkeys.confirmPopup": undefined });
	h.manager.registerConfirmPopup(() => {});
	assert.equal(h.registered.size, 0);
	h.manager.unregisterConfirmPopup();
});

test("while auto-typing is off the key is not taken, because no popup is on screen", () => {
	const h = harness(
		{ "hotkeys.confirmPopup": "CommandOrControl+Enter" },
		{ active: false },
	);
	h.manager.registerConfirmPopup(() => {});
	assert.equal(
		h.registered.size,
		0,
		"a hidden popup must not swallow Ctrl+Enter in the editor",
	);
	state.isActive = true;
});
