"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC = path.join(__dirname, "..", "src");
const read = (p) => fs.readFileSync(path.join(SRC, p), "utf-8");

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
