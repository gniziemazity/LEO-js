"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildRemote } = require("./helpers/remote-dom");

const active = (node) => node.classList.contains("active");

test("a reconnect closes a popup the host has moved past", () => {
	const h = buildRemote();
	h.api.setSessionActive(true);

	h.api.showNoteOverlay({ text: "look at this" });
	assert.equal(active(h.nodes.noteOverlay), true, "setup: the note is open");

	h.sent.length = 0;
	h.api.resyncOverlays({});

	assert.equal(
		active(h.nodes.noteOverlay),
		false,
		"a note that ended while the phone was away stays on screen for good",
	);
	assert.deepEqual(
		h.sent,
		[],
		"a resync must never tell the host anything - that would advance the lesson",
	);
});

test("a reconnect leaves a popup the host still has open", () => {
	const h = buildRemote();
	h.api.setSessionActive(true);
	h.api.showNoteOverlay({ text: "still live" });

	h.api.resyncOverlays({ activeNote: { text: "still live" } });

	assert.equal(
		active(h.nodes.noteOverlay),
		true,
		"the popup the host is actually showing was closed",
	);
});

test("every host-driven overlay is resynced, not just the note", () => {
	const h = buildRemote();
	h.api.setSessionActive(true);

	h.api.showQuestionOverlay("q?", ["Ann"], null, []);
	h.api.showMoveToOverlay({ mode: "file", target: "app.js" });
	h.api.showCodeInsertOverlay({ text: "x", paste: true });
	h.api.showNoteOverlay({ text: "n" });
	h.api.showMediaOverlay({ kind: "image", name: "a.png" });

	h.api.resyncOverlays({});

	for (const id of [
		"questionOverlay",
		"moveToOverlay",
		"codeInsertOverlay",
		"noteOverlay",
		"mediaOverlay",
	]) {
		assert.equal(active(h.nodes[id]), false, `${id} was left open`);
	}
});

test("the phone's own interaction picker is not closed by a resync", () => {
	const h = buildRemote();
	h.api.setSessionActive(true);
	h.api.setStudents(["Ann", "Bo"]);
	h.api.handleInteractionBtn("student-question");
	assert.equal(
		active(h.nodes.interactionOverlay),
		true,
		"setup: the picker should be open",
	);

	h.api.resyncOverlays({});

	assert.equal(
		active(h.nodes.interactionOverlay),
		true,
		"the picker belongs to the phone, not the host, so a resync must leave it",
	);
});

test("remote.html resyncs before it applies the snapshot", () => {
	const src = fs.readFileSync(
		path.resolve(__dirname, "..", "src/remote.html"),
		"utf-8",
	);
	const fn = /function updateAllState\(state\) \{[\s\S]*?\n\t\t\t\}/.exec(src);
	assert.ok(fn, "updateAllState not found");
	const body = fn[0];

	assert.match(body, /resyncOverlays\(state\)/);
	assert.ok(
		body.indexOf("resyncOverlays(state)") <
			body.indexOf("if (state.activeNote)"),
		"closing stale overlays must happen before reopening live ones",
	);
	assert.match(
		src,
		/setConnectionHandler\(/,
		"a dead socket must be visible on the phone",
	);
});
