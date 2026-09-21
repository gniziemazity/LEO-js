"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const LEOBroadcastServer = require(
	path.resolve(__dirname, "..", "src/main/websocket-server.js"),
);

function drive(type, data) {
	const server = new LEOBroadcastServer(0);
	const seen = [];
	const origEmit = server.emit.bind(server);
	server.emit = (event, ...args) => {
		seen.push({ event, args });
		return origEmit(event, ...args);
	};
	server.handleClientMessage({ type, data });
	return seen;
}

function argsOf(type, data) {
	const seen = drive(type, data);
	assert.equal(seen.length, 1, type + " must emit exactly one event");
	return seen[0].args;
}

const HUGE = 1e12;

test("pointer travel is bounded, so one bad message is one bounded twitch", () => {
	assert.deepEqual(
		argsOf("mouse-move", { dx: HUGE, dy: -HUGE }),
		[5000, -5000],
	);
	assert.deepEqual(argsOf("mouse-move", { dx: 12, dy: -34 }), [12, -34]);
});

test("scroll is bounded the same way", () => {
	assert.deepEqual(argsOf("mouse-scroll", { dy: HUGE }), [5000]);
	assert.deepEqual(argsOf("mouse-scroll", { dy: -HUGE }), [-5000]);
	assert.deepEqual(argsOf("mouse-scroll", { dy: 7 }), [7]);
});

test("window drag and pinch travel are bounded, at their own wider limit", () => {
	assert.deepEqual(
		argsOf("window-drag", { dx: HUGE, dy: -HUGE }),
		[10000, -10000],
	);
	assert.deepEqual(
		argsOf("window-pinch", { scale: 3, dx: HUGE, dy: -HUGE }),
		[3, 10000, -10000],
	);
});

test("a field that is not a number becomes zero rather than NaN", () => {
	for (const bad of [
		undefined,
		null,
		"abc",
		{},
		[],
		NaN,
		Infinity,
		-Infinity,
	]) {
		assert.deepEqual(
			argsOf("mouse-move", { dx: bad, dy: bad }),
			[0, 0],
			"dx/dy of " + JSON.stringify(String(bad)) + " must not reach nut-js",
		);
	}
});

test("a numeric string is accepted, because that is what JSON round-trips give", () => {
	assert.deepEqual(argsOf("mouse-move", { dx: "42", dy: "-9" }), [42, -9]);
});

test("window scale is clamped into a sane band and never zero or negative", () => {
	assert.deepEqual(argsOf("window-pinch", { scale: HUGE }), [10, 0, 0]);
	assert.deepEqual(argsOf("window-pinch", { scale: 0 }), [1, 0, 0]);
	assert.deepEqual(argsOf("window-pinch", { scale: -5 }), [1, 0, 0]);
	assert.deepEqual(argsOf("window-pinch", { scale: 0.0001 }), [0.1, 0, 0]);
	assert.deepEqual(
		argsOf("window-pinch", { scale: "nope" }),
		[1, 0, 0],
		"an unusable scale falls back to no change, not to zero",
	);
});

test("the mouse button is one of two words, whatever the phone said", () => {
	assert.deepEqual(argsOf("mouse-click", { button: "right" }), ["right"]);
	assert.deepEqual(argsOf("mouse-click", { button: "left" }), ["left"]);
	assert.deepEqual(argsOf("mouse-click", { button: "middle" }), ["left"]);
	assert.deepEqual(argsOf("mouse-click", { button: "<script>" }), ["left"]);
	assert.deepEqual(argsOf("mouse-click", {}), ["left"]);
});

test("the edit-key name is checked against a fixed list, so no key name crosses the wire", () => {
	for (const ok of ["copy", "cut", "paste", "undo", "enter", "save"]) {
		assert.deepEqual(argsOf("remote-edit-key", { action: ok }), [ok]);
	}
	for (const bad of [
		"delete",
		"F4",
		"LeftSuper",
		"",
		null,
		undefined,
		7,
		{},
	]) {
		assert.deepEqual(
			argsOf("remote-edit-key", { action: bad }),
			["copy"],
			JSON.stringify(String(bad)) + " must not reach the keyboard driver",
		);
	}
	assert.deepEqual(argsOf("remote-edit-key", {}), ["copy"]);
});

test("the timer adjustment is bounded too", () => {
	assert.deepEqual(argsOf("timer-adjust", { minutes: HUGE }), [600]);
	assert.deepEqual(argsOf("timer-adjust", { minutes: -HUGE }), [-600]);
	assert.deepEqual(argsOf("timer-adjust", { minutes: 5 }), [5]);
});

test("an unknown message type emits nothing at all", () => {
	assert.deepEqual(drive("not-a-real-message", { dx: 1 }), []);
});

test("a type borrowed from Object.prototype is unknown, not a handler", () => {
	for (const type of [
		"__proto__",
		"constructor",
		"toString",
		"hasOwnProperty",
		"valueOf",
	]) {
		assert.doesNotThrow(
			() => drive(type, {}),
			type + " must not reach an inherited method",
		);
		assert.deepEqual(drive(type, {}), [], type + " must emit nothing");
	}
});

test("every clamped handler survives a message with no data object", () => {
	for (const type of [
		"mouse-move",
		"mouse-scroll",
		"window-drag",
		"window-pinch",
		"mouse-click",
		"timer-adjust",
	]) {
		assert.doesNotThrow(
			() => drive(type, {}),
			type + " must tolerate an empty payload",
		);
	}
});

test("the daily token gates the socket, and the origin must match the host", () => {
	const server = new LEOBroadcastServer(0);
	const token = server.token;
	assert.ok(token && token.length >= 16, "a guessable token is no token");

	const req = (url, headers) => ({ req: { url, headers: headers || {} } });
	assert.equal(server._verifyClient(req("/?t=" + token)), true);
	assert.equal(server._verifyClient(req("/?t=wrong")), false, "wrong token");
	assert.equal(server._verifyClient(req("/")), false, "no token at all");
	assert.equal(
		server._verifyClient({
			req: { url: "/?t=" + token, headers: { host: "leo.local" } },
			origin: "http://evil.example",
		}),
		false,
		"a cross-origin socket is refused even with the right token",
	);
	assert.equal(
		server._verifyClient({
			req: { url: "/?t=" + token, headers: { host: "leo.local" } },
			origin: "http://leo.local",
		}),
		true,
		"the remote's own origin is fine",
	);
});

test("the remote URL carries the token, which is how the QR code works", () => {
	const server = new LEOBroadcastServer(8080);
	const url = server.remoteUrl("192.168.1.5");
	assert.match(url, /^https?:\/\/192\.168\.1\.5:8080\/\?t=/);
	assert.ok(url.endsWith(server.token));
});

test("a message with no data payload is handled, not thrown", () => {
	for (const type of [
		"mouse-move",
		"mouse-scroll",
		"timer-adjust",
		"jump-to",
	]) {
		const seen = drive(type, undefined);
		assert.equal(seen.length, 1, type + " must still emit");
		for (const arg of seen[0].args) {
			assert.ok(Number.isFinite(arg), type + " must emit a real number");
		}
	}
});

test("an unknown message type reaches no window handler either", () => {
	assert.deepEqual(drive("not-a-real-message", { x: 1 }), []);
});
