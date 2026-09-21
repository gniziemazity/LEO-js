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

test("the note wears the note colours on both surfaces", () => {
	const css = read("shared/styles.css");
	for (const sel of [".mt-modal-note", ".move-to-note"]) {
		const rule = new RegExp(
			sel.replace(".", "\\.") + " \\{[\\s\\S]*?\\n\\}",
		).exec(css)[0];
		assert.match(rule, /var\(--clr-note-bg\)/, sel + " background");
		assert.match(rule, /var\(--clr-note-text\)/, sel + " text");
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

test("the target picker is dark on solid light", () => {
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
		"white on a near-transparent fill depends on the block behind it; " +
			"solid white reads the same on every move-to colour",
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
	assert.match(base, /open\(bg\) \{[\s\S]*?syncOverlayChrome\(\)/);
	assert.match(base, /close\(\) \{[\s\S]*?syncOverlayChrome\(\)/);
});

test("the action buttons are centred, and flush with the ✕ on the right", () => {
	const css = read("shared/styles.css");
	for (const cls of ["mt-modal-actions"]) {
		const rule = new RegExp("\\." + cls + " \\{[\\s\\S]*?\\n\\}").exec(
			css,
		)[0];
		assert.match(rule, /position: absolute/, cls);
		assert.match(rule, /top: 50%/, cls);
		assert.match(
			rule,
			/right: 0;/,
			cls + ": the popup's edge is the ✕'s edge",
		);
		assert.match(rule, /translateY\(-50%\)/, cls);
	}
	assert.equal(
		/--popup-actions-gutter/.test(css),
		false,
		"the body runs the full width now; the buttons float over it",
	);
});

test("the popup's right edge is the ✕'s right edge, on whichever side the phone is held", () => {
	const css = read("shared/styles.css");
	assert.match(
		css,
		/body\.side-right \.popup-modal \{\s*width: calc\(100% \+ 4px\);/,
		"the ✕ is 10px from the physical right, the popup's padding is 14px",
	);
	assert.match(
		css,
		/body\.side-left \.popup-modal \{\s*width: calc\(100% \+ 2px\);/,
		"the ✕ is 74px from the physical right, the popup's padding is 14 + 62",
	);
	assert.match(
		css,
		/:root \{[\s\S]*?--pad-header-gap: 74px;/,
		"the ✕ sits outside the pad overlay, so it cannot read a variable defined only there: " +
			"without it `top` was invalid and the ✕ landed mid-screen in side-left",
	);
});

test("the ✕ is the size of the other side buttons, with a glyph that does not outweigh them", () => {
	const css = read("shared/styles.css");
	const rule = /\.overlay-chrome-close \{[\s\S]*?\n\}/.exec(css)[0];
	assert.match(rule, /width: var\(--mode-btn-w/);
	assert.match(rule, /height: var\(--mode-btn-h/);
	assert.match(
		css,
		/\.overlay-chrome-close \.side-btn-emoji \{\s*scale: 0\.8;/,
		"a text ✕ fills its advance where an emoji does not; scale composes with the rotation",
	);
});

test("in side-left the question and help buttons clear the ✕ at the header end", () => {
	const css = read("shared/styles.css");
	assert.match(
		css,
		/body\.side-left #interactionSideBtns \{\s*top: calc\(var\(--side-band\) \/ 2 \+ var\(--header-h\) \+ 2px\);/,
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
		/body\.side-right \.touchpad-edit-bar \{[\s\S]*?top: 10px/,
		"the edit keys sit at the other end of the top edge now, where the " +
			"jedi strip goes, so nothing has to step aside for the ✕",
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

test("the note follows the note block theme from Settings", () => {
	const { buildSettingsCSS } = require("../src/shared/blocks.js");
	const css = buildSettingsCSS({
		fontSize: 14,
		colors: {
			textColor: "#112233",
			noteColor: "#ffe08a",
			codeBlockColor: "#fff",
			questionColor: "#f0f",
			imageBlockColor: "#0ff",
			snippetColor: "#eee",
			moveToBlockColor: "#424242",
			moveToTextColor: "#fff",
			activeBlockColor: "#0f0",
			activeBlockTextColor: "#000",
			selectedBlockColor: "#ccc",
			selectedBorder: "#00f",
			cursor: "#f00",
		},
	});
	assert.match(
		css,
		/\.move-to-note,\s*\n\s*\.mt-modal-note \{ background: #ffe08a; color: #112233; \}/,
		"a note on a move-to is still a note, so it wears the note colours",
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
			noteColor: "#ffe08a",
			codeBlockColor: "#fff",
			questionColor: "#f0f",
			imageBlockColor: "#0ff",
			snippetColor: "#eee",
			moveToBlockColor: "#424242",
			moveToTextColor: "#fff",
			activeBlockColor: "#c8e6c9",
			activeBlockTextColor: "#1b5e20",
			selectedBlockColor: "#ccc",
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
		gen.indexOf(".move-to-block.active-block") >
			gen.indexOf(".move-to-block { background"),
		"the active colour has to come after the per-kind colours or a move-to " +
			"block never shows it: same specificity, so order decides",
	);
});

test("the edit keys sit beside the mode buttons, not at the far edge", () => {
	const css = read("shared/styles.css");
	const btn = /\.touchpad-edit-bar \.pad-bar-btn \{[\s\S]*?\n\}/.exec(css)[0];
	assert.match(
		btn,
		/line-height: normal/,
		".pad-bar-btn pins line-height: 1, and in vertical writing-mode the " +
			"line box is the horizontal size — that is what made these narrower " +
			"than every other side button, at 38px against 45.6",
	);
	const html = fs.readFileSync(path.join(SRC, "remote.html"), "utf-8");
	assert.match(
		html,
		/class="mode-side-btn pad-bar-btn"/,
		"they wear the same base class as every other side button, so the box " +
			"is derived the same way instead of pinned to a measured pixel",
	);
	assert.equal(/pad-btn-emoji/.test(html), false, "and the same emoji span");

	assert.match(
		css,
		/body\.side-right \.touchpad-edit-bar \{[\s\S]*?var\(--modes-extent/,
		"it starts where the mode column ends, so the two read as one strip",
	);
	const pad = read("shared/remote/touchpad.js");
	assert.match(
		pad,
		/setProperty\(\s*"--modes-extent"/,
		"the column is two buttons or three depending on whether jedi is " +
			"installed, so its height is measured rather than guessed",
	);
	assert.match(
		pad,
		/function syncTouchpadToolbar\(\) \{\s*\n\tpublishModesExtent\(\);/,
		"republished whenever the buttons change",
	);
});
