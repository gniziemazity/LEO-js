const { ipcRenderer } = require("electron");

class TypingController {
   constructor(uiManager, lessonRenderer, cursorManager) {
      this.uiManager = uiManager;
      this.lessonRenderer = lessonRenderer;
      this.cursorManager = cursorManager;
   }

   toggleActive() {
      const isCurrentlyInactive = !this.uiManager.isActive();

      if (isCurrentlyInactive) {
         this.uiManager.deselectBlock();
      }

      this.uiManager.setTypingActive(isCurrentlyInactive);
      ipcRenderer.send("set-active", isCurrentlyInactive);
      ipcRenderer.send("broadcast-active", isCurrentlyInactive);

      this.lessonRenderer.render();

      if (isCurrentlyInactive && this.cursorManager.getCurrentStep() > 0) {
         this.cursorManager.restoreConsumedSteps();
      }
   }
}

module.exports = TypingController;
