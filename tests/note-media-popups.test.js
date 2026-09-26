"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadModule, fakeIpcRenderer } = require("./helpers/load-module");
const { buildRemote } = require("./helpers/remote-dom");
const FloatingWindow = require("../src/main/floating-window");
const LEOBroadcastServer = require("../src/main/websocket-server");

const SRC = path.resolve(__dirname, "..", "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf-8");

function makeCursorManager(steps) {
	const ipc = fakeIpcRenderer({
		invoke: async () => ({ autoTypingSpeed: 10 }),
	});
	const CursorManager = loadModule("src/renderer/cursor-manager.js", {
		electron: ipc.stub,
	});
	const cm = new CursorManager(
		{ updateProgressBar() {}, removeCursorClasses() {} },
		{ addEntry() {} },
	);
	cm.setExecutionSteps(steps);
	return { cm, channels: ipc.channels };
}

function element() {
	return {
		classList: { add() {}, remove() {} },
		scrollIntoView() {},
		dataset: {},
	};
}

function blockStep(text, extra) {
	return {
		type: "block",
		text,
		element: element(),
		globalIndex: 0,
		...extra,
	};
}

const charStep = () => ({ type: "char", char: "a", element: element() });

test("a note opens a popup with its own text", () => {
	const { cm } = makeCursorManager([blockStep("Explain the loop\nslowly")]);
	const seen = [];
	cm.onEnterNoteBlock = (p) => seen.push(p);
	cm.updateCursor();
	assert.deepEqual(seen, [{ text: "Explain the loop\nslowly" }]);
});

test("a blank note, or the end of a code block, opens nothing", () => {
	const { cm } = makeCursorManager([
		blockStep("   "),
		{ type: "block", kind: "code", element: element(), globalIndex: 1 },
	]);
	cm.onEnterNoteBlock = () => assert.fail("no popup for an empty note");
	cm.updateCursor();
	cm.currentStepIndex = 1;
	cm.updateCursor();
});

test("the step at the end of a code block says it is code", () => {
	const src = read("renderer/lesson-renderer.js");
	const code = /renderCodeBlock\(ctx\) \{[\s\S]*?\n\t\}/.exec(src)[0];
	assert.match(
		code,
		/type: "block",\s*kind: "code",/,
		"without it the empty step reads as a note and every code block " +
			"would end in an empty popup",
	);
});

for (const [kind, text] of [
	["note", "Remember this"],
	["image", "🖼️ pic.png"],
	["web", "🌐 http://example.com"],
]) {
	test(`a ${kind} holds auto-typing until it is confirmed`, async () => {
		const { cm, channels } = makeCursorManager([blockStep(text), charStep()]);
		cm.updateCursor();
		await cm.startAutoTyping();
		assert.equal(
			channels().includes("start-auto-type-block"),
			false,
			`typing must not run past a ${kind} that is still open`,
		);
		cm.confirmSpecial(kind);
		await cm.startAutoTyping();
		assert.ok(channels().includes("start-auto-type-block"));
	});

	test(`auto-typing resumes after a ${kind} only if it was running`, () => {
		const { cm } = makeCursorManager([]);
		cm.autoTypingActive = true;
		cm.suspendAutoTypingFor(kind);
		assert.equal(cm.autoTypingActive, false);
		assert.equal(cm.confirmSpecial(kind), true);
		cm.suspendAutoTypingFor(kind);
		assert.equal(cm.confirmSpecial(kind), false);
	});
}

for (const [kind, text] of [
	["image", "🖼️ pic.png"],
	["web", "🌐 http://example.com"],
]) {
	test(`confirming a ${kind} passes the block and closes its window, pin-aware`, () => {
		const { cm, channels } = makeCursorManager([
			blockStep(text),
			charStep(),
			charStep(),
		]);
		cm.updateCursor();
		cm.confirmSpecial(kind);
		assert.equal(cm.currentStepIndex, 1, "OK passes the block");
		assert.deepEqual(
			channels().filter((c) => c === `close-${kind}-window`),
			[`close-${kind}-window`],
			"the soft close, which a pinned window ignores",
		);
		cm.currentStepIndex = 2;
		cm.updateCursor();
		assert.equal(
			channels().filter((c) => c === `close-${kind}-window`).length,
			1,
			"typing on does not close it a second time",
		);
	});
}

