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
const UIManager = require("../src/renderer/ui-manager");
const {
	KIND_CHOICES,
	kindChoices,
	addChoices,
	kindGlyph,
} = require("../src/renderer/block-types");
const { BLOCK_KINDS, getBlockKind } = require("../src/shared/blocks");

const INCLUDE = { type: "include", path: "" };

function manager(blocks) {
	const lm = new LessonManager();
	lm.data = [INCLUDE, ...blocks].map((b) => ({ ...b }));
	lm.changes = 0;
	lm.markAsChanged = () => lm.changes++;
	return lm;
}

const PREFIX = Object.fromEntries(BLOCK_KINDS.map(([p, s]) => [s, p]));

test("changing type rewrites only the prefix", () => {
	const lm = manager([{ type: "comment", text: "What is UTF-8 for?" }]);
	for (const subtype of Object.keys(PREFIX)) {
		assert.equal(lm.setBlockKind(1, subtype), true);
		assert.equal(lm.data[1].text, `${PREFIX[subtype]} What is UTF-8 for?`);
		assert.equal(getBlockKind(lm.data[1].text), subtype);
	}
	assert.equal(lm.setBlockKind(1, "note"), true);
	assert.equal(
		lm.data[1].text,
		"What is UTF-8 for?",
		"going back to a plain comment must not leave a stray space or glyph",
	);
});

test("a multi-line body survives a type change untouched", () => {
	const body = "const a = 1;\n\tconst b = 2;\n";
	const lm = manager([{ type: "comment", text: `📋 ${body}` }]);
	lm.setBlockKind(1, "question");
	assert.equal(lm.data[1].text, `❓ ${body}`);
	lm.setBlockKind(1, "snippet");
	assert.equal(
		lm.data[1].text,
		`📋 ${body}`,
		"comment text keeps raw newlines and tabs: a ↩ in a 📋 body pastes literally",
	);
});

test("leaving 📋 drops paste, which nothing else would ever read", () => {
	const lm = manager([{ type: "comment", text: "📋 x", paste: false }]);
	lm.setBlockKind(1, "snippet");
	assert.equal(
		lm.data[1].paste,
		false,
		"staying 📋 keeps the teacher's choice",
	);
	lm.setBlockKind(1, "question");
	assert.equal(
		"paste" in lm.data[1],
		false,
		"a stale paste:false would silently re-apply on the way back to 📋",
	);
});

test("leaving 🖼️/🌐 drops pin, but 🖼️↔🌐 keeps it", () => {
	const lm = manager([{ type: "comment", text: "🖼️ flex.webp", pin: true }]);
	lm.setBlockKind(1, "web");
	assert.equal(
		lm.data[1].pin,
		true,
		"same checkbox on both, so it still means it",
	);
	lm.setBlockKind(1, "image");
	assert.equal(lm.data[1].pin, true);
	for (const next of ["question", "snippet", "note"]) {
		const one = manager([{ type: "comment", text: "🌐 x", pin: true }]);
		one.setBlockKind(1, next);
		assert.equal(
			"pin" in one.data[1],
			false,
			`pin survived a move to ${next}`,
		);
	}
});

test("a stray pin word in the body is not absorbed into the flag", () => {
	const lm = manager([{ type: "comment", text: "❓ do you pin notes?" }]);
	lm.setBlockKind(1, "image");
	assert.equal(
		"pin" in lm.data[1],
		false,
		"_pinShorthand must not run here: changing the type is not typing the word",
	);
	assert.equal(lm.data[1].text, "🖼️ do you pin notes?");
});

test("Start with and inherited blocks cannot change kind", () => {
	const lm = manager([
		{ type: "code", text: "let x;" },
		{ type: "comment", text: "📋 x", fromInclude: true },
		{ type: "comment", text: "plain" },
	]);
	assert.equal(lm.setBlockKind(0, "question"), false, "Start with");
	assert.equal(lm.setBlockKind(2, "question"), false, "inherited");
	assert.equal(lm.setBlockKind(3, "no-such-kind"), false, "unknown kind");
	assert.equal(lm.setBlockKind(99, "question"), false, "out of range");
	assert.equal(lm.data[1].text, "let x;");
	assert.equal(lm.data[3].text, "plain");
	assert.equal(lm.changes, 0, "a refused change must not mark the plan dirty");
});

test("a code block changes kind like any other, and back", () => {
	const lm = manager([{ type: "code", text: "let a = 1;\nlet b = 2;" }]);

	assert.equal(lm.setBlockKind(1, "snippet"), true);
	assert.deepEqual(lm.data[1], {
		type: "comment",
		text: "📋 let a = 1;\nlet b = 2;",
	});

	assert.equal(lm.setBlockKind(1, "code"), true);
	assert.deepEqual(
		lm.data[1],
		{ type: "code", text: "let a = 1;\nlet b = 2;" },
		"the prefix comes off and the block types again",
	);

	assert.equal(lm.setBlockKind(1, "move-to"), true);
	assert.deepEqual(lm.data[1], {
		type: "move-to",
		target: "MAIN",
		note: "let a = 1; let b = 2;",
	});
	assert.equal(lm.setBlockKind(1, "code"), true);
	assert.deepEqual(lm.data[1], {
		type: "code",
		text: "let a = 1; let b = 2;",
	});
});

test("a snippet that becomes code drops the flag that was only its own", () => {
	const lm = manager([{ type: "comment", text: "📋 paste me", paste: false }]);
	assert.equal(lm.setBlockKind(1, "code"), true);
	assert.deepEqual(
		lm.data[1],
		{ type: "code", text: "paste me" },
		"a stale paste flag would re-apply the moment it became a 📋 again",
	);
});

test("text that becomes code is normalised like typed code", () => {
	const lm = manager([{ type: "comment", text: "\nstarts on a new line" }]);
	assert.equal(lm.setBlockKind(1, "code"), true);
	assert.equal(
		lm.data[1].text,
		"↩starts on a new line",
		"a bare newline at the edge of a code block is a keystroke, not space",
	);
});

test("a note becomes a move-to, carrying its words into the note", () => {
	const lm = manager([{ type: "comment", text: "❓ check the header" }]);
	assert.equal(lm.setBlockKind(1, "move-to"), true);
	assert.deepEqual(lm.data[1], {
		type: "move-to",
		target: "MAIN",
		note: "check the header",
	});
	assert.equal(
		"text" in lm.data[1],
		false,
		"a move-to holds a target and a note, never block text",
	);
});

