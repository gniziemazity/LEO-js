"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MAIN = path.resolve(__dirname, "..", "src/main");
const read = (p) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf-8");

test("the host types the name from its own state, never from the message", () => {
	const src = fs.readFileSync(path.join(MAIN, "popups.js"), "utf-8");
	const chars = /function moveToNameChars\(\)[\s\S]*?\n\}/.exec(src)[0];
	const step = /async function typeNextNameChar\(\)[\s\S]*?\n\}/.exec(src)[0];

	assert.match(
		chars,
		/openPayload && openPayload\.target/,
		"the name must come from the payload the renderer sent",
	);
	assert.match(chars, /openPopup !== "move-to"/, "only while a move-to is up");
	assert.match(chars, /isFileName\(target\)/, "and only for a real filename");
	assert.match(
		src,
		/async function typeNextNameChar\(\) \{/,
		"it must take no argument, so there is nothing for a client to supply",
	);
	assert.match(step, /keyboard\.type\(ch\)/, "one queued character per press");
	assert.match(chars, /Key\.Enter/, "and Enter closes the New File input");
});

test("the message carries no payload, and the desk may raise it", () => {
	const server = fs.readFileSync(
		path.join(MAIN, "websocket-server.js"),
		"utf-8",
	);
	const bare = /const BARE_CLIENT_MESSAGES = \[([\s\S]*?)\];/.exec(server)[1];
	assert.match(
		bare,
		/"move-to-type-name"/,
		"a bare message forwards nothing, which is the point",
	);

	const main = fs.readFileSync(path.join(MAIN, "main.js"), "utf-8");
	assert.match(
		main,
		/"client-move-to-type-name",\s*\(\) => armMoveToName\(\)/,
	);
	const desk = /const DESK_ACTIONS = new Set\(\[([\s\S]*?)\]\);/.exec(main)[1];
	assert.match(
		desk,
		/"client-move-to-type-name"/,
		"the desk card raises the same event as the phone",
	);
});

test("the popup releases the name when it closes", () => {
	const src = fs.readFileSync(path.join(MAIN, "popups.js"), "utf-8");
	const end = /function endPopup\(kind\)[\s\S]*?\n\}/.exec(src)[0];
	assert.match(
		end,
		/openPayload = null/,
		"a stale payload would let the key type into the next popup",
	);
});

test("both surfaces gate the button on the payload, not on mode alone", () => {
	const phone = read("src/shared/remote/move-to-overlay.js");
	assert.match(phone, /this\.canTypeName = mode === "file" && !!typeName/);
	assert.match(phone, /typeBtn\.style\.display = this\.canTypeName/);
	assert.match(
		phone,
		/okBtn\.style\.display = this\.canTypeName \? "none" : ""/,
		"while the name must be typed there is no OK to skip it with",
	);
	assert.match(
		phone,
		/sendMessage\("move-to-type-name", \{\}\)/,
		"the phone sends no text",
	);

	const desk = read("src/renderer/desk-popup.js");
	const fn =
		/showMoveTo\(\{ mode, target, snippet, typeName \}\)[\s\S]*?\n\t\}/.exec(
			desk,
		)[0];
	assert.match(fn, /const canTypeName = mode === "file" && !!typeName/);
	assert.match(fn, /client-move-to-type-name/);
});

test("a pad covering the popup takes the whole action row, not just the OK", () => {
	const phone = read("src/shared/remote/move-to-overlay.js");
	const fn = /setPadCovered\(covered\)[\s\S]*?\n\t\}/.exec(phone)[0];
	assert.match(
		fn,
		/mtoActions/,
		"hiding only mtoConfirm would leave a second Type name under the pad",
	);
	assert.equal(
		/mtoConfirm/.test(fn),
		false,
		"the row is what gets hidden now",
	);
});

test("the typed filename is kept out of the keylog", () => {
	const src = fs.readFileSync(path.join(MAIN, "popups.js"), "utf-8");
	const fn = /async function typeNextNameChar\(\)[\s\S]*?\n\}/.exec(src)[0];
	assert.equal(
		/addEntry|logManager|log\(/.test(fn),
		false,
		"these keystrokes go to the editor's New File input, not into a file",
	);
});