test("confirming a note forgets it, like the other transient popups", () => {
	const { cm, channels } = makeCursorManager([
		blockStep("Remember this"),
		charStep(),
	]);
	cm.updateCursor();
	cm.confirmSpecial("note");
	cm.currentStepIndex = 1;
	cm.updateCursor();
	assert.equal(
		channels().includes("close-note-window"),
		false,
		"a confirmed note has nothing left to close",
	);
});

test("stepping past an unconfirmed note closes it and frees typing", async () => {
	const { cm, channels } = makeCursorManager([
		blockStep("Remember this"),
		charStep(),
	]);
	cm.updateCursor();
	cm.currentStepIndex = 1;
	cm.updateCursor();
	assert.ok(channels().includes("close-note-window"));
	await cm.startAutoTyping();
	assert.ok(
		channels().includes("start-auto-type-block"),
		"a popup the teacher stepped past must not keep holding the keys",
	);
});

function popupsHarness() {
	const calls = [];
	const popups = loadModule("src/main/popups.js", {
		electron: { clipboard: { readText: () => "", writeText() {} } },
		"@computer-use/nut-js": { keyboard: {}, Key: {} },
		"./context": {
			settingsManager: { get: () => undefined },
			broadcastServer: new Proxy(
				{},
				{
					get:
						(_, name) =>
						(...args) =>
							calls.push([name, ...args]),
				},
			),
			hotkeyManager: {
				registerConfirmPopup() {},
				unregisterConfirmPopup() {},
			},
		},
		"./state": {
			pause() {},
			unpause() {},
			send: (ch) => calls.push(["send", ch]),
		},
		"./remote-input": { warnRemoteInput() {} },
	});
	return { popups, calls };
}

test("image and web popups tell the phone which one they are", () => {
	const { popups, calls } = popupsHarness();
	popups.enterPopup("web", { name: "http://x" });
	assert.deepEqual(calls[0], [
		"broadcastMediaStarted",
		{ name: "http://x", kind: "web" },
	]);
});

test("the phone's OK confirms whichever media popup the host has open", () => {
	const { popups, calls } = popupsHarness();
	popups.confirmMedia();
	assert.deepEqual(calls, [], "nothing open, nothing confirmed");

	popups.enterPopup("note", { text: "x" });
	popups.confirmMedia();
	assert.equal(
		calls.some((c) => c[0] === "send"),
		false,
		"a media OK must not confirm a note",
	);
	popups.confirmPopup("note");

	calls.length = 0;
	popups.enterPopup("image", { name: "a.png" });
	popups.confirmMedia();
	assert.deepEqual(
		calls.filter((c) => c[0] === "send"),
		[["send", "image-confirmed"]],
	);
});

test("closing a window ends its popup only if that popup is the open one", () => {
	const { popups, calls } = popupsHarness();
	popups.endPopupIfOpen("image");
	assert.deepEqual(calls, [], "a pinned image closed later ends nothing");

	popups.enterPopup("image", { name: "a.png" });
	popups.endPopupIfOpen("image");
	assert.deepEqual(calls.at(-1), ["broadcastMediaEnded"]);
	assert.equal(popups.openPopupKind(), null);
});

test("the close channel of a presented window also ends its popup", () => {
	const main = read("main/main.js");
	const loop = /for \(const w of FLOAT_WINDOWS\) \{[\s\S]*?\n\}/.exec(main)[0];
	assert.match(
		loop,
		/ipcMain\.on\(`close-\$\{w\.name\}-window`, \(\) => \{\s*w\.float\.close\([^;]*\);\s*if \(w\.popup\) endPopupIfOpen\(w\.name\);/,
		"one handler per channel: a second ipcMain.on would be easy to miss",
	);
	for (const name of ["image", "web"]) {
		const entry = new RegExp(`name: "${name}",[\\s\\S]*?\\}`).exec(main)[0];
		assert.match(entry, /popup: true/);
	}
});

test("the image popup is announced after the window, so the pin is known", () => {
	const app = read("renderer/app.js");
	const image = /cursorManager\.onImageBlock = [\s\S]*?\n\};/.exec(app)[0];
	assert.ok(
		image.indexOf('"open-image-window"') <
			image.indexOf('enterMediaBlock("image"'),
	);
	const web = /cursorManager\.onWebBlock = [\s\S]*?\n\};/.exec(app)[0];
	assert.ok(
		web.indexOf('"open-web-window"') < web.indexOf('enterMediaBlock("web"'),
	);
});

