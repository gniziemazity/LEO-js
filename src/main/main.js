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
const os = require("os");
const http = require("http");
const { WINDOW_CONFIG } = require("../shared/constants");
const state = require("./state");
const HotkeyManager = require("./hotkey-manager");
const KeyboardHandler = require("./keyboard-handler");
const LEOBroadcastServer = require("./websocket-server");
const SettingsManager = require("./settings-manager");
const settingsManager = new SettingsManager();
const broadcastServer = new LEOBroadcastServer(8080);
const hotkeyManager = new HotkeyManager(settingsManager);
const keyboardHandler = new KeyboardHandler(hotkeyManager, settingsManager);

let tray = null;
let questionWindow = null;
let questionWindowIsLesson = false;
let questionWindowStudentAnswered = null;
let questionWindowRect = null;
let imageWindow = null;
let imageWindowPinned = false;
let imageWindowRect = null;
let webWindow = null;
let webWindowPinned = false;
let webWindowRect = null;
let visualizerWindow = null;

function resolveStudentName(field) {
	if (field == null) return null;
	const students = broadcastServer.currentState.students || [];
	if (typeof field === "number" && Number.isInteger(field)) {
		return students[field - 1] || null;
	}
	if (typeof field === "string") {
		const trimmed = field.trim();
		if (!trimmed) return null;
		const asNum = Number(trimmed);
		if (Number.isInteger(asNum) && String(asNum) === trimmed) {
			return students[asNum - 1] || null;
		}
		return trimmed;
	}
	return null;
}

broadcastServer.on("client-toggle-active", () => {
	state.mainWindow.webContents.send("global-toggle-active");
});
broadcastServer.on("client-jump-to", (stepIndex) => {
	state.mainWindow.webContents.send("client-jump-to", stepIndex);
});
broadcastServer.on("client-interaction", (interactionType) => {
	state.mainWindow.webContents.send("log-interaction", interactionType);
});
broadcastServer.on("client-student-answered", (studentName) => {
	state.unpause();
	const resolved = resolveStudentName(studentName);
	questionWindowStudentAnswered = resolved;
	if (state.mainWindow) {
		state.mainWindow.webContents.send("question-answered", {
			studentName: resolved,
		});
	}
	if (questionWindow && !questionWindow.isDestroyed()) {
		questionWindow.webContents.send("set-answered", resolved);
	}
});
broadcastServer.on(
	"client-student-interaction",
	(interactionType, studentName, questionText, openedAt, closedAt) => {
		if (state.mainWindow) {
			state.mainWindow.webContents.send("log-student-interaction", {
				interactionType,
				studentName: resolveStudentName(studentName),
				questionText,
				openedAt,
				closedAt,
			});
		}
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
		questionWindowIsLesson = false;
		if (questionWindow && !questionWindow.isDestroyed()) {
			questionWindow.close();
			questionWindow = null;
		}
		broadcastServer.broadcastQuestionEnded();
		if (state.mainWindow) {
			state.mainWindow.webContents.send("log-student-interaction", {
				interactionType,
				studentName: resolveStudentName(studentName),
				questionText,
				openedAt,
				closedAt,
			});
		}
	},
);

const { mouse, Button, Point } = require("@computer-use/nut-js");
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
broadcastServer.on("client-disconnected", async () => {
	if (!mouseDragActive) return;
	try {
		mouseDragActive = false;
		await mouse.releaseButton(Button.LEFT);
	} catch (e) {}
});

function getActiveFloatingWindow() {
	if (questionWindow && !questionWindow.isDestroyed()) return questionWindow;
	if (imageWindow && !imageWindow.isDestroyed()) return imageWindow;
	if (webWindow && !webWindow.isDestroyed()) return webWindow;
	return null;
}

let floatTargetX = null;
let floatTargetY = null;
let floatTargetW = null;
let floatTargetH = null;
let floatLerpTimer = null;
let floatPrevBX = -1;
let floatPrevBY = -1;
let floatPrevBW = -1;
let floatPrevBH = -1;
const FLOAT_LERP = 0.5;

