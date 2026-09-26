"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildRemote: build } = require("./helpers/remote-dom.js");
const LEOBroadcastServer = require("../src/main/websocket-server");

const askerSelect = (row) => row.children[0].children[0];
const sentOf = (ctx, type) => ctx.sent.filter((m) => m.type === type);
const gridLabels = (grid) =>
	grid.querySelectorAll(".popup-student-btn").map((b) => b.textContent);

test("the phone's question opens on the form: Asked by, the text, Show", () => {
	const ctx = build();
	ctx.api.setStudents(["Ada", "Bo"]);
	ctx.api.handleInteractionBtn("student-question");

	assert.equal(ctx.nodes.iTitle.textContent, "❓ Question");
	assert.equal(ctx.nodes.iAskerRow.style.display, "flex");
	assert.equal(ctx.nodes.iQuestionRow.style.display, "flex");
	assert.equal(ctx.nodes.iShowBtn.style.display, "block");
	const select = askerSelect(ctx.nodes.iAskerRow);
	assert.deepEqual(
		select.children.map((o) => o.textContent),
		["Teacher", "Ada", "Bo"],
	);
	assert.deepEqual(sentOf(ctx, "show-student-interaction"), []);
});

test("Show sends the asker and the text, then offers the usual buttons", () => {
	const ctx = build();
	ctx.api.setStudents(["Ada", "Bo"]);
	ctx.api.handleInteractionBtn("student-question");
	const select = askerSelect(ctx.nodes.iAskerRow);
	select.value = "0";
	select.onchange();
	ctx.nodes.iQuestionInput.value = "  what is a closure? ";
	ctx.api.interactionAsk();

	const [shown] = sentOf(ctx, "show-student-interaction");
	assert.equal(shown.data.studentName, 1, "Ada is roster id 1");
	assert.equal(shown.data.questionText, "what is a closure?");
	assert.equal(ctx.nodes.iTitle.textContent, "❓ Ada: what is a closure?");
	assert.equal(
		ctx.nodes.interactionOverlay.style.background,
		"var(--clr-ask-bg)",
		"a student's question keeps the interaction colour",
	);
	assert.equal(ctx.nodes.iAskerRow.style.display, "none");
	assert.equal(ctx.nodes.iShowBtn.style.display, "none");
	assert.deepEqual(
		gridLabels(ctx.nodes.iGrid),
		["🎲", "Ada", "Bo", "Teacher"],
		"whoever asked may end up answering it themselves",
	);

	ctx.nodes.iGrid.children.find((b) => b.textContent === "Teacher").onclick();
	const [closed] = sentOf(ctx, "close-student-interaction");
	assert.equal(closed.data.answeredBy, 0, "the teacher answered");
	assert.equal(closed.data.studentName, 1);
	const overlay = ctx.nodes.interactionOverlay;
	assert.equal(overlay.classList.contains("active"), false);
});

test("the Show form wears the planned question's colour while the teacher asks", () => {
	const ctx = build();
	ctx.api.setStudents(["Ada", "Bo"]);
	ctx.api.handleInteractionBtn("student-question");
	const bg = () => ctx.nodes.interactionOverlay.style.background;
	assert.equal(bg(), "var(--clr-question-bg)", "the teacher is the default");

	const select = askerSelect(ctx.nodes.iAskerRow);
	select.value = "1";
	select.onchange();
	assert.equal(bg(), "var(--clr-ask-bg)", "a student asking");
	select.value = "teacher";
	select.onchange();
	assert.equal(bg(), "var(--clr-question-bg)", "and back");
});

test("a question the teacher asked is shown like a planned one", () => {
	const ctx = build();
	ctx.api.setStudents(["Ada", "Bo"]);
	ctx.api.handleInteractionBtn("student-question");
	ctx.nodes.iQuestionInput.value = "what is a closure?";
	ctx.api.interactionAsk();

	assert.equal(ctx.nodes.iTitle.textContent, "what is a closure?");
	assert.equal(
		ctx.nodes.interactionOverlay.style.background,
		"var(--clr-question-bg)",
	);
	assert.deepEqual(gridLabels(ctx.nodes.iGrid), [
		"🎲",
		"Ada",
		"Bo",
		"Teacher",
	]);
});

