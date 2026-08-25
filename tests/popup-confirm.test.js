"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadModule } = require("./helpers/load-module");

const MAIN = path.resolve(__dirname, "..", "src/main");
const SettingsManager = require(path.join(MAIN, "settings-manager.js"));

function harness(hotkeys) {
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

test("the popup OK ships bound to Ctrl/Cmd+Enter", () => {
	const defaults = new SettingsManager().defaultSettings.hotkeys;
	assert.equal(defaults.confirmPopup, "CommandOrControl+Enter");
});

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

test("registering twice does not stack callbacks", () => {
	const h = harness({ "hotkeys.confirmPopup": "CommandOrControl+Enter" });
	let first = 0;
	h.manager.registerConfirmPopup(() => first++);
	h.manager.registerConfirmPopup(() => first++);
	h.registered.get("CommandOrControl+Enter")();
	assert.equal(first, 1);
});

function mainSrc() {
	return fs.readFileSync(path.join(MAIN, "main.js"), "utf-8");
}

test("every pausing popup is torn down in one place, so the key cannot outlive it", () => {
	const src = mainSrc();

	for (const call of ["broadcastMoveToEnded", "broadcastCodeInsertEnded"]) {
		assert.equal(
			(src.match(new RegExp(`${call}\\(\\)`, "g")) || []).length,
			1,
			`a second ${call} path would leave Ctrl+Enter registered for good`,
		);
	}

	const teardown = /function endPopup\(kind\)[\s\S]*?\n\}/.exec(src)[0];
	assert.match(teardown, /unregisterConfirmPopup\(\)/);
	assert.match(teardown, /state\.unpause\(\)/);
	assert.match(teardown, /setPanelVisible\(false\)/);
	assert.match(teardown, /popup\.ended\(\)/);
	assert.match(
		teardown,
		/if \(popup\.onExit\) popup\.onExit\(\)/,
		"the code-insert popup hands the clipboard back through this hook",
	);

	const confirm = /function confirmPopup\(kind\)[\s\S]*?\n\}/.exec(src)[0];
	assert.match(confirm, /endPopup\(kind\)/);
	assert.match(
		confirm,
		/state\.send\(PAUSING_POPUPS\[kind\]\.confirmChannel\)/,
		"the renderer resumes auto-typing off this message",
	);

	assert.equal(
		(src.match(/releaseCodeFromClipboard\(\)/g) || []).length,
		2,
		"the clipboard is handed back from the one teardown, and nowhere else",
	);
});

test("both popups arm the same key and answer to the same confirm", () => {
	const src = mainSrc();

	for (const channel of ["enter-move-to-block", "enter-code-insert-block"]) {
		assert.match(
			src,
			new RegExp(`ipcMain\\.on\\("${channel}"[\\s\\S]{0,120}enterPopup\\(`),
			`${channel} must go through the shared enterPopup`,
		);
	}

	const enter = /function enterPopup\(kind, payload\)[\s\S]*?\n\}/.exec(
		src,
	)[0];
	assert.match(enter, /state\.pause\(\)/);
	assert.match(enter, /hotkeyManager\.registerConfirmPopup\(/);

	for (const client of [
		"client-move-to-confirmed",
		"client-code-insert-confirmed",
	]) {
		assert.match(
			src,
			new RegExp(`"${client}"[\\s\\S]{0,80}confirmPopup\\(`),
			`the remote OK for ${client} must not keep its own teardown`,
		);
	}

	const reapply = /function reapplySettings\(\)[\s\S]*?\n\}/.exec(src)[0];
	assert.match(
		reapply,
		/if \(openPopup\)/,
		"saving settings with a popup open must not disarm the key",
	);
});
