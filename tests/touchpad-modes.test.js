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
		touchpadStepKeys: makeNode(),
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
		setTimeout: o.timers ? (fn) => o.timers.push(fn) : () => 0,
		clearTimeout: o.timers ? (id) => (o.timers[id - 1] = null) : () => {},
		setInterval: () => 0,
		clearInterval() {},
		requestAnimationFrame: o.frames ? (fn) => o.frames.push(fn) : () => 0,
		cancelAnimationFrame() {},
		console,
	};

	const exported =
		SRC +
		"\n;module.exports={setAutoTypingActive,setTouchpadMode,initTouchpad," +
		"syncTouchpadToolbar,setTouchpadSensitivity,registerTouchpadMode," +
		"sendScroll,releaseScroll,createPadGestures};";
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
	pad.api.setAutoTypingActive(true);
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

test("a flick keeps scrolling after the fingers lift, until two fingers land", async () => {
	const frames = [];
	const pad = await openPad("mouse", { frames });
	const scrolls = () => pad.sent.filter((m) => m.type === "mouse-scroll");

	pad.twoDown();
	pad.twoMoveTo(160);
	pad.twoMoveTo(220);
	pad.fire("touchend", []);
	assert.equal(frames.length, 1, "the lift starts the coast");

	const atLift = scrolls().length;
	frames.shift()();
	frames.shift()();
	assert.equal(
		scrolls().length,
		atLift + 2,
		"each frame scrolls a little more",
	);

	pad.twoDown();
	pad.sent.length = 0;
	frames.shift()();
	assert.equal(scrolls().length, 0, "two fingers landing stop the coast");
});

test("an extension mode scrolls through the same pipeline, fractions and coast included", () => {
	const frames = [];
	const pad = loadPad({ frames });
	const scrolls = () =>
		pad.sent.filter((m) => m.type === "mouse-scroll").map((m) => m.data.dy);

	pad.api.sendScroll(0.6);
	assert.deepEqual(scrolls(), [], "a fraction is kept, not sent");
	pad.api.sendScroll(0.6);
	assert.deepEqual(scrolls(), [1], "and it adds up to a whole step");

	pad.api.sendScroll(20);
	pad.api.sendScroll(20);
	pad.api.releaseScroll();
	assert.equal(frames.length, 1, "a fast scroll coasts on release");
});

test("a tap clicks late, so a second tap can turn it into a drag instead", async () => {
	const timers = [];
	const pad = await openPad("mouse", { timers });
	pad.down(100, 100);
	pad.tick(50);
	pad.up();
	assert.deepEqual(pad.types(), [], "the click waits for a second tap");
	assert.equal(timers.length, 1);

	pad.tick(100);
	pad.down(100, 100);
	assert.deepEqual(pad.types(), ["mouse-drag-start"]);
	assert.equal(
		timers[0],
		null,
		"and the waiting click is cancelled, not sent too",
	);
	pad.moveTo(140, 100);
	pad.up();
	assert.deepEqual(pad.types(), [
		"mouse-drag-start",
		"mouse-move",
		"mouse-drag-end",
	]);

	pad.sent.length = 0;
	pad.tick(1000);
	pad.down(100, 100);
	pad.tick(50);
	pad.up();
	timers[timers.length - 1]();
	assert.deepEqual(
		pad.sent.map((m) => m.data.button),
		["left"],
		"a lone tap clicks once its wait is over",
	);
});

test("a two-finger tap is timed from the second finger, and moving cancels it", async () => {
	const pad = await openPad("mouse");
	const rights = () =>
		pad.sent
			.filter((m) => m.type === "mouse-click")
			.map((m) => m.data.button);

	pad.down(100, 100);
	pad.tick(250);
	pad.twoDown();
	pad.tick(100);
	pad.up();
	assert.deepEqual(
		rights(),
		["right"],
		"the first finger landing early does not use up the second's 300 ms",
	);

	pad.sent.length = 0;
	pad.twoDown();
	pad.twoMoveTo(110);
	pad.up();
	assert.deepEqual(rights(), [], "a scroll is not a right-click");
});

test("one finger left behind by two drives nothing until the hand leaves the glass", async () => {
	const pad = await openPad("mouse");
	pad.twoDown();
	pad.tick(400);
	pad.fire("touchend", [{ clientX: 140, clientY: 100, identifier: 1 }]);
	pad.moveTo(400, 300);
	assert.deepEqual(pad.types(), [], "the finger left behind is latched out");
	pad.up();
	pad.down(100, 100);
	pad.moveTo(140, 100);
	assert.deepEqual(
		pad.types(),
		["mouse-move"],
		"and a fresh touch points again",
	);
});

