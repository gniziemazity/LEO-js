"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildRemote } = require("./helpers/remote-dom.js");

const SRC = path.join(__dirname, "..", "src");
const read = (p) => fs.readFileSync(path.join(SRC, p), "utf-8");

test("a note rides on the block and disappears when emptied", () => {
	const LessonManager = require("../src/renderer/lesson-manager.js");
	const lm = Object.create(LessonManager.prototype);
	lm.data = [{ type: "move-to", target: "MAIN" }];
	lm.markAsChanged = () => {};

	lm.updateMoveToNote(0, "  because the bug is here  ");
	assert.equal(lm.data[0].note, "because the bug is here", "trimmed");

	lm.updateMoveToNote(0, "   ");
	assert.equal(
		"note" in lm.data[0],
		false,
		"a blank note is deleted, so plans stay free of empty keys",
	);
});

test("only a move-to block takes a note", () => {
	const LessonManager = require("../src/renderer/lesson-manager.js");
	const lm = Object.create(LessonManager.prototype);
	lm.data = [{ type: "code", text: "x" }];
	lm.markAsChanged = () => {};
	assert.equal(lm.updateMoveToNote(0, "hi"), false);
	assert.equal("note" in lm.data[0], false);
});

test("the popup shows the note, and hides the row when there is none", () => {
	const ctx = buildRemote();
	ctx.api.setSessionActive(true);

	ctx.api.showMoveToOverlay({ mode: "main", note: "we broke this earlier" });
	assert.equal(ctx.nodes.mtoNote.textContent, "we broke this earlier");
	assert.notEqual(ctx.nodes.mtoNote.style.display, "none");

	ctx.api.closeMoveToOverlayUI();
	ctx.api.showMoveToOverlay({ mode: "main" });
	assert.equal(ctx.nodes.mtoNote.textContent, "");
	assert.equal(
		ctx.nodes.mtoNote.style.display,
		"none",
		"an empty note must not leave a coloured band on the popup",
	);
});

test("the note reaches the popup from the step", () => {
	const cm = read("renderer/cursor-manager.js");
	const fn = /_enterMoveToBlock\(step\) \{[\s\S]*?\n\t\}/.exec(cm)[0];
	assert.match(fn, /note: step\.note \|\| ""/);
	assert.match(
		read("renderer/lesson-renderer.js"),
		/note: block\.note \|\| ""/,
		"the step is built from the block, so the note has to be put on it",
	);
});

test("the note wears the comment colours on both surfaces", () => {
	const css = read("shared/styles.css");
	for (const sel of [".mt-modal-note", ".move-to-note"]) {
		const rule = new RegExp(
			sel.replace(".", "\\.") + " \\{[\\s\\S]*?\\n\\}",
		).exec(css)[0];
		assert.match(rule, /var\(--clr-comment-bg\)/, sel + " background");
		assert.match(rule, /var\(--clr-comment-text\)/, sel + " text");
	}
});

test("typing in the note does not select or delete the block", () => {
	const src = read("renderer/lesson-renderer.js");
	const made =
		/const note = document\.createElement\("input"\)[\s\S]*?blockDiv\.appendChild\(note\);/.exec(
			src,
		)[0];
	for (const ev of ["mousedown", "click", "keydown"])
		assert.match(
			made,
			new RegExp(
				`addEventListener\\("${ev}", \\(e\\) => e\\.stopPropagation\\(\\)\\)`,
			),
			`${ev} bubbles to the block, which would select it mid-typing`,
		);
	assert.match(
		made,
		/note\.disabled = isTypingActive \|\| !!block\.fromInclude/,
		"an inherited block is read-only, and typing is not the time to edit",
	);
});

test("the note runs to the end of the block, chip and all", () => {
	const css = read("shared/styles.css");
	assert.equal(
		/:has\(> \.block-opt\) \.move-to-note/.test(css),
		false,
		"reserving room for the chip wasted the row; it floats over instead",
	);
	const chip = /\.block-opt \{[\s\S]*?\n\}/.exec(css)[0];
	assert.match(
		chip,
		/z-index: 2/,
		"so the chip has to stack above the note it now covers",
	);
});

test("a wide snippet scrolls instead of pushing the buttons away", () => {
	const css = read("shared/styles.css");
	const rule = /\.mt-modal-snippet \{[\s\S]*?\n\}/.exec(css)[0];
	assert.match(rule, /overflow: auto/);
	assert.match(
		rule,
		/min-width: 0/,
		"a flex item defaults to min-width:auto, so one long line stretches it " +
			"and carries the OK off the end of the popup",
	);
});

