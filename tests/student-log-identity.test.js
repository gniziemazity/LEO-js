"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
	resolveStudentName,
	settingsManager,
	broadcastServer,
} = require("../src/main/context");

test("resolveStudentName: roster position -> name, 0/teacher-id -> teacher name", () => {
	broadcastServer.currentState.students = ["Ada", "Bo", "Cy"];
	const savedTeacherName = settingsManager.settings.teacherName;
	settingsManager.settings.teacherName = "Ms. Lee";
	try {
		assert.equal(resolveStudentName(1), "Ada");
		assert.equal(resolveStudentName(2), "Bo");
		assert.equal(
			resolveStudentName("3"),
			"Cy",
			"a numeric string resolves too",
		);
		assert.equal(resolveStudentName(0), "Ms. Lee");
		assert.equal(resolveStudentName("0"), "Ms. Lee");
		assert.equal(resolveStudentName(99), null, "out of range");
		assert.equal(resolveStudentName(null), null);
		assert.equal(
			resolveStudentName("already a name"),
			"already a name",
			"a non-numeric string passes through unchanged",
		);
	} finally {
		settingsManager.settings.teacherName = savedTeacherName;
	}
});

const MAIN_SRC = fs.readFileSync(
	path.resolve(__dirname, "..", "src/main/main.js"),
	"utf-8",
);

function handlerBody(eventName) {
	const re = new RegExp(
		`broadcastServer\\.on\\(\\s*"${eventName}"[\\s\\S]*?\\n\\}\\);`,
	);
	const m = re.exec(MAIN_SRC);
	assert.ok(m, `handler for ${eventName} not found`);
	return m[0];
}

test("a student's answer is logged by roster id, not by the name shown on screen", () => {
	const body = handlerBody("client-student-answered");

	assert.match(
		body,
		/state\.send\("question-answered",\s*\{\s*studentName\s*\}\)/,
		"question-answered must carry the raw id the renderer logs verbatim - " +
			"sending the resolved name here is what silently dropped every " +
			"answered marker from the generated report",
	);
	assert.match(
		body,
		/qw\.webContents\.send\("set-answered", resolved\)/,
		"the floating question window still gets the resolved name to display",
	);
	assert.match(
		body,
		/floatState\.questionWindowStudentAnswered = resolved/,
		"the on-screen 'who answered' state still shows a name, not a bare id",
	);
});

test("a student-question/providing-help close is logged by roster id", () => {
	const body = handlerBody("client-close-student-interaction");

	assert.match(
		body,
		/state\.send\("log-student-interaction",\s*\{[\s\S]*?studentName,/,
		"log-student-interaction must carry the raw id: it feeds asked_by/" +
			"student in the log, which lesson_tools' report_excel.py only " +
			"recognises as a student id (int or list of ints) - a name " +
			"string is silently ignored there",
	);
	assert.ok(
		!/log-student-interaction[\s\S]*?resolveStudentName/.test(body),
		"resolveStudentName must not run on the value that reaches the log",
	);
});

test("the floating interaction window (display only) still resolves to a name", () => {
	const body = handlerBody("client-show-student-interaction");
	assert.match(body, /const resolved = resolveStudentName\(studentName\)/);
	assert.match(
		body,
		/openQuestionWindow\(displayText, bgColor, emoji, resolved\)/,
		"this path never reaches the log, so showing a name here is correct",
	);
});

test("the renderer writes the log-student-interaction payload straight into the log fields", () => {
	const appSrc = fs.readFileSync(
		path.resolve(__dirname, "..", "src/renderer/app.js"),
		"utf-8",
	);
	const handler =
		/ipcRenderer\.on\(\s*"log-student-interaction"[\s\S]*?\n\t\);/.exec(
			appSrc,
		);
	assert.ok(handler, "log-student-interaction listener not found");
	assert.match(handler[0], /asked_by: studentName/);
	assert.match(handler[0], /student: studentName/);
});

test("the renderer writes question-answered's payload straight into answered_by", () => {
	const appSrc = fs.readFileSync(
		path.resolve(__dirname, "..", "src/renderer/app.js"),
		"utf-8",
	);
	const handler =
		/ipcRenderer\.on\(\s*"question-answered"[\s\S]*?\n\t\}\);/.exec(appSrc);
	assert.ok(handler, "question-answered listener not found");
	assert.match(handler[0], /pendingQuestion\.answeredBy = studentName/);
	assert.match(
		handler[0],
		/pendingQuestion\.entry\.answered_by = studentName/,
	);
});
