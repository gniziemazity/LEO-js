const { BrowserWindow, dialog, shell } = require("electron");
const { spawn, spawnSync } = require("child_process");
const { pathToFileURL } = require("url");
const path = require("path");
const fs = require("fs");

let courseMenuState = { open: false, plans: [], currentPath: "" };

const LESSON_TOOLS = [
	{ label: "Timeline", file: "timeline.html", perLesson: true },
	{ label: "Simulator", file: "simulator.html", perLesson: true },
	{ label: "Students", file: "students.html", perLesson: true },
	{ label: "Overview", file: "overview.html", perLesson: false },
];

const lessonToolWindows = new Map();
let visualizerWindow = null;

function getCourseMenuState() {
	return courseMenuState;
}

function setCourseMenuState(payload) {
	courseMenuState = {
		open: !!(payload && payload.open),
		plans: (payload && payload.plans) || [],
		currentPath: (payload && payload.currentPath) || "",
	};
}

function currentCourseContext() {
	const lessonPath = courseMenuState.currentPath;
	if (!lessonPath || !courseMenuState.open) return null;
	const plansDir = path.dirname(lessonPath);
	if (path.basename(plansDir).toLowerCase() !== "plans") return null;
	return {
		courseRoot: path.dirname(plansDir),
		lesson: path.basename(lessonPath).replace(/\.(leo|json)$/i, ""),
	};
}

function lessonWorkspaceFolder() {
	const ctx = currentCourseContext();
	if (!ctx) return null;
	const folder = path.join(ctx.courseRoot, "lessons", ctx.lesson, ctx.lesson);
	try {
		fs.mkdirSync(folder, { recursive: true });
	} catch (_) {}
	return folder;
}

const EXTERNAL_APPS = {
	vscode: {
		name: "VSCode",
		candidates: [
			path.join(
				process.env.LOCALAPPDATA || "",
				"Programs/Microsoft VS Code/Code.exe",
			),
			path.join(
				process.env.PROGRAMFILES || "C:/Program Files",
				"Microsoft VS Code/Code.exe",
			),
			path.join(
				process.env["PROGRAMFILES(X86)"] || "C:/Program Files (x86)",
				"Microsoft VS Code/Code.exe",
			),
		],
		fallback: "code",
	},
	chrome: {
		name: "Chrome",
		candidates: [
			path.join(
				process.env.PROGRAMFILES || "C:/Program Files",
				"Google/Chrome/Application/chrome.exe",
			),
			path.join(
				process.env["PROGRAMFILES(X86)"] || "C:/Program Files (x86)",
				"Google/Chrome/Application/chrome.exe",
			),
			path.join(
				process.env.LOCALAPPDATA || "",
				"Google/Chrome/Application/chrome.exe",
			),
		],
		fallback: 'start "" chrome',
	},
};

function launchExternalApp(key, args = []) {
	const cfg = EXTERNAL_APPS[key];
	if (!cfg) return;
	const exe = cfg.candidates.find((p) => p && fs.existsSync(p));
	const onError = () =>
		dialog.showErrorBox("LEO", `Could not launch ${cfg.name}.`);
	try {
		let child;
		if (exe) {
			child = spawn(exe, args, { detached: true, stdio: "ignore" });
		} else {
			const line = [
				cfg.fallback,
				...args.map((a) => (a.startsWith("-") ? a : `"${a}"`)),
			].join(" ");
			child = spawn(line, { detached: true, stdio: "ignore", shell: true });
		}
		child.on("error", onError);
		child.unref();
	} catch (_) {
		onError();
	}
}

function launchVSCode() {
	const folder = lessonWorkspaceFolder();
	launchExternalApp("vscode", folder ? [folder] : []);
}

let _pythonCmd = null;
function resolvePython() {
	if (_pythonCmd) return _pythonCmd;
	for (const cmd of ["python", "python3", "py"]) {
		try {
			const r = spawnSync(cmd, ["--version"], { encoding: "utf8" });
			if (!r.error && r.status === 0) {
				_pythonCmd = cmd;
				return cmd;
			}
		} catch (e) {}
	}
	_pythonCmd = "python";
	return _pythonCmd;
}

