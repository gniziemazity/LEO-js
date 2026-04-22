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

test("queueKey adds to lockQueue and hasQueuedKeys reflects it", () => {
	assert.equal(state.hasQueuedKeys(), false);
	state.queueKey("a");
	state.queueKey("b");
	assert.equal(state.hasQueuedKeys(), true);
	assert.equal(state.lockQueue.length, 2);
});

test("dequeueKey returns keys in FIFO order", () => {
	state.queueKey("a");
	state.queueKey("b");
	assert.equal(state.dequeueKey(), "a");
	assert.equal(state.dequeueKey(), "b");
	assert.equal(state.hasQueuedKeys(), false);
});

test("clearQueue removes all queued keys", () => {
	state.queueKey("a");
	state.queueKey("b");
	state.clearQueue();
	assert.equal(state.hasQueuedKeys(), false);
});

test("reset clears flags and queue but preserves mainWindow", () => {
	state.mainWindow = { id: "window" };
	state.lock();
	state.pause();
	state.startAutoTyping();
	state.queueKey("a");

	state.reset();
	assert.equal(state.isLocked, false);
	assert.equal(state.isPaused, false);
	assert.equal(state.isAutoTyping, false);
	assert.equal(state.hasQueuedKeys(), false);
	assert.deepEqual(state.mainWindow, { id: "window" });
});
