"use strict";

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { pathToFileURL } = require("url");
const { loadModule } = require("./helpers/load-module");
const tools = require("../src/main/lesson-tools");
const { toolsSubmenu } = require("../src/main/app-menu");

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "leo-tools-"));
after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

let courseNo = 0;
function makeCourse() {
	const root = path.join(ROOT, `course${courseNo++}`);
	fs.mkdirSync(path.join(root, "plans"), { recursive: true });
	const plan = path.join(root, "plans", "part_1.leo");
	fs.writeFileSync(plan, "[]");
	tools.setCourseMenuState({ open: true, plans: [], currentPath: plan });
	const lesson = path.join(root, "lessons", "part_1");
	return { root, plan, lesson };
}

const put = (file, text = "x") => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, text);
};
const REAL = JSON.stringify({ events: [{ timestamp: 1, char: "a" }] });

test("VS Code opens lessons/<lesson>, not lessons/<lesson>/<lesson>", () => {
	const c = makeCourse();
	assert.equal(tools.lessonWorkspaceFolder(), c.lesson);
	assert.equal(
		fs.existsSync(path.join(c.lesson, "part_1")),
		false,
		"and it no longer creates the doubled folder on every click",
	);
});

test("with no data, only the Simulator is offered", async () => {
	const c = makeCourse();
	fs.mkdirSync(c.lesson, { recursive: true });
	assert.deepEqual(await tools.toolAvailability(), {
		timeline: false,
		students: false,
		overview: false,
	});
});

test("a log in the lesson folder makes Timeline available", async () => {
	const c = makeCourse();
	put(path.join(c.lesson, "keys.log"), REAL);
	assert.equal((await tools.toolAvailability()).timeline, true);
	put(path.join(c.lesson, "diff_marks_ideal.json"));
	const other = makeCourse();
	put(path.join(other.lesson, "diff_marks_ideal.json"));
	assert.equal(
		(await tools.toolAvailability()).timeline,
		false,
		"the pipeline's own diff_marks files are not a keystroke log",
	);
});

test("a stray .json file does not make Timeline available - only a real .log does", async () => {
	const c = makeCourse();
	put(path.join(c.lesson, "notes.json"), REAL);
	assert.equal(
		(await tools.toolAvailability()).timeline,
		false,
		"a json file that happens to look like a log is not a keystroke log",
	);
	put(path.join(c.lesson, "session.log"), REAL);
	assert.equal((await tools.toolAvailability()).timeline, true);
});

test("an anonymised log.json under anon_ids/ still counts", async () => {
	const c = makeCourse();
	put(path.join(c.lesson, "anon_ids", "log.json"), REAL);
	assert.equal((await tools.toolAvailability()).timeline, true);
});

test("a remarks spreadsheet makes Students available, wherever it sits", async () => {
	const c = makeCourse();
	put(path.join(c.lesson, "excels", "remarks_leo_star.xlsx"));
	assert.equal((await tools.toolAvailability()).students, true);
	const hidden = makeCourse();
	put(path.join(hidden.lesson, "students", "remarks_leo.xlsx"));
	put(path.join(hidden.lesson, "anon_names", "remarks_leo.xlsx"));
	assert.equal(
		(await tools.toolAvailability()).students,
		false,
		"the student folders are never entered, so a name in one proves nothing",
	);
});

test("overview.json at the course root makes Overview available", async () => {
	const c = makeCourse();
	assert.equal((await tools.toolAvailability()).overview, false);
	put(path.join(c.root, "overview.json"), "{}");
	assert.equal((await tools.toolAvailability()).overview, true);
});

test("no course context means nothing is available", async () => {
	tools.setCourseMenuState({ open: false, plans: [], currentPath: "" });
	assert.deepEqual(await tools.toolAvailability(), {
		timeline: false,
		students: false,
		overview: false,
	});
});

test("only a real recording counts as a real log", () => {
	const c = makeCourse();
	const dir = c.lesson;
	assert.equal(tools.hasRealLog(dir), false, "no folder at all");
	put(path.join(dir, "empty.log"), JSON.stringify({ events: [] }));
	put(
		path.join(dir, "artificial.log"),
		JSON.stringify({ artificial: true, events: [{ char: "a" }] }),
	);
	put(path.join(dir, "broken.log"), "{ not json");
	put(path.join(dir, "diff_marks_x.json"), REAL);
	assert.equal(
		tools.hasRealLog(dir),
		false,
		"an empty stub, an artificial log, garbage and a marks file do not count",
	);
	put(path.join(dir, "anon_ids", "log.json"), REAL);
	assert.equal(tools.hasRealLog(dir), true, "the anonymised copy does");
});

test("Simulator: a real log opens it, otherwise the artificial one is built", () => {
	const c = makeCourse();
	const opened = [];
	const notified = [];
	tools.openSimulator(
		(ch) => notified.push(ch),
		(t) => opened.push(t.file),
	);
	assert.deepEqual([opened, notified], [[], ["open-artificial-simulator"]]);

	put(path.join(c.lesson, "session.log"), REAL);
	tools.openSimulator(
		(ch) => notified.push(ch),
		(t) => opened.push(t.file),
	);
	assert.deepEqual(opened, ["simulator.html"]);
	assert.equal(notified.length, 1, "and nothing was generated");

	tools.setCourseMenuState({ open: false, plans: [], currentPath: "" });
	tools.openSimulator(
		(ch) => notified.push(ch),
		(t) => opened.push(t.file),
	);
	assert.equal(
		notified.length,
		2,
		"outside a course there is no lesson folder",
	);
});

