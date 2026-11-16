"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { loadModule } = require("./helpers/load-module");

const LessonRenderer = loadModule("src/renderer/lesson-renderer.js", {
	electron: { ipcRenderer: { send() {}, on() {} } },
});

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

test("Tab types a real tab inside a snippet block", () => {
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