test("the pin, the close and the confirms are messages the server accepts", () => {
	const { CLIENT_MESSAGE_TYPES } = LEOBroadcastServer;
	for (const type of [
		"note-confirmed",
		"media-confirmed",
		"pin-window",
		"media-dismissed",
		"unpin-windows",
	]) {
		assert.ok(CLIENT_MESSAGE_TYPES.has(type), type);
	}
	const emitted = [];
	const fake = { emit: (...a) => emitted.push(a) };
	const handle = (message) =>
		LEOBroadcastServer.prototype.handleClientMessage.call(fake, message);
	handle({ type: "pin-window", data: { pinned: true } });
	handle({ type: "pin-window", data: { pinned: "yes" } });
	handle({ type: "pin-window" });
	assert.deepEqual(emitted, [
		["client-pin-window", true],
		["client-pin-window", false],
		["client-pin-window", false],
	]);
});

test("a phone that reconnects finds the open popup and the pin", () => {
	const sent = [];
	const fake = {
		currentState: {},
		broadcast: (m) => sent.push(m),
	};
	const call = (name, ...args) =>
		LEOBroadcastServer.prototype[name].call(fake, ...args);

	call("broadcastNoteStarted", { text: "x" });
	call("broadcastMediaStarted", { kind: "image", name: "a.png" });
	call("updatePinnedWindows", { image: 1 });
	assert.deepEqual(fake.currentState, {
		activeNote: { text: "x" },
		activeMedia: { kind: "image", name: "a.png" },
		pinnedWindows: { image: true, web: false },
	});
	call("broadcastNoteEnded");
	call("broadcastMediaEnded");
	assert.equal(fake.currentState.activeNote, null);
	assert.equal(fake.currentState.activeMedia, null);
	assert.deepEqual(
		sent.map((m) => m.type),
		[
			"note-started",
			"media-started",
			"pinned-windows",
			"note-ended",
			"media-ended",
		],
	);
});

function fakeWin() {
	const listeners = {};
	const win = {
		destroyed: false,
		sent: [],
		on: (ev, fn) => (listeners[ev] = fn),
		isDestroyed: () => win.destroyed,
		show() {},
		focus() {},
		webContents: { on() {}, send: (...a) => win.sent.push(a) },
		close() {
			win.destroyed = true;
			listeners.closed();
		},
	};
	return win;
}

function pinHarness() {
	const changes = [];
	const float = new FloatingWindow({
		make: fakeWin,
		channel: "set-image",
		onPinChange: (f) => changes.push(f.pinned),
		broadcastServer: {
			broadcastFloatingWindowReshown() {},
			broadcastFloatingWindowClosed() {},
		},
		floatRect: () => ({ x: 0, y: 0, w: 1, h: 1 }),
		trackWindowRect() {},
	});
	return { float, changes };
}

test("every pin change is reported once, and the window's button follows", () => {
	const { float, changes } = pinHarness();
	float.showOrReuse({}, { gatePin: true, shouldPin: false });
	assert.deepEqual(changes, [], "opening unpinned is not a change");

	float.setPinned(true);
	float.setPinned(true);
	assert.deepEqual(changes, [true]);
	assert.deepEqual(
		float.win.sent.filter((m) => m[0] === "pin-state"),
		[["pin-state", true]],
		"a pin from the phone must light the desk window's 📌 too",
	);

	float.close();
	assert.equal(float.isAlive(), true, "pinned: the soft close waits");
	float.close({ force: true });
	assert.deepEqual(changes, [true, false], "closing clears the pin");
});

test("a window opened pinned reports it", () => {
	const { float, changes } = pinHarness();
	float.showOrReuse({}, { gatePin: true, shouldPin: true });
	assert.deepEqual(changes, [true]);
});

