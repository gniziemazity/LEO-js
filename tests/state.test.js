const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const state = require("../src/main/state");

beforeEach(() => {
	state.reset();
});

test("lock and unlock toggle isLocked", () => {
	state.lock();
	assert.equal(state.isLocked, true);
	state.unlock();
	assert.equal(state.isLocked, false);
});

test("pause and unpause toggle isPaused", () => {
	state.pause();
	assert.equal(state.isPaused, true);
	state.unpause();
	assert.equal(state.isPaused, false);
});

test("startAutoTyping and stopAutoTyping toggle isAutoTyping", () => {
	state.startAutoTyping();
	assert.equal(state.isAutoTyping, true);
	state.stopAutoTyping();
	assert.equal(state.isAutoTyping, false);
});

test("queueAdvance adds to advanceQueue and hasQueuedAdvances reflects it", () => {
	assert.equal(state.hasQueuedAdvances(), false);
	state.queueAdvance("a");
	state.queueAdvance("b");
	assert.equal(state.hasQueuedAdvances(), true);
	assert.equal(state.advanceQueue.length, 2);
});

test("dequeueAdvance returns keys in FIFO order", () => {
	state.queueAdvance("a");
	state.queueAdvance("b");
	assert.equal(state.dequeueAdvance(), "a");
	assert.equal(state.dequeueAdvance(), "b");
	assert.equal(state.hasQueuedAdvances(), false);
});

test("queueChar adds to typeQueue and dequeueChar is FIFO", () => {
	assert.equal(state.hasQueuedChars(), false);
	state.queueChar("x");
	state.queueChar("y");
	assert.equal(state.hasQueuedChars(), true);
	assert.equal(state.typeQueue.length, 2);
	assert.equal(state.dequeueChar(), "x");
	assert.equal(state.dequeueChar(), "y");
	assert.equal(state.hasQueuedChars(), false);
});

test("advance and type queues do not share entries", () => {
	state.queueAdvance("a");
	state.queueChar("x");

	assert.equal(state.advanceQueue.length, 1);
	assert.equal(state.typeQueue.length, 1);
	assert.equal(state.dequeueAdvance(), "a");
	assert.equal(state.hasQueuedAdvances(), false);
	assert.equal(state.hasQueuedChars(), true);
	assert.equal(state.dequeueChar(), "x");
});

test("clearQueue empties both queues", () => {
	state.queueAdvance("a");
	state.queueChar("x");
	state.clearQueue();
	assert.equal(state.hasQueuedAdvances(), false);
	assert.equal(state.hasQueuedChars(), false);
});

test("reset clears flags and queues but preserves mainWindow", () => {
	state.mainWindow = { id: "window" };
	state.lock();
	state.pause();
	state.startAutoTyping();
	state.queueAdvance("a");
	state.queueChar("x");

	state.reset();
	assert.equal(state.isLocked, false);
	assert.equal(state.isPaused, false);
	assert.equal(state.isAutoTyping, false);
	assert.equal(state.hasQueuedAdvances(), false);
	assert.equal(state.hasQueuedChars(), false);
	assert.deepEqual(state.mainWindow, { id: "window" });
});

test("send is a no-op without a live mainWindow", () => {
	state.mainWindow = null;
	assert.equal(state.send("any-channel"), false);

	state.mainWindow = { isDestroyed: () => true, webContents: null };
	assert.equal(state.send("any-channel"), false);
});

test("send forwards channel and args to a live mainWindow", () => {
	const sent = [];
	state.mainWindow = {
		isDestroyed: () => false,
		webContents: { send: (...args) => sent.push(args) },
	};

	assert.equal(state.send("advance-cursor"), true);
	assert.equal(state.send("question-answered", { studentName: "Ann" }), true);
	assert.deepEqual(sent, [
		["advance-cursor"],
		["question-answered", { studentName: "Ann" }],
	]);
});
