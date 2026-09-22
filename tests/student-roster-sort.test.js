"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildRemote: build } = require("./helpers/remote-dom.js");
const InteractionView = require("../src/shared/interaction-view");

test("sortedStudentIndexes orders by name, case-insensitively, without mutating input", () => {
	const students = ["Zoe", "ada", "Mo"];
	const order = InteractionView.sortedStudentIndexes(students);
	assert.deepEqual(
		order.map((i) => students[i]),
		["ada", "Mo", "Zoe"],
	);
	assert.deepEqual(
		students,
		["Zoe", "ada", "Mo"],
		"the roster array itself must stay in its original order",
	);
});

test("sortedStudentIndexes handles the empty roster", () => {
	assert.deepEqual(InteractionView.sortedStudentIndexes([]), []);
});

function studentBtnTexts(grid) {
	return grid
		.querySelectorAll(".popup-student-btn")
		.filter((b) => !b.classList.contains("popup-action-btn"))
		.map((b) => b.textContent);
}

test("the question answer grid on the phone is sorted alphabetically", () => {
	const ctx = build();
	ctx.api.showQuestionOverlay(
		"What is a closure?",
		["Priya", "Ana", "Zed"],
		null,
		null,
	);
	assert.deepEqual(studentBtnTexts(ctx.nodes.qGrid), ["Ana", "Priya", "Zed"]);
});

test("the phone's student-question picker sorts, teacher last", () => {
	const ctx = build();
	ctx.api.setStudents(["Zoe", "ada", "Mo"]);
	ctx.api.handleInteractionBtn("student-question");
	assert.deepEqual(studentBtnTexts(ctx.nodes.iGrid), [
		"ada",
		"Mo",
		"Zoe",
		"Teacher",
	]);
});

test("the phone's providing-help picker sorts, with no teacher entry", () => {
	const ctx = build();
	ctx.api.setStudents(["Zoe", "ada", "Mo"]);
	ctx.api.handleInteractionBtn("providing-help");
	assert.deepEqual(studentBtnTexts(ctx.nodes.iGrid), ["ada", "Mo", "Zoe"]);
});

test("a randomizer result still highlights the right button after sorting", () => {
	const ctx = build();
	ctx.api.showQuestionOverlay("q?", ["Zoe", "ada", "Mo"], null, null);
	ctx.api.onRandomizerResult(2, "Mo");

	const picked = ctx.nodes.qGrid
		.querySelectorAll(".popup-student-btn")
		.filter((b) => b.classList.contains("popup-student-btn-picked"));
	assert.deepEqual(
		picked.map((b) => b.textContent),
		["Mo"],
		"the wrong button lit up because it was found by array position, " +
			"not by name",
	);
});
