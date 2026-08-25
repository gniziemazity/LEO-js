"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO = path.resolve(__dirname, "..");
const LP = require(path.join(REPO, "lesson_tools/languages/profiles.js"));

const DOM_STUB = `
"use strict";
const document = {
	documentElement: {},
	body: { classList: { add() {}, remove() {} } },
	getElementById: () => null,
	createElement: () => ({ style: {} }),
	addEventListener() {},
};
function getComputedStyle() {
	return { getPropertyValue: () => "" };
}
const window = { addEventListener() {}, location: { search: "" } };
const localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const navigator = { userAgent: "" };
`;

function loadLangShortId() {
	const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf-8");
	return new Function(`
		${DOM_STUB}
		${read("lesson_tools/shared/tooltip.js")}
		${read("lesson_tools/shared/diff-utils.js")}
		return langShortId;
	`)();
}

const langShortId = loadLangShortId();

const { buildHighlightSpans } = require(
	path.join(REPO, "lesson_tools/shared/simulator-highlight.js"),
);

async function ready() {
	await LP.initProfiles();
	global.window = { LanguageProfiles: LP };
}

const TS_SRC = [
	"interface User {",
	"\tname: string;",
	"\tage: number;",
	"}",
	"",
	"// greet everyone",
	"export function greet(u: User): string {",
	"\tconst msg = `hi ${u.name}`;",
	"\tconsole.log(msg);",
	"\treturn msg;",
	"}",
].join("\n");

function spansFor(filename, src = TS_SRC) {
	const spans = buildHighlightSpans(src, langShortId(filename));
	const byCls = {};
	for (const s of spans) {
		(byCls[s.cls] = byCls[s.cls] || []).push(src.slice(s.start, s.end));
	}
	return byCls;
}

test("a .ts file is routed to the typescript profile, not to HTML", async () => {
	await ready();
	assert.equal(langShortId("main.ts"), "ts");
	assert.equal(langShortId("app.tsx"), "ts");
	assert.equal(
		langShortId("main.ts", null),
		"ts",
		"and it must not depend on the fallback",
	);
});

test("TypeScript source highlights the way JavaScript source does", async () => {
	await ready();
	const ts = spansFor("main.ts");

	assert.deepEqual(ts.hl_comment, ["// greet everyone"]);
	assert.deepEqual(ts.hl_string, ["`hi ${u.name}`"]);
	assert.deepEqual(ts.hl_func, ["greet", "log"]);
	for (const w of ["export", "function", "const", "return"]) {
		assert.ok(ts.hl_keyword.includes(w), `${w} must read as a keyword`);
	}
	assert.ok(ts.hl_builtin.includes("console"));
});

test("and it also highlights what only TypeScript has", async () => {
	await ready();
	const ts = spansFor("main.ts");

	assert.ok(
		ts.hl_keyword.includes("interface"),
		"interface is the headline declaration TS adds",
	);
	assert.ok(ts.hl_builtin.includes("string"), "string is a type here");
	assert.ok(ts.hl_builtin.includes("number"), "number is a type here");
});

test("no code file falls through to the HTML highlighter", async () => {
	await ready();
	for (const name of ["main.ts", "app.tsx", "main.js", "main.py", "a.json"]) {
		const spans = spansFor(name);
		for (const cls of ["hl_tag", "hl_attr", "hl_value", "hl_doctype"]) {
			assert.equal(
				spans[cls],
				undefined,
				`${name} produced ${cls} spans — it went through the HTML path`,
			);
		}
	}
});

test("the HTML path itself is untouched", async () => {
	await ready();
	const html = '<div class="a">hi</div>';
	const spans = spansFor("index.html", html);
	assert.deepEqual(spans.hl_tag, ["div", "div"]);
	assert.deepEqual(spans.hl_attr, ["class"]);
	assert.deepEqual(spans.hl_value, ["a"]);
});

test("an unknown extension still falls back to HTML, as before", async () => {
	await ready();
	assert.equal(langShortId("notes.rtf"), "html");
});
