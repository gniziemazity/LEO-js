"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC = fs.readFileSync(
	path.resolve(__dirname, "..", "src/shared/remote/connection.js"),
	"utf-8",
);

function loadConnection(opts) {
	const o = opts || {};
	const docListeners = {};
	const timers = [];
	const sockets = [];
	const locks = [];
	const created = [];
	const body = {
		classList: { add() {} },
		appendChild: (el) => created.push(el),
	};

	const wakeLock = {
		request: async () => {
			if (o.failRequest) throw new Error("denied");
			const lock = {
				released: false,
				listeners: {},
				addEventListener: (type, fn) => (lock.listeners[type] = fn),
				release() {
					lock.released = true;
					if (lock.listeners.release) lock.listeners.release();
				},
			};
			locks.push(lock);
			return lock;
		},
	};

	const navigator = o.noWakeLock ? {} : { wakeLock };

	const makeEl = (tag) => {
		const el = {
			tag,
			attrs: {},
			style: {},
			played: 0,
			getContext: () => ({ fillRect() {}, fillStyle: "" }),
			captureStream: () => ({ id: "stream" }),
			setAttribute: (k, v) => (el.attrs[k] = v),
			play() {
				el.played++;
				return Promise.resolve();
			},
		};
		if (tag === "canvas") return el;
		return el;
	};

	const sandbox = {
		module: { exports: {} },
		document: {
			body,
			visibilityState: o.visibility || "visible",
			addEventListener: (type, fn) => (docListeners[type] = fn),
			removeEventListener: (type) => delete docListeners[type],
			createElement: makeEl,
			documentElement: { requestFullscreen: () => Promise.resolve() },
		},
		window: { location: { host: "h:1", protocol: "http:", search: "" } },
		navigator,
		WebSocket: class {
			constructor() {
				this.readyState = 0;
				sockets.push(this);
			}
			close() {}
			send() {}
		},
		location: { search: "" },
		setTimeout: (fn, ms) => {
			timers.push({ fn, ms });
			return timers.length;
		},
		clearTimeout() {},
		setInterval: () => 0,
		clearInterval() {},
		console,
	};
	sandbox.WebSocket.OPEN = 1;

	const exported = SRC + "\n;module.exports={connect,requestWakeLock};";
	new Function(...Object.keys(sandbox), exported)(...Object.values(sandbox));

	return {
		api: sandbox.module.exports,
		docListeners,
		timers,
		sockets,
		locks,
		created,
		sandbox,
		runTimers() {
			const due = timers.splice(0, timers.length);
			for (const t of due) t.fn();
		},
	};
}

test("wake lock is requested when the socket opens", async () => {
	const c = loadConnection();
	c.api.connect();
	await c.sockets[0].onopen();
	assert.equal(c.locks.length, 1);
});

test("a release while visible re-acquires the lock", async () => {
	const c = loadConnection();
	c.api.connect();
	await c.sockets[0].onopen();
	assert.equal(c.locks.length, 1);

	c.locks[0].release();
	assert.equal(c.timers.length, 1, "release should schedule a retry");
	c.runTimers();
	await new Promise((r) => setImmediate(r));
	assert.equal(c.locks.length, 2, "lock should be re-acquired");
});

test("a release while hidden does not retry", async () => {
	const c = loadConnection();
	c.api.connect();
	await c.sockets[0].onopen();

	c.sandbox.document.visibilityState = "hidden";
	c.locks[0].release();
	assert.equal(c.timers.length, 0);
});

test("re-requesting while the lock is held is a no-op", async () => {
	const c = loadConnection();
	c.api.connect();
	await c.sockets[0].onopen();
	await c.api.requestWakeLock();
	await c.api.requestWakeLock();
	assert.equal(c.locks.length, 1);
});

test("pointerdown and fullscreenchange re-arm the lock", async () => {
	const c = loadConnection();
	assert.ok(c.docListeners.pointerdown);
	assert.ok(c.docListeners.fullscreenchange);

	c.docListeners.pointerdown();
	await new Promise((r) => setImmediate(r));
	assert.equal(c.locks.length, 1);
});

test("without the Wake Lock API a keep-alive video is played", async () => {
	const c = loadConnection({ noWakeLock: true });
	c.api.connect();
	await c.sockets[0].onopen();

	assert.equal(c.created.length, 1, "a video element should be appended");
	const video = c.created[0];
	assert.equal(video.tag, "video");
	assert.equal(video.muted, true);
	assert.equal(video.loop, true);
	assert.equal(video.attrs.playsinline, "");
	assert.ok(video.srcObject, "video should carry the canvas stream");
	assert.equal(video.played, 1);
});

test("the keep-alive video is reused and replayed, not duplicated", async () => {
	const c = loadConnection({ noWakeLock: true });
	c.api.connect();
	await c.sockets[0].onopen();
	c.docListeners.pointerdown();
	c.docListeners.pointerdown();
	await new Promise((r) => setImmediate(r));

	assert.equal(c.created.length, 1);
	assert.equal(c.created[0].played, 3);
});

test("a rejected wake-lock request does not leave a stale lock", async () => {
	const c = loadConnection({ failRequest: true });
	c.api.connect();
	await c.sockets[0].onopen();
	assert.equal(c.locks.length, 0);
	await c.api.requestWakeLock();
	assert.equal(c.locks.length, 0);
});
