const { globalShortcut } = require("electron");
const state = require("./state");

class HotkeyManager {
   constructor(settingsManager) {
      this.settingsManager = settingsManager;
   }

   handleKey(letter) {
      if (!state.isActive) return;
      
      if (state.isPaused) {
         return;
      }
      
      if (state.isLocked) {
         state.queueKey(letter);
      } else {
         state.lock();
         state.mainWindow.webContents.send("advance-cursor");
      }
   }

   registerSystemShortcuts() {
      const shortcuts = this.settingsManager.get("hotkeys");

      globalShortcut.register(shortcuts.toggleActive, () => {
         state.mainWindow.webContents.send("global-toggle-active");
      });

      globalShortcut.register(shortcuts.stepBackward, () => {
         state.mainWindow.webContents.send("global-step-backward");
      });

      globalShortcut.register(shortcuts.stepForward, () => {
         state.mainWindow.webContents.send("global-step-forward");
      });

      globalShortcut.register(shortcuts.alwaysOnTop, () => {
         const isTop = state.mainWindow.isAlwaysOnTop();
         state.mainWindow.setAlwaysOnTop(!isTop);
      });

      globalShortcut.register(shortcuts.toggleTransparency, () => {
         state.mainWindow.webContents.send("toggle-transparency-event");
      });
   }

   registerTypingHotkeys() {
      const hotkeys = this.settingsManager.get("hotkeys.typing");
      hotkeys.forEach((letter) => this.registerKey(letter));
   }

   unregisterTypingHotkeys() {
      const hotkeys = this.settingsManager.get("hotkeys.typing");
      hotkeys.forEach((letter) => globalShortcut.unregister(letter));
   }

   registerKey(letter) {
      if (globalShortcut.isRegistered(letter)) return;
      globalShortcut.register(letter, () => this.handleKey(letter));
   }

   unregisterKey(letter) {
      globalShortcut.unregister(letter);
   }

   unregisterAll() {
      globalShortcut.unregisterAll();
   }
}

module.exports = HotkeyManager;
