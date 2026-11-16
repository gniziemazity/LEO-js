"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const BASE = path.resolve(__dirname, "..", "src");
const { getBlockType, buildSettingsCSS } = require(
	path.join(BASE, "shared/blocks.js"),
);
const SettingsManager = require(path.join(BASE, "main/settings-manager.js"));

test("each special prefix names its type", () => {
	assert.equal(getBlockType("❓ why"), "question");
	assert.equal(getBlockType("🖼️ pic.png"), "image");
	assert.equal(getBlockType("🌐 http://x"), "web");
	assert.equal(getBlockType("📋 paste me"), "snippet");
	assert.equal(
		getBlockType("plain words"),
		"note",
		"a block with no prefix is a note, not a nameless leftover",
	);
});

test("leading whitespace does not hide a prefix", () => {
	assert.equal(getBlockType("   ❓ why"), "question");
});

test("a missing text is not a crash", () => {
	assert.equal(getBlockType(null), "note");
	assert.equal(getBlockType(undefined), "note");
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

test("the font size setting reaches the stylesheet", () => {
	const settings = new SettingsManager().defaultSettings;
	const css = buildSettingsCSS({ ...settings, fontSize: 18 });
	assert.match(css, /font-size:\s*18px/);
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
		"go-to-target.js": ["remote/lesson.js", "remote/go-to-overlay.js"],
		"excerpt-view.js": [
			"remote/go-to-overlay.js",
			"remote/snippet-overlay.js",
		],
	};

	for (const [shared, users] of Object.entries(DEPENDENTS)) {
		for (const user of users) {
			assert.ok(at(shared) < at(user), `${shared} must load before ${user}`);
		}
	}
});

test("the phone gives every block the same type class the editor does", () => {
	const { buildRemote } = require("./helpers/remote-dom.js");
	const ctx = buildRemote();
	ctx.api.updateLessonData({
		blocks: [
			{ type: "comment", text: "a reminder" },
			{ type: "comment", text: "❓ q" },
			{ type: "comment", text: "📋 a\nb" },
			{ type: "comment", text: "🖼️ p.png" },
			{ type: "comment", text: "🌐 http://x" },
			{ type: "go-to", target: "index.html" },
		],
	});
	assert.deepEqual(
		ctx.nodes["lesson-container"].children.map((el) => el.className),
		[
			"block note-block",
			"block question-block",
			"block snippet-block collapsed",
			"block image-block",
			"block web-block",
			"block go-to-block",
		],
		"the phone shares buildSettingsCSS, so a class it does not emit is a " +
			"block that renders unpainted",
	);
});

test("the phone shows Starting Code as one row and keeps the step numbers", () => {
	const { buildRemote } = require("./helpers/remote-dom.js");
	const ctx = buildRemote();
	ctx.api.updateLessonData({
		blocks: [
			{ type: "include", dir: "part_2_start", files: 2, anchors: {} },
			{ type: "go-to", target: "a.js", fromStart: true },
			{ type: "comment", text: "📋 a\n\tb", fromStart: true },
			{ type: "go-to", target: "b.js", fromStart: true },
			{ type: "comment", text: "📋 c\n\td", fromStart: true },
			{ type: "comment", text: "a reminder" },
		],
	});
	const kids = ctx.nodes["lesson-container"].children;
	assert.deepEqual(
		kids.map((el) => el.className),
		[
			"block include-block",
			"block go-to-block from-start",
			"block snippet-block collapsed from-start",
			"block go-to-block from-start",
			"block snippet-block collapsed from-start",
			"block note-block",
		],
	);
	assert.equal(kids[0].innerText, "Starting Code (2 files)");
	assert.equal(kids[0].dataset.stepIndex, undefined, "the row is not a step");
	assert.deepEqual(
		kids.slice(1).map((el) => el.dataset.stepIndex),
		[0, 1, 2, 3, 4],
		"the hidden blocks still count, so the host's step numbers line up",
	);

	const plain = buildRemote();
	plain.api.updateLessonData({
		blocks: [
			{ type: "include", anchors: {} },
			{ type: "comment", text: "n" },
		],
	});
	assert.deepEqual(
		plain.nodes["lesson-container"].children.map((el) => el.className),
		["block note-block"],
		"no start folder, no row",
	);
});
