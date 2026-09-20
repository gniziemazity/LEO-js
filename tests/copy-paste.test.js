"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "src");
const read = (rel) =>
	fs.readFileSync(path.join(SRC, rel), "utf-8").replace(/\r\n/g, "\n");

const LessonManager = require("../src/renderer/lesson-manager");
const BlockEditor = require("../src/renderer/block-editor");
const LessonRenderer = require("../src/renderer/lesson-renderer");

function manager(blocks) {
	const lm = new LessonManager();
	lm.data = [{ type: "include" }, ...blocks].map((b) => ({ ...b }));
	lm.markAsChanged = () => {};
	return lm;
}

function editorFor(lm) {
	const log = [];
	const ui = {
		selected: null,
		getSelectedBlockIndex: () => ui.selected,
		selectBlock: (i) => {
			ui.selected = i;
		},
		setHasCopiedBlock: (has) => log.push(["has-copied", has]),
	};
	const renderer = { render: () => log.push(["render"]) };
	const undo = { saveState: (label) => log.push(["undo", label]) };
	const editor = new BlockEditor(lm, ui, renderer, undo);
	editor.focusNewBlock = () => {};
	return { editor, ui, log };
}

test("pasting with nothing copied does nothing", () => {
	const lm = manager([{ type: "comment", text: "a" }]);
	const { editor, log } = editorFor(lm);
	assert.equal(editor.hasCopiedBlock(), false);
	assert.equal(editor.pasteBlock(1), null);
	assert.deepEqual(log, [], "not even an undo state");
	assert.equal(lm.data.length, 2);
});

test("a copy is independent of the block it came from", () => {
	const lm = manager([{ type: "comment", text: "📋 x", paste: false }]);
	const { editor, log } = editorFor(lm);
	assert.equal(editor.copyBlock(1), true);
	assert.deepEqual(log, [["has-copied", true]]);
	lm.data[1].text = "📋 changed afterwards";
	lm.data[1].paste = true;
	editor.pasteBlock(1);
	assert.equal(lm.data[2].text, "📋 x");
	assert.equal(lm.data[2].paste, false, "options travel with the copy");
});

test("only authored blocks can be copied", () => {
	const lm = manager([
		{
			type: "comment",
			text: "📋 file",
			fromInclude: true,
			startFile: "a.js",
		},
		{ type: "comment", text: "mine" },
	]);
	const { editor } = editorFor(lm);
	assert.equal(editor.copyBlock(0), false, "the Start with slot");
	assert.equal(editor.copyBlock(1), false, "an inherited start file");
	assert.equal(editor.copyBlock(99), false, "out of range");
	assert.equal(editor.copyBlock(2), true);
});

test("a paste lands after the given block, selects it and saves undo first", () => {
	const lm = manager([
		{ type: "comment", text: "first" },
		{ type: "comment", text: "second" },
	]);
	const { editor, ui, log } = editorFor(lm);
	editor.copyBlock(1);
	log.length = 0;
	assert.equal(editor.pasteBlock(1), 2);
	assert.deepEqual(
		lm.data.map((b) => b.text || b.type),
		["include", "first", "first", "second"],
	);
	assert.equal(ui.selected, 2);
	assert.deepEqual(
		log.map((l) => l[0]),
		["undo", "render"],
	);
	assert.equal(
		editor.pasteBlock(3),
		4,
		"and it can be pasted again, elsewhere",
	);
});

test("the clipboard is shared, so a block can move to another lesson", () => {
	const one = editorFor(manager([{ type: "code", text: "x = 1" }]));
	const other = manager([{ type: "comment", text: "there" }]);
	const two = editorFor(other);
	one.editor.copyBlock(1);
	assert.equal(two.editor.hasCopiedBlock(), true);
	two.editor.pasteBlock(1);
	assert.deepEqual(other.data[2], { type: "code", text: "x = 1" });
});

test("a pasted copy gets fresh anchors, never a duplicate id", () => {
	const lm = manager([
		{ type: "code", text: "a⚓0⚓b\nc⚓1⚓" },
		{ type: "move-to", target: "⚓0⚓" },
	]);
	const at = lm.insertBlockCopy(lm.data[1], 2);
	assert.equal(at, 3);
	assert.equal(lm.data[3].text, "a⚓2⚓b\nc⚓3⚓");
	assert.equal(
		lm.data[1].text,
		"a⚓0⚓b\nc⚓1⚓",
		"the original keeps its ids",
	);
	assert.equal(
		lm.data[2].target,
		"⚓0⚓",
		"a move-to still points at the original anchor",
	);
	lm.insertBlockCopy(lm.data[1], 3);
	const ids = lm.data
		.flatMap((b) => (b.text || "").match(/⚓\d+⚓/g) || [])
		.sort();
	assert.equal(new Set(ids).size, ids.length, `no id repeats: ${ids}`);
});

test("start-folder bookkeeping never rides along in a copy", () => {
	const lm = manager([{ type: "comment", text: "x" }]);
	const copy = {
		type: "comment",
		text: "📋 y",
		fromInclude: true,
		startFile: "a",
		startText: "y",
	};
	const at = lm.insertBlockCopy(copy, 1);
	assert.deepEqual(lm.data[at], { type: "comment", text: "📋 y" });
});

test("the paste button exists only while something is copied", () => {
	const css = read("shared/styles.css");
	assert.match(
		css,
		/body:not\(\.has-copied-block\) \.block:hover \.block-tool-paste \{\n\tdisplay: none;/,
		"no re-render on copy: the body class flips it, and its specificity " +
			"outranks the hover reveal",
	);
	const src = read("renderer/lesson-renderer.js");
	assert.match(src, /block-tool-paste block-tool-hover/);
	assert.match(read("renderer/ui-manager.js"), /toggle\("has-copied-block"/);
});

test("while auto-typing, every part of a block is transparent to clicks", () => {
	const css = read("shared/styles.css");
	const rule = /body\.typing-active \.block-kind,[\s\S]*?\{[\s\S]*?\}/.exec(
		css,
	)[0];
	for (const part of [
		".block-kind",
		".block-opt",
		".move-to-select",
		".move-to-note",
		".move-to-new-file-input",
	]) {
		assert.ok(rule.includes(`body.typing-active ${part}`), part);
	}
	assert.match(
		rule,
		/pointer-events: none;/,
		"a disabled control gets no mouse events at all, so the click never " +
			"reached the block and jumping to it did nothing",
	);
});

function sidebarFor(block) {
	const calls = [];
	const lm = manager([block]);
	const renderer = new LessonRenderer(
		lm,
		{
			getSelectedBlockIndex: () => 1,
			setSidebarEnabled: (enabled, format) => calls.push([enabled, format]),
		},
		{},
	);
	renderer._syncSidebar();
	return calls;
}

test("the sidebar keys work in a snippet, but format stays code-only", () => {
	assert.deepEqual(sidebarFor({ type: "code", text: "x" }), [[true, true]]);
	assert.deepEqual(
		sidebarFor({ type: "comment", text: "📋 x" }),
		[[true, false]],
		"format writes ⌫ and ↑► that a 📋 would paste literally",
	);
	assert.deepEqual(sidebarFor({ type: "comment", text: "❓ x" }), [
		[false, false],
	]);
	assert.deepEqual(sidebarFor({ type: "comment", text: "note" }), [
		[false, false],
	]);
	assert.deepEqual(
		sidebarFor({ type: "comment", text: "📋 x", fromInclude: true }),
		[[false, false]],
		"an inherited snippet is context",
	);
});