function startFloatLerp() {
	if (floatLerpTimer) return;
	floatLerpTimer = setInterval(() => {
		const win = getActiveFloatingWindow();
		if (!win) {
			stopFloatLerp();
			return;
		}
		const rect =
			win === questionWindow
				? questionWindowRect
				: win === imageWindow
					? imageWindowRect
					: webWindowRect;
		if (!rect || floatTargetX === null) {
			stopFloatLerp();
			return;
		}
		rect.x += (floatTargetX - rect.x) * FLOAT_LERP;
		rect.y += (floatTargetY - rect.y) * FLOAT_LERP;
		rect.w += (floatTargetW - rect.w) * FLOAT_LERP;
		rect.h += (floatTargetH - rect.h) * FLOAT_LERP;
		const bx = Math.round(rect.x);
		const by = Math.round(rect.y);
		const bw = Math.max(200, Math.round(rect.w));
		const bh = Math.max(150, Math.round(rect.h));
		if (
			bx !== floatPrevBX ||
			by !== floatPrevBY ||
			bw !== floatPrevBW ||
			bh !== floatPrevBH
		) {
			floatPrevBX = bx;
			floatPrevBY = by;
			floatPrevBW = bw;
			floatPrevBH = bh;
			win.setBounds({ x: bx, y: by, width: bw, height: bh });
		}
		if (
			Math.abs(rect.x - floatTargetX) < 1 &&
			Math.abs(rect.y - floatTargetY) < 1 &&
			Math.abs(rect.w - floatTargetW) < 1 &&
			Math.abs(rect.h - floatTargetH) < 1
		) {
			rect.x = floatTargetX;
			rect.y = floatTargetY;
			rect.w = floatTargetW;
			rect.h = floatTargetH;
			stopFloatLerp();
		}
	}, 16);
}

function stopFloatLerp() {
	if (floatLerpTimer) {
		clearInterval(floatLerpTimer);
		floatLerpTimer = null;
	}
	floatTargetX = floatTargetY = floatTargetW = floatTargetH = null;
	floatPrevBX = floatPrevBY = floatPrevBW = floatPrevBH = -1;
}

function getFloatRect() {
	const win = getActiveFloatingWindow();
	if (!win) return null;
	const rect =
		win === questionWindow
			? questionWindowRect
			: win === imageWindow
				? imageWindowRect
				: webWindowRect;
	return rect || null;
}

function ensureFloatTargets(rect) {
	if (floatTargetX === null) {
		floatTargetX = rect.x;
		floatTargetY = rect.y;
		floatTargetW = rect.w;
		floatTargetH = rect.h;
	}
}

broadcastServer.on("client-window-pinch", (scale, dx, dy) => {
	const rect = getFloatRect();
	if (!rect) return;
	ensureFloatTargets(rect);
	const newW = Math.max(200, floatTargetW * scale);
	const newH = Math.max(150, floatTargetH * scale);
	floatTargetX -= (newW - floatTargetW) / 2;
	floatTargetY -= (newH - floatTargetH) / 2;
	floatTargetW = newW;
	floatTargetH = newH;
	floatTargetX += dx;
	floatTargetY += dy;
	startFloatLerp();
});
broadcastServer.on("client-window-drag", (dx, dy) => {
	const rect = getFloatRect();
	if (rect) {
		ensureFloatTargets(rect);
		floatTargetX += dx;
		floatTargetY += dy;
		startFloatLerp();
	}
});
broadcastServer.on("client-window-resize", (scaleX, scaleY) => {
	const rect = getFloatRect();
	if (rect) {
		ensureFloatTargets(rect);
		const newW = Math.max(200, floatTargetW * scaleX);
		const newH = Math.max(150, floatTargetH * scaleY);
		floatTargetX -= (newW - floatTargetW) / 2;
		floatTargetY -= (newH - floatTargetH) / 2;
		floatTargetW = newW;
		floatTargetH = newH;
		startFloatLerp();
	}
});
broadcastServer.on("client-remote-key-press", () => {
	hotkeyManager.handleKey("remote");
});

const MainProcessTimer = require("./main-timer");
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

