"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { readCodeText } = require("../src/shared/code-text.js");
const {
	isLiteralCodeInsert,
} = require("../lesson_tools/shared/simulator-model.js");

const { loadModule } = require("./helpers/load-module");

const LessonRenderer = loadModule("src/renderer/lesson-renderer.js", {
	electron: { ipcRenderer: { send() {}, on() {} } },
});

const SRC = fs.readFileSync(
	path.join(__dirname, "..", "src", "renderer", "lesson-renderer.js"),
	"utf-8",
);

function handlers(allowTab) {
	const el = { onpaste: null, onkeydown: null };
	const inserted = [];
	const prevDoc = global.document;
	global.document = { execCommand: (_c, _u, text) => inserted.push(text) };
	try {
		LessonRenderer.prototype.attachEditHandlers.call({}, el, allowTab);
	} finally {
		if (prevDoc === undefined) delete global.document;
		else global.document = prevDoc;
	}
	return { el, inserted, restore: () => {} };
}

function withDoc(inserted, fn) {
	const prevDoc = global.document;
	global.document = { execCommand: (_c, _u, text) => inserted.push(text) };
	try {
		return fn();
	} finally {
		if (prevDoc === undefined) delete global.document;
		else global.document = prevDoc;
	}
}
function press(el, inserted, key, shiftKey = false) {
	let prevented = false;
	withDoc(inserted, () =>
		el.onkeydown({ key, shiftKey, preventDefault: () => (prevented = true) }),
	);
	return prevented;
}

test("Tab types a real tab inside a code-insert block", () => {
	const { el, inserted } = handlers(true);
	assert.equal(
		press(el, inserted, "Tab"),
		true,
		"the browser must not move focus",
	);
	assert.deepEqual(inserted, ["\t"], "a real tab, not the ― glyph");
});

test("Shift+Tab still leaves the block, so there is a way out", () => {
	const { el, inserted } = handlers(true);
	assert.equal(press(el, inserted, "Tab", true), false);
	assert.deepEqual(inserted, []);
});

test("other blocks keep Tab for focus: ― is what a code block wants", () => {
	const { el, inserted } = handlers(false);
	assert.equal(press(el, inserted, "Tab"), false);
	assert.deepEqual(inserted, []);
});

test("only the code snippet block is handed the tab key", () => {
	assert.match(
		SRC,
		/attachEditHandlers\(blockDiv, kind === "snippet"\)/,
		"a raw tab in a code block would be typed as a character, not pressed",
	);
});

test("a tab the author typed survives being read back off the block", () => {
	const el = {
		childNodes: [{ nodeType: 3, data: "a();\n\tb();" }],
	};
	assert.equal(readCodeText(el), "a();\n\tb();");
});

test("a tab at the start is indentation the author owns", () => {
	assert.equal(
		isLiteralCodeInsert("a();\n\tb();"),
		true,
		"a tab counts as the body indenting itself, so it pastes verbatim",
	);
});