test("the 📌 on the phone unpins the pinned windows and closes nothing itself", () => {
	const src = read("main/float-windows.js");
	const fn = /function unpinWindows\(\) \{[\s\S]*?\n\}/.exec(src)[0];
	assert.match(fn, /if \(f\.pinned\) f\.setPinned\(false\)/);
	assert.equal(/close\(/.test(fn), false, "a window still on its block stays");
	assert.equal(/closePinnedWindows/.test(src), false);
	for (const name of ["_imageFloat", "_webFloat"]) {
		const made = new RegExp(
			`const ${name} = makeFloat\\(\\{[\\s\\S]*?\\n\\}\\);`,
		).exec(src)[0];
		assert.match(made, /onPinChange: _broadcastPinned/);
	}
	const main = read("main/main.js");
	assert.match(main, /"client-unpin-windows", \(\) => unpinWindows\(\)/);
	assert.match(
		main,
		/"client-media-dismissed", \(\) => dismissMedia\(MEDIA_FLOATS\)/,
	);
	assert.match(
		main,
		/"client-pin-window", \(pinned\) => \{\s*const float = MEDIA_FLOATS\[openPopupKind\(\)\];/,
		"the phone pins the window its popup is about, never a name it sends",
	);
});

test("unpinning while the block is still current keeps the window, and the pin can come back", () => {
	const { float, changes } = pinHarness();
	float.showOrReuse({}, { gatePin: true, shouldPin: false });
	float.setPinned(true);

	float.setPinned(false);
	assert.equal(
		float.isAlive(),
		true,
		"the plan has not moved on: nothing to close",
	);
	assert.deepEqual(
		changes,
		[true, false],
		"the phone hears it and shows its pin again",
	);

	float.setPinned(true);
	assert.deepEqual(
		changes,
		[true, false, true],
		"and the pin can be pressed again",
	);
});

test("unpinning after the plan has moved on closes the window that was only being kept", () => {
	const { float, changes } = pinHarness();
	float.showOrReuse({}, { gatePin: true, shouldPin: false });
	float.setPinned(true);

	float.close();
	assert.equal(float.isAlive(), true, "pinned, so the block leaving waits");

	float.setPinned(false);
	assert.equal(float.isAlive(), false, "nothing owns it any more");
	assert.deepEqual(changes, [true, false]);
});

test("the phone's ✕ on an image or web popup closes an unpinned window, and leaves a pinned one", () => {
	const { popups, calls } = popupsHarness();
	const closed = [];
	const floats = {
		image: { pinned: false, close: () => closed.push("image") },
		web: { pinned: true, close: () => closed.push("web") },
	};

	popups.enterPopup("image", { name: "a.png" });
	calls.length = 0;
	popups.dismissMedia(floats);
	assert.deepEqual(
		closed,
		["image"],
		"unpinned: the window goes with the popup",
	);
	assert.deepEqual(
		calls.filter((c) => c[0] === "send"),
		[["send", "image-confirmed"]],
		"and the lesson carries on exactly as it does for OK",
	);
	assert.equal(popups.openPopupKind(), null);

	closed.length = 0;
	popups.enterPopup("web", { name: "http://x" });
	popups.dismissMedia(floats);
	assert.deepEqual(
		closed,
		[],
		"pinned: only the popup goes, the window stays",
	);
	assert.equal(popups.openPopupKind(), null);
});

test("✕ decides from the host's own pin, and only for a media popup", () => {
	const { popups, calls } = popupsHarness();
	const closed = [];
	const floats = {
		image: { pinned: false, close: () => closed.push("image") },
	};

	popups.dismissMedia(floats);
	assert.deepEqual(calls, [], "nothing open, nothing to dismiss");

	popups.enterPopup("note", { text: "x" });
	calls.length = 0;
	popups.dismissMedia(floats);
	assert.deepEqual(closed, []);
	assert.equal(
		calls.some((c) => c[0] === "send"),
		false,
		"a media ✕ must not confirm a note",
	);
});

test("OK never closes the window: it only carries on", () => {
	const { popups } = popupsHarness();
	popups.enterPopup("image", { name: "a.png" });
	assert.equal(/close/.test(popups.confirmMedia.toString()), false);
});

test("the phone's note popup shows the text, and OK confirms it", () => {
	const ctx = buildRemote();
	ctx.api.showNoteOverlay({ text: "Slow down here" });
	assert.equal(ctx.nodes.noteOverlay.classList.contains("active"), true);
	assert.equal(ctx.nodes.ntTitle.textContent, "Note:");
	assert.equal(ctx.nodes.ntText.textContent, "Slow down here");

	ctx.api.closeNoteOverlay();
	assert.deepEqual(ctx.sent, [{ type: "note-confirmed", data: {} }]);
	assert.equal(ctx.nodes.noteOverlay.classList.contains("active"), false);
});

test("the host ending a note closes it without echoing a confirm", () => {
	const ctx = buildRemote();
	ctx.api.showNoteOverlay({ text: "x" });
	ctx.api.closeNoteOverlayUI();
	assert.equal(ctx.nodes.noteOverlay.classList.contains("active"), false);
	assert.deepEqual(ctx.sent, []);
});

test("the media popup names what is shown and offers a bare 📌 in the OK's colour", () => {
	const ctx = buildRemote();
	ctx.api.showMediaOverlay({ kind: "web", name: "https://example.com" });
	assert.equal(ctx.nodes.mediaOverlay.classList.contains("active"), true);
	assert.equal(ctx.nodes.mdTitle.textContent, "Web page:");
	assert.equal(ctx.nodes.mdName.textContent, "https://example.com");
	assert.notEqual(
		ctx.nodes.mdPin.style.visibility,
		"hidden",
		"unpinned: the pin is offered",
	);

	const html = read("remote.html");
	const pin = /<button[^>]*id="mdPin"[\s\S]*?<\/button>/.exec(html)[0];
	assert.match(
		pin,
		/class="mt-modal-confirm"/,
		"the same blue as OK, no colour of its own",
	);
	const label = pin
		.replace(/^<button[^>]*>/, "")
		.replace(/<\/button>$/, "")
		.trim();
	assert.equal(label, "📌", "the emoji is enough: no word beside it");
	assert.equal(/md-pin-btn/.test(read("shared/styles.css")), false);

	ctx.api.pinMediaWindow();
	assert.deepEqual(ctx.sent, [{ type: "pin-window", data: { pinned: true } }]);
	assert.notEqual(
		ctx.nodes.mdPin.style.visibility,
		"hidden",
		"it waits for the host: a window that failed to open stays unpinned",
	);

	ctx.api.setPinnedWindows({ image: false, web: true });
	assert.equal(
		ctx.nodes.mdPin.style.visibility,
		"hidden",
		"pinned: the button disappears",
	);
	assert.equal(
		ctx.nodes.modeBtnPin.classList.contains("pin-visible"),
		true,
		"and the one at the top is how it comes off",
	);

	ctx.api.closeMediaOverlay();
	assert.deepEqual(ctx.sent.at(-1), { type: "media-confirmed", data: {} });
	assert.equal(ctx.nodes.mediaOverlay.classList.contains("active"), false);
});

test("unpinning from the top while the popup is still up brings the pin back", () => {
	const ctx = buildRemote();
	ctx.api.showMediaOverlay({ kind: "image", name: "a.png" });
	ctx.api.setPinnedWindows({ image: true, web: false });
	assert.equal(ctx.nodes.mdPin.style.visibility, "hidden");

	ctx.api.setPinnedWindows({ image: false, web: false });
	assert.equal(
		ctx.nodes.mdPin.style.visibility,
		"",
		"the same screen offers the pin again",
	);
	assert.equal(
		ctx.nodes.mediaOverlay.classList.contains("active"),
		true,
		"and the popup stays",
	);
});

test("the phone's ✕ on a media popup dismisses it; OK still only confirms", () => {
	const ctx = buildRemote();
	ctx.api.showMediaOverlay({ kind: "image", name: "a.png" });
	ctx.api.closeActiveOverlay();
	assert.deepEqual(ctx.sent, [{ type: "media-dismissed", data: {} }]);
	assert.equal(ctx.nodes.mediaOverlay.classList.contains("active"), false);

	ctx.sent.length = 0;
	ctx.api.showMediaOverlay({ kind: "image", name: "a.png" });
	ctx.api.closeMediaOverlay();
	assert.deepEqual(ctx.sent, [{ type: "media-confirmed", data: {} }]);
});

test("the pin button reads the window its popup is about", () => {
	const ctx = buildRemote();
	ctx.api.setPinnedWindows({ image: false, web: true });
	ctx.api.showMediaOverlay({ kind: "image", name: "a.png" });
	assert.equal(ctx.nodes.mdTitle.textContent, "Image:");
	assert.equal(
		ctx.nodes.mdPin.style.visibility,
		"",
		"the pinned one is the web page, not this",
	);
	ctx.api.closeMediaOverlayUI();

	ctx.api.showMediaOverlay({ kind: "web", name: "http://x" });
	assert.equal(ctx.nodes.mdPin.style.visibility, "hidden");
});

test("the 📌 beside the pads shows only while something is pinned, and unpins", () => {
	const ctx = buildRemote();
	const shown = () => ctx.nodes.modeBtnPin.classList.contains("pin-visible");
	ctx.api.setPinnedWindows(undefined);
	assert.equal(shown(), false);
	ctx.api.setPinnedWindows({ image: true, web: false });
	assert.equal(shown(), true);
	ctx.api.unpinWindows();
	assert.deepEqual(ctx.sent, [{ type: "unpin-windows", data: {} }]);
	assert.equal(shown(), true, "it goes when the host says the pin is gone");
	ctx.api.setPinnedWindows({ image: false, web: false });
	assert.equal(shown(), false);
	assert.match(
		read("remote.html"),
		/id="modeBtnPin"[\s\S]*?onclick="unpinWindows\(\)"[\s\S]*?title="Unpin the pinned window"/,
	);
});

test("both popups leave the pad usable and lift above it", async () => {
	const ctx = buildRemote();
	ctx.api.setSessionActive(true);
	await ctx.api.setTouchpadMode("keyboard");
	ctx.api.showMediaOverlay({ kind: "image", name: "a.png" });
	assert.equal(ctx.api.padMode(), "keyboard");
	assert.equal(ctx.nodes.mediaOverlay.classList.contains("pad-lifted"), true);
	ctx.api.closeMediaOverlayUI();
	ctx.api.showNoteOverlay({ text: "x" });
	assert.equal(ctx.nodes.noteOverlay.classList.contains("pad-lifted"), true);
});

test("the markup wires both overlays, the pin button and a reconnect", () => {
	const html = read("remote.html");
	for (const id of ["noteOverlay", "mediaOverlay"]) {
		assert.match(
			html,
			new RegExp(`id="${id}" class="overlay overlay-pad-ok"`),
		);
	}
	const order = [
		"remote/remote-overlay.js",
		"remote/note-overlay.js",
		"remote/media-overlay.js",
		"remote/overlays.js",
	].map((s) => html.indexOf(`<script src="${s}">`));
	assert.ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])));
	assert.ok(
		html.indexOf('id="modeBtnKeyboard"') < html.indexOf('id="modeBtnPin"') &&
			html.indexOf('id="modeBtnPin"') <
				html.indexOf("</div>", html.indexOf('id="modeBtnKeyboard"')),
		"the pin sits in the pad column, after the keyboard",
	);
	for (const type of [
		"note-started",
		"note-ended",
		"media-started",
		"media-ended",
		"pinned-windows",
	]) {
		assert.match(html, new RegExp(`case "${type}":`));
	}
	const all = /function updateAllState\(state\) \{[\s\S]*?\n\t\t\t\}/.exec(
		html,
	)[0];
	assert.match(all, /setPinnedWindows\(state\.pinnedWindows\)/);
	assert.match(all, /showNoteOverlay\(state\.activeNote\)/);
	assert.match(all, /showMediaOverlay\(state\.activeMedia\)/);
	assert.ok(
		all.indexOf("setPinnedWindows") < all.indexOf("showMediaOverlay"),
		"the pin is known before the popup reads it",
	);
});

test("the pin button has its own rule, outside the pad carve-out", () => {
	const css = read("shared/styles.css");
	assert.match(
		css,
		/#modeSideBtns\.has-pad #modeBtnMouse,\n#modeSideBtns\.has-pad #modeBtnKeyboard \{\n\tdisplay: flex;\n\}/,
		"the pad rule stays exactly as other builds match it",
	);
	assert.match(
		css,
		/#modeSideBtns #modeBtnPin:not\(\.pin-visible\) \{\n\tdisplay: none;\n\}/,
	);
	assert.match(
		css,
		/#modeSideBtns #modeBtnPin\.pin-visible \{\n\tdisplay: flex;\n\}/,
		"two ids outrank has-active's one, so a pad mode cannot hide it",
	);
});
