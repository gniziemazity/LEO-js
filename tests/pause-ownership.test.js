"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadModule } = require("./helpers/load-module");

const state = require("../src/main/state");

test("pause hands back a disposer that releases exactly its own reason", () => {
	state.pauseReasons.clear();

	const releaseA = state.pause("a");
	const releaseB = state.pause("b");
	assert.equal(state.isPaused, true);

	releaseA();
	assert.equal(state.isPaused, true, "one release must not clear the others");

	releaseB();
	assert.equal(state.isPaused, false);

	releaseB();
	assert.equal(state.isPaused, false, "a second release must be harmless");
	state.pauseReasons.clear();
});

test("the server tells listeners which client a message came from", () => {
	const Server = loadModule("src/main/websocket-server.js", {
		express: () => ({ get() {}, use() {} }),
		ws: { Server: class {}, OPEN: 1 },
		qrcode: {},
		"./plugin": {},
	});

	const server = new Server(0);
	const seen = [];
	server.on("client-interaction-overlay-shown", () => {
		seen.push(server.currentClientId);
	});

	server.handleClientMessage({ type: "interaction-overlay-shown" }, 7);
	assert.deepEqual(seen, [7]);

	assert.equal(
		server.currentClientId,
		null,
		"the client context must not leak past the message",
	);
});

test("two phones each own their own interaction pause", () => {
	state.pauseReasons.clear();

	const holds = new Map();
	const shown = (clientId) => {
		if (holds.has(clientId)) return;
		holds.set(clientId, state.pause(`interaction:${clientId}`));
	};
	const gone = (clientId) => {
		const release = holds.get(clientId);
		if (!release) return;
		holds.delete(clientId);
		release();
	};

	shown(1);
	shown(2);
	assert.equal(state.isPaused, true);

	gone(1);
	assert.equal(
		state.isPaused,
		true,
		"one phone closing its picker unpaused the other phone's",
	);

	gone(2);
	assert.equal(state.isPaused, false);
	state.pauseReasons.clear();
});

test("a phone that vanishes without closing its picker still releases the pause", () => {
	state.pauseReasons.clear();

	const holds = new Map();
	holds.set(3, state.pause("interaction:3"));
	assert.equal(state.isPaused, true);

	const release = holds.get(3);
	holds.delete(3);
	release();

	assert.equal(
		state.isPaused,
		false,
		"typing hotkeys would stay dead for the rest of the session",
	);
	state.pauseReasons.clear();
});
