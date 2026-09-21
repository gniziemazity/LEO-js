const {
	app,
	BrowserWindow,
	ipcMain,
	dialog,
	Menu,
	Tray,
	nativeImage,
	screen,
	shell,
} = require("electron");

const path = require("path");
const fs = require("fs");
const { WINDOW_CONFIG, buildWindowTitle } = require("../shared/constants");
const { interactionBgColor } = require("../shared/interaction-view");
const state = require("./state");

const {
	settingsManager,
	broadcastServer,
	hotkeyManager,
	keyboardHandler,
	resolveStudentName,
} = require("./context");
const { createApplicationMenu } = require("./app-menu");
const {
	floatState,
	openQuestionWindow,
	closeAllChildWindows,
	unpinWindows,
	setQuestionWindowSquare,
	stopFloatLerp,
	_questionFloat,
	_imageFloat,
	_webFloat,
	_randomizerFloat,
	_optionsFloat,
} = require("./float-windows");
const { openLogVisualizer, setCourseMenuState } = require("./lesson-tools");
require("./remote-input");
const {
	enterPopup,
	endPopup,
	confirmPopup,
	endPopupIfOpen,
	confirmMedia,
	dismissMedia,
	confirmKeyFor,
	pasteAndConfirm,
	armMoveToName,
	typeNextNameChar,
	hasPendingName,
	setNameProgressHandler,
	openPopupKind,
} = require("./popups");
const {
	showQuestion,
	armQuestionShow,
	rearmQuestionShow,
	endQuestion,
} = require("./question-show");
const { createAutoPilot } = require("./auto-pilot");

const MainProcessTimer = require("./main-timer");

const mainPlugin = require("./plugin");
if (mainPlugin.registerMain) {
	mainPlugin.registerMain({ ipcMain, broadcastServer });
}

let tray = null;

const MEDIA_FLOATS = { image: _imageFloat, web: _webFloat };

// broadcast handlers

broadcastServer.on("client-toggle-active", () => {
	state.send("hotkey-toggle-active");
});
broadcastServer.on("client-step-backward", () => {
	state.send("hotkey-step-backward");
});
broadcastServer.on("client-step-forward", () => {
	state.send("hotkey-step-forward");
});
broadcastServer.on("client-jump-to", (stepIndex) => {
	state.send("client-jump-to", stepIndex);
});
broadcastServer.on("client-question-randomize", () => {
	if (!_questionFloat.isAlive()) return;
	const names = broadcastServer.currentState.students || [];
	const style = settingsManager.get("randomizerStyle") || "shuffle";
	_randomizerFloat.showOrReuse(
		{ names, style, bgColor: floatState.questionWindowBgColor },
		{},
	);
});
broadcastServer.on("client-question-show-options", () => {
	if (!_questionFloat.isAlive()) return;
	_optionsFloat.showOrReuse(
		{
			options: floatState.questionOptions,
			bgColor: floatState.questionWindowBgColor,
		},
		{},
	);
});
broadcastServer.on("client-interaction", (interactionType) => {
	state.send("log-interaction", interactionType);
});
broadcastServer.on("client-student-answered", (studentName) => {
	endQuestion();
	const resolved = resolveStudentName(studentName);
	floatState.questionWindowStudentAnswered = resolved;
	const ANSWER_FADE_MS = 300;
	const reveal = () => {
		state.send("question-answered", { studentName: resolved });
		const qw = _questionFloat.activeWin;
		if (qw) qw.webContents.send("set-answered", resolved);
	};
	const fadedRandomizer = _randomizerFloat.fadeOutAndClose(ANSWER_FADE_MS);
	const fadedOptions = _optionsFloat.fadeOutAndClose(ANSWER_FADE_MS);
	if (fadedRandomizer || fadedOptions) {
		setTimeout(() => {
			if (_questionFloat.isAlive()) reveal();
		}, ANSWER_FADE_MS);
	} else {
		reveal();
	}
});
broadcastServer.on(
	"client-show-student-interaction",
	(interactionType, studentName, questionText, openedAt) => {
		const resolved = resolveStudentName(studentName);
		const isQuestion = interactionType === "student-question";
		const displayText = isQuestion
			? questionText || "(no question text)"
			: `Helping`;
		const emoji = isQuestion ? "❓" : "🤝";
		const bgColor = interactionBgColor(interactionType);
		openQuestionWindow(displayText, bgColor, emoji, resolved);
	},
);
broadcastServer.on(
	"client-close-student-interaction",
	(interactionType, studentName, questionText, openedAt, closedAt) => {
		floatState.questionWindowIsLesson = false;
		_questionFloat.close({ force: true });
		broadcastServer.broadcastQuestionEnded();
		state.send("log-student-interaction", {
			interactionType,
			studentName: resolveStudentName(studentName),
			questionText,
			openedAt,
			closedAt,
		});
	},
);
broadcastServer.on("client-show-question", (animate) => showQuestion(animate));
broadcastServer.on("client-move-to-confirmed", () => confirmPopup("move-to"));
broadcastServer.on("client-code-insert-confirmed", () =>
	confirmPopup("code-insert"),
);
broadcastServer.on("client-note-confirmed", () => confirmPopup("note"));
broadcastServer.on("client-media-confirmed", () => confirmMedia());
broadcastServer.on("client-pin-window", (pinned) => {
	const float = MEDIA_FLOATS[openPopupKind()];
	if (float && float.isAlive()) float.setPinned(pinned);
});
broadcastServer.on("client-media-dismissed", () => dismissMedia(MEDIA_FLOATS));
broadcastServer.on("client-unpin-windows", () => unpinWindows());
const autoPilot = createAutoPilot({ state, broadcastServer });
broadcastServer.on("client-set-auto-pilot", (on) => autoPilot.set(on));
const syncRemoteHotkeys = () =>
	hotkeyManager.setRemoteConnected(broadcastServer.clientCount() > 0);