test("a logged filename would corrupt the file that happens to be open", () => {
	const dir = path.resolve(__dirname, "..", "lesson_tools", "shared");
	const bundle = ["text-state.js", "simulator-model.js", "simulator-replay.js"]
		.map((f) => fs.readFileSync(path.join(dir, f), "utf-8"))
		.join("\n");
	const { headlessReplay } = new Function(
		"window",
		"module",
		bundle + "\nreturn { headlessReplay };",
	)({}, undefined);

	const typed = (s, from) =>
		[...s].map((c, i) => ({ char: c, timestamp: from + i }));

	const real = headlessReplay([
		{ move_to: "style.css", timestamp: 0 },
		...typed("body{}", 1),
	]);
	assert.equal(real.files.get("MAIN").text, "");
	assert.equal(real.files.get("style.css").text, "body{}");

	const withFilename = headlessReplay([
		...typed("style.css\n", 0),
		{ move_to: "style.css", timestamp: 10 },
		...typed("body{}", 11),
	]);
	assert.equal(
		withFilename.files.get("MAIN").text,
		"style.css\n",
		"which is why the move-to alone records the file, and the keys are not logged",
	);
});

test("the letter hotkeys are released while the filename is typed", () => {
	const src = fs.readFileSync(path.join(MAIN, "popups.js"), "utf-8");
	const fn = /async function typeNextNameChar\(\)[\s\S]*?\n\}/.exec(src)[0];

	assert.match(
		fn,
		/hotkeyManager\.unregisterTypingHotkeys\(\)/,
		"a-z are global accelerators while a lesson runs, so LEO eats its own keys",
	);
	assert.match(fn, /hotkeyManager\.registerTypingHotkeys\(\)/);
	assert.ok(
		fn.indexOf(".unregisterTypingHotkeys") < fn.indexOf("keyboard.type"),
		"released before typing",
	);
	assert.ok(
		fn.indexOf("keyboard.type") < fn.indexOf(".registerTypingHotkeys"),
		"and taken back after",
	);
	assert.match(
		fn,
		/\} finally \{/,
		"a throw mid-type must not leave the lesson without its hotkeys",
	);
});

test("keyboard-handler wraps its own typing the same way", () => {
	const kb = fs.readFileSync(path.join(MAIN, "keyboard-handler.js"), "utf-8");
	assert.match(
		kb,
		/unregisterKey\(charLower\)[\s\S]*?typeWithNutJs\(char\)[\s\S]*?registerKey\(charLower\)/,
		"this is the pattern typeNextNameChar has to follow",
	);
});

test("Auto-type arms a queue; it does not type the whole name at once", () => {
	const src = fs.readFileSync(path.join(MAIN, "popups.js"), "utf-8");
	const arm = /function armMoveToName\(\)[\s\S]*?\n\}/.exec(src)[0];
	assert.equal(
		/keyboard\.type/.test(arm),
		false,
		"arming must not type anything; each press types one character",
	);
	assert.match(arm, /pendingName = \{ chars, index: 0/);

	const step = /async function typeNextNameChar\(\)[\s\S]*?\n\}/.exec(src)[0];
	assert.match(step, /pendingName\.index \+= 1/, "one character per call");
	assert.match(
		step,
		/pendingName\.busy/,
		"a second press mid-keystroke must not double-type",
	);
});

test("an armed name consumes advance keys before the pause swallows them", () => {
	const hk = fs.readFileSync(path.join(MAIN, "hotkey-manager.js"), "utf-8");
	const fn = /handleKey\(letter\) \{[\s\S]*?\n\t\}/.exec(hk)[0];
	assert.ok(
		fn.indexOf("state.onPopupKey") < fn.indexOf("state.isPaused"),
		"a move-to popup pauses, so the hook has to run before that check",
	);
	const main = fs.readFileSync(path.join(MAIN, "main.js"), "utf-8");
	assert.match(
		main,
		/if \(!hasPendingName\(\)\) return false;/,
		"and it must answer synchronously, or every key is swallowed",
	);
});

test("the name renders with a cursor and a trailing return once armed", () => {
	const { renderTypedName } = require("../src/shared/snippet-view");
	const spans = () => [...node.children].map((c) => c.textContent);
	let node;

	const fakeDoc = {
		createElement: () => ({
			children: [],
			set className(v) {
				this._cls = v;
			},
			get className() {
				return this._cls;
			},
		}),
	};
	const realDoc = global.document;
	global.document = fakeDoc;
	node = {
		children: [],
		innerHTML: "",
		textContent: "",
		appendChild(c) {
			this.children.push(c);
		},
	};

	renderTypedName(node, "style.css", null);
	assert.equal(
		node.textContent,
		"style.css",
		"unarmed: plain name, no return",
	);
	assert.equal(node.children.length, 0);

	node.children = [];
	renderTypedName(node, "style.css", 0);
	assert.deepEqual(
		spans().join(""),
		"style.css↩",
		"armed: name plus the return",
	);
	assert.equal(node.children[0].className, "mt-modal-anchor-cursor");

	node.children = [];
	renderTypedName(node, "style.css", 3);
	assert.equal(node.children[3].className, "mt-modal-anchor-cursor");
	assert.equal(node.children[2].className, "mto-name-typed");

	global.document = realDoc;
});
