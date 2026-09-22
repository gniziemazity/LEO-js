"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildConnection } = require("./helpers/remote-connection");

test("a socket opened while another was connecting does not kill the live one", () => {
	const h = buildConnection();
	const { api } = h;

	api.connect();
	const first = h.sockets[0];
	assert.equal(h.sockets.length, 1);

	api.connect();
	assert.equal(h.sockets.length, 2, "a second socket should have been opened");
	const second = h.sockets[1];

	second.open();
	assert.equal(api.currentSocket(), second);

	first.drop();

	assert.equal(
		api.currentSocket(),
		second,
		"the discarded socket's close nulled the live one",
	);
	assert.equal(
		h.pendingTimers(),
		0,
		"the discarded socket scheduled a reconnect over a healthy connection",
	);
});

test("a discarded socket cannot deliver messages twice", () => {
	const h = buildConnection();
	const seen = [];
	h.api.setMessageHandler((m) => seen.push(m.type));

	h.api.connect();
	const first = h.sockets[0];
	h.api.connect();
	const second = h.sockets[1];
	second.open();

	first.deliver({ type: "cursor" });
	second.deliver({ type: "cursor" });

	assert.deepEqual(
		seen,
		["cursor"],
		"the orphaned socket is still wired to the message handler",
	);
});

test("foregrounding does not tear down a socket that is still connecting", () => {
	const h = buildConnection();
	h.api.connect();
	assert.equal(h.sockets.length, 1);
	assert.equal(h.sockets[0].readyState, 0);

	h.fire("visibilitychange");

	assert.equal(
		h.sockets.length,
		1,
		"a CONNECTING socket was thrown away on foreground",
	);
});

test("foregrounding with a dead socket reconnects", () => {
	const h = buildConnection();
	h.api.connect();
	h.sockets[0].open();
	h.sockets[0].drop();

	h.fire("visibilitychange");

	assert.equal(h.sockets.length, 2, "a dead socket was not replaced");
});

test("a dropped socket reconnects with a capped backoff", () => {
	const h = buildConnection();
	h.api.connect();
	h.sockets[0].open();

	const delays = [];
	for (let i = 0; i < 6; i++) {
		const before = h.sockets.length;
		h.sockets[h.sockets.length - 1].drop();

		let waited = 0;
		while (h.sockets.length === before && waited <= 60000) {
			h.advance(500);
			waited += 500;
		}
		delays.push(waited);
		h.sockets[h.sockets.length - 1].open();
	}

	assert.ok(delays[0] <= 2000, `first retry waited ${delays[0]}ms`);
	assert.ok(
		delays.every((d) => d <= 15000),
		`a retry exceeded the cap: ${delays.join(",")}`,
	);
	assert.ok(
		delays[delays.length - 1] <= 2000,
		"a successful connection must reset the backoff",
	);
});

test("the page is told when the connection comes and goes", () => {
	const h = buildConnection();
	const states = [];
	h.api.setConnectionHandler((up) => states.push(up));

	h.api.connect();
	h.sockets[0].open();
	h.sockets[0].drop();

	assert.deepEqual(
		states,
		[true, false],
		"a dead socket must be visible to the page",
	);
});

test("an error on the socket is reported rather than swallowed", () => {
	const h = buildConnection();
	const states = [];
	h.api.setConnectionHandler((up) => states.push(up));

	h.api.connect();
	h.sockets[0].fail();

	assert.deepEqual(states, [false], "onerror is not wired to anything");
});

test("sendMessage drops silently while the socket is not open", () => {
	const h = buildConnection();
	h.api.connect();
	const sock = h.sockets[0];

	h.api.sendMessage("mouse-move", { dx: 1, dy: 1 });
	assert.equal(sock.sent.length, 0);

	sock.open();
	h.api.sendMessage("mouse-move", { dx: 1, dy: 1 });
	assert.equal(sock.sent.length, 1);
	assert.equal(JSON.parse(sock.sent[0]).type, "mouse-move");
});
