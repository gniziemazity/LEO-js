"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const BASE = path.resolve(__dirname, "..", "src");
const { getBlockKind, buildSettingsCSS, BLOCK_KINDS } = require(
	path.join(BASE, "shared/blocks.js"),
);
const SettingsManager = require(path.join(BASE, "main/settings-manager.js"));

test("each special prefix names its kind", () => {
	assert.equal(getBlockKind("❓ why"), "question");
	assert.equal(getBlockKind("🖼️ pic.png"), "image");
	assert.equal(getBlockKind("🌐 http://x"), "web");
	assert.equal(getBlockKind("📋 paste me"), "snippet");
	assert.equal(
		getBlockKind("plain words"),
		"note",
		"a block with no prefix is a note, not a nameless leftover",
	);
});

test("leading whitespace does not hide a prefix", () => {
	assert.equal(getBlockKind("   ❓ why"), "question");
});

test("a missing text is not a crash", () => {
	assert.equal(getBlockKind(null), "note");
	assert.equal(getBlockKind(undefined), "note");
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
		"move-to-target.js": ["remote/lesson.js", "remote/move-to-overlay.js"],
		"snippet-view.js": [
			"remote/move-to-overlay.js",
			"remote/code-insert-overlay.js",
		],
	};

	for (const [shared, users] of Object.entries(DEPENDENTS)) {
		for (const user of users) {
			assert.ok(at(shared) < at(user), `${shared} must load before ${user}`);
		}
	}
});

test("the remote reads the shared functions rather than defining them", () => {
	const lesson = fs.readFileSync(
		path.join(BASE, "shared/remote/lesson.js"),
		"utf-8",
	);
	assert.ok(
		!/function getBlockSubtype/.test(lesson),
		"a second getBlockSubtype is a second rule that can disagree",
	);
	assert.ok(!/function buildSettingsCSS/.test(lesson));
});

test("the kind table and the classifier agree", () => {
	for (const [prefix, kind] of BLOCK_KINDS) {
		assert.equal(getBlockKind(`${prefix} something`), kind);
	}
});

test("the editor-only UI never reaches the remote", () => {
	const html = fs.readFileSync(path.join(BASE, "remote.html"), "utf-8");
	for (const name of [
		"anchor-preview.js",
		"move-to-dropdown.js",
		"block-types.js",
	]) {
		assert.equal(
			html.includes(name),
			false,
			`${name} is an editing aid; on a phone it would just confuse`,
		);
	}
});

test("every dual-mode module ends with the same export footer", () => {
	const FOOTER = [
		'\tif (typeof module !== "undefined" && module.exports) {',
		"\t\tmodule.exports = api;",
		"\t}",
		"\troot.<NAME> = api;",
		'})(typeof window !== "undefined" ? window : this);',
	].join("\n");

	const expected = {
		"code-text.js": "CodeTextRenderer",
		"blocks.js": "LeoBlocks",
		"move-to-target.js": "MoveToTarget",
		"snippet-view.js": "SnippetView",
	};
	for (const [file, name] of Object.entries(expected)) {
		const src = fs
			.readFileSync(
				path.resolve(__dirname, "..", "src/shared", file),
				"utf-8",
			)
			.replace(/\r\n/g, "\n")
			.trimEnd();
		assert.ok(
			src.endsWith(FOOTER.replace("<NAME>", name)),
			`${file} does not end with the shared dual-mode footer`,
		);
	}
});

test("the phone gives every block the same kind class the editor does", () => {
	const { buildRemote } = require("./helpers/remote-dom.js");
	const ctx = buildRemote();
	ctx.api.updateLessonData({
		blocks: [
			{ type: "comment", text: "a reminder" },
			{ type: "comment", text: "❓ q" },
			{ type: "comment", text: "📋 a\nb" },
			{ type: "comment", text: "🖼️ p.png" },
			{ type: "comment", text: "🌐 http://x" },
			{ type: "move-to", target: "index.html" },
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
			"block move-to-block",
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
			{ type: "move-to", target: "a.js", fromInclude: true },
			{ type: "comment", text: "📋 a\n\tb", fromInclude: true },
			{ type: "move-to", target: "b.js", fromInclude: true },
			{ type: "comment", text: "📋 c\n\td", fromInclude: true },
			{ type: "comment", text: "a reminder" },
		],
	});
	const kids = ctx.nodes["lesson-container"].children;
	assert.deepEqual(
		kids.map((el) => el.className),
		[
			"block include-block",
			"block move-to-block from-include",
			"block snippet-block collapsed from-include",
			"block move-to-block from-include",
			"block snippet-block collapsed from-include",
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
		blocks: [{ type: "include", anchors: {} }, { type: "comment", text: "n" }],
	});
	assert.deepEqual(
		plain.nodes["lesson-container"].children.map((el) => el.className),
		["block note-block"],
		"no start folder, no row",
	);
});

test("the support kinds are the block kinds that are not code", () => {
	const { SUPPORT_KINDS, BLOCK_KINDS } = require(
		path.join(BASE, "shared/blocks.js"),
	);
	assert.deepEqual(
		SUPPORT_KINDS,
		["note", ...BLOCK_KINDS.map(([, kind]) => kind), "move-to"],
		"a lesson is code blocks and support blocks; this list is the second half",
	);
	assert.equal(
		SUPPORT_KINDS.includes("code"),
		false,
		"code is what LEO types, not what supports the typing",
	);
	assert.equal(
		/\.support-block/.test(
			fs.readFileSync(path.join(BASE, "shared/styles.css"), "utf-8"),
		),
		false,
		"support is a word for the docs, not a class: the per-kind classes and " +
			"the generated selector lists carry the styling",
	);
});
