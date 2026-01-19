const { app, BrowserWindow, ipcMain, screen, dialog } = require("electron");
const { WINDOW_CONFIG } = require("../shared/constants");
const state = require("./state");
const HotkeyManager = require("./hotkey-manager");
const KeyboardHandler = require("./keyboard-handler");
const LEOBroadcastServer = require("./websocket-server");
const broadcastServer = new LEOBroadcastServer(8080);

const hotkeyManager = new HotkeyManager();
const keyboardHandler = new KeyboardHandler(hotkeyManager);

function createWindow() {
   state.mainWindow = new BrowserWindow(WINDOW_CONFIG);
   const path = require("path");
   state.mainWindow.loadFile(path.join(__dirname, "../index.html"));

   broadcastServer.start();
   state.broadcastServer = broadcastServer;

   hotkeyManager.registerSystemShortcuts();
}

function cleanup() {
   hotkeyManager.unregisterTypingHotkeys();
   state.reset();
}

ipcMain.on("set-active", (event, isActive) => {
   state.isActive = isActive;
   if (isActive) {
      hotkeyManager.registerTypingHotkeys();
   } else {
      hotkeyManager.unregisterTypingHotkeys();
   }
});

ipcMain.on("type-character", (event, char) => {
   keyboardHandler.typeCharacter(char);
});

ipcMain.on("input-complete", () => {
   keyboardHandler.processQueue();
});

ipcMain.on("toggle-transparency", () => {
   if (!state.mainWindow) return;
   const current = state.mainWindow.getOpacity();
   state.mainWindow.setOpacity(current < 0.9 ? 1.0 : 0.5);
});

ipcMain.on("resize-window", () => {
   if (!state.mainWindow) return;
   const display = screen.getPrimaryDisplay();
   const { width, height } = display.workAreaSize;
   state.mainWindow.setSize(width - 100, height);
   state.mainWindow.setPosition(50, 0);
});

ipcMain.handle("show-save-dialog", async () => {
   const result = await dialog.showSaveDialog(state.mainWindow, {
      filters: [{ name: "JSON", extensions: ["json"] }],
      defaultPath: "lesson.json"
   });
   return result.filePath;
});

ipcMain.handle("show-open-dialog", async () => {
   const result = await dialog.showOpenDialog(state.mainWindow, {
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["openFile"]
   });
   return result.filePaths[0];
});

ipcMain.on("broadcast-lesson-data", (event, data) => {
   broadcastServer.updateLessonData(data);
});

ipcMain.on("broadcast-cursor", (event, currentStep) => {
   broadcastServer.updateCursor(currentStep);
});

ipcMain.on("broadcast-progress", (event, data) => {
   broadcastServer.updateProgress(data.currentStep, data.totalSteps);
});

ipcMain.on("broadcast-timer", (event, timeRemaining) => {
   broadcastServer.updateTimer(timeRemaining);
});

ipcMain.on("broadcast-active", (event, isActive) => {
   broadcastServer.updateActiveState(isActive);
});

ipcMain.on("broadcast-lesson", (event, lessonName) => {
   broadcastServer.updateLessonName(lessonName);
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
   cleanup();
   if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
   if (state.mainWindow === null) createWindow();
});

app.on("will-quit", cleanup);