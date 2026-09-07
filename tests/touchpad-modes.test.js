"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const BASE = path.resolve(__dirname, "..", "src");
const SRC = fs.readFileSync(
	path.join(BASE, "shared/remote/touchpad.js"),
	"utf-8",
);
const CSS = fs.readFileSync(path.join(BASE, "shared/styles.css"), "utf-8");

function makeClassList() {
	const set = new Set();
	return {
		add: (c) => set.add(c),
		remove: (c) => c.split(" ").forEach((n) => set.delete(n)),
		toggle: (c, on) => (on ? set.add(c) : set.delete(c)),
		contains: (c) => set.has(c),
	};
}

function makeNode() {
	const node = {
		className: "",
		dataset: {},
		textContent: "",
		onclick: null,
		children: [],
		classList: makeClassList(),
		appendChild(child) {
			node.children.push(child);
			return child;
		},
	};
	Object.defineProperty(node, "innerHTML", {
		get: () => "",
		set: () => {
			node.children.length = 0;
		},
	});
	return node;
}

function loadPad(opts) {
	const o = opts || {};
	const sent = [];
	const listeners = {};
	const clock = { t: 10000 };

	const docBody = makeNode();

	const els = {
		touchpadOverlay: Object.assign(makeNode(), {
			addEventListener: (type, fn) => (listeners[type] = fn),
		}),
		"mobile-header": makeNode(),
		modeBtnKeyboard: makeNode(),
		modeBtnMouse: makeNode(),
		modeSideBtns: makeNode(),
		touchpadActionBar: makeNode(),
		touchpadSideBar: makeNode(),
		touchpadEditKeys: makeNode(),
		touchpadConfirmBar: makeNode(),
	};

	const sandbox = {
		module: { exports: {} },
		document: {
			body: docBody,
			getElementById: (id) => els[id] || null,
			querySelector: () => null,
			querySelectorAll: () => [],
			createElement: makeNode,
			addEventListener() {},
		},
		window: { addEventListener() {}, innerWidth: 400, innerHeight: 800 },
		Date: { now: () => clock.t },
		sendMessage: (type, data) => sent.push({ type, data }),
		setInteractionBtnsVisible() {},
		activePadOverlay: () => o.padOverlay || null,
		navigator: { vibrate() {} },
		setTimeout: () => 0,
		clearTimeout() {},
		setInterval: () => 0,
		clearInterval() {},
		requestAnimationFrame: () => 0,
		cancelAnimationFrame() {},
		console,
	};

	const exported =
		SRC +
		"\n;module.exports={setSessionActive,setTouchpadMode,initTouchpad," +
		"syncTouchpadToolbar,setTouchpadSensitivity,registerTouchpadMode};";
	new Function(...Object.keys(sandbox), exported)(...Object.values(sandbox));

	const api = sandbox.module.exports;
	api.setTouchpadSensitivity(1);
	api.initTouchpad();

	const pad = {
		sent,
		els,
		api,
		body: docBody,
		tick: (ms) => (clock.t += ms),
		fire(type, touches) {
			listeners[type]({
				touches,
				target: { closest: () => null },
				preventDefault() {},
			});
		},
		down(x, y) {
			pad.fire("touchstart", [{ clientX: x, clientY: y, identifier: 0 }]);
		},
		moveTo(x, y) {
			pad.tick(40);
			pad.fire("touchmove", [{ clientX: x, clientY: y, identifier: 0 }]);
		},
		up() {
			pad.fire("touchend", []);
		},
		twoDown() {
			pad.fire("touchstart", [
				{ clientX: 100, clientY: 100, identifier: 0 },
				{ clientX: 140, clientY: 100, identifier: 1 },
			]);
		},
		twoMoveTo(x) {
			pad.tick(40);
			pad.fire("touchmove", [
				{ clientX: x, clientY: 100, identifier: 0 },
				{ clientX: x + 40, clientY: 100, identifier: 1 },
			]);
		},
		types: () => sent.map((m) => m.type),
	};
	return pad;
}

async function openPad(mode, opts) {
	const pad = loadPad(opts);
	pad.api.setSessionActive(true);
	await pad.api.setTouchpadMode(mode);
	pad.sent.length = 0;
	return pad;
}

