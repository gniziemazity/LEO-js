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
const {
	seamAt,
	BAND,
	SHOW_DELAY_MS,
} = require("../src/renderer/block-insert-bar");
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

test("code, Start with and inherited blocks cannot change kind", () => {
	const lm = manager([
		{ type: "code", text: "let x;" },
		{ type: "comment", text: "📋 x", fromInclude: true },
		{ type: "comment", text: "plain" },
	]);
	assert.equal(lm.setBlockKind(0, "question"), false, "Start with");
	assert.equal(lm.setBlockKind(1, "question"), false, "code");
	assert.equal(lm.setBlockKind(2, "question"), false, "inherited");
	assert.equal(lm.setBlockKind(3, "no-such-kind"), false, "unknown kind");
	assert.equal(lm.setBlockKind(99, "question"), false, "out of range");
	assert.equal(lm.data[1].text, "let x;");
	assert.equal(lm.data[3].text, "plain");
	assert.equal(lm.changes, 0, "a refused change must not mark the plan dirty");
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
	const lm = manager([{ type: "code", text: "x" }]);
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
	const renderer = new LessonRenderer(
		lm,
		{
			isActive: () => typing,
			getSelectedBlockIndex: () => selected,
			attachBlockIsland: (el, island) => islands.push(island),
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
	assert.equal(islands.length, 1, "exactly one island per block");
	return islands[0];
}

const glyphs = (island) => island.tools.map((t) => t.glyph);

test("a selected comment carries type, up, down and delete", () => {
	const island = renderIsland(
		[
			{ type: "comment", text: "a" },
			{ type: "comment", text: "❓ b" },
			{ type: "comment", text: "c" },
		],
		2,
	);
	assert.deepEqual(glyphs(island), ["❓ ▾", "▲", "▼", "✕"]);
	assert.equal(
		island.tools.some((t) => t.disabled),
		false,
	);
});

test("a selected code block carries format instead of type", () => {
	const island = renderIsland([{ type: "code", text: "x" }], 1);
	assert.deepEqual(glyphs(island), ["✨", "▲", "▼", "✕"]);
});

test("the arrows are disabled where the block cannot go", () => {
	const island = renderIsland([{ type: "comment", text: "only" }], 1);
	const [, up, down] = island.tools;
	assert.equal(up.disabled, true, "nothing may go above Start with");
	assert.equal(down.disabled, true);
});

test("no tools unless the block is selected, authored and not being typed", () => {
	const blocks = [{ type: "comment", text: "a" }];
	assert.deepEqual(renderIsland(blocks, 1, { selected: null }).tools, []);
	assert.deepEqual(renderIsland(blocks, 1, { typing: true }).tools, []);
	assert.deepEqual(
		renderIsland([{ type: "comment", text: "x", fromInclude: true }], 1)
			.tools,
		[],
		"inherited blocks are context; giving them ✕ would make them deletable",
	);
});

test("the option and the tools share the one island", () => {
	const island = renderIsland([{ type: "comment", text: "📋 x" }], 1);
	assert.equal(island.option.label, "Show Paste button");
	assert.deepEqual(glyphs(island), ["📋 ▾", "▲", "▼", "✕"]);
	const unselected = renderIsland([{ type: "comment", text: "📋 x" }], 1, {
		selected: null,
	});
	assert.equal(unselected.option.label, "Show Paste button");
	assert.deepEqual(unselected.tools, []);
});

function fakeElement(tag) {
	const listeners = {};
	return {
		tagName: tag.toUpperCase(),
		children: [],
		dataset: {},
		appendChild(c) {
			this.children.push(c);
			return c;
		},
		get firstChild() {
			return this.children[0] || null;
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
		assert.equal(check.className, "block-opt-check");
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

test("every kind is offered, derived from the one prefix table", () => {
	assert.deepEqual(
		KIND_CHOICES.map((c) => c.kind),
		["note", ...BLOCK_KINDS.map(([, kind]) => kind), "move-to"],
		"a move-to is a note with a target, so it belongs in the same picker",
	);
	for (const [glyph, kind] of BLOCK_KINDS) {
		assert.equal(kindGlyph(kind), glyph);
	}
	assert.equal(kindGlyph("note"), "💬");
	assert.equal(kindGlyph("move-to"), "➡️");
});

test("every kind is offered, always: there are no modes any more", () => {
	assert.deepEqual(
		kindChoices().map((c) => c.kind),
		["note", "question", "image", "web", "snippet", "move-to"],
	);
	assert.deepEqual(
		addChoices().map((c) => c.type),
		["comment", "code", "move-to"],
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
	assert.equal(renderer._typeTool(lm.data[1], 1).glyph, "📋 ▾");
	assert.equal(renderer._typeTool(lm.data[2], 2).glyph, "➡️ ▾");
});

test("the seam under the pointer decides where a block goes", () => {
	const rect = { top: 100, bottom: 140 };
	assert.deepEqual(seamAt(3, rect, 100 + BAND, 1), { after: 2, y: 100 });
	assert.deepEqual(seamAt(3, rect, 140 - BAND, 1), { after: 3, y: 140 });
	assert.equal(
		seamAt(3, rect, 120, 1),
		null,
		"the middle of a block is not a seam",
	);
});

test("no seam is offered above the first authored block", () => {
	const rect = { top: 100, bottom: 140 };
	assert.equal(seamAt(0, rect, 101, 1), null, "above Start with");
	assert.deepEqual(
		seamAt(0, rect, 139, 1),
		{ after: 0, y: 140 },
		"between Start with and the first block is fine",
	);
	assert.equal(seamAt(1, rect, 139, 3), null, "inside the inherited run");
	assert.equal(seamAt(2, rect, 101, 3), null, "between two inherited blocks");
	assert.deepEqual(seamAt(3, rect, 101, 3), { after: 2, y: 100 });
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
	assert.match(
		rule('.block-add-btn[data-add-kind="move-to"]'),
		new RegExp(s.colors.moveToBlockColor),
	);
	assert.match(
		rule('.block-add-btn[data-add-kind="code"]'),
		new RegExp(s.colors.codeBlockColor),
	);
});

test("the type list is not a move-to list, so the anchor preview ignores it", () => {
	const src = read("renderer/lesson-renderer.js");
	const tool = /_typeTool\(block, blockIdx\) \{[\s\S]*?\n\t\}/.exec(src)[0];
	assert.match(tool, /listClass: "bt-options"/);
	assert.match(
		tool,
		/itemClass: "bt-option"/,
		"anchor-preview keys on .mt-option; a type is not a jump target",
	);
});

test("the end bar is not a .block, or every positional lookup shifts", () => {
	const src = read("renderer/block-insert-bar.js");
	const end = /function buildEndBar[\s\S]*?\n\}/.exec(src)[0];
	const cls = /className = "([^"]+)"/.exec(end)[1].split(/\s+/);
	assert.equal(
		cls.includes("block"),
		false,
		'querySelectorAll(".block")[i] is how the editor finds block i',
	);
});

test("the hover bar floats and cannot eat clicks while hidden", () => {
	const css = read("shared/styles.css");
	const hover = /\.block-insert-hover \{[\s\S]*?\n\}/.exec(css)[0];
	assert.match(hover, /position: fixed/);
	assert.match(
		hover,
		/pointer-events: none/,
		"an invisible bar over a seam would swallow the click meant for the block",
	);
	assert.match(hover, /opacity: 0/);
	const shown = /\.block-insert-hover\.visible \{[\s\S]*?\n\}/.exec(css)[0];
	assert.equal(
		/pointer-events/.test(shown),
		false,
		"even when shown, the strip between the buttons must pass clicks through " +
			"to the block underneath, or clicking near a block edge does nothing",
	);
	assert.match(
		/\.block-insert-hover\.visible \.block-add-btn \{[\s\S]*?\n\}/.exec(
			css,
		)[0],
		/pointer-events: auto/,
	);
});

test("the seam band stays inside a block's padding", () => {
	const css = read("shared/styles.css");
	const pad = /\.block \{[\s\S]*?padding: (\d+)px/.exec(css)[1];
	assert.ok(
		BAND <= Number(pad),
		`BAND ${BAND}px reaches past the ${pad}px padding into the first line of ` +
			"text, so aiming at that line could reveal a bar under the pointer",
	);
	assert.ok(
		SHOW_DELAY_MS >= 100,
		"a quick click near an edge must land before the bar appears",
	);
});

test("the hover bar waits before appearing, and a click cancels the wait", async () => {
	const dom = fakeDom();
	global.document = dom.document;
	global.window = dom.window;
	try {
		delete require.cache[require.resolve("../src/renderer/block-insert-bar")];
		const insertBar = require("../src/renderer/block-insert-bar");
		const block = dom.make("div");
		block.closest = () => block;
		block.getBoundingClientRect = () => ({ top: 100, bottom: 140, left: 0 });
		const container = dom.make("div");
		container.querySelectorAll = () => [dom.make("div"), block];
		container.getBoundingClientRect = () => ({ left: 0 });
		const bar = insertBar.attach({
			container,
			lessonManager: { firstAuthoredIndex: () => 1 },
			blockEditor: {},
			uiManager: { isActive: () => false },
		});
		const move = dom.listeners.mousemove[0];
		const down = dom.listeners.mousedown[0];
		const nearEdge = { target: block, clientY: 102 };

		move(nearEdge);
		assert.equal(bar.classList.contains("visible"), false, "not yet");
		await new Promise((r) => setTimeout(r, insertBar.SHOW_DELAY_MS + 40));
		assert.equal(bar.classList.contains("visible"), true);
		assert.equal(bar.dataset.afterIndex, "0");

		insertBar.hide();
		move(nearEdge);
		down({ target: block });
		await new Promise((r) => setTimeout(r, insertBar.SHOW_DELAY_MS + 40));
		assert.equal(
			bar.classList.contains("visible"),
			false,
			"the click was meant for the block; a bar appearing after it is noise",
		);
	} finally {
		delete global.document;
		delete global.window;
		delete require.cache[require.resolve("../src/renderer/block-insert-bar")];
	}
});

test("the insert bar attaches after the DOM elements are cached", () => {
	const src = read("renderer/app.js");
	const cached = src.indexOf("uiManager.cacheElements()");
	const attached = src.indexOf("blockInsertBar.attach(");
	assert.ok(cached >= 0 && attached >= 0);
	assert.ok(
		attached > cached,
		"attach() before cacheElements() gets an undefined container",
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

test("ending a burst drops the pending snapshot and the stale block index", () => {
	const renderer = new LessonRenderer({}, {}, {}, { saveState() {} });
	let fired = false;
	renderer.editDebounceTimer = setTimeout(() => {
		fired = true;
	}, 5);
	renderer.lastEditedBlockIndex = 4;
	renderer.endEditBurst();
	assert.equal(renderer.editDebounceTimer, null);
	assert.equal(
		renderer.lastEditedBlockIndex,
		null,
		"after a move, index 4 is a different block",
	);
	return new Promise((resolve) =>
		setTimeout(() => {
			assert.equal(fired, false);
			resolve();
		}, 20),
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

test("moving from a seam onto the hover bar does not hide it", () => {
	const dom = fakeDom();
	global.document = dom.document;
	global.window = dom.window;
	try {
		delete require.cache[require.resolve("../src/renderer/block-insert-bar")];
		const insertBar = require("../src/renderer/block-insert-bar");
		const container = dom.make("div");
		const bar = insertBar.attach({
			container,
			lessonManager: { firstAuthoredIndex: () => 1 },
			blockEditor: {},
			uiManager: { isActive: () => false },
		});
		const inside = dom.make("button");
		bar.appendChild(inside);

		bar.classList.add("visible");
		container.fire("mouseleave", { relatedTarget: inside });
		assert.equal(
			bar.classList.contains("visible"),
			true,
			"the bar lives on body, so reaching it leaves the container; " +
				"hiding here made the bar vanish under the pointer, unclickable",
		);
		container.fire("mouseleave", { relatedTarget: dom.body });
		assert.equal(bar.classList.contains("visible"), false);
	} finally {
		delete global.document;
		delete global.window;
		delete require.cache[require.resolve("../src/renderer/block-insert-bar")];
	}
});

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
			empty.children[0].tagName,
			"BR",
			"Chromium refuses to type into an editable whose only child cannot " +
				"be edited, so the block needs its placeholder br first",
		);
		assert.equal(empty.children[1].className, "block-opt");

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
	assert.match(keep, /querySelector\(":scope > \.block-opt"\)/);
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
