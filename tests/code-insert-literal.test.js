"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
	isLiteralCodeInsert,
	TextState,
	applyAtomicText,
} = require("../lesson_tools/shared/simulator-model.js");

function fresh() {
	const st = new TextState();
	st.text = "";
	st.charTs = [];
	st.cursor = 0;
	return st;
}

function applied(body) {
	const st = fresh();
	applyAtomicText(st, body);
	return st;
}

test("a body that indents itself is inserted exactly as written", () => {
	assert.equal(isLiteralCodeInsert("a();\n   b();"), true);
	assert.equal(applied("a();\n   b();").text, "a();\n   b();");
});

test("tabs are just as much the author's choice as spaces", () => {
	assert.equal(applied("a();\n\t\t\t\tb();").text, "a();\n\t\t\t\tb();");
});

test("a body with no indentation of its own still auto-indents", () => {
	assert.equal(isLiteralCodeInsert("a();\nb();"), false);
	const st = fresh();
	applyAtomicText(st, "if (x) {\nb();");
	assert.equal(
		st.text,
		"if (x) {\n\tb();",
		"every recorded lesson is written this way; its replay must not move",
	);
});

test("a keystroke body is never literal, however it is indented", () => {
	for (const body of ["⛔↑►\n   <div>", "a();\n   b();⌫⌫", "↩x\n   y"])
		assert.equal(
			isLiteralCodeInsert(body),
			false,
			`${body} drives the editor; its glyphs are not text`,
		);
});

test("letters that the engine ignores are still letters", () => {
	assert.equal(
		isLiteralCodeInsert('const s = "café";\n   more();'),
		true,
		"é is in IGNORED_CHARS; treating it as a control glyph would " +
			"turn any accented lesson into a keystroke stream",
	);
});

test("< and > are not the cursor glyphs ◄ ►", () => {
	assert.equal(isLiteralCodeInsert("if (a > b) {\n   c();\n}"), true);
});

test("a single line has no indentation to carry, so nothing changes", () => {
	assert.equal(isLiteralCodeInsert("just();"), false);
});

test("the model inserts a literal body without touching it", () => {
	const st = fresh();
	applyAtomicText(st, "if (x) {\n      deep();\n}");
	assert.equal(
		st.text,
		"if (x) {\n      deep();\n}",
		"auto-indent would have rewritten the six spaces the author chose",
	);
});

test("anchors are positions in a literal body too, never text", () => {
	const st = fresh();
	applyAtomicText(st, "a();⚓4⚓\n   b();");
	assert.equal(st.text.includes("⚓"), false);
	assert.equal(st.anchors["4"], "a();".length);
});
