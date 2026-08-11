const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ALTER_EGO_POOL, assignAlterEgos } = require("../src/shared/alter-egos");

test("pool is stored alphabetically sorted", () => {
	const sorted = ALTER_EGO_POOL.slice().sort((a, b) => a.localeCompare(b));
	assert.deepEqual(ALTER_EGO_POOL, sorted);
});

test("assigns one unique alter ego per student", () => {
	const names = ["Anna", "Bob", "Cara", "Dan"];
	const result = assignAlterEgos(names);
	assert.equal(result.length, names.length);
	assert.deepEqual(
		result.map((r) => r.name),
		names,
	);
	const egos = result.map((r) => r.alterEgo);
	assert.equal(new Set(egos).size, egos.length, "alter egos must be unique");
	for (const ego of egos) {
		assert.ok(ALTER_EGO_POOL.includes(ego));
	}
});

test("overflow students get Alter_Ego_N names", () => {
	const names = Array.from(
		{ length: ALTER_EGO_POOL.length + 3 },
		(_, i) => `Student ${i}`,
	);
	const result = assignAlterEgos(names);
	assert.equal(result.length, names.length);

	const egos = result.map((r) => r.alterEgo);
	assert.equal(new Set(egos).size, egos.length, "alter egos must be unique");

	const overflow = egos.filter((e) => /^Alter_Ego_\d+$/.test(e)).sort();
	assert.deepEqual(overflow, ["Alter_Ego_1", "Alter_Ego_2", "Alter_Ego_3"]);

	for (const hero of ALTER_EGO_POOL) {
		assert.ok(egos.includes(hero), `every hero used: ${hero}`);
	}
});

test("empty input yields empty assignment", () => {
	assert.deepEqual(assignAlterEgos([]), []);
});
