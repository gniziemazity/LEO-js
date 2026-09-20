"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const LessonRenderer = require("../src/renderer/lesson-renderer");

const INHERITED = {
	type: "comment",
	text: "📋 <!DOCTYPE html>\n<html>\n</html>",
	fromInclude: true,
};
const START_FILE = {
	type: "comment",
	text: "📋 <!DOCTYPE html>\n<html>\n</html>",
	fromInclude: true,
	startFile: "index.html",
	startText: "<!DOCTYPE html>\n<html>\n</html>",
};
const AUTHORED = {
	type: "comment",
	text: "📋 const a = 1;\nconst b = 2;",
};

function fakeBlockDiv() {
	const classes = new Set();
	return {
		className: "",
		dataset: {},
		classList: {
			add: (c) => classes.add(c),
			remove: (...cs) => cs.forEach((c) => classes.delete(c)),
			contains: (c) => classes.has(c),
		},
	};
}

function makeRenderer({ blocks, selected = null, typing = false }) {
	const calls = { selected: [], renders: 0, appended: [], islands: [] };
	const renderer = new LessonRenderer(
		{
			getAllBlocks: () => blocks,
			canMoveBlock: () => true,
			canRemoveBlock: () => true,
		},
		{
			isActive: () => typing,
			getSelectedBlockIndex: () => selected,
			selectBlock: (i) => calls.selected.push(i),
			setSidebarEnabled: () => {},
			attachKindPicker: () => {},
			attachBlockIsland: (el, island) => {
				calls.islands.push(island);
				if (island.option) calls.appended.push(island.option);
			},
		},
		{},
	);
	renderer.render = () => {
		calls.renders++;
	};
	return { renderer, calls };
}

function renderComment(renderer, blocks, blockIdx, typing = false) {
	const blockDiv = fakeBlockDiv();
	renderer.renderKindBlock({
		blockDiv,
		block: blocks[blockIdx],
		blockIdx,
		isTypingActive: typing,
		stepIndex: 0,
		steps: [],
	});
	return blockDiv;
}

test("an inherited paste starts collapsed to its first line", () => {
	const blocks = [INHERITED];
	const { renderer } = makeRenderer({ blocks });
	const div = renderComment(renderer, blocks, 0);
	assert.equal(div.classList.contains("collapsed"), true);
	assert.equal(div.textContent, "📋 <!DOCTYPE html>...");
	assert.equal(div.dataset.fullText, INHERITED.text);
	assert.equal(div.title, undefined, "no native tooltip on a collapsed paste");
});

test("clicking an inherited paste expands it without selecting it", () => {
	const blocks = [INHERITED];
	const { renderer, calls } = makeRenderer({ blocks });

	renderer.handleBlockClick({}, blocks[0], 0);

	assert.deepEqual(calls.selected, []);
	assert.equal(calls.renders, 1);
	assert.equal(renderer.expandedIncludes.has(0), true);

	const div = renderComment(renderer, blocks, 0);
	assert.equal(div.classList.contains("collapsed"), false);
	assert.equal(div.textContent, INHERITED.text);
});

test("an expanded inherited paste is still read-only", () => {
	const blocks = [INHERITED];
	const { renderer } = makeRenderer({ blocks });
	renderer.toggleIncludeExpanded(0);
	const div = renderComment(renderer, blocks, 0);
	assert.equal(div.contentEditable, false);
});

test("clicking an expanded inherited paste collapses it again", () => {
	const blocks = [INHERITED];
	const { renderer } = makeRenderer({ blocks });

	renderer.handleBlockClick({}, blocks[0], 0);
	renderer.handleBlockClick({}, blocks[0], 0);

	assert.equal(renderer.expandedIncludes.has(0), false);
	assert.equal(
		renderComment(renderer, blocks, 0).classList.contains("collapsed"),
		true,
	);
});

test("selecting a block never expands an inherited one", () => {
	const blocks = [INHERITED];
	const { renderer } = makeRenderer({ blocks, selected: 0 });
	assert.equal(
		renderComment(renderer, blocks, 0).classList.contains("collapsed"),
		true,
	);
});

