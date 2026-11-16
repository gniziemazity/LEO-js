"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const LessonRenderer = require("../src/renderer/lesson-renderer");
const UndoManager = require("../src/renderer/undo-manager");

function editor(text = "abc") {
	const lessonManager = {
		data: [{ type: "code", text }],
		getAllBlocks() {
			return this.data;
		},
		markAsChanged() {},
	};
	const undoManager = new UndoManager(lessonManager);
	const renderer = new LessonRenderer({}, {}, {}, undoManager);
	return { lessonManager, undoManager, renderer };
}

function type(e, blockIdx, chars) {
	for (const ch of chars) {
		e.renderer.saveEditState(blockIdx);
		e.lessonManager.data[blockIdx].text += ch;
	}
}

test("the first Ctrl+Z after a typing run actually undoes it", () => {
	const e = editor("abc");

	type(e, 0, "def");
	assert.equal(e.lessonManager.data[0].text, "abcdef");

	assert.equal(e.undoManager.undo(), true);
	assert.equal(
		e.lessonManager.data[0].text,
		"abc",
		"the first press was wasted on a snapshot equal to the current state",
	);
});

test("an undo press is never a no-op, even after the editor goes idle", async () => {
	const e = editor("abc");
	type(e, 0, "def");

	await new Promise((resolve) => setTimeout(resolve, 1200));

	const before = e.lessonManager.data[0].text;
	assert.equal(e.undoManager.undo(), true);
	assert.notEqual(
		e.lessonManager.data[0].text,
		before,
		"a snapshot equal to the current state was pushed after the run, " +
			"so the first Ctrl+Z does nothing",
	);
	assert.equal(e.lessonManager.data[0].text, "abc");
});

test("a typing run in one block is a single undo step", () => {
	const e = editor("abc");
	type(e, 0, "defghij");
	assert.equal(
		e.undoManager.undoStack.length,
		1,
		"a run should not be split into one step per keystroke",
	);
});

test("an idle gap starts a new undo step", () => {
	const e = editor("abc");

	type(e, 0, "de");
	e.renderer.lastEditTime -= 5000;
	type(e, 0, "fg");

	assert.equal(e.undoManager.undoStack.length, 2);

	e.undoManager.undo();
	assert.equal(
		e.lessonManager.data[0].text,
		"abcde",
		"the second run should undo back to the end of the first",
	);
	e.undoManager.undo();
	assert.equal(e.lessonManager.data[0].text, "abc");
});

test("moving to another block starts a new undo step", () => {
	const lessonManager = {
		data: [
			{ type: "code", text: "a" },
			{ type: "code", text: "b" },
		],
		getAllBlocks() {
			return this.data;
		},
		markAsChanged() {},
	};
	const undoManager = new UndoManager(lessonManager);
	const renderer = new LessonRenderer({}, {}, {}, undoManager);

	renderer.saveEditState(0);
	lessonManager.data[0].text = "aa";
	renderer.saveEditState(1);
	lessonManager.data[1].text = "bb";

	assert.equal(undoManager.undoStack.length, 2);
	undoManager.undo();
	assert.equal(lessonManager.data[1].text, "b");
	assert.equal(lessonManager.data[0].text, "aa", "it undid the wrong block");
});

test("snapshots keep nested anchor maps independent", () => {
	const lessonManager = {
		data: [{ type: "include", anchors: { "a.js": { 1: [2, 3] } } }],
		getAllBlocks() {
			return this.data;
		},
		markAsChanged() {},
	};
	const undoManager = new UndoManager(lessonManager);

	undoManager.saveState("edit");
	lessonManager.data[0].anchors["a.js"][1] = [99, 99];
	undoManager.undo();

	assert.deepEqual(
		lessonManager.data[0].anchors["a.js"][1],
		[2, 3],
		"the snapshot shared its anchor map with the live plan",
	);
});
