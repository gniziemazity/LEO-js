"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const UIManager = require("../src/renderer/ui-manager");
const LessonManager = require("../src/renderer/lesson-manager");
const BlockEditor = require("../src/renderer/block-editor");
const LessonRenderer = require("../src/renderer/lesson-renderer");

const read = (rel) =>
	fs
		.readFileSync(path.join(__dirname, "..", rel), "utf-8")
		.replace(/\r\n/g, "\n");

function manager(blocks) {
	const lm = new LessonManager();
	lm.data = [{ type: "include" }, ...blocks].map((b) => ({ ...b }));
	lm.changes = 0;
	lm.markAsChanged = () => lm.changes++;
	return lm;
}

const texts = (lm) => lm.data.slice(1).map((b) => b.text);
const notes = (...names) => names.map((text) => ({ type: "comment", text }));

function editorFor(lm) {
	const ui = new UIManager();
	ui.refocusBlock = () => {};
	ui.setHasCopiedBlock = () => {};
	const log = [];
	const renderer = { render: () => log.push("render") };
	const undo = { saveState: (label) => log.push(`undo:${label}`) };
	const editor = new BlockEditor(lm, ui, renderer, undo);
	return { editor, ui, log };
}

test("a plain selection is one block, and every way of choosing one collapses", () => {
	const ui = new UIManager();
	assert.deepEqual(ui.getSelectedBlockIndices(), []);
	ui.selectBlock(3);
	assert.deepEqual(ui.getSelectedBlockIndices(), [3]);
	assert.equal(ui.isMultiSelected(), false);
	ui.toggleInSelection(5);
	ui.selectBlock(4);
	assert.deepEqual(ui.getSelectedBlockIndices(), [4]);
	ui.deselectBlock();
	assert.deepEqual(ui.getSelectedBlockIndices(), []);
	assert.equal(ui.getSelectedBlockIndex(), null);
});

test("Ctrl+click adds and removes blocks, and the clicked one becomes the primary", () => {
	const ui = new UIManager();
	ui.selectBlock(3);
	ui.toggleInSelection(7);
	ui.toggleInSelection(5);
	assert.deepEqual(ui.getSelectedBlockIndices(), [3, 5, 7]);
	assert.equal(ui.getSelectedBlockIndex(), 5);
	ui.toggleInSelection(5);
	assert.deepEqual(ui.getSelectedBlockIndices(), [3, 7]);
	assert.equal(
		ui.getSelectedBlockIndex(),
		3,
		"the nearest one above takes over",
	);
	ui.toggleInSelection(3);
	assert.equal(ui.getSelectedBlockIndex(), 7, "or the first below");
	ui.toggleInSelection(7);
	assert.deepEqual(
		ui.getSelectedBlockIndices(),
		[7],
		"the last block cannot be Ctrl+clicked away",
	);
	const fresh = new UIManager();
	fresh.toggleInSelection(4);
	assert.deepEqual(
		fresh.getSelectedBlockIndices(),
		[4],
		"from nothing it selects",
	);
});

test("Shift+click selects the run from the anchor, never into the inherited blocks", () => {
	const ui = new UIManager();
	ui.selectBlock(5);
	ui.selectRange(8, 2);
	assert.deepEqual(ui.getSelectedBlockIndices(), [5, 6, 7, 8]);
	assert.equal(ui.getSelectedBlockIndex(), 8);
	ui.selectRange(3, 2);
	assert.deepEqual(
		ui.getSelectedBlockIndices(),
		[3, 4, 5],
		"the anchor stays where the run started",
	);
	ui.toggleInSelection(9);
	ui.selectRange(7, 2);
	assert.deepEqual(
		ui.getSelectedBlockIndices(),
		[7, 8, 9],
		"Ctrl+click moves the anchor",
	);
	ui.selectBlock(4);
	ui.selectRange(1, 3);
	assert.deepEqual(
		ui.getSelectedBlockIndices(),
		[3, 4],
		"clamped to the floor",
	);
});

test("collapsing keeps only the primary", () => {
	const ui = new UIManager();
	ui.selectBlock(2);
	ui.toggleInSelection(4);
	ui.collapseSelection();
	assert.deepEqual(ui.getSelectedBlockIndices(), [4]);
	assert.equal(ui.isMultiSelected(), false);
});

