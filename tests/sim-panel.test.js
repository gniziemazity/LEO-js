"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function makeEl(tag) {
	const handlers = {};
	const classes = new Set();
	const el = {
		tag,
		children: [],
		style: {},
		scrollTop: 0,
		scrollLeft: 0,
		textContent: "",
		classList: {
			add: (c) => classes.add(c),
			remove: (c) => classes.delete(c),
			contains: (c) => classes.has(c),
			toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
		},
		appendChild(c) {
			el.children.push(c);
			return c;
		},
		addEventListener(type, fn) {
			handlers[type] = fn;
		},
		querySelector: () => null,
		click() {
			handlers.click();
		},
		set innerHTML(_) {
			el.children.length = 0;
		},
	};
	Object.defineProperty(el, "className", {
		set: (v) =>
			String(v)
				.split(" ")
				.forEach((c) => c && classes.add(c)),
		get: () => [...classes].join(" "),
	});
	return el;
}

const rootStyle = {};
global.document = {
	createElement: makeEl,
	body: makeEl("body"),
	documentElement: {
		style: { setProperty: (k, v) => (rootStyle[k] = v) },
	},
};
global.window = { innerWidth: 1500, addEventListener() {} };
const stored = new Map();
global.localStorage = {
	getItem: (k) => (stored.has(k) ? stored.get(k) : null),
	setItem: (k, v) => stored.set(k, v),
};

const SimPanel = require("../src/renderer/sim-panel");

function panel(blocks, focusOf) {
	const els = {
		".sim-panel-tabs": makeEl("div"),
		".sim-panel-code": makeEl("div"),
		".sim-panel-resizer": makeEl("div"),
	};
	const root = { querySelector: (sel) => els[sel] || null };
	const lessonManager = { getAllBlocks: () => blocks };
	const sim = new SimPanel(lessonManager, focusOf);
	sim.attach(root);
	return {
		sim,
		tabs: els[".sim-panel-tabs"],
		code: els[".sim-panel-code"],
		blocks,
	};
}

const lineText = (code) =>
	code.children.map((row) => row.children.map((s) => s.textContent).join(""));

const marked = (code) =>
	code.children.map((row) =>
		row.children
			.map((s) => {
				if (s.className === "snippet-caret") return "|";
				if (s.className === "snippet-mark") return `[${s.textContent}]`;
				return s.textContent;
			})
			.join("")
			.replace(/\]\[/g, ""),
	);

const PLAN = [
	{ type: "move-to", target: "index.html" },
	{ type: "code", text: "<p>hi</p>" },
	{ type: "move-to", target: "app.js" },
	{ type: "code", text: "let a = 1;↩let b = 2;" },
];

test("hidden, it does no work at all", () => {
	const { sim, tabs, code } = panel(PLAN);
	sim.schedule();
	sim.regenerate();
	assert.equal(sim.timer, null);
	assert.equal(tabs.children.length, 0);
	assert.equal(code.children.length, 0);
});

test("shown, it replays the plan: one tab per file, the last one open", () => {
	const { sim, tabs, code } = panel(PLAN);
	sim.setVisible(true);
	assert.equal(document.body.classList.contains("sim-panel-on"), true);
	assert.deepEqual(
		tabs.children.map((t) => t.textContent),
		["index.html", "app.js"],
	);
	assert.equal(tabs.children[1].classList.contains("active"), true);
	assert.deepEqual(lineText(code), ["let a = 1;", "let b = 2;"]);

	tabs.children[0].click();
	assert.deepEqual(lineText(code), ["<p>hi</p>"]);
});

test("an edit is picked up, and the tab being read stays open", () => {
	const { sim, tabs, code, blocks } = panel(PLAN.map((b) => ({ ...b })));
	sim.setVisible(true);
	tabs.children[0].click();
	code.scrollTop = 40;
	blocks[1].text = "<p>hello</p>";
	sim.changed();
	sim.regenerate();
	assert.deepEqual(lineText(code), ["<p>hello</p>"]);
	assert.equal(code.scrollTop, 40, "reading position survives a regenerate");
});

test("going un-maximized hides it and cancels a pending regenerate", () => {
	const { sim } = panel(PLAN);
	sim.setVisible(true);
	sim.schedule();
	assert.notEqual(sim.timer, null);
	sim.setVisible(false);
	assert.equal(sim.timer, null);
	assert.equal(document.body.classList.contains("sim-panel-on"), false);
});

const SPLIT = [
	{ type: "move-to", target: "app.js" },
	{ type: "code", text: "a();⚓1⚓↩c();" },
	{ type: "move-to", target: "⚓1⚓" },
	{ type: "code", text: "↩b();" },
];

test("it always shows the end of the lesson, whichever block has the caret", () => {
	const { sim, code } = panel(SPLIT, () => ({ index: 1, caret: 4 }));
	sim.setVisible(true);
	assert.deepEqual(
		lineText(code).map((line) => line.trimEnd()),
		["a();", "b();", "c();"],
	);
});

