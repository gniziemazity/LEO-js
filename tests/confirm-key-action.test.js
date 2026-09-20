"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadModule } = require("./helpers/load-module");

const MAIN = path.resolve(__dirname, "..", "src/main");

function harness() {
	const events = [];
	let clip = "";
	let confirmKey = null;
	const popups = loadModule("src/main/popups.js", {
		electron: {
			clipboard: {
				readText: () => clip,
				writeText: (t) => (clip = t),
			},
		},
		"@computer-use/nut-js": {
			keyboard: {
				type: async (...keys) => events.push(["keys", keys, clip]),
			},
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
			pause() {},
			unpause() {},
			send: (ch) => events.push(["send", ch]),
		},
		"./remote-input": { warnRemoteInput() {} },
	});
	return {
		popups,
		events,
		press: () => confirmKey(),
		sends: () => events.filter((e) => e[0] === "send").map((e) => e[1]),
		keys: () => events.filter((e) => e[0] === "keys"),
	};
}

test("Ctrl+Enter on a snippet with Paste pastes it, then carries on", async () => {
	const h = harness();
	h.popups.enterPopup("code-insert", { text: "let a;", paste: true });
	await h.press();

	assert.deepEqual(
		h.keys(),
		[["keys", ["Ctrl", "V"], "let a;"]],
		"the snippet, not what was copied before, is on the clipboard at the press",
	);
	assert.deepEqual(h.sends(), ["code-insert-confirmed"]);
	assert.equal(h.popups.openPopupKind(), null);
});

test("the paste settles before the clipboard is handed back", async () => {
	const h = harness();
	h.popups.enterPopup("code-insert", { text: "let a;", paste: true });
	const started = Date.now();
	await h.press();
	assert.ok(
		Date.now() - started >= 250,
		"restoring the old clipboard straight after Ctrl+V lets the editor " +
			"read the old text instead of the snippet",
	);
});

test("Ctrl+Enter on a log-only snippet just confirms it", () => {
	const h = harness();
	h.popups.enterPopup("code-insert", { text: "let a;", paste: false });
	h.press();
	assert.deepEqual(h.keys(), [], "nothing was held, so nothing is pasted");
	assert.deepEqual(h.sends(), ["code-insert-confirmed"]);
});

test("the phone's Paste closes the popup the same way", async () => {
	const h = harness();
	h.popups.enterPopup("code-insert", { text: "x", paste: true });
	await h.popups.pasteAndConfirm();
	assert.equal(h.keys().length, 1);
	assert.deepEqual(h.sends(), ["code-insert-confirmed"]);

	await h.popups.pasteAndConfirm();
	assert.equal(h.keys().length, 1, "no popup, no paste");
});

test("a popup that changed while the paste settled is left alone", async () => {
	const h = harness();
	h.popups.enterPopup("code-insert", { text: "x", paste: true });
	const pending = h.popups.pasteAndConfirm();
	h.popups.endPopup("code-insert");
	h.popups.enterPopup("code-insert", { text: "y", paste: true });
	await pending;
	assert.deepEqual(h.sends(), [], "the next snippet is not confirmed unseen");
	assert.equal(h.popups.openPopupKind(), "code-insert");
});

test("Ctrl+Enter on a move-to that creates a file starts typing its name", async () => {
	const h = harness();
	const progress = [];
	h.popups.setNameProgressHandler((p) => progress.push(p));
	h.popups.enterPopup("move-to", {
		mode: "file",
		target: "app.js",
		typeName: true,
	});
	h.press();
	assert.equal(h.popups.hasPendingName(), true, "same as pressing Auto-type");
	assert.deepEqual(h.sends(), [], "and it does not skip the name");
	assert.deepEqual(
		h.keys(),
		[],
		"nothing is typed while Ctrl is still held down",
	);
	assert.deepEqual(
		progress,
		[{ target: "app.js", typed: 0 }],
		"both surfaces start showing the name's progress",
	);

	await h.popups.typeNextNameChar();
	h.press();
	assert.equal(h.popups.hasPendingName(), true);
	assert.deepEqual(h.sends(), [], "a second press neither restarts nor skips");

	for (let i = 1; i < "app.js".length; i++) await h.popups.typeNextNameChar();
	assert.deepEqual(
		h.sends(),
		["move-to-confirmed"],
		"the typing keys finish the name, and the last one confirms",
	);
});

test("Ctrl+Enter on any other move-to is OK", () => {
	for (const payload of [
		{ mode: "file", target: "app.js", typeName: false },
		{ mode: "anchor", target: "⚓3⚓", typeName: true },
		{ mode: "main", target: "MAIN" },
	]) {
		const h = harness();
		h.popups.enterPopup("move-to", payload);
		h.press();
		assert.deepEqual(
			h.sends(),
			["move-to-confirmed"],
			JSON.stringify(payload),
		);
	}
});

test("Ctrl+Enter on a note, image or web page is OK", () => {
	for (const kind of ["note", "image", "web"]) {
		const h = harness();
		h.popups.enterPopup(kind, {});
		h.press();
		assert.deepEqual(h.sends(), [`${kind}-confirmed`]);
	}
});

test("the phone's Paste and a settings save both use the same key action", () => {
	const main = fs.readFileSync(path.join(MAIN, "main.js"), "utf-8");
	assert.match(
		main,
		/"client-code-insert-paste", \(\) => pasteAndConfirm\(\)/,
		"Paste closes the popup, however it was pressed",
	);
	const reapply = /function reapplySettings\(\)[\s\S]*?\n\}/.exec(main)[0];
	assert.match(
		reapply,
		/registerConfirmPopup\(confirmKeyFor\(kind\)\)/,
		"re-arming with a bare confirm would lose Paste and Auto-type after a save",
	);
	const popups = fs.readFileSync(path.join(MAIN, "popups.js"), "utf-8");
	const enter = /function enterPopup\(kind, payload\)[\s\S]*?\n\}/.exec(
		popups,
	)[0];
	assert.match(enter, /registerConfirmPopup\(confirmKeyFor\(kind\)\)/);
});
