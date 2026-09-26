"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const LessonManager = require("../src/renderer/lesson-manager");
const {
	extractAnchorSnippet,
	replayPlan,
} = require("../src/renderer/anchor-snippet");
const {
	embedAnchors,
	readAnchors,
	listStartFiles,
} = require("../src/shared/start-folder");

const INDEX = "<html>\n  <body>\n  </body>\n</html>\n";
const APP = 'function main() {\n  console.log("hi");\n}\n';

function courseDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "leo-start-"));
}

function writePlan(dir, name, blocks) {
	const p = path.join(dir, name);
	fs.writeFileSync(p, JSON.stringify(blocks, null, 2));
	return p;
}

function writeFile(dir, rel, content) {
	const p = path.join(dir, rel);
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, content);
}

function startFolder(dir, planName, files) {
	for (const [rel, content] of Object.entries(files)) {
		writeFile(path.join(dir, `${planName}_start`), rel, content);
	}
}

function load(file) {
	const lm = new LessonManager();
	return new Promise((resolve, reject) => {
		lm.load(file, (err) => (err ? reject(err) : resolve(lm)));
	});
}

function save(lm) {
	return new Promise((resolve, reject) =>
		lm.save((err) => (err ? reject(err) : resolve())),
	);
}

function startPastes(lm) {
	return lm.getAllBlocks().filter((b) => b.startFile);
}

test("without a folder named like the plan there is no start at all", async () => {
	const dir = courseDir();
	const authored = [{ type: "comment", text: "Part 1" }];
	const p = writePlan(dir, "part_1.leo", authored);

	const lm = await load(p);
	const blocks = lm.getAllBlocks();
	assert.equal(blocks[0].type, "include", "the slot is still block 0");
	assert.equal(blocks[0].dir, null, "and says there is nothing to start from");
	assert.equal(blocks.filter((b) => b.fromInclude).length, 0);

	await save(lm);
	assert.deepEqual(JSON.parse(fs.readFileSync(p, "utf8")), authored);
});

test("a sibling plan's own folder is not this plan's start", async () => {
	const dir = courseDir();
	startFolder(dir, "part_1", { "index.html": INDEX });
	const p = writePlan(dir, "part_2.leo", []);

	const lm = await load(p);
	assert.equal(lm.getAllBlocks()[0].dir, null);
});

test("every file in the folder becomes a move-to and a paste, in order", async () => {
	const dir = courseDir();
	startFolder(dir, "part_2", {
		"index.html": INDEX,
		"app.js": APP,
		"src/util.ts": "export const x = 1;\n",
	});
	const p = writePlan(dir, "part_2.leo", [{ type: "comment", text: "Go" }]);

	const lm = await load(p);
	const blocks = lm.getAllBlocks();
	assert.equal(blocks[0].dir, "part_2_start");
	assert.equal(blocks[0].files, 3);
	assert.deepEqual(
		blocks.slice(1, 7).map((b) => (b.type === "move-to" ? b.target : b.text)),
		[
			"app.js",
			`📋 ${APP}`,
			"index.html",
			`📋 ${INDEX}`,
			"src/util.ts",
			"📋 export const x = 1;\n",
		],
	);
	assert.ok(blocks.slice(1, 7).every((b) => b.fromInclude));
	assert.equal(blocks[7].text, "Go", "the authored plan follows");
	assert.equal(lm.firstAuthoredIndex(), 7);
});

test("tooling folders, binaries and line endings are not the lesson's code", () => {
	const dir = courseDir();
	writeFile(dir, "app.js", "a();\r\nb();\r\n");
	writeFile(dir, "node_modules/x/index.js", "nope");
	writeFile(dir, ".git/HEAD", "ref: refs/heads/main");
	writeFile(dir, "logo.png", Buffer.from([0x89, 0x50, 0x00, 0x47]));

	assert.deepEqual(listStartFiles(dir), [
		{ name: "app.js", text: "a();\nb();\n" },
	]);
});

test("stored anchors land at their line and column", async () => {
	const dir = courseDir();
	startFolder(dir, "part_2", { "index.html": INDEX });
	const p = writePlan(dir, "part_2.leo", [
		{
			type: "include",
			anchors: { "index.html": { 3: [2, 9], 4: [3, 10] } },
		},
	]);

	const lm = await load(p);
	assert.equal(
		startPastes(lm)[0].text,
		"📋 <html>\n  <body>⚓3⚓\n  </body>⚓4⚓\n</html>\n",
	);
});

test("an anchor past the end of the file is dropped, a long column clamps", () => {
	assert.equal(embedAnchors("ab\ncd", { 1: [9, 1] }), "ab\ncd");
	assert.equal(embedAnchors("ab\ncd", { 1: [1, 40] }), "ab⚓1⚓\ncd");
});