test("a block's characters keep their highlight after a later block splits them", () => {
	const { sim, code } = panel(SPLIT, () => ({ index: 1, caret: 4 }));
	sim.setVisible(true);
	assert.deepEqual(
		marked(code),
		["[a();]|", "b();[ ]", "[c();]"],
		"`b();` came later and is not marked; the caret follows `;` of `a();`",
	);
});

test("the later block is marked on its own when it has the caret", () => {
	const { sim, code } = panel(SPLIT, () => ({ index: 3, caret: 5 }));
	sim.setVisible(true);
	assert.deepEqual(marked(code), ["a();[ ]", "[b();]|", "c();"]);
});

test("moving to a block in another file opens that file", () => {
	let focus = { index: 3, caret: 10 };
	const { sim, tabs, code } = panel(PLAN, () => focus);
	sim.setVisible(true);
	assert.equal(tabs.children[1].classList.contains("active"), true);
	assert.deepEqual(marked(code), ["[let a = 1;]|[ ]", "[let b = 2;]"]);

	focus = { index: 1, caret: 3 };
	sim.regenerate();
	assert.equal(
		tabs.children.find((t) => t.classList.contains("active")).textContent,
		"index.html",
	);
	assert.deepEqual(marked(code), ["[<p>]|[hi</p>]"]);

	focus = null;
	sim.regenerate();
	assert.deepEqual(marked(code), ["<p>hi</p>"], "nothing marked any more");
});

test("a block that types nothing marks nothing", () => {
	const blocks = [...PLAN, { type: "comment", text: "Explain it" }];
	const { sim, code } = panel(blocks, () => ({ index: 4, caret: null }));
	sim.setVisible(true);
	assert.deepEqual(marked(code), ["let a = 1;", "let b = 2;"]);
});

test("a caret that did not move re-renders nothing", () => {
	const { sim, code } = panel(PLAN, () => ({ index: 3, caret: 4 }));
	sim.setVisible(true);
	const first = code.children[0];
	sim.regenerate();
	assert.equal(code.children[0], first);
	sim.changed();
	sim.regenerate();
	assert.notEqual(code.children[0], first, "an edit still does");
});

test("maximizing and restoring keep the editor's place", () => {
	const page = { scrollTop: 300 };
	document.scrollingElement = page;
	const editor = { scrollTop: 0 };
	const { sim } = panel(PLAN);
	sim.scroller = editor;
	sim.setVisible(true);
	assert.equal(editor.scrollTop, 300, "the page's offset moves to the pane");
	editor.scrollTop = 120;
	sim.setVisible(true);
	assert.equal(
		editor.scrollTop,
		120,
		"a repeat of the same state moves nothing",
	);
	sim.setVisible(false);
	assert.equal(page.scrollTop, 120, "and back to the page on restore");
	delete document.scrollingElement;
});

test("the width is clamped, and remembered", () => {
	const { sim } = panel(PLAN);
	assert.equal(sim.setWidth(100), 260, "never narrower than a tab strip");
	assert.equal(
		sim.setWidth(5000),
		1500 - 420,
		"never so wide the editor disappears",
	);
	assert.equal(rootStyle["--sim-panel-w"], "1080px");
	stored.set("simPanelWidth", "700");
	const again = panel(PLAN).sim;
	again.setVisible(true);
	assert.equal(rootStyle["--sim-panel-w"], "700px");
});

test("the window says when it is maximized, and the panel listens", () => {
	const read = (p) =>
		fs.readFileSync(path.resolve(__dirname, "..", p), "utf-8");
	const main = read("src/main/main.js");
	assert.match(main, /mainWindow\.on\("maximize", sendMaximized\)/);
	assert.match(main, /mainWindow\.on\("unmaximize", sendMaximized\)/);
	const app = read("src/renderer/app.js");
	assert.match(app, /"window-maximized"[\s\S]{0,60}simPanel\.setVisible/);
	assert.match(
		app,
		/lessonManager\.onChange\(\(\) => simPanel\.changed\(\)\)/,
	);
	assert.match(
		app,
		/lessonRenderer\.onRendered = \(\) => simPanel\.changed\(\)/,
	);
	assert.match(app, /lessonRenderer\.caretFocus\(\)/);
	assert.match(app, /"selectionchange", "focusin", "focusout"/);
});

test("the editor scrolls on its own while the panel is shown", () => {
	const css = fs.readFileSync(
		path.resolve(__dirname, "..", "src/shared/styles.css"),
		"utf-8",
	);
	assert.match(
		css,
		/body\.sim-panel-on \{[^}]*overflow: hidden;/,
		"the page itself must not scroll, or its bar sits past the panel",
	);
	assert.match(
		css,
		/body\.sim-panel-on #lesson-container \{[^}]*overflow-y: auto;/,
	);
});

test("every change listener hears an edit, not just the last one set", () => {
	const LessonManager = require("../src/renderer/lesson-manager");
	const lm = new LessonManager();
	lm.data = [{ type: "code", text: "a" }];
	const heard = [];
	lm.onChange(() => heard.push("title"));
	lm.onChange(() => heard.push("panel"));
	lm.updateBlock(0, "ab");
	assert.deepEqual(heard, ["title", "panel"]);
});
