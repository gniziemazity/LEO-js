const {
	app,
	BrowserWindow,
	ipcMain,
	dialog,
	Menu,
	Tray,
	nativeImage,
	screen,
} = require("electron");

const path = require("path");
const fs = require("fs");
const { WINDOW_CONFIG } = require("../shared/constants");
const state = require("./state");

const {
	settingsManager,
	broadcastServer,
	hotkeyManager,
	keyboardHandler,
	resolveStudentName,
} = require("./context");
const { createApplicationMenu, setMenuMode } = require("./app-menu");
const {
	floatState,
	setPanelVisible,
	openQuestionWindow,
	closeAllChildWindows,
	setQuestionWindowSquare,
	animateQuestionWindowOnScreen,
	stopFloatLerp,
	applyWindowPinch,
	applyWindowDrag,
	applyWindowResize,
	_questionFloat,
	_imageFloat,
	_webFloat,
	_randomizerFloat,
	_optionsFloat,
} = require("./float-windows");
const {
	openLessonTool,
	openLogVisualizer,
	setCourseMenuState,
} = require("./lesson-tools");

const { mouse, Button, Point } = require("@computer-use/nut-js");
const MainProcessTimer = require("./main-timer");
const { buildWindowTitle } = require("../shared/constants");

const mainPlugin = require("./plugin");
if (mainPlugin.registerMain) {
	mainPlugin.registerMain({ ipcMain, broadcastServer });
}

let tray = null;

// broadcast handlers