test("a keyboard tap advances on touch down, with no wait for the lift", async () => {
	const pad = await openPad("keyboard");
	pad.down(100, 100);
	assert.deepEqual(
		pad.types(),
		["remote-key-press"],
		"the keystroke must not wait on touchend: typing is the whole point",
	);
	pad.tick(60);
	pad.up();
	assert.deepEqual(
		pad.types(),
		["remote-key-press"],
		"and the lift adds nothing",
	);
});

test("the keyboard pad drives no pointer: dragging on it types and nothing else", async () => {
	const pad = await openPad("keyboard");
	pad.down(100, 100);
	pad.moveTo(200, 160);
	pad.moveTo(300, 220);
	pad.up();

	assert.deepEqual(
		pad.types(),
		["remote-key-press"],
		"a smeared thumb is still one keystroke, not a mouse gesture",
	);
});

test("two fingers on the keyboard pad scroll nothing either", async () => {
	const pad = await openPad("keyboard");
	pad.twoDown();
	pad.twoMoveTo(200);
	pad.twoMoveTo(300);
	pad.fire("touchend", []);

	assert.equal(
		pad.types().some((t) => t.startsWith("mouse-")),
		false,
		"the keyboard pad speaks only in keystrokes",
	);
});

test("the mouse pad still moves, scrolls and right-clicks", async () => {
	const pad = await openPad("mouse");
	pad.down(100, 100);
	pad.moveTo(200, 100);
	pad.up();
	assert.equal(
		pad.sent.some((m) => m.type === "mouse-move"),
		true,
		"one finger moves the pointer",
	);

	pad.sent.length = 0;
	pad.twoDown();
	pad.twoMoveTo(200);
	pad.twoMoveTo(300);
	pad.fire("touchend", []);
	assert.equal(
		pad.sent.some((m) => m.type === "mouse-scroll"),
		true,
		"two fingers scroll",
	);

	pad.sent.length = 0;
	pad.twoDown();
	pad.tick(80);
	pad.fire("touchend", []);
	assert.deepEqual(
		pad.sent
			.filter((m) => m.type === "mouse-click")
			.map((m) => m.data.button),
		["right"],
		"a two-finger tap right-clicks",
	);
});

test("the edit keys live on the mouse pad, where the pointer that selects text is", async () => {
	const pad = loadPad();
	const keys = pad.els.touchpadEditKeys;
	pad.api.setSessionActive(true);

	await pad.api.setTouchpadMode("keyboard");
	assert.equal(
		keys.classList.contains("visible"),
		false,
		"not the keyboard pad",
	);

	await pad.api.setTouchpadMode("mouse");
	assert.equal(keys.classList.contains("visible"), true);

	await pad.api.setTouchpadMode("mouse");
	assert.equal(
		keys.classList.contains("visible"),
		false,
		"closing the pad takes them with it",
	);
});

test("the bar carries the six edit keys, in the order a thumb reaches them", () => {
	const html = fs.readFileSync(path.join(BASE, "remote.html"), "utf-8");
	const bar = /id="touchpadEditKeys"[\s\S]*?<\/div>/.exec(html)[0];
	const names = [...bar.matchAll(/remoteEditKey\('(\w+)'\)/g)].map(
		(m) => m[1],
	);
	assert.deepEqual(
		names,
		["copy", "paste", "cut", "undo", "enter", "save"],
		"save is appended, so nothing a thumb already knows moves",
	);
	assert.match(
		SRC,
		/function remoteEditKey\(action\) \{\s*sendMessage\("remote-edit-key", \{ action \}\);/,
	);

	const server = fs.readFileSync(
		path.join(BASE, "main/websocket-server.js"),
		"utf-8",
	);
	const allowed = /const EDIT_KEYS = \[([^\]]*)\]/.exec(server)[1];
	for (const name of names) {
		assert.match(
			allowed,
			new RegExp('"' + name + '"'),
			name +
				" is not on the allow-list, so the server would silently turn it into copy",
		);
	}

	const main = fs.readFileSync(
		path.join(BASE, "main/remote-input.js"),
		"utf-8",
	);
	const map = /const EDIT_KEY_TO_KEY = \{([^}]*)\}/.exec(main)[1];
	for (const name of names) {
		if (name === "enter") {
			assert.doesNotMatch(
				map,
				/enter:/,
				"enter is the bare key, handled before the map",
			);
			continue;
		}
		assert.match(
			map,
			new RegExp("\\b" + name + ": Key\\."),
			name + " has no key, so the map's fallback would type Ctrl+C for it",
		);
	}
	assert.match(
		map,
		/save: Key\.S/,
		"and save is the modifier + S, like the other four",
	);
});

