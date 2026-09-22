"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildRemote } = require("./helpers/remote-dom");

function padOpen() {
	const h = buildRemote();
	h.api.initTouchpad();
	h.api.setSessionActive(true);
	h.api.setTouchpadMode("mouse");
	return h;
}

const types = (h) => h.sent.map((m) => m.type);

function touch(id, x, y) {
	return { identifier: id, clientX: x, clientY: y };
}

function startDrag(h) {
	const pad = h.nodes.touchpadOverlay;
	h.fire(pad, "touchstart", {
		touches: [touch(1, 100, 100)],
		changedTouches: [touch(1, 100, 100)],
	});
	h.fire(pad, "touchend", {
		touches: [],
		changedTouches: [touch(1, 100, 100)],
	});
	h.fire(pad, "touchstart", {
		touches: [touch(2, 100, 100)],
		changedTouches: [touch(2, 100, 100)],
	});
}

test("the pad registers a touchcancel handler at all", () => {
	const h = padOpen();
	const pad = h.nodes.touchpadOverlay;
	assert.ok(
		pad._listeners.get("touchcancel"),
		"an interrupted gesture has nothing to clean it up",
	);
});

test("a touchcancel mid-drag releases the host's mouse button", () => {
	const h = padOpen();
	const pad = h.nodes.touchpadOverlay;

	startDrag(h);
	assert.ok(
		types(h).includes("mouse-drag-start"),
		"setup: a double-tap-and-hold should have pressed the button",
	);

	h.sent.length = 0;
	h.fire(pad, "touchcancel", { touches: [], changedTouches: [] });

	assert.ok(
		types(h).includes("mouse-drag-end"),
		"an incoming call mid-drag leaves the teacher's button held down",
	);
});

test("a touchcancel does not leave the pad ignoring one finger", () => {
	const h = padOpen();
	const pad = h.nodes.touchpadOverlay;

	h.fire(pad, "touchstart", {
		touches: [touch(1, 100, 100), touch(2, 140, 100)],
		changedTouches: [touch(2, 140, 100)],
	});
	h.fire(pad, "touchcancel", { touches: [], changedTouches: [] });

	h.sent.length = 0;
	h.fire(pad, "touchstart", {
		touches: [touch(3, 100, 100)],
		changedTouches: [touch(3, 100, 100)],
	});
	h.fire(pad, "touchmove", {
		touches: [touch(3, 200, 160)],
		changedTouches: [touch(3, 200, 160)],
	});

	assert.ok(
		types(h).includes("mouse-move"),
		"the two-finger latch survived the interruption and swallowed the pointer",
	);
});

test("closing the pad cancels a tap that has not fired yet", () => {
	const h = padOpen();
	const pad = h.nodes.touchpadOverlay;

	h.fire(pad, "touchstart", {
		touches: [touch(1, 100, 100)],
		changedTouches: [touch(1, 100, 100)],
	});
	h.fire(pad, "touchend", {
		touches: [],
		changedTouches: [touch(1, 100, 100)],
	});
	assert.equal(h.pendingTimeouts(), 1, "setup: a tap should be pending");

	h.api.setTouchpadMode("mouse");

	h.sent.length = 0;
	h.runTimeouts();
	assert.ok(
		!types(h).includes("mouse-click"),
		"a phantom click landed after the pad was closed",
	);
});

test("a touchcancel cancels a pending tap too", () => {
	const h = padOpen();
	const pad = h.nodes.touchpadOverlay;

	h.fire(pad, "touchstart", {
		touches: [touch(1, 100, 100)],
		changedTouches: [touch(1, 100, 100)],
	});
	h.fire(pad, "touchend", {
		touches: [],
		changedTouches: [touch(1, 100, 100)],
	});
	assert.equal(h.pendingTimeouts(), 1);

	h.fire(pad, "touchcancel", { touches: [], changedTouches: [] });

	h.sent.length = 0;
	h.runTimeouts();
	assert.ok(!types(h).includes("mouse-click"));
});
