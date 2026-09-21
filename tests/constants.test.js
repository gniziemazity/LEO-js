const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
	buildWindowTitle,
	NUTJS_KEY_MAPPING,
} = require("../src/shared/constants");
const { getBlockKind } = require("../src/shared/blocks");

test("only the listed prefixes name a kind", () => {
	assert.equal(
		getBlockKind("➡️ location"),
		"note",
		"move-to is a first-class block type, not a text prefix",
	);
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
