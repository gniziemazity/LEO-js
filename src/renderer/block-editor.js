class BlockEditor {
   constructor(lessonManager, uiManager, lessonRenderer, undoManager = null) {
      this.lessonManager = lessonManager;
      this.uiManager = uiManager;
      this.lessonRenderer = lessonRenderer;
      this.undoManager = undoManager;
   }

   setUndoManager(undoManager) {
      this.undoManager = undoManager;
   }

   addBlock(type) {
      if (this.undoManager) {
         this.undoManager.saveState(`add-${type}-block`);
      }
      
      const selectedBlockIndex = this.uiManager.getSelectedBlockIndex();
      this.lessonManager.addBlock(type, selectedBlockIndex);
      this.uiManager.selectBlock(selectedBlockIndex + 1);
      this.lessonRenderer.render();
   }

   removeBlock() {
      const selectedBlockIndex = this.uiManager.getSelectedBlockIndex();
      if (selectedBlockIndex === null) return;

      if (this.undoManager) {
         this.undoManager.saveState('remove-block');
      }

      this.lessonManager.removeBlock(selectedBlockIndex);
      this.uiManager.deselectBlock();
      this.uiManager.selectBlock(selectedBlockIndex - 1);
      this.lessonRenderer.render();
   }

   formatBlock() {
      const selectedBlockIndex = this.uiManager.getSelectedBlockIndex();
      if (selectedBlockIndex === null) return;

      const block = this.lessonManager.getBlock(selectedBlockIndex);
      if (!block || block.type !== "code") return;

      if (this.undoManager) {
         this.undoManager.saveState('format-block');
      }

      const formatted = this.formatCodeForAutoTyping(block.text);
      this.lessonManager.updateBlock(selectedBlockIndex, formatted);
      this.lessonRenderer.render();
   }

   formatCodeForAutoTyping(code) {
      let text = code.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

      text = text.replace(/↑►/g, "");

      const tags = ["html", "head", "body", "script", "div"];

      tags.forEach((tag) => {
         const closingTagRegex = new RegExp("</" + tag + ">", "g");
         text = text.replace(closingTagRegex, "↓►");

         const openingTagRegex = new RegExp("<" + tag + ">", "g");
         text = text.replace(openingTagRegex, `<${tag}>\n</${tag}>↑►`);
      });

      text = text.replace(/ +/g, " ");
      text = text.replace(/\n /g, "\n");
      text = text.replace(/\n}/g, "↓►");
      text = text.replace(/{\n/g, "{\n}↑►\n");
      text = text.replace(/\n↓►/g, "↓►");
      text = text.replace(/↓💾/g, "💾");
      text = text.replace(/↑►↓/g, "↑►");

      text = text.replace(/<\/html>/g, "↢</html>");
      text = text.replace(/<\/script>/g, "↢</script>");

      text = text.replace(/(?:↓►)+$/, "");

      return text;
   }

   updateBlockContent(blockIdx, content) {
      this.lessonManager.updateBlock(blockIdx, content);
   }
}

module.exports = BlockEditor;
