"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { pickWindow, maximizeScript } = require("../src/main/vscode-window");

const win = (handle, title, size = 800) => ({
	handle,
	title,
	width: size,
	height: size,
});

test("a VS Code window that opened after the launch is the one maximized", () => {
	const before = new Set([1]);
	const windows = [
		win(1, "notes.md - part_1 - Visual Studio Code"),
		win(2, "Visual Studio Code"),
	];
	assert.equal(pickWindow(windows, before, "part_1").handle, 2);
});

test("VS Code reuses a window that already has the folder open", () => {
	const before = new Set([1, 3]);
	const windows = [
		win(1, "app.js - other - Visual Studio Code"),
		win(3, "index.html - part_1 - Visual Studio Code"),
	];
	assert.equal(pickWindow(windows, before, "part_1").handle, 3);
});

test("helper windows, other apps and unrelated VS Code windows are never picked", () => {
	const windows = [
		win(7, "Visual Studio Code", 1),
		win(8, "Google Chrome - Visual Studio Code tips"),
		win(9, "app.js - other - Visual Studio Code"),
	];
	assert.equal(pickWindow(windows, new Set([9]), "part_1"), null);
	assert.equal(pickWindow(windows, new Set([9]), null), null);
});

test("the maximize script only ever carries a number, twice", () => {
	const script = maximizeScript(42.4);
	assert.deepEqual(script.match(/\[LeoWindow\]::Maximize\([^)]*\)/g), [
		"[LeoWindow]::Maximize(42)",
		"[LeoWindow]::Maximize(42)",
	]);
	assert.match(script, /ShowWindow\(new IntPtr\(handle\), 3\)/, "SW_MAXIMIZE");
	assert.equal(maximizeScript("1); Remove-Item C:\\"), null);
});
