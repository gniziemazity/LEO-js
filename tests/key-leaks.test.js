"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModule } = require("./helpers/load-module");

const MAIN = path.resolve(__dirname, "..", "src/main");
const state = require(path.join(MAIN, "state.js"));
const platform = require(path.join(MAIN, "platform.js"));
const { Key } = require("@computer-use/nut-js");
const {
	HOTKEY_SETTINGS,
	defaultsFrom,
} = require("../src/shared/settings-schema");

const SYSTEM = defaultsFrom(HOTKEY_SETTINGS);
const SYSTEM_HELD = [
	SYSTEM.toggleActive,
	SYSTEM.stepBackward,
	SYSTEM.stepForward,
	SYSTEM.alwaysOnTop,
	SYSTEM.toggleTransparency,
	SYSTEM.toggleWindow,
];
const GUARD_LINGER_MS = 150;
const TOGGLE_REPEAT_MS = 1000;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const guardsGone = () => pause(GUARD_LINGER_MS + 80);

function sameShortcut(accelerator) {
	const parts = String(accelerator).toLowerCase().split("+");
	const key = parts.pop();
	const modifiers = parts
		.map((m) =>
			/^(commandorcontrol|cmdorctrl|ctrl)$/.test(m) ? "control" : m,
		)
		.sort();
	return [...modifiers, key].join("+");
}

function build({
	oneStep = true,
	typing = ["a", "b", "s"],
	settings = {},
} = {}) {
	const registered = new Map();
	const ops = [];
	const globalShortcut = {
		register: (accel, cb) => {
			registered.set(sameShortcut(accel), { accel, cb });
			ops.push(`+${accel}`);
			return true;
		},
		unregister: (accel) => {
			if (registered.delete(sameShortcut(accel))) ops.push(`-${accel}`);
		},
		unregisterAll: () => registered.clear(),
		isRegistered: (accel) => registered.has(sameShortcut(accel)),
	};
	const fire = (accel) => registered.get(sameShortcut(accel)).cb();
	const HotkeyManager = loadModule("src/main/hotkey-manager.js", {
		electron: { globalShortcut },
	});
	const settingsManager = {
		get: (key) => {
			if (key === "hotkeys.typing") return typing;
			if (key === "hotkeys") return SYSTEM;
			return settings[key];
		},
	};
	const hotkeys = new HotkeyManager(settingsManager);

	const calls = [];
	const held = () => [...registered.values()].map((entry) => entry.accel);
	const at = () => performance.now();
	const libnut = {
		typeString: (text) =>
			calls.push({ via: "typeString", text, held: held(), at: at() }),
		keyToggle: (key, direction, modifiers) =>
			calls.push({
				via: "keyToggle",
				key,
				direction,
				modifiers,
				held: held(),
				at: at(),
			}),
	};
	const keyboard = {
		config: {},
		type: async (...keys) => {
			if (typeof keys[0] === "string") {
				await new Promise((resolve) => setTimeout(resolve, 0));
			}
			calls.push({ via: "keyboard.type", keys, held: held(), at: at() });
		},
	};
	const KeyboardHandler = loadModule("src/main/keyboard-handler.js", {
		"@computer-use/nut-js": { keyboard, Key },
		"@computer-use/libnut/dist/import_libnut": { libnut },
		"./platform": { ...platform, typesInOneStep: () => oneStep },
	});
	const handler = new KeyboardHandler(hotkeys, settingsManager);

	return { hotkeys, handler, fire, calls, held, ops };
}

async function whileActive(run) {
	const send = state.send;
	const sent = [];
	state.reset();
	state.isActive = true;
	state.send = (channel) => sent.push(channel);
	try {
		await run(sent);
	} finally {
		state.send = send;
		state.reset();
	}
}

test("a letter's hotkey is released for its own key-down only, within one turn of the event loop", () =>
	whileActive(() => {
		const h = build();
		h.hotkeys.registerAutoTypingHotkeys();
		h.ops.length = 0;

		h.handler.typeCharWithHotkeyManagement("a");

		assert.deepEqual(
			h.calls.map((c) => [c.via, c.key, c.direction, c.modifiers]),
			[
				["keyToggle", "a", "down", []],
				["keyToggle", "a", "up", []],
			],
			"both halves have gone out before the call returns: a timer in between " +
				"left the letter free for 4 to 17 ms, and a real press of it reached the editor",
		);
		const [down, up] = h.calls;
		assert.deepEqual(down.held, ["b", "s"], "every other letter stays held");
		assert.ok(
			up.held.includes("a"),
			"the letter is held again before its key is even let go",
		);
		assert.deepEqual(
			h.ops,
			["-a", "+a"],
			"Electron dies if a press of a released shortcut is still waiting when " +
				"a different shortcut takes its place: the same one must come back",
		);
	}));

