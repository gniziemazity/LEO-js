"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const SettingsUI = require(
	path.resolve(__dirname, "..", "src/renderer/settings-ui.js"),
);

function selectStub(id, hardcoded) {
	const options = (hardcoded || []).map((v) => ({ value: v }));
	return {
		id,
		options,
		_value: "",
		get value() {
			return this._value;
		},
		set value(v) {
			this._value = options.some((o) => o.value === v) ? v : "";
		},
		querySelector(sel) {
			const want = /option\[value="(.*)"\]/.exec(sel)[1];
			return options.find((o) => o.value === want) || null;
		},
		appendChild(opt) {
			options.push(opt);
		},
	};
}

function withDom(selects, body) {
	const saved = { document: global.document, ...pickGlobals() };
	global.document = {
		getElementById: (id) => selects[id] || null,
		createElement: () => ({ value: "", textContent: "" }),
	};
	try {
		return body();
	} finally {
		global.document = saved.document;
		restoreGlobals(saved);
	}
}

const LIST_GLOBALS = ["listThemes", "listRandomizers", "listEffects"];
function pickGlobals() {
	const out = {};
	for (const g of LIST_GLOBALS) out[g] = global[g];
	return out;
}
function restoreGlobals(saved) {
	for (const g of LIST_GLOBALS) {
		if (saved[g] === undefined) delete global[g];
		else global[g] = saved[g];
	}
}

const CASES = [
	["floatingTheme", "listThemes", ["solid"], "solid"],
	["randomizerStyle", "listRandomizers", [], "shuffle"],
	["answerEffect", "listEffects", ["none"], "fireworks"],
];

test("each registry select is filled from its own registry", () => {
	const selects = {};
	for (const [id, , hardcoded] of CASES)
		selects[id] = selectStub(id, hardcoded);
	withDom(selects, () => {
		global.listThemes = () => ["solid", "dragonball"];
		global.listRandomizers = () => ["shuffle", "spinner"];
		global.listEffects = () => ["none", "fireworks"];
		new SettingsUI().applyRegistrySelects({});
	});
	assert.deepEqual(
		selects.floatingTheme.options.map((o) => o.value),
		["solid", "dragonball"],
		"the hardcoded option is kept, the registered one added",
	);
	assert.deepEqual(
		selects.randomizerStyle.options.map((o) => o.value),
		["shuffle", "spinner"],
	);
	assert.deepEqual(
		selects.answerEffect.options.map((o) => o.value),
		["none", "fireworks"],
	);
});

test("a saved value that no longer exists falls back to the first option", () => {
	for (const [id, listName, hardcoded] of CASES) {
		const selects = { [id]: selectStub(id, hardcoded) };
		withDom(selects, () => {
			for (const [otherId, otherList] of CASES.map((c) => [c[0], c[1]]))
				global[otherList] = () => (otherId === id ? ["alpha", "beta"] : []);
			new SettingsUI().applyRegistrySelects({ [id]: "a-removed-plugin" });
		});
		assert.ok(
			selects[id].value,
			id + " must not be left blank when its saved value is gone",
		);
		assert.equal(
			selects[id].value,
			selects[id].options[0].value,
			id + " falls back to the first option it does have",
		);
	}
});

test("a saved value that still exists is honoured", () => {
	const selects = { floatingTheme: selectStub("floatingTheme", ["solid"]) };
	withDom(selects, () => {
		global.listThemes = () => ["solid", "dragonball"];
		global.listRandomizers = () => [];
		global.listEffects = () => [];
		new SettingsUI().applyRegistrySelects({ floatingTheme: "dragonball" });
	});
	assert.equal(selects.floatingTheme.value, "dragonball");
});

test("save reads all three back, and defaults each when its select is absent", () => {
	const present = { floatingTheme: selectStub("floatingTheme", ["solid"]) };
	let values;
	withDom(present, () => {
		global.listThemes = () => ["solid"];
		global.listRandomizers = () => [];
		global.listEffects = () => [];
		const ui = new SettingsUI();
		ui.applyRegistrySelects({});
		values = ui.registrySelectValues();
	});
	assert.deepEqual(values, {
		floatingTheme: "solid",
		randomizerStyle: "shuffle",
		answerEffect: "fireworks",
	});
});

test("the three selects are declared once, not open-coded three times", () => {
	const src = fs.readFileSync(
		path.resolve(__dirname, "..", "src/renderer/settings-ui.js"),
		"utf-8",
	);
	assert.equal(
		(src.match(/charAt\(0\)\.toUpperCase\(\)/g) || []).length,
		1,
		"one option-building loop, not one per registry",
	);
	for (const [id] of CASES)
		assert.equal(
			(src.match(new RegExp('"' + id + '"', "g")) || []).length,
			1,
			id + " should be named once, in the table",
		);
	assert.match(
		src,
		/\.\.\.this\.registrySelectValues\(\)/,
		"save() builds the three keys from the same table",
	);
});
