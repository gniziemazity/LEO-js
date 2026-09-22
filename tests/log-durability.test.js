"use strict";

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const LogManager = require("../src/renderer/log-manager");

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "leo-logdur-"));
after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

let planNo = 0;
function newPlan() {
	const dir = path.join(ROOT, `plan${planNo++}`);
	fs.mkdirSync(dir, { recursive: true });
	const plan = path.join(dir, "lesson.leo");
	fs.writeFileSync(plan, "[]");
	return { plan, logs: path.join(dir, "logs") };
}

const logFiles = (dir) => fs.readdirSync(dir).filter((n) => n.endsWith(".log"));
const journals = (dir) =>
	fs.readdirSync(dir).filter((n) => n.endsWith(".jsonl"));

test("a finalized log keeps the shape lesson_tools reads", () => {
	const { plan, logs } = newPlan();
	const log = new LogManager();
	log.initialize(plan);
	log.addEntry({ char: "a" });
	log.addEntry({ char: "b" });
	log.addInteraction("providing-help", { studentName: "X" });
	log.finalize();

	const files = logFiles(logs);
	assert.equal(files.length, 1);
	const data = JSON.parse(fs.readFileSync(path.join(logs, files[0]), "utf8"));

	assert.equal(data.lessonFile, plan);
	assert.equal(typeof data.sessionStart, "number");
	assert.ok(Array.isArray(data.events));
	assert.deepEqual(
		data.events.map((e) => e.char || e.interaction),
		["a", "b", "providing-help"],
	);
	assert.ok(
		data.events.every((e) => typeof e.timestamp === "number"),
		"every event still carries a timestamp",
	);
	assert.equal(journals(logs).length, 0, "the journal outlived the session");
});

test("a crash mid-session loses at most the last line, and is recovered on next open", () => {
	const { plan, logs } = newPlan();
	const log = new LogManager();
	log.initialize(plan);
	for (const ch of "hello") log.addEntry({ char: ch });

	const journalPath = log.journalPath;
	assert.ok(fs.existsSync(journalPath), "no journal was being written");

	const torn = fs.readFileSync(journalPath, "utf8") + '{"char":"X",';
	fs.writeFileSync(journalPath, torn);
	fs.closeSync(log.journal);
	log.journal = null;
	log.journalPath = null;
	log.logFilePath = null;

	const recovered = LogManager.recoverJournals(logs);
	assert.equal(recovered.length, 1, "the crashed session was not recovered");

	const data = JSON.parse(fs.readFileSync(recovered[0], "utf8"));
	assert.deepEqual(
		data.events.map((e) => e.char),
		["h", "e", "l", "l", "o"],
		"a torn final line must not cost the whole recording",
	);
	assert.equal(data.lessonFile, plan);
	assert.equal(journals(logs).length, 0, "the journal was not cleaned up");
});

test("a new session recovers an orphaned journal from a previous crash", () => {
	const { plan, logs } = newPlan();
	const crashed = new LogManager();
	crashed.initialize(plan);
	crashed.addEntry({ char: "q" });
	fs.closeSync(crashed.journal);
	crashed.journal = null;
	crashed.journalPath = null;
	crashed.logFilePath = null;

	assert.equal(
		journals(logs).length,
		1,
		"setup: a journal should be orphaned",
	);

	const fresh = new LogManager();
	fresh.initialize(plan);

	assert.equal(
		journals(logs).length,
		1,
		"only the new session's journal should remain",
	);
	const recoveredLogs = logFiles(logs).filter((n) => {
		const d = JSON.parse(fs.readFileSync(path.join(logs, n), "utf8"));
		return d.events.some((e) => e.char === "q");
	});
	assert.equal(
		recoveredLogs.length,
		1,
		"the crashed session's events are gone",
	);
	fresh.finalize();
});

test("writes are atomic - a reader never sees a half-written log", () => {
	const { plan, logs } = newPlan();
	const log = new LogManager();
	log.initialize(plan);
	for (let i = 0; i < 200; i++) log.addEntry({ char: String(i % 10) });
	log.save();

	for (const name of logFiles(logs)) {
		const text = fs.readFileSync(path.join(logs, name), "utf8");
		assert.doesNotThrow(
			() => JSON.parse(text),
			`${name} is not parseable JSON`,
		);
	}
	assert.equal(
		fs.readdirSync(logs).filter((n) => n.endsWith(".tmp")).length,
		0,
		"a temp file was left behind",
	);
	log.finalize();
});

test("event order survives a heavy burst", () => {
	const { plan, logs } = newPlan();
	const log = new LogManager();
	log.initialize(plan);
	const chars = Array.from({ length: 500 }, (_, i) => String(i % 7));
	for (const c of chars) log.addEntry({ char: c });

	const fromJournal = LogManager.readJournal(log.journalPath);
	assert.deepEqual(
		fromJournal.events.map((e) => e.char),
		chars,
		"the journal reordered events",
	);
	log.finalize();
});
