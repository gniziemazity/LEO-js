const { test } = require("node:test");
const assert = require("node:assert/strict");
const UndoManager = require("../src/renderer/undo-manager");

function makeManager() {
	const lessonManager = {
		data: [{ type: "code", text: "v1" }],
		getAllBlocks() {
			return this.data;
		},
		markAsChanged() {},
	};
	return { lessonManager, undo: new UndoManager(lessonManager) };
}

test("saveState + undo restores previous snapshot", () => {
	const { lessonManager, undo } = makeManager();
	undo.saveState("edit");
	lessonManager.data = [{ type: "code", text: "v2" }];

	assert.equal(undo.undo(), true);
	assert.equal(lessonManager.data[0].text, "v1");
});

test("redo reapplies undone change", () => {
	const { lessonManager, undo } = makeManager();
	undo.saveState("edit");
	lessonManager.data = [{ type: "code", text: "v2" }];
	undo.undo();

	assert.equal(undo.redo(), true);
	assert.equal(lessonManager.data[0].text, "v2");
});

test("saveState clears redo stack", () => {
	const { lessonManager, undo } = makeManager();
	undo.saveState("a");
	lessonManager.data = [{ type: "code", text: "v2" }];
	undo.undo();
	undo.saveState("b");

	assert.equal(undo.redo(), false);
});

test("undo on empty stack returns false", () => {
	const { undo } = makeManager();
	assert.equal(undo.undo(), false);
});

test("redo on empty stack returns false", () => {
	const { undo } = makeManager();
	assert.equal(undo.redo(), false);
});

test("clear empties both stacks", () => {
	const { lessonManager, undo } = makeManager();
	undo.saveState("edit");
	lessonManager.data = [{ type: "code", text: "v2" }];
	undo.undo();

	undo.clear();
	assert.equal(undo.undo(), false);
	assert.equal(undo.redo(), false);
});

test("undoStack is capped at maxStackSize", () => {
	const { lessonManager, undo } = makeManager();
	undo.maxStackSize = 3;
	for (let i = 0; i < 10; i++) {
		lessonManager.data = [{ type: "code", text: `v${i}` }];
		undo.saveState(`edit-${i}`);
	}
	assert.equal(undo.undoStack.length, 3);
});

test("saveState snapshot is decoupled from later mutations", () => {
	const { lessonManager, undo } = makeManager();
	undo.saveState("edit");
	lessonManager.data[0].text = "mutated";
	undo.undo();
	assert.equal(lessonManager.data[0].text, "v1");
});