test("an authored paste still expands by selection, not by the include set", () => {
	const blocks = [AUTHORED];
	const collapsed = makeRenderer({ blocks });
	assert.equal(
		renderComment(collapsed.renderer, blocks, 0).classList.contains(
			"collapsed",
		),
		true,
	);

	const open = makeRenderer({ blocks, selected: 0 });
	const div = renderComment(open.renderer, blocks, 0);
	assert.equal(div.classList.contains("collapsed"), false);
	assert.equal(div.contentEditable, true);
});

test("a click while typing neither expands nor selects", () => {
	const blocks = [INHERITED];
	const { renderer, calls } = makeRenderer({ blocks, typing: true });

	renderer.handleBlockClick({}, blocks[0], 0);

	assert.equal(renderer.expandedIncludes.size, 0);
	assert.equal(calls.renders, 0);
	assert.deepEqual(calls.selected, []);
});

test("an expanded inherited paste stays collapsed once typing starts", () => {
	const blocks = [INHERITED];
	const { renderer } = makeRenderer({ blocks });
	renderer.toggleIncludeExpanded(0);
	assert.equal(
		renderComment(renderer, blocks, 0, true).classList.contains("collapsed"),
		true,
	);
});

test("dragging the scrollbar of an expanded paste does not fold it shut", () => {
	const blocks = [INHERITED];
	const { renderer, calls } = makeRenderer({ blocks });
	renderer.toggleIncludeExpanded(0);

	renderer.handleBlockClick(
		{ currentTarget: { clientWidth: 300 }, offsetX: 308 },
		blocks[0],
		0,
	);
	assert.equal(renderer.expandedIncludes.has(0), true);

	renderer.handleBlockClick(
		{ currentTarget: { clientWidth: 300 }, offsetX: 120 },
		blocks[0],
		0,
	);
	assert.equal(renderer.expandedIncludes.has(0), false);
	assert.deepEqual(calls.selected, []);
});

test("an open start file is editable, so anchors can be placed in it", () => {
	const blocks = [START_FILE];
	const { renderer } = makeRenderer({ blocks });
	renderer.toggleIncludeExpanded(0);
	const div = renderComment(renderer, blocks, 0);
	assert.equal(div.contentEditable, true);
	assert.equal(div.classList.contains("start-file"), true);
	assert.equal(
		renderComment(renderer, blocks, 0, true).contentEditable,
		"false",
		"but never while typing: it is rendered collapsed and inert then",
	);
});

test("a click inside an open start file leaves it open, for the caret", () => {
	const blocks = [START_FILE];
	const { renderer, calls } = makeRenderer({ blocks });

	renderer.handleBlockClick({}, blocks[0], 0);
	assert.equal(renderer.expandedIncludes.has(0), true, "the first opens it");
	renderer.handleBlockClick({}, blocks[0], 0);
	assert.equal(
		renderer.expandedIncludes.has(0),
		true,
		"a second click places the caret instead of folding it shut",
	);
	assert.deepEqual(calls.selected, [], "and it is still never selected");
});

test("the ▴ chip on an open start file is what folds it", () => {
	const blocks = [START_FILE];
	const { renderer, calls } = makeRenderer({ blocks });
	renderer.toggleIncludeExpanded(0);
	renderComment(renderer, blocks, 0);
	const fold = calls.islands.find((i) => i.className === "block-opt-fold");
	assert.ok(fold, "an open start file carries a fold chip");
	assert.deepEqual(
		fold.tools.map((t) => t.glyph),
		["▴"],
	);
	fold.tools[0].onClick();
	assert.equal(renderer.expandedIncludes.has(0), false);

	calls.islands.length = 0;
	renderComment(renderer, blocks, 0);
	assert.equal(
		calls.islands.some((i) => i.className === "block-opt-fold"),
		false,
		"a folded one needs none: a click opens it",
	);
});

test("the include row itself is never expandable", () => {
	const blocks = [{ type: "include", path: "./part_1.leo" }];
	const { renderer, calls } = makeRenderer({ blocks });

	renderer.handleBlockClick({}, blocks[0], 0);

	assert.equal(renderer.expandedIncludes.size, 0);
	assert.equal(calls.renders, 0);
});
