const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildWindowTitle } = require("../src/shared/constants");
const LessonManager = require("../src/renderer/lesson-manager");
const CourseManager = require("../src/renderer/course-manager");

test("buildWindowTitle places course name before plan name", () => {
	assert.equal(
		buildWindowTitle("intro.leo", null, false, "Web101"),
		"LEO - Web101 / intro",
	);
	assert.equal(buildWindowTitle("intro.leo", null, false, null), "LEO - intro");
	assert.equal(buildWindowTitle("", null, false, "Web101"), "LEO - Web101");
	assert.equal(buildWindowTitle("", null, false, null), "LEO");
	assert.equal(
		buildWindowTitle("intro.leo", 3, true, "Web101"),
		"LEO - Web101 / intro [3 students] *",
	);
});

test("LessonManager.load rejects non-array JSON", async () => {
	const tmp = path.join(os.tmpdir(), `leo-plan-${Date.now()}.leo`);
	fs.writeFileSync(tmp, JSON.stringify({ name: "not a plan" }));
	const lm = new LessonManager();
	await new Promise((resolve) => {
		lm.load(tmp, (err, data) => {
			assert.ok(err, "should error on object JSON");
			assert.equal(data, null);
			resolve();
		});
	});
	fs.rmSync(tmp);
});

test("LessonManager.load accepts an array plan", async () => {
	const tmp = path.join(os.tmpdir(), `leo-plan2-${Date.now()}.leo`);
	fs.writeFileSync(tmp, JSON.stringify([{ type: "code", text: "x" }]));
	const lm = new LessonManager();
	await new Promise((resolve) => {
		lm.load(tmp, (err, data) => {
			assert.ok(!err);
			assert.ok(Array.isArray(data));
			resolve();
		});
	});
	fs.rmSync(tmp);
});

test("CourseManager.addPlan refuses a non-plan source file", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "leo-course-"));
	const cm = new CourseManager();
	cm.create(path.join(root, "C"), "C");
	const bad = path.join(root, "bad.leo");
	fs.writeFileSync(bad, JSON.stringify({ name: "x" }));
	assert.throws(() => cm.addPlan("bad", bad), /not a valid LEO plan/i);
	fs.rmSync(root, { recursive: true, force: true });
});

test("planToOpen returns first plan when no lastPlan, null when empty", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "leo-course-"));
	const cm = new CourseManager();
	cm.create(path.join(root, "C"), "C");
	assert.equal(cm.planToOpen(), null, "no plans -> null");
	cm.addPlan("zebra");
	cm.addPlan("apple");
	assert.equal(
		path.basename(cm.planToOpen()),
		"apple.leo",
		"first alphabetical plan",
	);
	fs.rmSync(root, { recursive: true, force: true });
});

test("lastPlan persists on save and drives planToOpen after reopen", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "leo-course-"));
	const dir = path.join(root, "C");
	const cm = new CourseManager();
	cm.create(dir, "C");
	cm.addPlan("apple");
	cm.addPlan("zebra");
	cm.lastPlan = "zebra";
	cm.saveCourseMeta();

	const meta = JSON.parse(fs.readFileSync(path.join(dir, ".leo-course"), "utf8"));
	assert.equal(meta.lastPlan, "zebra", "lastPlan written to .leo-course");

	const cm2 = new CourseManager();
	cm2.open(dir);
	assert.equal(cm2.lastPlan, "zebra", "lastPlan read back on open");
	assert.equal(
		path.basename(cm2.planToOpen()),
		"zebra.leo",
		"planToOpen honors saved lastPlan",
	);
	fs.rmSync(root, { recursive: true, force: true });
});

test("setLastPlan persists on change, skips redundant writes", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "leo-course-"));
	const dir = path.join(root, "C");
	const cm = new CourseManager();
	cm.create(dir, "C");
	const metaPath = path.join(dir, ".leo-course");

	assert.equal(cm.setLastPlan("apple"), true, "first set reports a change");
	assert.equal(
		JSON.parse(fs.readFileSync(metaPath, "utf8")).lastPlan,
		"apple",
		"selected plan auto-saved without an explicit save",
	);

	fs.rmSync(metaPath);
	assert.equal(cm.setLastPlan("apple"), false, "same plan reports no change");
	assert.ok(!fs.existsSync(metaPath), "no redundant write for the same plan");

	fs.rmSync(root, { recursive: true, force: true });
});
