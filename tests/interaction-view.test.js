"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const view = require("../src/shared/interaction-view");

const read = (p) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf-8");

test("the two interaction colours match the CSS variables they name", () => {
	const css = read("src/shared/styles.css");
	const varValue = (name) => {
		const m = css.match(new RegExp(`--${name}:\s*([^;]+);`));
		assert.ok(m, `--${name} must be defined in styles.css`);
		return m[1].trim();
	};
	assert.equal(view.INTERACTION_BG.question, varValue("clr-ask-bg"));
	assert.equal(view.INTERACTION_BG.help, varValue("clr-help-bg"));
});

test("titles, ids and labels come from one place", () => {
	assert.equal(
		view.interactionTitle("student-question"),
		"❓ Who asked a question?",
	);
	assert.equal(view.interactionTitle("student-help"), "🤝 Who needs help?");
	assert.equal(
		view.waitingTitle("student-question", "Ana", "why?"),
		"❓ Ana: why?",
	);
	assert.equal(view.waitingTitle("student-question", "Ana", null), "❓ Ana");
	assert.equal(view.waitingTitle("student-help", "Ana"), "🤝 Helping Ana");
	assert.equal(
		view.participantId("teacher"),
		0,
		"the teacher is 0 in the log",
	);
	assert.equal(view.participantId(0), 1, "students are 1-based in the log");
	assert.equal(view.participantId(4), 5);
});

test("neither surface still spells the shared vocabulary out itself", () => {
	for (const f of [
		"src/renderer/desk-popup.js",
		"src/shared/remote/interaction-overlay.js",
	]) {
		const src = read(f);
		for (const literal of [
			"Who asked a question?",
			"Who needs help?",
			"Done — close",
			"Helping ${",
		]) {
			assert.equal(
				src.includes(literal),
				false,
				`${f} still carries its own copy of "${literal}"`,
			);
		}
	}
	assert.equal(
		read("src/main/main.js").includes("#ffe0b2"),
		false,
		"main.js still hardcodes the interaction colour as hex",
	);
});

test("the desk card uses the configured teacher name, like the phone does", () => {
	const src = read("src/renderer/desk-popup.js");
	assert.match(src, /setTeacherName\(name\)/);
	assert.match(src, /this\._studentBtn\(grid, this\.teacherName,/);
	assert.match(
		read("src/renderer/app.js"),
		/deskPopup\.setTeacherName\(s\.teacherName\)/,
	);
});

test("remote.html loads interaction-view before the overlay that reads it", () => {
	const html = read("src/remote.html");
	assert.ok(
		html.indexOf("interaction-view.js") <
			html.indexOf("remote/interaction-overlay.js"),
		"a script that defines a global must load before its user",
	);
});