test("only the primary renders as selected; the others as multi-selected", () => {
	global.document = {
		createElement: () => {
			const classes = new Set();
			return {
				dataset: {},
				set className(v) {
					classes.clear();
					v.split(/\s+/)
						.filter(Boolean)
						.forEach((c) => classes.add(c));
				},
				classList: {
					add: (c) => classes.add(c),
					has: (c) => classes.has(c),
				},
				classes,
			};
		},
	};
	try {
		const ui = new UIManager();
		ui.selectBlock(1);
		ui.toggleInSelection(2);
		const block = { type: "comment", text: "x" };
		const classesOf = (i) => [...ui.createBlockElement(block, i).classes];
		assert.ok(classesOf(2).includes("selected"));
		assert.ok(!classesOf(2).includes("multi-selected"));
		assert.ok(classesOf(1).includes("multi-selected"));
		assert.ok(!classesOf(1).includes("selected"));
		assert.ok(!classesOf(3).some((c) => /selected/.test(c)));
	} finally {
		delete global.document;
	}
	assert.match(
		read("src/shared/styles.css"),
		/\.block\.selected,\n\.block\.multi-selected \{\n\tbackground-color/,
	);
	assert.match(
		read("src/shared/blocks.js"),
		/\.block\.selected,\n\t*\.block\.multi-selected \{\n\t*background-color: \$\{c\.selectedBlockColor\}/,
		"the Settings colour paints every selected block, not just the primary",
	);
});

test("group move shifts every selected block one step, contiguous or not", () => {
	const lm = manager(notes("a", "b", "c", "d", "e"));
	assert.equal(lm.moveBlocks([2, 4], -1), true);
	assert.deepEqual(texts(lm), ["b", "a", "d", "c", "e"]);
	assert.equal(lm.changes, 1, "one change, not one per block");
	assert.equal(lm.moveBlocks([3, 4], 1), true);
	assert.deepEqual(texts(lm), ["b", "a", "e", "d", "c"]);
	assert.equal(lm.moveBlocks([2, 3], -1), true);
	assert.deepEqual(texts(lm), ["a", "e", "b", "d", "c"]);
});

test("a group move is refused as a whole at either edge", () => {
	const lm = manager([
		{ type: "comment", text: "inherited", fromInclude: true },
		...notes("a", "b", "c"),
	]);
	assert.equal(
		lm.canMoveBlocks([2, 4], -1),
		false,
		"a would enter the inherited run",
	);
	assert.equal(lm.canMoveBlocks([2, 4], 1), false, "c would pass the end");
	assert.equal(
		lm.canMoveBlocks([1, 3], 1),
		false,
		"an inherited block never moves",
	);
	assert.equal(lm.canMoveBlocks([], 1), false);
	assert.equal(lm.canMoveBlocks([3, 4], -1), true);
	const before = JSON.stringify(lm.data);
	assert.equal(lm.moveBlocks([2, 4], -1), false);
	assert.equal(JSON.stringify(lm.data), before);
});

test("group delete keeps at least one authored block", () => {
	const lm = manager(notes("a", "b", "c"));
	assert.equal(
		lm.canRemoveBlocks([1, 2, 3]),
		false,
		"that would empty the lesson",
	);
	assert.equal(
		lm.canRemoveBlocks([0, 1]),
		false,
		"Start with is not deletable",
	);
	assert.equal(lm.canRemoveBlocks([1, 3]), true);
	assert.equal(lm.removeBlocks([3, 1, 1]), true);
	assert.deepEqual(texts(lm), ["b"]);
	assert.equal(lm.changes, 1);
	assert.equal(
		lm.canRemoveBlock(1),
		false,
		"the single-block rule is the same rule",
	);
});

test("the editor moves a selection as one undo step and keeps it selected", () => {
	const lm = manager(notes("a", "b", "c", "d"));
	const { editor, ui, log } = editorFor(lm);
	ui.selectBlock(2);
	ui.toggleInSelection(4);
	ui.toggleInSelection(2);
	ui.toggleInSelection(2);
	assert.equal(ui.getSelectedBlockIndex(), 2);
	editor.moveBlocks(ui.getSelectedBlockIndices(), -1);
	assert.deepEqual(texts(lm), ["b", "a", "d", "c"]);
	assert.deepEqual(log, ["undo:move-block", "render"]);
	assert.deepEqual(ui.getSelectedBlockIndices(), [1, 3]);
	assert.equal(
		ui.getSelectedBlockIndex(),
		1,
		"the primary moved with its block",
	);
});

test("the editor deletes a selection as one undo step and selects above it", () => {
	const lm = manager(notes("a", "b", "c", "d"));
	const { editor, ui, log } = editorFor(lm);
	ui.selectBlock(2);
	ui.toggleInSelection(3);
	editor.removeBlocks(ui.getSelectedBlockIndices());
	assert.deepEqual(texts(lm), ["a", "d"]);
	assert.deepEqual(log, ["undo:remove-block", "render"]);
	assert.deepEqual(ui.getSelectedBlockIndices(), [1]);
	log.length = 0;
	editor.removeBlocks([1, 2]);
	assert.deepEqual(log, [], "a refused delete saves no undo state");
});

test("copying a selection pastes all of it, in order, with fresh anchors, selected", () => {
	const lm = manager([
		{ type: "code", text: "x⚓0⚓" },
		{ type: "comment", text: "note" },
		{ type: "code", text: "y⚓1⚓" },
		{ type: "comment", text: "end" },
	]);
	const { editor, ui, log } = editorFor(lm);
	assert.equal(editor.copyBlocks([1, 3]), true);
	assert.equal(editor.pasteBlock(4), 5);
	assert.deepEqual(texts(lm), [
		"x⚓0⚓",
		"note",
		"y⚓1⚓",
		"end",
		"x⚓2⚓",
		"y⚓3⚓",
	]);
	assert.deepEqual(log, ["undo:paste-block", "render"]);
	assert.deepEqual(ui.getSelectedBlockIndices(), [5, 6]);
	assert.equal(ui.getSelectedBlockIndex(), 5);
	assert.equal(
		editor.copyBlocks([1, 0]),
		false,
		"a selection holding an uncopyable block copies nothing",
	);
	editor.pasteBlock(1);
	assert.equal(
		lm.data[2].text,
		"x⚓4⚓",
		"the clipboard kept the earlier copy",
	);
});

function chipsFor(lm, ui, blockIdx) {
	const calls = [];
	const renderer = new LessonRenderer(lm, ui, {});
	renderer.blockEditor = new Proxy(
		{},
		{
			get:
				(_, name) =>
				(...args) =>
					calls.push([name, ...args]),
		},
	);
	const tools = renderer._blockTools(lm.data[blockIdx], blockIdx, false);
	const up = renderer
		._addRow(lm.data[blockIdx], blockIdx, false, "above")
		.at(-1);
	return { tools, up, calls };
}

test("a chip on a selected block acts on the whole selection", () => {
	const lm = manager(notes("a", "b", "c", "d"));
	const ui = new UIManager();
	ui.selectBlock(2);
	ui.toggleInSelection(4);
	const { tools, up, calls } = chipsFor(lm, ui, 2);
	const [copy, del] = tools;
	assert.equal(copy.title, "Copy 2 selected blocks (Ctrl+Shift+C)");
	assert.equal(del.title, "Delete 2 selected blocks (Ctrl+D)");
	assert.equal(up.title, "Move 2 selected blocks up (Ctrl+Shift+Up)");
	copy.onClick();
	del.onClick();
	up.onClick();
	assert.deepEqual(calls, [
		["copyBlocks", [2, 4]],
		["removeBlocks", [2, 4]],
		["moveBlocks", [2, 4], -1],
	]);
});

test("a chip on a block outside the selection acts on that block alone", () => {
	const lm = manager(notes("a", "b", "c", "d"));
	const ui = new UIManager();
	ui.selectBlock(2);
	ui.toggleInSelection(4);
	const { tools, up, calls } = chipsFor(lm, ui, 3);
	assert.equal(tools[1].title, "Delete this block (Ctrl+D)");
	assert.equal(up.title, "Move this block up (Ctrl+Shift+Up)");
	tools[1].onClick();
	assert.deepEqual(calls, [["removeBlocks", [3]]]);
});

test("the move chip says the shortcut that moves, not the one that navigates", () => {
	const lm = manager(notes("a", "b"));
	const ui = new UIManager();
	const renderer = new LessonRenderer(lm, ui, {});
	const [above, below] = ["above", "below"].map((w) =>
		renderer._addRow(lm.data[1], 1, false, w).at(-1),
	);
	assert.equal(above.title, "Move this block up (Ctrl+Shift+Up)");
	assert.equal(below.title, "Move this block down (Ctrl+Shift+Down)");
	assert.equal(above.disabled, true, "the first authored block cannot go up");
});

test("a modified click extends the selection instead of moving the caret", () => {
	const src = read("src/renderer/lesson-renderer.js");
	const body = /_extendSelection\(e, blockIdx\) \{[\s\S]*?\n\t\}/.exec(src)[0];
	assert.match(
		body,
		/e\.preventDefault\(\);/,
		"no text selection across blocks",
	);
	assert.match(
		body,
		/if \(!toggle && primary === blockIdx\) return false;/,
		"Shift+click inside the block being edited still extends the text",
	);
	assert.match(
		body,
		/this\.render\(\);\s*ui\.refocusBlock\(ui\.getSelectedBlockIndex\(\)\);/,
		"the primary keeps the caret, so the simulator keeps following it",
	);
	assert.match(
		src,
		/_handleClickWhileEditing\(e, block, blockIdx\) \{\n\t\tif \(this\._extendSelection\(e, blockIdx\)\) return;\n\n\t\tif \(this\.uiManager\.isMultiSelected\(\)\) \{\n\t\t\tthis\.uiManager\.selectBlock\(blockIdx\);/,
		"a plain click on a multi-selection collapses it with a full re-render",
	);
});
