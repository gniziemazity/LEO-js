"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SRC_DIR = path.resolve(__dirname, "..", "src");
const read = (rel) => fs.readFileSync(path.join(SRC_DIR, rel), "utf-8");
const RUNTIME = read("shared/themes/theme-runtime.js");
const DRAGONBALL = read("shared/themes/dragonball.js");

const WIN_W = 900;
const WIN_H = 600;
const RADIUS = 8;
const BOX = { x: 16, y: 16, w: WIN_W - 32, h: WIN_H - 32, r: RADIUS };

function insideRounded(x, y, box, r) {
	if (x <= box.x || x >= box.x + box.w || y <= box.y || y >= box.y + box.h)
		return false;
	const cx = Math.min(Math.max(x, box.x + r), box.x + box.w - r);
	const cy = Math.min(Math.max(y, box.y + r), box.y + box.h - r);
	return Math.hypot(x - cx, y - cy) < r - 1e-9;
}

function recordingContext(calls) {
	const state = {};
	return new Proxy(state, {
		get(target, key) {
			if (key in target) return target[key];
			return (...args) => {
				calls.push([key, ...args]);
				return { addColorStop() {} };
			};
		},
		set(target, key, value) {
			target[key] = value;
			calls.push(["set:" + String(key), value]);
			return true;
		},
	});
}

function load() {
	const calls = [];
	const ctx = recordingContext(calls);
	const classes = new Set();
	const frames = [];
	const body = {
		classList: {
			add: (c) => classes.add(c),
			remove: (c) => classes.delete(c),
			toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
		},
		insertBefore() {},
		firstChild: null,
	};
	const sandbox = {
		window: {
			innerWidth: WIN_W,
			innerHeight: WIN_H,
			devicePixelRatio: 1,
			addEventListener() {},
			removeEventListener() {},
		},
		document: {
			body,
			hidden: false,
			documentElement: { style: { setProperty() {}, removeProperty() {} } },
			createElement: () => ({ style: {}, getContext: () => ctx }),
			addEventListener() {},
			removeEventListener() {},
		},
		performance: { now: () => 0 },
		requestAnimationFrame: (fn) => frames.push(fn),
		cancelAnimationFrame() {},
		getComputedStyle: () => ({
			getPropertyValue: () => "",
			borderTopLeftRadius: RADIUS + "px",
		}),
	};
	vm.createContext(sandbox);
	vm.runInContext(RUNTIME, sandbox);
	vm.runInContext(DRAGONBALL, sandbox);
	const frameEl = {
		getBoundingClientRect: () => ({
			left: BOX.x,
			top: BOX.y,
			width: BOX.w,
			height: BOX.h,
		}),
	};
	return {
		run: (code) => vm.runInContext(code, sandbox),
		theme: vm.runInContext("LEO_THEMES.dragonball", sandbox),
		sandbox,
		calls,
		classes,
		frameEl,
		tick: () => frames.shift()(1),
	};
}

test("the image and web windows draw the floating theme around their frame, in the image color", () => {
	for (const file of ["image-window.html", "web-window.html"]) {
		const html = read(file);
		const runtime = html.indexOf("./shared/themes/theme-runtime.js");
		const dragonball = html.indexOf("./shared/themes/dragonball.js");
		const call = html.indexOf("initBackground(");
		assert.ok(
			runtime > 0 && dragonball > runtime,
			file + " loads the themes",
		);
		assert.ok(call > dragonball, file + " starts the theme after loading it");
		assert.match(
			html,
			/initBackground\(\s*s\.floatingTheme,\s*s\.colors\.imageColor,\s*document\.querySelector\("\.neon-frame"\),?\s*\)/,
			file + " passes its frame, so the theme becomes a border",
		);
	}
});

test("the media windows inset their content like the question window, leaving room for the border", () => {
	const css = read("shared/styles.css");
	for (const view of ["image-view", "web-view"]) {
		const rule = css.match(
			new RegExp(`body\\.${view} \\.neon-frame \\{([^}]*)\\}`),
		);
		assert.ok(rule, view + " has a frame rule");
		assert.ok(
			!/\binset\s*:/.test(rule[1]),
			view +
				" must keep the shared 16px inset, or the content covers the border",
		);
	}
});

