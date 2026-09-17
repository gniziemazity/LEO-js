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
	const island = elem("LABEL", [textNode("Show Paste button")], {
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

test("block text comes from the step, never from the contaminated DOM", () => {
	const src = read("renderer/cursor-manager.js");
	for (const fn of [
		"_enterQuestionBlock",
		"_enterImageBlock",
		"_enterWebBlock",
		"_enterCodeInsertBlock",
	]) {
		const body = new RegExp(`${fn}\\(step\\) \\{[\\s\\S]*?\\n\\t\\}`).exec(
			src,
		);
		assert.ok(body, `${fn} must take the step`);
		assert.equal(
			/innerText/.test(body[0]),
			false,
			`${fn}: the option checkbox lives inside the block, so its label is ` +
				"part of innerText — reading it made every image block pin itself",
		);
	}
	assert.equal(
		/innerText/.test(src),
		false,
		"no reader may treat the block element as the source of block text",
	);
	assert.equal(
		/innerText/.test(read("renderer/log-event-builder.js")),
		false,
		"the artificial log would otherwise record the checkbox label as code",
	);
});

test("the option swallows input and change, which bubble", () => {
	const fn = /createBlockOption\(\{[\s\S]*?\n\t\}/.exec(
		read("renderer/ui-manager.js"),
	)[0];
	for (const type of ["input", "change"]) {
		assert.match(
			fn,
			new RegExp(`"${type}"`),
			`a checkbox ${type} event bubbles to the block's oninput, which would ` +
				"read the block back and overwrite it with the collapsed label",
		);
	}
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
		/right: 0/,
		"#main-layout reserves the gutter, so the chip sits flush at the " +
			"block's own right edge rather than dodging the bar itself",
	);
	assert.match(
		/\.sidebar \{[\s\S]*?\n\}/.exec(css)[0],
		/width: 55px/,
		"--editor-sidebar-w must track the sidebar's real width",
	);
	assert.match(css, /--editor-sidebar-w: 55px/);
});

test("every option is the same floating chip, never a column", () => {
	const css = read("shared/styles.css");
	const chip = /\.block-opt \{[\s\S]*?\n\}/.exec(css)[0];

	assert.equal(
		/width:|height:|left:/.test(chip),
		false,
		"the chip sizes to its label and hangs off the right; a fixed width or a " +
			"left edge is what made it a half-row column",
	);
	assert.equal(
		/padding-right: 50%/.test(css),
		false,
		"no block reserves half its row for the option any more",
	);
	assert.match(
		chip,
		/background: inherit/,
		"it overlaps the content, so it must be opaque — and inherit is what makes " +
			"one rule fit the grey, blue and dark block colours",
	);
	assert.match(chip, /z-index: 2/);
	assert.match(chip, /box-shadow:/);
});

test("oninput refuses to run on a block that is not editable", () => {
	const src = read("renderer/lesson-renderer.js");
	const fn = /blockDiv\.oninput = \(\) => \{[\s\S]*?\n\t\t\};/.exec(src)[0];
	assert.match(
		fn,
		/contentEditable !== "true"\) return/,
		"a collapsed block renders only its truncated label; saving that back " +
			"destroys the rest of the code insert",
	);
});

test("readCodeText still reads ordinary child elements", () => {
	const block = elem("DIV", [
		textNode("first"),
		elem("DIV", [textNode("second")]),
	]);
	assert.equal(readCodeText(block), "first\nsecond");
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

test("only the first move-to to a file creates it", () => {
	const lm = withBlocks([
		{ type: "move-to", target: "MAIN" },
		{ type: "move-to", target: "index.js" },
		{ type: "code", text: "x" },
		{ type: "move-to", target: "style.css" },
		{ type: "move-to", target: "index.js" },
	]);

	assert.equal(lm.isFirstMoveToFile(1), true, "index.js is created here");
	assert.equal(lm.isFirstMoveToFile(3), true, "style.css is created here");
	assert.equal(
		lm.isFirstMoveToFile(4),
		false,
		"the second visit lands in a file that already exists",
	);
	assert.equal(lm.isFirstMoveToFile(0), false, "MAIN is not a file");
});

test("a file an included plan already touched is not created again", () => {
	const lm = withBlocks([
		{ type: "move-to", target: "index.js", fromInclude: true },
		{ type: "comment", text: "📋 …", fromInclude: true },
		{ type: "move-to", target: "index.js" },
	]);

	assert.equal(
		lm.isFirstMoveToFile(2),
		false,
		"under Start with, the inherited move-to means the file is already there — " +
			"this is exactly why 'create on first appearance' was rejected before",
	);
	assert.equal(lm.isFirstMoveToFile(0), true);
});

test("an anchor target never creates a file", () => {
	const lm = withBlocks([{ type: "move-to", target: "⚓3⚓" }]);
	assert.equal(lm.isFirstMoveToFile(0), false);
});

test("the option is opt-out: absent means the button shows", () => {
	for (const [file, expr] of [
		["shared/remote/code-insert-overlay.js", /paste !== false/],
		["renderer/desk-popup.js", /paste !== false/],
		["renderer/cursor-manager.js", /step\.paste !== false/],
		["renderer/lesson-renderer.js", /block\.paste !== false/],
		["renderer/lesson-renderer.js", /block\.typeName !== false/],
	]) {
		assert.match(
			read(file),
			expr,
			`${file} must default a missing flag to "shown", or every saved plan loses its button`,
		);
	}
});

test("Auto-type is offered only where the file is created", () => {
	const src = read("renderer/lesson-renderer.js");
	assert.match(
		src,
		/isFirstMoveToFile\(blockIdx\)/,
		"a later move-to lands in a file that already exists",
	);
	assert.match(
		src,
		/typeName: creates && block\.typeName !== false/,
		"the payload flag must fold in the first-move-to rule, not just the checkbox",
	);
});

test("the phone never tells a teacher to press Ctrl+V it cannot honour", () => {
	assert.equal(
		/ci-modal-hint|ciHint/.test(read("remote.html")),
		false,
		"with paste off the clipboard is never loaded, so the hint promised " +
			"a paste that would insert whatever the teacher had copied",
	);
	assert.equal(
		/ciHint/.test(read("shared/remote/code-insert-overlay.js")),
		false,
	);
	assert.equal(/ci-modal-hint/.test(read("shared/styles.css")), false);
});

test("no OK is offered when the name has to be typed", () => {
	const phone = read("shared/remote/move-to-overlay.js");
	assert.match(
		phone,
		/okBtn\.style\.display = this\.canTypeName \? "none" : ""/,
		"typing the last character is what confirms, so an OK would race it",
	);
	assert.match(
		phone,
		/typeBtn\.style\.display = this\.canTypeName \? "" : "none"/,
		"and Auto-type is offered on exactly the block that creates the file",
	);
});

test("typing the last character confirms the popup", () => {
	const src = fs.readFileSync(path.join(SRC, "main", "popups.js"), "utf-8");
	const fn = /async function typeNextNameChar\(\)[\s\S]*?\n\}/.exec(src)[0];
	assert.match(
		fn,
		/pendingName\.index >= pendingName\.chars\.length\) \{[\s\S]*?confirmPopup\("move-to"\)/,
		"there is no OK while Auto-type is required, so completion is what closes it",
	);
});

test("ticking an option does not reach the block underneath", () => {
	const fn = /createBlockOption\(\{[\s\S]*?\n\t\}/.exec(
		read("renderer/ui-manager.js"),
	)[0];
	assert.match(
		fn,
		/"mousedown"[\s\S]*?e\.stopPropagation\(\)/,
		"the block's own mousedown selects and re-renders, which would drop the click",
	);
	assert.match(
		fn,
		/dataset\.blockOpt/,
		"readCodeText keys off this to skip the island",
	);
	assert.match(fn, /contentEditable = "false"/);
});

test("a code insert whose paste is off does not hijack the clipboard", () => {
	const src = fs.readFileSync(path.join(SRC, "main", "popups.js"), "utf-8");
	const hold = /function holdCodeOnClipboard\(payload\)[\s\S]*?\n\}/.exec(
		src,
	)[0];
	assert.match(hold, /payload\.paste === false\) return/);
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
	const fn = /static authored\(blocks\) \{[\s\S]*?\n\t\}/.exec(
		read("renderer/lesson-manager.js"),
	)[0];
	assert.match(fn, /blocks\.filter/);
	assert.equal(
		/\btext\s*:/.test(fn),
		false,
		"a field-by-field rebuild would silently drop paste/typeName",
	);
});

test("the gutter is given back when the bar goes away for typing", () => {
	const css = read("shared/styles.css");
	const rule = /body\.typing-active #main-layout \{[\s\S]*?\n\}/.exec(css);
	assert.ok(
		rule,
		"typing hides the sidebar, so its 55px has to go back to the code",
	);
	assert.match(rule[0], /padding-right: 0/);
});
