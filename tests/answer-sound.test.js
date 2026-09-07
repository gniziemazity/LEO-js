"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const APP = path.join(ROOT, "src", "renderer", "app.js");

function soundDir() {
	const src = fs.readFileSync(APP, "utf-8");
	const call = /const soundPath = path\.join\(([^)]*)\);/.exec(src);
	assert.ok(call, "app.js must build soundPath from __dirname");
	const parts = call[1]
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s !== "__dirname")
		.map((s) => s.replace(/^["']|["']$/g, ""));
	return path.join(ROOT, "src", "renderer", ...parts);
}

test("the answer sound is where the renderer looks for it", () => {
	const dir = soundDir();
	assert.equal(
		fs.existsSync(dir),
		true,
		`app.js resolves soundPath to ${path.relative(ROOT, dir)}, which does not exist — ` +
			"the fireworks play silently because the load failure is only a console.warn",
	);
});

test("the file the renderer names is actually in that folder", () => {
	const src = fs.readFileSync(APP, "utf-8");
	const name = /soundPath,\s*\n?\s*"([^"]+\.mp3)"/.exec(src);
	assert.ok(name, "app.js must name the sound file it loads");
	assert.equal(
		fs.existsSync(path.join(soundDir(), name[1])),
		true,
		`${name[1]} is missing from the sound folder`,
	);
});

test("the sound folder ships in the build", () => {
	const build = require(path.join(ROOT, "package.json")).build;
	const files = build.files || [];
	const rel = path
		.relative(ROOT, soundDir())
		.replace(/\\/g, "/")
		.split("/")[0];
	const excluded = files.some(
		(f) => f.startsWith("!") && f.slice(1).split("/")[0] === rel,
	);
	assert.equal(
		excluded,
		false,
		`the build excludes ${rel}/, so the packaged app would have no sound`,
	);
});
