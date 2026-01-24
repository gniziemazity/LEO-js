class SpecialKeys {
   constructor(uiManager, blockEditor) {
      this.uiManager = uiManager;
      this.blockEditor = blockEditor;
   }

   initialize() {
      const keys = [
         "←",
         "→",
         "↑",
         "↓",
         "◄",
         "►",
         "▲",
         "▼",
         "↢",
         "‒",
         "⇑",
         "⇓",
         "⇐",
         "⇒",
         "💾",
         "🔁",
      ];

      this.uiManager.populateSpecialKeys(keys, (char) => {
         this.insertSpecialChar(char);
      });
   }

   insertSpecialChar(char) {
      document.execCommand("insertText", false, char);
      const selectedBlockIndex = this.uiManager.getSelectedBlockIndex();

      if (selectedBlockIndex !== null) {
         const activeDiv =
            document.querySelectorAll(".block")[selectedBlockIndex];
         this.blockEditor.updateBlockContent(
            selectedBlockIndex,
            activeDiv.innerText,
         );
      }
   }
}

module.exports = SpecialKeys;
