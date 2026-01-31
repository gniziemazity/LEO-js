const { app, BrowserWindow, ipcMain, screen, dialog } = require("electron");
const { WINDOW_CONFIG } = require("../shared/constants");
const state = require("./state");
const HotkeyManager = require("./hotkey-manager");
const KeyboardHandler = require("./keyboard-handler");
const LEOBroadcastServer = require("./websocket-server");
const SettingsManager = require("./settings-manager");
const MainProcessTimer = require("./main-timer");
const { Menu } = require("electron");

const settingsManager = new SettingsManager();
const broadcastServer = new LEOBroadcastServer(8080);
const hotkeyManager = new HotkeyManager(settingsManager);
const keyboardHandler = new KeyboardHandler(hotkeyManager, settingsManager);
const mainTimer = new MainProcessTimer();

broadcastServer.on('client-toggle-active', () => {
   state.mainWindow.webContents.send('global-toggle-active');
});

broadcastServer.on('client-jump-to', (stepIndex) => {
   state.mainWindow.webContents.send('client-jump-to', stepIndex);
});

function createWindow() {
   const path = require("path");

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

   // send settings to renderer on load
   state.mainWindow.webContents.on("did-finish-load", () => {
      state.mainWindow.webContents.send(
         "settings-loaded",
         settingsManager.getAll(),
      );
   });
}

function cleanup() {
   hotkeyManager.unregisterTypingHotkeys();
   state.reset();
}

function createApplicationMenu() {
   const template = [
      {
         label: "File",
         submenu: [
            {
               label: "New Plan",
               accelerator: "CmdOrCtrl+N",
               click: () => {
                  state.mainWindow.webContents.send("new-plan");
               },
            },
            {
               label: "Save Plan",
               accelerator: "CmdOrCtrl+S",
               click: () => {
                  state.mainWindow.webContents.send("save-plan");
               },
            },
            {
               label: "Load Plan",
               accelerator: "CmdOrCtrl+O",
               click: () => {
                  state.mainWindow.webContents.send("load-plan");
               },
            },
            { type: "separator" },
            {
               label: "Exit",
               accelerator: "CmdOrCtrl+Q",
               click: () => {
                  app.quit();
               },
            },
         ],
      },{
         label: "Edit",
         submenu: [
             {
               label: "Settings",
               accelerator: "CmdOrCtrl+,",
               click: () => {
                  state.mainWindow.webContents.send("open-settings");
               },
            },
            { type: "separator" },
            {
               label: "Toggle Developer Tools",
               accelerator: "CmdOrCtrl+I",
               click: () => {
                  state.mainWindow.webContents.toggleDevTools();
               },
            },
         ],
      }
   ];

   const menu = Menu.buildFromTemplate(template);
   Menu.setApplicationMenu(menu);
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

ipcMain.on('update-window-title', (event, fileName) => {
  if (!state.mainWindow) return;
  
  const baseTitle = 'LEO';
  if (fileName && fileName.trim() !== '') {
    const displayName = fileName.replace(/\.json$/i, '');
    state.mainWindow.setTitle(`${baseTitle} - ${displayName}`);
  } else {
    state.mainWindow.setTitle(baseTitle);
  }
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

ipcMain.on("timer-start", (event, minutes) => {
   mainTimer.start(minutes, (timeString) => {
      if (state.mainWindow) {
         state.mainWindow.webContents.send("timer-tick", timeString);
      }
      broadcastServer.updateTimer(timeString);
   });
});

ipcMain.on("timer-adjust", (event, minutes) => {
   mainTimer.adjust(minutes);
});

ipcMain.on("timer-stop", () => {
   mainTimer.stop();
   if (state.mainWindow) {
      state.mainWindow.webContents.send("timer-tick", null);
   }
   broadcastServer.updateTimer(null);
});

ipcMain.handle("get-settings", () => {
   return settingsManager.getAll();
});

ipcMain.on("save-settings", (event, settings) => {
   Object.keys(settings).forEach((key) => {
      settingsManager.settings[key] = settings[key];
   });
   settingsManager.save();

   // re-register hotkeys with new settings
   hotkeyManager.unregisterAll();
   hotkeyManager.registerSystemShortcuts();
   if (state.isActive) {
      hotkeyManager.registerTypingHotkeys();
   }

   // broadcast settings to clients
   broadcastServer.updateSettings(settings);

   event.reply("settings-saved", settingsManager.getAll());
});

ipcMain.on("reset-settings", (event) => {
   settingsManager.reset();

   // re-register hotkeys with default settings
   hotkeyManager.unregisterAll();
   hotkeyManager.registerSystemShortcuts();
   if (state.isActive) {
      hotkeyManager.registerTypingHotkeys();
   }

   event.reply("settings-loaded", settingsManager.getAll());
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
