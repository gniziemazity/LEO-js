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
	SUBTYPE_CHOICES,
	subtypeChoices,
	addChoices,
	currentMode,
	subtypeGlyph,
} = require("../src/renderer/block-types");
const {
	seamAt,
	BAND,
	SHOW_DELAY_MS,
} = require("../src/renderer/block-insert-bar");
const { BLOCK_SUBTYPES, getBlockSubtype } = require("../src/shared/blocks");

const INCLUDE = { type: "include", path: "" };

function manager(blocks) {
	const lm = new LessonManager();
	lm.data = [INCLUDE, ...blocks].map((b) => ({ ...b }));
	lm.changes = 0;
	lm.markAsChanged = () => lm.changes++;
	return lm;
}

const PREFIX = Object.fromEntries(BLOCK_SUBTYPES.map(([p, s]) => [s, p]));

test("changing type rewrites only the prefix", () => {
	const lm = manager([{ type: "comment", text: "What is UTF-8 for?" }]);
	for (const subtype of Object.keys(PREFIX)) {
		assert.equal(lm.setBlockSubtype(1, subtype), true);
		assert.equal(lm.data[1].text, `${PREFIX[subtype]} What is UTF-8 for?`);
		assert.equal(getBlockSubtype(lm.data[1].text), subtype);
	}
	assert.equal(lm.setBlockSubtype(1, null), true);
	assert.equal(
		lm.data[1].text,
		"What is UTF-8 for?",
		"going back to a plain comment must not leave a stray space or glyph",
	);
});

test("a multi-line body survives a type change untouched", () => {
	const body = "const a = 1;\n\tconst b = 2;\n";
	const lm = manager([{ type: "comment", text: `📋 ${body}` }]);
	lm.setBlockSubtype(1, "question-comment");
	assert.equal(lm.data[1].text, `❓ ${body}`);
	lm.setBlockSubtype(1, "code-insert-comment");
	assert.equal(
		lm.data[1].text,
		`📋 ${body}`,
		"comment text keeps raw newlines and tabs: a ↩ in a 📋 body pastes literally",
	);
});

test("leaving 📋 drops paste, which nothing else would ever read", () => {
	const lm = manager([{ type: "comment", text: "📋 x", paste: false }]);
	lm.setBlockSubtype(1, "code-insert-comment");
	assert.equal(
		lm.data[1].paste,
		false,
		"staying 📋 keeps the teacher's choice",
	);
	lm.setBlockSubtype(1, "question-comment");
	assert.equal(
		"paste" in lm.data[1],
		false,
		"a stale paste:false would silently re-apply on the way back to 📋",
	);
});

test("leaving 🖼️/🌐 drops pin, but 🖼️↔🌐 keeps it", () => {
	const lm = manager([{ type: "comment", text: "🖼️ flex.webp", pin: true }]);
	lm.setBlockSubtype(1, "web-comment");
	assert.equal(
		lm.data[1].pin,
		true,
		"same checkbox on both, so it still means it",
	);
	lm.setBlockSubtype(1, "image-comment");
	assert.equal(lm.data[1].pin, true);
	for (const next of ["question-comment", "code-insert-comment", null]) {
		const one = manager([{ type: "comment", text: "🌐 x", pin: true }]);
		one.setBlockSubtype(1, next);
		assert.equal(
			"pin" in one.data[1],
			false,
			`pin survived a move to ${next}`,
		);
	}
});

test("a stray pin word in the body is not absorbed into the flag", () => {
	const lm = manager([{ type: "comment", text: "❓ do you pin notes?" }]);
	lm.setBlockSubtype(1, "image-comment");
	assert.equal(
		"pin" in lm.data[1],
		false,
		"_pinShorthand must not run here: changing the type is not typing the word",
	);
	assert.equal(lm.data[1].text, "🖼️ do you pin notes?");
});

test("only authored comments can change type", () => {
	const lm = manager([
		{ type: "code", text: "let x;" },
		{ type: "move-to", target: "MAIN" },
		{ type: "comment", text: "📋 x", fromInclude: true },
		{ type: "comment", text: "plain" },
	]);
	assert.equal(lm.setBlockSubtype(0, "question-comment"), false, "include");
	assert.equal(lm.setBlockSubtype(1, "question-comment"), false, "code");
	assert.equal(lm.setBlockSubtype(2, "question-comment"), false, "move-to");
	assert.equal(lm.setBlockSubtype(3, "question-comment"), false, "inherited");
	assert.equal(lm.setBlockSubtype(4, "no-such-type"), false, "unknown");
	assert.equal(lm.setBlockSubtype(99, "question-comment"), false, "range");
	assert.equal(lm.data[1].text, "let x;");
	assert.equal(lm.data[4].text, "plain");
	assert.equal(lm.changes, 0, "a refused change must not mark the plan dirty");
});

test("a type change marks the plan as changed", () => {
	const lm = manager([{ type: "comment", text: "x" }]);
	lm.setBlockSubtype(1, "question-comment");
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
	editor.setSubtype(1, "question-comment");
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
	if (block.type === "comment") renderer.renderCommentBlock(ctx);
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

test("every subtype is offered, derived from the one prefix table", () => {
	const offered = SUBTYPE_CHOICES.map((c) => c.subtype);
	assert.deepEqual(offered, [null, ...BLOCK_SUBTYPES.map(([, s]) => s)]);
	for (const [glyph, subtype] of BLOCK_SUBTYPES) {
		assert.equal(subtypeGlyph(subtype), glyph);
	}
	assert.equal(subtypeGlyph(null), "💬");
});

test("each mode offers what its old toolbar showed", () => {
	const types = (mode) => subtypeChoices(mode).map((c) => c.subtype);
	const adds = (mode) => addChoices(mode).map((c) => c.type);
	assert.deepEqual(types("record"), [null]);
	assert.deepEqual(adds("record"), ["comment", "code"]);
	assert.deepEqual(types("classroom"), [
		null,
		"question-comment",
		"image-comment",
		"web-comment",
	]);
	assert.deepEqual(adds("classroom"), ["comment", "code"]);
	assert.deepEqual(
		types("scientific"),
		SUBTYPE_CHOICES.map((c) => c.subtype),
	);
	assert.deepEqual(adds("scientific"), ["comment", "code", "move-to"]);
});

test("record mode has one type, so no picker is drawn", () => {
	const body = { classList: { contains: (c) => c === "mode-record" } };
	assert.equal(currentMode(body), "record");
	const lm = manager([{ type: "comment", text: "a" }]);
	const renderer = new LessonRenderer(lm, {}, {});
	global.document = { body };
	try {
		assert.equal(renderer._typeTool(lm.data[1], 1), null);
	} finally {
		delete global.document;
	}
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
		rule('.bt-option[data-value="question-comment"]'),
		new RegExp(s.colors.questionCommentColor),
	);
	assert.match(
		rule('.bt-option[data-value="code-insert-comment"]'),
		new RegExp(s.colors.codeInsertBlockColor),
	);
	assert.match(
		rule('.block-add-btn[data-add-type="move-to"]'),
		new RegExp(s.colors.moveToBlockColor),
	);
	assert.match(
		rule('.block-add-btn[data-add-type="code"]'),
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
	editor.setSubtype(1, "question-comment");
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
