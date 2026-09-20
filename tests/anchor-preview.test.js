"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

function makeEl(tag) {
	const kids = [];
	const el = {
		tag,
		nodeName: tag.toUpperCase(),
		className: "",
		style: {},
		dataset: {},
		childNodes: kids,
		children: kids,
		appendChild: (c) => (kids.push(c), c),
		contains: () => false,
		rect: {
			top: 200,
			bottom: 220,
			left: 100,
			right: 140,
			width: 40,
			height: 20,
		},
		getBoundingClientRect: () => el.rect,
	};
	Object.defineProperty(el, "innerHTML", {
		get: () => "",
		set: () => {
			kids.length = 0;
		},
	});
	Object.defineProperty(el, "textContent", {
		get: () => el._text || "",
		set: (v) => {
			el._text = v;
			kids.length = 0;
		},
	});
	return el;
}

const body = makeEl("body");
global.document = {
	createElement: makeEl,
	body,
	addEventListener: () => {},
	querySelectorAll: () => global.__blocks || [],
};
global.window = { innerWidth: 1200, innerHeight: 800 };

const AnchorPreview = require("../src/renderer/anchor-preview");

const PLAN = [
	{ type: "move-to", target: "app.js" },
	{ type: "code", text: "const a = 1;\nconst b = 2;⚓7⚓\nconst c = 3;" },
	{ type: "code", text: "↩const d = 4;" },
	{ type: "move-to", target: "⚓7⚓" },
];

function build({ typing = false, blocks = PLAN } = {}) {
	return new AnchorPreview(
		{ getAllBlocks: () => blocks },
		{ isActive: () => typing },
	);
}

function blockAt(blockIdx, target) {
	const blockEls = [];
	for (let i = 0; i <= blockIdx; i++) blockEls.push(makeEl("div"));
	const el = blockEls[blockIdx];
	el.dataset.target = target;
	el.closest = (sel) => (sel === ".block" ? el : null);
	global.__blocks = blockEls;
	return el;
}

function optionOf(blockIdx, value) {
	const list = makeEl("div");
	list.dataset.blockIndex = String(blockIdx);
	const opt = makeEl("div");
	opt.dataset.value = value;
	opt.closest = (sel) => {
		if (sel === ".mt-option") return opt;
		if (sel === ".mt-options") return list;
		return null;
	};
	list.appendChild(opt);
	return { list, opt };
}

function lines(p) {
	return p.el.children.map((r) =>
		r.children.map((c) => c.textContent).join(""),
	);
}

test("hovering a dropdown item previews where that target lands", () => {
	const p = build();
	const { opt } = optionOf(3, "⚓7⚓");
	p._show(p._hoverTarget({ target: opt }));

	assert.ok(p.el, "a tooltip element was created");
	assert.equal(p.el.style.display, "block");
	assert.ok(
		lines(p).some((l) => l.includes("const b = 2;")),
		`anchor line missing from ${JSON.stringify(lines(p))}`,
	);
});

test("a dropdown item is read at the block that will jump", () => {
	const p = build();
	const { opt } = optionOf(3, "⚓7⚓");
	p._show(p._hoverTarget({ target: opt }));
	assert.ok(
		lines(p).some((l) => l.includes("const d = 4;")),
		"the state at the jump includes every earlier block",
	);
});

test("the anchor line carries the cursor block", () => {
	const p = build();
	const { opt } = optionOf(3, "⚓7⚓");
	p._show(p._hoverTarget({ target: opt }));
	const cursors = p.el.children.flatMap((row) =>
		row.children.filter((c) => c.className === "mt-modal-anchor-cursor"),
	);
	assert.equal(cursors.length, 1);
});

test("the preview sits beside the dropdown, not on top of it", () => {
	const p = build();
	const { opt, list } = optionOf(3, "⚓7⚓");
	p._show(p._hoverTarget({ target: opt }));
	assert.equal(p.el.style.left, `${list.getBoundingClientRect().right + 8}px`);
});

test("hovering the move-to block itself still previews its target", () => {
	const p = build();
	const el = blockAt(3, "⚓7⚓");
	p._onOver({ target: el });
	assert.equal(p.target, el);
});

test("an anchor token in a code block gets no preview", () => {
	const p = build();
	const token = makeEl("span");
	token.textContent = "⚓7⚓";
	token.closest = (sel) => (sel === ".anchor-token" ? token : null);
	p._onOver({ target: token });
	assert.equal(p.target, null);
});

test("an anchor that does not exist shows nothing", () => {
	const p = build();
	const { opt } = optionOf(3, "⚓99⚓");
	p._show(p._hoverTarget({ target: opt }));
	assert.equal(p.el, null);
});

test("hovering does nothing while typing is active", () => {
	const p = build({ typing: true });
	const { opt } = optionOf(3, "⚓7⚓");
	p._onOver({ target: opt });
	assert.equal(p.timer, null);
	assert.equal(p.target, null);
});