test("a held drag ends when the hand leaves the glass, even if a second finger joined", async () => {
	const pad = await openPad("mouse");
	pad.down(100, 100);
	pad.up();
	pad.down(100, 100);
	pad.fire("touchstart", [
		{ clientX: 100, clientY: 100, identifier: 0 },
		{ clientX: 140, clientY: 100, identifier: 1 },
	]);
	pad.tick(400);
	pad.up();
	assert.deepEqual(
		pad.types(),
		["mouse-drag-start", "mouse-drag-end"],
		"or the host's button stays down after every finger is off",
	);
});

test("an extension mode gets the mouse pad's recogniser, with its own hooks", () => {
	const pad = loadPad();
	const seen = [];
	const g = pad.api.createPadGestures({
		sendThrottleMs: 0,
		getTwoFingerMode: () => "pinch",
		onCursorMove: (d) => seen.push(["move", d.dx, d.dy]),
		startPinch: () => seen.push(["pinch-start"]),
		movePinch: () => seen.push(["pinch"]) > 0,
	});
	g.start({ touches: [{ clientX: 10, clientY: 10, identifier: 0 }] });
	g.move({ touches: [{ clientX: 10.1, clientY: 10, identifier: 0 }] });
	g.move({ touches: [{ clientX: 12, clientY: 10, identifier: 0 }] });
	g.end({ touches: [] });
	g.start({
		touches: [
			{ clientX: 10, clientY: 10, identifier: 0 },
			{ clientX: 50, clientY: 10, identifier: 1 },
		],
	});
	g.move({
		touches: [
			{ clientX: 10, clientY: 10, identifier: 0 },
			{ clientX: 60, clientY: 10, identifier: 1 },
		],
	});
	g.end({ touches: [] });
	assert.deepEqual(seen, [["move", 0, -2], ["pinch-start"], ["pinch"]]);
	assert.deepEqual(
		pad.types(),
		[],
		"a moved pinch is not a right-click, and nothing else reached the wire",
	);
});

