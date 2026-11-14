"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadModule } = require("./helpers/load-module");

function buildMenu(state) {
	let built = null;
	const { createApplicationMenu } = loadModule("src/main/app-menu.js", {
		electron: {
			app: {},
			Menu: {
				buildFromTemplate: (template) => template,
				setApplicationMenu: (menu) => (built = menu),
			},
		},
		"./state": state,
		"./lesson-tools": {
			LESSON_TOOLS: [],
			getCourseMenuState: () => ({
				open: false,
				plans: [],
				currentPath: null,
			}),
			cachedToolAvailability: () => ({}),
			openSimulator() {},
			openLessonTool() {},
			launchChrome() {},
			launchVSCode() {},
		},
	});
	createApplicationMenu();
	return built;
}

test("Help ▸ About LEO shows the editor tip again", () => {
	let shown = 0;
	const menu = buildMenu({ send() {}, onShowAbout: () => shown++ });

	const help = menu.find((m) => m.label === "Help");
	assert.ok(help, "the menu bar has a Help menu, last");
	assert.equal(menu.at(-1), help);
	const about = help.submenu.find((i) => i.label === "About LEO");
	about.click();
	assert.equal(shown, 1);
});

test("About is not gated by the shown-once flag", () => {
	const main = fs.readFileSync(
		path.resolve(__dirname, "..", "src/main/main.js"),
		"utf-8",
	);
	assert.match(main, /state\.onShowAbout = \(\) => showEditorTip\(true\)/);

	const tip = /async function showEditorTip\(about\) \{[\s\S]*?\n\}/.exec(
		main,
	)[0];
	assert.equal(
		/editorTipSeen/.test(tip),
		false,
		"the flag belongs to the start-up tip alone",
	);
	const once = /async function showEditorTipOnce\(\) \{[\s\S]*?\n\}/.exec(
		main,
	)[0];
	assert.match(once, /editorTipSeen[\s\S]*showEditorTip\(false\)/);
});
