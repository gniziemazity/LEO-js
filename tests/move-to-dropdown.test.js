"use strict";

const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

function makeEl(tag) {
	const kids = [];
	const classes = new Set();
	const handlers = {};
	const el = {
		tag,
		dataset: {},
		style: {},
		children: kids,
		offsetTop: 0,
		offsetHeight: 10,
		scrollTop: 0,
		clientHeight: 1000,
		parent: null,
		classList: {
			add: (c) => classes.add(c),
			remove: (c) => classes.delete(c),
			toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
			contains: (c) => classes.has(c),
		},
		appendChild(c) {
			kids.push(c);
			c.parent = el;
			return c;
		},
		remove() {
			if (el.parent) {
				const i = el.parent.children.indexOf(el);
				if (i >= 0) el.parent.children.splice(i, 1);
			}
			el.parent = null;
		},
		contains: (other) => other === el || kids.includes(other),
		addEventListener(type, fn) {
			(handlers[type] = handlers[type] || []).push(fn);
		},
		dispatchEvent(e) {
			(handlers[e.type] || []).forEach((fn) => fn({ ...e, target: el }));
			return true;
		},
		getBoundingClientRect: () => ({
			top: 100,
			bottom: 120,
			left: 50,
			right: 90,
			width: 40,
			height: 20,
		}),
	};
	Object.defineProperty(el, "textContent", {
		get: () => el._text || "",
		set: (v) => (el._text = v),
	});
	return el;
}

const docHandlers = {};
const body = makeEl("body");
global.document = {
	body,
	createElement: makeEl,
	addEventListener: (type, fn) => {
		(docHandlers[type] = docHandlers[type] || []).push(fn);
	},
	removeEventListener: (type, fn) => {
		const list = docHandlers[type] || [];
		const i = list.indexOf(fn);
		if (i >= 0) list.splice(i, 1);
	},
};
global.window = {
	innerWidth: 1200,
	innerHeight: 800,
	addEventListener: () => {},
	removeEventListener: () => {},
};
global.MouseEvent = class {
	constructor(type, init = {}) {
		this.type = type;
		Object.assign(this, init);
	}
};

const {
	openDropdown,
	closeDropdown,
	isOpen,
} = require("../src/renderer/move-to-dropdown");

const OPTIONS = [
	{ value: "⚓7⚓", label: "⚓7⚓" },
	{ value: "app.js", label: "📄 app.js" },
	{ value: "MAIN", label: "Main Editor" },
	{ value: "DEV", label: "Dev Tools" },
];

function press(key) {
	(docHandlers.keydown || []).forEach((fn) =>
		fn({ key, preventDefault() {}, stopPropagation() {} }),
	);
}

function show(overrides = {}) {
	const picked = [];
	const list = openDropdown({
		anchorEl: makeEl("button"),
		blockIdx: 3,
		options: OPTIONS,
		value: "MAIN",
		onPick: (v) => picked.push(v),
		...overrides,
	});
	return { list, picked };
}

const activeLabel = (list) =>
	(list.children.find((i) => i.classList.contains("active")) || {})
		.textContent;

beforeEach(() => closeDropdown());

test("the list carries one item per option, with its value", () => {
	const { list } = show();
	assert.deepEqual(
		list.children.map((i) => i.dataset.value),
		OPTIONS.map((o) => o.value),
	);
	assert.deepEqual(
		list.children.map((i) => i.textContent),
		OPTIONS.map((o) => o.label),
	);
});

test("the list names the block it belongs to, so a hover can be resolved", () => {
	const { list } = show();
	assert.equal(list.dataset.blockIndex, "3");
});

test("the current target opens selected and active", () => {
	const { list } = show();
	const current = list.children[2];
	assert.equal(current.classList.contains("selected"), true);
	assert.equal(activeLabel(list), "Main Editor");
});

test("clicking an item picks it and closes the list", () => {
	const { list, picked } = show();
	list.children[0].dispatchEvent({ type: "click", stopPropagation() {} });
	assert.deepEqual(picked, ["⚓7⚓"]);
	assert.equal(isOpen(), false);
});

test("arrow keys walk the list from the current target", () => {
	const { list } = show();
	press("ArrowDown");
	assert.equal(activeLabel(list), "Dev Tools");
	press("ArrowUp");
	assert.equal(activeLabel(list), "Main Editor");
	press("Home");
	assert.equal(activeLabel(list), "⚓7⚓");
	press("End");
	assert.equal(activeLabel(list), "Dev Tools");
});

test("arrowing past either end stays on the end", () => {
	const { list } = show();
	press("Home");
	press("ArrowUp");
	assert.equal(activeLabel(list), "⚓7⚓");
	press("End");
	press("ArrowDown");
	assert.equal(activeLabel(list), "Dev Tools");
});

test("a keyboard move previews like a hover does", () => {
	const { list } = show();
	let hovered = null;
	list.children[0].addEventListener("mouseover", () => (hovered = "⚓7⚓"));
	press("Home");
	assert.equal(hovered, "⚓7⚓");
});

test("Enter picks the active item, Escape picks nothing", () => {
	const a = show();
	press("ArrowDown");
	press("Enter");
	assert.deepEqual(a.picked, ["DEV"]);
	assert.equal(isOpen(), false);

	const b = show();
	press("Escape");
	assert.deepEqual(b.picked, []);
	assert.equal(isOpen(), false);
});

test("hovering an item makes it the active one", () => {
	const { list } = show();
	list.children[1].dispatchEvent({ type: "mouseover" });
	assert.equal(activeLabel(list), "📄 app.js");
	press("ArrowDown");
	assert.equal(activeLabel(list), "Main Editor");
});

test("opening a second dropdown closes the first", () => {
	const first = show();
	const second = show();
	assert.equal(first.list.parent, null, "the first list left the page");
	assert.equal(second.list.parent, body);
	assert.equal(isOpen(), true);
});

test("a click outside closes it, a click inside does not", () => {
	const { list } = show();
	const outside = (target) =>
		(docHandlers.mousedown || []).forEach((fn) => fn({ target }));
	outside(list.children[0]);
	assert.equal(isOpen(), true);
	outside(makeEl("div"));
	assert.equal(isOpen(), false);
});

test("the list keeps its own scroll rather than scrolling the page", () => {
	const { list } = show();
	assert.equal(
		list.children.every((i) => !i.scrollIntoView),
		true,
		"scrollIntoView would scroll the ancestors and trip the scroll-to-close",
	);
});
