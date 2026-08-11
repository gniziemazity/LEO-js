"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { parseQuestionOptions } = require("../src/renderer/question-options");

function labels(options) {
	return options.map((o) => o.label);
}

function texts(options) {
	return options.map((o) => o.text);
}

test("inline letter options with parentheses", () => {
	const { text, options } = parseQuestionOptions(
		"What is 2+2? a) 3 b) 4 c) 5",
	);
	assert.equal(text, "What is 2+2?");
	assert.deepEqual(labels(options), ["a)", "b)", "c)"]);
	assert.deepEqual(texts(options), ["3", "4", "5"]);
});

test("multiline letter options with dots", () => {
	const { text, options } = parseQuestionOptions(
		"Pick the prime:\na. four\nb. seven\nc. nine",
	);
	assert.equal(text, "Pick the prime:");
	assert.deepEqual(labels(options), ["a.", "b.", "c."]);
	assert.deepEqual(texts(options), ["four", "seven", "nine"]);
});

test("numeric options", () => {
	const { text, options } = parseQuestionOptions(
		"Choose a color 1) red 2) green 3) blue",
	);
	assert.equal(text, "Choose a color");
	assert.deepEqual(labels(options), ["1)", "2)", "3)"]);
	assert.deepEqual(texts(options), ["red", "green", "blue"]);
});

test("uppercase letters are accepted", () => {
	const { text, options } = parseQuestionOptions("Q? A) one B) two");
	assert.equal(text, "Q?");
	assert.deepEqual(labels(options), ["A)", "B)"]);
});

test("question without options is left untouched", () => {
	const { text, options } = parseQuestionOptions("Why is the sky blue?");
	assert.equal(text, "Why is the sky blue?");
	assert.deepEqual(options, []);
});

test("prose abbreviations are not treated as options", () => {
	const raw = "Explain, e.g. with an example, i.e. clearly.";
	const { text, options } = parseQuestionOptions(raw);
	assert.equal(text, raw);
	assert.deepEqual(options, []);
});

test("a single marker is not enough", () => {
	const { text, options } = parseQuestionOptions("Grade from a) onward");
	assert.equal(text, "Grade from a) onward");
	assert.deepEqual(options, []);
});

test("mixed delimiters do not form a run", () => {
	const { options } = parseQuestionOptions("Q? a) one b. two");
	assert.deepEqual(options, []);
});

test("must start at a / 1, not mid-sequence", () => {
	const { options } = parseQuestionOptions("Q? b) one c) two");
	assert.deepEqual(options, []);
});

test("non-string input is handled", () => {
	assert.deepEqual(parseQuestionOptions(undefined), { text: "", options: [] });
	assert.deepEqual(parseQuestionOptions(null), { text: "", options: [] });
});

test("options at the very start yield empty question text", () => {
	const { text, options } = parseQuestionOptions("a) yes b) no");
	assert.equal(text, "");
	assert.deepEqual(texts(options), ["yes", "no"]);
});
