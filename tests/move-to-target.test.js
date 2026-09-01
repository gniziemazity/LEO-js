"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
	classifyMoveToTarget,
	moveToFileName,
	moveToDisplayName,
	moveToTargetLabel,
	isFileName,
} = require(path.resolve(__dirname, "..", "src/shared/move-to-target.js"));

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
		const t = classifyMoveToTarget(raw);
		assert.equal(t.mode, mode);
		assert.equal(t.target, target);
	});
}

test("a missing target is the main editor", () => {
	for (const empty of [null, undefined, "", 0]) {
		assert.equal(classifyMoveToTarget(empty).mode, "main");
		assert.equal(classifyMoveToTarget(empty).target, "MAIN");
	}
});

test("an anchor wrapper with nothing in it is not an anchor", () => {
	const t = classifyMoveToTarget("⚓⚓");
	assert.equal(t.mode, "main");
	assert.equal(t.wrapped, false);
});

test("a bare word is neither a file nor an anchor", () => {
	const t = classifyMoveToTarget("somewhere");
	assert.equal(t.mode, "main");
	assert.equal(t.target, "somewhere", "and keeps what the lesson said");
});

test("moveToFileName answers only for files", () => {
	assert.equal(moveToFileName("index.html"), "index.html");
	assert.equal(
		moveToFileName("⚓index.html⚓"),
		null,
		"the ⚓…⚓ wrapper means anchor and nothing else now",
	);
	assert.equal(moveToFileName("⚓7⚓"), null);
	assert.equal(moveToFileName("MAIN"), null);
	assert.equal(moveToFileName("DEV"), null);
	assert.equal(moveToFileName(null), null);
});

test("labels name the destination the way a teacher would read it", () => {
	assert.equal(moveToTargetLabel("MAIN"), "Main Editor");
	assert.equal(moveToTargetLabel("DEV"), "Dev Tools");
	assert.equal(moveToTargetLabel("index.html"), "📄 index.html");
	assert.equal(moveToTargetLabel("⚓7⚓"), "⚓7⚓");
});

test("the display name is the label without the dropdown's paper clip", () => {
	assert.equal(moveToDisplayName("MAIN"), "Main Editor");
	assert.equal(moveToDisplayName("DEV"), "Dev Tools");
	assert.equal(moveToDisplayName("index.html"), "index.html");
	assert.equal(moveToDisplayName("⚓7⚓"), "⚓7⚓");
	for (const t of ["MAIN", "DEV", "index.html", "⚓7⚓"]) {
		const label = moveToTargetLabel(t);
		assert.ok(
			label.endsWith(moveToDisplayName(t)),
			t + ": the two must not drift apart",
		);
	}
});

test("a missing target reads the same as an explicit MAIN", () => {
	assert.equal(moveToTargetLabel(null), moveToTargetLabel("MAIN"));
});

test("isFileName is the extension rule, nothing more", () => {
	assert.ok(isFileName("a.js"));
	assert.ok(isFileName("A.HTML"));
	assert.ok(!isFileName("7"));
	assert.ok(!isFileName("setup"));
	assert.ok(!isFileName("no.extension."));
});
