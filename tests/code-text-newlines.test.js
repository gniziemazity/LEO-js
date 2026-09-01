"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

function makeElement(tag) {
	const kids = [];
	const el = {
		tag,
		nodeType: 1,
		nodeName: tag.toUpperCase(),
		className: "",
		dataset: {},
		children: kids,
		childNodes: kids,
	};
	el.classList = {
		add: (c) => {
			el.className = el.className ? `${el.className} ${c}` : c;
		},
		contains: (c) => el.className.split(" ").includes(c),
	};
	el.appendChild = (child) => {
		kids.push(child);
		return child;
	};
	let text = "";
	Object.defineProperty(el, "textContent", {
		get: () => text,
		set: (v) => {
			text = v;
			kids.length = 0;
		},
	});
	Object.defineProperty(el, "innerHTML", {
		get: () => text,
		set: (v) => {
			text = v;
		},
	});
	return el;
}

globalThis.document = {
	createElement: makeElement,
	createTextNode: (data) => ({ nodeType: 3, data, childNodes: [] }),
};

const {
	buildCodeText,
	readCodeText,
	writeCodeText,
	normalizeEdgeNewlines,
} = require("../src/shared/code-text");

function render(text) {
	const container = makeElement("div");
	const steps = [];
	const next = buildCodeText(text, container, 0, (step) => steps.push(step));
	return { container, steps, next };
}

const isHolder = (el) =>
	el.tag === "span" && el.classList.contains("trailing-newline");

test("a trailing newline leaves something on the new line to hold it open", () => {
	const { container } = render("a\n");
	const holders = container.children.filter(isHolder);
	assert.equal(holders.length, 1);
	assert.equal(holders[0].textContent, "​");
});

test("the break comes before the holder, so the empty line is real", () => {
	const { container } = render("a\n");
	const at = container.children.findIndex(isHolder);
	assert.ok(at > 0);
	assert.equal(container.children[at - 1].tag, "br");
	assert.equal(at, container.children.length - 1);
});

test("an interior newline stays a bare br", () => {
	const { container } = render("a\nb");
	assert.equal(container.children.filter(isHolder).length, 0);
	assert.equal(container.children.filter((el) => el.tag === "br").length, 1);
});

test("each trailing newline opens its own empty line", () => {
	const { container } = render("a\n\n\n");
	assert.equal(container.children.filter(isHolder).length, 3);
	assert.equal(container.children.filter((el) => el.tag === "br").length, 3);
});

test("only the trailing run is held open", () => {
	const { container } = render("a\nb\n");
	assert.equal(container.children.filter(isHolder).length, 1);
	assert.equal(container.children.filter((el) => el.tag === "br").length, 2);
});

test("a newline after an anchor is still recognised as trailing", () => {
	const { container } = render("a⚓1⚓\n");
	assert.equal(container.children.filter(isHolder).length, 1);
});

test("holding the line open does not add or renumber steps", () => {
	const plain = render("ab\ncd");
	const trailing = render("ab\ncd\n");

	assert.equal(plain.steps.length, 5);
	assert.equal(trailing.steps.length, 6);
	assert.equal(trailing.next, 6);
	assert.deepEqual(
		trailing.steps.map((s) => s.globalIndex),
		[0, 1, 2, 3, 4, 5],
	);
	assert.equal(trailing.steps[5].char, "\n");
	assert.equal(trailing.steps[5].type, "char");
});

test("the held-open newline carries its step index for click-to-jump", () => {
	const { container, steps } = render("a\n");
	const holder = container.children.find(isHolder);
	assert.equal(holder.dataset.stepIndex, 1);
	assert.equal(steps[1].element, holder);
});

function edited(text) {
	const el = makeElement("div");
	writeCodeText(el, text);
	return el;
}

const shape = (el) =>
	el.childNodes
		.map((n) =>
			n.nodeType === 3
				? JSON.stringify(n.data)
				: `<${n.nodeName.toLowerCase()}>`,
		)
		.join("");

test("a block with no trailing newline edits as one text node", () => {
	assert.equal(shape(edited("a\nb")), '"a\\nb"');
});

test("a trailing newline edits as a real empty line, not a bare character", () => {
	assert.equal(shape(edited("foo\n")), '"foo"<div>');
	const line = edited("foo\n").childNodes[1];
	assert.equal(line.childNodes.length, 1);
	assert.equal(line.childNodes[0].nodeName, "BR");
});

test("each trailing newline edits as its own empty line", () => {
	assert.equal(shape(edited("foo\n\n")), '"foo"<div><div>');
});

test("an empty block edits as nothing at all", () => {
	assert.equal(edited("").childNodes.length, 0);
});

test("what the editor writes is what the editor reads back", () => {
	for (const text of [
		"",
		"foo",
		"a\nb",
		"foo\n",
		"foo\n\n",
		"a\nb\n",
		"a\n\nb\n\n",
		"\n",
	]) {
		assert.equal(readCodeText(edited(text)), text, `round trip: ${JSON.stringify(text)}`);
	}
});

test("normalizeEdgeNewlines turns a leading newline into ↩", () => {
	assert.equal(normalizeEdgeNewlines("\nfoo"), "↩foo");
	assert.equal(normalizeEdgeNewlines("\n\n\nfoo"), "↩↩↩foo");
});

test("normalizeEdgeNewlines turns a trailing newline into ↩", () => {
	assert.equal(normalizeEdgeNewlines("foo\n"), "foo↩");
	assert.equal(normalizeEdgeNewlines("foo\n\n"), "foo↩↩");
});

test("normalizeEdgeNewlines leaves the newlines between lines alone", () => {
	assert.equal(normalizeEdgeNewlines("a\nb\nc"), "a\nb\nc");
	assert.equal(normalizeEdgeNewlines("\na\n\nb\n"), "↩a\n\nb↩");
});

test("normalizeEdgeNewlines counts an all-newline block once", () => {
	assert.equal(normalizeEdgeNewlines("\n"), "↩");
	assert.equal(normalizeEdgeNewlines("\n\n"), "↩↩");
});

test("normalizeEdgeNewlines is idempotent and safe on empties", () => {
	assert.equal(normalizeEdgeNewlines(normalizeEdgeNewlines("\nfoo\n")), "↩foo↩");
	assert.equal(normalizeEdgeNewlines(""), "");
	assert.equal(normalizeEdgeNewlines(null), "");
	assert.equal(normalizeEdgeNewlines("↩foo↩"), "↩foo↩");
});

test("a normalized block renders every edge newline as a visible step", () => {
	const { container, steps } = render(normalizeEdgeNewlines("\na\n"));
	assert.equal(steps.length, 3);
	assert.deepEqual(
		steps.map((s) => s.char),
		["↩", "a", "↩"],
	);
	assert.equal(
		container.children.every((c) => c.nodeName !== "BR"),
		true,
	);
});
