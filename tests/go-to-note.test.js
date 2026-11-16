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
	lm.data = [{ type: "go-to", target: "MAIN" }];
	lm.markAsChanged = () => {};

	lm.updateGoToNote(0, "  because the bug is here  ");
	assert.equal(lm.data[0].note, "because the bug is here", "trimmed");

	lm.updateGoToNote(0, "   ");
	assert.equal(
		"note" in lm.data[0],
		false,
		"a blank note is deleted, so plans stay free of empty keys",
	);
});

test("only a go-to block takes a note", () => {
	const LessonManager = require("../src/renderer/lesson-manager.js");
	const lm = Object.create(LessonManager.prototype);
	lm.data = [{ type: "code", text: "x" }];
	lm.markAsChanged = () => {};
	assert.equal(lm.updateGoToNote(0, "hi"), false);
	assert.equal("note" in lm.data[0], false);
});

test("the popup shows the note, and hides the row when there is none", () => {
	const ctx = buildRemote();
	ctx.api.setAutoTypingActive(true);

	ctx.api.showGoToOverlay({ mode: "main", note: "we broke this earlier" });
	assert.equal(ctx.nodes.gtoNote.textContent, "we broke this earlier");
	assert.notEqual(ctx.nodes.gtoNote.style.display, "none");

	ctx.api.closeGoToOverlayUI();
	ctx.api.showGoToOverlay({ mode: "main" });
	assert.equal(ctx.nodes.gtoNote.textContent, "");
	assert.equal(
		ctx.nodes.gtoNote.style.display,
		"none",
		"an empty note must not leave a coloured band on the popup",
	);
});

test("a wide snippet scrolls instead of pushing the buttons away", () => {
	const css = read("shared/styles.css");
	const rule = /\.popup-excerpt \{[\s\S]*?\n\}/.exec(css)[0];
	assert.match(rule, /overflow: auto/);
	assert.match(
		rule,
		/min-width: 0/,
		"a flex item defaults to min-width:auto, so one long line stretches it " +
			"and carries the OK off the end of the popup",
	);
});

