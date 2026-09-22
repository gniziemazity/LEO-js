"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CONNECTION = path.resolve(
	__dirname,
	"..",
	"..",
	"src/shared/remote/connection.js",
);

const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

function build(opts = {}) {
	const sockets = [];
	const listeners = new Map();
	const timers = [];
	let now = 0;
	let nextTimerId = 1;

	class FakeWebSocket {
		constructor(url) {
			this.url = url;
			this.readyState = CONNECTING;
			this.sent = [];
			this.onopen = null;
			this.onmessage = null;
			this.onclose = null;
			this.onerror = null;
			this.closeCalls = 0;
			sockets.push(this);
		}
		send(data) {
			this.sent.push(data);
		}
		close() {
			this.closeCalls++;
			if (this.readyState === CLOSED) return;
			this.readyState = CLOSED;
			if (this.onclose) this.onclose({});
		}
		open() {
			this.readyState = OPEN;
			if (this.onopen) this.onopen({});
		}
		drop() {
			this.readyState = CLOSED;
			if (this.onclose) this.onclose({});
		}
		fail() {
			if (this.onerror) this.onerror({});
		}
		deliver(payload) {
			if (this.onmessage) this.onmessage({ data: JSON.stringify(payload) });
		}
	}
	FakeWebSocket.CONNECTING = CONNECTING;
	FakeWebSocket.OPEN = OPEN;
	FakeWebSocket.CLOSING = CLOSING;
	FakeWebSocket.CLOSED = CLOSED;

	const document = {
		visibilityState: opts.visibilityState || "visible",
		fullscreenElement: null,
		webkitFullscreenElement: null,
		documentElement: { requestFullscreen: null },
		body: { appendChild() {} },
		createElement: () => ({
			style: {},
			setAttribute() {},
			getContext: () => null,
			captureStream: null,
			play: () => ({ catch() {} }),
		}),
		addEventListener(name, fn) {
			if (!listeners.has(name)) listeners.set(name, []);
			listeners.get(name).push(fn);
		},
	};

	const sandbox = {
		module: { exports: {} },
		document,
		window: {
			location: {
				host: "192.168.1.5:8080",
				protocol: "http:",
				search: "?t=token",
			},
			screen: {},
			addEventListener() {},
		},
		navigator: {},
		WebSocket: FakeWebSocket,
		setTimeout: (fn, ms) => {
			const id = nextTimerId++;
			timers.push({ id, fn, at: now + (ms || 0) });
			return id;
		},
		clearTimeout: (id) => {
			const i = timers.findIndex((t) => t.id === id);
			if (i >= 0) timers.splice(i, 1);
		},
		setInterval: () => 0,
		clearInterval() {},
		console: { log() {}, warn() {}, error() {} },
	};

	const src =
		fs.readFileSync(CONNECTION, "utf-8") +
		"\n;module.exports={connect,sendMessage,setMessageHandler," +
		"setConnectionHandler,currentSocket:()=>ws};";

	new Function(...Object.keys(sandbox), src)(...Object.values(sandbox));

	return {
		api: sandbox.module.exports,
		sockets,
		fire(name, ev) {
			for (const fn of listeners.get(name) || []) fn(ev || {});
		},
		advance(ms) {
			now += ms;
			const due = timers.filter((t) => t.at <= now);
			for (const t of due) {
				const i = timers.indexOf(t);
				if (i >= 0) timers.splice(i, 1);
				t.fn();
			}
			return due.length;
		},
		pendingTimers: () => timers.length,
		document,
	};
}

module.exports = { buildConnection: build };
