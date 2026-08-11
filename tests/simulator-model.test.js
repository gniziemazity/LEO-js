"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const model = require("../lesson_tools/shared/simulator-model.js");
const { TextState } = model;

function typed(str) {
	const s = new TextState();
	let t = 0;
	for (const ch of str) s.insert(ch, t++);
	return s;
}

test("VSCodeSettings is no longer exported (smart features removed)", () => {
	assert.equal("VSCodeSettings" in model, false);
});

test("insert: updates text, cursor and per-char timestamps", () => {
	const s = new TextState();
	s.insert("a", 10);
	s.insert("b", 20);
	assert.equal(s.text, "ab");
	assert.equal(s.cursor, 2);
	assert.deepEqual(s.charTs, [10, 20]);
});

test("insert: shifts anchors at/after the insert position, leaves earlier ones", () => {
	const s = typed("abc"); // cursor 3
	s.setAnchor("end"); // end -> 3
	s.anchors.mid = 1; // anchor before the insert point
	s.cursor = 1;
	s.insert("X", 0); // insert at pos 1 -> "aXbc"
	assert.equal(s.text, "aXbc");
	assert.equal(s.anchors.end, 4); // 3 -> 4 (was after pos)
	assert.equal(s.anchors.mid, 1); // before pos -> unchanged
});

test("insert at a plain anchor (no jump/backspace) does not push it", () => {
	const s = typed("abc");
	s.setAnchor("A"); // A == cursor == 3
	s.insert("x", 0); // pos 3; A == pos but not the followed anchor -> not pushed
	assert.equal(s.text, "abcx");
	assert.equal(s.anchors.A, 3);
});

test("anchor-follow: jump + backspace makes a later insert push the anchor", () => {
	const s = typed("abc");
	s.setAnchor("A"); // A = 3
	s.jumpToAnchor("A"); // cursor 3, now following A
	s.deleteBack(1); // delete 'c' -> "ab"; A clamps 3 -> 2; backspace flag set
	assert.equal(s.text, "ab");
	assert.equal(s.anchors.A, 2);
	s.insert("Z", 0); // pos 2; A == pos, followed + had-backspace -> pushed
	assert.equal(s.text, "abZ");
	assert.equal(s.anchors.A, 3); // stays after the inserted text
	assert.equal(s.cursor, 3);
});

test("deleteBack: no-op when fewer than n chars precede the cursor", () => {
	const s = typed("ab");
	s.cursor = 1;
	s.deleteBack(5);
	assert.equal(s.text, "ab");
	assert.equal(s.cursor, 1);
});

test("deleteBack: removes chars and repositions anchors (shift / clamp / keep)", () => {
	const s = typed("abcde"); // cursor 5
	s.anchors.after = 4; // >= cursor after move -> shifts by n
	s.anchors.mid = 3; // inside (start, cursor) -> clamps to start
	s.anchors.before = 1; // before start -> unchanged
	s.cursor = 4;
	s.deleteBack(2); // delete "cd" (idx 2..4) -> "abe"; start = 2
	assert.equal(s.text, "abe");
	assert.equal(s.cursor, 2);
	assert.equal(s.anchors.after, 2); // 4 - 2
	assert.equal(s.anchors.mid, 2); // clamped to start
	assert.equal(s.anchors.before, 1); // untouched
});

test("deleteForward: removes ahead, no-op at end of buffer", () => {
	const s = typed("abcde");
	s.cursor = 1;
	s.deleteForward(2); // remove "bc" -> "ade"
	assert.equal(s.text, "ade");
	assert.equal(s.cursor, 1);
	s.cursor = s.text.length;
	s.deleteForward(1); // at end -> no-op
	assert.equal(s.text, "ade");
});

test("deleteLine: removes the whole line including its trailing newline", () => {
	const s = typed("ab\ncd\nef");
	s.cursor = 4; // inside "cd"
	s.deleteLine();
	assert.equal(s.text, "ab\nef");
	assert.equal(s.cursor, 3); // start of the (now) second line
});

test("moveCursor linestart: lands at first non-indent column", () => {
	const s = typed("  abc"); // two leading spaces
	s.cursor = 5;
	s.moveCursor("linestart");
	assert.equal(s.cursor, 2);
});

test("moveCursor lineend: lands at end of the current line", () => {
	const s = typed("abc\nde");
	s.cursor = 0;
	s.moveCursor("lineend");
	assert.equal(s.cursor, 3);
});

test("moveCursor horizontal: clamps within the buffer", () => {
	const s = typed("abc");
	s.cursor = 1;
	s.moveCursor([0, 5]); // +5 cols, clamped to length
	assert.equal(s.cursor, 3);
	s.moveCursor([0, -10]); // clamped to 0
	assert.equal(s.cursor, 0);
});

test("moveCursor vertical: keeps column, clamped to target line length", () => {
	const s = typed("abc\nde");
	s.cursor = 2; // line 0, col 2
	s.moveCursor([1, 0]); // down one line; col 2 fits "de"
	assert.equal(s.cursor, 6); // end of "de"
});

test("setAnchor / jumpToAnchor: record and restore the cursor", () => {
	const s = typed("abcdef");
	s.cursor = 2;
	s.setAnchor("here"); // here = 2
	s.cursor = 5;
	assert.equal(s.jumpToAnchor("here"), true);
	assert.equal(s.cursor, 2);
	assert.equal(s.jumpToAnchor("missing"), false);
	assert.equal(s.cursor, 2); // unchanged on a miss
});
