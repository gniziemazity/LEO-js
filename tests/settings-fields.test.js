"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SettingsUI = require(
	path.resolve(__dirname, "..", "src/renderer/settings-ui.js"),
);
const SettingsManager = require(
	path.resolve(__dirname, "..", "src/main/settings-manager.js"),
);

function withDom(inputs, body) {
	const saved = global.document;
	global.document = {
		getElementById: (id) => inputs[id] || null,
		createElement: () => ({ value: "", textContent: "" }),
	};
	try {
		return body();
	} finally {
		global.document = saved;
	}
}

function inputsFor(fields) {
	const inputs = {};
	for (const [id] of fields) inputs[id] = { id, value: "" };
	return inputs;
}

const ui = new SettingsUI();
const COLOR_FIELDS = ui.constructor.COLOR_FIELDS;
const HOTKEY_FIELDS = ui.constructor.HOTKEY_FIELDS;

test("every colour the defaults ship has an input and a round trip", () => {
	const defaults = new SettingsManager().defaultSettings.colors;
	const inputs = inputsFor(COLOR_FIELDS);

	withDom(inputs, () => {
		ui._applyFields(COLOR_FIELDS, defaults);
		for (const [id, key] of COLOR_FIELDS) {
			assert.equal(
				inputs[id].value,
				defaults[key],
				`${id} must load from colors.${key}`,
			);
		}
		assert.deepEqual(
			ui._fieldValues(COLOR_FIELDS),
			defaults,
			"and saving must give back exactly what was loaded",
		);
	});
});

test("every hotkey round trips too", () => {
	const defaults = new SettingsManager().defaultSettings.hotkeys;
	const inputs = inputsFor(HOTKEY_FIELDS);

	withDom(inputs, () => {
		ui._applyFields(HOTKEY_FIELDS, defaults);
		const saved = ui._fieldValues(HOTKEY_FIELDS);
		for (const [, key] of HOTKEY_FIELDS) {
			assert.equal(saved[key], defaults[key]);
		}
	});
});

test("no colour in the defaults is missing from the modal", () => {
	const defaults = new SettingsManager().defaultSettings.colors;
	const covered = new Set(COLOR_FIELDS.map(([, key]) => key));
	for (const key of Object.keys(defaults)) {
		assert.ok(covered.has(key), `colors.${key} has no input to edit it`);
	}
});

test("a missing input is skipped rather than overwriting the setting", () => {
	withDom({}, () => {
		assert.deepEqual(ui._fieldValues(COLOR_FIELDS), {});
	});
});

test("the schema, the markup and the stylesheet name the same settings", () => {
	const {
		COLOR_SETTINGS,
		HOTKEY_SETTINGS,
	} = require("../src/shared/settings-schema");
	const read = (p) =>
		fs.readFileSync(path.resolve(__dirname, "..", p), "utf-8");

	const html = read("src/index.html");
	for (const c of COLOR_SETTINGS) {
		assert.ok(
			html.includes(`type="color" id="${c.domId}"`),
			`index.html has no colour input for ${c.key} (#${c.domId})`,
		);
	}
	for (const h of HOTKEY_SETTINGS) {
		assert.ok(
			html.includes(`id="${h.domId}"`),
			`index.html has no hotkey input for ${h.key} (#${h.domId})`,
		);
	}

	const css = read("src/shared/blocks.js");
	for (const c of COLOR_SETTINGS) {
		assert.ok(
			css.includes(`c.${c.key}`),
			`buildSettingsCSS never uses the ${c.key} colour`,
		);
	}
});

test("defaults come from the schema, not a second transcription", () => {
	const {
		COLOR_SETTINGS,
		HOTKEY_SETTINGS,
	} = require("../src/shared/settings-schema");
	const SettingsManager = require("../src/main/settings-manager");
	const defaults = new SettingsManager().defaultSettings;

	for (const c of COLOR_SETTINGS) {
		assert.equal(defaults.colors[c.key], c.value, c.key);
	}
	for (const h of HOTKEY_SETTINGS) {
		assert.equal(defaults.hotkeys[h.key], h.value, h.key);
	}
	assert.equal(
		Object.keys(defaults.colors).length,
		COLOR_SETTINGS.length,
		"a colour exists in the defaults that the schema does not name",
	);
});

test("reset and getAll never hand out the defaults themselves", () => {
	const sm = new SettingsManager();
	sm.save = () => true;

	const key = Object.keys(sm.defaultSettings.colors)[0];
	const pristine = sm.defaultSettings.colors[key];

	sm.reset();
	assert.notEqual(
		sm.settings.colors,
		sm.defaultSettings.colors,
		"reset() aliased the defaults instead of copying them",
	);

	sm.set(`colors.${key}`, "#abcdef");
	assert.equal(
		sm.defaultSettings.colors[key],
		pristine,
		"set() wrote through into defaultSettings",
	);

	sm.reset();
	assert.equal(
		sm.settings.colors[key],
		pristine,
		"reset to defaults did not restore the shipped colour",
	);

	const copy = sm.getAll();
	copy.colors[key] = "#000000";
	assert.equal(
		sm.settings.colors[key],
		pristine,
		"getAll() handed out a live reference to the settings",
	);
});

test("a first run with no settings file does not alias the defaults", () => {
	const sm = new SettingsManager();
	sm.save = () => true;
	sm.settings = sm.load.call({
		settingsPath: path.join(__dirname, "no-such-settings.json"),
		defaults: () => sm.defaults(),
		defaultSettings: sm.defaultSettings,
	});

	assert.notEqual(sm.settings.colors, sm.defaultSettings.colors);
	assert.notEqual(sm.settings.hotkeys, sm.defaultSettings.hotkeys);
	assert.notEqual(
		sm.settings.hotkeys.typing,
		sm.defaultSettings.hotkeys.typing,
		"the typing hotkey array is shared with the defaults",
	);
});
