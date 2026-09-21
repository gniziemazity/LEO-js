"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadModule } = require("./helpers/load-module");
const LEOBroadcastServer = require("../src/main/websocket-server");
const { createAutoPilot } = require("../src/main/auto-pilot");

const SRC = path.resolve(__dirname, "..", "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf-8");

function fixture(initialClients = 1, graceMs = 5) {
	const sent = [];
	const broadcasts = [];
	const state = {
		autoPilot: false,
		isActive: true,
		send: (channel, ...args) => sent.push([channel, ...args]),
	};
	const server = {
		clients: initialClients,
		clientCount() {
			return this.clients;
		},
		updateAutoPilot: (on) => broadcasts.push(on),
	};
	const pilot = createAutoPilot({
		state,
		broadcastServer: server,
		graceMs,
	});
	return { pilot, state, server, sent, broadcasts };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("turning auto-pilot on tells the phones and the desktop window", () => {
	const f = fixture();
	f.pilot.set(true);

	assert.equal(f.state.autoPilot, true);
	assert.deepEqual(f.broadcasts, [true]);
	assert.deepEqual(f.sent, [["auto-pilot", true]]);
});

test("without a remote it cannot be turned on", () => {
	const f = fixture(0);
	f.pilot.set(true);

	assert.equal(f.state.autoPilot, false);
	assert.deepEqual(f.broadcasts, []);
	assert.deepEqual(f.sent, []);
});

test("it cannot be turned on while auto-typing is off", () => {
	const f = fixture();
	f.state.isActive = false;
	f.pilot.set(true);

	assert.equal(f.state.autoPilot, false);
	assert.deepEqual(f.broadcasts, []);
	assert.deepEqual(f.sent, []);
});

test("stopping auto-typing turns auto-pilot off, and starting it again brings it back", () => {
	const f = fixture();
	f.pilot.set(true);
	f.sent.length = 0;

	f.state.isActive = false;
	f.pilot.onActiveChanged();
	assert.equal(f.state.autoPilot, false);
	assert.deepEqual(f.broadcasts, [true, false]);
	assert.deepEqual(f.sent, [["auto-pilot", false]]);

	f.sent.length = 0;
	f.state.isActive = true;
	f.pilot.onActiveChanged();
	assert.equal(
		f.state.autoPilot,
		true,
		"it was on when typing paused, so it is on again",
	);
	assert.deepEqual(f.broadcasts, [true, false, true]);
	assert.deepEqual(f.sent, [["auto-pilot", true]]);
});

test("starting auto-typing never turns on an auto-pilot that was not on before", () => {
	const f = fixture();
	f.state.isActive = false;
	f.pilot.onActiveChanged();
	f.state.isActive = true;
	f.pilot.onActiveChanged();

	assert.equal(f.state.autoPilot, false);
	assert.deepEqual(f.sent, []);
	assert.deepEqual(f.broadcasts, []);
});

test("the memory survives a second stop, and is spent by the resume", () => {
	const f = fixture();
	f.pilot.set(true);

	f.state.isActive = false;
	f.pilot.onActiveChanged();
	f.pilot.onActiveChanged();
	f.state.isActive = true;
	f.pilot.onActiveChanged();
	assert.equal(f.state.autoPilot, true);

	f.pilot.set(false);
	f.state.isActive = false;
	f.pilot.onActiveChanged();
	f.state.isActive = true;
	f.pilot.onActiveChanged();
	assert.equal(
		f.state.autoPilot,
		false,
		"the teacher switched it off, so play does not bring it back",
	);
});

test("switching auto-pilot off while auto-typing is stopped forgets the resume", () => {
	const f = fixture();
	f.pilot.set(true);
	f.state.isActive = false;
	f.pilot.onActiveChanged();

	f.pilot.set(false);
	f.state.isActive = true;
	f.pilot.onActiveChanged();
	assert.equal(f.state.autoPilot, false);
});

test("with no remote left when auto-typing resumes, there is nothing to resume, now or later", () => {
	const f = fixture();
	f.pilot.set(true);
	f.state.isActive = false;
	f.pilot.onActiveChanged();

	f.server.clients = 0;
	f.state.isActive = true;
	f.pilot.onActiveChanged();
	assert.equal(f.state.autoPilot, false);

	f.server.clients = 1;
	f.state.isActive = false;
	f.pilot.onActiveChanged();
	f.state.isActive = true;
	f.pilot.onActiveChanged();
	assert.equal(
		f.state.autoPilot,
		false,
		"the memory was spent on the failed resume",
	);
});

test("a grace-period switch-off is a real off: a later resume does not revive it", async () => {
	const f = fixture();
	f.pilot.set(true);
	f.server.clients = 0;
	f.pilot.onClientDisconnected();
	await sleep(30);
	assert.equal(f.state.autoPilot, false);

	f.server.clients = 1;
	f.state.isActive = false;
	f.pilot.onActiveChanged();
	f.state.isActive = true;
	f.pilot.onActiveChanged();
	assert.equal(f.state.autoPilot, false);
});

test("auto-typing changing while auto-pilot is off announces nothing", () => {
	const f = fixture();
	f.state.isActive = false;
	f.pilot.onActiveChanged();
	assert.deepEqual(f.sent, []);
	assert.deepEqual(f.broadcasts, []);
});

test("only a real true turns it on: the message and the IPC are untrusted", () => {
	const f = fixture();
	for (const junk of ["true", 1, {}, null, undefined]) f.pilot.set(junk);
	assert.equal(f.state.autoPilot, false);
});

test("repeating the current value announces nothing", () => {
	const f = fixture();
	f.pilot.set(true);
	f.sent.length = 0;
	f.broadcasts.length = 0;

	f.pilot.set(true);
	assert.deepEqual(f.sent, []);
	assert.deepEqual(f.broadcasts, []);
});

test("the desktop learns how many remotes are connected", () => {
	const f = fixture(2);
	f.pilot.onClientConnected();
	f.server.clients = 1;
	f.pilot.onClientDisconnected();

	assert.deepEqual(f.sent, [
		["remote-count", 2],
		["remote-count", 1],
	]);
});

test("the last remote leaving turns it off after the grace period", async () => {
	const f = fixture();
	f.pilot.set(true);
	f.sent.length = 0;

	f.server.clients = 0;
	f.pilot.onClientDisconnected();
	assert.equal(
		f.state.autoPilot,
		true,
		"not yet: the phone may be reconnecting",
	);

	await sleep(30);
	assert.equal(f.state.autoPilot, false);
	assert.deepEqual(f.broadcasts, [true, false]);
	assert.deepEqual(f.sent, [
		["remote-count", 0],
		["auto-pilot", false],
	]);
});

test("a phone that reconnects inside the grace period keeps auto-pilot", async () => {
	const f = fixture(1, 20);
	f.pilot.set(true);

	f.server.clients = 0;
	f.pilot.onClientDisconnected();
	f.server.clients = 1;
	f.pilot.onClientConnected();

	await sleep(50);
	assert.equal(f.state.autoPilot, true);
});

test("another remote still connected means nothing to switch off", async () => {
	const f = fixture(2);
	f.pilot.set(true);

	f.server.clients = 1;
	f.pilot.onClientDisconnected();
	await sleep(30);
	assert.equal(f.state.autoPilot, true);
});

test("a reloaded desktop window is brought up to date", () => {
	const f = fixture(3);
	f.pilot.set(true);
	f.sent.length = 0;

	f.pilot.sync();
	assert.deepEqual(f.sent, [
		["remote-count", 3],
		["auto-pilot", true],
	]);
});

test("the phone's request is a strict boolean, and off is the default", () => {
	const { CLIENT_MESSAGE_TYPES } = LEOBroadcastServer;
	assert.ok(CLIENT_MESSAGE_TYPES.has("set-auto-pilot"));
	assert.equal(/^(material|jedi|gesture)-/.test("set-auto-pilot"), false);

	const emitted = [];
	const fake = { emit: (...a) => emitted.push(a) };
	const handle = (message) =>
		LEOBroadcastServer.prototype.handleClientMessage.call(fake, message);
	handle({ type: "set-auto-pilot", data: { autoPilot: true } });
	handle({ type: "set-auto-pilot", data: { autoPilot: "yes" } });
	handle({ type: "set-auto-pilot", data: {} });
	handle({ type: "set-auto-pilot" });
	assert.deepEqual(emitted, [
		["client-set-auto-pilot", true],
		["client-set-auto-pilot", false],
		["client-set-auto-pilot", false],
		["client-set-auto-pilot", false],
	]);
});

test("a phone that connects later is told, through the state it receives", () => {
	const sent = [];
	const fake = {
		currentState: { autoPilot: false },
		broadcast: (m) => sent.push(m),
	};
	LEOBroadcastServer.prototype.updateAutoPilot.call(fake, true);

	assert.equal(fake.currentState.autoPilot, true);
	assert.deepEqual(sent, [{ type: "auto-pilot", data: { autoPilot: true } }]);
	assert.equal(
		new LEOBroadcastServer(0).currentState.autoPilot,
		false,
		"a new session starts with auto-pilot off",
	);
});

test("the server counts only open sockets", () => {
	const OPEN = 1;
	const fake = {
		wss: {
			clients: new Set([
				{ readyState: OPEN },
				{ readyState: 2 },
				{ readyState: OPEN },
			]),
		},
	};
	assert.equal(LEOBroadcastServer.prototype.clientCount.call(fake), 2);
	assert.equal(
		LEOBroadcastServer.prototype.clientCount.call({ wss: null }),
		0,
	);
});

test("main wires the switch from the desktop button, the phone and the connections", () => {
	const main = read("main/main.js");
	assert.match(main, /require\("\.\/auto-pilot"\)/);
	assert.match(
		main,
		/ipcMain\.on\("set-auto-pilot", \(event, on\) => autoPilot\.set\(on === true\)\)/,
	);
	assert.match(
		main,
		/"client-set-auto-pilot", \(on\) => autoPilot\.set\(on\)/,
	);
	assert.match(
		main,
		/"client-connected", \(\) => \{\s*autoPilot\.onClientConnected\(\);/,
	);
	assert.match(
		main,
		/"client-disconnected", \(\) => \{\s*autoPilot\.onClientDisconnected\(\);/,
	);
	assert.match(
		main,
		/autoPilot\.sync\(\);/,
		"a reloaded window is told at load",
	);
	const original = main.indexOf(
		'ipcMain.on("set-active", (event, isActive) => {',
	);
	const listener = main.indexOf(
		'ipcMain.on("set-active", () => autoPilot.onActiveChanged());',
	);
	assert.ok(
		original > 0 && listener > original,
		"the listener must run after the handler that sets isActive",
	);
});

test("the desktop bar has the button, disabled until a remote is there", () => {
	const html = read("index.html");
	const play = html.indexOf('id="toggleBtn"');
	const auto = html.indexOf('id="autoPilotBtn"');
	assert.ok(play > 0 && auto > play, "auto-pilot sits next to play");
	assert.match(html, /id="autoPilotBtn"[^>]*\bdisabled\b/);

	const app = read("renderer/app.js");
	assert.match(
		app,
		/ipcRenderer\.send\("set-auto-pilot", !uiManager\.autoPilotOn\)/,
	);
	assert.match(
		app,
		/ipcRenderer\.on\("auto-pilot", \(e, on\) => uiManager\.setAutoPilot\(on\)\)/,
	);
	assert.match(
		app,
		/ipcRenderer\.on\("remote-count", \(e, count\) =>\s*uiManager\.setRemotesConnected\(count > 0\)/,
	);
});

function hotkeys(settings) {
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
	const manager = new HotkeyManager({
		get: (key) =>
			key === "hotkeys.typing" ? ["a", "b", "c"] : settings[key],
	});
	return { manager, registered };
}

test("the typing hotkeys stay on when the setting is off, remote or not", () => {
	const h = hotkeys({ typingHotkeysOffWithRemote: false });
	h.manager.setRemoteConnected(true);
	h.manager.registerTypingHotkeys();

	assert.equal(h.manager.typingHotkeysEnabled(), true);
	assert.deepEqual([...h.registered.keys()], ["a", "b", "c"]);
});

test("with the setting on, no remote means the hotkeys work as ever", () => {
	const h = hotkeys({ typingHotkeysOffWithRemote: true });
	h.manager.registerTypingHotkeys();

	assert.equal(h.manager.typingHotkeysEnabled(), true);
	assert.deepEqual([...h.registered.keys()], ["a", "b", "c"]);
});

test("with the setting on, a remote takes the letters back to the keyboard", () => {
	const state = require("../src/main/state");
	state.isActive = true;
	try {
		const h = hotkeys({ typingHotkeysOffWithRemote: true });
		h.manager.registerTypingHotkeys();
		assert.equal(h.registered.size, 3);

		h.manager.setRemoteConnected(true);
		assert.equal(
			h.registered.size,
			0,
			"released the moment a remote connects",
		);
		assert.equal(h.manager.typingHotkeysEnabled(), false);

		h.manager.registerTypingHotkeys();
		h.manager.registerKey("a");
		assert.equal(
			h.registered.size,
			0,
			"and nothing puts them back while it is there",
		);
		assert.deepEqual(
			h.manager.typingHotkeysFor("a"),
			[],
			"so typing a name releases nothing",
		);
		assert.deepEqual(h.manager.releaseTypingHotkeysFor("a"), []);

		h.manager.setRemoteConnected(false);
		assert.deepEqual(
			[...h.registered.keys()],
			["a", "b", "c"],
			"back when the last remote leaves",
		);
	} finally {
		state.isActive = false;
	}
});

test("a remote connecting while typing is off leaves the letters alone", () => {
	const state = require("../src/main/state");
	state.isActive = false;
	const h = hotkeys({ typingHotkeysOffWithRemote: true });
	h.manager.setRemoteConnected(true);
	h.manager.setRemoteConnected(false);
	assert.equal(
		h.registered.size,
		0,
		"no registering for a session that is not typing",
	);
});

test("only the typing hotkeys are gated: the other shortcuts keep working", () => {
	const h = hotkeys({
		typingHotkeysOffWithRemote: true,
		"hotkeys.confirmPopup": "CommandOrControl+Enter",
	});
	h.manager.setRemoteConnected(true);

	h.manager.registerConfirmPopup(() => {});
	h.manager.registerEscapeForAutoTyping();
	assert.ok(h.registered.has("CommandOrControl+Enter"));
	assert.ok(h.registered.has("Escape"));
});

test("the keyboard handler skips the per-letter release when the letters are not held", () => {
	const src = read("main/keyboard-handler.js");
	const gated = src.match(
		/this\.hotkeyManager\.typingHotkeysEnabled\(\) &&\s*typingHotkeys\.includes\(charLower\)/g,
	);
	assert.equal(
		gated && gated.length,
		2,
		"typeCharacter and autoTypeBlock both",
	);
});

test("the setting ships off, in Settings, and is saved with the rest", () => {
	const manager = read("main/settings-manager.js");
	assert.match(manager, /typingHotkeysOffWithRemote: false/);

	const html = read("index.html");
	assert.match(
		html,
		/<input\s+type="checkbox"\s+id="typingHotkeysOffWithRemote"\s*\/>/,
	);

	const ui = read("renderer/settings-ui.js");
	assert.match(
		ui,
		/"typingHotkeysOffWithRemote"\)\.checked =\s*settings\.typingHotkeysOffWithRemote === true/,
	);
	assert.match(
		ui,
		/typingHotkeysOffWithRemote: document\.getElementById\(\s*"typingHotkeysOffWithRemote",\s*\)\.checked/,
	);
});

function fakeUiManager() {
	const UIManager = loadModule("src/renderer/ui-manager.js", {
		"../shared/blocks": require("../src/shared/blocks"),
		"./block-types": { KIND_PLACEHOLDERS: {} },
	});
	const ui = new UIManager();
	const btn = { disabled: true, classList: { toggle() {} } };
	const noop = {
		classList: { add() {}, remove() {} },
		textContent: "",
		title: "",
	};
	ui.elements = { autoPilotBtn: btn, toggleBtn: noop, editorSidebar: noop };
	return { ui, btn };
}

test("the auto-pilot button wears the app's one toggled-on class", () => {
	const css = read("shared/styles.css");
	assert.match(css, /--toggle-ring: 0 0 0 2px var\(--clr-white\);/);
	assert.match(
		css,
		/\.interaction-btn\.btn-auto\.mode-active \{[^}]*box-shadow: var\(--toggle-ring\)/,
	);
	assert.match(
		css,
		/\.mode-side-btn\.mode-active \{[^}]*box-shadow: var\(--toggle-ring\)/,
	);
	for (const f of ["renderer/ui-manager.js", "shared/remote/touchpad.js"]) {
		const src = read(f);
		assert.match(src, /classList\.toggle\("mode-active"/, f);
		assert.equal(
			src.includes("auto-on"),
			false,
			f + " keeps a second name for one state",
		);
	}
	assert.equal(css.includes("auto-on"), false);
});

test("the desktop button needs both a remote and auto-typing", () => {
	const { ui, btn } = fakeUiManager();
	global.document = { body: { classList: { add() {}, remove() {} } } };
	try {
		assert.equal(btn.disabled, true);

		ui.setRemotesConnected(true);
		assert.equal(btn.disabled, true, "a remote alone is not enough");

		ui.setTypingActive(true);
		assert.equal(btn.disabled, false, "both: it can be pressed");

		ui.setTypingActive(false);
		assert.equal(btn.disabled, true, "typing stops: it goes dark again");

		ui.setTypingActive(true);
		ui.setRemotesConnected(false);
		assert.equal(btn.disabled, true, "the last remote leaves");
	} finally {
		delete global.document;
	}
});
