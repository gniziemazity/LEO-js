const fs = require("fs");

class LessonManager {
   constructor() {
      this.data = [];
      this.currentFilePath = "";
      this.hasUnsavedChanges = false;
      this.onChangeCallback = null;
   }

   load(filePath, callback) {
      fs.readFile(filePath, "utf8", (err, data) => {
         if (err) {
            callback(err, null);
            return;
         }

         try {
            this.data = JSON.parse(data);
            this.currentFilePath = filePath;
            this.hasUnsavedChanges = false;
            callback(null, this.data);
         } catch (e) {
            callback(e, null);
         }
      });
   }

   save(callback) {
      if (!this.currentFilePath) {
         callback(new Error("No file path set"));
         return;
      }

      const jsonData = JSON.stringify(this.data, null, 2);
      
      fs.writeFile(this.currentFilePath, jsonData, (err) => {
         if (err) {
            callback(err);
         } else {
            this.hasUnsavedChanges = false;
            callback(null);
         }
      });
   }

   create(filePath, callback) {
      const defaultData = [
         { type: "comment", text: "Enter lesson title" },
         { type: "code", text: "// Enter first code snippet" },
      ];

      this.currentFilePath = filePath;
      this.data = defaultData;
      this.hasUnsavedChanges = true;

      this.save(callback);
   }

   addBlock(type, afterIndex = null) {
      const newBlock = { 
         type, 
         text: type === "code" ? "" : "New Comment" 
      };
      
      if (afterIndex === null) {
         this.data.push(newBlock);
      } else {
         this.data.splice(afterIndex + 1, 0, newBlock);
      }
      
      this.markAsChanged();
      return this.data.length - 1;
   }

   removeBlock(index) {
      if (index < 0 || index >= this.data.length) {
         return false;
      }
      
      this.data.splice(index, 1);
      this.markAsChanged();
      return true;
   }

   updateBlock(index, text) {
      if (index < 0 || index >= this.data.length) {
         return false;
      }
      
      this.data[index].text = text;
      this.markAsChanged();
      return true;
   }

   getBlock(index) {
      return this.data[index] || null;
   }

   getAllBlocks() {
      return this.data;
   }

   getBlockCount() {
      return this.data.length;
   }

   getCurrentFilePath() {
      return this.currentFilePath;
   }

   hasChanges() {
      return this.hasUnsavedChanges;
   }

   markAsChanged() {
      this.hasUnsavedChanges = true;
      if (this.onChangeCallback) {
         this.onChangeCallback();
      }
   }

   onChange(callback) {
      this.onChangeCallback = callback;
   }

   reset() {
      this.data = [];
      this.currentFilePath = "";
      this.hasUnsavedChanges = false;
   }
}

module.exports = LessonManager;