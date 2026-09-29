"use strict";

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { loadModule } = require("./helpers/load-module");
const {
	planExport,
	writeExport,
	registerToolExport,
} = require("../src/main/tool-export");

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "leo-export-"));
after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

const bytes = (s) => new TextEncoder().encode(s);
const file = (p, s = "x") => ({ path: p, data: bytes(s) });
let dirNo = 0;
const freshDir = () => {
	const d = path.join(ROOT, `out${dirNo++}`);
	fs.mkdirSync(d, { recursive: true });
	return d;
};

test("planExport keeps nested relative paths and normalizes backslashes", () => {
	const plan = planExport([
		file("index.html"),
		file("pieces\\p1.png"),
		file("css/site.css"),
	]);
	assert.deepEqual(
		plan.map((p) => p.parts.join("/")),
		["index.html", "pieces/p1.png", "css/site.css"],
	);
});

test("planExport refuses anything that could leave the folder or run", () => {
	for (const bad of [
		"../x.html",
		"a/../../x.html",
		"/x.html",
		"C:/x.html",
		"C:x.html",
		"a//x.html",
		"./x.html",
		"x.exe",
		"run.bat",
		"x.html\u0000.png",
		"",
	]) {
		assert.throws(() => planExport([file(bad)]), undefined, bad);
	}
	assert.throws(() => planExport([]), /no files/);
	assert.throws(
		() => planExport([{ path: "a.html", data: "text" }]),
		/contents/,
	);
	assert.throws(() => planExport([file("a.html"), file("A.HTML")]), /twice/);
	const huge = { path: "a.png", data: new Uint8Array(201 * 1024 * 1024) };
	assert.throws(() => planExport([huge]), /too large/);
});

const listFiles = (d) =>
	fs
		.readdirSync(d, { recursive: true, withFileTypes: true })
		.filter((e) => e.isFile())
		.map((e) =>
			path
				.relative(d, path.join(e.parentPath || e.path, e.name))
				.split(path.sep)
				.join("/"),
		)
		.sort();

test("writeExport writes nested files inside the folder and nowhere else", () => {
	const outer = freshDir();
	const dir = path.join(outer, "chosen");
	fs.mkdirSync(dir);
	const count = writeExport(
		dir,
		planExport([
			file("index.html", "<p>hi</p>"),
			file("pieces/p1.png", "PNG"),
		]),
	);
	assert.equal(count, 2);
	assert.equal(
		fs.readFileSync(path.join(dir, "index.html"), "utf8"),
		"<p>hi</p>",
	);
	assert.equal(
		fs.readFileSync(path.join(dir, "pieces", "p1.png"), "utf8"),
		"PNG",
	);
	assert.deepEqual(listFiles(outer), [
		"chosen/index.html",
		"chosen/pieces/p1.png",
	]);
});

test("writeExport checks every target before writing any", () => {
	const dir = freshDir();
	const plan = [
		{ parts: ["ok.html"], data: bytes("x") },
		{ parts: ["..", "escape.html"], data: bytes("x") },
	];
	assert.throws(() => writeExport(dir, plan), /outside the folder/);
	assert.deepEqual(
		listFiles(dir),
		[],
		"the valid file was not written either",
	);
	assert.equal(fs.existsSync(path.join(dir, "..", "escape.html")), false);
});

function harness({ canceled = false, toolSender = true } = {}) {
	const handlers = {};
	const dialogCalls = [];
	const opened = [];
	const dir = freshDir();
	registerToolExport({
		ipcMain: { handle: (ch, fn) => (handlers[ch] = fn) },
		dialog: {
			showOpenDialog: async (...args) => {
				dialogCalls.push(args);
				return canceled
					? { canceled: true, filePaths: [] }
					: { canceled: false, filePaths: [dir] };
			},
		},
		shell: { openPath: async (p) => (opened.push(p), "") },
		BrowserWindow: { fromWebContents: () => ({ id: 1 }) },
		isToolSender: () => toolSender,
	});
	const event = (id = 7) => ({ sender: { id } });
	return { handlers, dialogCalls, opened, dir, event };
}

