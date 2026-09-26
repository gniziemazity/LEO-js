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
	const calls = {
		selected: [],
		renders: 0,
		appended: [],
		islands: [],
		startCollapsed: [],
		sidebar: [],
	};
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
			setSidebarEnabled: (enabled) => calls.sidebar.push(enabled),
			setStartCollapsed: (c) => calls.startCollapsed.push(c),
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

test("the ▾ on the left of an open start file is what folds it", () => {
	const blocks = [START_FILE];
	const { renderer, calls } = makeRenderer({ blocks });
	renderer._onFoldArrow = (e) => e.onArrow === true;
	renderer.toggleIncludeExpanded(0);

	renderer.handleBlockClick({ onArrow: false }, blocks[0], 0);
	assert.equal(
		renderer.expandedIncludes.has(0),
		true,
		"the text takes the caret",
	);

	renderer.handleBlockClick({ onArrow: true }, blocks[0], 0);
	assert.equal(renderer.expandedIncludes.has(0), false, "the arrow folds it");
	assert.deepEqual(calls.selected, []);

	renderComment(renderer, blocks, 0);
	renderer.toggleIncludeExpanded(0);
	renderComment(renderer, blocks, 0);
	assert.equal(
		calls.islands.some((i) => (i.tools || []).some((t) => t.glyph === "▴")),
		false,
		"no fold chip in the top-right corner any more",
	);
});

test("an arrow click while typing folds nothing", () => {
	const blocks = [START_FILE];
	const { renderer } = makeRenderer({ blocks, typing: true });
	renderer._onFoldArrow = () => true;
	renderer.expandedIncludes.add(0);
	renderer.handleBlockClick({}, blocks[0], 0);
	assert.equal(renderer.expandedIncludes.has(0), true);
});

test("the ▾ of an open start file shows it can be clicked", () => {
	const css = require("node:fs")
		.readFileSync(
			require("node:path").join(__dirname, "..", "src/shared/styles.css"),
			"utf8",
		)
		.replace(/\r\n/g, "\n");
	assert.match(
		css,
		/\n\.block\.from-include\.start-file:not\(\.collapsed\)::before \{\n\tcursor: pointer;/,
	);
	assert.equal(/block-opt-fold/.test(css), false);
});

test("the include row itself is never expandable", () => {
	const blocks = [{ type: "include", path: "./part_1.leo" }];
	const { renderer, calls } = makeRenderer({ blocks });

	renderer.handleBlockClick({}, blocks[0], 0);

	assert.equal(renderer.expandedIncludes.size, 0);
	assert.equal(calls.renders, 0);
	assert.deepEqual(
		calls.startCollapsed,
		[],
		"no start folder, nothing to fold",
	);
});

const SLOT = { type: "include", dir: "server_2_start", files: 9 };

function renderSlot(renderer, block) {
	const blockDiv = { ...fakeBlockDiv(), style: {} };
	const next = renderer.renderIncludeBlock({ blockDiv, block, stepIndex: 4 });
	return { blockDiv, next };
}

test("the start row reads Starting Code (N files) and takes no step", () => {
	const { renderer } = makeRenderer({ blocks: [SLOT] });
	const { blockDiv, next } = renderSlot(renderer, SLOT);
	assert.equal(blockDiv.textContent, "Starting Code (9 files)");
	assert.equal(blockDiv.classList.contains("include-block"), true);
	assert.match(blockDiv.title, /server_2_start\//, "the folder is on hover");
	assert.match(blockDiv.title, /⚓ anchors/, "and so is the anchor hint");
	assert.equal(next, 4);

	const one = renderSlot(renderer, { ...SLOT, files: 1 }).blockDiv;
	assert.equal(one.textContent, "Starting Code (1 file)");

	const none = renderSlot(renderer, { type: "include", anchors: {} }).blockDiv;
	assert.equal(none.style.display, "none", "no start folder, no row");
});

test("the Starting Code section is folded until its row is clicked", () => {
	const blocks = [SLOT, START_FILE];
	const { renderer, calls } = makeRenderer({ blocks });
	assert.equal(renderer.startCollapsed, true, "folded by default");

	renderer.handleBlockClick({}, blocks[0], 0);
	assert.equal(renderer.startCollapsed, false);
	renderer.handleBlockClick({}, blocks[0], 0);
	assert.equal(renderer.startCollapsed, true);
	assert.deepEqual(calls.startCollapsed, [false, true]);
	assert.equal(
		calls.renders,
		0,
		"folding is a class on the container: the inherited blocks stay in " +
			"the DOM, so a .block index is still a data index",
	);
	assert.deepEqual(calls.selected, [], "and the row is never selected");
});

test("the section folds while typing too, since nothing is re-rendered", () => {
	const blocks = [SLOT];
	const { renderer, calls } = makeRenderer({ blocks, typing: true });
	renderer.handleBlockClick({}, blocks[0], 0);
	assert.equal(renderer.startCollapsed, false);
	assert.deepEqual(calls.startCollapsed, [false]);
	assert.equal(calls.renders, 0);
});

test("folding the section hides an open start file from the ⚓ keys", () => {
	const blocks = [SLOT, START_FILE];
	const { renderer, calls } = makeRenderer({ blocks });
	renderer.handleBlockClick({}, blocks[0], 0);
	renderer.expandedIncludes.add(1);
	renderer.handleBlockClick({}, blocks[0], 0);
	assert.equal(calls.sidebar.at(-1), false);
	renderer.handleBlockClick({}, blocks[0], 0);
	assert.equal(
		calls.sidebar.at(-1),
		true,
		"showing the section again shows the file still open",
	);
});

test("inherited blocks are hidden by the section, on both surfaces", () => {
	const fs = require("node:fs");
	const path = require("node:path");
	const src = (p) =>
		fs
			.readFileSync(path.join(__dirname, "..", "src", p), "utf8")
			.replace(/\r\n/g, "\n");
	const css = src("shared/styles.css");
	assert.match(
		css,
		/\n\.start-collapsed \.block\.from-include \{\n\tdisplay: none;\n\}/,
	);
	assert.match(
		css,
		/\nbody:not\(\.mobile-view\) \.start-collapsed \.include-block::before \{\n\tcontent: "▸ ";/,
		"the ▸ / ▾ is the editor's; the phone cannot unfold it",
	);
	assert.match(
		src("remote.html"),
		/<div id="lesson-container" class="start-collapsed">/,
		"the phone is always folded",
	);
	const render = /\n\trender\(\) \{[\s\S]*?\n\t\}/.exec(
		src("renderer/lesson-renderer.js"),
	)[0];
	assert.ok(
		render.indexOf("setStartCollapsed(this.startCollapsed)") >
			render.indexOf("clearLessonContainer()"),
		"every render re-applies the section's state to the container",
	);
});
