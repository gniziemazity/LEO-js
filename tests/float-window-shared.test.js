"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC_DIR = path.resolve(__dirname, "..", "src");
const SHARED = fs.readFileSync(
	path.join(SRC_DIR, "shared/float-window.js"),
	"utf-8",
);

const WINDOWS = [
	[
		"image-window.html",
		"force-close-image-window",
		"open-image-devtools",
		"pin-image-window",
	],
	[
		"web-window.html",
		"force-close-web-window",
		"open-web-devtools",
		"pin-web-window",
	],
	[
		"question-window.html",
		"close-question-window",
		"open-question-devtools",
		null,
	],
	[
		"options-window.html",
		"close-options-window",
		"open-options-devtools",
		null,
	],
	[
		"randomizer-window.html",
		"close-randomizer-window",
		"open-randomizer-devtools",
		null,
	],
];

function makeDom({ withPin }) {
	const listeners = { document: {}, window: {}, ipc: {} };
	const sent = [];

	function node(tag) {
		const n = {
			tag,
			className: "",
			dataset: {},
			children: [],
			classes: new Set(),
			handlers: {},
			classList: {
				toggle(c, on) {
					if (on) n.classes.add(c);
					else n.classes.delete(c);
				},
			},
			addEventListener(type, fn) {
				n.handlers[type] = fn;
			},
			appendChild(child) {
				n.children.push(child);
				return child;
			},
		};
		return n;
	}

	const body = node("body");
	const existing = node("div");
	existing.className = "neon-frame";
	body.children.push(existing);

	const pinBtn = withPin ? node("button") : null;

	const frag = node("#fragment");
	const document = {
		body: {
			style: {},
			get firstChild() {
				return body.children[0];
			},
			insertBefore(child, before) {
				const at = body.children.indexOf(before);
				const kids = child.tag === "#fragment" ? child.children : [child];
				body.children.splice(
					at < 0 ? body.children.length : at,
					0,
					...kids,
				);
			},
		},
		createElement: node,
		createDocumentFragment: () => node("#fragment"),
		getElementById: (id) => (id === "pinBtn" ? pinBtn : null),
		querySelectorAll: (sel) =>
			body.children.filter((c) =>
				c.className.includes(sel.replace(".", "")),
			),
		addEventListener(type, fn) {
			listeners.document[type] = fn;
		},
	};
	const win = {
		addEventListener(type, fn) {
			listeners.window[type] = fn;
		},
	};
	const requireStub = (name) => {
		assert.equal(name, "electron");
		return {
			ipcRenderer: {
				send: (...a) => sent.push(a),
				on: (channel, fn) => (listeners.ipc[channel] = fn),
			},
		};
	};

	new Function("require", "document", "window", SHARED)(
		requireStub,
		document,
		win,
	);

	return {
		body,
		style: document.body.style,
		pinBtn,
		sent,
		listeners,
		initFloatWindow: win.initFloatWindow,
	};
}

test("the shared chrome builds all eight resize handles", () => {
	const d = makeDom({ withPin: false });
	d.initFloatWindow({ close: "c", devtools: "d" });
	const handles = d.body.children.filter((c) =>
		c.className.startsWith("resize-handle"),
	);
	assert.equal(handles.length, 8, "eight edges and corners");
	assert.deepEqual(
		handles.map((h) => h.dataset.edge),
		[
			"top",
			"bottom",
			"left",
			"right",
			"top-left",
			"top-right",
			"bottom-left",
			"bottom-right",
		],
		"every edge the main process can be asked to drag",
	);
	assert.deepEqual(
		handles.map((h) => h.className),
		[
			"resize-handle resize-n",
			"resize-handle resize-s",
			"resize-handle resize-w",
			"resize-handle resize-e",
			"resize-handle resize-nw",
			"resize-handle resize-ne",
			"resize-handle resize-sw",
			"resize-handle resize-se",
		],
		"each carries the direction class its CSS positions it by",
	);
});

test("handles go in front of the page's own content, as the markup had them", () => {
	const d = makeDom({ withPin: false });
	d.initFloatWindow({ close: "c", devtools: "d" });
	assert.equal(d.body.children.length, 9);
	assert.equal(
		d.body.children[8].className,
		"neon-frame",
		"the frame stays last",
	);
});

test("dragging a handle names the edge; letting go anywhere ends the resize", () => {
	const d = makeDom({ withPin: false });
	d.initFloatWindow({ close: "c", devtools: "d" });
	let prevented = false;
	const se = d.body.children.find((c) => c.dataset.edge === "bottom-right");
	se.handlers.mousedown({ preventDefault: () => (prevented = true) });
	assert.ok(prevented, "or the drag selects the page instead");
	assert.deepEqual(d.sent, [["start-resizing", "bottom-right"]]);

	d.listeners.window.mouseup();
	assert.deepEqual(
		d.sent[1],
		["end-resizing"],
		"released on window, not on the handle",
	);
});

