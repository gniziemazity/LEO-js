"use strict";

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const LessonManager = require("../src/renderer/lesson-manager");

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "leo-plandur-"));
after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

let planNo = 0;
function newPlanFile(blocks) {
	const dir = path.join(ROOT, `p${planNo++}`);
	fs.mkdirSync(dir, { recursive: true });
	const file = path.join(dir, "lesson.leo");
	fs.writeFileSync(file, JSON.stringify(blocks, null, 2));
	return file;
}

const BLOCKS = [
	{ type: "comment", text: "Title" },
	{ type: "code", text: "let a = 1;" },
];

function load(lm, file, options) {
	return new Promise((resolve, reject) => {
		lm.load(
			file,
			(err, data) => (err ? reject(err) : resolve(data)),
			options,
		);
	});
}

function save(lm) {
	return new Promise((resolve, reject) => {
		lm.save((err) => (err ? reject(err) : resolve()));
	});
}

test("a save never leaves the plan truncated, and drops the autosave", async () => {
	const file = newPlanFile(BLOCKS);
	const lm = new LessonManager();
	await load(lm, file);

	lm.updateBlock(2, "let a = 2;");
	assert.equal(lm.hasChanges(), true);
	lm.writeAutosave();
	assert.ok(fs.existsSync(lm.autosavePath()), "no autosave was written");

	await save(lm);

	assert.equal(lm.hasChanges(), false);
	assert.equal(
		fs.existsSync(lm.autosavePath()),
		false,
		"a successful save must retire the autosave",
	);
	assert.equal(
		fs.readdirSync(path.dirname(file)).filter((n) => n.endsWith(".saving"))
			.length,
		0,
		"the temp file used for the atomic rename was left behind",
	);
	assert.doesNotThrow(() => JSON.parse(fs.readFileSync(file, "utf8")));
	const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
	assert.equal(onDisk[1].text, "let a = 2;");
});

test("an interrupted save cannot destroy the file that is already there", async () => {
	const file = newPlanFile(BLOCKS);
	const before = fs.readFileSync(file, "utf8");

	const lm = new LessonManager();
	await load(lm, file);
	lm.updateBlock(2, "let a = 99;");

	const realRename = fs.rename;
	fs.rename = (_a, _b, cb) => cb(new Error("disk full"));
	let failed = false;
	await new Promise((resolve) => {
		lm.save((err) => {
			failed = !!err;
			resolve();
		});
	});
	fs.rename = realRename;

	assert.equal(failed, true, "the save should have reported the failure");
	assert.equal(
		fs.readFileSync(file, "utf8"),
		before,
		"the previously saved plan was damaged by a failed save",
	);
	assert.equal(
		lm.hasChanges(),
		true,
		"a failed save must not claim the work is safe",
	);
});

test("an autosave newer than the plan is offered for recovery", async () => {
	const file = newPlanFile(BLOCKS);
	const lm = new LessonManager();
	await load(lm, file);

	assert.equal(
		LessonManager.pendingAutosave(file),
		null,
		"a clean plan must not look like a crash",
	);

	lm.updateBlock(2, "let a = 3;");
	lm.writeAutosave();
	const oneMinute = Date.now() + 60000;
	fs.utimesSync(lm.autosavePath(), oneMinute / 1000, oneMinute / 1000);

	const pending = LessonManager.pendingAutosave(file);
	assert.ok(pending, "the crashed work was not offered back");

	const fresh = new LessonManager();
	await load(fresh, file, { from: pending });

	assert.equal(fresh.getBlock(2).text, "let a = 3;");
	assert.equal(
		fresh.getCurrentFilePath(),
		file,
		"recovering must keep pointing at the real plan, not the sidecar",
	);
	assert.equal(
		fresh.hasChanges(),
		true,
		"recovered work is unsaved work and must say so",
	);
});

test("an autosave older than the plan is ignored", async () => {
	const file = newPlanFile(BLOCKS);
	const lm = new LessonManager();
	await load(lm, file);
	lm.updateBlock(2, "stale");
	lm.writeAutosave();

	const long_ago = (Date.now() - 600000) / 1000;
	fs.utimesSync(lm.autosavePath(), long_ago, long_ago);

	assert.equal(
		LessonManager.pendingAutosave(file),
		null,
		"an autosave predating the save is not a crash to recover from",
	);
});

test("loading a clean plan clears any leftover autosave", async () => {
	const file = newPlanFile(BLOCKS);
	const lm = new LessonManager();
	await load(lm, file);
	lm.updateBlock(2, "scratch");
	lm.writeAutosave();
	const sidecar = lm.autosavePath();
	assert.ok(fs.existsSync(sidecar));

	const fresh = new LessonManager();
	await load(fresh, file);
	assert.equal(
		fs.existsSync(sidecar),
		false,
		"opening the saved version should retire the sidecar",
	);
	assert.equal(fresh.hasChanges(), false);
});