test("export writes the files to the chosen folder and returns it", async () => {
	const h = harness();
	const r = await h.handlers["tool-export-files"](h.event(), [
		file("index.html", "A"),
		file("img/a.png", "B"),
	]);
	assert.deepEqual(r, { dir: h.dir, count: 2 });
	assert.equal(fs.readFileSync(path.join(h.dir, "img", "a.png"), "utf8"), "B");
	const [, options] = h.dialogCalls[0];
	assert.deepEqual(options.properties, ["openDirectory", "createDirectory"]);
});

test("a cancelled dialog writes nothing", async () => {
	const h = harness({ canceled: true });
	const r = await h.handlers["tool-export-files"](h.event(), [
		file("index.html"),
	]);
	assert.deepEqual(r, { canceled: true });
	assert.deepEqual(fs.readdirSync(h.dir), []);
});

test("a window that is not a lesson tool gets no dialog and no write", async () => {
	const h = harness({ toolSender: false });
	const r = await h.handlers["tool-export-files"](h.event(), [
		file("index.html"),
	]);
	assert.ok(r.error);
	assert.equal(h.dialogCalls.length, 0);
	assert.equal(await h.handlers["tool-open-export-folder"](h.event()), false);
});

test("bad paths are refused before any dialog opens", async () => {
	const h = harness();
	const r = await h.handlers["tool-export-files"](h.event(), [
		file("../x.html"),
	]);
	assert.match(r.error, /Refusing/);
	assert.equal(h.dialogCalls.length, 0);
});

test("open folder opens only the folder that window wrote to", async () => {
	const h = harness();
	assert.equal(await h.handlers["tool-open-export-folder"](h.event(7)), false);
	await h.handlers["tool-export-files"](h.event(7), [file("index.html")]);
	assert.equal(await h.handlers["tool-open-export-folder"](h.event(9)), false);
	assert.equal(await h.handlers["tool-open-export-folder"](h.event(7)), true);
	assert.deepEqual(h.opened, [h.dir]);
});

test("the second export's dialog starts in the folder used last", async () => {
	const h = harness();
	await h.handlers["tool-export-files"](h.event(), [file("index.html")]);
	await h.handlers["tool-export-files"](h.event(), [file("index.html")]);
	assert.equal(h.dialogCalls[0][1].defaultPath, undefined);
	assert.equal(h.dialogCalls[1][1].defaultPath, h.dir);
});

function lessonToolsWithFakeWindows() {
	const windows = [];
	class FakeWindow {
		constructor(opts) {
			this.opts = opts;
			this.webContents = {
				setWindowOpenHandler() {},
				on() {},
				navigationHistory: {},
			};
			windows.push(this);
		}
		setMenu() {}
		on() {}
		loadURL() {}
		isDestroyed() {
			return false;
		}
	}
	const mod = loadModule("src/main/lesson-tools.js", {
		electron: { BrowserWindow: FakeWindow, dialog: {}, shell: {} },
		"../../lesson_tools/server-launch": {
			PORT: 7891,
			ensureServer: (_opts, cb) => cb(),
		},
	});
	mod.setCourseMenuState({ open: false, plans: [], currentPath: "" });
	return { mod, windows };
}

test("lesson tool windows load the export bridge, and only they may use it", () => {
	const { mod, windows } = lessonToolsWithFakeWindows();
	mod.openLessonTool({
		label: "Students",
		file: "students.html",
		perLesson: true,
	});
	const [win] = windows;
	const prefs = win.opts.webPreferences;
	assert.equal(prefs.contextIsolation, true);
	assert.equal(prefs.nodeIntegration, false);
	assert.equal(path.basename(prefs.preload), "lesson-tools-preload.js");
	assert.ok(fs.existsSync(prefs.preload), "the preload file exists");

	const url = "http://127.0.0.1:7891/differentiator.html?lesson=wall";
	const top = { parent: null, url };
	assert.equal(
		mod.isLessonToolSender({ sender: win.webContents, senderFrame: top }),
		true,
	);
	assert.equal(
		mod.isLessonToolSender({ sender: {}, senderFrame: top }),
		false,
		"a window LEO did not open as a lesson tool",
	);
	assert.equal(
		mod.isLessonToolSender({
			sender: win.webContents,
			senderFrame: { parent: top, url },
		}),
		false,
		"an iframe inside the page",
	);
	assert.equal(
		mod.isLessonToolSender({
			sender: win.webContents,
			senderFrame: {
				parent: null,
				url: "https://example.com/differentiator.html",
			},
		}),
		false,
		"a page that navigated away from the lesson tools server",
	);
});
