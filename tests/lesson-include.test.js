"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const LessonManager = require("../src/renderer/lesson-manager");
const { extractAnchorSnippet } = require("../src/renderer/anchor-snippet");

function courseDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "leo-include-"));
}

function write(dir, name, blocks) {
	const p = path.join(dir, name);
	fs.writeFileSync(p, JSON.stringify(blocks, null, 2));
	return p;
}

function load(file) {
	const lm = new LessonManager();
	return new Promise((resolve, reject) => {
		lm.load(file, (err) => (err ? reject(err) : resolve(lm)));
	});
}

const PART1 = [
	{ type: "move-to", target: "index.html" },
	{
		type: "code",
		text: "<html>\n</html>↑►\n<body>⚓0⚓\n</body>💾",
	},
	{ type: "move-to", target: "app.js" },
	{ type: "code", text: 'console.log("hi");⚓1⚓💾' },
];

test("an include expands into a starting state, one paste per file", async () => {
	const dir = courseDir();
	write(dir, "part_1.leo", PART1);
	const p2 = write(dir, "part_2.leo", [
		{ type: "include", path: "./part_1.leo" },
		{ type: "comment", text: "Part 2" },
	]);

	const lm = await load(p2);
	const generated = lm.getAllBlocks().filter((b) => b.fromInclude);

	assert.equal(generated.length, 4, "two files → move-to + paste each");
	assert.equal(generated[0].type, "move-to");
	assert.equal(generated[0].target, "index.html");
	assert.ok(generated[1].text.startsWith("📋 "));
	assert.equal(generated[2].target, "app.js");
	assert.match(generated[3].text, /console\.log\("hi"\);/);
});

test("the included plan's anchors survive into the paste", async () => {
	const dir = courseDir();
	write(dir, "part_1.leo", PART1);
	const p2 = write(dir, "part_2.leo", [
		{ type: "include", path: "./part_1.leo" },
	]);

	const lm = await load(p2);
	const pastes = lm
		.getAllBlocks()
		.filter((b) => b.fromInclude && b.type === "comment");

	assert.match(pastes[0].text, /⚓0⚓/, "index.html keeps its anchor");
	assert.match(pastes[1].text, /⚓1⚓/, "app.js keeps its anchor");
});

test("an inherited anchor resolves as a move-to target", async () => {
	const dir = courseDir();
	write(dir, "part_1.leo", PART1);
	const p2 = write(dir, "part_2.leo", [
		{ type: "include", path: "./part_1.leo" },
		{ type: "move-to", target: "⚓0⚓" },
	]);

	const lm = await load(p2);
	const blocks = lm.getAllBlocks();
	const idx = blocks.findIndex(
		(b) => b.type === "move-to" && b.target === "⚓0⚓" && !b.fromInclude,
	);

	const snip = extractAnchorSnippet("⚓0⚓", idx, blocks);
	assert.ok(snip, "the anchor from part 1 must be reachable in part 2");
	assert.match(snip.lines[snip.arrowIdx], /<body>/);
});

test("new anchor ids continue past the inherited ones", async () => {
	const dir = courseDir();
	write(dir, "part_1.leo", PART1);
	const p2 = write(dir, "part_2.leo", [
		{ type: "include", path: "./part_1.leo" },
	]);

	const lm = await load(p2);
	assert.equal(lm.getNextAnchorId(), 2, "part 1 used 0 and 1");
});

test("saving writes the include, never the blocks it generated", async () => {
	const dir = courseDir();
	write(dir, "part_1.leo", PART1);
	const authored = [
		{ type: "include", path: "./part_1.leo" },
		{ type: "comment", text: "Part 2" },
	];
	const p2 = write(dir, "part_2.leo", authored);

	const lm = await load(p2);
	await new Promise((resolve, reject) =>
		lm.save((err) => (err ? reject(err) : resolve())),
	);

	const onDisk = JSON.parse(fs.readFileSync(p2, "utf8"));
	assert.deepEqual(onDisk, authored, "the file must round-trip unchanged");
	assert.ok(
		!JSON.stringify(onDisk).includes("📋"),
		"no generated paste may reach disk",
	);
});

test("includes chain, and the state carries through the whole chain", async () => {
	const dir = courseDir();
	write(dir, "part_1.leo", PART1);
	write(dir, "part_2.leo", [
		{ type: "include", path: "./part_1.leo" },
		{ type: "move-to", target: "app.js" },
		{ type: "code", text: "\nconst x = 1;⚓2⚓💾" },
	]);
	const p3 = write(dir, "part_3.leo", [
		{ type: "include", path: "./part_2.leo" },
	]);

	const lm = await load(p3);
	const pastes = lm
		.getAllBlocks()
		.filter((b) => b.fromInclude && b.type === "comment");
	const appJs = pastes.find((b) => b.text.includes("console.log"));

	assert.match(appJs.text, /const x = 1;/, "part 2's edit must be present");
	assert.match(appJs.text, /⚓2⚓/, "and its anchor too");
	assert.equal(lm.getNextAnchorId(), 3);
});

test("a cycle is reported, not followed", async () => {
	const dir = courseDir();
	write(dir, "a.leo", [{ type: "include", path: "./b.leo" }]);
	write(dir, "b.leo", [{ type: "include", path: "./a.leo" }]);

	await assert.rejects(() => load(path.join(dir, "a.leo")), /loops back/);
});

test("a missing included plan names the file it could not find", async () => {
	const dir = courseDir();
	const p = write(dir, "solo.leo", [{ type: "include", path: "./nope.leo" }]);

	await assert.rejects(() => load(p), /nope\.leo/);
});

