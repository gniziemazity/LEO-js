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

test("removeBlocks removes at index and returns true", () => {
	const lm = new LessonManager();
	lm.data = [{ type: "include" }];
	lm.addBlock("code", null, "a");
	lm.addBlock("code", null, "b");
	assert.equal(lm.removeBlocks([1]), true);
	assert.equal(lm.getAllBlocks().length, 2);
	assert.equal(lm.getBlock(1).text, "b");
});

test("_migrateBlocks touches only code blocks", () => {
	const blocks = [
		{ type: "go-to", target: "⚓5⚓" },
		{ type: "go-to", target: "MAIN" },
		{ type: "comment", text: "➡️ ⚓app.js⚓" },
	];
	const migrated = LessonManager._migrateBlocks(blocks);
	assert.equal(migrated[0].target, "⚓5⚓");
	assert.equal(migrated[1].target, "MAIN");
	assert.deepEqual(
		migrated[2],
		blocks[2],
		"a comment is passed through whatever it starts with",
	);
});

test("getAllGoToFiles: collects file targets, dedups, ignores anchors/MAIN", () => {
	const lm = new LessonManager();
	lm.addBlock("go-to", null, "a.js");
	lm.addBlock("go-to", null, "b.css");
	lm.addBlock("go-to", null, "a.js");
	lm.addBlock("go-to", null, "⚓7⚓");
	lm.addBlock("go-to", null, "MAIN");
	assert.deepEqual(lm.getAllGoToFiles(), ["a.js", "b.css"]);
});

test("removeBlocks on out-of-range index returns false", () => {
	const lm = new LessonManager();
	lm.data = [{ type: "include" }];
	lm.addBlock("code", null, "a");
	lm.addBlock("code", null, "b");
	assert.equal(lm.removeBlocks([5]), false);
	assert.equal(lm.removeBlocks([-1]), false);
	assert.equal(lm.getAllBlocks().length, 3);
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

test("addBlock / removeBlocks / updateBlock all trigger markAsChanged", () => {
	const lm = new LessonManager();
	lm.data = [{ type: "include" }];
	let called = 0;
	lm.onChange(() => called++);
	lm.addBlock("code");
	lm.addBlock("code");
	lm.updateBlock(1, "x");
	lm.removeBlocks([1]);
	assert.equal(called, 4);
});

test("a code block cannot start or end with a bare newline", () => {
	const lm = new LessonManager();
	lm.addBlock("code", null, "\nfoo\n");
	assert.equal(lm.getBlock(0).text, "↩foo↩");
	lm.updateBlock(0, "\n\nbar");
	assert.equal(lm.getBlock(0).text, "↩↩bar");
});

test("comment blocks keep their newlines - a ↩ there would paste literally", () => {
	const lm = new LessonManager();
	lm.addBlock("comment", null, "\n📋 code\n");
	assert.equal(lm.getBlock(0).text, "\n📋 code\n");
	lm.updateBlock(0, "\nnote\n");
	assert.equal(lm.getBlock(0).text, "\nnote\n");
});

test("loading a plan migrates edge newlines in code blocks", () => {
	const migrated = LessonManager._migrateBlocks([
		{ type: "code", text: "\nconst x = 1;" },
		{ type: "comment", text: "\njust a note\n" },
		{ type: "code", text: "a\nb" },
		{ type: "go-to", target: "⚓3⚓" },
	]);
	assert.deepEqual(migrated, [
		{ type: "code", text: "↩const x = 1;" },
		{ type: "comment", text: "\njust a note\n" },
		{ type: "code", text: "a\nb" },
		{ type: "go-to", target: "⚓3⚓" },
	]);
});