test("a mode handler can borrow the edit keys, and only while it asks", async () => {
	const pad = loadPad();
	const clip = pad.els.touchpadEditKeys;
	let wanted = false;
	pad.api.registerTouchpadMode("jedi", {
		modeBtnId: "modeBtnJedi",
		wantsEditKeys: () => wanted,
	});
	pad.api.setSessionActive(true);

	await pad.api.setTouchpadMode("jedi");
	assert.equal(
		clip.classList.contains("visible"),
		false,
		"a handler gets nothing it has not asked for",
	);

	wanted = true;
	pad.api.syncTouchpadToolbar();
	assert.equal(
		clip.classList.contains("visible"),
		true,
		"the air keyboard asks once it arms, and gets the same two buttons",
	);

	await pad.api.setTouchpadMode("jedi");
	assert.equal(
		clip.classList.contains("visible"),
		false,
		"and closing the handler takes them back",
	);
});

test("a handler with no opinion on the edit keys gets none", async () => {
	const pad = loadPad();
	pad.api.registerTouchpadMode("jedi", { modeBtnId: "modeBtnJedi" });
	pad.api.setSessionActive(true);

	await pad.api.setTouchpadMode("jedi");
	assert.equal(pad.els.touchpadEditKeys.classList.contains("visible"), false);
});

test("the toolbars stay pressable even when a handler stands the glass down", () => {
	assert.match(
		CSS,
		/\.touchpad-toolbar \{[^}]*pointer-events: auto;/,
		"jedi-pad-off puts pointer-events:none on the overlay; the bars must opt back in",
	);
});

test("an open pad keeps both mode buttons reachable, so switching is one press", async () => {
	const pad = loadPad();
	const side = pad.els.modeSideBtns;
	pad.api.setSessionActive(true);

	await pad.api.setTouchpadMode("keyboard");
	assert.equal(side.classList.contains("has-pad"), true);

	await pad.api.setTouchpadMode("mouse");
	assert.equal(side.classList.contains("has-pad"), true);

	await pad.api.setTouchpadMode("mouse");
	assert.equal(side.classList.contains("has-pad"), false, "no pad, no marker");
});

test("a mode handler still gets the strip to itself: it brings its own controls", async () => {
	const pad = loadPad();
	pad.api.registerTouchpadMode("jedi", { modeBtnId: "modeBtnJedi" });
	pad.api.setSessionActive(true);

	await pad.api.setTouchpadMode("jedi");
	const side = pad.els.modeSideBtns;
	assert.equal(side.classList.contains("has-active"), true);
	assert.equal(
		side.classList.contains("has-pad"),
		false,
		"jedi is not a plain pad, so the mouse button does not tag along",
	);
});

test("the css that hides the other buttons lets the two pad buttons back in", () => {
	assert.match(
		CSS,
		/#modeSideBtns\.has-pad #modeBtnMouse,\s*#modeSideBtns\.has-pad #modeBtnKeyboard \{\s*display: flex;/,
		"two ids beat the .has-active hide rule, so no !important is needed",
	);
});

test("either pad lifts the popup it covers rather than emptying it", async () => {
	for (const mode of ["keyboard", "mouse"]) {
		const covered = [];
		const pad = await openPad(mode, {
			padOverlay: { setPadCovered: (v) => covered.push(v) },
		});
		pad.api.syncTouchpadToolbar();
		assert.equal(
			covered[covered.length - 1],
			true,
			mode + " pad covers the popup, so the popup goes above it",
		);
	}
});

