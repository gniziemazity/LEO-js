"use strict";

const fs = require("node:fs");
const path = require("node:path");

const BASE = path.resolve(__dirname, "..", "..", "src");
const REMOTE = path.join(BASE, "shared/remote");

const LOAD_ORDER = [
	"touchpad.js",
	"lesson.js",
	"remote-overlay.js",
	"question-overlay.js",
	"interaction-overlay.js",
	"move-to-overlay.js",
	"code-insert-overlay.js",
	"note-overlay.js",
	"media-overlay.js",
	"overlays.js",
];

function classList(el) {
	const set = new Set();
	return {
		add: (...cs) =>
			cs.forEach((c) => c.split(" ").forEach((n) => set.add(n))),
		remove: (...cs) =>
			cs.forEach((c) => c.split(" ").forEach((n) => set.delete(n))),
		toggle: (c, on) => (on ? set.add(c) : set.delete(c)),
		contains: (c) => set.has(c),
		_set: set,
		_el: el,
	};
}

function matchesSimple(node, part) {
	const notMatch = /^(\.[\w-]+):not\((\.[\w-]+)\)$/.exec(part);
	if (notMatch) {
		return (
			node.classList.contains(notMatch[1].slice(1)) &&
			!node.classList.contains(notMatch[2].slice(1))
		);
	}
	return part.startsWith(".") && node.classList.contains(part.slice(1));
}

function matches(node, sel) {
	if (sel === "[data-step-index]") return node.dataset.stepIndex !== undefined;
	for (const part of sel.split(",").map((s) => s.trim())) {
		if (matchesSimple(node, part)) return true;
	}
	return false;
}

function makeStyle() {
	const style = {};
	style.setProperty = (k, v) => (style[k] = v);
	style.removeProperty = (k) => delete style[k];
	return style;
}

function el(id) {
	const node = {
		id,
		dataset: {},
		style: makeStyle(),
		children: [],
		onclick: null,
		textContent: "",
		value: "",
		offsetTop: 0,
		offsetHeight: 0,
	};
	node.classList = classList(node);
	Object.defineProperty(node, "className", {
		get: () => [...node.classList._set].join(" "),
		set: (v) => {
			node.classList._set.clear();
			String(v)
				.split(" ")
				.filter(Boolean)
				.forEach((c) => node.classList._set.add(c));
		},
	});
	node.appendChild = (child) => {
		if (child && child._fragment) node.children.push(...child.children);
		else node.children.push(child);
		return child;
	};
	node.insertBefore = (child, before) => {
		const at = before ? node.children.indexOf(before) : 0;
		const kids = child && child._fragment ? child.children : [child];
		node.children.splice(at < 0 ? 0 : at, 0, ...kids);
		return child;
	};
	node.querySelectorAll = (sel) => {
		const out = [];
		const walk = (n) => {
			for (const child of n.children || []) {
				if (matches(child, sel)) out.push(child);
				walk(child);
			}
		};
		walk(node);
		return out;
	};
	node._listeners = new Map();
	node.addEventListener = (type, fn) => {
		if (!node._listeners.has(type)) node._listeners.set(type, []);
		node._listeners.get(type).push(fn);
	};
	node.blur = () => {};
	node.scrollIntoView = () => {};
	Object.defineProperty(node, "firstChild", {
		get: () => node.children[0] || null,
	});
	Object.defineProperty(node, "innerHTML", {
		get: () => "",
		set: () => {
			node.children.length = 0;
		},
	});
	return node;
}