test("the target and Start-with dropdowns are dark on solid light", () => {
	const css = read("shared/styles.css");
	const rule =
		/\.move-to-select,\s*\n\.move-to-new-file-input \{[\s\S]*?\n\}/.exec(
			css,
		)[0];
	assert.match(rule, /color: var\(--clr-black\)/);
	assert.match(rule, /background: var\(--clr-white\)/);
	assert.equal(
		/rgba\(255, 255, 255/.test(rule),
		false,
		"white on a near-transparent fill is invisible on the light " +
			".include-block, which shares this rule with the dark move-to block",
	);
});

test("the note rides on the title line, not a band under it", () => {
	const html = fs.readFileSync(path.join(SRC, "remote.html"), "utf-8");
	const row = /<div class="popup-title popup-title-row">[\s\S]*?<\/div>/.exec(
		html,
	);
	assert.ok(row, "the title and the note share one row element");
	assert.match(row[0], /id="mtoTitle"/);
	assert.match(row[0], /id="mtoNote"/);
	const css = read("shared/styles.css");
	assert.match(
		css,
		/\.popup-title-row \{[\s\S]*?display: flex/,
		"a block note would push the target down a line",
	);
});

test("no popup carries its own ✕ any more", () => {
	const html = fs.readFileSync(path.join(SRC, "remote.html"), "utf-8");
	assert.equal(
		/overlay-close-btn/.test(html),
		false,
		"the ✕ is chrome now: one button, outside the rotated popups",
	);
	assert.match(
		html,
		/id="overlayCloseBtn"[\s\S]*?class="mode-side-btn overlay-chrome-close"/,
	);
});

test("the chrome ✕ closes whichever popup is open, its own way", () => {
	const base = read("shared/remote/remote-overlay.js");
	assert.match(base, /function closeActiveOverlay\(\)/);
	assert.match(base, /overlay\.chromeClose\(\)/);
	assert.match(
		base,
		/chromeClose\(\) \{\s*\n\t\tthis\.closeUI\(\);/,
		"the default is a plain close; a popup that needs more overrides it",
	);
	const pairs = [
		["move-to-overlay.js", /chromeClose\(\) \{\s*\n\t\tthis\.confirm\(\)/],
		[
			"code-insert-overlay.js",
			/chromeClose\(\) \{\s*\n\t\tthis\.confirm\(\)/,
		],
		["question-overlay.js", /chromeClose\(\) \{\s*\n\t\tthis\.dismiss\(\)/],
		[
			"interaction-overlay.js",
			/chromeClose\(\) \{\s*\n\t\tthis\.closeOverlay\(\)/,
		],
	];
	for (const [file, re] of pairs)
		assert.match(
			read("shared/remote/" + file),
			re,
			file + " keeps its own exit",
		);
});

test("the chrome ✕ shows only while a popup is up", () => {
	const base = read("shared/remote/remote-overlay.js");
	const fn = /function syncOverlayChrome\(\)[\s\S]*?\n\}/.exec(base)[0];
	assert.match(fn, /open \? "" : "none"/);
	assert.match(
		fn,
		/classList\.toggle\("popup-open", open\)/,
		"the edit keys share that corner, so the body has to say a popup is up",
	);
	assert.match(base, /open\(bg\) \{[\s\S]*?syncOverlayChrome\(\)/);
	assert.match(base, /close\(\) \{[\s\S]*?syncOverlayChrome\(\)/);
});

test("the action buttons are centred, a tenth in from the right", () => {
	const css = read("shared/styles.css");
	for (const cls of ["mt-modal-actions", "ci-modal-actions"]) {
		const rule = new RegExp("\\." + cls + " \\{[\\s\\S]*?\\n\\}").exec(
			css,
		)[0];
		assert.match(rule, /position: absolute/, cls);
		assert.match(rule, /top: 50%/, cls);
		assert.match(rule, /right: 10%/, cls);
		assert.match(rule, /translateY\(-50%\)/, cls);
	}
	assert.equal(
		/--popup-actions-gutter/.test(css),
		false,
		"the body runs the full width now; the buttons float over it",
	);
});

test("the ✕ takes the physical top-right, and everything steps aside", () => {
	const css = read("shared/styles.css");
	const right = /body\.side-right \.overlay-chrome-close \{[\s\S]*?\n\}/.exec(
		css,
	)[0];
	assert.match(
		right,
		/bottom: 10px/,
		"physical right is page-bottom for side-right; page-top put it top-left",
	);
	assert.match(right, /right: 10px/, "physical top is page-right");

	const left = /body\.side-left \.overlay-chrome-close \{[\s\S]*?\n\}/.exec(
		css,
	)[0];
	assert.match(left, /left: 10px/);
	assert.match(
		left,
		/top: var\(--pad-header-gap\)/,
		"page-top is under the fixed header, which stays above the pad",
	);

	assert.match(
		css,
		/body\.popup-open\.side-right \.touchpad-edit-bar \{[\s\S]*?bottom: calc\(20px \+ var\(--popup-chrome-size\)\)/,
		"the edit keys own that corner too, so they move while a popup is up",
	);
});

test("a popup keeps its head clear of the mode buttons", () => {
	const css = read("shared/styles.css");
	const rule =
		/body\.side-right \.popup-modal,\s*\nbody\.side-left \.popup-modal \{[\s\S]*?\n\}/.exec(
			css,
		)[0];
	assert.match(
		rule,
		/padding-top: calc\(8px \+ var\(--popup-chrome-size\)\)/,
		"the mode buttons sit over the popup's top edge, so Go to: hid behind them",
	);
	assert.match(
		css,
		/--popup-chrome-size: 58px/,
		"58px is the measured height of a .mode-side-btn, not a guess",
	);
});

test("the note follows the comment block theme from Settings", () => {
	const { buildSettingsCSS } = require("../src/shared/blocks.js");
	const css = buildSettingsCSS({
		fontSize: 14,
		colors: {
			textColor: "#112233",
			commentNormal: "#ffe08a",
			codeBlockColor: "#fff",
			questionCommentColor: "#f0f",
			imageBlockColor: "#0ff",
			codeInsertBlockColor: "#eee",
			moveToBlockColor: "#424242",
			moveToTextColor: "#fff",
			commentActive: "#0f0",
			commentActiveText: "#000",
			commentSelected: "#ccc",
			selectedBorder: "#00f",
			cursor: "#f00",
		},
	});
	assert.match(
		css,
		/\.move-to-note,\s*\n\s*\.mt-modal-note \{ background: #ffe08a; color: #112233; \}/,
		"a note is a comment, so it wears whatever a comment block wears",
	);
	assert.match(
		css,
		/\.move-to-note::placeholder \{ color: #112233; \}/,
		"the hint text too, or it keeps the stock palette",
	);
});

test("the themed rule reaches the phone as well as the editor", () => {
	const remote = read("shared/remote/lesson.js");
	assert.match(
		remote,
		/buildSettingsCSS\(settings\)/,
		"the popup note is styled by the same generated sheet as the block",
	);
});

test("disabled controls are not faded; the active block carries the signal", () => {
	const css = read("shared/styles.css");
	assert.equal(
		/:has\(input:disabled\) \{[^}]*opacity/.test(css),
		false,
		"a half-transparent checkbox chip let the code under it show through",
	);
	assert.equal(
		/move-to-select:disabled \{[^}]*opacity/.test(css),
		false,
		"and a faded dropdown is just harder to read",
	);

	const { buildSettingsCSS } = require("../src/shared/blocks.js");
	const gen = buildSettingsCSS({
		fontSize: 14,
		colors: {
			textColor: "#111",
			commentNormal: "#ffe08a",
			codeBlockColor: "#fff",
			questionCommentColor: "#f0f",
			imageBlockColor: "#0ff",
			codeInsertBlockColor: "#eee",
			moveToBlockColor: "#424242",
			moveToTextColor: "#fff",
			commentActive: "#c8e6c9",
			commentActiveText: "#1b5e20",
			commentSelected: "#ccc",
			selectedBorder: "#00f",
			cursor: "#f00",
		},
	});
	assert.equal(
		/body\.typing-active/.test(gen),
		false,
		"colouring every block would make the active highlight meaningless",
	);
	assert.ok(
		gen.indexOf(".comment-block.active-comment") >
			gen.indexOf(".comment-block.move-to-comment"),
		"the active colour has to come after the subtype colours or a move-to " +
			"block never shows it: same specificity, so order decides",
	);
});
