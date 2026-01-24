const { ipcRenderer } = require("electron");

class CursorManager {
   constructor(uiManager, logManager) {
      this.uiManager = uiManager;
      this.logManager = logManager;
      this.currentStepIndex = 0;
      this.executionSteps = [];
   }

   setExecutionSteps(steps) {
      this.executionSteps = steps;
   }

   getExecutionSteps() {
      return this.executionSteps;
   }

   getCurrentStep() {
      return this.currentStepIndex;
   }

   resetProgress() {
      this.currentStepIndex = 0;
      localStorage.setItem("lastStepIndex", 0);
      this.uiManager.updateProgressBar(0);
   }

   updateCursor() {
      this.uiManager.removeCursorClasses();

      if (this.currentStepIndex < this.executionSteps.length) {
         const step = this.executionSteps[this.currentStepIndex];

         if (step.type === "char") {
            step.element.classList.add("cursor");
            step.element.scrollIntoView({
               behavior: "smooth",
               block: "center",
            });
         } else if (step.type === "block") {
            step.element.classList.add("active-comment");
            step.element.scrollIntoView({
               behavior: "smooth",
               block: "center",
            });
         }
      }

      const progress =
         (this.currentStepIndex / this.executionSteps.length) * 100 || 0;
      this.uiManager.updateProgressBar(progress);

      ipcRenderer.send("broadcast-cursor", this.currentStepIndex);
      ipcRenderer.send("broadcast-progress", {
         currentStep: this.currentStepIndex,
         totalSteps: this.executionSteps.length,
      });
   }

   advanceCursor() {
      if (this.currentStepIndex >= this.executionSteps.length) return;

      const currentStep = this.executionSteps[this.currentStepIndex];

      if (currentStep.type === "char") {
         currentStep.element.classList.add("consumed");

         this.logManager.addEntry({
            char: currentStep.char,
         });

         ipcRenderer.send("type-character", currentStep.char);
         this.currentStepIndex++;
      } else if (currentStep.type === "block") {
         currentStep.element.classList.add("consumed");
         this.currentStepIndex++;
         ipcRenderer.send("input-complete");
      }

      localStorage.setItem("lastStepIndex", this.currentStepIndex);
      this.updateCursor();
   }

   jumpTo(index) {
      this.currentStepIndex = index;

      this.executionSteps.forEach((step, i) => {
         if (step.type === "char") {
            step.element.classList.remove("cursor", "consumed");
         }
         if (step.type === "block") {
            step.element.classList.remove("active-comment", "consumed");
         }

         if (i < index) {
            step.element.classList.add("consumed");
         }
      });

      localStorage.setItem("lastStepIndex", this.currentStepIndex);
      this.updateCursor();

      ipcRenderer.send("broadcast-cursor", this.currentStepIndex);
   }

   stepBackward() {
      if (this.currentStepIndex > 0) {
         this.jumpTo(this.currentStepIndex - 1);
      }
   }

   stepForward() {
      if (this.currentStepIndex < this.executionSteps.length) {
         this.jumpTo(this.currentStepIndex + 1);
      }
   }

   restoreConsumedSteps() {
      setTimeout(() => {
         this.executionSteps.forEach((step, i) => {
            if (i < this.currentStepIndex) {
               step.element.classList.add("consumed");
            }
         });
         this.updateCursor();
      }, 0);
   }

   loadSavedProgress() {
      const lastIndex = localStorage.getItem("lastStepIndex");
      if (lastIndex) {
         this.currentStepIndex = parseInt(lastIndex);
      }
   }
}

module.exports = CursorManager;
