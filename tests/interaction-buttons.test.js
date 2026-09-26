"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildRemote: build } = require("./helpers/remote-dom.js");

const SRC = path.resolve(__dirname, "..", "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf-8");

const hidden = (ctx) => ctx.interactionBtns.map((b) => b.style.display);

test("a note popup leaves the question and help buttons on screen", () => {
	const ctx = build();
	ctx.api.showNoteOverlay({ text: "Remember to save" });

	assert.deepEqual(hidden(ctx), [undefined, undefined]);
});

test("so do the other pausing popups: media, move-to and code snippet", () => {
	const ctx = build();
	ctx.api.showMediaOverlay({ kind: "image", name: "cat.png" });
	ctx.api.showMoveToOverlay({ mode: "main", target: "MAIN" });
	ctx.api.showCodeInsertOverlay({ code: "let a = 1;", paste: true });

	assert.deepEqual(hidden(ctx), [undefined, undefined]);
});

test("a lesson question still hides them: the picker would replace its window", () => {
	const ctx = build();
	ctx.api.showQuestionOverlay("Why?", ["Ada"], null, null);
	assert.deepEqual(hidden(ctx), ["none", "none"]);

	ctx.api.closeQuestionOverlayUI();
	assert.deepEqual(hidden(ctx), ["", ""]);
});

test("the picker itself hides them, and closing it brings them back", () => {
	const ctx = build();
	ctx.api.setStudents(["Ada", "Linus"]);
	ctx.api.handleInteractionBtn("providing-help");
	assert.deepEqual(hidden(ctx), ["none", "none"]);

	ctx.api.closeInteractionOverlay();
	assert.deepEqual(hidden(ctx), ["", ""]);
});

test("the picker keeps an open pad and floats over it, like any other popup", async () => {
	for (const type of ["student-question", "providing-help"]) {
		const ctx = build();
		ctx.api.setSessionActive(true);
		await ctx.api.setTouchpadMode("mouse");

		ctx.api.setStudents(["Ada", "Linus"]);
		ctx.api.handleInteractionBtn(type);

		assert.equal(
			ctx.api.padMode(),
			"mouse",
			type + " must not close the pad",
		);
		assert.equal(
			ctx.nodes.interactionOverlay.classList.contains("pad-lifted"),
			true,
			type + " rises above the glass, so its buttons stay pressable",
		);
	}
});

test("either pad opens over the picker, and the picker drops back when it closes", async () => {
	const ctx = build();
	ctx.api.setSessionActive(true);
	ctx.api.setStudents(["Ada"]);
	ctx.api.handleInteractionBtn("student-question");
	assert.equal(
		ctx.nodes.interactionOverlay.classList.contains("pad-lifted"),
		false,
	);

	await ctx.api.setTouchpadMode("mouse");
	assert.equal(ctx.api.padMode(), "mouse");
	await ctx.api.setTouchpadMode("keyboard");
	assert.equal(ctx.api.padMode(), "keyboard");
	assert.equal(
		ctx.nodes.interactionOverlay.classList.contains("pad-lifted"),
		true,
	);

	ctx.api.closeInteractionOverlay();
	assert.equal(
		ctx.api.padMode(),
		"keyboard",
		"closing the picker leaves the pad",
	);
	assert.equal(
		ctx.nodes.interactionOverlay.classList.contains("pad-lifted"),
		false,
	);
});

