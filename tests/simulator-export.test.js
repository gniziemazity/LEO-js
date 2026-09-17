"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
	exportFileEntries,
	mainExportName,
} = require("../lesson_tools/simulator/visualizer.js");

const f = (text) => ({ text });
const paths = (entries) => entries.map((e) => e.path);

test("mainExportName: web extensions get the index basename", () => {
	assert.equal(mainExportName(".html"), "index.html");
	assert.equal(mainExportName(".htm"), "index.htm");
	assert.equal(mainExportName(".css"), "index.css");
	assert.equal(mainExportName(".js"), "index.js");
	assert.equal(mainExportName(".ts"), "index.ts");
	assert.equal(mainExportName(".tsx"), "index.tsx");
	assert.equal(mainExportName(".json"), "index.json");
});

test("mainExportName: anything else gets the main basename", () => {
	assert.equal(mainExportName(".py"), "main.py");
	assert.equal(mainExportName(".md"), "main.md");
	assert.equal(mainExportName(".svg"), "main.svg");
});

test("mainExportName: a missing extension falls back to index.html", () => {
	assert.equal(mainExportName(null), "index.html");
	assert.equal(mainExportName(undefined), "index.html");
	assert.equal(mainExportName(""), "index.html");
});

test("mainExportName: the extension is matched case-insensitively", () => {
	assert.equal(mainExportName(".HTML"), "index.html");
	assert.equal(mainExportName(".PY"), "main.py");
});

test("exportFileEntries: MAIN takes the synthesized name, others keep theirs", () => {
	const entries = exportFileEntries(
		{ MAIN: f("<html>"), "app.js": f("let x;"), "style.css": f("p{}") },
		"index.html",
	);
	assert.deepEqual(paths(entries), ["app.js", "index.html", "style.css"]);
	assert.equal(entries.find((e) => e.path === "index.html").text, "<html>");
	assert.equal(entries.find((e) => e.path === "app.js").text, "let x;");
});

test("exportFileEntries: an empty MAIN is dropped", () => {
	const entries = exportFileEntries(
		{ MAIN: f(""), "app.js": f("let x;") },
		"index.html",
	);
	assert.deepEqual(paths(entries), ["app.js"]);
});

test("exportFileEntries: a named file that is empty is still written", () => {
	const entries = exportFileEntries(
		{ MAIN: f("<html>"), "notes.md": f("") },
		"index.html",
	);
	assert.deepEqual(paths(entries), ["index.html", "notes.md"]);
	assert.equal(entries.find((e) => e.path === "notes.md").text, "");
});

test("exportFileEntries: a nested move-to target stays nested", () => {
	const entries = exportFileEntries(
		{ MAIN: f("<html>"), "js/app.js": f("let x;") },
		"index.html",
	);
	assert.deepEqual(paths(entries), ["index.html", "js/app.js"]);
});

test("exportFileEntries: a multi-level path keeps every segment", () => {
	const entries = exportFileEntries(
		{
			MAIN: f("<html>"),
			"src/index.ts": f("export const n = 1;"),
			"src/lib/util.ts": f("export const u = 2;"),
			"styles/main.css": f("body{}"),
		},
		"index.html",
	);
	assert.deepEqual(paths(entries), [
		"index.html",
		"src/index.ts",
		"src/lib/util.ts",
		"styles/main.css",
	]);
});

test("exportFileEntries: a nested path may share a basename with MAIN", () => {
	const entries = exportFileEntries(
		{ MAIN: f("<h1>hi</h1>"), "src/index.ts": f("export const n = 1;") },
		"index.ts",
	);
	assert.deepEqual(paths(entries), ["index.ts", "src/index.ts"]);
	assert.equal(entries[0].text, "<h1>hi</h1>");
	assert.equal(entries[1].text, "export const n = 1;");
});

test("exportFileEntries: backslashes are normalized to forward slashes", () => {
	const entries = exportFileEntries(
		{ "js\\app.js": f("let x;") },
		"index.html",
	);
	assert.deepEqual(paths(entries), ["js/app.js"]);
});

test("exportFileEntries: a path that escapes the picked folder is rejected", () => {
	const entries = exportFileEntries(
		{
			MAIN: f("<html>"),
			"../evil.js": f("bad"),
			"a/../../evil.js": f("bad"),
			"/abs.js": f("bad"),
			"C:\\win.js": f("bad"),
			"./here.js": f("bad"),
			"a//b.js": f("bad"),
		},
		"index.html",
	);
	assert.deepEqual(paths(entries), ["index.html"]);
});

test("exportFileEntries: DEV is never a key, but nothing is special-cased away", () => {
	const entries = exportFileEntries({ "notes.txt": f("hi") }, "index.html");
	assert.deepEqual(paths(entries), ["notes.txt"]);
});

test("exportFileEntries: no files yields no entries", () => {
	assert.deepEqual(exportFileEntries({}, "index.html"), []);
	assert.deepEqual(exportFileEntries(null, "index.html"), []);
	assert.deepEqual(exportFileEntries({ MAIN: f("") }, "index.html"), []);
});