test("Shift+letter is the teacher's while LEO is not holding Shift", () =>
	whileActive(() => {
		const h = build();
		h.hotkeys.registerAutoTypingHotkeys();
		assert.deepEqual(
			h.held(),
			["a", "b", "s"],
			"held all the time, Shift+a stopped typing the teacher's own A and " +
				"advanced the lesson with Shift down, capitalizing the plan's characters",
		);

		h.handler.typeCharWithHotkeyManagement("a");
		h.handler.typeCharWithHotkeyManagement(" ");
		assert.deepEqual(
			h.held().sort(),
			["a", "b", "s"],
			"a lower-case letter and a space never need Shift, so they take nothing",
		);
	}));

test("while LEO holds Shift for a capital, every other letter is caught with Shift", () =>
	whileActive(async (sent) => {
		const h = build();
		h.hotkeys.registerAutoTypingHotkeys();
		h.ops.length = 0;

		h.handler.typeCharWithHotkeyManagement("B");

		assert.deepEqual(
			h.calls.map((c) => [c.key, c.direction, c.modifiers]),
			[
				["b", "down", ["shift"]],
				["b", "up", ["shift"]],
			],
		);
		const [down, up] = h.calls;
		assert.ok(
			down.held.includes("Shift+a") && down.held.includes("Shift+s"),
			"a real a landing inside LEO's own Shift is Shift+A to the OS and " +
				"reached the editor as a capital",
		);
		assert.equal(
			down.held.includes("Shift+b"),
			false,
			"LEO's own B gets through",
		);
		assert.ok(
			down.held.includes("b"),
			"Shift+B is no match for the bare b: it stays",
		);
		assert.ok(up.held.includes("Shift+b"), "back while Shift is still down");
		assert.deepEqual(
			h.ops,
			["+Shift+a", "+Shift+b", "+Shift+s", "-Shift+b", "+Shift+b"],
			"the guards go up before anything is released, never in between",
		);

		h.fire("Shift+a");
		assert.deepEqual(
			sent,
			[],
			"a guard only swallows: advancing with a real Shift held would type " +
				"the plan's next character shifted",
		);

		await guardsGone();
		assert.deepEqual(h.held().sort(), ["a", "b", "s"]);
	}));

test("a symbol may need Shift on this keyboard, so it is guarded too", () =>
	whileActive(async () => {
		const h = build();
		h.hotkeys.registerAutoTypingHotkeys();

		h.handler.typeCharWithHotkeyManagement("{");

		assert.deepEqual(
			h.calls.map((c) => [c.via, c.text]),
			[["typeString", "{"]],
		);
		assert.deepEqual(
			h.calls[0].held.sort(),
			["Shift+a", "Shift+b", "Shift+s", "a", "b", "s"],
			"nothing released: no auto-typing key produces a brace",
		);
		await guardsGone();
	}));

test("a hotkey that is not a letter is released around its whole keystroke", () =>
	whileActive(async () => {
		const h = build({ typing: ["a", "1"] });
		h.hotkeys.registerAutoTypingHotkeys();
		h.ops.length = 0;

		h.handler.typeCharWithHotkeyManagement("1");

		assert.deepEqual(
			h.calls.map((c) => [c.via, c.text]),
			[["typeString", "1"]],
			"the two-step press is for letters: a digit's Shift form is a symbol",
		);
		assert.equal(h.calls[0].held.includes("1"), false);
		assert.deepEqual(
			h.ops,
			["+Shift+a", "-1", "+1"],
			"only letters get a guard, and it is up before the release",
		);
		await guardsGone();
	}));

