"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

globalThis.document = globalThis.document || { createElement: () => ({}) };

const { readCodeText } = require("../src/shared/code-text");

const txt = (data) => ({ nodeType: 3, data, childNodes: [] });
const br = () => ({ nodeType: 1, nodeName: "BR", childNodes: [] });
const div = (...childNodes) => ({
	nodeType: 1,
	nodeName: "DIV",
	childNodes,
});
const root = (...childNodes) => ({ childNodes });

test("a plain text node is returned verbatim", () => {
	assert.equal(readCodeText(root(txt("foobar"))), "foobar");
});

test("a trailing newline in the text node survives", () => {
	assert.equal(readCodeText(root(txt("foo\n"))), "foo\n");
});

test("Enter at the end counts once, not twice", () => {
	assert.equal(readCodeText(root(txt("foo"), div(br()))), "foo\n");
});

test("two Enters at the end count twice", () => {
	assert.equal(
		readCodeText(root(txt("foo"), div(br()), div(br()))),
		"foo\n\n",
	);
});

test("a line block with content contributes its break and its text", () => {
	assert.equal(readCodeText(root(txt("foo"), div(txt("bar")))), "foo\nbar");
});

test("a break inside a line block is kept", () => {
	assert.equal(readCodeText(root(txt("a"), div(txt("\nb")))), "a\n\nb");
});

test("a bare br is one newline", () => {
	assert.equal(readCodeText(root(txt("a"), br(), txt("b"))), "a\nb");
});

test("a br alongside content is not treated as a placeholder", () => {
	assert.equal(readCodeText(root(txt("a"), div(br(), txt("b")))), "a\n\nb");
});

test("nested line blocks each contribute one break", () => {
	assert.equal(
		readCodeText(root(txt("a"), div(txt("b"), div(txt("c"))))),
		"a\nb\nc",
	);
});

test("an empty block reads as empty", () => {
	assert.equal(readCodeText(root()), "");
});

test("a lone br is the empty-editable placeholder, not a newline", () => {
	assert.equal(
		readCodeText(root(br())),
		"",
		"Chromium puts this br in an empty contenteditable to give it a line " +
			"box; reading it as a newline writes a newline into the lesson",
	);
	const island = {
		nodeName: "DIV",
		dataset: { blockOpt: "1" },
		childNodes: [],
	};
	assert.equal(
		readCodeText(root(br(), island)),
		"",
		"the island does not stop the br from being the placeholder",
	);
	assert.equal(
		readCodeText(root(island, br())),
		"",
		"nor does the order they sit in",
	);
});

test("a real newline is a line div, so it still reads as one", () => {
	assert.equal(
		readCodeText(root(div(br()))),
		"\n",
		"writeCodeText stores a newline as <div><br></div>, never a bare br",
	);
});