broadcastServer.on("client-connected", () => {
	autoPilot.onClientConnected();
	syncRemoteHotkeys();
});
broadcastServer.on("client-disconnected", () => {
	autoPilot.onClientDisconnected();
	syncRemoteHotkeys();
});
ipcMain.on("set-auto-pilot", (event, on) => autoPilot.set(on === true));
broadcastServer.on("client-code-insert-paste", () => pasteAndConfirm());
broadcastServer.on("client-move-to-type-name", () => armMoveToName());
state.onPopupKey = () => {
	if (!hasPendingName()) return false;
	typeNextNameChar();
	return true;
};
setNameProgressHandler((p) => {
	broadcastServer.broadcastMoveToTyping(p);
	state.send("move-to-typing", p);
});
broadcastServer.on("client-dismiss-question", () => {
	endQuestion();
	if (floatState.questionWindowIsLesson) {
		_questionFloat.close({ force: true });
	}
});
broadcastServer.on("client-interaction-overlay-shown", () => {
	state.pause("interaction");
	state.send("stop-auto-typing");
});
broadcastServer.on("client-interaction-overlay-closed", () => {
	state.unpause("interaction");
});

const timer = new MainProcessTimer();

timer.on("tick", (remaining) => {
	broadcastServer.updateTimer(remaining);
});
timer.on("stopped", () => {
	broadcastServer.clearTimer();
});

broadcastServer.on("client-timer-start", () => {
	timer.start();
});
broadcastServer.on("client-timer-stop", () => {
	timer.stop();
});
broadcastServer.on("client-timer-adjust", (minutes) => {
	timer.adjust(minutes);
});

// IPC handlers

state.onToggleWindow = toggleMainWindow;

ipcMain.on("set-course-menu", (event, payload) => {
	setCourseMenuState(payload);
	createApplicationMenu();
});

ipcMain.on("update-students", (event, students) => {
	broadcastServer.updateStudents(students);
});

ipcMain.on(
	"enter-question-block",
	(event, { question, options, students, bgColor }) => {
		state.pause("question");
		broadcastServer.broadcastQuestionStarted(
			question,
			students,
			bgColor,
			options,
		);
		openQuestionWindow(question, bgColor);
		floatState.questionOptions = options || [];
		armQuestionShow();
	},
);

ipcMain.on("randomizer-done", (event, index) => {
	const names = broadcastServer.currentState.students || [];
	const name = names[index];
	if (name != null) {
		broadcastServer.broadcast({
			type: "randomizer-result",
			data: { index, name },
		});
	}
});