test("a move-to becomes a note, carrying its note back into the text", () => {
	const lm = manager([
		{
			type: "move-to",
			target: "app.js",
			note: "why go here",
			typeName: false,
		},
	]);
	assert.equal(lm.setBlockKind(1, "snippet"), true);
	assert.deepEqual(lm.data[1], { type: "comment", text: "📋 why go here" });
	assert.equal(
		"target" in lm.data[1] || "typeName" in lm.data[1],
		false,
		"the target and its Auto-type choice mean nothing on a note",
	);
});

test("multi-line text flattens into the one-line note, keeping every word", () => {
	const lm = manager([
		{ type: "comment", text: "first line\n\tsecond   line\n" },
	]);
	lm.setBlockKind(1, "move-to");
	assert.equal(lm.data[1].note, "first line second line");
});

test("an empty note leaves no key behind either way", () => {
	const lm = manager([{ type: "comment", text: "   " }]);
	lm.setBlockKind(1, "move-to");
	assert.equal("note" in lm.data[1], false);
	lm.setBlockKind(1, "note");
	assert.equal(lm.data[1].text, "");
});

test("switching to a move-to drops the options that were a note's", () => {
	const lm = manager([{ type: "comment", text: "🖼️ flex.webp", pin: true }]);
	lm.setBlockKind(1, "move-to");
	assert.equal("pin" in lm.data[1], false);
	assert.equal("paste" in lm.data[1], false);
});

test("a move-to keeps its target when it is already one", () => {
	const lm = manager([{ type: "move-to", target: "app.js", note: "here" }]);
	assert.equal(lm.setBlockKind(1, "move-to"), true);
	assert.equal(lm.data[1].target, "app.js", "re-picking must not reset it");
});

test("a type change marks the plan as changed", () => {
	const lm = manager([{ type: "comment", text: "x" }]);
	lm.setBlockKind(1, "question");
	assert.equal(lm.changes, 1);
});

test("addBlock reports where the block actually went", () => {
	const lm = manager([
		{ type: "comment", text: "a" },
		{ type: "comment", text: "b" },
	]);
	assert.equal(lm.addBlock("comment", 1, "mid"), 2);
	assert.equal(lm.data[2].text, "mid");
	assert.equal(lm.addBlock("comment", null, "end"), 4);
	assert.equal(lm.data[4].text, "end");
});

test("the first authored block sits after Start with and its inherited blocks", () => {
	assert.equal(
		manager([{ type: "comment", text: "a" }]).firstAuthoredIndex(),
		1,
	);
	const lm = manager([
		{ type: "move-to", target: "index.html", fromInclude: true },
		{ type: "comment", text: "📋 x", fromInclude: true },
		{ type: "comment", text: "mine" },
	]);
	assert.equal(lm.firstAuthoredIndex(), 3);
	assert.equal(manager([]).firstAuthoredIndex(), 1);
});

test("moveBlock swaps neighbours and keeps everything else in place", () => {
	const lm = manager([
		{ type: "comment", text: "a" },
		{ type: "code", text: "b" },
		{ type: "comment", text: "c" },
	]);
	assert.equal(lm.moveBlock(1, 1), true);
	assert.deepEqual(
		lm.data.map((b) => b.text || b.type),
		["include", "b", "a", "c"],
	);
	assert.equal(lm.moveBlock(3, -1), true);
	assert.deepEqual(
		lm.data.map((b) => b.text || b.type),
		["include", "b", "c", "a"],
	);
	assert.equal(lm.changes, 2);
});

test("moveBlock never crosses Start with, the inherited blocks, or the end", () => {
	const lm = manager([
		{ type: "comment", text: "📋 x", fromInclude: true },
		{ type: "comment", text: "first" },
		{ type: "comment", text: "last" },
	]);
	assert.equal(lm.canMoveBlock(2, -1), false, "into the inherited run");
	assert.equal(lm.canMoveBlock(1, 1), false, "an inherited block cannot move");
	assert.equal(lm.canMoveBlock(0, 1), false, "Start with cannot move");
	assert.equal(lm.canMoveBlock(3, 1), false, "past the end");
	assert.equal(lm.canMoveBlock(2, 1), true);
	assert.equal(lm.moveBlock(2, -1), false);
	assert.equal(lm.changes, 0);
	assert.deepEqual(
		lm.data.map((b) => b.text || b.type),
		["include", "📋 x", "first", "last"],
	);
});

function editorFor(lm, selected = null) {
	const log = [];
	const ui = {
		sel: selected,
		getSelectedBlockIndex: () => ui.sel,
		selectBlock: (i) => {
			ui.sel = i;
			log.push(["select", i]);
		},
		deselectBlock: () => {
			ui.sel = null;
		},
	};
	const renderer = { render: () => log.push(["render"]) };
	const undo = {
		saveState: (label) => log.push(["undo", label, JSON.stringify(lm.data)]),
	};
	const editor = new BlockEditor(lm, ui, renderer, undo);
	editor.focusNewBlock = () => {};
	return { editor, ui, log };
}

test("adding at a seam inserts there and selects the new block", () => {
	const lm = manager([
		{ type: "comment", text: "a" },
		{ type: "comment", text: "b" },
	]);
	const { editor, ui, log } = editorFor(lm, 2);
	const before = JSON.stringify(lm.data);
	assert.equal(editor.addBlock("code", null, 1), 2);
	assert.equal(lm.data[2].type, "code");
	assert.equal(ui.sel, 2, "the seam decides, not the current selection");
	assert.equal(log[0][2], before, "undo is saved before the plan changes");
});

test("adding with nothing selected selects the block it appended", () => {
	const lm = manager([{ type: "comment", text: "a" }]);
	const { editor, ui } = editorFor(lm, null);
	editor.addBlock("comment");
	assert.equal(lm.data.length, 3);
	assert.equal(
		ui.sel,
		2,
		"it used to select index 0, which is the Start with row",
	);
});

test("a move saves undo first and the selection follows the block", () => {
	const lm = manager([
		{ type: "comment", text: "a" },
		{ type: "comment", text: "b" },
	]);
	const { editor, ui, log } = editorFor(lm, 1);
	const before = JSON.stringify(lm.data);
	editor.moveBlock(1, 1);
	assert.equal(lm.data[2].text, "a");
	assert.equal(ui.sel, 2);
	assert.deepEqual(log[0].slice(0, 2), ["undo", "move-block"]);
	assert.equal(log[0][2], before);
});

test("a refused move or type change leaves undo alone", () => {
	const lm = manager([{ type: "comment", text: "x", fromInclude: true }]);
	const { editor, log } = editorFor(lm, 1);
	editor.moveBlock(1, -1);
	editor.moveBlock(1, 1);
	editor.setKind(1, "question");
	assert.deepEqual(
		log,
		[],
		"saving then rolling back would push a phantom entry onto the redo stack",
	);
});

