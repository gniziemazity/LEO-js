const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
	buildWindowTitle,
	NUTJS_KEY_MAPPING,
} = require("../src/shared/constants");

test("buildWindowTitle with empty name returns base", () => {
	assert.equal(buildWindowTitle("", null, false), "LEO");
	assert.equal(buildWindowTitle(null, null, false), "LEO");
});

test("buildWindowTitle strips .json suffix", () => {
	assert.equal(buildWindowTitle("lesson1.json", null, false), "LEO - lesson1");
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
