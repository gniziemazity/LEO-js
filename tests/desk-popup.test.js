"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function makeEl(tag) {
	const kids = [];
	const classes = new Set();
	const handlers = {};
	const el = {
		tag,
		dataset: {},
		style: {},
		children: kids,
		type: "",
		placeholder: "",
		value: "",
		classList: {
			add: (...cs) => cs.forEach((c) => classes.add(c)),
			remove: (c) => classes.delete(c),
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
		},
		addEventListener(type, fn) {
			(handlers[type] = handlers[type] || []).push(fn);
		},
		click() {
			(handlers.click || []).forEach((fn) => fn({}));
		},
	};
	Object.defineProperty(el, "className", {
		get: () => [...classes].join(" "),
		set: (v) => {
			classes.clear();
			String(v)
				.split(" ")
				.filter(Boolean)
				.forEach((c) => classes.add(c));
		},
	});
	Object.defineProperty(el, "textContent", {
		get: () => el._text || "",
		set: (v) => (el._text = v),
	});
	Object.defineProperty(el, "innerHTML", {
		get: () => "",
		set: () => {
			kids.length = 0;
		},
	});
	return el;
}

global.document = { createElement: makeEl, body: makeEl("body") };

const DeskPopup = require("../src/renderer/desk-popup");

function build() {
	const sent = [];
	const popup = new DeskPopup((type, args) => sent.push([type, ...args]));
	return { popup, sent };
}

// Every button in the card, flattened.
function buttons(popup) {
	const out = [];
	const walk = (el) => {
		for (const c of el.children || []) {
			if (c.tag === "button") out.push(c);
			walk(c);
		}
	};
	walk(popup.el);
	return out;
}

const byLabel = (popup, label) =>
	buttons(popup).find((b) => b.textContent === label);

const SNIPPET = {
	lines: ["const a = 1;", "const b = 2;"],
	colored: null,
	arrowIdx: 1,
	anchorCol: 0,
	switchTo: "app.js",
};

test("the move-to card shows the snippet and names the file to open", () => {
	const { popup, sent } = build();
	popup.showMoveTo({ mode: "anchor", target: "⚓7⚓", snippet: SNIPPET });

	assert.equal(popup.isOpen("move-to"), true);
	assert.equal(popup.el.children[0].textContent, "Go to (app.js):");
	const body = popup.el.children[1];
	assert.equal(body.children.length, 2, "one row per snippet line");

	byLabel(popup, "OK").click();
	assert.deepEqual(sent, [["client-move-to-confirmed"]]);
	assert.equal(popup.isOpen(), false, "confirming closes the card");
});

test("a file move-to names the file above the code it lands in", () => {
	const { popup } = build();
	popup.showMoveTo({
		mode: "file",
		target: "app.js",
		snippet: { ...SNIPPET, switchTo: null },
	});
	assert.equal(popup.el.children[0].textContent, "Go to:");
	assert.equal(popup.el.children[1].textContent, "app.js");
	assert.equal(popup.el.children[2].children.length, 2);
	assert.equal(popup.el.children[3].className, "desk-popup-actions");
});

test("an anchor that cannot be found falls back to its name", () => {
	const { popup } = build();
	popup.showMoveTo({
		mode: "anchor",
		target: "⚓9⚓",
		snippet: { lines: [] },
	});
	assert.equal(popup.el.children.length, 3, "no empty code box is left");
	assert.equal(popup.el.children[1].textContent, "⚓9⚓");
});

test("a move-to that is not an anchor just names its target", () => {
	const { popup } = build();
	popup.showMoveTo({ mode: "dev", target: "DEV", snippet: null });
	assert.equal(popup.el.children[0].textContent, "Go to:");
	assert.equal(popup.el.children[1].textContent, "Dev Tools");
});

test("the code-insert card points at the clipboard, with no Paste button", () => {
	const { popup, sent } = build();
	popup.showCodeInsert({ text: "const a = 1;\nconst b = 2;", colored: null });

	assert.equal(popup.el.children[1].children.length, 2);
	assert.equal(
		buttons(popup)
			.map((b) => b.textContent)
			.join(","),
		"OK",
		"the desk pastes with Ctrl+V; the button belongs to the phone",
	);
	byLabel(popup, "OK").click();
	assert.deepEqual(sent, [["client-code-insert-confirmed"]]);
});

