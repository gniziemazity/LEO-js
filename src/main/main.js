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
let imageWindow = null;
let imageWindowPinned = false;

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

const { mouse, Button, Point } = require("@computer-use/nut-js");
mouse.config.autoDelayMs = 0;
mouse.config.mouseSpeed = 2000;

broadcastServer.on("client-mouse-move", async (dx, dy) => {
	try {
		const pos = await mouse.getPosition();
		await mouse.setPosition(new Point(pos.x + dx, pos.y + dy));
	} catch (e) { /* ignore */ }
});
broadcastServer.on("client-mouse-click", async (button) => {
	try {
		if (button === "right") await mouse.rightClick();
		else await mouse.leftClick();
	} catch (e) { /* ignore */ }
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

function createWindow() {
	const config = {
		...WINDOW_CONFIG,
		autoHideMenuBar: false,
		icon: path.join(__dirname, "../shared/icon.ico"),
	};
	state.mainWindow = new BrowserWindow(config);
	createApplicationMenu();
	state.mainWindow.loadFile(path.join(__dirname, "../index.html"));
	broadcastServer.start();
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

	const openOrUpdate = () => {
		if (questionWindow && !questionWindow.isDestroyed()) {
			questionWindow.webContents.send("set-question", { question, bgColor });
			questionWindow.show();
			questionWindow.focus();
		} else {
			questionWindow = new BrowserWindow({
				width: 900,
				height: 480,
				frame: true,
				autoHideMenuBar: true,
				alwaysOnTop: true,
				title: "Question",
				icon: path.join(__dirname, "../shared/icon.ico"),
				webPreferences: { nodeIntegration: true, contextIsolation: false },
			});
			questionWindow.setMenu(null);
			questionWindow.loadFile(
				path.join(__dirname, "../question-window.html"),
			);
			questionWindow.webContents.on("did-finish-load", () => {
				questionWindow.webContents.send("set-question", {
					question,
					bgColor,
				});
			});
			questionWindow.on("closed", () => {
				questionWindow = null;
			});
		}
	};
	openOrUpdate();
});

ipcMain.on("close-question-window", () => {
	if (questionWindow && !questionWindow.isDestroyed()) {
		questionWindow.close();
		questionWindow = null;
	}
	broadcastServer.broadcastQuestionEnded();
});

ipcMain.on(
	"open-image-window",
	(event, { imageName, lessonFilePath, bgColor }) => {
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
				imageWindow.webContents.send("set-image", { imagePath, bgColor });
				imageWindow.show();
				imageWindow.focus();
			}
			return;
		}

		imageWindowPinned = false;
		imageWindow = new BrowserWindow({
			width: 900,
			height: 650,
			frame: true,
			autoHideMenuBar: true,
			alwaysOnTop: true,
			title: "Image",
			icon: path.join(__dirname, "../shared/icon.ico"),
			webPreferences: { nodeIntegration: true, contextIsolation: false },
		});
		imageWindow.setMenu(null);
		imageWindow.loadFile(path.join(__dirname, "../image-window.html"));
		imageWindow.webContents.on("did-finish-load", () => {
			imageWindow.webContents.send("set-image", { imagePath, bgColor });
		});
		imageWindow.on("closed", () => {
			imageWindow = null;
			imageWindowPinned = false;
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
	imageWindow.setSize(Math.min(width, maxW), Math.min(height, maxH));
	imageWindow.center();
});

ipcMain.on("close-image-window", () => {
	if (imageWindowPinned) return;
	if (imageWindow && !imageWindow.isDestroyed()) {
		imageWindow.close();
		imageWindow = null;
	}
});

ipcMain.on("set-active", (event, isActive) => {
	state.isActive = isActive;
	if (isActive) hotkeyManager.registerTypingHotkeys();
	else hotkeyManager.unregisterTypingHotkeys();
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