test("keys LEO presses that are not characters keep going through nut-js", () =>
	whileActive(async () => {
		const h = build();
		h.hotkeys.registerAutoTypingHotkeys();

		for (const glyph of ["↩", "\n", "\t", "⌫"]) {
			await h.handler.typeCharWithHotkeyManagement(glyph);
		}

		assert.deepEqual(
			h.calls.map((c) => [c.via, c.keys]),
			[
				["keyboard.type", [Key.Enter]],
				["keyboard.type", [Key.Enter]],
				["keyboard.type", [Key.Tab]],
				["keyboard.type", [Key.Backspace]],
			],
		);
	}));

test("off Windows the letter is still released around an awaited keystroke", () =>
	whileActive(async () => {
		const h = build({ oneStep: false });
		h.hotkeys.registerAutoTypingHotkeys();

		await h.handler.typeCharWithHotkeyManagement("a");
		await h.handler.typeCharWithHotkeyManagement("B");

		assert.deepEqual(
			h.calls.map((c) => [c.via, c.keys]),
			[
				["keyboard.type", ["a"]],
				["keyboard.type", ["B"]],
			],
			"hotkey changes are only known to take effect at once on Windows",
		);
		assert.deepEqual(h.calls[0].held, ["b", "s"]);
		assert.deepEqual(
			h.calls[1].held.sort(),
			["a", "s"],
			"and no guards there",
		);
		assert.deepEqual(h.held().sort(), ["a", "b", "s"]);
	}));

test("while LEO holds Ctrl, every other auto-typing letter is caught with Ctrl", () =>
	whileActive(async (sent) => {
		const h = build();
		h.hotkeys.registerSystemShortcuts();
		h.hotkeys.registerAutoTypingHotkeys();
		const before = h.held().sort();
		h.ops.length = 0;

		await h.handler.typeCharWithHotkeyManagement("💾");

		const [chord, letGo] = h.calls;
		assert.deepEqual(
			h.calls.map((c) => [c.via, c.key, c.direction, c.modifiers]),
			[
				["keyToggle", "s", "down", ["control"]],
				["keyToggle", "s", "up", ["control"]],
			],
		);
		assert.ok(
			chord.held.includes("Control+a") && chord.held.includes("Control+b"),
			"a real letter landing inside LEO's own Ctrl is Ctrl+letter to the OS: " +
				"select all, close tab, find",
		);
		assert.equal(
			chord.held.includes("Control+s"),
			false,
			"the chord's own key has to get through",
		);
		assert.ok(
			letGo.held.includes("Control+s"),
			"and is caught again while LEO still holds Ctrl: a second Ctrl+K " +
				"would delete one more line",
		);
		assert.ok(
			h.held().includes("Control+a") && h.held().includes("Control+s"),
			"a key caught during the chord is only handled after it: taking the " +
				"guards down in the same step and registering anything else crashes Electron",
		);
		assert.deepEqual(
			h.ops.filter((op) => op.startsWith("-")),
			["-Control+s"],
			"only the chord's own key steps aside, and it is the next one registered",
		);
		assert.equal(h.ops.at(-1), "+Control+s");
		for (const accelerator of SYSTEM_HELD) {
			assert.ok(
				h.held().includes(accelerator),
				"LEO's own shortcuts stay put",
			);
		}

		h.fire("Control+a");
		assert.deepEqual(sent, [], "swallowed, like every guard");

		await guardsGone();
		assert.deepEqual(
			h.held().sort(),
			before,
			"gone again soon after: Ctrl+Z and Ctrl+S stay the teacher's",
		);
	}));

test("a letter shortcut of LEO's own is swallowed only while its own modifiers are guarded", () =>
	whileActive(async (sent) => {
		const h = build({ typing: ["a", "p"] });
		h.hotkeys.registerSystemShortcuts();
		h.hotkeys.registerAutoTypingHotkeys();

		h.handler.typeCharWithHotkeyManagement("{");
		h.fire(SYSTEM.toggleActive);
		assert.deepEqual(
			sent,
			["hotkey-toggle-active"],
			"LEO holding Shift is no reason to ignore Ctrl+P: stopping auto-typing " +
				"has to work in the middle of it",
		);

		await h.handler.typeCharWithHotkeyManagement("💾");
		assert.equal(
			h.held().includes("Control+p"),
			false,
			"Ctrl+P is already LEO's own: it gets no guard",
		);
		h.fire(SYSTEM.toggleActive);
		assert.deepEqual(
			sent,
			["hotkey-toggle-active"],
			"a real P inside LEO's Ctrl+S used to switch auto-typing off mid-lesson",
		);
		h.fire(SYSTEM.stepForward);
		assert.equal(
			sent.at(-1),
			"hotkey-step-forward",
			"no letter can produce Ctrl+Right, so that one is always the teacher's",
		);

		await guardsGone();
		const realNow = Date.now;
		Date.now = () => realNow() + TOGGLE_REPEAT_MS;
		try {
			h.fire(SYSTEM.toggleActive);
		} finally {
			Date.now = realNow;
		}
		assert.deepEqual(
			sent.slice(-1),
			["hotkey-toggle-active"],
			"and later it is itself again",
		);
	}));

