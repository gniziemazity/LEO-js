"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadModule, fakeIpcRenderer } = require("./helpers/load-module");

function makeTextNode(data) {
	return { nodeType: 3, data, length: data.length, parentElement: null };
}

function makeEl(children, { island = false } = {}) {
	const el = {
		nodeType: 1,
		dataset: island ? { blockOpt: "1" } : {},
		children: [],
		closest(sel) {
			if (sel === "[data-block-opt]") {
				for (let n = this; n; n = n._parent) {
					if (n.dataset && n.dataset.blockOpt) return n;
				}
				return null;
			}
			return null;
		},
	};
	for (const c of children) {
		if (c.nodeType === 3) c.parentElement = el;
		else c._parent = el;
		el.children.push(c);
	}
	return el;
}

function flattenTextNodes(root) {
	const out = [];
	const walk = (n) => {
		if (n.nodeType === 3) out.push(n);
		else for (const c of n.children || []) walk(c);
	};
	walk(root);
	return out;
}

function withFakeDom(el, pointToNodeOffset, body) {
	const savedDoc = global.document;
	const savedNode = global.Node;
	const savedFilter = global.NodeFilter;
	global.Node = { TEXT_NODE: 3 };
	global.NodeFilter = { SHOW_TEXT: 4 };
	global.document = {
		caretRangeFromPoint: (x, y) => {
			const hit = pointToNodeOffset(x, y);
			if (!hit) return null;
			return { startContainer: hit.node, startOffset: hit.offset };
		},
		createTreeWalker: (root) => {
			const nodes = flattenTextNodes(root);
			let i = -1;
			return {
				nextNode() {
					i++;
					return i < nodes.length ? nodes[i] : null;
				},
			};
		},
	};
	try {
		return body();
	} finally {
		global.document = savedDoc;
		global.Node = savedNode;
		global.NodeFilter = savedFilter;
	}
}

function renderer() {
	const LessonRenderer = loadModule("src/renderer/lesson-renderer.js", {
		electron: fakeIpcRenderer().stub,
		"./anchor-snippet": { computeMoveToSnippets: () => new Map() },
		"../shared/code-text": {},
		"../shared/move-to-target": {},
		"./move-to-dropdown": {},
		"./block-types": {},
		"../shared/blocks": {},
	});
	return new LessonRenderer({}, {}, {}, null);
}

test("a point inside plain text round-trips to the exact same offset", () => {
	const t1 = makeTextNode("hello ");
	const t2 = makeTextNode("world");
	const el = makeEl([t1, t2]);

	withFakeDom(
		el,
		() => ({ node: t2, offset: 3 }),
		() => {
			const r = renderer();
			const offset = r._offsetAtPoint(el, 0, 0);
			assert.equal(
				offset,
				6 + 3,
				"expected the offset within t2 to add to t1's length",
			);

			const sel = {
				removeAllRanges() {},
				addRange(range) {
					assert.equal(range._node, t2);
					assert.equal(range._offset, 3);
				},
			};
			const savedGetSelection = global.window;
			global.window = { getSelection: () => sel };
			const savedRange = global.document.createRange;
			global.document.createRange = () => ({
				_node: null,
				_offset: null,
				setStart(node, offset) {
					this._node = node;
					this._offset = offset;
				},
				collapse() {},
			});
			r._placeCaret(el, offset);
			global.document.createRange = savedRange;
			global.window = savedGetSelection;
		},
	);
});

test("a click inside an island is not counted toward the offset", () => {
	const before = makeTextNode("AB");
	const islandText = makeTextNode("ignore-me");
	const island = makeEl([islandText], { island: true });
	const after = makeTextNode("CD");
	const el = makeEl([before, island, after]);

	withFakeDom(
		el,
		() => ({ node: after, offset: 1 }),
		() => {
			const r = renderer();
			const offset = r._offsetAtPoint(el, 0, 0);
			// "AB" (2) + "CD"[0:1] = offset 3 - the island's text must not count
			assert.equal(offset, 3);
		},
	);
});

test("caretRangeFromPoint landing on a non-text node yields no usable offset", () => {
	const el = makeEl([makeTextNode("x")]);
	withFakeDom(
		el,
		() => ({ node: { nodeType: 1 }, offset: 0 }),
		() => {
			const r = renderer();
			assert.equal(r._offsetAtPoint(el, 0, 0), null);
		},
	);
});

test("no caretRangeFromPoint support falls back to null, not a throw", () => {
	const el = makeEl([makeTextNode("x")]);
	const savedDoc = global.document;
	global.document = { caretRangeFromPoint: undefined };
	try {
		const r = renderer();
		assert.equal(r._offsetAtPoint(el, 0, 0), null);
	} finally {
		global.document = savedDoc;
	}
});