test("the note rides on the title line, not a band under it", () => {
	const html = fs.readFileSync(path.join(SRC, "remote.html"), "utf-8");
	const row = /<div class="popup-title popup-title-row">[\s\S]*?<\/div>/.exec(
		html,
	);
	assert.ok(row, "the title and the note share one row element");
	assert.match(row[0], /id="gtoTitle"/);
	assert.match(row[0], /id="gtoNote"/);
	const css = read("shared/styles.css");
	assert.match(
		css,
		/\.popup-title-row \{[\s\S]*?display: flex/,
		"a block note would push the target down a line",
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

test("the question and help buttons are centred in the band, but never within 20px of the ✕", () => {
	const css = read("shared/styles.css");
	const left =
		/body\.side-left #interactionSideBtns \{\s*top: max\(([\s\S]*?)\);/.exec(
			css,
		);
	assert.ok(
		left,
		"side-left takes the later of the two, the ✕ being at the header end",
	);
	assert.match(
		left[1],
		/calc\(var\(--side-band\) \/ 2 \+ var\(--header-h\) \+ 2px\)/,
	);
	assert.match(
		left[1],
		/calc\(var\(--pad-header-gap\) \+ 20px \+ 2 \* var\(--mode-btn-h, 58px\) \+ 2px\)/,
		"the ✕'s top, its height, the 20px gap and half the column",
	);
	const right =
		/body\.side-right #interactionSideBtns \{\s*top: min\(([\s\S]*?)\);/.exec(
			css,
		);
	assert.ok(
		right,
		"side-right the earlier, the ✕ being 10px off the page bottom",
	);
	assert.match(right[1], /calc\(100% - var\(--side-band\) \/ 2\)/);
	assert.match(
		right[1],
		/calc\(100% - 10px - 20px - 2 \* var\(--mode-btn-h, 58px\) - 2px\)/,
	);
});

test("the band is never too short for the ✕, the two interaction buttons and the modes' gap", () => {
	const css = read("shared/styles.css");
	const floor = (side) =>
		new RegExp(
			"body\\.side-" +
				side +
				" \\{\\s*--side-band-floor: calc\\(([^;]*)\\);",
		).exec(css)[1];
	assert.match(
		floor("right"),
		/10px \+ 20px \+ 3 \* var\(--mode-btn-h, 58px\) \+ 4px \+ 8px/,
	);
	assert.match(
		floor("left"),
		/var\(--pad-header-gap\) \+ 20px \+ 3 \* var\(--mode-btn-h, 58px\) \+ 4px \+ 8px/,
		"the header end is 64px longer: the ✕ starts under the header there",
	);
	assert.match(
		css,
		/body\.side-right,\s*body\.side-left \{\s*--side-band: max\(35%, var\(--side-band-floor\)\);/,
		"35% on a tall phone, which is every layout the band was tuned on",
	);
});

test("a short phone gets compact side buttons and a band packed from the ✕ end", () => {
	const css = read("shared/styles.css");
	const compact = /@media \(max-height: 800px\) \{([\s\S]*?)\n\}/.exec(css);
	assert.ok(
		compact,
		"below 800px the edge is ~717px of 58px buttons and cannot hold them",
	);
	assert.match(
		compact[1],
		/\.mode-side-btn \{\s*padding-top: 8px;\s*padding-bottom: 8px;/,
	);
	assert.match(
		compact[1],
		/\.touchpad-edit-bar \.pad-bar-btn,\s*\.touchpad-step-bar \.pad-bar-btn \{\s*padding-top: 6px;\s*padding-bottom: 6px;/,
	);
	assert.ok(
		css.indexOf("@media (max-height: 800px)") >
			css.indexOf("body.side-left .touchpad-step-bar {"),
		"after the bar rules it shrinks, since the selectors tie",
	);
	assert.match(
		css,
		/@media \(max-height: 700px\) \{\s*body\.side-right,\s*body\.side-left \{\s*--side-band: var\(--side-band-floor\);/,
		"and below 700px 35% of the edge is room the edit keys need more",
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
			codeColor: "#fff",
			questionColor: "#f0f",
			imageColor: "#0ff",
			snippetColor: "#eee",
			goToColor: "#424242",
			goToTextColor: "#fff",
			activeBlockColor: "#0f0",
			activeBlockTextColor: "#000",
			selectedBlockColor: "#ccc",
			selectedBorder: "#00f",
			cursor: "#f00",
		},
	});
	assert.match(
		css,
		/\.go-to-note,\s*\n\s*\.popup-note \{ background: #ffe08a; color: #112233; \}/,
		"a note on a go-to is still a note, so it wears the note colours",
	);
	assert.match(
		css,
		/\.go-to-note::placeholder \{ color: #112233; \}/,
		"the hint text too, or it keeps the stock palette",
	);
});

test("disabled controls are not faded; the active block carries the signal", () => {
	const { buildSettingsCSS } = require("../src/shared/blocks.js");
	const gen = buildSettingsCSS({
		fontSize: 14,
		colors: {
			textColor: "#111",
			noteColor: "#ffe08a",
			codeColor: "#fff",
			questionColor: "#f0f",
			imageColor: "#0ff",
			snippetColor: "#eee",
			goToColor: "#424242",
			goToTextColor: "#fff",
			activeBlockColor: "#c8e6c9",
			activeBlockTextColor: "#1b5e20",
			selectedBlockColor: "#ccc",
			selectedBorder: "#00f",
			cursor: "#f00",
		},
	});
	assert.equal(
		/body\.auto-typing-active/.test(gen),
		false,
		"colouring every block would make the active highlight meaningless",
	);
	assert.ok(
		gen.indexOf(".go-to-block.active-block") >
			gen.indexOf(".go-to-block { background"),
		"the active colour has to come after the per-type colours or a go-to " +
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

	assert.match(
		css,
		/body\.side-right \.touchpad-edit-bar \{[\s\S]*?var\(--modes-extent/,
		"it starts where the mode column ends, so the two read as one strip",
	);
});
