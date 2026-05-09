const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
	initProfiles,
	getProfile,
	allExtensions,
	extensionToId,
	detectLanguageFromLessonFile,
	lessonFileExtension,
	commentRangesOf,
	highlight,
	emptyHighlightSpans,
	shouldIncreaseAfter,
	shouldDecreaseOnLine,
	shouldDecreaseAfter,
	shouldAutoDedentOnChar,
} = require("../lesson_tools/languages/profiles");

const EXPECTED_JS_KEYWORDS = new Set([
	"var",
	"let",
	"const",
	"function",
	"return",
	"if",
	"else",
	"for",
	"while",
	"do",
	"switch",
	"case",
	"break",
	"continue",
	"new",
	"this",
	"typeof",
	"instanceof",
	"null",
	"undefined",
	"true",
	"false",
	"class",
	"extends",
	"import",
	"export",
	"default",
	"try",
	"catch",
	"finally",
	"throw",
	"async",
	"await",
	"of",
	"in",
	"from",
	"static",
	"super",
	"yield",
	"delete",
	"void",
	"debugger",
]);
const EXPECTED_JS_BUILTINS = new Set([
	"console",
	"document",
	"window",
	"Array",
	"Object",
	"String",
	"Number",
	"Boolean",
	"Math",
	"JSON",
	"Promise",
	"setTimeout",
	"setInterval",
	"clearTimeout",
	"clearInterval",
	"parseInt",
	"parseFloat",
	"isNaN",
	"isFinite",
	"alert",
	"confirm",
	"prompt",
	"addEventListener",
	"fetch",
	"querySelector",
	"querySelectorAll",
	"getElementById",
	"getElementsByClassName",
	"getElementsByTagName",
]);

test("javascript keywords snapshot", async () => {
	await initProfiles();
	const got = new Set(getProfile("javascript").keywords);
	assert.deepEqual([...got].sort(), [...EXPECTED_JS_KEYWORDS].sort());
});

test("javascript builtins snapshot", async () => {
	await initProfiles();
	const got = new Set(getProfile("javascript").builtins);
	assert.deepEqual([...got].sort(), [...EXPECTED_JS_BUILTINS].sort());
});

test("extension lookup is case-insensitive", async () => {
	await initProfiles();
	assert.equal(extensionToId(".js"), "javascript");
	assert.equal(extensionToId(".JS"), "javascript");
	assert.equal(extensionToId(".CSS"), "css");
	assert.equal(extensionToId(".html"), "html");
	assert.equal(extensionToId(".htm"), "html");
	assert.equal(extensionToId(".txt"), "plaintext");
	assert.equal(extensionToId(".unknown"), null);
	assert.equal(extensionToId(""), null);
});

test("getProfile by id or extension returns same object", async () => {
	await initProfiles();
	assert.equal(getProfile("javascript"), getProfile(".js"));
	assert.equal(getProfile("html"), getProfile(".html"));
	assert.equal(getProfile("html"), getProfile(".htm"));
	assert.equal(getProfile("css"), getProfile(".css"));
});

test("allExtensions returns all registered", async () => {
	await initProfiles();
	assert.deepEqual(allExtensions(), [
		".css",
		".htm",
		".html",
		".js",
		".py",
		".txt",
	]);
});

test("html voidTags and embeddedTags declared", async () => {
	await initProfiles();
	const prof = getProfile("html");
	assert.deepEqual(
		[...prof.voidTags].sort(),
		[
			"area",
			"base",
			"br",
			"col",
			"embed",
			"hr",
			"img",
			"input",
			"link",
			"meta",
			"param",
			"source",
			"track",
			"wbr",
		].sort(),
	);
	const embedded = Object.fromEntries(
		prof.embeddedTags.map((e) => [e.tag, e.language]),
	);
	assert.deepEqual(embedded, { script: "javascript", style: "css" });
});

test("plaintext loads cleanly with empty fields", async () => {
	await initProfiles();
	const prof = getProfile("plaintext");
	assert.equal(prof.id, "plaintext");
	assert.deepEqual(prof.keywords, []);
	assert.deepEqual(prof.builtins, []);
	assert.deepEqual(prof.strings, []);
	assert.equal(prof.comments.line, null);
	assert.equal(prof.comments.block, null);
});

test("unknown returns null", async () => {
	await initProfiles();
	assert.equal(getProfile("ruby"), null);
	assert.equal(getProfile(".rb"), null);
	assert.equal(getProfile(""), null);
});