const FLOAT_WINDOWS = [
	{ name: "question", float: _questionFloat },
	{ name: "randomizer", float: _randomizerFloat, close: "force" },
	{ name: "options", float: _optionsFloat, close: "force" },
	{
		name: "image",
		float: _imageFloat,
		close: "soft",
		forceClose: true,
		pin: true,
		popup: true,
	},
	{
		name: "web",
		float: _webFloat,
		close: "soft",
		forceClose: true,
		pin: true,
		popup: true,
	},
];

for (const w of FLOAT_WINDOWS) {
	ipcMain.on(`open-${w.name}-devtools`, () => {
		const win = w.float.activeWin;
		if (win) win.webContents.openDevTools({ mode: "detach" });
	});
	if (w.close) {
		ipcMain.on(`close-${w.name}-window`, () => {
			w.float.close(w.close === "force" ? { force: true } : undefined);
			if (w.popup) endPopupIfOpen(w.name);
		});
	}
	if (w.forceClose) {
		ipcMain.on(`force-close-${w.name}-window`, () =>
			w.float.close({ force: true }),
		);
	}
	if (w.pin) {
		ipcMain.on(`pin-${w.name}-window`, (event, pinned) =>
			w.float.setPinned(pinned),
		);
	}
}

ipcMain.on("question-window-shape", (event, shape) => {
	if (shape === "circle") setQuestionWindowSquare();
});

ipcMain.on("close-question-window", () => {
	endQuestion();
	_questionFloat.close({ force: true });
	broadcastServer.broadcastQuestionEnded();
});

ipcMain.on("enter-move-to-block", (event, payload) =>
	enterPopup("move-to", payload),
);
ipcMain.on("close-move-to-window", () => endPopup("move-to"));

ipcMain.on("enter-code-insert-block", (event, payload) =>
	enterPopup("code-insert", payload),
);
ipcMain.on("close-code-insert-window", () => endPopup("code-insert"));

ipcMain.on("enter-note-block", (event, payload) => enterPopup("note", payload));
ipcMain.on("close-note-window", () => endPopup("note"));

ipcMain.on("enter-image-block", (event, payload) =>
	enterPopup("image", payload),
);
ipcMain.on("enter-web-block", (event, payload) => enterPopup("web", payload));

ipcMain.on("start-interaction", (event, interactionType) => {
	broadcastServer.broadcast({
		type: "open-interaction",
		data: { interactionType },
	});
});

const DESK_ACTIONS = new Set([
	"client-move-to-confirmed",
	"client-code-insert-confirmed",
	"client-move-to-type-name",
	"client-note-confirmed",
	"client-media-confirmed",
	"client-show-question",
	"client-student-answered",
	"client-dismiss-question",
	"client-question-randomize",
	"client-question-show-options",
	"client-interaction",
	"client-interaction-overlay-shown",
	"client-interaction-overlay-closed",
	"client-show-student-interaction",
	"client-close-student-interaction",
]);

ipcMain.on("desk-action", (event, payload) => {
	const type = payload && payload.type;
	if (!DESK_ACTIONS.has(type)) return;
	const args = Array.isArray(payload.args) ? payload.args : [];
	broadcastServer.emit(type, ...args);
});

ipcMain.on(
	"open-image-window",
	(event, { imageName, lessonFilePath, bgColor, shouldPin }) => {
		if (!lessonFilePath) return;
		const imagePath = path.join(
			path.dirname(lessonFilePath),
			"images",
			imageName,
		);
		if (!fs.existsSync(imagePath)) {
			console.log(`[LEO] image not found: ${imagePath}`);
			return;
		}
		_imageFloat.showOrReuse(
			{ imagePath, bgColor, shouldPin },
			{ shouldPin, gatePin: true },
		);
	},
);

const IMAGE_WINDOW_DISPLAY_SCALE = 0.95;