const {
	PORT: _LESSON_TOOLS_PORT,
	ensureServer,
} = require("../../lesson_tools/server-launch");
const _GRADES_SESSION_FILE = path.join(
	__dirname,
	"../../lesson_tools/.grades_session.json",
);

function writeGradesSession(folder) {
	try {
		fs.writeFileSync(
			_GRADES_SESSION_FILE,
			JSON.stringify({ folder }),
			"utf8",
		);
	} catch (_) {}
}

function lessonToolUrl(tool) {
	const ctx = currentCourseContext();
	if (ctx) writeGradesSession(ctx.courseRoot);
	let url = `http://127.0.0.1:${_LESSON_TOOLS_PORT}/${tool.file}`;
	if (ctx && tool.perLesson) {
		url += `?lesson=${encodeURIComponent(ctx.lesson)}&group=lessons`;
	}
	return url;
}

const _LESSON_TOOL_PAGES = new Set([
	"timeline.html",
	"simulator.html",
	"students.html",
	"differentiator.html",
	"overview.html",
]);

function isLessonToolPageUrl(url) {
	try {
		const u = new URL(url);
		return (
			u.hostname === "127.0.0.1" &&
			String(u.port) === String(_LESSON_TOOLS_PORT) &&
			_LESSON_TOOL_PAGES.has(u.pathname.replace(/^\//, "").toLowerCase())
		);
	} catch (_) {
		return false;
	}
}

function enableDevToolsShortcut(win) {
	win.webContents.on("before-input-event", (e, input) => {
		if (input.type !== "keyDown") return;
		const mod = process.platform === "darwin" ? input.meta : input.control;
		if (mod && (input.key === "i" || input.key === "I")) {
			win.webContents.toggleDevTools();
			e.preventDefault();
		}
	});
}

function wireLessonToolNav(win, tool) {
	enableDevToolsShortcut(win);
	win.webContents.setWindowOpenHandler(({ url }) => {
		if (isLessonToolPageUrl(url)) {
			setImmediate(() => {
				if (!win.isDestroyed()) win.loadURL(url);
			});
		} else if (/^https?:\/\//i.test(url)) {
			shell.openExternal(url);
		}
		return { action: "deny" };
	});
	win.webContents.on("did-navigate", (_e, navUrl) => {
		const entry = lessonToolWindows.get(tool.file);
		if (entry && entry.win === win) entry.url = navUrl;
	});
	const nav = () => win.webContents.navigationHistory;
	win.on("app-command", (_e, cmd) => {
		if (cmd === "browser-backward" && nav().canGoBack()) nav().goBack();
		else if (cmd === "browser-forward" && nav().canGoForward())
			nav().goForward();
	});
	win.webContents.on("before-input-event", (_e, input) => {
		if (input.type !== "keyDown" || !input.alt) return;
		if (input.key === "ArrowLeft" && nav().canGoBack()) nav().goBack();
		else if (input.key === "ArrowRight" && nav().canGoForward())
			nav().goForward();
	});
}

function ensureLessonToolsServer(cb) {
	ensureServer({ env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } }, cb);
}

function openLessonTool(tool) {
	const url = lessonToolUrl(tool);
	ensureLessonToolsServer(() => {
		const entry = lessonToolWindows.get(tool.file);
		if (entry && !entry.win.isDestroyed()) {
			if (entry.url !== url) {
				entry.win.loadURL(url);
				entry.url = url;
			}
			if (entry.win.isMinimized()) entry.win.restore();
			entry.win.show();
			entry.win.focus();
			return;
		}
		const win = new BrowserWindow({
			width: 1280,
			height: 860,
			title: tool.label,
			icon: path.join(__dirname, "../shared/icon.ico"),
			autoHideMenuBar: true,
			webPreferences: {
				nodeIntegration: false,
				contextIsolation: true,
			},
		});
		win.setMenu(null);
		wireLessonToolNav(win, tool);
		win.loadURL(url);
		win.on("closed", () => lessonToolWindows.delete(tool.file));
		lessonToolWindows.set(tool.file, { win, url });
	});
}

const _VIS_HTML = path.join(__dirname, "../../lesson_tools/simulator.html");
const _VIS_PRELOAD = path.join(__dirname, "vis-preload.js");

function openLogVisualizer(logFilePath) {
	const stamp = Date.now();
	let payload = null;
	if (logFilePath) {
		let lessonFile = null;
		try {
			lessonFile =
				JSON.parse(fs.readFileSync(logFilePath, "utf8")).lessonFile || null;
		} catch (_) {}
		const scriptPath = path.join(
			__dirname,
			"../../lesson_tools/lv_expand_cli.py",
		);
		const py = resolvePython();
		const result = spawnSync(py, [scriptPath, logFilePath], {
			encoding: "utf8",
		});
		if (result.error) {
			payload = {
				filePath: logFilePath,
				micro: null,
				error: `Could not run Python (${py}): ${result.error.message}`,
			};
		} else if (result.status === 0) {
			try {
				const micro = JSON.parse(result.stdout);
				payload = { filePath: logFilePath, micro, lessonFile, error: null };
			} catch (e) {
				payload = {
					filePath: logFilePath,
					micro: null,
					error: `JSON parse error: ${e.message}`,
				};
			}
		} else {
			payload = {
				filePath: logFilePath,
				micro: null,
				error: result.stderr || `Python exited with code ${result.status}`,
			};
		}
		payload.loadedAt = stamp;

		try {
			const resDir = path.resolve(
				path.dirname(logFilePath),
				"..",
				"resources",
			);
			if (fs.existsSync(resDir) && fs.statSync(resDir).isDirectory()) {
				payload.resourcesBase = pathToFileURL(resDir).href.replace(
					/\/?$/,
					"/",
				);
			}
		} catch (_) {}
	}

	let prevBounds = null;
	if (visualizerWindow && !visualizerWindow.isDestroyed()) {
		const old = visualizerWindow;
		visualizerWindow = null;
		try {
			prevBounds = old.getBounds();
		} catch (_) {}
		old.removeAllListeners("closed");
		old.destroy();
	}
	visualizerWindow = new BrowserWindow({
		width: prevBounds ? prevBounds.width : 1200,
		height: prevBounds ? prevBounds.height : 800,
		...(prevBounds ? { x: prevBounds.x, y: prevBounds.y } : {}),
		title: "Log Visualizer",
		icon: path.join(__dirname, "../shared/icon.ico"),
		autoHideMenuBar: true,
		webPreferences: {
			nodeIntegration: false,
			contextIsolation: true,
			preload: _VIS_PRELOAD,
		},
	});
	visualizerWindow.setMenu(null);
	enableDevToolsShortcut(visualizerWindow);
	const target = visualizerWindow;

	target.webContents.once("did-finish-load", () => {
		if (target.isDestroyed() || !payload) return;
		target.webContents
			.executeJavaScript(
				`window.__leoApplyVisData && window.__leoApplyVisData(${JSON.stringify(payload)});`,
			)
			.catch((e) => console.error("[LEO] visualizer push failed:", e));
	});
	target.loadFile(_VIS_HTML);
	target.on("closed", () => {
		visualizerWindow = null;
	});
}

function closeToolWindows() {
	if (visualizerWindow && !visualizerWindow.isDestroyed()) {
		visualizerWindow.destroy();
	}
	for (const entry of [...lessonToolWindows.values()]) {
		if (entry.win && !entry.win.isDestroyed()) entry.win.destroy();
	}
}

module.exports = {
	LESSON_TOOLS,
	getCourseMenuState,
	setCourseMenuState,
	openLessonTool,
	openLogVisualizer,
	launchExternalApp,
	launchVSCode,
	closeToolWindows,
};
