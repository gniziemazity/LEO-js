"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC = path.resolve(__dirname, "..", "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf-8");

function loadOpenHelpers(existing) {
	const src = read("main/main.js");
	const start = src.indexOf("const OPENABLE_FILE_RE");
	const end = src.indexOf("function _openPlanInWindow");
	assert.ok(start > 0 && end > start, "the open-path helpers moved");
	const sent = [];
	const state = {
		mainWindow: { webContents: { send: (...a) => sent.push(a) } },
	};
	const stubFs = { existsSync: (p) => existing.includes(p) };
	const body = src
		.slice(start, end)
		.replace("let pendingOpenFile = _extractLeoPath(process.argv);", "");
	const helpers = new Function(
		"fs",
		"path",
		"state",
		`${body}\nreturn { _extractLeoPath, _sendOpenPath };`,
	)(stubFs, path, state);
	return { ...helpers, sent };
}

test("a double-clicked .leo-course file is recognised as something to open", () => {
	const marker = path.join("C:", "courses", "web", ".leo-course");
	const { _extractLeoPath } = loadOpenHelpers([marker]);
	assert.equal(
		_extractLeoPath(["LEO-js.exe", marker]),
		marker,
		"only .leo and .json used to pass, so the launch ignored the file and " +
			"the renderer reopened whichever course it remembered",
	);
});

test("plans are still recognised, and unknown files are not", () => {
	const plan = path.join("C:", "courses", "web", "plans", "part_1.leo");
	const other = path.join("C:", "courses", "web", "notes.txt");
	const { _extractLeoPath } = loadOpenHelpers([plan, other]);
	assert.equal(_extractLeoPath(["LEO-js.exe", plan]), plan);
	assert.equal(_extractLeoPath(["LEO-js.exe", other]), null);
	assert.equal(_extractLeoPath(["LEO-js.exe", "missing.leo"]), null);
});

test("a course marker opens its folder, a plan opens as a plan", () => {
	const dir = path.join("C:", "courses", "web");
	const marker = path.join(dir, ".leo-course");
	const plan = path.join(dir, "plans", "part_1.leo");
	const { _sendOpenPath, sent } = loadOpenHelpers([]);
	_sendOpenPath(marker);
	_sendOpenPath(plan);
	assert.deepEqual(sent, [
		["open-course-path", dir],
		["open-plan-file", plan],
	]);
});

test("the patterns exist before the launch arguments are scanned", () => {
	const src = read("main/main.js");
	assert.ok(
		src.indexOf("const OPENABLE_FILE_RE") <
			src.indexOf("let pendingOpenFile = _extractLeoPath"),
		"a const read before its line is a ReferenceError at startup, which no " +
			"test that slices the helpers out would ever see",
	);
});

test("every launch path goes through the one router", () => {
	const src = read("main/main.js");
	assert.equal(
		/webContents\.send\("open-plan-file"/.test(
			src.replace(/function _sendOpenPath[\s\S]*?\n\}/, ""),
		),
		false,
		"a second send site would open a course marker as if it were a plan",
	);
	assert.match(read("renderer/app.js"), /"open-course-path"/);
});

test("openCoursePath opens the folder it is given and remembers it", () => {
	const CourseUI = require("../src/renderer/course-ui.js");
	const store = {};
	global.localStorage = { setItem: (k, v) => (store[k] = v) };
	const opened = [];
	let refreshed = 0;
	const ui = Object.create(CourseUI.prototype);
	ui.courseManager = { open: (d) => opened.push(d) };
	ui._loadDefaultPlan = () => false;
	ui.refresh = () => refreshed++;
	try {
		ui.openCoursePath("C:/courses/web");
	} finally {
		delete global.localStorage;
	}
	assert.deepEqual(opened, ["C:/courses/web"]);
	assert.equal(store.lastCoursePath, "C:/courses/web");
	assert.equal(refreshed, 1, "no default plan, so the menu is refreshed");
});

test("openCoursePath tells the teacher when the folder is not a course", () => {
	const CourseUI = require("../src/renderer/course-ui.js");
	const store = {};
	const alerts = [];
	global.localStorage = { setItem: (k, v) => (store[k] = v) };
	global.alert = (m) => alerts.push(m);
	const ui = Object.create(CourseUI.prototype);
	ui.courseManager = {
		open: () => {
			throw new Error("Folder does not exist");
		},
	};
	try {
		ui.openCoursePath("C:/nope");
	} finally {
		delete global.localStorage;
		delete global.alert;
	}
	assert.equal(alerts.length, 1);
	assert.deepEqual(
		store,
		{},
		"a folder that failed to open is not remembered",
	);
});
