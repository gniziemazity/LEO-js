"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

test("the name renders with a cursor and a trailing return once armed", () => {
	const { renderTypedName } = require("../src/shared/excerpt-view");
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
	assert.equal(node.children[0].className, "excerpt-anchor-cursor");

	node.children = [];
	renderTypedName(node, "style.css", 3);
	assert.equal(node.children[3].className, "excerpt-anchor-cursor");
	assert.equal(node.children[2].className, "gto-name-typed");

	global.document = realDoc;
});