test("the note card shows the note and confirms it", () => {
	const { popup, sent } = build();
	popup.showNote({ text: "Mind the\nindentation" });
	assert.equal(popup.isOpen("note"), true);
	assert.equal(popup.el.children[0].textContent, "Note:");
	assert.equal(popup.el.children[1].textContent, "Mind the\nindentation");
	assert.match(
		popup.el.children[1].className,
		/mt-modal-note/,
		"it wears the note colour the Settings theme sets",
	);
	byLabel(popup, "OK").click();
	assert.deepEqual(sent, [["client-note-confirmed"]]);
	assert.equal(popup.isOpen(), false);
});

test("the image and web cards name what is shown, under their own kind", () => {
	for (const [kind, title] of [
		["image", "Image:"],
		["web", "Web page:"],
	]) {
		const { popup, sent } = build();
		popup.showMedia({ kind, name: "flex.webp" });
		assert.equal(popup.isOpen(kind), true, "closeIf(kind) must find it");
		assert.equal(popup.el.children[0].textContent, title);
		assert.equal(popup.el.children[1].textContent, "flex.webp");
		assert.deepEqual(
			buttons(popup).map((b) => b.textContent),
			["OK"],
			"the desk pins from the window's own 📌",
		);
		byLabel(popup, "OK").click();
		assert.deepEqual(sent, [["client-media-confirmed"]]);
	}
});

test("the snippet hint names the key that pastes and carries on", () => {
	const { popup } = build();
	const hint = () =>
		popup.el.children.find((c) => c.className === "desk-popup-hint")
			.textContent;
	popup.showCodeInsert({ text: "x", colored: null });
	assert.equal(hint(), "(to paste: Ctrl/⌘+V in your editor)");

	popup.setConfirmKey("CommandOrControl+Enter");
	popup.showCodeInsert({ text: "x", colored: null });
	assert.equal(
		hint(),
		"(to paste: Ctrl/⌘+V in your editor, or Ctrl/⌘+Enter to paste and carry on)",
	);

	popup.setConfirmKey("Alt+P");
	popup.showCodeInsert({ text: "x", colored: null });
	assert.match(hint(), /or Alt\+P to paste/, "a rebound key is the one named");
});

test("the question card reveals the students only after Show", () => {
	const { popup, sent } = build();
	popup.showQuestion({
		question: "What is X?",
		options: null,
		students: ["Ada", "Linus"],
		bgColor: "#facaca",
	});

	const grid = popup.el.children[popup.el.children.length - 1];
	assert.equal(
		grid.style.display,
		"none",
		"hidden until the class has seen it",
	);

	byLabel(popup, "Show").click();
	assert.deepEqual(sent, [["client-show-question", true]]);
	assert.equal(grid.style.display, "");
	assert.equal(byLabel(popup, "Show"), undefined, "Show is spent");
	assert.ok(byLabel(popup, "🎲"), "a randomiser appears once students show");

	byLabel(popup, "Linus").click();
	assert.deepEqual(sent[1], ["client-student-answered", 2], "1-based id");
	assert.equal(popup.isOpen(), false);
});

test("a question with no students offers a plain Answered", () => {
	const { popup, sent } = build();
	popup.showQuestion({ question: "q", options: null, students: [] });
	byLabel(popup, "Show").click();
	assert.equal(byLabel(popup, "🎲"), undefined, "nothing to randomise");
	byLabel(popup, "Answered").click();
	assert.deepEqual(sent[1], ["client-student-answered", null]);
});

test("dismissing a question closes the card and tells the host", () => {
	const { popup, sent } = build();
	popup.showQuestion({ question: "q", options: null, students: ["Ada"] });
	byLabel(popup, "✕").click();
	assert.deepEqual(sent, [["client-dismiss-question"]]);
	assert.equal(popup.isOpen(), false);
});

test("the options button only exists when the question has options", () => {
	const withOptions = build();
	withOptions.popup.showQuestion({
		question: "q",
		options: ["a", "b"],
		students: ["Ada"],
	});
	byLabel(withOptions.popup, "Show").click();
	assert.ok(byLabel(withOptions.popup, "🔤"));

	const without = build();
	without.popup.showQuestion({
		question: "q",
		options: [],
		students: ["Ada"],
	});
	byLabel(without.popup, "Show").click();
	assert.equal(byLabel(without.popup, "🔤"), undefined);
});

