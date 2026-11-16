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
				broadcastSnippetStarted() {},
				broadcastSnippetEnded() {},
				broadcastGoToStarted() {},
				broadcastGoToEnded() {},
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
	popups.enterPopup("snippet", { text, paste: true });
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

test("a block that opts out of Paste still hijacks no clipboard", () => {
	const { popups, written } = harness();
	popups.enterPopup("snippet", { text: "a();\n   b();", paste: false });
	assert.deepEqual(written, []);
});
