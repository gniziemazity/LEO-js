"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const BASE = path.resolve(__dirname, "..", "src");
const { getBlockSubtype, buildSettingsCSS, BLOCK_SUBTYPES } = require(
	path.join(BASE, "shared/blocks.js"),
);
const SettingsManager = require(path.join(BASE, "main/settings-manager.js"));

test("each special prefix names its subtype", () => {
	assert.equal(getBlockSubtype("❓ why"), "question-comment");
	assert.equal(getBlockSubtype("🖼️ pic.png"), "image-comment");
	assert.equal(getBlockSubtype("🌐 http://x"), "web-comment");
	assert.equal(getBlockSubtype("📋 paste me"), "code-insert-comment");
	assert.equal(getBlockSubtype("➡️ MAIN"), "move-to-comment");
	assert.equal(getBlockSubtype("plain comment"), null);
});

test("leading whitespace does not hide a prefix", () => {
	assert.equal(getBlockSubtype("   ❓ why"), "question-comment");
});

test("a missing text is not a crash", () => {
	assert.equal(getBlockSubtype(null), null);
	assert.equal(getBlockSubtype(undefined), null);
});

test("every colour the app can set reaches the stylesheet", () => {
	const settings = new SettingsManager().defaultSettings;
	const css = buildSettingsCSS(settings);
	for (const [key, value] of Object.entries(settings.colors)) {
		assert.ok(
			css.includes(value),
			`colors.${key} (${value}) never appears in the generated CSS`,
		);
	}
});

test("remote.html loads the shared modules before the scripts that use them", () => {
	const html = fs.readFileSync(path.join(BASE, "remote.html"), "utf-8");
	const order = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(
		(m) => m[1],
	);

	const at = (name) => {
		const i = order.indexOf(name);
		assert.ok(i >= 0, `${name} is not loaded by remote.html at all`);
		return i;
	};

	const DEPENDENTS = {
		"blocks.js": ["remote/lesson.js"],
		"move-to-target.js": ["remote/lesson.js", "remote/move-to-overlay.js"],
	};

	for (const [shared, users] of Object.entries(DEPENDENTS)) {
		for (const user of users) {
			assert.ok(at(shared) < at(user), `${shared} must load before ${user}`);
		}
	}
});

test("the remote no longer carries its own copy of the shared functions", () => {
	const lesson = fs.readFileSync(
		path.join(BASE, "shared/remote/lesson.js"),
		"utf-8",
	);
	assert.ok(
		!/function getBlockSubtype/.test(lesson),
		"a second getBlockSubtype is how the two copies drifted before",
	);
	assert.ok(!/function buildSettingsCSS/.test(lesson));
});

test("the subtype table and the classifier agree", () => {
	for (const [prefix, subtype] of BLOCK_SUBTYPES) {
		assert.equal(getBlockSubtype(`${prefix} something`), subtype);
	}
});