test("an interaction with no students is logged without a card", () => {
	const { popup, sent } = build();
	popup.showInteraction("student-question");
	assert.deepEqual(sent, [["client-interaction", "student-question"]]);
	assert.equal(popup.isOpen(), false);
});

test("picking a student opens the waiting state, Done closes it", () => {
	const { popup, sent } = build();
	popup.setStudents(["Ada", "Linus"]);
	popup.showInteraction("student-question");

	assert.deepEqual(sent[0], ["client-interaction-overlay-shown"]);
	const input = popup.el.children[1];
	input.value = "why does it crash?";

	byLabel(popup, "Ada").click();
	const shown = sent[1];
	assert.equal(shown[0], "client-show-student-interaction");
	assert.equal(shown[1], "student-question");
	assert.equal(shown[2], 1, "1-based student id");
	assert.equal(shown[3], "why does it crash?");
	assert.match(
		popup.el.children[0].textContent,
		/^❓ Ada: why does it crash\?$/,
	);

	byLabel(popup, "✓ Done — close").click();
	assert.equal(sent[2][0], "client-close-student-interaction");
	assert.equal(sent[3][0], "client-interaction-overlay-closed");
	assert.equal(popup.isOpen(), false);
});

test("helping someone has no question box and picks the teacher never", () => {
	const { popup, sent } = build();
	popup.setStudents(["Ada"]);
	popup.showInteraction("providing-help");
	assert.equal(popup.el.children[0].textContent, "🤝 Who needs help?");
	assert.equal(byLabel(popup, "Teacher"), undefined);
	byLabel(popup, "Ada").click();
	assert.equal(sent[1][3], null, "no question text for a help session");
	assert.equal(popup.el.children[0].textContent, "🤝 Helping Ada");
});

test("the teacher can be the one who asked", () => {
	const { popup, sent } = build();
	popup.setStudents(["Ada"]);
	popup.showInteraction("student-question");
	byLabel(popup, "Teacher").click();
	assert.equal(sent[1][2], 0, "the teacher is id 0");
});

test("closeIf only closes the popup it names", () => {
	const { popup } = build();
	popup.showMoveTo({ mode: "anchor", target: "⚓7⚓", snippet: SNIPPET });
	popup.closeIf("question");
	assert.equal(popup.isOpen("move-to"), true);
	popup.closeIf("move-to");
	assert.equal(popup.isOpen(), false);
});

test("the host ending a block closes the card without confirming it", () => {
	const { popup, sent } = build();
	popup.showCodeInsert({ text: "x", colored: null });
	popup.closeIf("code-insert");
	assert.deepEqual(sent, [], "stepping past must not fire the confirm");
});

test("every action the card sends is on the main-process allowlist", () => {
	const popupSrc = fs.readFileSync(
		path.resolve(__dirname, "..", "src/renderer/desk-popup.js"),
		"utf-8",
	);
	const mainSrc = fs.readFileSync(
		path.resolve(__dirname, "..", "src/main/main.js"),
		"utf-8",
	);
	const allow = /const DESK_ACTIONS = new Set\(\[([\s\S]*?)\]\);/.exec(
		mainSrc,
	);
	assert.ok(allow, "the bridge must keep an allowlist");
	const allowed = new Set(
		[...allow[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]),
	);
	const used = new Set(
		[...popupSrc.matchAll(/_(?:send|act)\(\s*"([^"]+)"/g)].map((m) => m[1]),
	);
	assert.ok(used.size >= 8, `only found ${used.size} actions`);
	for (const type of used) {
		assert.ok(allowed.has(type), `${type} would be dropped by the bridge`);
	}
});

test("the bridge refuses anything not on the list", () => {
	const mainSrc = fs.readFileSync(
		path.resolve(__dirname, "..", "src/main/main.js"),
		"utf-8",
	);
	const handler = /ipcMain\.on\("desk-action"[\s\S]*?\n\}\);/.exec(mainSrc)[0];
	assert.match(handler, /DESK_ACTIONS\.has\(type\)/);
	assert.match(handler, /return;/);
});

