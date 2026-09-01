"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const model = require("../lesson_tools/shared/simulator-model.js");
const {
	TextState,
	IGNORED_CHARS,
	PAUSE_CHAR,
	SHIFT_CURSOR_MOVES,
	resetClipboard,
	expandEvents,
	applyAtomicText,
} = model;

function replayEngine() {
	const dir = path.join(__dirname, "..", "lesson_tools", "shared");
	const src = ["text-state.js", "simulator-model.js", "simulator-replay.js"]
		.map((f) => fs.readFileSync(path.join(dir, f), "utf-8"))
		.join("\n");
	const make = new Function("window", `${src}\nreturn { headlessReplay };`);
	return make({}).headlessReplay;
}

function atomicState(text) {
	resetClipboard();
	const s = new TextState();
	applyAtomicText(s, text);
	return s;
}

function replayCodeInsert(text) {
	const headlessReplay = replayEngine();
	const res = headlessReplay([{ code_insert: text, timestamp: 0 }]);
	return res.files.get("MAIN").text;
}

test("a shift-arrow inside a code insert selects, it is not typed", () => {
	for (const ch of Object.keys(SHIFT_CURSOR_MOVES)) {
		const s = atomicState(`abc${ch}`);
		assert.equal(
			s.text.includes(ch),
			false,
			`${ch} must never reach the buffer as a literal character`,
		);
	}
});

test("shift-select then cut works inside a code insert", () => {
	const s = atomicState("one↩two↩three↑↑◄⇓⇓✂");
	assert.equal(s.text, "three");
});

test("headlessReplay handles a shift-selection inside a code insert", () => {
	const script = "one↩two↩three↑↑◄⇓⇓✂";
	assert.equal(replayCodeInsert(script), atomicState(script).text);
});

test("a plain cursor move inside a code insert drops the selection", () => {
	const s = atomicState("one↩two↩three↑↑◄⇓⇓►✂");
	assert.equal(
		s.text.includes("one"),
		true,
		"► should have collapsed the selection, so ✂ cuts a whole line instead",
	);
	assert.equal(replayCodeInsert("one↩two↩three↑↑◄⇓⇓►✂"), s.text);
});

test("ignored glyphs inside a code insert are dropped, not typed", () => {
	for (const ch of IGNORED_CHARS) {
		const s = atomicState(`ab${ch}cd`);
		assert.equal(
			s.text,
			"abcd",
			`${ch} must be ignored inside a code insert`,
		);
	}
});

test("the pause glyph inside a code insert is dropped, not typed", () => {
	assert.equal(atomicState(`ab${PAUSE_CHAR}cd`).text, "abcd");
});

test("headlessReplay drops ignored and pause glyphs like the model does", () => {
	for (const ch of [...IGNORED_CHARS, PAUSE_CHAR]) {
		const script = `ab${ch}cd`;
		assert.equal(
			replayCodeInsert(script),
			atomicState(script).text,
			`${ch} must be dropped by the replay engine too`,
		);
	}
});

test("the visualizer replays through the shared dispatcher, not its own copy", () => {
	const src = fs.readFileSync(
		path.join(__dirname, "..", "lesson_tools", "simulator", "visualizer.js"),
		"utf-8",
	);
	assert.match(
		src,
		/replayStep\(this\._replayCtx\(\), act, \{/,
		"_handle must delegate; a private copy is how it came to drift",
	);
	for (const gone of [
		"_handleChar(",
		"_handleCodeInsertAtomic(",
		"_autoIndent(",
		"_autoDedent(",
		"_backspaceIsIgnored(",
		"_devSemicolonNewline(",
	]) {
		assert.equal(
			src.includes(gone),
			false,
			`${gone} is a second implementation of a shared rule`,
		);
	}
});

test("a visualizer-shaped context replays identically to the headless one", () => {
	const { makeReplayContext, replayStep, expandEvents } = model;
	const script = "one↩two↩three↑↑◄⇓⇓✂►↩📥⌫";
	const events = [...script].map((ch, i) => ({ char: ch, timestamp: i }));

	const inner = makeReplayContext();
	const logged = [];
	const view = {
		get main() {
			return inner.main;
		},
		get dev() {
			return inner.dev;
		},
		get selAnchorMain() {
			return inner.selAnchorMain;
		},
		set selAnchorMain(v) {
			inner.selAnchorMain = v;
		},
		get activeFilename() {
			return inner.activeFilename;
		},
		switchToFile: (f) => inner.switchToFile(f),
		opensCloses: () => inner.opensCloses(),
	};
	resetClipboard();
	for (const act of expandEvents(events)) {
		replayStep(view, act, { log: (ts, text) => logged.push(text) });
	}
	const viaView = inner.files.get("MAIN").text;

	const headlessReplay = replayEngine();
	const viaHeadless = headlessReplay(events).files.get("MAIN").text;

	assert.equal(viaView, viaHeadless);
	assert.ok(logged.length > 0, "the logger hook must actually fire");
});
