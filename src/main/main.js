const {
	app,
	BrowserWindow,
	ipcMain,
	dialog,
	Menu,
	Tray,
	nativeImage,
} = require("electron");
const path = require("path");
const fs = require("fs");
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
	questionWindowStudentAnswered = studentName;
	if (state.mainWindow) {
		state.mainWindow.webContents.send("question-answered", { studentName });
	}
	if (questionWindow && !questionWindow.isDestroyed()) {
		questionWindow.webContents.send("set-answered", studentName);
	}
});
broadcastServer.on(
	"client-student-interaction",
	(interactionType, studentName, questionText, openedAt, closedAt) => {
		if (state.mainWindow) {
			state.mainWindow.webContents.send("log-student-interaction", {
				interactionType,
				studentName,
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
		const isQuestion = interactionType === "student-question";
		const displayText = isQuestion
			? questionText || "(no question text)"
			: `Helping`;
		const emoji = isQuestion ? "❓" : "🤝";
		const bgColor = isQuestion ? "#ffe0b2" : "#c8e6c9";
		openQuestionWindow(displayText, bgColor, emoji, studentName);
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
				studentName,
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
	} catch (e) {
		/* ignore */
	}
});
broadcastServer.on("client-mouse-click", async (button) => {
	try {
		if (button === "right") await mouse.rightClick();
		else await mouse.leftClick();
	} catch (e) {
		/* ignore */
	}
});
broadcastServer.on("client-mouse-scroll", async (dy) => {
	try {
		const amount = Math.abs(Math.round(dy));
		if (dy > 0) await mouse.scrollDown(amount);
		else await mouse.scrollUp(amount);
	} catch (e) {
		/* ignore */
	}
});
broadcastServer.on("client-mouse-drag-start", async () => {
	try {
		await mouse.pressButton(Button.LEFT);
	} catch (e) {
		/* ignore */
	}
});
broadcastServer.on("client-mouse-drag-end", async () => {
	try {
		await mouse.releaseButton(Button.LEFT);
	} catch (e) {
		/* ignore */
	}
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
	const certDir = path.join(app.getPath("userData"), "certs");
	await broadcastServer.start(certDir);
	state.broadcastServer = broadcastServer;
	hotkeyManager.registerSystemShortcuts();
	state.mainWindow.webContents.on("did-finish-load", () => {
		state.mainWindow.webContents.send(
			"settings-loaded",
			settingsManager.getAll(),
		);
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

function createApplicationMenu() {
	Menu.setApplicationMenu(
		Menu.buildFromTemplate([
			{
				label: "File",
				submenu: [
					{
						label: "New Plan",
						accelerator: "CmdOrCtrl+N",
						click: () => state.mainWindow.webContents.send("new-plan"),
					},
					{
						label: "Save Plan",
						accelerator: "CmdOrCtrl+S",
						click: () => state.mainWindow.webContents.send("save-plan"),
					},
					{
						label: "Load Plan",
						accelerator: "CmdOrCtrl+O",
						click: () => state.mainWindow.webContents.send("load-plan"),
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
						click: () =>
							state.mainWindow.webContents.send("open-settings"),
					},
					{ type: "separator" },
					{
						label: "Toggle Developer Tools",
						accelerator: "CmdOrCtrl+I",
						click: () => state.mainWindow.webContents.toggleDevTools(),
					},
				],
			},
		]),
	);
}

ipcMain.on("toggle-window", () => toggleMainWindow());
state.onToggleWindow = toggleMainWindow;

ipcMain.handle("load-students-file", async (event, lessonFilePath) => {
	if (!lessonFilePath) return [];
	const dir = path.dirname(lessonFilePath);
	const studentsFile = path.join(dir, "students.txt");
	try {
		if (fs.existsSync(studentsFile)) {
			const content = fs.readFileSync(studentsFile, "utf8");
			return content
				.split(/\r?\n/)
				.map((l) => l.trim())
				.filter((l) => l.length > 0);
		}
	} catch (err) {
		console.error("Failed to load students.txt:", err);
	}
	return [];
});

ipcMain.on("broadcast-students", (event, students) => {
	broadcastServer.updateStudents(students);
});

ipcMain.on("enter-question-block", (event, { question, students, bgColor }) => {
	broadcastServer.broadcastQuestionStarted(question, students, bgColor);
	openQuestionWindow(question, bgColor);
});

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
		questionWindow = new BrowserWindow({
			width: 900,
			height: 480,
			frame: false,
			transparent: true,
			resizable: true,
			autoHideMenuBar: true,
			alwaysOnTop: true,
			title: "Question",
			icon: path.join(__dirname, "../shared/icon.ico"),
			webPreferences: { nodeIntegration: true, contextIsolation: false },
		});
		broadcastServer.broadcastFloatingWindowOpened();
		questionWindowRect = {
			x: questionWindow.getBounds().x,
			y: questionWindow.getBounds().y,
			w: questionWindow.getBounds().width,
			h: questionWindow.getBounds().height,
		};
		questionWindow.setMenu(null);
		questionWindow.loadFile(path.join(__dirname, "../question-window.html"));
		questionWindow.webContents.on("did-finish-load", () => {
			questionWindow.webContents.send("set-question", payload);
		});
		questionWindow.on("closed", () => {
			if (questionWindowIsLesson) {
				broadcastServer.broadcastQuestionEnded();

				if (state.mainWindow && questionWindowStudentAnswered === null) {
					state.mainWindow.webContents.send("question-answered", {
						studentName: null,
					});
				}
			}
			broadcastServer.broadcastFloatingWindowClosed();
			questionWindow = null;
			questionWindowRect = null;
			questionWindowStudentAnswered = null;
		});
		questionWindow.on("move", () => {
			if (
				questionWindow &&
				!questionWindow.isDestroyed() &&
				questionWindowRect
			) {
				const b = questionWindow.getBounds();
				questionWindowRect.x = b.x;
				questionWindowRect.y = b.y;
			}
		});
		questionWindow.on("resize", () => {
			if (
				questionWindow &&
				!questionWindow.isDestroyed() &&
				questionWindowRect
			) {
				const b = questionWindow.getBounds();
				questionWindowRect.w = b.width;
				questionWindowRect.h = b.height;
			}
		});
	}
}

ipcMain.on("close-question-window", () => {
	if (questionWindow && !questionWindow.isDestroyed()) {
		questionWindow.close();
		questionWindow = null;
	}
	broadcastServer.broadcastQuestionEnded();
});

broadcastServer.on("client-dismiss-question", () => {
	if (
		questionWindowIsLesson &&
		questionWindow &&
		!questionWindow.isDestroyed()
	) {
		questionWindow.close();
		questionWindow = null;
	}
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
		imageWindow = new BrowserWindow({
			width: 900,
			height: 650,
			frame: false,
			transparent: true,
			resizable: true,
			autoHideMenuBar: true,
			alwaysOnTop: true,
			title: "Image",
			icon: path.join(__dirname, "../shared/icon.ico"),
			webPreferences: { nodeIntegration: true, contextIsolation: false },
		});
		broadcastServer.broadcastFloatingWindowOpened();
		imageWindowRect = {
			x: imageWindow.getBounds().x,
			y: imageWindow.getBounds().y,
			w: imageWindow.getBounds().width,
			h: imageWindow.getBounds().height,
		};
		imageWindow.setMenu(null);
		imageWindow.loadFile(path.join(__dirname, "../image-window.html"));
		imageWindow.webContents.on("did-finish-load", () => {
			imageWindow.webContents.send("set-image", {
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
		imageWindow.on("move", () => {
			if (imageWindow && !imageWindow.isDestroyed() && imageWindowRect) {
				const b = imageWindow.getBounds();
				imageWindowRect.x = b.x;
				imageWindowRect.y = b.y;
			}
		});
		imageWindow.on("resize", () => {
			if (imageWindow && !imageWindow.isDestroyed() && imageWindowRect) {
				const b = imageWindow.getBounds();
				imageWindowRect.w = b.width;
				imageWindowRect.h = b.height;
			}
		});
	},
);

ipcMain.on("pin-image-window", (event, pinned) => {
	imageWindowPinned = pinned;
});

ipcMain.on("resize-image-window", (event, { width, height }) => {
	if (!imageWindow || imageWindow.isDestroyed()) return;
	const { screen } = require("electron");
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
	webWindow = new BrowserWindow({
		width: 1100,
		height: 800,
		frame: false,
		transparent: true,
		resizable: true,
		autoHideMenuBar: true,
		alwaysOnTop: true,
		title: "Web",
		icon: path.join(__dirname, "../shared/icon.ico"),
		webPreferences: {
			nodeIntegration: true,
			contextIsolation: false,
			webviewTag: true,
		},
	});
	broadcastServer.broadcastFloatingWindowOpened();
	webWindowRect = {
		x: webWindow.getBounds().x,
		y: webWindow.getBounds().y,
		w: webWindow.getBounds().width,
		h: webWindow.getBounds().height,
	};
	webWindow.setMenu(null);
	webWindow.loadFile(path.join(__dirname, "../web-window.html"));
	webWindow.webContents.on("did-finish-load", () => {
		webWindow.webContents.send("set-url", { url, bgColor, shouldPin });
	});
	webWindow.on("closed", () => {
		broadcastServer.broadcastFloatingWindowClosed();
		webWindow = null;
		webWindowPinned = false;
		webWindowRect = null;
	});
	webWindow.on("move", () => {
		if (webWindow && !webWindow.isDestroyed() && webWindowRect) {
			const b = webWindow.getBounds();
			webWindowRect.x = b.x;
			webWindowRect.y = b.y;
		}
	});
	webWindow.on("resize", () => {
		if (webWindow && !webWindow.isDestroyed() && webWindowRect) {
			const b = webWindow.getBounds();
			webWindowRect.w = b.width;
			webWindowRect.h = b.height;
		}
	});
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

ipcMain.on("start-resizing", (event, edge) => {
	stopFloatLerp();
	const win = event.sender.getOwnerBrowserWindow();
	if (!win) return;
	const { screen } = require("electron");
	const initBounds = win.getBounds();
	const initCursor = screen.getCursorScreenPoint();
	let stopped = false;
	const stopResize = () => {
		stopped = true;
	};
	ipcMain.once("end-resizing", stopResize);
	const interval = setInterval(() => {
		if (stopped || !win || win.isDestroyed()) {
			clearInterval(interval);
			ipcMain.removeListener("end-resizing", stopResize);
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
ipcMain.on("toggle-transparency", () => {
	if (!state.mainWindow) return;
	const current = state.mainWindow.getOpacity();
	state.mainWindow.setOpacity(current < 0.9 ? 1.0 : 0.5);
});

ipcMain.handle("show-save-dialog", async () => {
	const result = await dialog.showSaveDialog(state.mainWindow, {
		filters: [{ name: "JSON", extensions: ["json"] }],
		defaultPath: "lesson.json",
	});
	return result.filePath;
});
ipcMain.handle("show-open-dialog", async () => {
	const result = await dialog.showOpenDialog(state.mainWindow, {
		filters: [{ name: "JSON", extensions: ["json"] }],
		properties: ["openFile"],
	});
	return result.filePaths[0];
});

ipcMain.on("update-window-title", (event, titleData) => {
	if (!state.mainWindow) return;
	let fileName, studentCount;
	if (typeof titleData === "object" && titleData !== null)
		({ fileName, studentCount } = titleData);
	else {
		fileName = titleData;
		studentCount = null;
	}
	const { buildWindowTitle } = require("../shared/constants");
	const hasUnsaved = typeof fileName === "string" && fileName.endsWith(" *");
	const cleanName = hasUnsaved ? fileName.slice(0, -2) : fileName;
	state.mainWindow.setTitle(
		buildWindowTitle(cleanName, studentCount, hasUnsaved),
	);
});

ipcMain.on("open-log-visualizer", (event, logFilePath) => {
	const visWindow = new BrowserWindow({
		width: 1600,
		height: 900,
		autoHideMenuBar: true,
		title: "📋 Log Visualizer",
		icon: path.join(__dirname, "../shared/icon.ico"),
		webPreferences: {
			nodeIntegration: true,
			contextIsolation: false,
			webviewTag: true,
		},
	});
	visWindow.maximize();
	visWindow.loadFile(path.join(__dirname, "../log-visualizer.html"));
	visWindow.webContents.on("did-finish-load", () => {
		visWindow.webContents.send("load-log", logFilePath);
	});
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

ipcMain.on("save-settings", (event, settings) => {
	Object.keys(settings).forEach((key) => {
		settingsManager.settings[key] = settings[key];
	});
	settingsManager.save();
	hotkeyManager.unregisterAll();
	hotkeyManager.registerSystemShortcuts();
	if (state.isActive) hotkeyManager.registerTypingHotkeys();
	broadcastServer.updateSettings(settings);
	event.reply("settings-saved", settingsManager.getAll());
});
ipcMain.on("reset-settings", (event) => {
	settingsManager.reset();
	hotkeyManager.unregisterAll();
	hotkeyManager.registerSystemShortcuts();
	if (state.isActive) hotkeyManager.registerTypingHotkeys();
	event.reply("settings-loaded", settingsManager.getAll());
});

app.whenReady().then(() => {
	createWindow();
	createTray();
});
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