function build(opts = {}) {
	const sent = [];
	const timeouts = new Map();
	let timeoutSeq = 0;
	const ids = [
		"touchpadOverlay",
		"mobile-header",
		"modeBtnKeyboard",
		"modeBtnMouse",
		"autoPilotBtn",
		"modeSideBtns",
		"touchpadEditKeys",
		"touchpadStepKeys",
		"mtoConfirm",
		"mtoActions",
		"mtoTypeName",
		"questionOverlay",
		"moveToOverlay",
		"interactionOverlay",
		"qText",
		"qGrid",
		"qShowBtn",
		"mtoTitle",
		"mtoNote",
		"mtoTarget",
		"mtoSnippet",
		"mtModal",
		"iModal",
		"iTitle",
		"iAskerRow",
		"iGrid",
		"iQuestionRow",
		"iQuestionInput",
		"iMicBtn",
		"iShowBtn",
		"codeInsertOverlay",
		"ciModal",
		"ciCode",
		"ciActions",
		"ciPaste",
		"ciConfirm",
		"noteOverlay",
		"ntTitle",
		"ntText",
		"mediaOverlay",
		"mdTitle",
		"mdName",
		"mdPin",
		"modeBtnPin",
		"lesson-container",
	];
	const nodes = {};
	for (const id of ids) nodes[id] = el(id);

	nodes.questionOverlay.classList.add("overlay overlay-pad-ok");
	nodes.moveToOverlay.classList.add("overlay overlay-pad-ok");
	nodes.codeInsertOverlay.classList.add("overlay overlay-pad-ok");
	nodes.noteOverlay.classList.add("overlay overlay-pad-ok");
	nodes.mediaOverlay.classList.add("overlay overlay-pad-ok");
	nodes.interactionOverlay.classList.add("overlay overlay-pad-ok");

	const overlayIds = [
		"questionOverlay",
		"moveToOverlay",
		"codeInsertOverlay",
		"noteOverlay",
		"mediaOverlay",
		"interactionOverlay",
	];

	const interactionBtns = [el("btnQuestion"), el("btnHelp")];
	const root = el("html");

	const document = {
		body: el("body"),
		documentElement: root,
		getElementById: (id) => nodes[id] || null,
		createElement: () => el(""),
		createDocumentFragment: () => {
			const frag = el("");
			frag._fragment = true;
			return frag;
		},
		querySelector: (sel) => {
			if (!sel.startsWith(".overlay.active")) return null;
			const skipPadOk = sel.includes(":not(.overlay-pad-ok)");
			for (const id of overlayIds) {
				const node = nodes[id];
				if (!node.classList.contains("active")) continue;
				if (skipPadOk && node.classList.contains("overlay-pad-ok"))
					continue;
				return node;
			}
			return null;
		},
		querySelectorAll: (sel) =>
			sel === ".mode-side-btn-question, .mode-side-btn-help"
				? interactionBtns
				: [],
		addEventListener: () => {},
	};

	const sandbox = {
		module: { exports: {} },
		document,
		window: { addEventListener() {}, isSecureContext: false },
		navigator: { language: "en-US", vibrate() {} },
		sendMessage: (type, data) => sent.push({ type, data }),
		setTimeout: (fn) => {
			const id = ++timeoutSeq;
			timeouts.set(id, fn);
			return id;
		},
		clearTimeout: (id) => timeouts.delete(id),
		setInterval: () => 0,
		clearInterval() {},
		requestAnimationFrame: (fn) => {
			fn();
			return 0;
		},
		cancelAnimationFrame() {},
		console,
		LeoBlocks: require(path.join(BASE, "shared/blocks.js")),
		MoveToTarget: require(path.join(BASE, "shared/move-to-target.js")),
	};

	const src = [
		fs.readFileSync(path.join(BASE, "shared/snippet-view.js"), "utf-8"),
		"const SnippetView = window.SnippetView;",
		fs.readFileSync(path.join(BASE, "shared/code-text.js"), "utf-8"),
		"const CodeTextRenderer = window.CodeTextRenderer;",
		fs.readFileSync(path.join(BASE, "shared/interaction-view.js"), "utf-8"),
		"const InteractionView = window.InteractionView;",
		...LOAD_ORDER.map((f) => fs.readFileSync(path.join(REMOTE, f), "utf-8")),
	].join("\n;\n");

	const exported =
		src +
		"\n;module.exports={setSessionActive,setTouchpadMode,initTouchpad," +
		"showQuestionOverlay,closeQuestionOverlayUI,showMoveToOverlay," +
		"closeMoveToOverlayUI,showCodeInsertOverlay,closeCodeInsertOverlayUI," +
		"resyncOverlays," +
		"closeCodeInsertOverlay,codeInsertPaste," +
		"updateLessonData,applySettings,updateCursor," +
		"showQuestionToTeacher,closeQuestionOverlay:()=>questionOverlay.dismiss()," +
		"closeMoveToOverlay," +
		"moveToTypeName,setAutoPilot,requestAutoPilot,remoteStep," +
		"moveToSetTyped:(d)=>moveToOverlay.setTyped(d)," +
		"showNoteOverlay,closeNoteOverlayUI,closeNoteOverlay," +
		"showMediaOverlay,closeMediaOverlayUI,closeMediaOverlay," +
		"pinMediaWindow,setPinnedWindows,unpinWindows,closeActiveOverlay," +
		"handleInteractionBtn,interactionAsk,closeInteractionOverlay:()=>interactionOverlay.closeOverlay()," +
		"setStudents,activePadOverlay,onRandomizerResult," +
		"padMode:()=>(touchpadActive?touchpadMode:null)};";
	new Function(...Object.keys(sandbox), exported)(...Object.values(sandbox));

	function fire(node, type, event = {}) {
		const handlers = node._listeners ? node._listeners.get(type) : null;
		if (!handlers) return 0;
		const ev = {
			touches: [],
			changedTouches: [],
			target: { closest: () => null },
			preventDefault() {},
			...event,
		};
		for (const fn of handlers) fn(ev);
		return handlers.length;
	}

	return {
		api: sandbox.module.exports,
		nodes,
		sent,
		interactionBtns,
		root,
		fire,
		pendingTimeouts: () => timeouts.size,
		runTimeouts: () => {
			const fns = [...timeouts.values()];
			timeouts.clear();
			for (const fn of fns) fn();
			return fns.length;
		},
	};
}

module.exports = { buildRemote: build };