test("initProfiles is idempotent", async () => {
	const a = initProfiles();
	const b = initProfiles();
	assert.equal(a, b);
	await a;
});

test("commentRangesOf: JS detects line and block comments", async () => {
	await initProfiles();
	const prof = getProfile(".js");
	const text = "var a = 1; // line\n/* block */ var b;";
	const ranges = commentRangesOf(prof, text);
	assert.deepEqual(ranges, [
		[11, 18],
		[19, 30],
	]);
	assert.equal(text.slice(11, 18), "// line");
	assert.equal(text.slice(19, 30), "/* block */");
});

test("commentRangesOf: JS lookbehind skips :// in URLs", async () => {
	await initProfiles();
	const prof = getProfile(".js");
	const text = 'var url = "http://example.com"; // ok';
	const ranges = commentRangesOf(prof, text);
	assert.deepEqual(ranges, [[32, 37]]);
});

test("commentRangesOf: CSS detects only block comments", async () => {
	await initProfiles();
	const prof = getProfile(".css");
	const text = "p { color: red; } /* comment */ // not a comment";
	const ranges = commentRangesOf(prof, text);
	assert.deepEqual(ranges, [[18, 31]]);
});

test("commentRangesOf: HTML allows <!-- everywhere", async () => {
	await initProfiles();
	const prof = getProfile(".html");
	const text = "<p>hi</p><!-- comment --><p>bye</p>";
	const ranges = commentRangesOf(prof, text);
	assert.deepEqual(ranges, [[9, 25]]);
});

test("commentRangesOf: HTML filters // outside <script>", async () => {
	await initProfiles();
	const prof = getProfile(".html");
	const text = "<p>// not a comment</p>\n<script>// is a comment\n</script>";
	const ranges = commentRangesOf(prof, text);
	assert.equal(ranges.length, 1);
	const [s, e] = ranges[0];
	assert.equal(text.slice(s, e), "// is a comment");
});

test("commentRangesOf: HTML filters /* outside <style>/<script>", async () => {
	await initProfiles();
	const prof = getProfile(".html");
	const text =
		"<p>/* not */</p><style>/* is */</style><p>/* nope */</p><script>/* yes */</script>";
	const ranges = commentRangesOf(prof, text);
	const matched = ranges.map(([s, e]) => text.slice(s, e));
	assert.deepEqual(matched, ["/* is */", "/* yes */"]);
});

test("commentRangesOf: plaintext returns empty", async () => {
	await initProfiles();
	const prof = getProfile("plaintext");
	const text = "/* foo */ // bar\n<!-- baz -->";
	assert.deepEqual(commentRangesOf(prof, text), []);
});

test("commentRangesOf: null profile returns empty", () => {
	assert.deepEqual(commentRangesOf(null, "anything /* */"), []);
});

test("highlight: JS keyword classification", async () => {
	await initProfiles();
	const prof = getProfile(".js");
	const spans = highlight(prof, "const x = 1;");
	const kw = spans.hl_keyword.map((s) => [s.start, s.end]);
	assert.deepEqual(kw, [[0, 5]]);
});

test("highlight: JS builtin classification", async () => {
	await initProfiles();
	const prof = getProfile(".js");
	const spans = highlight(prof, "console.log(42);");
	const bi = spans.hl_builtin.map((s) => [s.start, s.end]);
	assert.deepEqual(bi, [[0, 7]]);
});

test("highlight: JS function call detection", async () => {
	await initProfiles();
	const prof = getProfile(".js");
	const spans = highlight(prof, "foo(bar);");
	const fn = spans.hl_func.map((s) => [s.start, s.end]);
	assert.deepEqual(fn, [[0, 3]]);
});

test("highlight: JS line and block comments", async () => {
	await initProfiles();
	const prof = getProfile(".js");
	const spans = highlight(prof, "/* a */ var x; // b");
	const cm = spans.hl_comment.map((s) => [s.start, s.end]);
	assert.deepEqual(
		cm.sort((a, b) => a[0] - b[0]),
		[
			[0, 7],
			[15, 19],
		],
	);
});

