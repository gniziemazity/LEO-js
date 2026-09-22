"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");

const sent = [];
const realResolve = Module._resolveFilename;
const stubId = path.resolve(
	__dirname,
	"..",
	"src/renderer/__electron_stub_progress__",
);
require.cache[stubId] = {
	id: stubId,
	filename: stubId,
	loaded: true,
	exports: { ipcRenderer: { on() {}, send: (ch, a) => sent.push([ch, a]) } },
};
Module._resolveFilename = function (request, ...rest) {
	if (request === "electron") return stubId;
	return realResolve.call(this, request, ...rest);
};
const CursorManager = require("../src/renderer/cursor-manager");
Module._resolveFilename = realResolve;

function fakeElement() {
	const classes = new Set();
	return {
		classList: {
			add: (...c) => c.forEach((x) => classes.add(x)),
			remove: (...c) => c.forEach((x) => classes.delete(x)),
			contains: (c) => classes.has(c),
		},
		scrollIntoView() {},
	};
}

function manager() {
	const steps = [{ type: "char", char: "a", element: fakeElement() }];
	const cm = new CursorManager(
		{ updateProgressBar() {}, removeCursorClasses() {} },
		{ addEntry: () => ({}) },
	);
	cm.setExecutionSteps(steps);
	return cm;
}

function withStalledTimers(body) {
	const saved = {
		raf: global.requestAnimationFrame,
		cancelRaf: global.cancelAnimationFrame,
		setTimeout: global.setTimeout,
		clearTimeout: global.clearTimeout,
	};
	global.requestAnimationFrame = () => 1;
	global.cancelAnimationFrame = () => {};
	global.setTimeout = () => 1; // accepts a callback, never calls it
	global.clearTimeout = () => {};
	try {
		return body();
	} finally {
		for (const [k, v] of Object.entries(saved)) {
			const key =
				k === "raf"
					? "requestAnimationFrame"
					: k === "cancelRaf"
						? "cancelAnimationFrame"
						: k;
			if (v === undefined) delete global[key];
			else global[key] = v;
		}
	}
}

test("the remote gets every update synchronously, with no timer stalled or not", () => {
	withStalledTimers(() => {
		const cm = manager();
		sent.length = 0;
		cm.jumpTo(0);

		const channels = sent.map((s) => s[0]);
		assert.ok(
			channels.includes("update-cursor"),
			"update-cursor was gated on a timer that never fired - this is " +
				"the desktop-unfocused freeze/lag",
		);
		assert.ok(
			channels.includes("update-progress"),
			"update-progress was gated on a timer that never fired",
		);
	});
});

test("_broadcastProgress sends immediately - not on a later tick", () => {
	const cm = manager();
	sent.length = 0;
	cm._broadcastProgress();

	// No await, no setTimeout(0) settle - if this passes, the send already
	// happened synchronously within the call above.
	const channels = sent.map((s) => s[0]);
	assert.ok(channels.includes("update-cursor"));
	assert.ok(channels.includes("update-progress"));
});

test("every step sends its own update - nothing is dropped by coalescing", () => {
	const cm = manager();
	sent.length = 0;

	for (let i = 0; i < 20; i++) cm._broadcastProgress();

	const cursorSends = sent.filter((s) => s[0] === "update-cursor");
	assert.equal(
		cursorSends.length,
		20,
		"a dropped update here is a step the remote's cursor never saw",
	);
});
