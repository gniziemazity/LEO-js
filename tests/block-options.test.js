"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC = path.resolve(__dirname, "..", "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf-8");

const { readCodeText } = require("../src/shared/code-text.js");
const { splitPinToken } = require("../src/shared/blocks.js");

function textNode(data) {
	return { nodeType: 3, data, childNodes: [] };
}

function elem(name, childNodes, dataset) {
	return { nodeType: 1, nodeName: name, childNodes, dataset: dataset || {} };
}

test("readCodeText skips the option island", () => {
	const island = elem("LABEL", [textNode("Show Paste")], {
		blockOpt: "1",
	});
	const block = elem("DIV", [textNode("📋 this.ctx.beginPath();"), island]);

	assert.equal(
		readCodeText(block),
		"📋 this.ctx.beginPath();",
		"the checkbox lives inside a contentEditable block; if its label is read " +
			"back the very next keystroke writes it into the lesson",
	);
});

test("a long code line cannot push the option off the right edge", () => {
	const css = read("shared/styles.css");
	const container = /#lesson-container \{[\s\S]*?\n\}/.exec(css)[0];
	assert.match(
		container,
		/min-width: 0/,
		"a flex item defaults to min-width:auto, so one long line stretches the " +
			"container past #main-layout and takes the option's right:0 with it",
	);
	assert.match(
		/\.note-block,[\s\S]*?\n\}/.exec(css)[0],
		/overflow-wrap: anywhere/,
		"pre-wrap alone will not break an unbreakable token",
	);
	assert.match(
		/#main-layout \{[\s\S]*?\n\}/.exec(css)[0],
		/padding-right: var\(--editor-sidebar-w\)/,
		"the sidebar is position:fixed and reserves no room of its own, so the " +
			"layout must reserve the gutter; without it every wrapped code line " +
			"loses its last 55px under the black bar",
	);
	assert.match(
		/\.block-opt \{[\s\S]*?\n\}/.exec(css)[0],
		/right: 0;/,
		"#main-layout reserves the sidebar's gutter, so the chip measures from " +
			"the block's own right edge; it shares the add rows' column, and the " +
			"rows straddle the seams so the three never overlap",
	);
	assert.match(
		/\.sidebar \{[\s\S]*?\n\}/.exec(css)[0],
		/width: 55px/,
		"--editor-sidebar-w must track the sidebar's real width",
	);
	assert.match(css, /--editor-sidebar-w: 55px/);
});

test("the legacy pin word is lifted out of the text on load", () => {
	assert.deepEqual(splitPinToken("🖼️ flex.webp pin"), {
		text: "🖼️ flex.webp",
		pin: true,
	});
	assert.deepEqual(splitPinToken("🌐 https://a.dev PIN"), {
		text: "🌐 https://a.dev",
		pin: true,
	});
	assert.deepEqual(splitPinToken("🖼️ flex.webp"), {
		text: "🖼️ flex.webp",
		pin: false,
	});
	assert.deepEqual(
		splitPinToken("🖼️ pin.webp"),
		{ text: "🖼️ pin.webp", pin: false },
		"a file called pin.webp is not a pin flag",
	);
});

test("a plan saved with the pin word loads with a clean name and pin: true", () => {
	const migrated = LessonManager._migrateBlocks([
		{ type: "comment", text: "🖼️ flex.webp pin" },
		{ type: "comment", text: "🌐 https://a.dev pin" },
		{ type: "comment", text: "🖼️ plain.webp" },
		{ type: "comment", text: "❓ pin" },
	]);

	assert.deepEqual(migrated[0], {
		type: "comment",
		text: "🖼️ flex.webp",
		pin: true,
	});
	assert.deepEqual(migrated[1], {
		type: "comment",
		text: "🌐 https://a.dev",
		pin: true,
	});
	assert.deepEqual(
		migrated[2],
		{ type: "comment", text: "🖼️ plain.webp" },
		"no pin key is invented for a block that never had one",
	);
	assert.deepEqual(
		migrated[3],
		{ type: "comment", text: "❓ pin" },
		"only image and web blocks ever carried the flag",
	);
});

const LessonManager = require("../src/renderer/lesson-manager.js");

function withBlocks(blocks) {
	const lm = Object.create(LessonManager.prototype);
	lm.data = blocks;
	return lm;
}

test("only the first go-to to a file creates it", () => {
	const lm = withBlocks([
		{ type: "go-to", target: "MAIN" },
		{ type: "go-to", target: "index.js" },
		{ type: "code", text: "x" },
		{ type: "go-to", target: "style.css" },
		{ type: "go-to", target: "index.js" },
	]);

	assert.equal(lm.isFirstGoToFile(1), true, "index.js is created here");
	assert.equal(lm.isFirstGoToFile(3), true, "style.css is created here");
	assert.equal(
		lm.isFirstGoToFile(4),
		false,
		"the second visit lands in a file that already exists",
	);
	assert.equal(lm.isFirstGoToFile(0), false, "MAIN is not a file");
});

