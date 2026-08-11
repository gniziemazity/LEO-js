const { test, mock, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const MainProcessTimer = require("../src/main/main-timer");

beforeEach(() => {
	mock.timers.enable({ apis: ["setInterval", "Date"] });
});

afterEach(() => {
	mock.timers.reset();
});

test("start emits a tick with remaining seconds", () => {
	const timer = new MainProcessTimer();
	const ticks = [];
	timer.on("tick", (s) => ticks.push(s));
	timer.start(1);

	assert.equal(ticks.length, 1);
	assert.equal(ticks[0], 60);
	timer.stop(false);
});

test("getRemainingSeconds decreases over time", () => {
	const timer = new MainProcessTimer();
	timer.start(1);
	mock.timers.tick(30_000);
	assert.equal(timer.getRemainingSeconds(), 30);
	timer.stop(false);
});

test("timer auto-stops when time runs out and emits stopped", () => {
	const timer = new MainProcessTimer();
	let stopped = false;
	timer.on("stopped", () => {
		stopped = true;
	});
	timer.start(1);
	mock.timers.tick(61_000);
	assert.equal(stopped, true);
	assert.equal(timer.getRemainingSeconds(), 0);
});

test("adjust extends end time", () => {
	const timer = new MainProcessTimer();
	timer.start(1);
	timer.adjust(1);
	assert.equal(timer.getRemainingSeconds(), 120);
	timer.stop(false);
});

test("adjust with negative beyond remaining stops the timer", () => {
	const timer = new MainProcessTimer();
	let stopped = false;
	timer.on("stopped", () => {
		stopped = true;
	});
	timer.start(1);
	timer.adjust(-5);
	assert.equal(stopped, true);
});

test("stop clears interval so no further ticks fire", () => {
	const timer = new MainProcessTimer();
	const ticks = [];
	timer.on("tick", (s) => ticks.push(s));
	timer.start(1);
	const countAfterStart = ticks.length;
	timer.stop(false);
	mock.timers.tick(5_000);
	assert.equal(ticks.length, countAfterStart);
});

test("adjust on stopped timer is a no-op", () => {
	const timer = new MainProcessTimer();
	timer.adjust(5);
	assert.equal(timer.getRemainingSeconds(), 0);
});