test("Escape and Ctrl+I use the channels the page passed in", () => {
	const d = makeDom({ withPin: false });
	d.initFloatWindow({ close: "close-me", devtools: "devtools-me" });
	const keydown = d.listeners.document.keydown;

	keydown({ key: "Escape", preventDefault() {} });
	assert.deepEqual(d.sent[0], ["close-me"]);

	let prevented = false;
	keydown({
		key: "i",
		ctrlKey: true,
		preventDefault: () => (prevented = true),
	});
	assert.deepEqual(d.sent[1], ["devtools-me"]);
	assert.ok(prevented, "or Ctrl+I opens the browser's own find bar too");

	keydown({ key: "I", ctrlKey: true, preventDefault() {} });
	assert.deepEqual(
		d.sent[2],
		["devtools-me"],
		"capital too, so Shift does not break it",
	);

	keydown({ key: "i", ctrlKey: false, preventDefault() {} });
	assert.equal(d.sent.length, 3, "plain i types nothing");
});

test("pinning is wired only when the page asked for it", () => {
	const d = makeDom({ withPin: true });
	const { setPin } = d.initFloatWindow({
		close: "c",
		devtools: "d",
		pin: "pin-me",
	});

	d.pinBtn.handlers.click();
	assert.deepEqual(d.sent.at(-1), ["pin-me", true]);
	assert.ok(d.pinBtn.classes.has("pinned"), "the button shows it");

	d.pinBtn.handlers.click();
	assert.deepEqual(d.sent.at(-1), ["pin-me", false]);
	assert.ok(!d.pinBtn.classes.has("pinned"));
});

test("setPin is idempotent, which is why callers need no pinned flag of their own", () => {
	const d = makeDom({ withPin: true });
	const { setPin } = d.initFloatWindow({
		close: "c",
		devtools: "d",
		pin: "pin-me",
	});

	setPin(true);
	const after = d.sent.length;
	setPin(true);
	setPin(true);
	assert.equal(
		d.sent.length,
		after,
		"already pinned: nothing crosses the wire",
	);
});

test("a window that fades out on fade-out is brought back by unfade", () => {
	const d = makeDom({ withPin: false });
	const { unfade } = d.initFloatWindow({
		close: "c",
		devtools: "d",
		fade: true,
	});
	d.listeners.ipc["fade-out"]();
	assert.equal(d.style.opacity, "0");
	assert.equal(d.style.transition, "opacity 300ms ease");
	unfade();
	assert.equal(d.style.opacity, "1");
	assert.equal(d.style.transition, "");
});

test("fading is wired only when the page asked for it", () => {
	const d = makeDom({ withPin: false });
	const { unfade } = d.initFloatWindow({ close: "c", devtools: "d" });
	assert.equal(d.listeners.ipc["fade-out"], undefined);
	assert.doesNotThrow(() => unfade());
});

test("a window with no pin button still initialises, and setPin is a safe no-op", () => {
	const d = makeDom({ withPin: false });
	const { setPin } = d.initFloatWindow({ close: "c", devtools: "d" });
	assert.equal(typeof setPin, "function");
	assert.doesNotThrow(() => setPin(true));
	assert.equal(d.sent.length, 0);
});

test("every floating window loads the shared chrome and declares both channels", () => {
	for (const [file, close, devtools, pin] of WINDOWS) {
		const html = fs.readFileSync(path.join(SRC_DIR, file), "utf-8");
		assert.match(
			html,
			/<script src="\.\/shared\/float-window\.js"><\/script>/,
			file + " must load the shared chrome",
		);
		assert.match(html, /initFloatWindow\(\{/, file + " must call it");
		assert.ok(html.includes(`close: "${close}"`), file + " close channel");
		assert.ok(
			html.includes(`devtools: "${devtools}"`),
			file + " devtools channel",
		);
		if (pin) assert.ok(html.includes(`pin: "${pin}"`), file + " pin channel");
		else
			assert.ok(
				!/\bpin:/.test(html),
				file + " must not claim a pin channel",
			);
	}
});

test("no window keeps a private copy of the chrome any more", () => {
	for (const [file] of WINDOWS) {
		const html = fs.readFileSync(path.join(SRC_DIR, file), "utf-8");
		assert.ok(
			!html.includes('class="resize-handle'),
			file + " must not hand-write the handles",
		);
		assert.ok(
			!html.includes("start-resizing"),
			file + " must not wire resizing itself",
		);
		assert.ok(
			!html.includes('addEventListener("keydown"'),
			file + " must not wire Escape itself",
		);
		assert.ok(
			!html.includes("reflectPin"),
			file + " must not reimplement pinning",
		);
	}
});
