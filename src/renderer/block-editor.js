class BlockEditor {
   constructor(lessonManager, uiManager, lessonRenderer) {
      this.lessonManager = lessonManager;
      this.uiManager = uiManager;
      this.lessonRenderer = lessonRenderer;
   }

   addBlock(type) {
      const selectedBlockIndex = this.uiManager.getSelectedBlockIndex();
      this.lessonManager.addBlock(type, selectedBlockIndex);
      this.uiManager.selectBlock(selectedBlockIndex + 1);
      this.lessonRenderer.render();
   }

   removeBlock() {
      const selectedBlockIndex = this.uiManager.getSelectedBlockIndex();
      if (selectedBlockIndex === null) return;

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

      const formatted = this.formatCodeForAutoTyping(block.text);
      this.lessonManager.updateBlock(selectedBlockIndex, formatted);
      this.lessonRenderer.render();
   }

   formatCodeForAutoTyping(code) {
      let text = code;

      text = text
         .split("\n")
         .map((line) => line.trimStart())
         .join("\n");
      text = text.replace(/→►/g, "");

      const tags = ["html", "head", "body", "script", "div"];
      tags.forEach((tag) => {
         const closingRegex = new RegExp(`</${tag}>`, "g");
         text = text.replace(closingRegex, "↢");

         const openingRegex = new RegExp(`<${tag}>`, "g");
         text = text.replace(openingRegex, `<${tag}>\n</${tag}>→►`);
      });

      text = text.replace(/ +/g, " ");
      text = text.replace(/\n /g, "\n");
      text = text.replace(/\n}/g, "↢");
      text = text.replace(/{\n/g, "{\n}→►\n");
      text = text.replace(/\n↢/g, "↢");
      text = text.replace(/↢💾/g, "💾");
      text = text.replace(/→►↢/g, "→►");

      return text;
   }

   updateBlockContent(blockIdx, content) {
      this.lessonManager.updateBlock(blockIdx, content);
   }
}

module.exports = BlockEditor;
