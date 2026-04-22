const { test } = require("node:test");
const assert = require("node:assert/strict");
const LessonManager = require("../src/renderer/lesson-manager");

test("addBlock with null index appends to end", () => {
	const lm = new LessonManager();
	const idx = lm.addBlock("code", null, "hello");
	assert.equal(idx, 0);
	assert.deepEqual(lm.getBlock(0), { type: "code", text: "hello" });
});

test("addBlock after a specific index inserts at index+1", () => {
	const lm = new LessonManager();
	lm.addBlock("code", null, "a");
	lm.addBlock("code", null, "c");
	lm.addBlock("code", 0, "b");
	assert.equal(lm.getBlock(0).text, "a");
	assert.equal(lm.getBlock(1).text, "b");
	assert.equal(lm.getBlock(2).text, "c");
});

test("addBlock with no initial text defaults to empty string", () => {
	const lm = new LessonManager();
	lm.addBlock("comment");
	assert.equal(lm.getBlock(0).text, "");
});

test("removeBlock removes at index and returns true", () => {
	const lm = new LessonManager();
	lm.addBlock("code", null, "a");
	lm.addBlock("code", null, "b");
	assert.equal(lm.removeBlock(0), true);
	assert.equal(lm.getAllBlocks().length, 1);
	assert.equal(lm.getBlock(0).text, "b");
});

test("removeBlock on out-of-range index returns false", () => {
	const lm = new LessonManager();
	assert.equal(lm.removeBlock(0), false);
	assert.equal(lm.removeBlock(-1), false);
});

test("updateBlock changes text and returns true", () => {
	const lm = new LessonManager();
	lm.addBlock("code", null, "old");
	assert.equal(lm.updateBlock(0, "new"), true);
	assert.equal(lm.getBlock(0).text, "new");
});

test("updateBlock on out-of-range index returns false", () => {
	const lm = new LessonManager();
	assert.equal(lm.updateBlock(5, "x"), false);
});

test("getBlock returns null for out-of-range index", () => {
	const lm = new LessonManager();
	assert.equal(lm.getBlock(0), null);
});

test("markAsChanged flips flag and invokes callback", () => {
	const lm = new LessonManager();
	let called = 0;
	lm.onChange(() => called++);
	lm.markAsChanged();
	assert.equal(lm.hasChanges(), true);
	assert.equal(called, 1);
});

test("addBlock / removeBlock / updateBlock all trigger markAsChanged", () => {
	const lm = new LessonManager();
	let called = 0;
	lm.onChange(() => called++);
	lm.addBlock("code");
	lm.updateBlock(0, "x");
	lm.removeBlock(0);
	assert.equal(called, 3);
});
