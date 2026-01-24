const { ipcRenderer } = require("electron");
const path = require("path");

class FileOperations {
   constructor(lessonManager, logManager, cursorManager, lessonRenderer) {
      this.lessonManager = lessonManager;
      this.logManager = logManager;
      this.cursorManager = cursorManager;
      this.lessonRenderer = lessonRenderer;
   }

   async createNewLesson() {
      const filePath = await ipcRenderer.invoke("show-save-dialog");
      if (!filePath) return;

      this.lessonManager.create(filePath, (err) => {
         if (err) {
            console.error("Failed to create file:", err);
            alert("Failed to create file: " + err);
            return;
         }

         const fileName = filePath.split(/[\\/]/).pop();
         this.updateWindowTitle(fileName);
         localStorage.setItem("lastLessonPath", filePath);
         this.logManager.initialize(filePath);
         this.cursorManager.resetProgress();
         this.lessonRenderer.render();
      });
   }

   async loadLesson() {
      const filePath = await ipcRenderer.invoke("show-open-dialog");
      if (!filePath) return;

      const fileName = filePath.split(/[\\/]/).pop();
      this.updateWindowTitle(fileName);
      this.loadFilePath(filePath, 0);
   }

   loadFilePath(filePath, savedIndex = 0) {
      this.lessonManager.load(filePath, (err, data) => {
         if (err) {
            console.error("Failed to load file:", err);
            alert("Failed to load file: " + err);
            return;
         }

         localStorage.setItem("lastLessonPath", filePath);
         this.cursorManager.currentStepIndex = savedIndex;

         this.cursorManager.resetProgress();
         this.logManager.initialize(filePath);
         this.lessonRenderer.render();
         this.setInitialStateToInactive();

         const lessonName = path.basename(filePath, ".json");
         ipcRenderer.send("broadcast-lesson", lessonName);
      });
   }

   saveLesson() {
      this.lessonManager.save((err) => {
         if (err) {
            console.error("Save failed:", err);
            alert("Save failed: " + err);
         }
      });
   }

   loadLastLesson() {
      const lastFile = localStorage.getItem("lastLessonPath");
      const lastIndex = localStorage.getItem("lastStepIndex");

      if (lastFile) {
         this.loadFilePath(lastFile, lastIndex ? parseInt(lastIndex) : 0);
         this.updateWindowTitle(lastFile.split(/[\\/]/).pop());
      } else {
         this.logManager.initialize();
      }
   }

   updateWindowTitle(fileName = "") {
      ipcRenderer.send("update-window-title", fileName);

      const baseTitle = "LEO";
      if (fileName && fileName.trim() !== "") {
         const displayName = fileName.replace(/\.json$/i, "");
         document.title = `${baseTitle} - ${displayName}`;
      } else {
         document.title = baseTitle;
      }
   }

   setInitialStateToInactive() {
      ipcRenderer.send("set-active", false);
   }
}

module.exports = FileOperations;
