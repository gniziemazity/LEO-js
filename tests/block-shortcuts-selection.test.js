"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const APP_SRC = fs.readFileSync(
	path.resolve(__dirname, "..", "src/renderer/app.js"),
	"utf-8",
);

function funcBody(name) {
	const re = new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`);
	const m = re.exec(APP_SRC);
	assert.ok(m, `${name} not found`);
	return m[0];
}

test("the hover-based block lookup is gone", () => {
	assert.ok(
		!APP_SRC.includes("hoveredBlockIndex"),
		"a hover-based block index still exists somewhere in app.js",
	);
	assert.ok(
		!APP_SRC.includes(":hover"),
		"a native :hover query still decides which block a shortcut acts on",
	);
});

test("block shortcuts (delete, copy, paste, move, add) act on the selected block", () => {
	const body = funcBody("setupBlockShortcuts");
	assert.match(
		body,
		/const blockIdx = uiManager\.getSelectedBlockIndex\(\);/,
		"Ctrl+Up/Down, delete, copy, paste and add-block must read the " +
			"selection, not whatever the mouse happens to be over",
	);

	for (const action of [
		"lessonManager.canRemoveBlock(blockIdx)",
		"blockEditor.removeBlock(blockIdx)",
		"blockEditor.copyBlock(blockIdx)",
		"blockEditor.pasteBlock(blockIdx)",
		"lessonManager.canMoveBlock(blockIdx, delta)",
		"blockEditor.moveBlock(blockIdx, delta)",
	]) {
		assert.ok(
			body.includes(action),
			`${action} no longer keys off the selected block`,
		);
	}
});

test("Ctrl+Up/Down navigates the selection; Ctrl+Shift+Up/Down moves the block", () => {
	const body = funcBody("setupBlockShortcuts");

	const moveBranch =
		/if \(\(key === "arrowup" \|\| key === "arrowdown"\) && e\.shiftKey\) \{[\s\S]*?\n\t\t\}/.exec(
			body,
		);
	assert.ok(moveBranch, "the shifted arrow-key branch (move) is missing");
	assert.match(moveBranch[0], /blockEditor\.moveBlock\(blockIdx, delta\)/);
	assert.match(
		moveBranch[0],
		/lessonManager\.canMoveBlock\(blockIdx, delta\)/,
	);

	const afterMove = body.slice(
		body.indexOf(moveBranch[0]) + moveBranch[0].length,
	);
	const navBranch =
		/if \(key === "arrowup" \|\| key === "arrowdown"\) \{[\s\S]*?\n\t\t\}/.exec(
			afterMove,
		);
	assert.ok(navBranch, "the unshifted arrow-key branch (navigate) is missing");
	assert.ok(
		!/e\.shiftKey/.test(navBranch[0]),
		"plain Ctrl+Up/Down must not require or check shift",
	);
	assert.match(navBranch[0], /uiManager\.selectBlock\(next\)/);
	assert.match(navBranch[0], /lessonRenderer\.render\(\)/);
	assert.match(
		navBranch[0],
		/lessonManager\.firstAuthoredIndex\(\)/,
		"navigation must not select into the inherited/include run",
	);
	assert.ok(
		!/blockEditor\.moveBlock/.test(navBranch[0]),
		"plain Ctrl+Up/Down must not move the block",
	);
});