test("highlight: JS strings (backtick, double, single)", async () => {
	await initProfiles();
	const prof = getProfile(".js");
	const text = "`tpl` \"dq\" 'sq'";
	const spans = highlight(prof, text);
	const st = spans.hl_string.map((s) => [s.start, s.end]);
	assert.deepEqual(
		st.sort((a, b) => a[0] - b[0]),
		[
			[0, 5],
			[6, 10],
			[11, 15],
		],
	);
});

test("highlight: JS string escape preserves match", async () => {
	await initProfiles();
	const prof = getProfile(".js");
	const text = '"foo\\"bar"';
	const spans = highlight(prof, text);
	assert.deepEqual(spans.hl_string, [{ start: 0, end: text.length }]);
});

test("highlight: JS numbers (decimal, hex, exponent)", async () => {
	await initProfiles();
	const prof = getProfile(".js");
	const spans = highlight(prof, "var a = 0xFF, b = 1.5e10, c = 42;");
	const nums = spans.hl_number.map((s) => [s.start, s.end]);
	assert.deepEqual(
		nums.sort((a, b) => a[0] - b[0]),
		[
			[8, 12],
			[18, 24],
			[30, 32],
		],
	);
});

test("highlight: comment-protected text is not classified as keyword", async () => {
	await initProfiles();
	const prof = getProfile(".js");
	const spans = highlight(prof, "// const x");
	assert.equal(spans.hl_keyword.length, 0);
	assert.equal(spans.hl_comment.length, 1);
});

test("highlight: string-protected text is not classified as keyword", async () => {
	await initProfiles();
	const prof = getProfile(".js");
	const spans = highlight(prof, '"const x"');
	assert.equal(spans.hl_keyword.length, 0);
	assert.equal(spans.hl_string.length, 1);
});

test("highlight: plaintext returns empty (no keywords/strings/comments)", async () => {
	await initProfiles();
	const prof = getProfile("plaintext");
	const spans = highlight(prof, "anything goes here");
	for (const k of Object.keys(spans)) {
		assert.deepEqual(spans[k], [], `expected ${k} to be empty`);
	}
});

test("highlight: null profile returns empty spans (no crash)", () => {
	const spans = highlight(null, "anything", 0);
	assert.ok(spans);
	assert.deepEqual(spans.hl_keyword, []);
});

test("highlight: offset is applied to all span starts/ends", async () => {
	await initProfiles();
	const prof = getProfile(".js");
	const spans = highlight(prof, "const x", 100);
	assert.deepEqual(spans.hl_keyword, [{ start: 100, end: 105 }]);
});

test("highlight: Python keywords (def, class, if, return)", async () => {
	await initProfiles();
	const prof = getProfile("python");
	const text = "def foo(x):\n    if x:\n        return x\n    return None";
	const spans = highlight(prof, text);
	const kw = spans.hl_keyword.map((s) => text.slice(s.start, s.end));
	assert.ok(kw.includes("def"), "def should be a keyword");
	assert.ok(kw.includes("if"), "if should be a keyword");
	assert.ok(kw.includes("return"), "return should be a keyword");
	assert.ok(kw.includes("None"), "None should be a keyword");
});

test("highlight: Python builtins (print, len, range)", async () => {
	await initProfiles();
	const prof = getProfile("python");
	const spans = highlight(prof, "print(len(range(10)))");
	const bi = spans.hl_builtin.map((s) =>
		"print(len(range(10)))".slice(s.start, s.end),
	);
	assert.ok(bi.includes("print"));
	assert.ok(bi.includes("len"));
	assert.ok(bi.includes("range"));
});

test("highlight: Python # comment", async () => {
	await initProfiles();
	const prof = getProfile("python");
	const text = "x = 1  # the answer";
	const spans = highlight(prof, text);
	assert.equal(spans.hl_comment.length, 1);
	const [c] = spans.hl_comment;
	assert.equal(text.slice(c.start, c.end), "# the answer");
});

test("highlight: Python triple-quoted string", async () => {
	await initProfiles();
	const prof = getProfile("python");
	const text = '"""docstring\nspans lines"""';
	const spans = highlight(prof, text);
	assert.equal(spans.hl_string.length, 1);
	assert.equal(spans.hl_string[0].start, 0);
	assert.equal(spans.hl_string[0].end, text.length);
});

test("highlight: Python keyword inside # comment is NOT classified", async () => {
	await initProfiles();
	const prof = getProfile("python");
	const spans = highlight(prof, "# def foo():");
	assert.equal(spans.hl_keyword.length, 0);
	assert.equal(spans.hl_comment.length, 1);
});

