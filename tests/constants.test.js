const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
	buildWindowTitle,
	NUTJS_KEY_MAPPING,
} = require("../src/shared/constants");
const { getBlockSubtype, buildSettingsCSS } = require("../src/shared/blocks");

test("getBlockSubtype identifies question prefix", () => {
	assert.equal(getBlockSubtype("❓ What is X?"), "question-comment");
});

test("getBlockSubtype identifies image prefix", () => {
	assert.equal(getBlockSubtype("🖼️ diagram"), "image-comment");
});

test("getBlockSubtype identifies web prefix", () => {
	assert.equal(getBlockSubtype("🌐 https://example.com"), "web-comment");
});

test("getBlockSubtype identifies code-insert prefix", () => {
	assert.equal(getBlockSubtype("📋 snippet"), "code-insert-comment");
});

test("only the listed prefixes name a subtype", () => {
	assert.equal(
		getBlockSubtype("➡️ location"),
		null,
		"move-to is a first-class block, not a comment prefix",
	);
});

test("getBlockSubtype trims leading whitespace", () => {
	assert.equal(getBlockSubtype("   ❓ q"), "question-comment");
});

test("getBlockSubtype returns null for plain text", () => {
	assert.equal(getBlockSubtype("just a comment"), null);
});

test("both backspace glyphs map to Backspace", () => {
	const { Key } = require("@computer-use/nut-js");
	assert.deepEqual(NUTJS_KEY_MAPPING["⌫"], { key: Key.Backspace });
	assert.deepEqual(
		NUTJS_KEY_MAPPING["↢"],
		{ key: Key.Backspace },
		"recorded keylogs still carry ↢; a recording cannot be migrated",
	);
});

test("formatted blocks emit a mapped backspace glyph", () => {
	const {
		formatCodeForAutoTyping,
	} = require("../src/renderer/code-formatter");
	const out = formatCodeForAutoTyping("<html>\n</html>");
	for (const ch of out) {
		if (ch === "⌫" || ch === "↢") assert.ok(NUTJS_KEY_MAPPING[ch]);
	}
	assert.ok(out.includes("⌫"));
	assert.ok(!out.includes("↢"));
});

test("buildWindowTitle with empty name returns base", () => {
	assert.equal(buildWindowTitle("", null, false), "LEO");
	assert.equal(buildWindowTitle(null, null, false), "LEO");
});

test("buildWindowTitle strips .json suffix", () => {
	assert.equal(buildWindowTitle("lesson1.json", null, false), "LEO - lesson1");
});

test("buildWindowTitle adds student count", () => {
	assert.equal(
		buildWindowTitle("lesson1.json", 12, false),
		"LEO - lesson1 [12 students]",
	);
});

test("buildWindowTitle adds unsaved marker", () => {
	assert.equal(
		buildWindowTitle("lesson1.json", null, true),
		"LEO - lesson1 *",
	);
});

test("buildWindowTitle combines count and unsaved", () => {
	assert.equal(
		buildWindowTitle("lesson1.json", 3, true),
		"LEO - lesson1 [3 students] *",
	);
});

test("buildSettingsCSS includes fontSize and colors", () => {
	const css = buildSettingsCSS({
		fontSize: 18,
		colors: {
			textColor: "#111",
			commentNormal: "#eee",
			codeBlockColor: "#ddd",
			questionCommentColor: "#fda",
			imageBlockColor: "#fed",
			codeInsertBlockColor: "#cde",
			moveToBlockColor: "#abc",
			moveToTextColor: "#fff",
			commentActive: "#f00",
			commentActiveText: "#000",
			commentSelected: "#0f0",
			selectedBorder: "#00f",
			cursor: "#ff0",
		},
	});
	assert.match(css, /font-size:\s*18px/);
	assert.match(css, /#111/);
	assert.match(css, /#eee/);
});

test("an alias presses the same key as the glyph it stands in for", () => {
	const ALIASES = { "↢": "⌫", Ö: "🔁", é: "🅴" };
	for (const [alias, canonical] of Object.entries(ALIASES)) {
		assert.deepEqual(
			NUTJS_KEY_MAPPING[alias],
			NUTJS_KEY_MAPPING[canonical],
			`${alias} stands in for ${canonical} but presses a different key`,
		);
	}
});
