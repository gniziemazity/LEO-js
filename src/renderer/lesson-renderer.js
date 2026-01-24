const { ipcRenderer } = require("electron");

class LessonRenderer {
   constructor(lessonManager, uiManager, cursorManager) {
      this.lessonManager = lessonManager;
      this.uiManager = uiManager;
      this.cursorManager = cursorManager;
   }

   render() {
      const isTypingActive = this.uiManager.isActive();

      this.uiManager.clearLessonContainer();
      const executionSteps = [];
      let globalStepCounter = 0;

      const blocks = this.lessonManager.getAllBlocks();

      blocks.forEach((block, blockIdx) => {
         const blockDiv = this.uiManager.createBlockElement(block, blockIdx);
         blockDiv.onclick = (e) => this.handleBlockClick(e, block, blockIdx);

         if (block.type === "comment") {
            globalStepCounter = this.renderCommentBlock(
               blockDiv,
               block,
               blockIdx,
               isTypingActive,
               globalStepCounter,
               executionSteps,
            );
         } else if (block.type === "code") {
            globalStepCounter = this.renderCodeBlock(
               blockDiv,
               block,
               blockIdx,
               isTypingActive,
               globalStepCounter,
               executionSteps,
            );
         }

         this.uiManager.appendToLessonContainer(blockDiv);
      });

      this.cursorManager.setExecutionSteps(executionSteps);

      if (isTypingActive) {
         this.cursorManager.updateCursor();
      }

      this.broadcastLessonData(executionSteps);
   }

   renderCommentBlock(
      blockDiv,
      block,
      blockIdx,
      isTypingActive,
      globalStepCounter,
      executionSteps,
   ) {
      blockDiv.contentEditable = !isTypingActive;
      blockDiv.innerText = block.text;
      blockDiv.oninput = () => {
         this.lessonManager.updateBlock(blockIdx, blockDiv.innerText);
      };

      blockDiv.onpaste = (e) => {
         e.preventDefault();
         const text = e.clipboardData.getData("text/plain");
         document.execCommand("insertText", false, text);
      };

      executionSteps.push({
         type: "block",
         element: blockDiv,
         blockIndex: blockIdx,
         globalIndex: globalStepCounter,
      });

      blockDiv.dataset.stepIndex = globalStepCounter;
      return globalStepCounter + 1;
   }

   renderCodeBlock(
      blockDiv,
      block,
      blockIdx,
      isTypingActive,
      globalStepCounter,
      executionSteps,
   ) {
      const selectedBlockIndex = this.uiManager.getSelectedBlockIndex();

      if (selectedBlockIndex === blockIdx && !isTypingActive) {
         blockDiv.contentEditable = "true";
         blockDiv.innerText = block.text;
         blockDiv.oninput = () => {
            this.lessonManager.updateBlock(blockIdx, blockDiv.innerText);
         };

         blockDiv.onpaste = (e) => {
            e.preventDefault();
            const text = e.clipboardData.getData("text/plain");
            document.execCommand("insertText", false, text);
         };

         return globalStepCounter;
      } else {
         blockDiv.contentEditable = "false";
         for (const char of block.text) {
            const span = this.uiManager.createCharSpan(char, globalStepCounter);
            blockDiv.appendChild(span);

            executionSteps.push({
               type: "char",
               element: span,
               char: char,
               blockIndex: blockIdx,
               globalIndex: globalStepCounter,
            });
            globalStepCounter++;
         }
         return globalStepCounter;
      }
   }

   handleBlockClick(e, block, blockIdx) {
      const isTypingActive = this.uiManager.isActive();

      if (!isTypingActive) {
         if (this.uiManager.getSelectedBlockIndex() === blockIdx) return;

         const clickX = e.clientX;
         const clickY = e.clientY;

         this.uiManager.selectBlock(blockIdx);
         this.render();
         this.uiManager.focusBlock(blockIdx, clickX, clickY);
      } else {
         if (block.type === "code") {
            const clickedSpan = e.target.closest(".char");
            if (clickedSpan) {
               this.cursorManager.jumpTo(
                  parseInt(clickedSpan.dataset.stepIndex),
               );
            }
         } else {
            const executionSteps = this.cursorManager.getExecutionSteps();
            const step = executionSteps.find((s) => s.blockIndex === blockIdx);
            if (step) {
               this.cursorManager.jumpTo(step.globalIndex);
            }
         }
      }
   }

   broadcastLessonData(executionSteps) {
      const blocks = this.lessonManager.getAllBlocks();

      ipcRenderer.send("broadcast-lesson-data", {
         blocks: blocks,
         executionSteps: executionSteps.map((step) => ({
            type: step.type,
            blockIndex: step.blockIndex,
            globalIndex: step.globalIndex,
            char: step.char,
         })),
      });
   }
}

module.exports = LessonRenderer;
