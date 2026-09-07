"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC = path.join(__dirname, "..", "src");
const read = (p) => fs.readFileSync(path.join(SRC, p), "utf-8");

test("the lock is asked for on a gesture the pad cannot swallow", () => {
	const conn = read("shared/remote/connection.js");
	assert.match(
		conn,
		/for \(const gesture of \["pointerdown", "touchend", "click"\]\)/,
		"padListener preventDefaults touchstart, which suppresses the synthetic " +
			"click, so a click-only trigger never fires over the pad",
	);
	assert.match(
		conn,
		/document\.addEventListener\(gesture, goFullscreen, \{ capture: true \}\)/,
		"capture, so nothing downstream can stop it reaching the document",
	);
});

test("fullscreen comes first, because the lock needs it", () => {
	const conn = read("shared/remote/connection.js");
	const fn = /function goFullscreen\(\)[\s\S]*?\n\}/.exec(conn)[0];
	assert.match(
		fn,
		/document\.fullscreenElement \|\| document\.webkitFullscreenElement/,
		"already fullscreen means the lock is all that is left to do",
	);
	assert.match(fn, /entering\.then\(lockPortrait/);
});

test("a phone that cannot lock is left alone, not broken", () => {
	const conn = read("shared/remote/connection.js");
	const fn = /function lockPortrait\(\)[\s\S]*?\n\}/.exec(conn)[0];
	assert.match(
		fn,
		/typeof orientation\.lock !== "function"/,
		"iOS Safari has no screen.orientation.lock; it must not throw there",
	);
	assert.match(
		fn,
		/catch\(\(\) => \{\}\)/,
		"and a refused lock is not an error",
	);
});

test("the manifest asks for portrait, and is where the server can serve it", () => {
	const file = path.join(SRC, "shared", "manifest.json");
	assert.equal(
		fs.existsSync(file),
		true,
		"express.static serves src/shared at the root, so this is /manifest.json",
	);
	const m = JSON.parse(fs.readFileSync(file, "utf-8"));
	assert.equal(m.orientation, "portrait");
	assert.equal(
		m.display,
		"fullscreen",
		"installed to the home screen this locks portrait with no gesture at all",
	);
	assert.match(
		read("remote.html"),
		/<link rel="manifest" href="\/manifest\.json" \/>/,
	);
});
