"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");

const sent = [];
const realResolve = Module._resolveFilename;
const stubId = path.resolve(__dirname, "..", "src/renderer/__electron_stub__");
require.cache[stubId] = {
	id: stubId,
	filename: stubId,
	loaded: true,
	exports: { ipcRenderer: { on() {}, send: (ch, a) => sent.push([ch, a]) } },
};
Module._resolveFilename = function (request, ...rest) {
	if (request === "electron") return stubId;
	return realResolve.call(this, request, ...rest);
};
const CursorManager = require("../src/renderer/cursor-manager");
Module._resolveFilename = realResolve;

function fakeElement() {
	const classes = new Set();
	return {
		classList: {
			add: (...c) => c.forEach((x) => classes.add(x)),
			remove: (...c) => c.forEach((x) => classes.delete(x)),
			contains: (c) => classes.has(c),
		},
		scrollIntoView() {},
		_classes: classes,
	};
}

function buildSteps() {
	const steps = [];
	const push = (step) => {
		step.element = fakeElement();
		step.globalIndex = steps.length;
		steps.push(step);
	};
	for (const ch of "let a = 1;") push({ type: "char", char: ch });
	push({ type: "anchor", value: "3" });
	for (const ch of "more();") push({ type: "char", char: ch });
	push({ type: "block", kind: "code", text: "", blockIndex: 1 });
	for (const ch of "tail();") push({ type: "char", char: ch });
	return steps;
}

function manager(steps) {
	const cm = new CursorManager(
		{ updateProgressBar() {}, removeCursorClasses() {} },
		{ addEntry: () => ({}) },
	);
	cm.setExecutionSteps(steps);
	return cm;
}

function marks(steps) {
	return steps.map((s) =>
		["cursor", "consumed", "active-block"]
			.filter((c) => s.element.classList.contains(c))
			.sort()
			.join("+"),
	);
}

test("stepping one at a time lands exactly where jumpTo would", () => {
	const walk = [1, 2, 3, 2, 1, 0, 1, 2, 3, 4, 5, 4, 3];

	const stepped = manager(buildSteps());
	const jumped = manager(buildSteps());

	let at = 0;
	for (const target of walk) {
		const delta = target - at;
		for (let i = 0; i < Math.abs(delta); i++) {
			if (delta > 0) stepped.stepForward();
			else stepped.stepBackward();
		}
		at = target;

		jumped.jumpTo(target);

		assert.equal(
			stepped.getCurrentStep(),
			jumped.getCurrentStep(),
			`index diverged heading to ${target}`,
		);
		assert.deepEqual(
			marks(stepped.executionSteps),
			marks(jumped.executionSteps),
			`classes diverged at step ${target}`,
		);
	}
});

test("stepping back onto an anchor logs it again, exactly as a jump does", () => {
	const build = () => {
		const steps = buildSteps();
		const logged = [];
		const cm = new CursorManager(
			{ updateProgressBar() {}, removeCursorClasses() {} },
			{
				addEntry: (e) => {
					logged.push(e);
					return e;
				},
			},
		);
		cm.setExecutionSteps(steps);
		return { steps, cm, logged };
	};

	const anchorIdx = buildSteps().findIndex((s) => s.type === "anchor");

	const stepped = build();
	stepped.cm.jumpTo(anchorIdx + 1);
	stepped.logged.length = 0;
	stepped.cm.stepBackward();

	const jumped = build();
	jumped.cm.jumpTo(anchorIdx + 1);
	jumped.logged.length = 0;
	jumped.cm.jumpTo(anchorIdx);

	assert.deepEqual(
		stepped.logged,
		jumped.logged,
		"stepping back writes a different keylog than jumping back",
	);
	assert.ok(
		stepped.logged.some((e) => e.anchor !== undefined),
		"the anchor was silently skipped in the keylog on the way through again",
	);
});

test("a single step does not sweep the whole lesson", () => {
	const steps = buildSteps();
	const cm = manager(steps);
	cm.jumpTo(3);

	let touched = 0;
	for (const s of steps) {
		const add = s.element.classList.add;
		const remove = s.element.classList.remove;
		s.element.classList.add = (...a) => {
			touched++;
			return add(...a);
		};
		s.element.classList.remove = (...a) => {
			touched++;
			return remove(...a);
		};
	}

	cm.stepForward();

	assert.ok(
		touched <= 4,
		`one step rewrote ${touched} class lists across ${steps.length} steps`,
	);
});

test("the cursor mark moves without scanning the document", () => {
	const steps = buildSteps();
	let scans = 0;
	const cm = new CursorManager(
		{
			updateProgressBar() {},
			removeCursorClasses() {
				scans++;
			},
		},
		{ addEntry: () => ({}) },
	);
	cm.setExecutionSteps(steps);

	cm.jumpTo(2);
	cm.stepForward();
	cm.stepForward();

	assert.equal(
		scans,
		0,
		"updateCursor still falls back to a document-wide scan",
	);
	assert.equal(marks(steps)[4], "cursor");
	assert.equal(marks(steps)[3], "consumed");
});
