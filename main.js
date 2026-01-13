const { app, BrowserWindow, ipcMain, screen } = require("electron");
const { WINDOW_CONFIG } = require("./constants");
const state = require("./state");
const HotkeyManager = require("./hotkey-manager");
const KeyboardHandler = require("./keyboard-handler");

const hotkeyManager = new HotkeyManager();
const keyboardHandler = new KeyboardHandler(hotkeyManager);

function createWindow() {
   state.mainWindow = new BrowserWindow(WINDOW_CONFIG);
   state.mainWindow.loadFile("index.html");

   hotkeyManager.registerSystemShortcuts();
}

ipcMain.on("set-active", (event, isActive) => {
   state.isActive = isActive;
   if (isActive) {
      hotkeyManager.registerTypingHotkeys();
   } else {
      hotkeyManager.unregisterTypingHotkeys();
   }
});

function cleanup() {
   hotkeyManager.unregisterTypingHotkeys();
   state.reset();
}

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

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
   cleanup();
   if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
   if (state.mainWindow === null) createWindow();
});

app.on("will-quit", cleanup);