test("reading a body gives back the code and where each anchor sits", () => {
	assert.deepEqual(readAnchors("ab⚓1⚓\ncd⚓7⚓"), {
		clean: "ab\ncd",
		anchors: { 1: [1, 3], 7: [2, 3] },
	});
	assert.deepEqual(
		readAnchors("ab⚓1\ncd"),
		{ clean: "ab\ncd", anchors: {} },
		"backspacing into a token removes the anchor, not the code",
	);
});

test("only anchors may change in a start file", async () => {
	const dir = courseDir();
	startFolder(dir, "part_2", { "index.html": INDEX });
	const p = writePlan(dir, "part_2.leo", []);
	const lm = await load(p);
	const at = lm.getAllBlocks().findIndex((b) => b.startFile);

	assert.equal(
		lm.setStartAnchors(at, INDEX.replace("<body>", "<body id=x>")),
		false,
		"a code edit is refused",
	);
	assert.equal(lm.hasChanges(), false);
	assert.deepEqual(lm.getAllBlocks()[0].anchors, {});

	assert.equal(
		lm.setStartAnchors(at, INDEX.replace("<body>", "<body>⚓0⚓")),
		true,
	);
	assert.equal(lm.hasChanges(), true);
	assert.deepEqual(lm.getAllBlocks()[0].anchors, {
		"index.html": { 0: [2, 9] },
	});
	assert.equal(
		lm.getAllBlocks()[at].text,
		`📋 ${INDEX.replace("<body>", "<body>⚓0⚓")}`,
	);

	lm.setStartAnchors(at, INDEX.replace("<body>", "<body>⚓0"));
	assert.deepEqual(
		lm.getAllBlocks()[0].anchors,
		{},
		"and removing the last one leaves no empty map behind",
	);
	assert.equal(lm.getAllBlocks()[at].text, `📋 ${INDEX}`);
});

test("re-reading the same anchors is not a change", async () => {
	const dir = courseDir();
	startFolder(dir, "part_2", { "index.html": INDEX });
	const p = writePlan(dir, "part_2.leo", [
		{ type: "include", anchors: { "index.html": { 0: [2, 9] } } },
	]);
	const lm = await load(p);
	const at = lm.getAllBlocks().findIndex((b) => b.startFile);

	lm.setStartAnchors(at, INDEX.replace("<body>", "<body>⚓0⚓"));
	assert.equal(lm.hasChanges(), false);
});

test("an authored block can never take anchors this way", async () => {
	const dir = courseDir();
	const p = writePlan(dir, "part_1.leo", [{ type: "comment", text: "📋 x" }]);
	const lm = await load(p);
	assert.equal(lm.canSetStartAnchors(1, "x⚓0⚓"), false);
	assert.equal(lm.setStartAnchors(1, "x⚓0⚓"), false);
});

test("saving writes the anchors and nothing generated", async () => {
	const dir = courseDir();
	startFolder(dir, "part_2", { "index.html": INDEX, "app.js": APP });
	const authored = [
		{ type: "include", anchors: { "index.html": { 0: [2, 9] } } },
		{ type: "move-to", target: "⚓0⚓" },
	];
	const p = writePlan(dir, "part_2.leo", authored);

	const lm = await load(p);
	await save(lm);
	assert.deepEqual(JSON.parse(fs.readFileSync(p, "utf8")), authored);
});

test("a start folder with no anchors saves no include at all", async () => {
	const dir = courseDir();
	startFolder(dir, "part_2", { "index.html": INDEX });
	const p = writePlan(dir, "part_2.leo", [
		{ type: "include", anchors: { "index.html": {} } },
		{ type: "comment", text: "Go" },
	]);

	const lm = await load(p);
	await save(lm);
	assert.deepEqual(JSON.parse(fs.readFileSync(p, "utf8")), [
		{ type: "comment", text: "Go" },
	]);
});

test("a stored anchor resolves as a move-to target", async () => {
	const dir = courseDir();
	startFolder(dir, "part_2", { "index.html": INDEX, "app.js": APP });
	const p = writePlan(dir, "part_2.leo", [
		{ type: "include", anchors: { "app.js": { 0: [1, 18] } } },
		{ type: "move-to", target: "⚓0⚓" },
	]);

	const lm = await load(p);
	const blocks = lm.getAllBlocks();
	const idx = blocks.findIndex((b) => b.target === "⚓0⚓");
	assert.deepEqual(lm.anchorIdsBefore(idx), ["0"]);

	const snip = extractAnchorSnippet("⚓0⚓", idx, blocks);
	assert.ok(snip);
	assert.match(snip.lines[snip.arrowIdx], /function main/);
	assert.equal(snip.switchTo, "app.js", "index.html was the file left open");
});