test("a file an included plan already touched is not created again", () => {
	const lm = withBlocks([
		{ type: "go-to", target: "index.js", fromStart: true },
		{ type: "comment", text: "📋 …", fromStart: true },
		{ type: "go-to", target: "index.js" },
	]);

	assert.equal(
		lm.isFirstGoToFile(2),
		false,
		"under Starting Code, the inherited go-to means the file is already there — " +
			"this is exactly why 'create on first appearance' was rejected before",
	);
	assert.equal(lm.isFirstGoToFile(0), true);
});

test("an anchor target never creates a file", () => {
	const lm = withBlocks([{ type: "go-to", target: "⚓3⚓" }]);
	assert.equal(lm.isFirstGoToFile(0), false);
});

test("typing the pin word still works, and is absorbed into the flag", () => {
	const lm = withBlocks([{ type: "comment", text: "🖼️ flex.webp" }]);
	lm.markAsChanged = () => {};

	lm.updateBlock(0, "🖼️ flex.webp pin");
	assert.deepEqual(
		lm.data[0],
		{ type: "comment", text: "🖼️ flex.webp", pin: true },
		"the legacy shorthand must keep working when typed, not only on load",
	);

	lm.updateBlock(0, "🖼️ other.webp");
	assert.deepEqual(
		lm.data[0],
		{ type: "comment", text: "🖼️ other.webp", pin: true },
		"absence of the word must NOT clear the flag, or renaming the file " +
			"would silently untick a box the teacher set",
	);
});

test("a block added with the pin word absorbs it too", () => {
	const lm = withBlocks([]);
	lm.markAsChanged = () => {};
	lm.addBlock("comment", null, "🌐 https://a.dev pin");
	assert.deepEqual(lm.data[0], {
		type: "comment",
		text: "🌐 https://a.dev",
		pin: true,
	});
});

test("the shorthand only applies to image and web blocks", () => {
	const lm = withBlocks([{ type: "comment", text: "note" }]);
	lm.markAsChanged = () => {};
	lm.updateBlock(0, "❓ do you pin things?");
	assert.deepEqual(lm.data[0], {
		type: "comment",
		text: "❓ do you pin things?",
	});
});

test("updateBlockOption stores only what differs from the default", () => {
	const lm = withBlocks([
		{ type: "comment", text: "📋 x" },
		{ type: "comment", text: "🖼️ a.webp" },
	]);
	lm.markAsChanged = () => {};

	lm.updateBlockOption(0, "paste", false, true);
	assert.deepEqual(lm.data[0], {
		type: "comment",
		text: "📋 x",
		paste: false,
	});
	lm.updateBlockOption(0, "paste", true, true);
	assert.deepEqual(
		lm.data[0],
		{ type: "comment", text: "📋 x" },
		"back to the default means the key goes away, not paste:true",
	);

	lm.updateBlockOption(1, "pin", true, false);
	assert.deepEqual(lm.data[1], {
		type: "comment",
		text: "🖼️ a.webp",
		pin: true,
	});
	lm.updateBlockOption(1, "pin", false, false);
	assert.deepEqual(
		lm.data[1],
		{ type: "comment", text: "🖼️ a.webp" },
		"pin defaults the other way round, which is why the default is a parameter",
	);
});

test("authored() keeps the flag through a save round-trip", () => {
	const blocks = [
		{ type: "include", anchors: {} },
		{ type: "comment", text: "📋 x", paste: false },
		{ type: "go-to", target: "a.js", typeName: false, note: "why" },
		{ type: "comment", text: "🖼️ a.png", pin: true },
	];
	assert.deepEqual(
		LessonManager.authored(blocks),
		[blocks[1], { ...blocks[2], type: "move-to" }, blocks[3]],
		"a field-by-field rebuild would silently drop paste/typeName",
	);
	assert.equal(LessonManager.authored(blocks)[0], blocks[1]);
});

test("a plan file says move-to, so a plan saved today opens in an older LEO", () => {
	const saved = [{ type: "move-to", target: "a.js", note: "why" }];
	const loaded = LessonManager._migrateBlocks(saved);
	assert.deepEqual(loaded, [{ type: "go-to", target: "a.js", note: "why" }]);
	assert.deepEqual(LessonManager.authored(loaded), saved);
});

test("the gutter is given back when the bar goes away for auto-typing", () => {
	const css = read("shared/styles.css");
	const rule = /body\.auto-typing-active #main-layout \{[\s\S]*?\n\}/.exec(
		css,
	);
	assert.ok(
		rule,
		"auto-typing hides the sidebar, so its 55px has to go back to the code",
	);
	assert.match(rule[0], /padding-right: 0/);
});
