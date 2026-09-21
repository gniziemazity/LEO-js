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
const { KIND_PLACEHOLDERS, kindGlyph } = require("../src/renderer/block-types");
const {
	BLOCK_KINDS,
	getBlockKind,
	stripBlockPrefix,
	withKindPrefix,
} = require("../src/shared/blocks");

function manager(blocks) {
	const lm = new LessonManager();
	lm.data = [{ type: "include" }, ...blocks].map((b) => ({ ...b }));
	lm.markAsChanged = () => {};
	return lm;
}

test("withKindPrefix and stripBlockPrefix are inverses for every kind", () => {
	for (const [, kind] of BLOCK_KINDS) {
		for (const body of [
			"x",
			"",
			"a\nb",
			"  indented",
			"\nfirst line blank",
		]) {
			const text = withKindPrefix(kind, body);
			assert.equal(getBlockKind(text), kind, `${kind} keeps its kind`);
			assert.equal(
				stripBlockPrefix(text),
				body,
				`${kind}: ${JSON.stringify(body)}`,
			);
		}
	}
	assert.equal(
		withKindPrefix("note", "plain"),
		"plain",
		"a note has no prefix",
	);
	assert.equal(withKindPrefix("code", "plain"), "plain");
});

test("editing a body writes it back behind the block's own prefix", () => {
	const lm = manager([
		{ type: "comment", text: "📋 old" },
		{ type: "comment", text: "🖼️ pic.png" },
		{ type: "comment", text: "just a note" },
		{ type: "code", text: "x = 1" },
	]);
	lm.updateBlockBody(1, "new\nbody");
	lm.updateBlockBody(2, "other.png");
	lm.updateBlockBody(3, "changed");
	lm.updateBlockBody(4, "y = 2");
	assert.equal(lm.data[1].text, "📋 new\nbody");
	assert.equal(lm.data[2].text, "🖼️ other.png");
	assert.equal(lm.data[3].text, "changed");
	assert.equal(lm.data[4].text, "y = 2");
	lm.updateBlockBody(1, "");
	assert.equal(
		getBlockKind(lm.data[1].text),
		"snippet",
		"emptying the body must not turn a snippet into a note",
	);
});

test("a special key typed into a block keeps its kind", () => {
	const lm = manager([{ type: "comment", text: "📋 abc" }]);
	const ui = { getSelectedBlockIndex: () => 1 };
	const editor = new BlockEditor(lm, ui, {}, null);
	editor.updateBlockContent(1, "abc↩");
	assert.equal(lm.data[1].text, "📋 abc↩");
});

test("the symbol is a sealed button that leads the block", () => {
	const made = [];
	const el = (tag) => {
		const node = {
			tagName: tag.toUpperCase(),
			dataset: {},
			children: [],
			listeners: {},
			addEventListener(type, fn) {
				(this.listeners[type] = this.listeners[type] || []).push(fn);
			},
		};
		made.push(node);
		return node;
	};
	global.document = {
		createElement: el,
		createTextNode: (text) => ({ text }),
	};
	try {
		const classes = new Set();
		const block = {
			children: [{ tagName: "SPAN" }],
			classList: { add: (c) => classes.add(c) },
			get firstChild() {
				return this.children[0];
			},
			insertBefore(node, ref) {
				this.children.splice(this.children.indexOf(ref), 0, node);
			},
		};
		const clicked = [];
		const ui = new UIManager();
		const picker = ui.attachKindPicker(block, {
			glyph: "📋",
			title: "Change block type",
			disabled: false,
			onClick: () => clicked.push("open"),
		});
		assert.equal(block.children[0], picker, "first child, before the text");
		assert.equal(picker.className, "block-kind");
		assert.equal(picker.textContent, "📋");
		assert.equal(picker.dataset.blockOpt, "1", "readCodeText skips it");
		assert.equal(picker.contentEditable, "false");
		assert.equal(classes.has("has-kind"), true);
		picker.listeners.click.at(-1)();
		assert.deepEqual(clicked, ["open"]);
		for (const type of ["mousedown", "click", "input", "keydown"]) {
			assert.equal(
				picker.listeners[type].length > 0,
				true,
				`${type} must not reach the block`,
			);
		}

		const off = ui.attachKindPicker(block, {
			glyph: "⌨",
			title: "t",
			disabled: true,
			onClick: () => clicked.push("never"),
		});
		off.listeners.click.at(-1)();
		assert.deepEqual(clicked, ["open"], "a disabled symbol opens nothing");
	} finally {
		delete global.document;
	}
});

function fakeDiv() {
	const classes = new Set();
	return {
		dataset: {},
		classList: {
			add: (c) => classes.add(c),
			remove: (...cs) => cs.forEach((c) => classes.delete(c)),
			contains: (c) => classes.has(c),
		},
	};
}

function renderText(block, { typing = false } = {}) {
	const lm = manager([block]);
	const renderer = new LessonRenderer(
		lm,
		{
			isActive: () => typing,
			getSelectedBlockIndex: () => null,
			attachBlockIsland: () => null,
			attachKindPicker: () => {},
		},
		{},
	);
	const div = fakeDiv();
	renderer.renderKindBlock({
		blockDiv: div,
		block: lm.data[1],
		blockIdx: 1,
		isTypingActive: typing,
		stepIndex: 0,
		steps: [],
	});
	return div;
}