test("a framed dragonball is a rectangle drawn by drawFrame, never the circle", () => {
	const t = load();
	const drawn = [];
	t.theme.draw = () => drawn.push("draw");
	t.theme.drawFrame = (ctx, time, w, h, box) => drawn.push(box);
	t.sandbox.initBackground("dragonball", "#ff0000", t.frameEl);
	t.tick();

	assert.equal(t.sandbox.getActiveShape(), "rect");
	assert.ok(!t.classes.has("bg-circle"), "no circle layout in a media window");
	assert.ok(t.classes.has("leo-themed"));
	assert.deepEqual(JSON.parse(JSON.stringify(drawn)), [BOX]);
	assert.ok(
		!t.calls.some((c) => c[0] === "arc"),
		"the mask is the rounded rectangle, not the circle",
	);
	assert.deepEqual(
		{ ...t.theme._rgb },
		{ r: 255, g: 0, b: 0 },
		"the color reaches the theme, not only the solid fill",
	);
});

test("without a frame the question window keeps its circle", () => {
	const t = load();
	const drawn = [];
	t.theme.draw = () => drawn.push("draw");
	t.theme.drawFrame = () => drawn.push("frame");
	t.sandbox.initBackground("dragonball");
	t.tick();

	assert.equal(t.sandbox.getActiveShape(), "circle");
	assert.ok(t.classes.has("bg-circle"));
	assert.deepEqual(drawn, ["draw"]);
	assert.ok(t.calls.some((c) => c[0] === "arc"));
});

test("the framed electricity crackles in the band outside the frame", () => {
	const t = load();
	t.sandbox.initBackground("dragonball", "#bbdefb", t.frameEl);
	t.tick();

	const stroke = t.calls.findIndex((c) => c[0] === "stroke");
	assert.ok(stroke > 0, "the electricity is stroked");
	let begin = stroke;
	while (t.calls[begin][0] !== "beginPath") begin--;
	const points = t.calls
		.slice(begin, stroke)
		.filter((c) => c[0] === "moveTo" || c[0] === "lineTo")
		.map((c) => [c[1], c[2]]);
	assert.ok(points.length > 100, "sparks all the way round");
	const band = BOX.x;
	for (const [x, y] of points) {
		assert.ok(
			!insideRounded(x, y, BOX, RADIUS),
			`(${x}, ${y}) would be hidden under the content`,
		);
		assert.ok(
			x >= BOX.x - band &&
				x <= BOX.x + BOX.w + band &&
				y >= BOX.y - band &&
				y <= BOX.y + BOX.h + band,
			`(${x}, ${y}) is past the window edge`,
		);
	}
});

test("the framed dragonball rounds its corners like the frame it surrounds", () => {
	const t = load();
	t.sandbox.initBackground("dragonball", "#bbdefb", t.frameEl);
	t.tick();

	const glow = t.calls.find((c) => c[0] === "roundRect");
	assert.ok(glow, "the glow is a rounded rectangle");
	const [, x, y, w, h, r] = glow;
	const grow = BOX.x - x;
	assert.ok(grow > 0 && grow < BOX.x, "it hugs the frame from outside");
	assert.deepEqual(
		[y, w, h],
		[BOX.y - grow, BOX.w + grow * 2, BOX.h + grow * 2],
	);
	assert.equal(r, RADIUS + grow, "its corners follow the frame's own radius");
	assert.ok(
		!t.calls.some((c) => c[0] === "fillRect" && c[3] > BOX.w && c[3] < WIN_W),
		"no square-cornered glow behind the rounded content",
	);

	const stroke = t.calls.findIndex((c) => c[0] === "stroke");
	let begin = stroke;
	while (t.calls[begin][0] !== "beginPath") begin--;
	const corner = t.calls
		.slice(begin, stroke)
		.filter((c) => c[0] === "lineTo" || c[0] === "moveTo")
		.map((c) => [c[1], c[2]])
		.filter(([px, py]) => px > BOX.x + BOX.w - RADIUS && py < BOX.y + RADIUS);
	for (const [px, py] of corner) {
		const d = Math.hypot(
			px - (BOX.x + BOX.w - RADIUS),
			py - (BOX.y + RADIUS),
		);
		assert.ok(
			d >= RADIUS - 1e-9,
			`(${px}, ${py}) cuts into the rounded corner`,
		);
	}
});

test("a framed solid theme fills the window with the image color", () => {
	const t = load();
	t.sandbox.initBackground("solid", "#bbdefb", t.frameEl);
	const fill = t.calls.findIndex(
		(c) => c[0] === "fillRect" && c[3] === WIN_W && c[4] === WIN_H,
	);
	assert.ok(fill > 0);
	const styles = t.calls
		.slice(0, fill)
		.filter((c) => c[0] === "set:fillStyle");
	assert.equal(styles.at(-1)[1], "#bbdefb");
	assert.equal(t.sandbox.getActiveShape(), "rect");
});