test("under a pad the form and Done stay pressable, the names and 🎲 go inert", () => {
	const css = read("shared/styles.css");
	const rule =
		/\n(\.overlay\.pad-lifted button[^{]*)\{[^}]*pointer-events: auto/.exec(
			css,
		)[1];
	for (const sel of [
		".overlay.pad-lifted button:not(.popup-student-btn)",
		".overlay.pad-lifted .popup-done-btn",
		".overlay.pad-lifted select",
		".overlay.pad-lifted input",
	]) {
		assert.ok(rule.includes(sel), sel);
	}
	assert.ok(
		!rule.includes("popup-action-btn"),
		"🎲 sits in the student grid and need not be reachable through a pad",
	);
	const src = read("shared/remote/interaction-overlay.js");
	assert.match(
		src,
		/done\.classList\.add\("popup-done-btn"\)/,
		"Done ends the help, it is not a name, so it must stay pressable",
	);
});

test("a pausing popup does not take the mouse pad away", async () => {
	const ctx = build();
	ctx.api.setSessionActive(true);
	await ctx.api.setTouchpadMode("mouse");

	ctx.api.showNoteOverlay({ text: "Remember to save" });

	assert.equal(ctx.api.padMode(), "mouse");
});

test("the picker stacks above the popups it can open over, and below the chrome", () => {
	const css = read("shared/styles.css");
	const z = (re) => Number(re.exec(css)[1]);
	const popup = z(/\n\.overlay \{[^}]*?z-index: (\d+)/);
	const picker = z(/#interactionOverlay \{\s*z-index: (\d+)/);
	const lifted = z(/\n\.overlay\.pad-lifted \{\s*z-index: (\d+)/);
	const liftedPicker = z(
		/#interactionOverlay\.pad-lifted \{\s*z-index: (\d+)/,
	);
	const header = z(/#mobile-header\.above-pad \{[^}]*?z-index: (\d+)/);

	assert.ok(
		picker > popup,
		"at the popups' own level the later element in the page wins",
	);
	assert.ok(picker < lifted, "and it stays under everything the pad lifts");
	assert.ok(
		liftedPicker > lifted,
		"lifted, it still opens over a lifted popup; its id rule outranks .pad-lifted",
	);
	assert.ok(liftedPicker < header, "and stays under the phone's top bar");
});

test("the close button dismisses the picker before the popup beneath it", () => {
	const ctx = build();
	ctx.api.setStudents(["Ada"]);
	ctx.api.showNoteOverlay({ text: "Remember to save" });
	ctx.api.handleInteractionBtn("student-question");
	assert.equal(
		ctx.nodes.interactionOverlay.classList.contains("active"),
		true,
	);

	ctx.api.closeActiveOverlay();

	assert.equal(
		ctx.nodes.interactionOverlay.classList.contains("active"),
		false,
	);
	assert.equal(ctx.nodes.noteOverlay.classList.contains("active"), true);
});

test("the pad's bar buttons take the width of the mode buttons, not of their glyph's font", async () => {
	const css = read("shared/styles.css");
	const btn = /\n\.pad-bar-btn \{[\s\S]*?\n\}/.exec(css)[0];
	assert.match(btn, /width: var\(--mode-btn-w/);

	const ctx = build();
	ctx.nodes.modeSideBtns.children = [
		{ offsetWidth: 0 },
		{
			offsetWidth: 46,
			getBoundingClientRect: () => ({ width: 45.6, height: 57.6 }),
		},
	];
	ctx.api.setSessionActive(true);
	await ctx.api.setTouchpadMode("mouse");

	assert.equal(
		ctx.root.style["--mode-btn-w"],
		"45.6px",
		"measured from the first mode button that is showing",
	);
	assert.equal(ctx.root.style["--mode-btn-h"], "57.6px");
});

test("enter and undo are turned counter-clockwise, on top of the rotation every glyph has", () => {
	const html = read("remote.html");
	for (const action of ["undo", "enter"]) {
		const btn = new RegExp(
			`remoteEditKey\\('${action}'\\)[\\s\\S]*?</button>`,
		).exec(html)[0];
		assert.match(btn, /class="side-btn-emoji pad-glyph-ccw"/, action);
	}
	const others = html.match(/class="side-btn-emoji pad-glyph-ccw"/g) || [];
	assert.equal(others.length, 2, "only the two arrows read sideways");

	const css = read("shared/styles.css");
	assert.match(css, /\.pad-glyph-ccw \{\s*rotate: -90deg;/);
});
