"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const TOOLS = path.resolve(__dirname, "..", "lesson_tools");
const read = (rel) => fs.readFileSync(path.join(TOOLS, rel), "utf-8");

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
const LANG_FOLLOW_KEYS = [];
let _overviewDs = null;
let _basisFiles = new Map();
`;

const api = new Function(`
	${stub}
	${read("shared/tooltip.js")}
	${read("shared/diff-utils.js")}
	${read("overview/basis.js")}
	return {
		async detect(paths) {
			_overviewDs = {
				files: new Map(paths.map((p) => [p, { name: p.split("/").pop() }])),
			};
			await _overviewDetectBasisFiles();
			return _basisFiles;
		},
	};
`)();

const picked = (basisFiles, key, topic) => {
	const file = basisFiles.get(key) && basisFiles.get(key).get(topic);
	return file ? file.name : null;
};

test("a lesson's remarks are not replaced by a newer assignment of the same name", async () => {
	const basisFiles = await api.detect([
		"lessons/wall/remarks_ideal_20260101-120000.xlsx",
		"assignments/wall/remarks_ideal_20260301-120000.xlsx",
	]);
	assert.equal(
		picked(basisFiles, "ideal", "wall"),
		"remarks_ideal_20260101-120000.xlsx",
	);
});

test("within one group the newest remarks still win", async () => {
	const basisFiles = await api.detect([
		"lessons/wall/remarks_ideal_20260101-120000.xlsx",
		"lessons/wall/excels/remarks_ideal_20260201-120000.xlsx",
	]);
	assert.equal(
		picked(basisFiles, "ideal", "wall"),
		"remarks_ideal_20260201-120000.xlsx",
	);
});

test("an assignment fills a basis its lesson does not have", async () => {
	const basisFiles = await api.detect([
		"lessons/wall/remarks_ideal_20260101-120000.xlsx",
		"assignments/wall/remarks_minimal_20260301-120000.xlsx",
		"assignments/tower/remarks_ideal_20260301-120000.xlsx",
	]);
	assert.equal(
		picked(basisFiles, "minimal", "wall"),
		"remarks_minimal_20260301-120000.xlsx",
	);
	assert.equal(
		picked(basisFiles, "ideal", "tower"),
		"remarks_ideal_20260301-120000.xlsx",
	);
});