test("a held toggle shortcut toggles once, however long the key repeats", () =>
	whileActive((sent) => {
		const h = build();
		const toggled = [];
		state.mainWindow = {
			isDestroyed: () => false,
			isAlwaysOnTop: () => toggled.length % 2 === 1,
			setAlwaysOnTop: (on) => toggled.push(on),
		};
		const realNow = Date.now;
		let now = 1_000_000;
		Date.now = () => now;
		try {
			h.hotkeys.registerSystemShortcuts();

			h.fire(SYSTEM.alwaysOnTop);
			now += 500;
			for (let i = 0; i < 20; i++) {
				h.fire(SYSTEM.alwaysOnTop);
				now += 33;
			}
			assert.deepEqual(
				toggled,
				[true],
				"Windows repeats a held key every 33 ms after a short delay, and each " +
					"repeat flipped it again: let go on an even count and LEO dropped " +
					"behind the editor",
			);

			now += TOGGLE_REPEAT_MS;
			h.fire(SYSTEM.alwaysOnTop);
			assert.deepEqual(
				toggled,
				[true, false],
				"a new press after letting go toggles",
			);

			h.fire(SYSTEM.toggleActive);
			now += 600;
			h.fire(SYSTEM.toggleActive);
			assert.deepEqual(
				sent,
				["hotkey-toggle-active"],
				"holding Ctrl+P switched auto-typing on and off the same way",
			);

			h.fire(SYSTEM.stepForward);
			now += 33;
			h.fire(SYSTEM.stepForward);
			assert.deepEqual(
				sent.slice(1),
				["hotkey-step-forward", "hotkey-step-forward"],
				"a step is not a toggle: holding it keeps stepping",
			);
		} finally {
			Date.now = realNow;
			state.mainWindow = null;
		}
	}));

test("the guard matches the chord's own modifiers", () =>
	whileActive(async () => {
		const h = build({ typing: ["a", "k"] });
		h.hotkeys.registerSystemShortcuts();
		h.hotkeys.registerAutoTypingHotkeys();

		await h.handler.typeCharWithHotkeyManagement("⛔");
		await h.handler.typeCharWithHotkeyManagement("🔁");
		await h.handler.typeCharWithHotkeyManagement("⇑");
		await h.handler.typeCharWithHotkeyManagement("→");

		const [deleteLine, , switchWindow, selectUp, right] = h.calls;
		assert.deepEqual(deleteLine.modifiers, ["control", "shift"]);
		assert.deepEqual(switchWindow.keys, [Key.LeftAlt, Key.Tab]);
		assert.deepEqual(selectUp.keys, [Key.LeftShift, Key.Up]);
		assert.ok(deleteLine.held.includes("Control+Shift+a"));
		assert.equal(deleteLine.held.includes("Control+Shift+k"), false);
		assert.equal(deleteLine.held.includes("Control+a"), false);
		assert.ok(
			switchWindow.held.includes("Alt+a") &&
				switchWindow.held.includes("Alt+k"),
		);
		assert.ok(
			selectUp.held.includes("Shift+a") && selectUp.held.includes("Shift+k"),
		);
		assert.deepEqual(
			right.held,
			selectUp.held,
			"a bare key holds no modifier, so it arms nothing of its own",
		);
		await guardsGone();
	}));

