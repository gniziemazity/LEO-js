"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
	classifyGoToTarget,
	goToFileName,
	goToDisplayName,
	goToTargetLabel,
	goToPopupTitle,
	isFileName,
} = require(path.resolve(__dirname, "..", "src/shared/go-to-target.js"));

const CASES = [
	["MAIN", "main", "MAIN"],
	["DEV", "dev", "DEV"],
	["index.html", "file", "index.html"],
	["style.css", "file", "style.css"],
	["⚓7⚓", "anchor", "⚓7⚓"],
	["⚓setup⚓", "anchor", "⚓setup⚓"],
];

for (const [raw, mode, target] of CASES) {
	test(`${raw} is a ${mode} target`, () => {
		const t = classifyGoToTarget(raw);
		assert.equal(t.mode, mode);
		assert.equal(t.target, target);
	});
}

test("a missing target is the main editor", () => {
	for (const empty of [null, undefined, "", 0]) {
		assert.equal(classifyGoToTarget(empty).mode, "main");
		assert.equal(classifyGoToTarget(empty).target, "MAIN");
	}
});

test("an anchor wrapper with nothing in it is not an anchor", () => {
	const t = classifyGoToTarget("⚓⚓");
	assert.equal(t.mode, "main");
	assert.equal(t.wrapped, false);
});

test("a bare word is neither a file nor an anchor", () => {
	const t = classifyGoToTarget("somewhere");
	assert.equal(t.mode, "main");
	assert.equal(t.target, "somewhere", "and keeps what the lesson said");
});

test("goToFileName answers only for files", () => {
	assert.equal(goToFileName("index.html"), "index.html");
	assert.equal(
		goToFileName("⚓index.html⚓"),
		null,
		"the ⚓…⚓ wrapper means anchor and nothing else now",
	);
	assert.equal(goToFileName("⚓7⚓"), null);
	assert.equal(goToFileName("MAIN"), null);
	assert.equal(goToFileName("DEV"), null);
	assert.equal(goToFileName(null), null);
});

test("labels name the destination the way a teacher would read it", () => {
	assert.equal(goToTargetLabel("MAIN"), "Main Editor");
	assert.equal(goToTargetLabel("DEV"), "Dev Tools");
	assert.equal(goToTargetLabel("index.html"), "📄 index.html");
	assert.equal(goToTargetLabel("⚓7⚓"), "⚓7⚓");
});

test("the display name is the label without the dropdown's paper clip", () => {
	assert.equal(goToDisplayName("MAIN"), "Main Editor");
	assert.equal(goToDisplayName("DEV"), "Dev Tools");
	assert.equal(goToDisplayName("index.html"), "index.html");
	assert.equal(goToDisplayName("⚓7⚓"), "⚓7⚓");
	for (const t of ["MAIN", "DEV", "index.html", "⚓7⚓"]) {
		const label = goToTargetLabel(t);
		assert.ok(
			label.endsWith(goToDisplayName(t)),
			t + ": the two must not drift apart",
		);
	}
});

test("a missing target reads the same as an explicit MAIN", () => {
	assert.equal(goToTargetLabel(null), goToTargetLabel("MAIN"));
});

test("the go-to popup title says what the jump will do", () => {
	assert.equal(
		goToPopupTitle({ mode: "file", typeName: true }),
		"Create file:",
	);
	assert.equal(goToPopupTitle({ mode: "file", typeName: false }), "Go to:");
	assert.equal(goToPopupTitle({ mode: "main" }), "Go to:");
	assert.equal(
		goToPopupTitle({ mode: "anchor", excerpt: { switchTo: "app.js" } }),
		"Go to (app.js):",
	);
	assert.equal(
		goToPopupTitle({ mode: "anchor", excerpt: { switchTo: "MAIN" } }),
		"Go to (Main Editor):",
	);
	assert.equal(
		goToPopupTitle({ mode: "anchor", excerpt: { switchTo: null } }),
		"Go to:",
	);
	assert.equal(goToPopupTitle({ mode: "anchor" }), "Go to:");
	assert.equal(
		goToPopupTitle({ mode: "file", excerpt: { switchTo: "app.js" } }),
		"Go to:",
		"only an anchor jump can cross files",
	);
});

test("isFileName is the extension rule, nothing more", () => {
	assert.ok(isFileName("a.js"));
	assert.ok(isFileName("A.HTML"));
	assert.ok(!isFileName("7"));
	assert.ok(!isFileName("setup"));
	assert.ok(!isFileName("no.extension."));
});
