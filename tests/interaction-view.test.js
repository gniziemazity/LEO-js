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

test("the planned question colour follows the Settings on every surface", () => {
	assert.equal(view.QUESTION_BG, "var(--clr-question-bg)");
	const { buildSettingsCSS } = require("../src/shared/blocks");
	const css = buildSettingsCSS({
		fontSize: 16,
		colors: { questionColor: "#123456" },
	});
	assert.match(css, /--clr-question-bg: #123456;/);
});

test("titles, ids and labels come from one place", () => {
	assert.equal(view.interactionTitle("student-question"), "❓ Question");
	assert.equal(view.interactionTitle("student-help"), "🤝 Who needs help?");
	assert.equal(
		view.waitingTitle("student-question", "Ana", "why?"),
		"❓ Ana: why?",
	);
	assert.equal(view.waitingTitle("student-question", "Ana", null), "❓ Ana");
	assert.equal(
		view.waitingTitle("student-question", null, "why?"),
		"why?",
		"the teacher asked: the question alone, like a planned one",
	);
	assert.equal(
		view.waitingTitle("student-question", null, null),
		"❓ Question",
	);
	assert.equal(view.isTeacher(0), true);
	assert.equal(view.isTeacher(1), false);
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
			"Asked by",
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

test("the asker is the teacher by default, then any student", () => {
	const students = ["Zoe", "ada"];
	assert.deepEqual(view.askerChoices(students, "Ms. Lee"), [
		{ value: "teacher", label: "Ms. Lee" },
		{ value: "1", label: "ada" },
		{ value: "0", label: "Zoe" },
	]);
	assert.equal(view.askerFromValue("teacher"), "teacher");
	assert.equal(view.askerFromValue(""), "teacher", "nothing picked yet");
	assert.equal(view.askerFromValue("1"), 1);
	assert.equal(view.participantId(view.askerFromValue("teacher")), 0);
});

test("a question takes the planned colour only while the teacher is asking", () => {
	assert.equal(
		view.interactionBgVar("student-question", "teacher"),
		view.QUESTION_BG,
	);
	assert.equal(view.interactionBgVar("student-question", 1), "var(--clr-ask-bg)");
	assert.equal(view.interactionBgVar("student-question"), "var(--clr-ask-bg)");
	assert.equal(view.interactionBgVar("providing-help"), "var(--clr-help-bg)");
});

test("a question the teacher asked is logged as a teacher question", () => {
	assert.deepEqual(
		view.questionLogEntry({
			studentName: 0,
			questionText: "why?",
			answeredBy: 2,
			openedAt: 5,
			closedAt: 9,
		}),
		[
			"teacher-question",
			{ info: "why?", answered_by: 2, timestamp: 5, closed_at: 9 },
		],
	);
	assert.deepEqual(
		view.questionLogEntry({
			studentName: 3,
			questionText: "",
			answeredBy: 0,
		}),
		["student-question", { asked_by: 3, answered_by: 0 }],
		"a student asked, the teacher answered",
	);
	assert.deepEqual(
		view.questionLogEntry({ studentName: 3, answeredBy: undefined }),
		["student-question", { asked_by: 3, answered_by: null }],
		"nobody answered",
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