test("a second chord inside the first one's guard lets its own key through and keeps the rest", () =>
	whileActive(async () => {
		const h = build({ typing: ["a", "n", "s"] });
		h.hotkeys.registerAutoTypingHotkeys();
		const before = h.held().sort();

		await h.handler.typeCharWithHotkeyManagement("💾");
		await h.handler.typeCharWithHotkeyManagement("ñ");

		const newFile = h.calls[2];
		assert.deepEqual(
			[newFile.key, newFile.direction, newFile.modifiers],
			["n", "down", ["control"]],
		);
		assert.equal(
			newFile.held.includes("Control+n"),
			false,
			"or the guard left by the save would swallow LEO's own Ctrl+N",
		);
		assert.ok(
			newFile.held.includes("Control+s") &&
				newFile.held.includes("Control+a"),
		);

		await guardsGone();
		assert.deepEqual(h.held().sort(), before);
	}));

test("no guard when the keyboard is the teacher's, or off Windows", async () => {
	await whileActive(async () => {
		const h = build({ settings: { typingHotkeysOffWithRemote: true } });
		h.hotkeys.registerSystemShortcuts();
		h.hotkeys.setRemoteConnected(true);
		const before = h.held().sort();
		await h.handler.typeCharWithHotkeyManagement("💾");
		h.handler.typeCharWithHotkeyManagement("B");
		for (const call of h.calls) assert.deepEqual(call.held.sort(), before);
	});

	await whileActive(async () => {
		const h = build({ oneStep: false });
		h.hotkeys.registerSystemShortcuts();
		h.hotkeys.registerAutoTypingHotkeys();
		const before = h.held().sort();
		await h.handler.typeCharWithHotkeyManagement("💾");
		assert.deepEqual(h.calls[0].held.sort(), before);
	});

	const h = build();
	h.hotkeys.registerSystemShortcuts();
	const before = h.held().sort();
	await h.handler.typeCharWithHotkeyManagement("💾");
	assert.deepEqual(
		h.calls[0].held.sort(),
		before,
		"auto-typing is off: nothing of the teacher's is taken",
	);
});

test("stopping auto-typing takes the guards down with the letters", () =>
	whileActive(async () => {
		const h = build();
		h.hotkeys.registerSystemShortcuts();
		const system = h.held().sort();
		h.hotkeys.registerAutoTypingHotkeys();

		await h.handler.typeCharWithHotkeyManagement("💾");
		h.handler.typeCharWithHotkeyManagement("B");
		assert.ok(h.held().includes("Control+a") && h.held().includes("Shift+a"));

		h.hotkeys.unregisterAutoTypingHotkeys();
		assert.deepEqual(
			h.held().sort(),
			system,
			"a guard left behind would keep Ctrl+A or Shift+A from the teacher for good",
		);
		await guardsGone();
		assert.deepEqual(
			h.held().sort(),
			system,
			"and its timer finds nothing to do",
		);
	}));

test("a guard is not taken down by a timer that fired late", () =>
	whileActive(async () => {
		const h = build();
		h.hotkeys.registerAutoTypingHotkeys();
		const realNow = Date.now;

		await h.handler.typeCharWithHotkeyManagement("💾");
		Date.now = () => realNow() + 1000;
		try {
			await pause(GUARD_LINGER_MS + 60);
			assert.ok(
				h.held().includes("Control+a"),
				"a late timer means the main process was stuck, and a key the guard " +
					"caught may not have been handed over yet",
			);
			await pause(GUARD_LINGER_MS + 80);
			assert.deepEqual(
				h.held().sort(),
				["a", "b", "s"],
				"it goes one quiet period later",
			);
		} finally {
			Date.now = realNow;
		}
	}));

test("the Space bar can be an auto-typing key, and LEO's own space gets through on its key-down", () =>
	whileActive((sent) => {
		const h = build({ typing: ["a", " "] });
		h.hotkeys.registerAutoTypingHotkeys();
		assert.deepEqual(
			h.held(),
			["a", "Space"],
			"Electron throws on a bare space as a shortcut: its name is Space",
		);

		h.fire("Space");
		assert.deepEqual(sent, ["advance-cursor"]);

		h.ops.length = 0;
		h.handler.typeCharWithHotkeyManagement(" ");
		assert.deepEqual(
			h.calls.map((c) => [c.via, c.key, c.direction, c.modifiers]),
			[
				["keyToggle", "space", "down", []],
				["keyToggle", "space", "up", []],
			],
			"a plan is one space in six characters: released for a whole " +
				"keystroke each time, the bar would leak most of all",
		);
		assert.deepEqual(h.calls[0].held, ["a"]);
		assert.ok(h.calls[1].held.includes("Space"));
		assert.deepEqual(h.ops, ["-Space", "+Space"]);

		h.hotkeys.unregisterAutoTypingHotkeys();
		assert.deepEqual(h.held(), []);
	}));

