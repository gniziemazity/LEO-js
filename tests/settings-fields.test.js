"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
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
