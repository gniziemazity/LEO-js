"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const stub = `
"use strict";
const document = {
	documentElement: {},
	body: { classList: { add() {}, remove() {} } },
	getElementById: () => null,
	createElement: () => ({ style: {} }),
	addEventListener() {},
};
function getComputedStyle() {
	return { getPropertyValue: () => "" };
}
const window = { addEventListener() {}, location: { search: "" } };
const localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const navigator = { userAgent: "" };
`;

function loadAPI() {
	const tooltipSrc = fs.readFileSync(
		path.resolve(__dirname, "..", "lesson_tools", "shared/tooltip.js"),
		"utf-8",
	);
	const src = fs.readFileSync(
		path.resolve(__dirname, "..", "lesson_tools", "shared/diff-utils.js"),
		"utf-8",
	);
	return new Function(`
		${stub}
		${tooltipSrc}
		${src}
		return {
			parseCsv, parseStudentIdNameMap, getFileExt,
			diffModeFromFilename, defaultDiffModeKey, DIFF_MARKS_FILES,
			DIFF_METHODS, REMARKS_BASES, CURATED_MODES, basisToDiffMode,
			_hmsToSeconds, parseFollowEvents, parseFollowLabel,
		};
	`)();
}

const api = loadAPI();

test("parseCsv: returns empty for fewer than two lines", () => {
	assert.deepEqual(api.parseCsv(""), { header: [], rows: [], delim: "," });
	assert.deepEqual(api.parseCsv("only-a-header"), {
		header: [],
		rows: [],
		delim: ",",
	});
});

test("parseCsv: strips BOM, trims quotes, auto-detects delimiter", () => {
	const BOM = String.fromCharCode(0xfeff);
	const comma = api.parseCsv(BOM + 'a,b\n"x","y"');
	assert.deepEqual(comma.header, ["a", "b"]);
	assert.deepEqual(comma.rows, [["x", "y"]]);
	assert.equal(comma.delim, ",");

	const semi = api.parseCsv("a;b\n1;2");
	assert.equal(semi.delim, ";");
	assert.deepEqual(semi.rows, [["1", "2"]]);
});

test("parseStudentIdNameMap: header variants + alter-ego fallback + missing column", () => {
	assert.deepEqual(
		api.parseStudentIdNameMap("Student ID,Student Name\n12,Alice\n34,Bob"),
		{ 12: "Alice", 34: "Bob" },
	);
	assert.deepEqual(api.parseStudentIdNameMap("id,name\n7,Eve"), { 7: "Eve" });
	assert.deepEqual(
		api.parseStudentIdNameMap("Student ID,Alter Ego\n9,Falcon"),
		{ 9: "Falcon" },
	);
	assert.deepEqual(api.parseStudentIdNameMap("name\nAlice\nBob"), {});
});

test("getFileExt: lowercased final extension, empty when none", () => {
	assert.equal(api.getFileExt("a.B.JS"), "js");
	assert.equal(api.getFileExt("index.HTML"), "html");
	assert.equal(api.getFileExt("archive.tar.gz"), "gz");
	assert.equal(api.getFileExt("noext"), "");
	assert.equal(api.getFileExt(""), "");
});

test("diffModeFromFilename: maps the canonical filenames back to mode keys", () => {
	assert.equal(api.diffModeFromFilename("diff_marks_ideal.json"), "ideal");
	assert.equal(
		api.diffModeFromFilename("diff_marks_leo_star.json"),
		"leo_star",
	);
	assert.equal(api.diffModeFromFilename("diff_marks_leo.json"), null);
	assert.equal(api.diffModeFromFilename("diff_marks_lcs.json"), "lcs");
	assert.equal(
		api.diffModeFromFilename("diff_marks_git_star.json"),
		"git_star",
	);
	assert.equal(api.diffModeFromFilename("DIFF_MARKS_MINIMAL.JSON"), "minimal");
	assert.equal(api.diffModeFromFilename("nope.json"), null);
});

test("defaultDiffModeKey: ideal > minimal > leo_star > leo, honours a present request", () => {
	assert.equal(api.defaultDiffModeKey({ ideal: {}, leo: {} }), "ideal");
	assert.equal(api.defaultDiffModeKey({ minimal: {}, leo: {} }), "minimal");
	assert.equal(api.defaultDiffModeKey({ leo_star: {}, leo: {} }), "leo_star");
	assert.equal(api.defaultDiffModeKey({ leo: {} }), "leo");
	assert.equal(api.defaultDiffModeKey({ ideal: {}, leo: {} }, "leo"), "leo");
	assert.equal(api.defaultDiffModeKey({ ideal: {} }, "leo"), "ideal");
	assert.equal(api.defaultDiffModeKey({ lcs: {} }), "lcs");
	assert.equal(api.defaultDiffModeKey({}), null);
});

test("DIFF_METHODS: single source derives files / bases / curated consistently", () => {
	const keys = api.DIFF_METHODS.map((m) => m.key);
	assert.deepEqual(keys, [
		"ideal",
		"minimal",
		"leo_star",
		"lcs_star",
		"lcs",
		"git_star",
		"git",
	]);
	// every method's filename is mirrored into DIFF_MARKS_FILES
	for (const m of api.DIFF_METHODS) {
		assert.equal(api.DIFF_MARKS_FILES[m.key], m.filename);
	}
	// the dropdown/basis list contains every selectable method
	assert.deepEqual(
		api.REMARKS_BASES.map((b) => b.key),
		["ideal", "minimal", "leo_star", "lcs_star", "lcs", "git_star", "git"],
	);
	assert.deepEqual([...api.CURATED_MODES].sort(), ["ideal", "minimal"]);
});

test("basisToDiffMode: identity for known method keys, null otherwise", () => {
	assert.equal(api.basisToDiffMode("leo_star"), "leo_star");
	assert.equal(api.basisToDiffMode("git"), "git");
	assert.equal(api.basisToDiffMode("ideal"), "ideal");
	assert.equal(api.basisToDiffMode("nope"), null);
	assert.equal(api.basisToDiffMode(""), null);
	assert.equal(api.basisToDiffMode(null), null);
});

test("_hmsToSeconds: parses HH:MM:SS(.mmm); null on garbage; sessionDate adds a date offset", () => {
	assert.equal(api._hmsToSeconds("01:02:03"), 3723);
	assert.equal(api._hmsToSeconds("00:00:01.5"), 1.5);
	assert.equal(api._hmsToSeconds("00:00:01.500"), 1.5);
	assert.equal(api._hmsToSeconds("nope"), null);
	assert.equal(api._hmsToSeconds(""), null);
	const d = "2020-01-01T00:00:00";
	assert.equal(
		api._hmsToSeconds("00:00:02", d) - api._hmsToSeconds("00:00:01", d),
		1,
	);
});

test("parseFollowLabel: missing / extra / extra-star / normal", () => {
	assert.deepEqual(api.parseFollowLabel("-border"), {
		kind: "missing",
		token: "border",
	});
	assert.deepEqual(api.parseFollowLabel("+color"), {
		kind: "extra",
		token: "color",
	});
	assert.deepEqual(api.parseFollowLabel("+color*"), {
		kind: "extra-star",
		token: "color",
	});
	assert.deepEqual(api.parseFollowLabel("plain"), {
		kind: "normal",
		token: "plain",
	});
	assert.deepEqual(api.parseFollowLabel("- border"), {
		kind: "missing",
		token: "border",
	});
});

test("parseFollowEvents: extracts each +/- token with its timestamp", () => {
	const evs = api.parseFollowEvents("-border (00:00:05)+color (00:00:06)");
	assert.equal(evs.length, 2);
	assert.deepEqual(evs[0], {
		label: "-border",
		ts: 5,
		kind: "missing",
		token: "border",
	});
	assert.deepEqual(evs[1], {
		label: "+color",
		ts: 6,
		kind: "extra",
		token: "color",
	});
	assert.deepEqual(api.parseFollowEvents(""), []);
});

test("parseFollowEvents: reads optional ~sim suffix on paired missing tokens", () => {
	const evs = api.parseFollowEvents(
		"-border (00:00:05) ~0.83, +color (00:00:06)",
	);
	assert.equal(evs.length, 2);
	assert.equal(evs[0].kind, "missing");
	assert.equal(evs[0].token, "border");
	assert.equal(evs[0].sim, 0.83);
	assert.equal(evs[1].kind, "extra");
	assert.equal(evs[1].token, "color");
	assert.equal("sim" in evs[1], false);
});