test("closing a shown question without an answer says nobody answered", () => {
	const ctx = build();
	ctx.api.setStudents(["Ada"]);
	ctx.api.handleInteractionBtn("student-question");
	ctx.api.interactionAsk();
	assert.equal(
		sentOf(ctx, "show-student-interaction")[0].data.studentName,
		0,
		"left on its default, the teacher asked",
	);
	ctx.api.closeInteractionOverlay();
	const [closed] = sentOf(ctx, "close-student-interaction");
	assert.equal(closed.data.answeredBy, null);
});

test("the randomizer lights up a name in the question's answer grid", () => {
	const ctx = build();
	ctx.api.setStudents(["Zoe", "Ada", "Mo"]);
	ctx.api.handleInteractionBtn("student-question");
	ctx.api.interactionAsk();
	ctx.api.onRandomizerResult(2, "Mo");
	const picked = ctx.nodes.iGrid
		.querySelectorAll(".popup-student-btn")
		.filter((b) => b.classList.contains("popup-student-btn-picked"));
	assert.deepEqual(
		picked.map((b) => b.textContent),
		["Mo"],
	);
});

test("helping someone keeps its one-tap picker and Done", () => {
	const ctx = build();
	ctx.api.setStudents(["Ada"]);
	ctx.api.handleInteractionBtn("providing-help");
	assert.equal(ctx.nodes.iAskerRow.style.display, "none");
	assert.equal(ctx.nodes.iShowBtn.style.display, "none");
	ctx.nodes.iGrid.children[0].onclick();
	assert.equal(ctx.nodes.iTitle.textContent, "🤝 Helping Ada");
	assert.deepEqual(gridLabels(ctx.nodes.iGrid), ["✓ Done — close"]);
});

test("a planned question on the phone shows no asker row", () => {
	const html = fs.readFileSync(
		path.join(__dirname, "..", "src", "remote.html"),
		"utf-8",
	);
	const overlay = html.slice(
		html.indexOf('id="questionOverlay"'),
		html.indexOf('id="interactionOverlay"'),
	);
	assert.ok(overlay.includes('id="qText"'));
	assert.ok(!overlay.includes("asker-row"));

	const ctx = build();
	ctx.api.showQuestionOverlay("Why?", ["Ada"], null, null);
	assert.equal(ctx.nodes.qText.textContent, "Why?");
});

test("the teacher can answer a planned question on the phone, as id 0", () => {
	const ctx = build();
	ctx.api.showQuestionOverlay("Why?", ["Ada"], null, null);
	const grid = ctx.nodes.qGrid;
	assert.equal(gridLabels(grid).at(-1), "Teacher", "last in the list");
	grid.children.find((b) => b.textContent === "Teacher").onclick();
	const [answered] = sentOf(ctx, "student-answered");
	assert.equal(answered.data.studentName, 0);

	const emitted = [];
	LEOBroadcastServer.prototype.handleClientMessage.call(
		{ emit: (...a) => emitted.push(a) },
		{ type: "student-answered", data: { studentName: 0 } },
	);
	assert.deepEqual(emitted, [["client-student-answered", 0]]);
});

test("the teacher answering (id 0) survives the trip through the server", () => {
	const emitted = [];
	const fake = { emit: (...a) => emitted.push(a) };
	LEOBroadcastServer.prototype.handleClientMessage.call(fake, {
		type: "close-student-interaction",
		data: {
			interactionType: "student-question",
			studentName: 2,
			questionText: "why?",
			openedAt: 1,
			closedAt: 2,
			answeredBy: 0,
		},
	});
	assert.deepEqual(emitted, [
		[
			"client-close-student-interaction",
			"student-question",
			2,
			"why?",
			1,
			2,
			0,
		],
	]);
});
