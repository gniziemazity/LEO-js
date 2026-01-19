const { keyboard, Key } = require("@computer-use/nut-js");
const { NUTJS_KEY_MAPPING, HOTKEYS } = require("../shared/constants");
const state = require("./state");

class KeyboardHandler {
   constructor(hotkeyManager) {
      this.hotkeyManager = hotkeyManager;
      this.isProcessing = false;

      keyboard.config.autoDelayMs = 0; // makes typing faster
   }

   async typeCharacter(char) {
      if (this.isProcessing) {
         console.log("Already processing, skipping:", char);
         return;
      }

      this.isProcessing = true;

      const charLower = char.toLowerCase();
      const isInterceptorKey = HOTKEYS.includes(charLower);

      try {
         if (isInterceptorKey) {
            this.hotkeyManager.unregisterKey(charLower);
         }

         await this.typeWithNutJs(char);

         if (isInterceptorKey) {
            this.hotkeyManager.registerKey(charLower);
         }

         this.processQueue();
      } catch (error) {
         console.error("Error typing character:", error);

         if (isInterceptorKey) {
            this.hotkeyManager.registerKey(charLower);
         }
         state.unlock();
         state.clearQueue();
      } finally {
         this.isProcessing = false;
      }
   }

   async typeWithNutJs(char) {
      // check if it's a special key
      if (NUTJS_KEY_MAPPING[char]) {
         const mapping = NUTJS_KEY_MAPPING[char];

         if (mapping.modifier) {
            await keyboard.type(mapping.modifier, mapping.key);
         } else if (mapping.shift) {
            await keyboard.type(Key.LeftShift, mapping.key);
         } else {
            await keyboard.type(mapping.key);
         }
      } else if (char === "\n") {
         await keyboard.type(Key.Enter);
      } else {
         await keyboard.type(char);
      }
   }

   processQueue() {
      if (state.hasQueuedKeys()) {
         const nextKey = state.dequeueKey();

         state.mainWindow.webContents.send("advance-cursor");
      } else {
         state.unlock();
      }
   }

   delay(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
   }
}

module.exports = KeyboardHandler;