test("the popups live in LEO's own window, with no second client shape", () => {
	const read = (p) =>
		fs.readFileSync(path.resolve(__dirname, "..", p), "utf-8");
	assert.equal(read("src/index.html").includes("controlPanel"), false);
	for (const f of [
		"src/shared/remote/connection.js",
		"src/shared/remote/code-insert-overlay.js",
		"src/shared/remote/interaction-overlay.js",
	]) {
		assert.equal(
			read(f).includes("IS_CONTROL_PANEL"),
			false,
			`${f} branches on a client shape the remote does not have`,
		);
	}
	assert.equal(
		read("src/shared/styles.css").includes("panel-mode"),
		false,
		"styles.css carries rules nothing can match",
	);
	for (const f of ["src/main/main.js", "src/main/float-windows.js"]) {
		assert.equal(
			read(f).includes("setPanelVisible"),
			false,
			`${f} still resizes the window for the panel`,
		);
	}
});

test("every desk action is a message the server already knows", () => {
	const { CLIENT_MESSAGE_TYPES } = require("../src/main/websocket-server.js");
	const mainSrc = fs.readFileSync(
		path.resolve(__dirname, "..", "src/main/main.js"),
		"utf-8",
	);
	const block = /const DESK_ACTIONS = new Set\(\[([\s\S]*?)\]\);/.exec(
		mainSrc,
	);
	assert.ok(block, "DESK_ACTIONS must still be an explicit allowlist");
	const actions = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
	assert.ok(actions.length > 0);

	for (const action of actions) {
		assert.ok(
			action.startsWith("client-"),
			`${action} is not a client event name`,
		);
		assert.ok(
			CLIENT_MESSAGE_TYPES.has(action.slice("client-".length)),
			`${action} is on the desk allowlist but the server handles no such message`,
		);
	}
	assert.ok(
		actions.length < CLIENT_MESSAGE_TYPES.size,
		"the desk allowlist must stay narrower than the full message set",
	);
});

test("Auto-type arms the name and leaves the card open, with no OK beside it", () => {
	const { popup, sent } = build();
	popup.showMoveTo({ mode: "file", target: "style.css", typeName: true });

	assert.equal(
		byLabel(popup, "OK"),
		undefined,
		"typing the last character is what confirms; an OK would let it be skipped",
	);

	byLabel(popup, "Auto-type").click();
	assert.deepEqual(sent, [["client-move-to-type-name"]]);
	assert.equal(
		popup.isOpen("move-to"),
		true,
		"the card has to stay up: the name is typed one key at a time",
	);
});

test("the card titles a file-creating move-to as such", () => {
	const creating = build().popup;
	creating.showMoveTo({ mode: "file", target: "style.css", typeName: true });
	assert.equal(creating.el.children[0].textContent, "Create file:");

	const plain = build().popup;
	plain.showMoveTo({ mode: "file", target: "style.css" });
	assert.equal(plain.el.children[0].textContent, "Go to:");
});

test("a file move-to without Auto-type is just an OK", () => {
	const { popup } = build();
	popup.showMoveTo({ mode: "file", target: "style.css" });

	assert.equal(byLabel(popup, "Auto-type"), undefined);
	assert.ok(byLabel(popup, "OK"));

	const hints = [];
	const walk = (el) => {
		for (const c of el.children || []) {
			if (c.className === "desk-popup-hint") hints.push(c.textContent);
			walk(c);
		}
	};
	walk(popup.el);
	assert.deepEqual(hints, [], "the move-to card carries no hint");
});

test("a move-to with Auto-type switched off offers no Auto-type button", () => {
	const { popup } = build();
	popup.showMoveTo({ mode: "file", target: "style.css", typeName: false });

	assert.equal(byLabel(popup, "Auto-type"), undefined);
	assert.ok(byLabel(popup, "OK"), "OK is still the way out");
});

test("a later move-to to the same file offers nothing extra", () => {
	const { popup } = build();
	popup.showMoveTo({ mode: "file", target: "style.css" });
	assert.equal(
		byLabel(popup, "Auto-type"),
		undefined,
		"the payload decides; the surface must not re-derive it from mode alone",
	);
	assert.ok(byLabel(popup, "OK"));
});

test("a code insert with paste switched off drops the Ctrl+V hint", () => {
	const withPaste = build().popup;
	withPaste.showCodeInsert({ text: "x", colored: null });
	const hintOf = (p) =>
		(p.el.children || []).find((c) => c.className === "desk-popup-hint");
	assert.ok(hintOf(withPaste), "the hint is the desk's stand-in for Paste");

	const noPaste = build().popup;
	noPaste.showCodeInsert({ text: "x", colored: null, paste: false });
	assert.equal(hintOf(noPaste), undefined);
});