ipcMain.on("resize-image-window", (event, { width, height }) => {
	const win = _imageFloat.activeWin;
	if (!win) return;
	const display = screen.getPrimaryDisplay();
	const maxW = Math.floor(
		display.workAreaSize.width * IMAGE_WINDOW_DISPLAY_SCALE,
	);
	const maxH = Math.floor(
		display.workAreaSize.height * IMAGE_WINDOW_DISPLAY_SCALE,
	);
	const scale = Math.min(1, maxW / width, maxH / height);
	const newW = Math.round(width * scale);
	const newH = Math.round(height * scale);
	win.setSize(newW, newH);
	win.center();
	const b = win.getBounds();
	_imageFloat.rect = { x: b.x, y: b.y, w: b.width, h: b.height };
});

ipcMain.on("open-web-window", (event, { url, bgColor, shouldPin }) => {
	_webFloat.showOrReuse(
		{ url, bgColor, shouldPin },
		{ shouldPin, gatePin: true },
	);
});

let activeResize = null;
function stopActiveResize() {
	if (!activeResize) return;
	clearInterval(activeResize.interval);
	ipcMain.removeListener("end-resizing", activeResize.stopResize);
	activeResize = null;
}

ipcMain.on("start-resizing", (event, edge) => {
	stopFloatLerp();
	stopActiveResize();
	const win = event.sender.getOwnerBrowserWindow();
	if (!win) return;
	const initBounds = win.getBounds();
	const initCursor = screen.getCursorScreenPoint();
	const stopResize = () => stopActiveResize();
	ipcMain.once("end-resizing", stopResize);
	const interval = setInterval(() => {
		if (!win || win.isDestroyed()) {
			stopActiveResize();
			return;
		}
		const cur = screen.getCursorScreenPoint();
		const dx = cur.x - initCursor.x;
		const dy = cur.y - initCursor.y;
		const b = { ...initBounds };
		if (edge === "move") {
			b.x = initBounds.x + dx;
			b.y = initBounds.y + dy;
			win.setBounds(b);
			return;
		}
		if (edge.includes("right")) {
			b.width = Math.max(220, initBounds.width + dx);
		}
		if (edge.includes("bottom")) {
			b.height = Math.max(150, initBounds.height + dy);
		}
		if (edge.includes("left")) {
			b.x = initBounds.x + dx;
			b.width = Math.max(220, initBounds.width - dx);
		}
		if (edge.includes("top")) {
			b.y = initBounds.y + dy;
			b.height = Math.max(150, initBounds.height - dy);
		}
		win.setBounds(b);
	}, 16);
	activeResize = { interval, stopResize };
});

ipcMain.on("set-active", (event, isActive) => {
	state.isActive = isActive;
	broadcastServer.updateActiveState(isActive);
	if (isActive) {
		cleanupAutoTyping();
		state.clearQueue();
		state.send("stop-auto-typing");
		hotkeyManager.registerTypingHotkeys();
	} else {
		hotkeyManager.unregisterTypingHotkeys();
	}
});
ipcMain.on("set-active", () => autoPilot.onActiveChanged());
ipcMain.on("type-character", (event, char) =>
	keyboardHandler.typeCharacter(char),
);
ipcMain.on("input-complete", () => keyboardHandler.processQueue());
ipcMain.on("auto-typing-complete", () => cleanupAutoTyping());
ipcMain.on(
	"start-auto-type-block",
	async (event, { steps, startIndex, speed }) => {
		await keyboardHandler.autoTypeBlock(steps, startIndex, speed);
		cleanupAutoTyping();
		state.send("auto-typing-finished");
	},
);

ipcMain.handle("show-save-dialog", async (event, opts = {}) => {
	const result = await dialog.showSaveDialog(state.mainWindow, {
		filters: [{ name: "LEO Lesson", extensions: ["leo", "json"] }],
		defaultPath: opts.defaultPath || "lesson.leo",
		title: opts.title || undefined,
	});
	return result.filePath;
});
ipcMain.handle("show-open-dialog", async (event, opts = {}) => {
	const result = await dialog.showOpenDialog(state.mainWindow, {
		filters: [{ name: "LEO Lesson", extensions: ["leo", "json"] }],
		properties: ["openFile"],
		defaultPath: opts.defaultPath || undefined,
	});
	return result.filePaths[0];
});
ipcMain.handle("show-open-course-dialog", async () => {
	const result = await dialog.showOpenDialog(state.mainWindow, {
		title: "Open Course Folder",
		properties: ["openDirectory"],
	});
	return result.filePaths[0];
});
ipcMain.handle("show-create-course-dialog", async () => {
	const result = await dialog.showSaveDialog(state.mainWindow, {
		title: "New Course",
		buttonLabel: "Create Course",
		defaultPath: "MyCourse",
		properties: ["createDirectory"],
	});
	return result.filePath;
});