test("an authored text block shows its body; the symbol is the widget", () => {
	assert.equal(
		renderText({ type: "comment", text: "❓ What is UTF-8?" }).textContent,
		"What is UTF-8?",
	);
	assert.equal(
		renderText({ type: "comment", text: "🖼️ pic.png" }).textContent,
		"pic.png",
		"the image glyph carries a variation selector",
	);
	assert.equal(
		renderText({ type: "comment", text: "a plain note" }).textContent,
		"a plain note",
	);
	assert.equal(
		renderText({ type: "comment", text: "📋 first\nsecond" }).textContent,
		"first...",
		"a collapsed multi-line snippet labels itself with its first body line",
	);
	assert.equal(
		renderText({ type: "comment", text: "📋 x" }, { typing: true })
			.textContent,
		"x",
		"typing must not move the text",
	);
});

test("an inherited block keeps its emoji as text, and gets no symbol widget", () => {
	const div = renderText({
		type: "comment",
		text: "📋 file body",
		fromInclude: true,
	});
	assert.equal(div.textContent, "📋 file body");
});

test("every kind has a symbol, and an empty one says what to type", () => {
	for (const kind of [
		"note",
		"code",
		"question",
		"image",
		"web",
		"snippet",
		"move-to",
	]) {
		assert.ok(kindGlyph(kind), `${kind} has a symbol`);
	}
	assert.equal(kindGlyph("note"), "💬");
	assert.equal(kindGlyph("code"), "⌨");
	for (const kind of ["note", "code", "question", "image", "web", "snippet"]) {
		assert.ok(KIND_PLACEHOLDERS[kind], `${kind} has a placeholder`);
	}
});

test("a missing symbol is put back after an edit", () => {
	const renderer = new LessonRenderer(manager([]), {}, {});
	const refreshed = [];
	renderer.refreshIsland = (i) => refreshed.push(i);
	const withParts = (parts) => ({
		classList: { contains: () => false },
		querySelector: (sel) => (parts.some((p) => sel.includes(p)) ? {} : null),
	});
	renderer._keepIsland(withParts(["block-opt-below", "block-kind"]), 3);
	assert.deepEqual(refreshed, [], "nothing missing, nothing to do");
	renderer._keepIsland(withParts(["block-opt-below"]), 3);
	assert.deepEqual(
		refreshed,
		[3],
		"Chromium removed the symbol with the text",
	);
	renderer._keepIsland(withParts(["block-kind"]), 4);
	assert.deepEqual(refreshed, [3, 4], "or the chips");
});

test("an emptied block keeps its placeholder br after the widgets", () => {
	const renderer = new LessonRenderer(manager([]), {}, {});
	renderer.refreshIsland = () => {};
	const br = { tagName: "BR" };
	const children = [br, { tagName: "DIV" }];
	const el = {
		classList: { contains: (c) => c === "is-empty" },
		get lastChild() {
			return children[children.length - 1];
		},
		querySelector: (sel) => (sel === ":scope > br" ? br : {}),
		appendChild(node) {
			children.splice(children.indexOf(node), 1);
			children.push(node);
		},
	};
	renderer._keepIsland(el, 1);
	assert.equal(
		children[children.length - 1],
		br,
		"a br before the chips gives them a line box of their own on hover",
	);
});

test("the symbol sits in its own gutter and shows a ▾ without moving text", () => {
	const css = read("shared/styles.css");
	assert.match(css, /--kind-w: 38px;/);
	assert.match(
		css,
		/\.block\.has-kind \{\n\tpadding-left: calc\(15px \+ var\(--kind-w\)\);\n\tmin-height: calc\(1\.5em \+ 20px\);/,
		"one shared text column, and no block shorter than the symbol",
	);
	const rule = /\n\.block-kind \{[\s\S]*?\n\}/.exec(css)[0];
	assert.match(rule, /position: absolute;/);
	assert.match(rule, /height: 1\.5em;/, "one line, following the font size");
	assert.match(
		css,
		/\.block-kind::after \{\n\tcontent: "▾";[\s\S]*?visibility: hidden;/,
		"the arrow has its room reserved, so revealing it moves nothing",
	);
	assert.match(
		css,
		/:where\(body:not\(\.mobile-view\)\)\n\t\.block:hover\n\t> \.block-kind:not\(:disabled\)::after \{\n\tvisibility: visible;/,
	);
	assert.match(
		css,
		/\.move-to-block > \.block-kind \{\n\ttop: 50%;\n\ttransform: translateY\(-50%\);/,
	);
});

test("the empty image block says where the images go", () => {
	assert.match(KIND_PLACEHOLDERS.image, /^Image file name/);
	assert.match(
		KIND_PLACEHOLDERS.image,
		/images folder/,
		"the file is looked up in the images folder beside the lesson, so say so",
	);
});

test("an unknown kind still gets the note symbol, whatever heads the list", () => {
	assert.equal(kindGlyph("nonsense"), "💬");
});
