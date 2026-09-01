"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const model = require("../lesson_tools/shared/simulator-model.js");
const {
	TextState,
	CLIPBOARD,
	CLIPBOARD_CHARS,
	CUT_CHAR,
	COPY_CHAR,
	PASTE_CHAR,
	resetClipboard,
	applyTypedText,
	applyAtomicText,
} = model;
const { NUTJS_KEY_MAPPING } = require("../src/shared/constants");

function typedState(text) {
	resetClipboard();
	const s = new TextState();
	applyTypedText(s, text);
	return s;
}

function replayEngine() {
	const dir = path.join(__dirname, "..", "lesson_tools", "shared");
	const src = ["text-state.js", "simulator-model.js", "simulator-replay.js"]
		.map((f) => fs.readFileSync(path.join(dir, f), "utf-8"))
		.join("\n");
	const make = new Function("window", `${src}\nreturn { headlessReplay };`);
	return make({}).headlessReplay;
}

function keyEvents(text) {
	let t = 0;
	return [...text].map((ch) => ({ char: ch, timestamp: t++ }));
}

test("every clipboard glyph is in NUTJS_KEY_MAPPING", () => {
	const { Key } = require("@computer-use/nut-js");
	for (const ch of CLIPBOARD_CHARS) assert.ok(NUTJS_KEY_MAPPING[ch], ch);
	assert.deepEqual(NUTJS_KEY_MAPPING[CUT_CHAR], {
		modifier: Key.LeftControl,
		key: Key.X,
	});
	assert.deepEqual(NUTJS_KEY_MAPPING[COPY_CHAR], {
		modifier: Key.LeftControl,
		key: Key.C,
	});
	assert.deepEqual(NUTJS_KEY_MAPPING[PASTE_CHAR], {
		modifier: Key.LeftControl,
		key: Key.V,
	});
});

test("cut takes the shift-selected range", () => {
	const s = typedState("one↩two↩three↑↑◄⇓⇓✂");
	assert.equal(s.text, "three");
	assert.equal(CLIPBOARD.text, "one\ntwo\n");
	assert.equal(s.cursor, 0);
});

test("cut with no selection takes the whole line, newline included", () => {
	const s = typedState("one↩two↩three↑►✂");
	assert.equal(s.text, "one\nthree");
	assert.equal(CLIPBOARD.text, "two\n");
});

test("copy leaves the text where it is", () => {
	const s = typedState("one↩two↩three↑↑◄⇓⇓⧉");
	assert.equal(s.text, "one\ntwo\nthree");
	assert.equal(CLIPBOARD.text, "one\ntwo\n");
});

test("paste is literal - a pasted newline is not re-indented", () => {
	const s = typedState("a↩b↑◄⇓✂");
	assert.equal(s.text, "b");
	applyTypedText(s, "►↩if (x) {↩📥");
	assert.equal(s.text, "b\nif (x) {\n\ta\n");
});

test("the clipboard is shared across files", () => {
	const src = typedState("moved↩◄⇑✂");
	assert.equal(src.text, "");
	const dst = new TextState();
	applyTypedText(dst, "before↩📥");
	assert.equal(dst.text, "before\nmoved\n");
});

test("paste replaces an active selection", () => {
	const s = typedState("keep↩drop↑◄⇓⧉");
	applyTypedText(s, "📥");
	assert.equal(s.text, "keep\nkeep\ndrop");
});

test("a cut collapses an anchor inside it to the cut point", () => {
	const s = typedState("a↩⚓7⚓b↩c↑↑◄⇓⇓✂");
	assert.equal(s.text, "c");
	assert.equal(s.anchors["7"], 0);
});

test("clipboard glyphs work inside an atomic code insert", () => {
	resetClipboard();
	const s = new TextState();
	applyAtomicText(s, "one↩two↩three↑↑◄⇓⇓✂►📥");
	assert.equal(s.text, "threeone\ntwo\n");
});

test("headlessReplay cuts and pastes like the model", () => {
	const headlessReplay = replayEngine();
	const script = "one↩two↩three↑↑◄⇓⇓✂►↩📥";
	const res = headlessReplay(keyEvents(script));
	const expected = typedState(script);
	assert.equal(res.files.get("MAIN").text, expected.text);
	for (const ch of CLIPBOARD_CHARS) {
		assert.equal(res.files.get("MAIN").text.includes(ch), false);
	}
});

test("headlessReplay resets the clipboard between runs", () => {
	const headlessReplay = replayEngine();
	headlessReplay(keyEvents("secret↩◄⇑⧉"));
	const res = headlessReplay(keyEvents("📥done"));
	assert.equal(res.files.get("MAIN").text, "done");
});

test("every paste glyph is a clipboard glyph, and they all mean the same thing", () => {
	const { PASTE_CHAR, PASTE_CHARS, CLIPBOARD_LABELS } = model;

	assert.equal(PASTE_CHAR, "📥", "the one the toolbar inserts");
	assert.deepEqual(
		[...PASTE_CHARS].sort(),
		["📥"],
		"one spelling of paste, so a plan cannot carry an unmapped one",
	);
	for (const ch of PASTE_CHARS) {
		assert.ok(
			CLIPBOARD_CHARS.has(ch),
			`${ch} must reach applyClipboardChar at all`,
		);
		assert.equal(CLIPBOARD_LABELS[ch], "Paste", `${ch} must be labelled`);
	}
});

test("the app types every paste glyph as Ctrl+V", () => {
	const { PASTE_CHARS } = model;
	for (const ch of PASTE_CHARS) {
		const mapped = NUTJS_KEY_MAPPING[ch];
		assert.ok(mapped, `${ch} must be mapped, or nut-js types it literally`);
		assert.equal(mapped.key, NUTJS_KEY_MAPPING["📥"].key);
		assert.equal(mapped.modifier, NUTJS_KEY_MAPPING["📥"].modifier);
	}
});