test("the pad renders no buttons of its own for a popup", () => {
	const html = fs.readFileSync(path.join(BASE, "remote.html"), "utf-8");
	for (const id of ["touchpadActionBar", "touchpadConfirmBar"]) {
		assert.equal(
			html.includes(id),
			false,
			id + " mirrored a popup's buttons; the real ones are used now",
		);
	}
	assert.equal(
		/padActions/.test(SRC),
		false,
		"nothing may hand the pad a copy of a popup's buttons",
	);
});

test("a handler mode that covers the screen lifts the popup too", async () => {
	const covered = [];
	const pad = loadPad({
		padOverlay: { setPadCovered: (v) => covered.push(v) },
	});
	let wanted = false;
	pad.api.registerTouchpadMode("jedi", {
		modeBtnId: "modeBtnJedi",
		wantsEditKeys: () => wanted,
	});
	pad.api.setSessionActive(true);
	await pad.api.setTouchpadMode("jedi");

	assert.equal(
		covered[covered.length - 1],
		false,
		"a handler that is not typing leaves the popup alone",
	);

	wanted = true;
	pad.api.syncTouchpadToolbar();
	assert.equal(
		covered[covered.length - 1],
		true,
		"but the air keyboard covers the popup, so the buttons must come up",
	);
});

test("the overlay is told whether a pad is covering it", async () => {
	const covered = [];
	const pad = await openPad("mouse", {
		padOverlay: { setPadCovered: (v) => covered.push(v) },
	});
	pad.api.syncTouchpadToolbar();
	assert.equal(covered[covered.length - 1], true, "an open pad covers it");

	await pad.api.setTouchpadMode("mouse");
	assert.equal(
		covered[covered.length - 1],
		false,
		"and closing the pad hands the popup its own buttons back",
	);
});

test("the toolbars sit outside the gesture surface, or they could not be pressed", () => {
	const shared = /function padListener\([\s\S]*?\n\t\}/.exec(SRC);
	assert.ok(shared, "the three touch listeners share one registration helper");
	assert.match(
		shared[0],
		/closest\("\.touchpad-toolbar"\)/,
		"the shared helper must let a toolbar press through untouched",
	);
	for (const handler of ["touchstart", "touchmove", "touchend"]) {
		assert.match(
			SRC,
			new RegExp('padListener\\("' + handler + '"'),
			handler + " must be registered through the shared helper",
		);
	}
	assert.equal(
		(SRC.match(/overlay\.addEventListener\(/g) || []).length,
		1,
		"nothing may bind the glass directly and skip the toolbar guard",
	);
});

test("the pad stamps its tint on the body so a lifted popup can wear it", async () => {
	const pad = loadPad();
	pad.api.setSessionActive(true);

	await pad.api.setTouchpadMode("mouse");
	assert.equal(pad.body.dataset.padTint, "mouse");

	await pad.api.setTouchpadMode("keyboard");
	assert.equal(pad.body.dataset.padTint, "keyboard");

	await pad.api.setTouchpadMode("keyboard");
	assert.equal(
		pad.body.dataset.padTint,
		undefined,
		"closing the pad takes the tint with it, or the popup stays coloured",
	);
});

test("a handler mode paints no tint: it does not own the glass", async () => {
	const pad = loadPad();
	pad.api.registerTouchpadMode("jedi", { modeBtnId: "modeBtnJedi" });
	pad.api.setSessionActive(true);
	await pad.api.setTouchpadMode("jedi");
	assert.equal(pad.body.dataset.padTint, undefined);
});

test("the tint sits over the popup but under the buttons it lends", () => {
	const after = /\.overlay\.pad-lifted::after \{[\s\S]*?\n\}/.exec(CSS)[0];
	assert.match(after, /z-index: 1/, "above the popup surface");
	assert.match(after, /pointer-events: none/, "and never eats a touch");

	const btn = /\.overlay\.pad-lifted button[^{]*\{[\s\S]*?\n\}/.exec(CSS)[0];
	assert.match(btn, /z-index: 2/, "buttons come back up through the tint");
	assert.match(
		btn,
		/:not\(\.popup-student-btn\)/,
		"student names stay under the pad: picking one is not a pad gesture",
	);
});
