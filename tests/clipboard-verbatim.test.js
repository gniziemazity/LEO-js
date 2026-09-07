"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadModule } = require("./helpers/load-module");

function harness() {
	const written = [];
	let held = "";
	const clipboard = {
		readText: () => held,
		writeText: (t) => {
			held = t;
			written.push(t);
		},
	};
	const popups = loadModule("src/main/popups.js", {
		electron: { clipboard },
		"@computer-use/nut-js": { keyboard: {}, Key: {} },
		"./context": {
			settingsManager: { get: () => undefined },
			broadcastServer: {
				broadcastCodeInsertStarted() {},
				broadcastCodeInsertEnded() {},
				broadcastMoveToStarted() {},
				broadcastMoveToEnded() {},
			},
			hotkeyManager: {
				registerConfirmPopup() {},
				unregisterConfirmPopup() {},
			},
		},
		"./state": { pause() {}, unpause() {}, send() {} },
		"./remote-input": { warnRemoteInput() {} },
	});
	return { popups, written };
}

function held(text) {
	const { popups, written } = harness();
	popups.enterPopup("code-insert", { text, paste: true });
	return written[0];
}

test("the clipboard is the block's body, character for character", () => {
	const body = "a();\n   b();\n   c();";
	assert.equal(held(body), body);
});

test("tabs the author wrote stay tabs; nothing is translated", () => {
	const body = "a();\n\t\tb();";
	assert.equal(
		held(body),
		body,
		"a tab is the author's whitespace, not a level to re-express",
	);
});

test("a flat body pastes flat: no indentation is invented", () => {
	const body = "a();\nb();";
	assert.equal(
		held(body),
		body,
		"what the block shows is what lands, so the author stays in control",
	);
});

test("nothing rewrites a line's leading whitespace on the way out", () => {
	const src = fs.readFileSync(
		path.join(__dirname, "..", "src", "main", "popups.js"),
		"utf-8",
	);
	const fn = /function holdCodeOnClipboard\([\s\S]*?\n\}/.exec(src)[0];
	assert.equal(
		/replace\(/.test(fn),
		false,
		"the clipboard path must not transform the body it was handed",
	);
});

test("the renderer hands over the body with only anchors removed", () => {
	const src = fs.readFileSync(
		path.join(__dirname, "..", "src", "renderer", "cursor-manager.js"),
		"utf-8",
	);
	const fn = /_enterCodeInsertBlock\(step\) \{[\s\S]*?\n\t\}/.exec(src)[0];
	assert.match(fn, /const pasted = stripAnchors\(text\)/);
	assert.match(
		fn,
		/text: pasted,/,
		"no computed indentation may creep back between block and clipboard",
	);
	assert.match(
		fn,
		/addEntry\(\{ code_insert: text \}\)/,
		"the log still gets the raw body, anchors and all",
	);
});

test("a block that opts out of Paste still hijacks no clipboard", () => {
	const { popups, written } = harness();
	popups.enterPopup("code-insert", { text: "a();\n   b();", paste: false });
	assert.deepEqual(written, []);
});
