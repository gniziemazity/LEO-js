"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildRemote } = require("./helpers/remote-dom");
const LEOBroadcastServer = require("../src/main/websocket-server");

const SRC = path.resolve(__dirname, "..", "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf-8");

test("the step buttons live in their own bar, wearing the same base class as every other side button", () => {
	const html = read("remote.html");
	const bar = /<div id="touchpadStepKeys"[\s\S]*?<\/div>\s*<\/div>/.exec(
		html,
	)[0];
	assert.match(bar, /class="touchpad-toolbar touchpad-step-bar"/);
	assert.match(bar, /onclick="remoteStep\('back'\)"/);
	assert.match(bar, /onclick="remoteStep\('forward'\)"/);
	assert.match(bar, /title="Step back"/);
	assert.match(bar, /title="Step forward"/);
	assert.equal(
		(bar.match(/class="mode-side-btn pad-bar-btn"/g) || []).length,
		2,
		"same shape as the edit keys: the box is derived from the shared class",
	);
});

test("a tap sends the bare wire message, nothing else", () => {
	const ctx = buildRemote();
	ctx.api.remoteStep("back");
	ctx.api.remoteStep("forward");
	assert.deepEqual(ctx.sent, [
		{ type: "step-backward", data: {} },
		{ type: "step-forward", data: {} },
	]);
});

test("the server accepts both as bare messages and emits with no arguments", () => {
	const { CLIENT_MESSAGE_TYPES } = LEOBroadcastServer;
	assert.ok(CLIENT_MESSAGE_TYPES.has("step-backward"));
	assert.ok(CLIENT_MESSAGE_TYPES.has("step-forward"));

	const emitted = [];
	const fake = { emit: (...a) => emitted.push(a) };
	const handle = (message) =>
		LEOBroadcastServer.prototype.handleClientMessage.call(fake, message);
	handle({ type: "step-backward" });
	handle({ type: "step-forward", data: { stepIndex: 999 } });
	assert.deepEqual(emitted, [
		["client-step-backward"],
		["client-step-forward"],
	]);
});

test("main relays them onto the exact channels the desktop's own Ctrl+Left/Right already send", () => {
	const main = read("main/main.js");
	const settings = read("shared/settings-schema.js");
	assert.match(
		settings,
		/key: "stepBackward"[\s\S]*?channel: "hotkey-step-backward",\s*step: -1,/,
		"the remote button has to land on the same channel the global shortcut uses",
	);
	assert.match(
		settings,
		/key: "stepForward"[\s\S]*?channel: "hotkey-step-forward",\s*step: 1,/,
	);
	assert.match(
		main,
		/"client-step-backward", \(\) => hotkeyManager\.step\(-1\)\)/,
		"the phone's ◀ is the desktop shortcut, through the same function",
	);
	assert.match(
		main,
		/"client-step-forward", \(\) => hotkeyManager\.step\(1\)\)/,
	);
	assert.match(
		main,
		/state\.onStepKey = \(delta\) => stepMoveToName\(delta\);/,
	);
});

function hotkeys() {
	const registered = {};
	const sent = [];
	const state = { send: (ch) => sent.push(ch), onStepKey: null };
	const HotkeyManager = require("./helpers/load-module").loadModule(
		"src/main/hotkey-manager.js",
		{
			electron: {
				globalShortcut: { register: (k, fn) => (registered[k] = fn) },
			},
			"./state": state,
		},
	);
	const manager = new HotkeyManager({
		get: () => ({
			toggleActive: "T",
			stepBackward: "L",
			stepForward: "R",
			alwaysOnTop: "A",
			toggleTransparency: "O",
			toggleWindow: "W",
		}),
	});
	manager.registerSystemShortcuts();
	return { registered, sent, state };
}

test("Ctrl+Left/Right step the plan unless something else claims the step", () => {
	const h = hotkeys();
	h.registered.L();
	h.registered.R();
	h.registered.T();
	assert.deepEqual(h.sent, [
		"hotkey-step-backward",
		"hotkey-step-forward",
		"hotkey-toggle-active",
	]);

	const claimed = [];
	h.state.onStepKey = (delta) => (claimed.push(delta), true);
	h.registered.L();
	h.registered.R();
	assert.deepEqual(claimed, [-1, 1]);
	assert.equal(h.sent.length, 3, "a claimed step never reaches the plan");

	h.state.onStepKey = () => false;
	h.registered.R();
	assert.equal(h.sent.at(-1), "hotkey-step-forward");
});

test("the renderer needs no new listener: it already answers the desktop hotkey's channel", () => {
	const app = read("renderer/app.js");
	assert.match(
		app,
		/ipcRenderer\.on\("hotkey-step-backward", \(\) => cursorManager\.stepBackward\(\)\)/,
	);
	assert.match(
		app,
		/ipcRenderer\.on\("hotkey-step-forward", \(\) => cursorManager\.stepForward\(\)\)/,
	);
});

test("stepping back and forward is refused while a blocking overlay or an unstarted lesson closes the keyboard pad", async () => {
	const ctx = buildRemote();
	assert.equal(
		ctx.nodes.touchpadStepKeys.classList.contains("visible"),
		false,
		"nothing is open yet",
	);

	ctx.api.setSessionActive(false);
	await ctx.api.setTouchpadMode("keyboard");
	assert.equal(
		ctx.api.padMode(),
		null,
		"the keyboard pad itself refuses to open before typing starts, so its " +
			"step buttons never appear for a lesson that has not begun",
	);
});