test("only terminating actions close the card", () => {
	const src = fs.readFileSync(
		path.resolve(__dirname, "..", "src/renderer/desk-popup.js"),
		"utf-8",
	);
	assert.match(
		/_act\(type, \.\.\.args\) \{[\s\S]*?\n\t\}/.exec(src)[0],
		/this\.close\(\)/,
		"_act is the closing sender",
	);
	assert.equal(
		/_send\(type, \.\.\.args\) \{[\s\S]*?\n\t\}/
			.exec(src)[0]
			.includes("close()"),
		false,
		"_send is the one that leaves the card up",
	);
	const moveTo = /showMoveTo\(\{[\s\S]*?\n\t\}/.exec(src)[0];
	assert.match(moveTo, /_send\("client-move-to-type-name"\)/);
	assert.match(moveTo, /_act\("client-move-to-confirmed"\)/);
});

test("the card shows the typed name as it advances", () => {
	const { popup } = build();
	popup.showMoveTo({ mode: "file", target: "style.css" });

	popup.setMoveToTyped({ target: "style.css", typed: 3 });
	const body = popup.el.children[1];
	assert.equal(
		body.children.map((c) => c.textContent).join(""),
		"style.css↩",
		"the return is shown as part of what gets typed",
	);
	assert.equal(body.children[3].className, "mt-modal-anchor-cursor");
});

test("the question card reveals itself when the confirm key shows the question", () => {
	const { popup, sent } = build();
	popup.showQuestion({ question: "q", options: ["a"], students: ["Ada"] });
	popup.revealQuestion();
	assert.equal(byLabel(popup, "Show"), undefined, "Show is spent");
	assert.notEqual(
		byLabel(popup, "🎲"),
		undefined,
		"the students can be picked",
	);
	assert.deepEqual(
		sent,
		[],
		"main already showed it; the card must not ask again",
	);
	popup.revealQuestion();
	assert.equal(
		buttons(popup).filter((b) => b.textContent === "🎲").length,
		1,
		"a second reveal changes nothing",
	);
});

test("a reveal aimed at a card that is gone does nothing", () => {
	const { popup } = build();
	popup.showQuestion({ question: "q", options: null, students: ["Ada"] });
	popup.close();
	popup.revealQuestion();
	popup.showNote({ text: "hi" });
	popup.revealQuestion();
	assert.equal(byLabel(popup, "🎲"), undefined);
});

const studentButtons = (popup) =>
	buttons(popup)
		.filter((b) => b.className.includes("popup-student-btn"))
		.map((b) => b.textContent);

test("the interaction picker lists students alphabetically, teacher last", () => {
	const { popup } = build();
	popup.setStudents(["Zoe", "ada", "Mo"]);
	popup.setTeacherName("Ms. Lee");
	popup.showInteraction("student-question");

	assert.deepEqual(studentButtons(popup), ["ada", "Mo", "Zoe", "Ms. Lee"]);
});

test("help (no question text box) still sorts, with no teacher entry", () => {
	const { popup } = build();
	popup.setStudents(["Zoe", "Ada", "Mo"]);
	popup.showInteraction("providing-help");

	assert.deepEqual(
		studentButtons(popup),
		["Ada", "Mo", "Zoe"],
		"providing-help never offers the teacher as a pick",
	);
});

test("picking a sorted student still reports the right roster index", () => {
	const { popup, sent } = build();
	popup.setStudents(["Zoe", "Ada", "Mo"]);
	popup.showInteraction("providing-help");

	byLabel(popup, "Mo").click();
	const [, interactionSent] = sent;
	assert.equal(interactionSent[0], "client-show-student-interaction");
	assert.equal(
		interactionSent[2],
		3,
		"Mo sits at raw index 2, so the 1-based roster id must be 3, " +
			"regardless of where it is drawn on screen",
	);
});

test("the question answer grid is sorted too", () => {
	const { popup } = build();
	popup.showQuestion({
		question: "q",
		options: null,
		students: ["Priya", "Ana", "Zed"],
	});
	assert.deepEqual(studentButtons(popup), ["Ana", "Priya", "Zed"]);
});
