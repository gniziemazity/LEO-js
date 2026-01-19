const { globalShortcut } = require("electron");
const { HOTKEYS } = require("../shared/constants");
const state = require("./state");

class HotkeyManager {
   handleKey(letter) {
      if (!state.isActive) return;
      if (state.isLocked) {
         state.queueKey(letter);
      } else {
         state.lock();
         state.mainWindow.webContents.send("advance-cursor");
      }
   }

   // called once when the app starts
   // TO-DO: Interface for choosing shortcuts
   registerSystemShortcuts() {
      globalShortcut.register("CommandOrControl+P", () => {
         state.mainWindow.webContents.send("global-toggle-active");
      });

      globalShortcut.register("CommandOrControl+Left", () => {
         state.mainWindow.webContents.send("global-step-backward");
      });

      globalShortcut.register("CommandOrControl+Right", () => {
         state.mainWindow.webContents.send("global-step-forward");
      });

      globalShortcut.register("CommandOrControl+Shift+Space", () => {
         const isTop = state.mainWindow.isAlwaysOnTop();
         state.mainWindow.setAlwaysOnTop(!isTop);
      });
   }

   registerTypingHotkeys() {
      HOTKEYS.forEach((letter) => this.registerKey(letter));
   }

   unregisterTypingHotkeys() {
      HOTKEYS.forEach((letter) => globalShortcut.unregister(letter));
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