ipcMain.on("update-window-title", (event, titleData) => {
	if (!state.mainWindow) return;
	let fileName, studentCount, courseName;
	if (typeof titleData === "object" && titleData !== null)
		({ fileName, studentCount, courseName } = titleData);
	else {
		fileName = titleData;
		studentCount = null;
	}
	const hasUnsaved = typeof fileName === "string" && fileName.endsWith(" *");
	const cleanName = hasUnsaved ? fileName.slice(0, -2) : fileName;
	state.mainWindow.setTitle(
		buildWindowTitle(cleanName, studentCount, hasUnsaved, courseName),
	);
});

ipcMain.on("update-lesson-data", (e, d) => broadcastServer.updateLessonData(d));
ipcMain.on("update-cursor", (e, s) => broadcastServer.updateCursor(s));
ipcMain.on("update-progress", (e, d) =>
	broadcastServer.updateProgress(d.currentStep, d.totalSteps),
);
ipcMain.handle("get-settings", () => settingsManager.getAll());
ipcMain.handle("get-server-info", async () => broadcastServer.getServerInfo());

ipcMain.on("save-settings", (event, settings) => {
	Object.keys(settings).forEach((key) => {
		const incoming = settings[key];
		const isPlainObject =
			incoming !== null &&
			typeof incoming === "object" &&
			!Array.isArray(incoming);
		settingsManager.settings[key] = isPlainObject
			? { ...settingsManager.settings[key], ...incoming }
			: incoming;
	});
	settingsManager.save();
	reapplySettings();
	broadcastServer.updateSettings(settingsManager.getAll());
	createApplicationMenu();
	event.reply("settings-saved", settingsManager.getAll());
});
ipcMain.on("reset-settings", (event) => {
	settingsManager.reset();
	reapplySettings();
	broadcastServer.updateSettings(settingsManager.getAll());
	event.reply("settings-loaded", settingsManager.getAll());
});

ipcMain.on("open-log-visualizer", (_event, logFilePath) => {
	openLogVisualizer(logFilePath);
});

// window functions

function reapplySettings() {
	hotkeyManager.unregisterAll();
	hotkeyManager.registerSystemShortcuts();
	if (state.isActive) {
		hotkeyManager.registerTypingHotkeys();
	}
	if (state.isAutoTyping) {
		hotkeyManager.registerEscapeForAutoTyping();
	}
	const kind = openPopupKind();
	if (kind) hotkeyManager.registerConfirmPopup(confirmKeyFor(kind));
	else rearmQuestionShow();
	keyboardHandler.updatePlatformSettings();
}

function cleanup() {
	hotkeyManager.unregisterTypingHotkeys();
	state.reset();
}

function cleanupAutoTyping() {
	state.stopAutoTyping();
	state.unlock();
	hotkeyManager.unregisterEscape();
}

const EDITOR_SETTINGS_FILE = path.join(
	__dirname,
	"../../settings/vscode_settings.json",
);

async function showEditorTipOnce() {
	if (settingsManager.get("editorTipSeen")) return;
	settingsManager.set("editorTipSeen", true);
	if (!fs.existsSync(EDITOR_SETTINGS_FILE)) return;
	const { response } = await dialog.showMessageBox(state.mainWindow, {
		type: "info",
		title: "Recommended editor settings",
		message: "LEO types into your editor as if you were typing.",
		detail:
			"Autocomplete, bracket closing and suggestion popups " +
			"may interfere with your lesson plans. I recommend you switch to the settings provided in:\n" +
			"settings/vscode_settings.json before you get used to LEO (paste it into your VS Code settings.json)\n\n" +
			"This message is shown only once.",
		buttons: ["Show me the settings", "Later"],
		defaultId: 0,
		cancelId: 1,
	});
	if (response === 0) shell.showItemInFolder(EDITOR_SETTINGS_FILE);
}

