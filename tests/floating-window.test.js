const { test } = require("node:test");
const assert = require("node:assert/strict");
const FloatingWindow = require("../src/main/floating-window");

function makeFakeWin() {
	const listeners = {};
	const win = {
		destroyed: false,
		closeCalls: 0,
		sent: [],
		on(ev, fn) {
			(listeners[ev] = listeners[ev] || []).push(fn);
		},
		isDestroyed: () => win.destroyed,
		show() {},
		focus() {},
		webContents: {
			on() {},
			send(...args) {
				win.sent.push(args);
			},
		},
		close() {
			win.closeCalls++;
		},
		emitClosed() {
			win.destroyed = true;
			(listeners.closed || []).forEach((fn) => fn());
		},
	};
	return win;
}

function makeHarness({ onClosed } = {}) {
	const wins = [];
	const events = { opened: 0, closed: 0 };
	const synced = [];
	const float = new FloatingWindow({
		make: () => {
			const win = makeFakeWin();
			wins.push(win);
			return win;
		},
		channel: "set-payload",
		sync: (self) => synced.push(self.activeWin),
		onClosed: onClosed || (() => {}),
		broadcastServer: {
			broadcastFloatingWindowReshown: () => events.opened++,
			broadcastFloatingWindowClosed: () => events.closed++,
		},
		floatRect: () => ({ x: 0, y: 0, w: 100, h: 100 }),
		trackWindowRect: () => {},
	});
	return { float, wins, events, synced };
}

test("close marks the window not alive before closed fires", () => {
	const { float, wins } = makeHarness();
	float.showOrReuse({}, {});
	assert.equal(float.isAlive(), true);

	float.close({ force: true });
	assert.equal(wins[0].closeCalls, 1);
	assert.equal(float.isAlive(), false);
	assert.equal(float.activeWin, null);
});

test("a window created before the late closed event is not clobbered", () => {
	const { float, wins } = makeHarness();
	float.showOrReuse({}, {});
	float.close({ force: true });
	float.showOrReuse({}, {});

	assert.equal(wins.length, 2);
	assert.equal(float.win, wins[1]);
	assert.equal(float.isAlive(), true);

	wins[0].emitClosed();

	assert.equal(float.win, wins[1]);
	assert.equal(float.isAlive(), true);
	assert.notEqual(float.rect, null);
});

test("the superseded window still decrements the floating window count", () => {
	const { float, wins, events } = makeHarness();
	float.showOrReuse({}, {});
	float.close({ force: true });
	float.showOrReuse({}, {});
	wins[0].emitClosed();

	assert.equal(events.closed, 1);
});

test("onClosed does not fire for a superseded window", () => {
	let calls = 0;
	const { float, wins } = makeHarness({ onClosed: () => calls++ });
	float.showOrReuse({}, {});
	float.close({ force: true });
	float.showOrReuse({}, {});
	wins[0].emitClosed();
	assert.equal(calls, 0);

	float.close({ force: true });
	wins[1].emitClosed();
	assert.equal(calls, 1);
});

test("closed on the current window clears state and resyncs to null", () => {
	const { float, wins, synced } = makeHarness();
	float.showOrReuse({}, {});
	float.close({ force: true });
	wins[0].emitClosed();

	assert.equal(float.win, null);
	assert.equal(float.rect, null);
	assert.equal(float.isAlive(), false);
	assert.equal(synced[synced.length - 1], null);
});

test("a pinned window defers close until unpinned", () => {
	const { float, wins } = makeHarness();
	float.showOrReuse({}, { gatePin: true, shouldPin: true });
	assert.equal(float.pinned, true);

	float.close();
	assert.equal(wins[0].closeCalls, 0);
	assert.equal(float.closePending, true);
	assert.equal(float.isAlive(), true);

	float.setPinned(false);
	assert.equal(wins[0].closeCalls, 1);
	assert.equal(float.isAlive(), false);
});

test("showOrReuse reuses a live window instead of making a new one", () => {
	const { float, wins, events } = makeHarness();
	float.showOrReuse({ n: 1 }, {});
	float.showOrReuse({ n: 2 }, {});

	assert.equal(wins.length, 1);
	assert.equal(events.opened, 1);
	assert.deepEqual(wins[0].sent, [["set-payload", { n: 2 }]]);
});