test("a space is typed whole while Space is not a hotkey", () =>
	whileActive(() => {
		const h = build();
		h.hotkeys.registerAutoTypingHotkeys();
		const before = h.held().sort();

		h.handler.typeCharWithHotkeyManagement(" ");

		assert.deepEqual(
			h.calls.map((c) => [c.via, c.text]),
			[["typeString", " "]],
		);
		assert.deepEqual(h.calls[0].held.sort(), before);
	}));

test("Space is caught inside LEO's own modifiers like a letter", () =>
	whileActive(async () => {
		const h = build({ typing: ["a", " "] });
		const toggled = [];
		state.mainWindow = {
			isDestroyed: () => false,
			isAlwaysOnTop: () => false,
			setAlwaysOnTop: (on) => toggled.push(on),
		};
		try {
			h.hotkeys.registerSystemShortcuts();
			h.hotkeys.registerAutoTypingHotkeys();

			h.handler.typeCharWithHotkeyManagement("B");
			await h.handler.typeCharWithHotkeyManagement("💾");
			await h.handler.typeCharWithHotkeyManagement("🔁");
			await h.handler.typeCharWithHotkeyManagement("⛔");

			const [capital, , save, , switchWindow, deleteLine] = h.calls;
			assert.ok(
				capital.held.includes("Shift+Space"),
				"LEO never presses Shift+Space itself, so holding it swallows nothing of LEO's",
			);
			assert.ok(
				save.held.includes("Control+Space"),
				"Ctrl+Space opens the editor's suggestions",
			);
			assert.ok(
				switchWindow.held.includes("Alt+Space"),
				"Alt+Space opens the window menu, where the next letter can close the window",
			);
			assert.equal(
				deleteLine.held.filter(
					(a) => sameShortcut(a) === "control+shift+space",
				).length,
				1,
				"Ctrl+Shift+Space is already LEO's own always-on-top key",
			);

			h.fire(SYSTEM.alwaysOnTop);
			assert.deepEqual(
				toggled,
				[],
				"so a real Space inside LEO's Ctrl+Shift+K is ignored, not acted on",
			);

			await guardsGone();
			h.fire(SYSTEM.alwaysOnTop);
			assert.deepEqual(toggled, [true], "and later the key is itself again");
		} finally {
			state.mainWindow = null;
		}
	}));

test("after an Enter LEO waits before the next key, and a press in between waits its turn", () =>
	whileActive(async () => {
		const h = build();
		h.hotkeys.registerAutoTypingHotkeys();

		for (const enter of ["↩", "\n"]) {
			h.calls.length = 0;
			h.handler.typeCharacter(enter);
			h.handler.typeCharacter("a");
			await pause(80);

			const [pressed, down] = h.calls;
			assert.deepEqual(pressed.keys, [Key.Enter]);
			assert.deepEqual(
				[down.key, down.direction],
				["a", "down"],
				"the press that arrived during the wait is queued, not dropped or reordered",
			);
			assert.ok(
				down.at - pressed.at >= 28,
				`waited ${Math.round(down.at - pressed.at)} ms: an editor that runs ` +
					"Enter through an extension (Python Indent in VS Code) dropped the " +
					"newline when the next characters overtook it",
			);
		}
	}));

test("only Enter waits", () =>
	whileActive(async () => {
		const h = build();
		h.hotkeys.registerAutoTypingHotkeys();
		const started = performance.now();
		for (const ch of ["a", "B", "{", " ", "⌫", "\t", "💾"]) {
			await h.handler.typeCharWithHotkeyManagement(ch);
		}
		assert.ok(
			performance.now() - started < 25,
			"a wait after every key would slow every lesson down",
		);
		await guardsGone();
	}));

test("one step is Windows only, and never while the platform is set to macOS", () => {
	assert.equal(
		platform.typesInOneStep({ get: () => "windows" }),
		process.platform === "win32",
	);
	assert.equal(platform.typesInOneStep({ get: () => "macos" }), false);
});