async function createWindow() {
	const config = {
		...WINDOW_CONFIG,
		autoHideMenuBar: false,
		icon: path.join(__dirname, "../shared/icon.ico"),
	};
	state.mainWindow = new BrowserWindow(config);
	createApplicationMenu();
	state.mainWindow.loadFile(path.join(__dirname, "../index.html"));
	try {
		await broadcastServer.start();
	} catch (err) {
		console.error("[LEO] server failed to start:", err);
	}
	broadcastServer.updateSettings(settingsManager.getAll());
	hotkeyManager.registerSystemShortcuts();
	state.mainWindow.webContents.on("did-finish-load", () => {
		state.mainWindow.webContents.send(
			"settings-loaded",
			settingsManager.getAll(),
		);
		autoPilot.sync();
		showEditorTipOnce();
		if (pendingOpenFile) {
			_sendOpenPath(pendingOpenFile);
			pendingOpenFile = null;
		}
	});
	state.mainWindow.on("close", () => {
		app.isQuitting = true;
		if (tray) {
			tray.destroy();
			tray = null;
		}
		closeAllChildWindows();
	});
	state.mainWindow.on("focus", () => createApplicationMenu());
	state.mainWindow.on("closed", () => {
		state.mainWindow = null;
	});
	state.mainWindow.on("minimize", (event) => {
		event.preventDefault();
		state.mainWindow.hide();
	});
}

function createTray() {
	const trayIcon = nativeImage.createFromPath(
		path.join(__dirname, "../shared/icon.ico"),
	);
	tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));
	tray.setToolTip("LEO");
	tray.on("click", () => toggleMainWindow());
	tray.setContextMenu(
		Menu.buildFromTemplate([
			{
				label: "Quit",
				click: () => {
					app.isQuitting = true;
					app.quit();
				},
			},
		]),
	);
}

function toggleMainWindow() {
	if (!state.mainWindow) return;
	if (!state.mainWindow.isVisible()) {
		state.mainWindow.show();
		state.mainWindow.focus();
	} else if (!state.mainWindow.isFocused()) {
		state.mainWindow.focus();
	} else {
		state.mainWindow.hide();
	}
}

const OPENABLE_FILE_RE = /\.(leo|json|leo-course)$/i;
const COURSE_FILE_RE = /\.leo-course$/i;

let pendingOpenFile = _extractLeoPath(process.argv);

function _extractLeoPath(argv) {
	for (const arg of argv.slice(1)) {
		if (typeof arg !== "string") continue;
		if (OPENABLE_FILE_RE.test(arg) && fs.existsSync(arg)) return arg;
	}
	return null;
}

function _sendOpenPath(filePath) {
	if (COURSE_FILE_RE.test(filePath)) {
		state.mainWindow.webContents.send(
			"open-course-path",
			path.dirname(filePath),
		);
	} else {
		state.mainWindow.webContents.send("open-plan-file", filePath);
	}
}

function _openPlanInWindow(filePath) {
	if (!filePath || !state.mainWindow) return;
	if (state.mainWindow.isMinimized()) state.mainWindow.restore();
	state.mainWindow.show();
	state.mainWindow.focus();
	_sendOpenPath(filePath);
}

if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.on("second-instance", (_event, argv) => {
		const filePath = _extractLeoPath(argv);
		if (filePath) {
			_openPlanInWindow(filePath);
		} else if (state.mainWindow) {
			if (state.mainWindow.isMinimized()) state.mainWindow.restore();
			state.mainWindow.show();
			state.mainWindow.focus();
		}
	});
	app.on("open-file", (event, filePath) => {
		event.preventDefault();
		if (state.mainWindow) _openPlanInWindow(filePath);
		else pendingOpenFile = filePath;
	});
	app.whenReady().then(() => {
		createWindow().catch((err) => {
			console.error("[LEO] main window failed:", err);
		});
		createTray();
	});
}
app.on("window-all-closed", () => {
	app.quit();
});
app.on("activate", () => {
	if (state.mainWindow === null) createWindow();
});
app.on("will-quit", () => {
	cleanup();
	if (tray) tray.destroy();
});
