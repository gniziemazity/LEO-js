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
		className: "",
		offsetTop: 0,
		offsetHeight: 0,
	};
	node.classList = classList(node);
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
	node.querySelectorAll = () => [];
	node.addEventListener = () => {};
	node.blur = () => {};
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
		"iGrid",
		"iQuestionRow",
		"iQuestionInput",
		"iMicBtn",
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
	nodes.interactionOverlay.classList.add("overlay");

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
		setTimeout: () => 0,
		clearTimeout() {},
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
		InteractionView: require(path.join(BASE, "shared/interaction-view.js")),
	};

	const src = [
		fs.readFileSync(path.join(BASE, "shared/snippet-view.js"), "utf-8"),
		"const SnippetView = window.SnippetView;",
		...LOAD_ORDER.map((f) => fs.readFileSync(path.join(REMOTE, f), "utf-8")),
	].join("\n;\n");

	const exported =
		src +
		"\n;module.exports={setSessionActive,setTouchpadMode," +
		"showQuestionOverlay,closeQuestionOverlayUI,showMoveToOverlay," +
		"closeMoveToOverlayUI,showCodeInsertOverlay,closeCodeInsertOverlayUI," +
		"closeCodeInsertOverlay,codeInsertPaste," +
		"updateLessonData,applySettings,updateCursor," +
		"showQuestionToTeacher,closeQuestionOverlay:()=>questionOverlay.dismiss()," +
		"closeMoveToOverlay," +
		"moveToTypeName,setAutoPilot,requestAutoPilot,remoteStep," +
		"moveToSetTyped:(d)=>moveToOverlay.setTyped(d)," +
		"showNoteOverlay,closeNoteOverlayUI,closeNoteOverlay," +
		"showMediaOverlay,closeMediaOverlayUI,closeMediaOverlay," +
		"pinMediaWindow,setPinnedWindows,unpinWindows,closeActiveOverlay," +
		"handleInteractionBtn,closeInteractionOverlay:()=>interactionOverlay.closeOverlay()," +
		"setStudents,activePadOverlay," +
		"padMode:()=>(touchpadActive?touchpadMode:null)};";
	new Function(...Object.keys(sandbox), exported)(...Object.values(sandbox));

	return { api: sandbox.module.exports, nodes, sent, interactionBtns, root };
}

module.exports = { buildRemote: build };