function labels(state, availability) {
	return toolsSubmenu(state, availability, {}).map((i) => i.label || i.type);
}

test("the Tools menu lists only what has data", () => {
	const open = { open: true, currentPath: "C:/c/plans/p.leo" };
	const none = { timeline: false, students: false, overview: false };
	assert.deepEqual(labels(open, none), [
		"VSCode",
		"Chrome",
		"separator",
		"Simulator",
	]);
	assert.deepEqual(
		labels(open, { timeline: true, students: false, overview: true }),
		["VSCode", "Chrome", "separator", "Timeline", "Simulator", "Overview"],
	);
	assert.deepEqual(
		labels(open, { timeline: true, students: true, overview: true }),
		[
			"VSCode",
			"Chrome",
			"separator",
			"Timeline",
			"Simulator",
			"Students",
			"Overview",
		],
	);
});

test("the Simulator is offered for any loaded lesson, the rest need a course", () => {
	const noCourse = { open: false, currentPath: "C:/x/lesson.leo" };
	const all = { timeline: true, students: true, overview: true };
	assert.deepEqual(labels(noCourse, all), [
		"VSCode",
		"Chrome",
		"separator",
		"Simulator",
	]);
	assert.deepEqual(
		labels({ open: false, currentPath: "" }, all),
		["VSCode", "Chrome"],
		"nothing loaded, so nothing to simulate",
	);
});

test("clicking an entry runs its own action", () => {
	const seen = [];
	const actions = {
		launchVSCode: () => seen.push("vscode"),
		launchChrome: () => seen.push("chrome"),
		openSimulator: () => seen.push("sim"),
		openLessonTool: (t) => seen.push(t.file),
	};
	const items = toolsSubmenu(
		{ open: true, currentPath: "C:/c/plans/p.leo" },
		{ timeline: true, students: true, overview: true },
		actions,
	);
	for (const item of items) if (item.click) item.click();
	assert.deepEqual(seen, [
		"vscode",
		"chrome",
		"timeline.html",
		"sim",
		"students.html",
		"overview.html",
	]);
});

function chromeLaunches() {
	const spawned = [];
	const fakeSpawn = (...args) => {
		spawned.push(args);
		return { on() {}, unref() {} };
	};
	const mod = loadModule("src/main/lesson-tools.js", {
		electron: {},
		child_process: { spawn: fakeSpawn, spawnSync: () => ({ error: true }) },
	});
	return { mod, spawned };
}

const launchedWith = ([first, second]) =>
	Array.isArray(second) ? second.join(" ") : String(first);

test("Chrome opens the folder VS Code opens, as a folder listing", () => {
	const c = makeCourse();
	const { mod, spawned } = chromeLaunches();
	mod.setCourseMenuState({ open: true, plans: [], currentPath: c.plan });

	mod.launchChrome();

	assert.equal(spawned.length, 1);
	const url = pathToFileURL(c.lesson).href + "/";
	assert.ok(
		launchedWith(spawned[0]).includes(url),
		`Chrome is handed ${url}, the same lessons/<lesson> folder VS Code gets`,
	);
});

test("with no course lesson there is no folder, and Chrome just opens", () => {
	const { mod, spawned } = chromeLaunches();
	mod.setCourseMenuState({ open: false, plans: [], currentPath: "" });

	mod.launchChrome();

	assert.equal(spawned.length, 1);
	assert.equal(launchedWith(spawned[0]).includes("file:"), false);
});

test("a folder URL always ends in a slash, so relative links in the listing resolve", () => {
	assert.equal(
		tools.folderUrl(path.join(ROOT, "a b")).endsWith("/a%20b/"),
		true,
	);
	assert.equal(tools.folderUrl(ROOT).endsWith("/"), true);
});

test("the cached availability is what the menu reads, and refresh reports change", async () => {
	const c = makeCourse();
	fs.mkdirSync(c.lesson, { recursive: true });
	await tools.toolAvailability();
	assert.deepEqual(tools.cachedToolAvailability(), {
		timeline: false,
		students: false,
		overview: false,
	});

	put(path.join(c.lesson, "keys.log"), REAL);
	assert.equal(
		tools.cachedToolAvailability().timeline,
		false,
		"the cache must not hit the disk - that is the whole point",
	);

	assert.equal(
		await tools.refreshToolAvailability(),
		true,
		"a new log is a change",
	);
	assert.equal(tools.cachedToolAvailability().timeline, true);
	assert.equal(
		await tools.refreshToolAvailability(),
		false,
		"an unchanged folder must not rebuild the menu",
	);
});

test("refreshing with no course context is not a change once settled", async () => {
	tools.setCourseMenuState({ open: false, plans: [], currentPath: "" });
	await tools.refreshToolAvailability();
	assert.equal(await tools.refreshToolAvailability(), false);
	assert.deepEqual(tools.cachedToolAvailability(), {
		timeline: false,
		students: false,
		overview: false,
	});
});