test("delete and format act on the block they were pressed on", () => {
	const lm = manager([
		{ type: "comment", text: "a" },
		{ type: "code", text: "<div><p>x</p></div>" },
	]);
	const { editor } = editorFor(lm, null);
	editor.formatBlock(2);
	assert.notEqual(lm.data[2].text, "<div><p>x</p></div>");
	editor.removeBlock(1);
	assert.equal(lm.data.length, 2);
	assert.equal(lm.data[1].type, "code");
});

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

function renderIsland(
	blocks,
	blockIdx,
	{ selected = blockIdx, typing = false } = {},
) {
	const lm = manager(blocks);
	const islands = [];
	const pickers = [];
	const renderer = new LessonRenderer(
		lm,
		{
			isActive: () => typing,
			getSelectedBlockIndex: () => selected,
			attachBlockIsland: (el, island) => islands.push(island),
			attachKindPicker: (el, picker) => pickers.push(picker),
		},
		{},
	);
	const block = lm.data[blockIdx];
	const blockDiv = fakeBlockDiv();
	const ctx = {
		blockDiv,
		block,
		blockIdx,
		isTypingActive: typing,
		stepIndex: 0,
		steps: [],
	};
	if (block.type === "comment") renderer.renderKindBlock(ctx);
	else if (block.type === "code") {
		renderer.makeCodeBlockEditable = () => {};
		renderer.renderCodeBlock(ctx);
	}
	assert.ok(
		islands.length <= 3,
		"three chips: add above, the block's own actions, add below",
	);
	const row = (className) =>
		islands.find((i) => i.className === className) || { tools: [] };
	return {
		...(islands.find((i) => !i.className) || { tools: [] }),
		above: row("block-opt-above").tools,
		below: row("block-opt-below").tools,
		picker: pickers[0] || null,
	};
}

const glyphs = (island) => island.tools.map((t) => t.glyph);
const ADDS = ["+⌨", "+💬", "+❓", "+🖼️", "+🌐", "+📋", "+➡️"];
const ABOVE = [...ADDS, "📥", "▲"];
const BELOW = [...ADDS, "📥", "▼"];
const rowGlyphs = (island) => [
	island.above.map((t) => t.glyph),
	island.below.map((t) => t.glyph),
];

test("a comment carries up, down and delete, and its symbol is the type picker", () => {
	const island = renderIsland(
		[
			{ type: "comment", text: "a" },
			{ type: "comment", text: "❓ b" },
			{ type: "comment", text: "c" },
		],
		2,
	);
	assert.deepEqual(glyphs(island), ["⧉", "🗑️"]);
	assert.equal(
		island.picker.glyph,
		"❓",
		"the type picker is the block's own symbol, not a tool in the chip",
	);
	assert.deepEqual(
		rowGlyphs(island),
		[ABOVE, BELOW],
		"adding above and moving up ride the top seam, their opposites the " +
			"bottom one, and delete sits between them",
	);
	assert.equal(
		island.tools.some((t) => t.disabled),
		false,
	);
});

test("a code block carries the same tools; format lives in the sidebar", () => {
	const island = renderIsland([{ type: "code", text: "x" }], 1);
	assert.deepEqual(glyphs(island), ["⧉", "🗑️"]);
	assert.equal(
		island.picker.glyph,
		"⌨",
		"code has a symbol so it can be converted",
	);
	assert.deepEqual(rowGlyphs(island), [ABOVE, BELOW]);
	assert.equal(
		/✨/.test(read("renderer/lesson-renderer.js")),
		false,
		"the block no longer offers auto-format; the sidebar button does",
	);
});

test("copy and delete only appear on hover; the symbol is always there", () => {
	const island = renderIsland([{ type: "comment", text: "a" }], 1);
	assert.deepEqual(
		island.tools.map((t) => /\bblock-tool-hover\b/.test(t.className)),
		[true, true],
	);
	assert.equal(island.picker.disabled, false);
});

test("the last authored block cannot be deleted", () => {
	const only = renderIsland([{ type: "comment", text: "a" }], 1);
	assert.equal(
		only.tools[1].disabled,
		true,
		"nothing would be left to add to",
	);
	const two = renderIsland(
		[
			{ type: "comment", text: "a" },
			{ type: "comment", text: "b" },
		],
		1,
	);
	assert.equal(two.tools[1].disabled, false);
	const lm = manager([{ type: "comment", text: "a" }]);
	assert.equal(lm.canRemoveBlock(0), false, "Start with is not deletable");
	assert.equal(lm.canRemoveBlock(1), false);
	const { editor } = editorFor(lm, 1);
	editor.removeBlock(1);
	assert.equal(lm.data.length, 2);
});

test("the arrows are disabled where the block cannot go", () => {
	const island = renderIsland([{ type: "comment", text: "only" }], 1);
	const up = island.above.find((x) => x.glyph === "▲");
	const down = island.below.find((x) => x.glyph === "▼");
	assert.equal(up.disabled, true, "nothing may go above Start with");
	assert.equal(down.disabled, true);
});

test("an unselected block still carries its one-click actions", () => {
	const blocks = [{ type: "comment", text: "a" }];
	const island = renderIsland(blocks, 1, { selected: null });
	assert.deepEqual(
		[glyphs(island), ...rowGlyphs(island)],
		[["⧉", "🗑️"], ABOVE, BELOW],
		"moving or deleting a block should not cost a selecting click first",
	);
	assert.equal(
		island.picker.glyph,
		"💬",
		"and the kind is on show whether or not the block is selected",
	);
});

test("nothing is offered while typing, or on a block you may not touch", () => {
	const blocks = [{ type: "comment", text: "a" }];
	const typing = renderIsland(blocks, 1, { typing: true });
	assert.deepEqual([typing.tools, ...rowGlyphs(typing)], [[], [], []]);
	assert.equal(
		typing.picker.disabled,
		true,
		"the symbol stays, so nothing shifts when typing starts, but it is inert",
	);
	const inherited = renderIsland(
		[{ type: "comment", text: "x", fromInclude: true }],
		1,
	);
	assert.deepEqual(
		[inherited.tools, ...rowGlyphs(inherited)],
		[[], [], []],
		"inherited blocks are context; giving them ✕ would make them deletable",
	);
	assert.equal(
		inherited.picker,
		null,
		"and a type picker would let a start file be converted",
	);
});

