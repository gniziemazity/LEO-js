class UIManager {
   constructor() {
      this.elements = {};
      this.isTypingActive = false;
      this.selectedBlockIndex = null;
   }

   cacheElements() {
      this.elements = {
         toggleBtn: document.getElementById("toggleBtn"),
         newBtn: document.getElementById("newBtn"),
         saveBtn: document.getElementById("saveBtn"),
         loadBtn: document.getElementById("loadBtn"),
         addCommentBtn: document.getElementById("addCommentBtn"),
         addCodeBtn: document.getElementById("addCodeBtn"),
         removeBlockBtn: document.getElementById("removeBlockBtn"),
         timerStartBtn: document.getElementById("timerStartBtn"),
         timerPlusBtn: document.getElementById("timerPlusBtn"),
         timerMinusBtn: document.getElementById("timerMinusBtn"),
         timerDisplay: document.getElementById("timerDisplay"),
         timerControls: document.getElementById("timerControls"),
         progressBar: document.getElementById("progressBar"),
         lessonContainer: document.getElementById("lesson-container"),
         editorSidebar: document.getElementById("editor-sidebar"),
         specialKeysContainer: document.getElementById("special-keys-container"),
      };
   }

   setTypingActive(active) {
      this.isTypingActive = active;
      
      if (active) {
         this.elements.toggleBtn.textContent = "STOP";
         this.elements.toggleBtn.title = "Stop Auto-typing";
         this.elements.toggleBtn.style.background = "#e74c3c";
         this.elements.editorSidebar.classList.add("hidden");
      } else {
         this.elements.toggleBtn.textContent = "START";
         this.elements.toggleBtn.title = "Start Auto-typing";
         this.elements.toggleBtn.style.background = "#27ae60";
         this.elements.editorSidebar.classList.remove("hidden");
      }
   }

   showTimerControls() {
      this.elements.timerStartBtn.style.display = "none";
      this.elements.timerControls.style.display = "flex";
   }

   hideTimerControls() {
      this.elements.timerStartBtn.style.display = "block";
      this.elements.timerControls.style.display = "none";
   }

   updateTimerDisplay(formattedTime) {
      this.elements.timerDisplay.textContent = formattedTime;
   }

   updateProgressBar(percentage) {
      this.elements.progressBar.style.width = percentage + "%";
   }

   clearLessonContainer() {
      this.elements.lessonContainer.innerHTML = "";
   }

   selectBlock(index) {
      this.selectedBlockIndex = index;
      this.elements.editorSidebar.classList.remove("hidden");
   }

   deselectBlock() {
      this.selectedBlockIndex = null;
      this.elements.editorSidebar.classList.add("hidden");
   }

   getSelectedBlockIndex() {
      return this.selectedBlockIndex;
   }

   isActive() {
      return this.isTypingActive;
   }

   createBlockElement(block, blockIdx) {
      const blockDiv = document.createElement("div");
      blockDiv.className = `block ${block.type}-block`;

      if (this.selectedBlockIndex === blockIdx) {
         blockDiv.classList.add("selected");
      }

      return blockDiv;
   }

   createCharSpan(char, stepIndex) {
      const span = document.createElement("span");
      span.className = "char";

      if (char === "\n") {
         span.style.display = "block";
      } else if (char === " ") {
         span.innerHTML = "&nbsp;";
      } else {
         span.textContent = char;
      }

      span.dataset.stepIndex = stepIndex;
      return span;
   }

   appendToLessonContainer(element) {
      this.elements.lessonContainer.appendChild(element);
   }

   removeCursorClasses() {
      document
         .querySelectorAll(".cursor")
         .forEach((el) => el.classList.remove("cursor"));
      document
         .querySelectorAll(".active-comment")
         .forEach((el) => el.classList.remove("active-comment"));
   }

   populateSpecialKeys(keys, onKeyClick) {
      this.elements.specialKeysContainer.innerHTML = "";

      keys.forEach((char) => {
         const btn = document.createElement("button");
         btn.className = "key-btn";
         btn.textContent = char;
         btn.onclick = () => onKeyClick(char);
         this.elements.specialKeysContainer.appendChild(btn);
      });
   }

   focusBlock(blockIdx, clickX, clickY) {
      setTimeout(() => {
         const blocks = document.querySelectorAll(".block");
         const targetBlock = blocks[blockIdx];
         if (targetBlock) {
            targetBlock.focus();

            const range = document.caretRangeFromPoint(clickX, clickY);
            if (range) {
               const selection = window.getSelection();
               selection.removeAllRanges();
               selection.addRange(range);
            }
         }
      }, 0);
   }

   getElement(name) {
      return this.elements[name];
   }
}

module.exports = UIManager;