test("indent: JS opens after { (", async () => {
	await initProfiles();
	const prof = getProfile(".js");
	assert.equal(shouldIncreaseAfter(prof, "function foo() {"), true);
	assert.equal(shouldIncreaseAfter(prof, "var x = ["), true);
	assert.equal(shouldIncreaseAfter(prof, "var x = 1;"), false);
});

test("indent: HTML opens on open tag, not on void or self-closing", async () => {
	await initProfiles();
	const prof = getProfile(".html");
	assert.equal(shouldIncreaseAfter(prof, "<div>"), true);
	assert.equal(shouldIncreaseAfter(prof, "<br>"), false);
	assert.equal(shouldIncreaseAfter(prof, "<div/>"), false);
});

test("indent: Python opens after :", async () => {
	await initProfiles();
	const prof = getProfile("python");
	assert.equal(shouldIncreaseAfter(prof, "def foo():"), true);
	assert.equal(shouldIncreaseAfter(prof, "if x:  # explain"), true);
	assert.equal(shouldIncreaseAfter(prof, "x = 1"), false);
});

test("indent: Python decreases on elif/else/except/finally", async () => {
	await initProfiles();
	const prof = getProfile("python");
	assert.equal(shouldDecreaseOnLine(prof, "elif x:"), true);
	assert.equal(shouldDecreaseOnLine(prof, "else:"), true);
	assert.equal(shouldDecreaseOnLine(prof, "except ValueError:"), true);
	assert.equal(shouldDecreaseOnLine(prof, "x = 1"), false);
});

test("indent: Python decreases after return/break/continue/pass/raise", async () => {
	await initProfiles();
	const prof = getProfile("python");
	assert.equal(shouldDecreaseAfter(prof, "    return 1"), true);
	assert.equal(shouldDecreaseAfter(prof, "  break"), true);
	assert.equal(shouldDecreaseAfter(prof, "x = return_value"), false);
});

test("auto-dedent: closing bracket universal", async () => {
	await initProfiles();
	const prof = getProfile(".js");
	assert.equal(shouldAutoDedentOnChar(prof, "}", "\t\t"), true);
	assert.equal(shouldAutoDedentOnChar(prof, ")", "  "), true);
	assert.equal(shouldAutoDedentOnChar(prof, "}", "x"), false);
});

test("auto-dedent: HTML / after < only for HTML profile", async () => {
	await initProfiles();
	assert.equal(shouldAutoDedentOnChar(getProfile(".html"), "/", "\t<"), true);
	assert.equal(shouldAutoDedentOnChar(getProfile(".js"), "/", "\t<"), false);
	assert.equal(
		shouldAutoDedentOnChar(getProfile("python"), "/", "\t<"),
		false,
	);
});

test("indent helpers: null profile returns false", () => {
	assert.equal(shouldIncreaseAfter(null, "anything {"), false);
	assert.equal(shouldDecreaseOnLine(null, "}"), false);
	assert.equal(shouldDecreaseAfter(null, "return 1"), false);
});

test("detectLanguageFromLessonFile: matches by filename", async () => {
	await initProfiles();
	assert.equal(detectLanguageFromLessonFile("plans/Python.json"), "python");
	assert.equal(
		detectLanguageFromLessonFile("C:\\\\plans\\\\Python.json"),
		"python",
	);
	assert.equal(detectLanguageFromLessonFile("python.json"), "python");
	assert.equal(detectLanguageFromLessonFile("plans/Emordnilap.json"), null);
	assert.equal(detectLanguageFromLessonFile(""), null);
	assert.equal(detectLanguageFromLessonFile(null), null);
});

test("lessonFileExtension: returns first ext of detected language", async () => {
	await initProfiles();
	assert.equal(lessonFileExtension("plans/Python.json"), ".py");
	assert.equal(lessonFileExtension("plans/Emordnilap.json"), null);
});

test("emptyHighlightSpans returns all required keys", () => {
	const spans = emptyHighlightSpans();
	for (const k of [
		"hl_comment",
		"hl_string",
		"hl_keyword",
		"hl_builtin",
		"hl_number",
		"hl_func",
		"hl_doctype",
		"hl_tag",
		"hl_attr",
		"hl_value",
		"hl_css_sel",
		"hl_css_prop",
		"hl_css_num",
		"hl_css_at",
	]) {
		assert.deepEqual(spans[k], [], k);
	}
});