test("add above and add below land on the right side of the block", () => {
	const lm = manager([
		{ type: "comment", text: "first" },
		{ type: "comment", text: "second" },
	]);
	const added = [];
	const renderer = new LessonRenderer(
		lm,
		{ isActive: () => false, getSelectedBlockIndex: () => null },
		{},
	);
	renderer.blockEditor = {
		addBlock: (type, text, after) => added.push([type, after]),
	};
	const above = renderer._addRow(lm.data[2], 2, false, "above");
	const below = renderer._addRow(lm.data[2], 2, false, "below");
	above[1].onClick();
	below[1].onClick();
	assert.deepEqual(
		added,
		[
			["comment", 1],
			["comment", 2],
		],
		"add-above on block i inserts after i-1; add-below inserts after i",
	);
	assert.deepEqual(
		[above.map((t) => t.glyph), below.map((t) => t.glyph)],
		[ABOVE, BELOW],
		"a note and a code block are the two kinds a lesson alternates, and " +
			"each row ends with the move that goes the same way",
	);
});

test("the controls are revealed by hover, not by a mousemove handler", () => {
	const css = read("shared/styles.css");
	assert.match(css, /\n\.block-tool-hover \{\n\tdisplay: none;\n\}/);
	assert.match(
		css,
		/\n\.block-opt:not\(:has\(> :not\(\.block-tool-hover\)\)\) \{\n\tdisplay: none;\n\}/,
		"an island holding only hover actions would otherwise show as an " +
			"empty chip on every block",
	);
	assert.match(
		css,
		/:where\(body:not\(\.mobile-view\)\) \.block:hover > \.block-opt \{\n\tdisplay: flex;/,
	);
	assert.equal(
		/\.block\.selected > \.block-opt|\.block\.selected \.block-tool-hover/.test(
			css,
		),
		false,
		"a selected block that is not under the pointer shows no controls: " +
			"hover is the only thing that reveals them",
	);
	assert.equal(
		/block-add-w/.test(css),
		false,
		"seven add buttons, a paste and an arrow: the row is as wide as it needs " +
			"to be, anchored at the right edge, instead of a fixed column",
	);
	assert.match(
		/\.block-opt \{[\s\S]*?\n\}/.exec(css)[0],
		/\n\tright: 0;/,
		"and the chip with the picker and delete shares that right edge",
	);
	assert.match(
		css,
		/\.block-opt \.block-tool \{\n\tfont-size: 10px;\n\theight: 15px;/,
		"an emoji renders taller than its own font-size — the + buttons " +
			"measured 26px against the ▲'s 15px — so the height is pinned, or " +
			"the three chips do not all fit a one-line block",
	);
	assert.match(
		css,
		/\.block-opt-above \{\n\ttop: 0;\n\ttransform: translateY\(-50%\);/,
		"add-above straddles the seam above the block, half in each neighbour",
	);
	assert.match(
		css,
		/\.block-opt-below \{\n\ttop: auto;\n\tbottom: 0;\n\ttransform: translateY\(50%\);/,
		"and add-below the seam under it, by half its own height so the shift " +
			"follows the font size",
	);
	assert.match(
		css,
		/\.block-opt \{[\s\S]*?\n\ttop: 50%;[\s\S]*?\n\ttransform: translateY\(-50%\);/,
		"which leaves the picker and delete in the gap between the two rows",
	);
	assert.match(
		css,
		/:where\(body:not\(\.mobile-view\)\) #lesson-container \{\n\tpadding: 10px 0;/,
		"the first block's top row and the last block's bottom row overhang the " +
			"container, which clips them (and scrolls, for the bottom one) unless " +
			"it has a gutter",
	);
	assert.equal(
		/::after \{\n\tcontent: "[↑↓]"/.test(css),
		false,
		"the rows say which way they go, so the arrows on the + buttons are gone",
	);
	assert.match(
		css,
		/\.block\.selected \{\n\tz-index: 3;\n\}\n\n\.block:hover \{\n\tz-index: 4;\n\}/,
		"a chip outside the block is painted under the next block otherwise — " +
			"a snippet block is `opacity: 0.75`, which makes it a stacking " +
			"context — and the pointer then never reaches it. It has to outrank " +
			"the chips themselves (2), because a block that is not hovered is no " +
			"stacking context, so its own chip sits at 2 in the root",
	);
	assert.match(
		css,
		/\.sidebar \{\n\twidth: 55px;\n\tmin-width: 50px;\n\tz-index: 5;/,
		"and the sidebar has to outrank the block it lifted",
	);
	assert.match(
		css,
		/:where\(body:not\(\.mobile-view\)\) \.block:hover \.block-tool-hover/,
		"a control that appears anywhere but on the block under the pointer is " +
			"what made a click add a block by mistake",
	);
	assert.equal(
		/\.block-insert-hover/.test(css),
		false,
		"the floating seam bar is gone",
	);
	assert.equal(
		fs.existsSync(path.join(SRC, "renderer", "block-insert-bar.js")),
		false,
		"and so is the module that drove it",
	);
	assert.equal(
		fs.existsSync(path.join(SRC, "renderer", "block-end-bar.js")),
		false,
		"the add bar under the last block is gone; the last block's own bottom " +
			"row adds after it",
	);
	assert.equal(
		/block-insert-end|block-add-btn|buildEndBar/.test(
			css + read("renderer/lesson-renderer.js"),
		),
		false,
	);
});

test("the option and the tools share the one island", () => {
	const island = renderIsland([{ type: "comment", text: "📋 x" }], 1);
	assert.equal(island.option.label, "Show Paste");
	assert.deepEqual(glyphs(island), ["⧉", "🗑️"]);
	assert.equal(island.picker.glyph, "📋");
	const unselected = renderIsland([{ type: "comment", text: "📋 x" }], 1, {
		selected: null,
	});
	assert.equal(
		unselected.option.label,
		"Show Paste",
		"the checkbox shows whether or not the block is selected",
	);
	assert.deepEqual(
		[glyphs(unselected), ...rowGlyphs(unselected)],
		[["⧉", "🗑️"], ABOVE, BELOW],
		"and the actions come with it",
	);
});

function fakeElement(tag) {
	const listeners = {};
	const classes = new Set();
	return {
		tagName: tag.toUpperCase(),
		nodeName: tag.toUpperCase(),
		children: [],
		dataset: {},
		classList: {
			add: (c) => classes.add(c),
			remove: (...cs) => cs.forEach((c) => classes.delete(c)),
			contains: (c) => classes.has(c),
		},
		appendChild(c) {
			this.children.push(c);
			return c;
		},
		insertBefore(c, ref) {
			const at = this.children.indexOf(ref);
			this.children.splice(at < 0 ? this.children.length : at, 0, c);
			return c;
		},
		get firstChild() {
			return this.children[0] || null;
		},
		get lastChild() {
			return this.children[this.children.length - 1] || null;
		},
		addEventListener(type, fn) {
			(listeners[type] = listeners[type] || []).push(fn);
		},
		fire(type) {
			const e = {
				stopped: false,
				stopPropagation() {
					this.stopped = true;
				},
			};
			for (const fn of listeners[type] || []) fn(e);
			return e;
		},
	};
}

test("the island is sealed like the option chip always was", () => {
	global.document = {
		createElement: fakeElement,
		createTextNode: (text) => ({ text }),
	};
	try {
		const ui = new UIManager();
		const block = fakeElement("div");
		const clicks = [];
		const island = ui.attachBlockIsland(block, {
			option: { label: "Pin", checked: false, onChange: () => {} },
			tools: [
				{ glyph: "▲", title: "up", onClick: () => clicks.push("up") },
				{ glyph: "▼", title: "down", disabled: true, onClick: () => {} },
			],
		});
		assert.equal(block.children.length, 1);
		assert.equal(island.className, "block-opt");
		assert.equal(
			island.dataset.blockOpt,
			"1",
			"readCodeText skips this; without it the glyphs land in the lesson",
		);
		assert.equal(island.contentEditable, "false");
		for (const type of ["mousedown", "click", "input", "change", "keydown"]) {
			assert.equal(
				island.fire(type).stopped,
				true,
				`${type} must not reach the block: mousedown re-selects, input rewrites`,
			);
		}
		const [check, up, down] = island.children;
		assert.equal(
			check.className,
			"block-opt-check",
			"the option sits left of the picker and delete; the chip is pinned to " +
				"the right edge, so the hover tools reserve their space (see the " +
				"stylesheet test) instead of sliding the checkbox out from under " +
				"the pointer",
		);
		assert.equal(up.className, "block-tool");
		assert.equal(up.dataset.blockOpt, "1");
		up.fire("click");
		down.fire("click");
		assert.deepEqual(clicks, ["up"], "a disabled tool does nothing");
		assert.equal(
			ui.attachBlockIsland(fakeElement("div"), { tools: [] }),
			null,
			"an empty island is not attached at all",
		);
	} finally {
		delete global.document;
	}
});

test("an empty block keeps its <br> after the chips, or hovering grows it", () => {
	global.document = {
		createElement: fakeElement,
		createTextNode: (text) => ({ text }),
	};
	try {
		const ui = new UIManager();
		const block = fakeElement("div");
		block.contentEditable = "true";
		const tool = [{ glyph: "x", title: "x", onClick: () => {} }];
		for (const className of ["block-opt-above", undefined, "block-opt-below"])
			ui.attachBlockIsland(block, { tools: tool, className });
		assert.deepEqual(
			block.children.map((c) => (c.tagName === "BR" ? "br" : "island")),
			["island", "island", "island", "br"],
			"an absolutely positioned chip that comes after the <br> is given a " +
				"line box of its own the moment it is displayed, so an empty note " +
				"grew by a whole line on hover — measured 41.8px to 62.8px",
		);
		ui.attachBlockIsland(block, { tools: tool, className: "again" });
		assert.equal(
			block.lastChild.tagName,
			"BR",
			"re-attaching (refreshIsland) must not put a chip after it either",
		);
	} finally {
		delete global.document;
	}
});

test("hover tools keep their room beside an option, so it never moves", () => {
	const css = read("shared/styles.css");
	assert.match(
		css,
		/\.block-opt:has\(> \.block-opt-check\) \.block-tool-hover \{\n\tdisplay: inline-block;\n\tvisibility: hidden;\n\}/,
		"the chip is anchored at the right edge, so tools that appear beside " +
			"an option that sits left of them would push it leftwards and put " +
			"the picker or delete under a pointer aimed at the checkbox",
	);
	assert.match(
		css,
		/\.block:hover \.block-tool-hover \{\n\tdisplay: inline-block;\n\tvisibility: visible;/,
	);
	const ui = read("renderer/ui-manager.js");
	const attach = /attachBlockIsland\([\s\S]*?\n\t\}/.exec(ui)[0];
	assert.ok(
		attach.indexOf("createBlockOption") < attach.indexOf("createBlockTool"),
		"the option is the first thing in the chip",
	);
});

test("the chips are white whatever the block, and never dimmed by it", () => {
	const css = read("shared/styles.css");
	const chip = /\n\.block-opt \{[\s\S]*?\n\}/.exec(css)[0];
	assert.match(chip, /background: var\(--clr-white\)/);
	assert.match(chip, /color: var\(--clr-black\)/);
	assert.equal(
		/background: inherit/.test(chip),
		false,
		"inheriting made the controls grey, blue or dark with the block",
	);
	assert.equal(
		/\.move-to-block \.block-(opt|tool) \{/.test(css),
		false,
		"a dark block used to recolour its controls; they are white everywhere",
	);
	for (const kind of ["snippet-block", "move-to-block"]) {
		const rule = new RegExp(`\\n\\.${kind} \\{[\\s\\S]*?\\n\\}`).exec(css)[0];
		assert.equal(
			/opacity/.test(rule),
			false,
			`${kind} is dimmed by an overlay: opacity would dim the chips inside it`,
		);
	}
	assert.match(
		css,
		/body:not\(\.mobile-view\) \.snippet-block::after,\nbody:not\(\.mobile-view\) \.move-to-block::after \{[\s\S]*?opacity: 0\.25;[\s\S]*?pointer-events: none;\n\tz-index: 1;/,
		"25% white over the block is what opacity: 0.75 over white gave, " +
			"and z-index 1 keeps it under the chips (2)",
	);
	assert.match(
		css,
		/\.mobile-view \.snippet-block,\n\.mobile-view \.move-to-block \{\n\topacity: 0\.75;/,
		"the phone has no chips, so it keeps the plain rule",
	);
});

test("every kind is offered, derived from the one prefix table", () => {
	assert.deepEqual(
		KIND_CHOICES.map((c) => c.kind),
		["code", "note", ...BLOCK_KINDS.map(([, kind]) => kind), "move-to"],
		"a move-to is a note with a target, so it belongs in the same picker, " +
			"and code is a kind like the rest: the picker converts both ways",
	);
	for (const [glyph, kind] of BLOCK_KINDS) {
		assert.equal(kindGlyph(kind), glyph);
	}
	assert.equal(kindGlyph("note"), "💬");
	assert.equal(kindGlyph("code"), "⌨");
	assert.equal(kindGlyph("move-to"), "➡️");
});

test("every kind is offered, always: there are no modes any more", () => {
	assert.deepEqual(
		kindChoices().map((c) => c.kind),
		["code", "note", "question", "image", "web", "snippet", "move-to"],
	);
	assert.deepEqual(
		addChoices().map((c) => c.kind),
		kindChoices().map((c) => c.kind),
		"every type is offered between blocks, in the picker's order",
	);
	assert.deepEqual(
		addChoices().map((c) => c.type),
		[
			"code",
			"comment",
			"comment",
			"comment",
			"comment",
			"comment",
			"move-to",
		],
	);
	assert.deepEqual(
		addChoices().map((c) => c.initialText),
		[undefined, undefined, "❓ ", "🖼️ ", "🌐 ", "📋 ", "MAIN"],
		"a new question or snippet starts with its own prefix, so it is one",
	);
	for (const src of ["renderer/app.js", "renderer/block-types.js"]) {
		assert.equal(
			/mode-record|mode-classroom|mode-scientific/.test(read(src)),
			false,
			src + " still gates on a lesson mode",
		);
	}
	assert.equal(
		/body\.mode-/.test(read("shared/styles.css")),
		false,
		"the ⚓ key was hidden per mode; it is always offered now",
	);
});

test("the picker shows the block's own kind as its glyph", () => {
	const lm = manager([
		{ type: "comment", text: "📋 x" },
		{ type: "move-to", target: "MAIN" },
	]);
	const renderer = new LessonRenderer(lm, {}, {});
	assert.equal(renderer._kindPicker(lm.data[1], 1, false).glyph, "📋");
	assert.equal(renderer._kindPicker(lm.data[2], 2, false).glyph, "➡️");
	assert.equal(
		renderer._kindPicker(lm.data[1], 1, true).disabled,
		true,
		"typing starts the auto-typer; the symbol must not open a menu then",
	);
});

test("the toolbar is gone and nothing still points at it", () => {
	const ids = [
		"editor-toolbar",
		"addCommentBtn",
		"addCodeBtn",
		"addQuestionCommentBtn",
		"addImageCommentBtn",
		"addWebCommentBtn",
		"addCodeInsertBlockBtn",
		"addMoveToBlockBtn",
		"removeBlockBtn",
		"formatBlockBtn",
	];
	const files = [
		"index.html",
		"renderer/app.js",
		"renderer/ui-manager.js",
		"shared/blocks.js",
		"shared/styles.css",
	];
	for (const file of files) {
		const text = read(file);
		for (const id of ids) {
			assert.equal(text.includes(id), false, `${file} still mentions ${id}`);
		}
	}
});

test("the new controls wear the Settings colours", () => {
	const { buildSettingsCSS } = require("../src/shared/blocks");
	const SettingsManager = require("../src/main/settings-manager");
	const s = new SettingsManager().defaultSettings;
	const css = buildSettingsCSS(s);
	const rule = (sel) => {
		const at = css.indexOf(sel);
		assert.ok(at >= 0, `${sel} is not themed`);
		return css.slice(at, css.indexOf("}", at));
	};
	assert.match(
		rule('.bt-option[data-value="question"]'),
		new RegExp(s.colors.questionColor),
	);
	assert.match(
		rule('.bt-option[data-value="snippet"]'),
		new RegExp(s.colors.snippetColor),
	);
	const add = (kind) => rule(`.block-tool-add[data-add-kind="${kind}"]`);
	const expected = {
		note: s.colors.noteColor,
		code: s.colors.codeBlockColor,
		question: s.colors.questionColor,
		image: s.colors.imageBlockColor,
		web: s.colors.imageBlockColor,
		snippet: s.colors.snippetColor,
		"move-to": s.colors.moveToBlockColor,
	};
	for (const [kind, color] of Object.entries(expected)) {
		assert.match(
			add(kind),
			new RegExp(color),
			`${kind} button wears its colour`,
		);
	}
	assert.match(add("move-to"), new RegExp(s.colors.moveToTextColor));
	assert.ok(
		css.includes(
			'.block-tool-add[data-add-kind="note"]:hover:not(:disabled)',
		),
		"the generic hover would replace the colour with translucent black",
	);
});

test("the type list is not a move-to list, so the anchor preview ignores it", () => {
	const src = read("renderer/lesson-renderer.js");
	const tool =
		/_kindPicker\(block, blockIdx, isTypingActive\) \{[\s\S]*?\n\t\}/.exec(
			src,
		)[0];
	assert.match(tool, /listClass: "bt-options"/);
	assert.match(
		tool,
		/itemClass: "bt-option"/,
		"anchor-preview keys on .mt-option; a type is not a jump target",
	);
});

function sidebarFor({ blocks, selected, expanded = [] }) {
	const calls = [];
	const lm = manager(blocks);
	const renderer = new LessonRenderer(
		lm,
		{
			getSelectedBlockIndex: () => selected,
			setSidebarEnabled: (enabled, format) => calls.push([enabled, format]),
		},
		{},
	);
	for (const i of expanded) renderer.expandedIncludes.add(i);
	renderer._syncSidebar();
	return calls;
}

test("the sidebar tools are enabled only while a code block is selected", () => {
	const code = { type: "code", text: "x" };
	const note = { type: "comment", text: "n" };
	assert.deepEqual(sidebarFor({ blocks: [code], selected: 1 }), [
		[true, true],
	]);
	assert.deepEqual(
		sidebarFor({ blocks: [note], selected: 1 }),
		[[false, false]],
		"a note has no keystrokes to insert into",
	);
	assert.deepEqual(sidebarFor({ blocks: [code], selected: null }), [
		[false, false],
	]);
});

test("an open start file keeps the keys, but not format", () => {
	const start = { type: "comment", text: "📋 a\n\tb", fromInclude: true };
	assert.deepEqual(
		sidebarFor({ blocks: [start], selected: null, expanded: [1] }),
		[[true, false]],
		"a start file is only ever given anchors, through the ⚓ key",
	);
});

test("the sidebar is never hidden by selecting or deselecting", () => {
	const src = read("renderer/ui-manager.js");
	const select = /selectBlock\(index\) \{[\s\S]*?\n\t\}/.exec(src)[0];
	const deselect = /deselectBlock\(\) \{[\s\S]*?\n\t\}/.exec(src)[0];
	assert.equal(/hidden/.test(select + deselect), false);
	const html = read("index.html");
	const sidebar = /id="editor-sidebar"[\s\S]*?<\/div>\s*<\/div>/.exec(html)[0];
	assert.ok(
		sidebar.indexOf("special-keys-container") < sidebar.indexOf("formatBtn"),
		"auto-format is the last tool in the sidebar",
	);
});

test("backspace, delete and delete-line sit last in the sidebar, right before format", () => {
	const src = read("renderer/special-keys.js");
	const keysBlock = /const keys = \{([\s\S]*?)\n\t\t\};/.exec(src)[1];
	const order = [...keysBlock.matchAll(/"([^"]+)":/g)].map((m) => m[1]);
	assert.deepEqual(
		order.slice(-3),
		["⌫", "⌦", "⛔"],
		"these three are generated into #special-keys-container in object-key " +
			"order, and that container sits right before #formatBtn",
	);
});

test("a structural edit closes the typing burst before saving undo", () => {
	const lm = manager([
		{ type: "comment", text: "a" },
		{ type: "comment", text: "b" },
	]);
	const order = [];
	const renderer = {
		render: () => {},
		endEditBurst: () => order.push("end-burst"),
	};
	const undo = { saveState: (label) => order.push(label) };
	const ui = {
		getSelectedBlockIndex: () => 1,
		selectBlock: () => {},
		deselectBlock: () => {},
	};
	const editor = new BlockEditor(lm, ui, renderer, undo);
	editor.focusNewBlock = () => {};
	editor.moveBlock(1, 1);
	editor.setKind(1, "question");
	editor.addBlock("comment", null, 1);
	editor.removeBlock(1);
	assert.deepEqual(
		order,
		[
			"end-burst",
			"move-block",
			"end-burst",
			"change-block-type",
			"end-burst",
			"add-comment-block",
			"end-burst",
			"remove-block",
		],
		"a pending edit snapshot that fires after a move lands on top of the " +
			"move's own, and undo then needs two presses",
	);
});

test("ending a burst drops the stale block index", () => {
	const renderer = new LessonRenderer({}, {}, {}, { saveState() {} });
	renderer.lastEditedBlockIndex = 4;
	renderer.lastEditTime = Date.now();
	renderer.endEditBurst();
	assert.equal(
		renderer.lastEditedBlockIndex,
		null,
		"after a move, index 4 is a different block",
	);
	assert.equal(renderer.lastEditTime, 0);
});

test("no edit snapshot is ever deferred, so none can land after a move", () => {
	const saved = [];
	const renderer = new LessonRenderer(
		{},
		{},
		{},
		{ saveState: (why) => saved.push(why) },
	);

	renderer.saveEditState(2);
	renderer.saveEditState(2);
	renderer.saveEditState(2);

	assert.equal(
		saved.length,
		1,
		"a typing run in one block is one undo step, taken before the first keystroke",
	);

	return new Promise((resolve) =>
		setTimeout(() => {
			assert.equal(
				saved.length,
				1,
				"a snapshot fired on a timer after the burst - undo would need two presses",
			);
			resolve();
		}, 30),
	);
});

function fakeDom() {
	const docListeners = {};
	const make = (tag) => {
		const listeners = {};
		const el = {
			tagName: tag,
			children: [],
			parent: null,
			dataset: {},
			style: {},
			className: "",
			classList: {
				set: new Set(),
				add(c) {
					this.set.add(c);
				},
				remove(c) {
					this.set.delete(c);
				},
				contains(c) {
					return this.set.has(c);
				},
			},
			appendChild(c) {
				c.parent = el;
				el.children.push(c);
				return c;
			},
			contains(other) {
				for (let n = other; n; n = n.parent) if (n === el) return true;
				return false;
			},
			addEventListener(type, fn) {
				(listeners[type] = listeners[type] || []).push(fn);
			},
			fire(type, e) {
				for (const fn of listeners[type] || []) fn(e);
			},
			set innerHTML(v) {
				el.children = [];
			},
		};
		return el;
	};
	const body = make("body");
	return {
		make,
		body,
		listeners: docListeners,
		document: {
			body,
			createElement: make,
			addEventListener: (type, fn) =>
				(docListeners[type] = docListeners[type] || []).push(fn),
		},
		window: { addEventListener() {} },
	};
}

test("opening a plan forgets the old plan's selection and expansions", () => {
	const calls = [];
	const renderer = new LessonRenderer(
		{},
		{
			getSelectedBlockIndex: () => 5,
			deselectBlock: () => calls.push("deselect"),
		},
		{},
	);
	renderer.expandedIncludes.add(2);
	renderer.lastEditedBlockIndex = 5;
	renderer.resetView();
	assert.deepEqual(
		calls,
		["deselect"],
		"index 5 of the old plan is some unrelated block of the new one, and " +
			"it would render selected, tools and all",
	);
	assert.equal(renderer.expandedIncludes.size, 0);
	assert.equal(renderer.lastEditedBlockIndex, null);

	const src = read("renderer/file-operations.js");
	const load = /async loadFilePath\(filePath\) \{[\s\S]*?\n\t\}/.exec(src)[0];
	const reset = load.indexOf("this.lessonRenderer.resetView()");
	assert.ok(reset >= 0, "loadFilePath must reset the view");
	assert.ok(
		reset < load.indexOf("this.lessonRenderer.render()"),
		"the reset has to happen before the new plan is drawn",
	);
});

test("with nothing selected, a reset leaves the sidebar alone", () => {
	const calls = [];
	const renderer = new LessonRenderer(
		{},
		{
			getSelectedBlockIndex: () => null,
			deselectBlock: () => calls.push("deselect"),
		},
		{},
	);
	renderer.resetView();
	assert.deepEqual(calls, []);
});

test("a renamed colour keeps the value the teacher chose", () => {
	const { migrateColors } = require("../src/main/settings-manager.js");
	const migrated = migrateColors({
		commentNormal: "#ffe08a",
		questionCommentColor: "#f0f",
		codeInsertBlockColor: "#eee",
		commentActive: "#0f0",
		commentActiveText: "#000",
		commentSelected: "#ccc",
		cursor: "#f00",
	});
	assert.deepEqual(migrated, {
		noteColor: "#ffe08a",
		questionColor: "#f0f",
		snippetColor: "#eee",
		activeBlockColor: "#0f0",
		activeBlockTextColor: "#000",
		selectedBlockColor: "#ccc",
		cursor: "#f00",
	});
});

test("every renamed colour maps onto a key the schema still has", () => {
	const { RENAMED_COLORS } = require("../src/main/settings-manager.js");
	const { COLOR_SETTINGS } = require("../src/shared/settings-schema.js");
	const keys = COLOR_SETTINGS.map((c) => c.key);
	for (const [was, now] of Object.entries(RENAMED_COLORS)) {
		assert.ok(
			keys.includes(now),
			`${was} migrates to ${now}, which is not a setting any more`,
		);
		assert.equal(
			keys.includes(was),
			false,
			`${was} is both renamed and still in the schema`,
		);
	}
});

test("migration is idempotent and never overwrites a new value", () => {
	const { migrateColors } = require("../src/main/settings-manager.js");
	const once = migrateColors({ commentNormal: "#aaa" });
	assert.deepEqual(migrateColors(once), once);
	assert.deepEqual(
		migrateColors({ commentNormal: "#aaa", noteColor: "#bbb" }),
		{ noteColor: "#bbb" },
		"a file written by the new build wins over its own legacy key",
	);
	assert.deepEqual(migrateColors(undefined), {});
});

test("the lesson mode is gone from the menu and the settings", () => {
	const menu = fs.readFileSync(path.join(SRC, "main", "app-menu.js"), "utf-8");
	assert.equal(
		/label: "Mode"|setMenuMode|apply-mode/.test(menu),
		false,
		"the Mode submenu only existed to tame the old nine-button toolbar",
	);
	const manager = fs.readFileSync(
		path.join(SRC, "main", "settings-manager.js"),
		"utf-8",
	);
	assert.equal(/mode: "record"/.test(manager), false);
	assert.match(
		manager,
		/RETIRED_SETTINGS/,
		"a saved mode should be pruned, not left to rot in the file",
	);
});

test("an empty editable block keeps a place to type when it gets tools", () => {
	global.document = {
		createElement: fakeElement,
		createTextNode: (text) => ({ text }),
	};
	try {
		const ui = new UIManager();
		const tools = [{ glyph: "✕", title: "x", onClick: () => {} }];

		const empty = fakeElement("div");
		empty.contentEditable = "true";
		ui.attachBlockIsland(empty, { tools });
		assert.equal(
			empty.lastChild.tagName,
			"BR",
			"Chromium refuses to type into an editable whose only child cannot " +
				"be edited, so the block needs its placeholder br — after the chips, " +
				"because a chip that follows it opens a line of its own on hover",
		);
		assert.equal(empty.children[0].className, "block-opt");

		const written = fakeElement("div");
		written.contentEditable = "true";
		written.appendChild({ nodeName: "#text" });
		ui.attachBlockIsland(written, { tools });
		assert.equal(
			written.children.filter((c) => c.tagName === "BR").length,
			0,
			"a block with text already has somewhere to put the caret",
		);

		const readOnly = fakeElement("div");
		readOnly.contentEditable = "false";
		ui.attachBlockIsland(readOnly, { tools });
		assert.equal(
			readOnly.children.filter((c) => c.tagName === "BR").length,
			0,
			"a move-to is not editable, so a br would just be stray markup",
		);
	} finally {
		delete global.document;
	}
});

test("the caret lands in the text, never past the island", () => {
	const src = read("renderer/block-editor.js");
	assert.match(
		src,
		/UIManager\.putCaret\(target, null\)/,
		"selectNodeContents + collapse(false) put the caret after the island",
	);
	const ui = read("renderer/ui-manager.js");
	assert.match(ui, /static caretAtTextEnd\(el\)/);
	assert.match(
		ui,
		/isIsland\(range\.startContainer\)/,
		"a click resolved onto the island has to fall back to a text position",
	);
});

test("editing a block back to empty does not cost it its tools", () => {
	const src = read("renderer/lesson-renderer.js");
	const keep = /_keepIsland\(el, blockIdx\) \{[\s\S]*?\n\t\}/.exec(src)[0];
	assert.match(
		keep,
		/querySelector\(":scope > \.block-opt-below"\)/,
		"the last chip attached: if Chromium took the children, it went too",
	);
	assert.match(keep, /this\.refreshIsland\(blockIdx\)/);
	for (const handler of ["makeCodeBlockEditable", "renderKindBlock"]) {
		const at = src.indexOf(handler);
		const body = src.slice(at, at + 2000);
		assert.match(
			body,
			/this\._keepIsland\(/,
			`${handler}: backspacing a block empty lets Chromium take the ` +
				"island with it, since a non-editable node is deleted as a unit",
		);
	}
});

test("an unselected code block gets the same one-click actions", () => {
	global.document = {
		createElement: fakeElement,
		createTextNode: (text) => ({ text }),
	};
	try {
		const lm = manager([{ type: "code", text: "ab" }]);
		const islands = [];
		const renderer = new LessonRenderer(
			lm,
			{
				isActive: () => false,
				getSelectedBlockIndex: () => null,
				attachBlockIsland: (el, island) => islands.push(island),
				attachKindPicker: () => {},
			},
			{},
		);
		const blockDiv = fakeElement("div");
		renderer.renderCodeBlock({
			blockDiv,
			block: lm.data[1],
			blockIdx: 1,
			isTypingActive: false,
			stepIndex: 0,
			steps: [],
		});
		assert.deepEqual(
			islands.map((i) => i.tools.map((t) => t.glyph)),
			[ABOVE, ["⧉", "🗑️"], BELOW],
			"a code block is rendered as characters until selected, and that " +
				"path used to attach no island at all, so hovering it showed nothing",
		);
	} finally {
		delete global.document;
	}
});

test("a hovered block outranks a selected one, and the sidebar outranks both", () => {
	const css = read("shared/styles.css");
	const z = (re) => Number(re.exec(css)[1]);
	const selected = z(/\n\.block\.selected \{\n\tz-index: (\d+);/);
	const hovered = z(/\n\.block:hover \{\n\tz-index: (\d+);/);
	const sidebar = z(/\n\.sidebar \{[^}]*?z-index: (\d+);/);
	assert.ok(
		hovered > selected,
		"at equal z-index the block later in the document wins, so a selected " +
			"neighbour below slices the hovered block's bottom chips",
	);
	assert.ok(sidebar > hovered, "the fixed sidebar stays above a lifted block");
});

test("z-index is never animated on a support block", () => {
	const css = read("shared/styles.css");
	const rule = /\.move-to-block \{[^}]*?transition:([^;]*);/.exec(css);
	assert.ok(rule, "the support blocks share one transition");
	assert.match(
		rule[1],
		/z-index 0s/,
		"with transition: all the hover z-index lags by a beat, and for that " +
			"beat a neighbour paints over the chips",
	);
});

test("a collapsed snippet clips its text sideways but not its chips vertically", () => {
	const css = read("shared/styles.css");
	const rule = /\.snippet-block\.collapsed \{([^}]*)\}/.exec(css)[1];
	assert.equal(
		/overflow:\s*hidden/.test(rule),
		false,
		"overflow: hidden cuts the half of each chip row that overhangs the block",
	);
	assert.match(rule, /overflow-x:\s*clip/);
	assert.match(rule, /overflow-y:\s*visible/);
	assert.match(rule, /text-overflow:\s*ellipsis/);
});

test("the block-tool dropdown marks the live choice with an outline, not a fill", () => {
	const rule = /\.bt-option\.active \{[\s\S]*?\n\}/.exec(
		read("shared/styles.css"),
	)[0];
	assert.match(rule, /outline: 2px solid var\(--clr-accent\)/);
	assert.equal(
		/background/.test(rule),
		false,
		"blocks.js generates a per-value .bt-option[data-value] background at runtime; " +
			"a fill here would paint over the colour the row is naming",
	);
});