test("the generated paste follows the unindented convention", async () => {
	const dir = courseDir();
	write(dir, "part_1.leo", PART1);
	const p2 = write(dir, "part_2.leo", [
		{ type: "include", path: "./part_1.leo" },
	]);

	const lm = await load(p2);
	for (const b of lm.getAllBlocks()) {
		if (!b.fromInclude || b.type !== "comment") continue;
		assert.ok(
			!/\n[\t ]+\S/.test(b.text),
			"a generated paste must carry no leading indentation:\n" + b.text,
		);
	}
});

test("replaying a generated paste reproduces the code it came from", async () => {
	const { replayPlan } = require("../src/renderer/anchor-snippet");
	const dir = courseDir();
	write(dir, "part_1.leo", PART1);
	const p2 = write(dir, "part_2.leo", [
		{ type: "include", path: "./part_1.leo" },
	]);

	const source = replayPlan(PART1);
	const lm = await load(p2);
	const rebuilt = replayPlan(lm.getAllBlocks());

	for (const name of ["index.html", "app.js"]) {
		const strip = (t) =>
			t
				.split("\n")
				.map((l) => l.trim())
				.join("\n");
		assert.equal(
			strip(rebuilt.editors[name].text),
			strip(source.editors[name].text),
			`${name} must come back through the include, up to indentation`,
		);
	}
});

test("an anchor sitting in a line's indent is kept, not swallowed", () => {
	const { toReplayableText } = require("../src/renderer/anchor-snippet");
	const out = toReplayableText("class A {\n\t⚓5⚓\tgo();\n}");
	assert.match(out, /⚓5⚓go\(\);/, "the anchor survives the dedent");
	assert.ok(!/\n[\t ]/.test(out), "and no leading indentation is left behind");
});

test("every plan has a blank start-with slot, and only one", async () => {
	const dir = courseDir();
	const p = write(dir, "solo.leo", [{ type: "comment", text: "hi" }]);

	const lm = await load(p);
	const includes = lm.getAllBlocks().filter((b) => b.type === "include");
	assert.equal(includes.length, 1, "exactly one slot");
	assert.equal(includes[0], lm.getAllBlocks()[0], "and it comes first");
	assert.equal(lm.getStartWith(), "", "blank by default");
});

test("a blank start-with is never written to disk", async () => {
	const dir = courseDir();
	const authored = [{ type: "comment", text: "hi" }];
	const p = write(dir, "solo.leo", authored);

	const lm = await load(p);
	await new Promise((res, rej) => lm.save((e) => (e ? rej(e) : res())));

	assert.deepEqual(JSON.parse(fs.readFileSync(p, "utf8")), authored);
});

test("setting start-with keeps it a singleton", async () => {
	const dir = courseDir();
	write(dir, "part_1.leo", PART1);
	const p = write(dir, "part_2.leo", [{ type: "comment", text: "hi" }]);

	const lm = await load(p);
	lm.setStartWith("./part_1.leo");
	lm.setStartWith("./part_1.leo");
	assert.equal(
		lm.getAllBlocks().filter((b) => b.type === "include").length,
		1,
	);

	await new Promise((res, rej) => lm.save((e) => (e ? rej(e) : res())));
	const onDisk = JSON.parse(fs.readFileSync(p, "utf8"));
	assert.deepEqual(onDisk[0], { type: "include", path: "./part_1.leo" });
	assert.equal(onDisk.filter((b) => b.type === "include").length, 1);
});

test("clearing start-with drops it from the file again", async () => {
	const dir = courseDir();
	write(dir, "part_1.leo", PART1);
	const p = write(dir, "part_2.leo", [
		{ type: "include", path: "./part_1.leo" },
		{ type: "comment", text: "hi" },
	]);

	const lm = await load(p);
	lm.setStartWith("");
	await new Promise((res, rej) => lm.save((e) => (e ? rej(e) : res())));

	const onDisk = JSON.parse(fs.readFileSync(p, "utf8"));
	assert.deepEqual(onDisk, [{ type: "comment", text: "hi" }]);
});

test("the sibling list offers the other plans, never the plan itself", async () => {
	const dir = courseDir();
	write(dir, "part_1.leo", PART1);
	write(dir, "part_3.leo", []);
	const p = write(dir, "part_2.leo", []);

	const lm = await load(p);
	assert.deepEqual(lm.listSiblingPlans(), ["./part_1.leo", "./part_3.leo"]);
});

test("inherited steps are skipped by the cursor, and logged as it passes", () => {
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

	cm.setExecutionSteps([
		{
			type: "block",
			fromInclude: true,
			subtype: "move-to",
			target: "a.js",
			element: el("➡️"),
			globalIndex: 0,
		},
		{
			type: "block",
			fromInclude: true,
			element: el("📋 const x = 1;"),
			globalIndex: 1,
		},
		{ type: "block", element: el("the lesson starts here"), globalIndex: 2 },
	]);
	cm.updateCursor();

	assert.equal(
		cm.getCurrentStep(),
		2,
		"the cursor lands on the first real block",
	);
	assert.deepEqual(
		logged,
		[{ move_to: "a.js" }, { code_insert: "const x = 1;" }],
		"the starting state still reaches the log",
	);
	assert.ok(
		!ipc.sent.some((m) => m.ch === "enter-code-insert-block"),
		"and no paste popup is opened for it",
	);
});

test("passing an inherited step twice does not log it twice", () => {
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
	cm.setExecutionSteps([
		{ type: "block", fromInclude: true, element: el("📋 x"), globalIndex: 0 },
		{ type: "block", element: el("real"), globalIndex: 1 },
	]);

	cm.updateCursor();
	cm.jumpTo(0);
	cm.updateCursor();

	assert.equal(logged.length, 1, "logged once, not on every pass");
});
