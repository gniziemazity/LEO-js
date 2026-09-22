"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildRemote } = require("./helpers/remote-dom");

const LESSON = {
	blocks: [
		{ type: "comment", text: "A title" },
		{ type: "code", text: "let a = 1;\nlet b = 2;" },
		{ type: "move-to", target: "app.js" },
		{ type: "code", text: "console.log(a + b);" },
		{ type: "comment", text: "📋 paste me" },
	],
};

function allSteps(h) {
	return h.nodes["lesson-container"].querySelectorAll("[data-step-index]");
}

function snapshot(h) {
	return allSteps(h).map((el) => {
		const on = ["cursor", "consumed", "active-block"].filter((c) =>
			el.classList.contains(c),
		);
		return `${el.dataset.stepIndex}:${on.sort().join("+")}`;
	});
}

function applyOldAlgorithm(h, currentStep) {
	for (const el of allSteps(h)) {
		el.classList.remove("cursor", "consumed", "active-block");
	}
	for (const el of allSteps(h)) {
		const idx = parseInt(el.dataset.stepIndex);
		if (idx < currentStep) {
			el.classList.add("consumed");
		} else if (idx === currentStep) {
			el.classList.add(
				el.classList.contains("char") ? "cursor" : "active-block",
			);
		}
	}
}

test("the cached step map paints exactly what the full rescan painted", () => {
	const fresh = buildRemote();
	fresh.api.updateLessonData(LESSON);
	const total = allSteps(fresh).length;
	assert.ok(total > 20, `expected a real lesson, got ${total} steps`);

	const reference = buildRemote();
	reference.api.updateLessonData(LESSON);

	const walk = [0, 1, 5, 12, 11, 3, 0, total - 1, total, 7, 7, 2];
	for (const step of walk) {
		fresh.api.updateCursor({ currentStep: step });
		applyOldAlgorithm(reference, step);

		assert.deepEqual(
			snapshot(fresh),
			snapshot(reference),
			`the two algorithms disagree at step ${step}`,
		);
	}
});

test("a cursor move touches only the steps between old and new", () => {
	const h = buildRemote();
	h.api.updateLessonData(LESSON);

	const steps = allSteps(h);
	let touched = 0;
	for (const el of steps) {
		const realAdd = el.classList.add;
		const realRemove = el.classList.remove;
		el.classList.add = (...a) => {
			touched++;
			return realAdd(...a);
		};
		el.classList.remove = (...a) => {
			touched++;
			return realRemove(...a);
		};
	}

	h.api.updateCursor({ currentStep: 10 });
	touched = 0;
	h.api.updateCursor({ currentStep: 11 });

	assert.ok(
		touched <= 6,
		`one step forward rewrote ${touched} class lists on ${steps.length} elements`,
	);
});

test("reloading the lesson rebuilds the map instead of reusing a stale one", () => {
	const h = buildRemote();
	h.api.updateLessonData(LESSON);
	h.api.updateCursor({ currentStep: 9 });

	h.api.updateLessonData({
		blocks: [{ type: "comment", text: "Only one block now" }],
	});

	h.api.updateCursor({ currentStep: 0 });
	const marks = snapshot(h);
	assert.equal(marks.length, 1);
	assert.equal(marks[0], "0:active-block");
});

test("a step past the end of the lesson consumes everything", () => {
	const h = buildRemote();
	h.api.updateLessonData(LESSON);
	const total = allSteps(h).length;

	h.api.updateCursor({ currentStep: total });

	for (const el of allSteps(h)) {
		assert.equal(
			el.classList.contains("consumed"),
			true,
			`step ${el.dataset.stepIndex} was left unconsumed at the end`,
		);
	}
});