test("new anchor ids continue past the stored ones", async () => {
	const dir = courseDir();
	startFolder(dir, "part_2", { "index.html": INDEX });
	const p = writePlan(dir, "part_2.leo", [
		{ type: "include", anchors: { "index.html": { 4: [1, 1] } } },
	]);

	const lm = await load(p);
	assert.equal(lm.getNextAnchorId(), 5);
});

test("replaying the start rebuilds every file byte for byte", async () => {
	const dir = courseDir();
	const nested = "a {\n  b {\n    c: 1;\n  }\n}\n";
	startFolder(dir, "part_2", {
		"index.html": INDEX,
		"app.js": APP,
		"style.css": nested,
	});
	const p = writePlan(dir, "part_2.leo", [
		{
			type: "include",
			anchors: { "style.css": { 0: [3, 5] }, "app.js": { 1: [2, 21] } },
		},
	]);

	const lm = await load(p);
	const { editors } = replayPlan(lm.getAllBlocks());
	assert.equal(editors["index.html"].text, INDEX);
	assert.equal(editors["app.js"].text, APP);
	assert.equal(editors["style.css"].text, nested);
	assert.deepEqual(Object.keys(editors["style.css"].anchors), ["0"]);
});

test("the first authored move-to into a start file does not create it", async () => {
	const dir = courseDir();
	startFolder(dir, "part_2", { "index.html": INDEX });
	const p = writePlan(dir, "part_2.leo", [
		{ type: "move-to", target: "index.html" },
		{ type: "move-to", target: "app.js" },
	]);

	const lm = await load(p);
	const blocks = lm.getAllBlocks();
	const authored = (t) =>
		blocks.findIndex((b) => !b.fromInclude && b.target === t);
	assert.equal(lm.isFirstMoveToFile(authored("index.html")), false);
	assert.equal(lm.isFirstMoveToFile(authored("app.js")), true);
});

test("start files are context: they can be neither moved nor re-kinded", async () => {
	const dir = courseDir();
	startFolder(dir, "part_2", { "index.html": INDEX });
	const p = writePlan(dir, "part_2.leo", [{ type: "comment", text: "Go" }]);

	const lm = await load(p);
	assert.equal(lm.canMoveBlock(2, 1), false);
	assert.equal(lm.canMoveBlock(3, -1), false);
	assert.equal(lm.canSetBlockKind(2, "code"), false);
});

function cursorWith(steps) {
	const { loadModule, fakeIpcRenderer } = require("./helpers/load-module.js");
	const ipc = fakeIpcRenderer({ invoke: async () => ({}) });
	const CursorManager = loadModule("src/renderer/cursor-manager.js", {
		electron: ipc.stub,
	});
	const logged = [];
	const cm = new CursorManager(
		{ updateProgressBar() {}, removeCursorClasses() {} },
		{ addEntry: (e) => logged.push(e) },
	);
	const el = (text) => ({
		classList: { add() {}, remove() {} },
		scrollIntoView() {},
		innerText: text,
		title: "",
		dataset: {},
	});
	cm.setExecutionSteps(
		steps.map((s) => ({ ...s, element: el(s.text || "") })),
	);
	return { cm, logged, ipc };
}

test("start steps are skipped by the cursor, and logged as it passes", () => {
	const { cm, logged, ipc } = cursorWith([
		{
			type: "block",
			fromInclude: true,
			kind: "move-to",
			target: "a.js",
			globalIndex: 0,
		},
		{
			type: "block",
			fromInclude: true,
			text: "📋 const x = 1;⚓0⚓",
			globalIndex: 1,
		},
		{ type: "block", text: "the lesson starts here", globalIndex: 2 },
	]);
	cm.updateCursor();

	assert.equal(
		cm.getCurrentStep(),
		2,
		"the cursor lands on the first real block",
	);
	assert.deepEqual(
		logged,
		[{ move_to: "a.js" }, { code_insert: "const x = 1;⚓0⚓" }],
		"the starting state, anchors included, still reaches the log",
	);
	assert.ok(
		!ipc.sent.some((m) => m.ch === "enter-code-insert-block"),
		"and no paste popup is opened for it",
	);
});

test("passing a start step twice does not log it twice", () => {
	const { cm, logged } = cursorWith([
		{ type: "block", fromInclude: true, text: "📋 x", globalIndex: 0 },
		{ type: "block", text: "real", globalIndex: 1 },
	]);

	cm.updateCursor();
	cm.jumpTo(0);
	cm.updateCursor();

	assert.equal(logged.length, 1, "logged once, not on every pass");
});