test("the edit keys live on the mouse pad, where the pointer that selects text is", async () => {
	const pad = loadPad();
	const keys = pad.els.touchpadEditKeys;
	pad.api.setAutoTypingActive(true);

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

test("a mode handler can borrow the edit keys, and only while it asks", async () => {
	const pad = loadPad();
	const clip = pad.els.touchpadEditKeys;
	let wanted = false;
	pad.api.registerTouchpadMode("jedi", {
		modeBtnId: "modeBtnJedi",
		wantsEditKeys: () => wanted,
	});
	pad.api.setAutoTypingActive(true);

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
	pad.api.setAutoTypingActive(true);

	await pad.api.setTouchpadMode("jedi");
	assert.equal(pad.els.touchpadEditKeys.classList.contains("visible"), false);
});

test("the step keys are the keyboard pad's own, not a handler mode's", async () => {
	const pad = loadPad();
	pad.api.registerTouchpadMode("jedi", { modeBtnId: "modeBtnJedi" });
	pad.api.setAutoTypingActive(true);

	await pad.api.setTouchpadMode("jedi");
	assert.equal(
		pad.els.touchpadStepKeys.classList.contains("visible"),
		false,
		"a registered mode brings its own controls, same as the edit keys",
	);

	await pad.api.setTouchpadMode("mouse");
	assert.equal(
		pad.els.touchpadStepKeys.classList.contains("visible"),
		false,
		"the mouse pad has the edit keys; stepping belongs to the keyboard pad",
	);

	await pad.api.setTouchpadMode("keyboard");
	assert.equal(pad.els.touchpadStepKeys.classList.contains("visible"), true);
});

test("an open pad keeps both mode buttons reachable, so switching is one press", async () => {
	const pad = loadPad();
	const side = pad.els.modeSideBtns;
	pad.api.setAutoTypingActive(true);

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
	pad.api.setAutoTypingActive(true);

	await pad.api.setTouchpadMode("jedi");
	const side = pad.els.modeSideBtns;
	assert.equal(side.classList.contains("has-active"), true);
	assert.equal(
		side.classList.contains("has-pad"),
		false,
		"jedi is not a plain pad, so the mouse button does not tag along",
	);
});

test("a handler mode covers the popup unless it says it stood down", async () => {
	const covered = [];
	const pad = loadPad({
		padOverlay: { setPadCovered: (v) => covered.push(v) },
	});
	pad.api.registerTouchpadMode("jedi", { modeBtnId: "modeBtnJedi" });
	pad.api.setAutoTypingActive(true);
	await pad.api.setTouchpadMode("jedi");

	assert.equal(
		covered[covered.length - 1],
		true,
		"its glass is over the popup, so the buttons have to come up through " +
			"it — gating this on wantsEditKeys left them unpressable in jedi",
	);
});

test("a handler that stands its glass down leaves the popup alone", async () => {
	const covered = [];
	let down = false;
	const pad = loadPad({
		padOverlay: { setPadCovered: (v) => covered.push(v) },
	});
	pad.api.registerTouchpadMode("jedi", {
		modeBtnId: "modeBtnJedi",
		coversScreen: () => !down,
	});
	pad.api.setAutoTypingActive(true);
	await pad.api.setTouchpadMode("jedi");
	assert.equal(covered[covered.length - 1], true);

	down = true;
	pad.api.syncTouchpadToolbar();
	assert.equal(
		covered[covered.length - 1],
		false,
		"a pad shrunk to a corner control is not covering anything",
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

test("the pad stamps its tint on the body so a lifted popup can wear it", async () => {
	const pad = loadPad();
	pad.api.setAutoTypingActive(true);

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

test("a handler mode wears the tint it declares, and only that", async () => {
	const pad = loadPad();
	pad.api.registerTouchpadMode("jedi", {
		modeBtnId: "modeBtnJedi",
		padTint: "jedi",
	});
	pad.api.setAutoTypingActive(true);
	await pad.api.setTouchpadMode("jedi");
	assert.equal(
		pad.body.dataset.padTint,
		"jedi",
		"a covered popup buries the glass, so the wash is the only thing left " +
			"saying a pad is live",
	);

	await pad.api.setTouchpadMode("jedi");
	assert.equal(
		pad.body.dataset.padTint,
		undefined,
		"closing takes it with it, the same as a built-in pad",
	);
});

test("a handler that names no tint paints none", async () => {
	const pad = loadPad();
	pad.api.registerTouchpadMode("mystery", { modeBtnId: "modeBtnJedi" });
	pad.api.setAutoTypingActive(true);
	await pad.api.setTouchpadMode("mystery");
	assert.equal(
		pad.body.dataset.padTint,
		undefined,
		"base names no mode's colour: a tint is the handler's to declare",
	);
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

test("the top bar sits above the pad and every popup, so its buttons stay pressable", () => {
	const z = (re) => Number(re.exec(CSS)[1]);
	const bar = z(/\.mobile-view #mobile-header \{[^}]*?z-index: (\d+);/);
	const raised = z(
		/\.mobile-view #mobile-header\.above-pad \{\s*z-index: (\d+);/,
	);
	assert.equal(raised, bar, "the pad no longer changes where the bar sits");
	assert.ok(
		bar > z(/\.touchpad-overlay \{[^}]*?z-index: (\d+);/),
		"above the pad",
	);
	assert.ok(bar > z(/\n\.overlay \{[^}]*?z-index: (\d+);/), "above a popup");
	assert.ok(
		bar > z(/\.overlay\.pad-lifted \{\s*z-index: (\d+);/),
		"and above a popup lifted over the pad",
	);
	assert.ok(
		bar < z(/\.mode-side-btns \{[^}]*?z-index: (\d+);/),
		"below the side buttons",
	);
	assert.equal(
		/#mobile-header\.above-pad[^{]*\{\s*z-index: 2001/.test(CSS),
		false,
		"the guard that tucked the bar under a lifted popup is gone: the bar is now visible, not hidden",
	);
});

test("a popup keeps its content clear of the bar, on whichever edge the bar is", () => {
	assert.match(CSS, /--header-h: 62px;/, "the bar and its 4px progress line");
	assert.match(
		CSS,
		/body\.side-right \.overlay \{[^}]*?padding-left: calc\(14px \+ var\(--header-h\)\);/,
		"rotated 90deg, the popup's left edge is the top of the page",
	);
	assert.match(
		CSS,
		/body\.side-left \.overlay \{[^}]*?padding-right: calc\(14px \+ var\(--header-h\)\);/,
		"rotated the other way it is the popup's right edge",
	);
});