async function createWindow() {
	const config = {
		...WINDOW_CONFIG,
		autoHideMenuBar: false,
		icon: path.join(__dirname, "../shared/icon.ico"),
	};
	state.mainWindow = new BrowserWindow(config);
	createApplicationMenu();
	state.mainWindow.loadFile(path.join(__dirname, "../index.html"));
	await broadcastServer.start();
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
		if (tray) {
			tray.destroy();
			tray = null;
		}
		app.isQuitting = true;
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

function cleanup() {
	hotkeyManager.unregisterTypingHotkeys();
	state.reset();
}
function cleanupAutoTyping() {
	state.stopAutoTyping();
	state.unlock();
	hotkeyManager.unregisterEscape();
}

function setMenuMode(mode) {
	settingsManager.set("mode", mode);
	if (state.mainWindow) {
		state.mainWindow.webContents.send("apply-mode", mode);
	}
	createApplicationMenu();
}

let courseMenuState = { open: false, plans: [], currentPath: "" };

const LESSON_TOOLS = [
	{ label: "Timeline", file: "timeline.html", perLesson: true },
	{ label: "Simulator", file: "simulator.html", perLesson: true },
	{ label: "Students", file: "students.html", perLesson: true },
	{ label: "Overview", file: "overview.html", perLesson: false },
];
const lessonToolWindows = new Map();

function createApplicationMenu() {
	const currentMode = settingsManager.get("mode") || "record";

	const template = [
		{
			label: "File",
			submenu: [
				{
					label: "New Course",
					click: () => state.mainWindow.webContents.send("new-course"),
				},
				{
					label: "Open Course",
					click: () => state.mainWindow.webContents.send("open-course"),
				},
				{
					label: "Save Course",
					click: () => state.mainWindow.webContents.send("save-course"),
				},
				...(courseMenuState.open
					? [
							{
								label: "Close Course",
								click: () =>
									state.mainWindow.webContents.send("close-course"),
							},
						]
					: []),
				{ type: "separator" },
				...(courseMenuState.open
					? []
					: [
							{
								label: "New Plan",
								accelerator: "CmdOrCtrl+N",
								click: () =>
									state.mainWindow.webContents.send("new-plan"),
							},
						]),
				{
					label: "Save Plan",
					accelerator: "CmdOrCtrl+S",
					click: () => state.mainWindow.webContents.send("save-plan"),
				},
				...(courseMenuState.open
					? []
					: [
							{
								label: "Load Plan",
								accelerator: "CmdOrCtrl+O",
								click: () =>
									state.mainWindow.webContents.send("load-plan"),
							},
						]),
				{ type: "separator" },
				{
					label: "Add Students…",
					click: () => state.mainWindow.webContents.send("add-students"),
				},
				{ type: "separator" },
				{
					label: "Exit",
					accelerator: "CmdOrCtrl+Q",
					click: () => {
						app.isQuitting = true;
						app.quit();
					},
				},
			],
		},
		{
			label: "Edit",
			submenu: [
				{
					label: "Undo",
					accelerator: "CmdOrCtrl+Z",
					click: () => state.mainWindow.webContents.send("undo"),
				},
				{
					label: "Redo",
					accelerator: "CmdOrCtrl+Shift+Z",
					click: () => state.mainWindow.webContents.send("redo"),
				},
				{ type: "separator" },
				{
					label: "Settings",
					accelerator: "CmdOrCtrl+,",
					click: () => state.mainWindow.webContents.send("open-settings"),
				},
				{ type: "separator" },
				{
					label: "Toggle Developer Tools",
					accelerator: "CmdOrCtrl+I",
					click: () => state.mainWindow.webContents.toggleDevTools(),
				},
			],
		},
		{
			label: "Mode",
			submenu: [
				{
					label: "Record",
					type: "radio",
					checked: currentMode === "record",
					click: () => setMenuMode("record"),
				},
				{
					label: "Classroom",
					type: "radio",
					checked: currentMode === "classroom",
					click: () => setMenuMode("classroom"),
				},
				{
					label: "Scientific",
					type: "radio",
					checked: currentMode === "scientific",
					click: () => setMenuMode("scientific"),
				},
			],
		},
		{
			label: "Tools",
			submenu: [
				{ label: "VSCode", click: () => launchVSCode() },
				{ label: "Chrome", click: () => launchExternalApp("chrome") },
				...(courseMenuState.open
					? [
							{ type: "separator" },
							...LESSON_TOOLS.map((t) => ({
								label: t.label,
								click: () => openLessonTool(t),
							})),
						]
					: []),
			],
		},
	];

	if (courseMenuState.open) {
		const planItems = courseMenuState.plans.length
			? courseMenuState.plans.map((p) => ({
					label: p.name,
					type: "radio",
					checked: p.path === courseMenuState.currentPath,
					click: () =>
						state.mainWindow.webContents.send("open-plan-file", p.path),
				}))
			: [{ label: "(no plans yet)", enabled: false }];
		template.splice(1, 0, {
			label: "Plans",
			submenu: [
				{
					label: "Add Plan",
					accelerator: "CmdOrCtrl+N",
					click: () => state.mainWindow.webContents.send("new-plan"),
				},
				{ type: "separator" },
				...planItems,
			],
		});
	}

	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.on("toggle-window", () => toggleMainWindow());
state.onToggleWindow = toggleMainWindow;

ipcMain.on("set-course-menu", (event, payload) => {
	courseMenuState = {
		open: !!(payload && payload.open),
		plans: (payload && payload.plans) || [],
		currentPath: (payload && payload.currentPath) || "",
	};
	createApplicationMenu();
});

ipcMain.on("broadcast-students", (event, students) => {
	broadcastServer.updateStudents(students);
});

ipcMain.on("enter-question-block", (event, { question, students, bgColor }) => {
	state.pause();
	broadcastServer.broadcastQuestionStarted(question, students, bgColor);
	openQuestionWindow(question, bgColor);
});

function _makeFloatingWindow({
	width,
	height,
	x,
	y,
	title,
	html,
	extraWebPrefs,
}) {
	const win = new BrowserWindow({
		width,
		height,
		...(x != null ? { x } : {}),
		...(y != null ? { y } : {}),
		frame: false,
		transparent: true,
		resizable: true,
		autoHideMenuBar: true,
		alwaysOnTop: true,
		title,
		icon: path.join(__dirname, "../shared/icon.ico"),
		webPreferences: {
			nodeIntegration: true,
			contextIsolation: false,
			...(extraWebPrefs || {}),
		},
	});
	broadcastServer.broadcastFloatingWindowOpened();
	win.setMenu(null);
	win.loadFile(path.join(__dirname, html));
	return win;
}

function _floatRect(win) {
	const b = win.getBounds();
	return { x: b.x, y: b.y, w: b.width, h: b.height };
}

function _trackWindowRect(win, getRect) {
	win.on("move", () => {
		const r = getRect();
		if (!win.isDestroyed() && r) {
			const b = win.getBounds();
			r.x = b.x;
			r.y = b.y;
		}
	});
	win.on("resize", () => {
		const r = getRect();
		if (!win.isDestroyed() && r) {
			const b = win.getBounds();
			r.w = b.width;
			r.h = b.height;
		}
	});
}

function openQuestionWindow(question, bgColor, emoji, studentName) {
	const payload = { question, bgColor, emoji, studentName };
	questionWindowIsLesson = !studentName;
	questionWindowStudentAnswered = null;
	if (questionWindow && !questionWindow.isDestroyed()) {
		broadcastServer.signalFloatingWindowOpen();
		questionWindow.webContents.send("set-question", payload);
		questionWindow.show();
		questionWindow.focus();
	} else {
		const display = screen.getPrimaryDisplay();
		const workArea = display.workArea;
		const winW = 900;
		const winH = 480;
		const offX = Math.floor(workArea.x + (workArea.width - winW) / 2);
		const offY = questionWindowIsLesson
			? workArea.y + workArea.height + 40
			: Math.floor(workArea.y + (workArea.height - winH) / 2);
		questionWindow = _makeFloatingWindow({
			width: winW,
			height: winH,
			x: offX,
			y: offY,
			title: "Question",
			html: "../question-window.html",
		});
		questionWindowRect = _floatRect(questionWindow);
		const qWin = questionWindow;
		qWin.webContents.on("did-finish-load", () => {
			if (!qWin.isDestroyed())
				qWin.webContents.send("set-question", payload);
		});
		questionWindow.on("closed", () => {
			if (questionWindowIsLesson) {
				broadcastServer.broadcastQuestionEnded();

				if (state.mainWindow && questionWindowStudentAnswered === null) {
					state.mainWindow.webContents.send("question-answered", {
						studentName: null,
					});
				}
				if (state.mainWindow) {
					state.mainWindow.webContents.send("question-window-closed");
				}
			}
			broadcastServer.broadcastFloatingWindowClosed();
			questionWindow = null;
			questionWindowRect = null;
			questionWindowStudentAnswered = null;
		});
		_trackWindowRect(questionWindow, () => questionWindowRect);
	}
}

let questionWindowSlideTimer = null;
function animateQuestionWindowOnScreen() {
	if (!questionWindow || questionWindow.isDestroyed()) return;
	if (questionWindowSlideTimer) {
		clearInterval(questionWindowSlideTimer);
		questionWindowSlideTimer = null;
	}
	const display = screen.getPrimaryDisplay();
	const workArea = display.workArea;
	const bounds = questionWindow.getBounds();
	const targetY = Math.floor(
		workArea.y + (workArea.height - bounds.height) / 2,
	);
	const startY = bounds.y;
	if (startY === targetY) return;
	const startTime = Date.now();
	const duration = 600;
	questionWindowSlideTimer = setInterval(() => {
		if (!questionWindow || questionWindow.isDestroyed()) {
			clearInterval(questionWindowSlideTimer);
			questionWindowSlideTimer = null;
			return;
		}
		const t = Math.min(1, (Date.now() - startTime) / duration);
		const eased = 1 - Math.pow(1 - t, 3);
		const newY = Math.round(startY + (targetY - startY) * eased);
		const b = questionWindow.getBounds();
		questionWindow.setBounds({
			x: b.x,
			y: newY,
			width: b.width,
			height: b.height,
		});
		if (questionWindowRect) questionWindowRect.y = newY;
		if (t >= 1) {
			clearInterval(questionWindowSlideTimer);
			questionWindowSlideTimer = null;
		}
	}, 16);
}

broadcastServer.on("client-show-question", () => {
	animateQuestionWindowOnScreen();
	if (state.mainWindow) {
		state.mainWindow.webContents.send("question-shown");
	}
});

ipcMain.on("close-question-window", () => {
	state.unpause();
	if (questionWindow && !questionWindow.isDestroyed()) {
		questionWindow.close();
		questionWindow = null;
	}
	broadcastServer.broadcastQuestionEnded();
});

ipcMain.on("enter-move-to-block", (event, payload) => {
	state.pause();
	broadcastServer.broadcastMoveToStarted(payload);
});

ipcMain.on("close-move-to-window", () => {
	state.unpause();
	broadcastServer.broadcastMoveToEnded();
});

broadcastServer.on("client-move-to-confirmed", () => {
	state.unpause();
	broadcastServer.broadcastMoveToEnded();
	if (state.mainWindow) {
		state.mainWindow.webContents.send("move-to-confirmed");
	}
});

broadcastServer.on("client-dismiss-question", () => {
	state.unpause();
	if (
		questionWindowIsLesson &&
		questionWindow &&
		!questionWindow.isDestroyed()
	) {
		questionWindow.close();
		questionWindow = null;
	}
});

broadcastServer.on("client-interaction-overlay-shown", () => {
	state.pause();
	if (state.mainWindow) {
		state.mainWindow.webContents.send("stop-auto-typing");
	}
});

broadcastServer.on("client-interaction-overlay-closed", () => {
	state.unpause();
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

		if (imageWindow && !imageWindow.isDestroyed()) {
			if (!imageWindowPinned) {
				broadcastServer.signalFloatingWindowOpen();
				imageWindow.webContents.send("set-image", {
					imagePath,
					bgColor,
					shouldPin,
				});
				imageWindow.show();
				imageWindow.focus();
				if (shouldPin) imageWindowPinned = true;
			}
			return;
		}

		imageWindowPinned = shouldPin || false;
		imageWindow = _makeFloatingWindow({
			width: 900,
			height: 650,
			title: "Image",
			html: "../image-window.html",
		});
		imageWindowRect = _floatRect(imageWindow);
		const imgWin = imageWindow;
		imgWin.webContents.on("did-finish-load", () => {
			if (imgWin.isDestroyed()) return;
			imgWin.webContents.send("set-image", {
				imagePath,
				bgColor,
				shouldPin,
			});
		});
		imageWindow.on("closed", () => {
			broadcastServer.broadcastFloatingWindowClosed();
			imageWindow = null;
			imageWindowPinned = false;
			imageWindowRect = null;
		});
		_trackWindowRect(imageWindow, () => imageWindowRect);
	},
);

ipcMain.on("pin-image-window", (event, pinned) => {
	imageWindowPinned = pinned;
});

ipcMain.on("resize-image-window", (event, { width, height }) => {
	if (!imageWindow || imageWindow.isDestroyed()) return;
	const display = screen.getPrimaryDisplay();
	const maxW = Math.floor(display.workAreaSize.width * 0.95);
	const maxH = Math.floor(display.workAreaSize.height * 0.95);
	const scale = Math.min(1, maxW / width, maxH / height);
	const newW = Math.round(width * scale);
	const newH = Math.round(height * scale);
	imageWindow.setSize(newW, newH);
	imageWindow.center();
	const b = imageWindow.getBounds();
	imageWindowRect = {
		x: b.x,
		y: b.y,
		w: b.width,
		h: b.height,
	};
});

ipcMain.on("force-close-image-window", () => {
	if (imageWindow && !imageWindow.isDestroyed()) {
		imageWindow.close();
		imageWindow = null;
	}
});

ipcMain.on("close-image-window", () => {
	if (imageWindowPinned) return;
	if (imageWindow && !imageWindow.isDestroyed()) {
		imageWindow.close();
		imageWindow = null;
	}
});

ipcMain.on("open-web-window", (event, { url, bgColor, shouldPin }) => {
	if (webWindow && !webWindow.isDestroyed()) {
		if (!webWindowPinned) {
			broadcastServer.signalFloatingWindowOpen();
			webWindow.webContents.send("set-url", { url, bgColor, shouldPin });
			webWindow.show();
			webWindow.focus();
			if (shouldPin) webWindowPinned = true;
		}
		return;
	}

	webWindowPinned = shouldPin || false;
	webWindow = _makeFloatingWindow({
		width: 1100,
		height: 800,
		title: "Web",
		html: "../web-window.html",
		extraWebPrefs: { webviewTag: true },
	});
	webWindowRect = _floatRect(webWindow);
	const wWin = webWindow;
	wWin.webContents.on("did-finish-load", () => {
		if (!wWin.isDestroyed())
			wWin.webContents.send("set-url", { url, bgColor, shouldPin });
	});
	webWindow.on("closed", () => {
		broadcastServer.broadcastFloatingWindowClosed();
		webWindow = null;
		webWindowPinned = false;
		webWindowRect = null;
	});
	_trackWindowRect(webWindow, () => webWindowRect);
});

ipcMain.on("close-web-window", () => {
	if (webWindowPinned) return;
	if (webWindow && !webWindow.isDestroyed()) {
		webWindow.close();
		webWindow = null;
	}
});

ipcMain.on("force-close-web-window", () => {
	if (webWindow && !webWindow.isDestroyed()) {
		webWindow.close();
		webWindow = null;
	}
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

ipcMain.on("pin-web-window", (event, isPinned) => {
	webWindowPinned = isPinned;
});

ipcMain.on("set-active", (event, isActive) => {
	state.isActive = isActive;
	if (isActive) {
		cleanupAutoTyping();
		state.clearQueue();
		if (state.mainWindow)
			state.mainWindow.webContents.send("stop-auto-typing");
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
		if (state.mainWindow)
			state.mainWindow.webContents.send("auto-typing-finished");
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
	const { buildWindowTitle } = require("../shared/constants");
	const hasUnsaved = typeof fileName === "string" && fileName.endsWith(" *");
	const cleanName = hasUnsaved ? fileName.slice(0, -2) : fileName;
	state.mainWindow.setTitle(
		buildWindowTitle(cleanName, studentCount, hasUnsaved, courseName),
	);
});

const { shell } = require("electron");
const { spawn, spawnSync } = require("child_process");

const EXTERNAL_APPS = {
	vscode: {
		name: "VSCode",
		candidates: [
			path.join(
				process.env.LOCALAPPDATA || "",
				"Programs/Microsoft VS Code/Code.exe",
			),
			"C:/Program Files/Microsoft VS Code/Code.exe",
			"C:/Program Files (x86)/Microsoft VS Code/Code.exe",
		],
		fallback: "code",
	},
	chrome: {
		name: "Chrome",
		candidates: [
			"C:/Program Files/Google/Chrome/Application/chrome.exe",
			"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
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

const _LESSON_TOOLS_PORT = 7891;
const _LESSON_TOOLS_SERVER = path.join(
	__dirname,
	"../../lesson_tools/server.js",
);
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
	const onUnreachable = () => {
		try {
			spawn(process.execPath, [_LESSON_TOOLS_SERVER], {
				detached: true,
				stdio: "ignore",
				env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
			}).unref();
		} catch (_) {}
		setTimeout(cb, 400);
	};
	const req = http
		.get(`http://127.0.0.1:${_LESSON_TOOLS_PORT}/`, (res) => {
			res.destroy();
			cb();
		})
		.on("error", onUnreachable);
	req.setTimeout(500, () => {
		req.destroy();
		onUnreachable();
	});
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
		const scriptPath = path.join(
			__dirname,
			"../../lesson_tools/lv_expand_cli.py",
		);
		const result = spawnSync(resolvePython(), [scriptPath, logFilePath], {
			encoding: "utf8",
		});
		if (result.error) {
			payload = {
				filePath: logFilePath,
				micro: null,
				error: `Could not run Python (${resolvePython()}): ${result.error.message}`,
			};
		} else if (result.status === 0) {
			try {
				const micro = JSON.parse(result.stdout);
				payload = { filePath: logFilePath, micro, error: null };
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
		// A `resources/` folder alongside the lesson plans (sibling of the .leo,
		// i.e. one level above the logs/ folder) is exposed to the preview iframe
		// as its base URL, so relative refs like ./pieces/p1.png resolve to
		// resources/pieces/p1.png on disk — no encoding needed.
		try {
			const resDir = path.resolve(
				path.dirname(logFilePath),
				"..",
				"resources",
			);
			if (fs.existsSync(resDir) && fs.statSync(resDir).isDirectory()) {
				payload.resourcesBase = require("url")
					.pathToFileURL(resDir)
					.href.replace(/\/?$/, "/");
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
	// Push the freshly-expanded log straight into the page once it has loaded.
	// This is the single source of truth — no shared/stale data files involved.
	target.webContents.once("did-finish-load", () => {
		if (target.isDestroyed() || !payload) return;
		target.webContents
			.executeJavaScript(
				`window.__leoApplyVisData && window.__leoApplyVisData(${JSON.stringify(payload)});`,
			)
			.catch((e) => console.error("Visualizer data push failed:", e));
	});
	target.loadFile(_VIS_HTML);
	target.on("closed", () => {
		visualizerWindow = null;
	});
}

ipcMain.on("open-log-visualizer", (_event, logFilePath) => {
	openLogVisualizer(logFilePath);
});

ipcMain.on("broadcast-lesson-data", (e, d) =>
	broadcastServer.updateLessonData(d),
);
ipcMain.on("broadcast-cursor", (e, s) => broadcastServer.updateCursor(s));
ipcMain.on("broadcast-progress", (e, d) =>
	broadcastServer.updateProgress(d.currentStep, d.totalSteps),
);
ipcMain.on("broadcast-active", (e, a) => broadcastServer.updateActiveState(a));
ipcMain.on("broadcast-lesson", (e, n) => broadcastServer.updateLessonName(n));

ipcMain.handle("get-settings", () => settingsManager.getAll());
ipcMain.handle("get-server-info", async () => broadcastServer.getServerInfo());

function reapplySettings() {
	hotkeyManager.unregisterAll();
	hotkeyManager.registerSystemShortcuts();
	if (state.isActive) {
		hotkeyManager.registerTypingHotkeys();
	}
	keyboardHandler.updatePlatformSettings();
}

ipcMain.on("save-settings", (event, settings) => {
	Object.keys(settings).forEach((key) => {
		settingsManager.settings[key] = settings[key];
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
		createWindow();
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