broadcastServer.on("client-toggle-active", () => {
	state.send("hotkey-toggle-active");
});
broadcastServer.on("client-jump-to", (stepIndex) => {
	state.send("client-jump-to", stepIndex);
});
broadcastServer.on("client-question-randomize", () => {
	if (!floatState.questionWindow || floatState.questionWindow.isDestroyed())
		return;
	const names = broadcastServer.currentState.students || [];
	const style = settingsManager.get("randomizerStyle") || "shuffle";
	_randomizerFloat.showOrReuse(
		{ names, style, bgColor: floatState.questionWindowBgColor },
		{},
	);
});
broadcastServer.on("client-question-show-options", () => {
	if (!floatState.questionWindow || floatState.questionWindow.isDestroyed())
		return;
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
	state.unpause();
	const resolved = resolveStudentName(studentName);
	floatState.questionWindowStudentAnswered = resolved;
	const ANSWER_FADE_MS = 300;
	const reveal = () => {
		state.send("question-answered", { studentName: resolved });
		if (
			floatState.questionWindow &&
			!floatState.questionWindow.isDestroyed()
		) {
			floatState.questionWindow.webContents.send("set-answered", resolved);
		}
	};
	const fadedRandomizer = _randomizerFloat.fadeOutAndClose(ANSWER_FADE_MS);
	const fadedOptions = _optionsFloat.fadeOutAndClose(ANSWER_FADE_MS);
	if (fadedRandomizer || fadedOptions) {
		setTimeout(() => {
			if (
				floatState.questionWindow &&
				!floatState.questionWindow.isDestroyed()
			)
				reveal();
		}, ANSWER_FADE_MS);
	} else {
		reveal();
	}
});
broadcastServer.on(
	"client-student-interaction",
	(interactionType, studentName, questionText, openedAt, closedAt) => {
		state.send("log-student-interaction", {
			interactionType,
			studentName: resolveStudentName(studentName),
			questionText,
			openedAt,
			closedAt,
		});
	},
);
broadcastServer.on(
	"client-show-student-interaction",
	(interactionType, studentName, questionText, openedAt) => {
		const resolved = resolveStudentName(studentName);
		const isQuestion = interactionType === "student-question";
		const displayText = isQuestion
			? questionText || "(no question text)"
			: `Helping`;
		const emoji = isQuestion ? "❓" : "🤝";
		const bgColor = isQuestion ? "#ffe0b2" : "#c8e6c9";
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
broadcastServer.on("client-show-question", () => {
	animateQuestionWindowOnScreen();
	state.send("question-shown");
});
broadcastServer.on("client-move-to-confirmed", () => {
	state.unpause();
	broadcastServer.broadcastMoveToEnded();
	setPanelVisible(false);
	state.send("move-to-confirmed");
});
broadcastServer.on("client-dismiss-question", () => {
	state.unpause();
	if (floatState.questionWindowIsLesson) {
		_questionFloat.close({ force: true });
	}
});
broadcastServer.on("client-interaction-overlay-shown", () => {
	state.pause();
	state.send("stop-auto-typing");
});
broadcastServer.on("client-interaction-overlay-closed", () => {
	state.unpause();
	if (!floatState.questionWindow || floatState.questionWindow.isDestroyed())
		setPanelVisible(false);
});

mouse.config.autoDelayMs = 0;
mouse.config.mouseSpeed = 2000;

broadcastServer.on("client-mouse-move", async (dx, dy) => {
	try {
		const pos = await mouse.getPosition();
		await mouse.setPosition(new Point(pos.x + dx, pos.y + dy));
	} catch (e) {}
});
broadcastServer.on("client-mouse-click", async (button) => {
	try {
		if (button === "right") await mouse.rightClick();
		else await mouse.leftClick();
	} catch (e) {}
});
broadcastServer.on("client-mouse-scroll", async (dy) => {
	try {
		const amount = Math.abs(Math.round(dy));
		if (dy > 0) await mouse.scrollDown(amount);
		else await mouse.scrollUp(amount);
	} catch (e) {}
});
let mouseDragActive = false;
broadcastServer.on("client-mouse-drag-start", async () => {
	try {
		mouseDragActive = true;
		await mouse.pressButton(Button.LEFT);
	} catch (e) {}
});
broadcastServer.on("client-mouse-drag-end", async () => {
	try {
		mouseDragActive = false;
		await mouse.releaseButton(Button.LEFT);
	} catch (e) {}
});
broadcastServer.on("client-connected", () => {
	state.send("client-connected");
});
broadcastServer.on("client-disconnected", async () => {
	if (!mouseDragActive) return;
	try {
		mouseDragActive = false;
		await mouse.releaseButton(Button.LEFT);
	} catch (e) {}
});

broadcastServer.on("client-window-pinch", (scale, dx, dy) =>
	applyWindowPinch(scale, dx, dy),
);
broadcastServer.on("client-window-drag", (dx, dy) => applyWindowDrag(dx, dy));
broadcastServer.on("client-window-resize", (scaleX, scaleY) =>
	applyWindowResize(scaleX, scaleY),
);
broadcastServer.on("client-remote-key-press", () => {
	hotkeyManager.handleKey("remote");
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

ipcMain.on("toggle-window", () => toggleMainWindow());
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
		state.pause();
		broadcastServer.broadcastQuestionStarted(
			question,
			students,
			bgColor,
			options,
		);
		openQuestionWindow(question, bgColor);
		floatState.questionOptions = options || [];
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

ipcMain.on("open-question-devtools", () => {
	if (floatState.questionWindow && !floatState.questionWindow.isDestroyed()) {
		floatState.questionWindow.webContents.openDevTools({ mode: "detach" });
	}
});
ipcMain.on("open-randomizer-devtools", () => {
	if (
		floatState.randomizerWindow &&
		!floatState.randomizerWindow.isDestroyed()
	) {
		floatState.randomizerWindow.webContents.openDevTools({ mode: "detach" });
	}
});
ipcMain.on("open-options-devtools", () => {
	if (floatState.optionsWindow && !floatState.optionsWindow.isDestroyed()) {
		floatState.optionsWindow.webContents.openDevTools({ mode: "detach" });
	}
});
ipcMain.on("open-image-devtools", () => {
	if (floatState.imageWindow && !floatState.imageWindow.isDestroyed()) {
		floatState.imageWindow.webContents.openDevTools({ mode: "detach" });
	}
});
ipcMain.on("open-web-devtools", () => {
	if (floatState.webWindow && !floatState.webWindow.isDestroyed()) {
		floatState.webWindow.webContents.openDevTools({ mode: "detach" });
	}
});

ipcMain.on("question-window-shape", (event, shape) => {
	if (shape === "circle") setQuestionWindowSquare();
});

ipcMain.on("close-question-window", () => {
	state.unpause();
	_questionFloat.close({ force: true });
	broadcastServer.broadcastQuestionEnded();
});
ipcMain.on("close-randomizer-window", () => {
	_randomizerFloat.close({ force: true });
});
ipcMain.on("close-options-window", () => {
	_optionsFloat.close({ force: true });
});

ipcMain.on("enter-move-to-block", (event, payload) => {
	state.pause();
	broadcastServer.broadcastMoveToStarted(payload);
	setPanelVisible(true);
});
ipcMain.on("close-move-to-window", () => {
	state.unpause();
	broadcastServer.broadcastMoveToEnded();
	setPanelVisible(false);
});

ipcMain.on("start-interaction", (event, interactionType) => {
	setPanelVisible(true);
	broadcastServer.broadcast({
		type: "open-interaction",
		data: { interactionType },
	});
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
			console.log(`[LEO] Image not found: ${imagePath}`);
			return;
		}
		_imageFloat.showOrReuse(
			{ imagePath, bgColor, shouldPin },
			{ shouldPin, gatePin: true },
		);
	},
);
ipcMain.on("pin-image-window", (event, pinned) => {
	_imageFloat.setPinned(pinned);
});

const IMAGE_WINDOW_DISPLAY_SCALE = 0.95;

ipcMain.on("resize-image-window", (event, { width, height }) => {
	if (!floatState.imageWindow || floatState.imageWindow.isDestroyed()) return;
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
	floatState.imageWindow.setSize(newW, newH);
	floatState.imageWindow.center();
	const b = floatState.imageWindow.getBounds();
	_imageFloat.rect = { x: b.x, y: b.y, w: b.width, h: b.height };
	floatState.imageWindowRect = _imageFloat.rect;
});
ipcMain.on("force-close-image-window", () => {
	_imageFloat.close({ force: true });
});
ipcMain.on("close-image-window", () => {
	_imageFloat.close();
});

ipcMain.on("open-web-window", (event, { url, bgColor, shouldPin }) => {
	_webFloat.showOrReuse(
		{ url, bgColor, shouldPin },
		{ shouldPin, gatePin: true },
	);
});
ipcMain.on("close-web-window", () => {
	_webFloat.close();
});
ipcMain.on("force-close-web-window", () => {
	_webFloat.close({ force: true });
});
ipcMain.on("pin-web-window", (event, isPinned) => {
	_webFloat.setPinned(isPinned);
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
	if (isActive) {
		cleanupAutoTyping();
		state.clearQueue();
		state.send("stop-auto-typing");
		hotkeyManager.registerTypingHotkeys();
	} else {
		hotkeyManager.unregisterTypingHotkeys();
	}
});
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
ipcMain.on("update-active", (e, a) => broadcastServer.updateActiveState(a));
ipcMain.on("update-lesson-name", (e, n) => broadcastServer.updateLessonName(n));

ipcMain.handle("get-settings", () => settingsManager.getAll());
ipcMain.handle(
	"get-control-panel-url",
	() =>
		`http://127.0.0.1:${broadcastServer.port}/?t=${broadcastServer.token}&panel=1`,
);
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
	broadcastServer.updateSettings(settings);
	createApplicationMenu();
	event.reply("settings-saved", settingsManager.getAll());
});
ipcMain.on("reset-settings", (event) => {
	settingsManager.reset();
	reapplySettings();
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
		console.error("[LEO] Remote server failed to start:", err);
	}
	hotkeyManager.registerSystemShortcuts();
	state.mainWindow.webContents.on("did-finish-load", () => {
		state.mainWindow.webContents.send(
			"settings-loaded",
			settingsManager.getAll(),
		);
		if (pendingOpenFile) {
			state.mainWindow.webContents.send("open-plan-file", pendingOpenFile);
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

let pendingOpenFile = _extractLeoPath(process.argv);

function _extractLeoPath(argv) {
	for (const arg of argv.slice(1)) {
		if (typeof arg !== "string") continue;
		if (/\.(leo|json)$/i.test(arg) && fs.existsSync(arg)) return arg;
	}
	return null;
}

function _openPlanInWindow(filePath) {
	if (!filePath || !state.mainWindow) return;
	if (state.mainWindow.isMinimized()) state.mainWindow.restore();
	state.mainWindow.show();
	state.mainWindow.focus();
	state.mainWindow.webContents.send("open-plan-file", filePath);
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
			console.error("[LEO] Failed to create main window:", err);
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