test("a dropdown item that names a file previews that file", () => {
	const p = build();
	const { opt } = optionOf(3, "app.js");
	p._onOver({ target: opt });
	assert.equal(p.target, opt, "a file is a place to land too");
	clearTimeout(p.timer);
	p._show(p._hoverTarget({ target: opt }));
	assert.equal(p.el.style.display, "block");
	assert.ok(
		lines(p).some((l) => l.includes("const d = 4;")),
		`the last line typed is missing from ${JSON.stringify(lines(p))}`,
	);
});

test("a file with nothing in it yet shows no preview", () => {
	const p = build();
	const { opt } = optionOf(3, "style.css");
	p._show(p._hoverTarget({ target: opt }));
	assert.notEqual(p.el && p.el.style.display, "block");
});

test("hovering a plain block is not an anchor hover", () => {
	const p = build();
	const plain = makeEl("div");
	plain.closest = (sel) => (sel === ".block" ? plain : null);
	p._onOver({ target: plain });
	assert.equal(p.target, null);
});

test("hide clears the pending timer and the tooltip", () => {
	const p = build();
	const { opt } = optionOf(3, "⚓7⚓");
	p._show(p._hoverTarget({ target: opt }));
	p.timer = 1;
	p.hide();
	assert.equal(p.timer, null);
	assert.equal(p.target, null);
	assert.equal(p.el.style.display, "none");
});

test("the preview attaches after the DOM elements are cached", () => {
	const fs = require("node:fs");
	const path = require("node:path");
	const src = fs.readFileSync(
		path.resolve(__dirname, "..", "src/renderer/app.js"),
		"utf-8",
	);
	const cached = src.indexOf("uiManager.cacheElements()");
	const attached = src.indexOf("anchorPreview.attach(");
	assert.ok(cached >= 0, "cacheElements is called somewhere");
	assert.ok(attached >= 0, "the preview is attached somewhere");
	assert.ok(
		attached > cached,
		"attach() before cacheElements() gets an undefined container",
	);
});

function placed(p, { list, opt, tip }) {
	const scene = optionOf(3, "⚓7⚓");
	if (list) Object.assign(scene.list.rect, list);
	if (opt) Object.assign(scene.opt.rect, opt);
	p._show(p._hoverTarget({ target: scene.opt }));
	if (tip) {
		Object.assign(p.el.rect, tip);
		p._place(scene.opt, scene.list);
	}
	return { ...scene, style: p.el.style };
}

test("with room on the right the preview goes there, aligned to the item", () => {
	const p = build();
	const { style } = placed(p, {
		list: { left: 100, right: 300, top: 100, bottom: 500 },
		opt: { top: 220, bottom: 240, left: 100, right: 300 },
		tip: { width: 400, height: 200 },
	});
	assert.equal(style.left, "308px");
	assert.equal(style.top, "220px");
	assert.equal(p.el.style.maxWidth, `${1200 - 300 - 16}px`);
});

test("with room only on the left it flips to that side", () => {
	const p = build();
	const { style } = placed(p, {
		list: { left: 700, right: 1100, top: 100, bottom: 500 },
		opt: { top: 220, bottom: 240, left: 700, right: 1100 },
		tip: { width: 400, height: 200 },
	});
	assert.equal(style.left, `${700 - 8 - 400}px`);
});

test("when the preview does not fit beside the list it goes under it", () => {
	const p = build();
	const { style } = placed(p, {
		list: { left: 270, right: 960, top: 60, bottom: 300 },
		opt: { top: 100, bottom: 120, left: 270, right: 960 },
		tip: { width: 600, height: 200 },
	});
	assert.equal(style.top, "308px", "below the list, not beside it");
	assert.equal(style.left, "270px", "aligned with the list");
	assert.equal(style.maxHeight, `${800 - 300 - 16}px`, "capped so it fits");
});

test("when the list hangs low the strip goes above it", () => {
	const p = build();
	const { style } = placed(p, {
		list: { left: 270, right: 960, top: 500, bottom: 780 },
		opt: { top: 600, bottom: 620, left: 270, right: 960 },
		tip: { width: 600, height: 200 },
	});
	assert.equal(style.top, `${500 - 8 - 200}px`, "above the list");
	assert.equal(style.maxHeight, `${500 - 16}px`);
});

test("the preview is always kept inside the window", () => {
	const p = build();
	const { style } = placed(p, {
		list: { left: 100, right: 300, top: 700, bottom: 790 },
		opt: { top: 760, bottom: 780, left: 100, right: 300 },
		tip: { width: 400, height: 300 },
	});
	assert.equal(style.top, `${800 - 300 - 8}px`, "pulled up to fit");
	assert.ok(parseInt(style.left, 10) >= 8);
});

test("a tall strip does not keep its cap on the next hover", () => {
	const p = build();
	placed(p, {
		list: { left: 270, right: 960, top: 60, bottom: 300 },
		opt: { top: 100, bottom: 120, left: 270, right: 960 },
		tip: { width: 600, height: 200 },
	});
	assert.notEqual(p.el.style.maxHeight, "");
	placed(p, {
		list: { left: 100, right: 300, top: 100, bottom: 500 },
		opt: { top: 220, bottom: 240, left: 100, right: 300 },
		tip: { width: 400, height: 200 },
	});
	assert.equal(
		p.el.style.maxHeight,
		"",
		"the CSS max-height is back in charge",
	);
});
