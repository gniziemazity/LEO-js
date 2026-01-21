const { ipcRenderer } = require("electron");
const LogManager = require("./main/log-manager");
const TimerManager = require("./renderer/timer-manager");
const LessonManager = require("./renderer/lesson-manager");
const UIManager = require("./renderer/ui-manager");
const { TIMER_CONFIG } = require("./shared/constants");

const logManager = new LogManager();
const timerManager = new TimerManager();
const lessonManager = new LessonManager();
const uiManager = new UIManager();

let currentStepIndex = 0;
let executionSteps = [];

window.addEventListener("DOMContentLoaded", () => {
   uiManager.cacheElements();
   
   const lastFile = localStorage.getItem("lastLessonPath");
   const lastIndex = localStorage.getItem("lastStepIndex");

   if (lastFile) {
      loadFilePath(lastFile, lastIndex ? parseInt(lastIndex) : 0);
   } else {
      logManager.initialize();
   }
   
   setupManagers();
   setupEventListeners();
   setupKeyboardShortcuts();
   setupGlobalIpcListeners();
   populateSpecialKeys();
});

function setupManagers() {
   timerManager.onTick((formattedTime) => {
      uiManager.updateTimerDisplay(formattedTime);
   });

   timerManager.onComplete(() => {
      uiManager.hideTimerControls();
   });
}

function setupGlobalIpcListeners() {
   ipcRenderer.on("global-toggle-active", toggleActive);
   ipcRenderer.on("global-step-backward", () => {
      if (currentStepIndex > 0) {
         jumpTo(currentStepIndex - 1);
      }
   });
   ipcRenderer.on("global-step-forward", () => {
      if (currentStepIndex < executionSteps.length) {
         jumpTo(currentStepIndex + 1);
      }
   });
   ipcRenderer.on("advance-cursor", advanceCursor);
}

function setupEventListeners() {
   uiManager.getElement("newBtn").onclick = createNewLesson;
   uiManager.getElement("loadBtn").onclick = loadLesson;
   uiManager.getElement("saveBtn").onclick = saveLesson;
   uiManager.getElement("toggleBtn").onclick = toggleActive;

   uiManager.getElement("addCommentBtn").onclick = () => addBlock("comment");
   uiManager.getElement("addCodeBtn").onclick = () => addBlock("code");
   uiManager.getElement("removeBlockBtn").onclick = removeBlock;
   uiManager.getElement("formatBlockBtn").onclick = formatBlock;

   uiManager.getElement("timerStartBtn").onclick = startTimer;
   uiManager.getElement("timerPlusBtn").onclick = () => adjustTimer(TIMER_CONFIG.ADJUSTMENT_MINUTES);
   uiManager.getElement("timerMinusBtn").onclick = () => adjustTimer(-TIMER_CONFIG.ADJUSTMENT_MINUTES);
}

function setupKeyboardShortcuts() {
   document.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.code === "KeyP") {
         e.preventDefault();
         toggleActive();
      }

      if (e.ctrlKey && e.code === "ArrowLeft") {
         e.preventDefault();
         navigateBlocks(-1);
      }
      if (e.ctrlKey && e.code === "ArrowRight") {
         e.preventDefault();
         navigateBlocks(1);
      }

      if (e.ctrlKey && e.shiftKey && e.code === "KeyT") {
         ipcRenderer.send("toggle-transparency");
      }

      if (e.ctrlKey && e.shiftKey && e.code === "KeyS") {
         ipcRenderer.send("resize-window");
      }
   });
}

async function createNewLesson() {
   const filePath = await ipcRenderer.invoke("show-save-dialog");
   
   if (!filePath) {
      return;
   }

   lessonManager.create(filePath, (err) => {
      if (err) {
         alert("Failed to create file: " + err);
         return;
      }
      
      localStorage.setItem("lastLessonPath", filePath);
      logManager.initialize(filePath);
      resetProgress();
      renderLesson();
   });
}

async function loadLesson() {
   const filePath = await ipcRenderer.invoke("show-open-dialog");
   
   if (filePath) {
      loadFilePath(filePath, 0);
   }
}

function loadFilePath(filePath, savedIndex = 0) {
   lessonManager.load(filePath, (err, data) => {
      if (err) {
         alert("Failed to load file: " + err);
         return;
      }
      
      localStorage.setItem("lastLessonPath", filePath);
      currentStepIndex = savedIndex;

      resetProgress();
      logManager.initialize(filePath);
      renderLesson();
      setInitialStateToInactive();

      const path = require('path');
      const lessonName = path.basename(filePath, '.json');
      ipcRenderer.send("broadcast-lesson", lessonName);
   });
}

function saveLesson() {
   lessonManager.save((err) => {
      if (err) {
         alert("Save failed: " + err);
      }
   });
}

function navigateBlocks(direction) {
   const blockCount = lessonManager.getBlockCount();
   if (!blockCount) return;

   let currentBlockIdx = 0;
   if (currentStepIndex < executionSteps.length) {
      currentBlockIdx = executionSteps[currentStepIndex].blockIndex;
   } else {
      currentBlockIdx = blockCount - 1;
   }

   let newBlockIdx = currentBlockIdx + direction;
   newBlockIdx = Math.max(0, Math.min(newBlockIdx, blockCount - 1));

   const targetStep = executionSteps.find(
      (step) => step.blockIndex === newBlockIdx
   );

   if (targetStep) {
      jumpTo(targetStep.globalIndex);
   }
}

function resetProgress() {
   currentStepIndex = 0;
   localStorage.setItem("lastStepIndex", 0);
   uiManager.updateProgressBar(0);
}

function renderLesson() {
   const isTypingActive = uiManager.isActive();

   uiManager.clearLessonContainer();
   executionSteps = [];
   let globalStepCounter = 0;

   const blocks = lessonManager.getAllBlocks();
   
   blocks.forEach((block, blockIdx) => {
      const blockDiv = uiManager.createBlockElement(block, blockIdx);
      blockDiv.onclick = (e) => handleBlockClick(e, block, blockIdx);
      
      if (block.type === "comment") {
         globalStepCounter = renderCommentBlock(blockDiv, block, blockIdx, isTypingActive, globalStepCounter);
      } else if (block.type === "code") {
         globalStepCounter = renderCodeBlock(blockDiv, block, blockIdx, isTypingActive, globalStepCounter);
      }
      
      uiManager.appendToLessonContainer(blockDiv);
   });

   if (isTypingActive) {
      updateCursor();
   }

   broadcastLessonData();
}

function handleBlockClick(e, block, blockIdx) {
   const isTypingActive = uiManager.isActive();
   
   if (!isTypingActive) {
      if (uiManager.getSelectedBlockIndex() === blockIdx) return;
      
      const clickX = e.clientX;
      const clickY = e.clientY;
      
      uiManager.selectBlock(blockIdx);
      renderLesson();
      uiManager.focusBlock(blockIdx, clickX, clickY);
   } else {
      if (block.type === "code") {
         const clickedSpan = e.target.closest(".char");
         if (clickedSpan) {
            jumpTo(parseInt(clickedSpan.dataset.stepIndex));
         }
      } else {
         const step = executionSteps.find(
            (s) => s.blockIndex === blockIdx
         );
         if (step) {
            jumpTo(step.globalIndex);
         }
      }
   }
}

function renderCommentBlock(blockDiv, block, blockIdx, isTypingActive, globalStepCounter) {
   blockDiv.contentEditable = !isTypingActive;
   blockDiv.innerText = block.text;
   blockDiv.oninput = () => {
      lessonManager.updateBlock(blockIdx, blockDiv.innerText);
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

function renderCodeBlock(blockDiv, block, blockIdx, isTypingActive, globalStepCounter) {
   const selectedBlockIndex = uiManager.getSelectedBlockIndex();
   
   if (selectedBlockIndex === blockIdx && !isTypingActive) {
      blockDiv.contentEditable = "true";
      blockDiv.innerText = block.text;
      blockDiv.oninput = () => {
         lessonManager.updateBlock(blockIdx, blockDiv.innerText);
      };
      return globalStepCounter;
   } else {
      blockDiv.contentEditable = "false";
      for (const char of block.text) {
         const span = uiManager.createCharSpan(char, globalStepCounter);
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

function jumpTo(index) {
   currentStepIndex = index;

   executionSteps.forEach((step, i) => {
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

   localStorage.setItem("lastStepIndex", currentStepIndex);
   updateCursor();

   ipcRenderer.send("broadcast-cursor", currentStepIndex);
}

function toggleActive() {
   const isCurrentlyInactive = !uiManager.isActive();

   uiManager.setTypingActive(isCurrentlyInactive);
   ipcRenderer.send("set-active", isCurrentlyInactive);
   ipcRenderer.send("broadcast-active", isCurrentlyInactive);

   renderLesson();
}

function updateCursor() {
   uiManager.removeCursorClasses();

   if (currentStepIndex < executionSteps.length) {
      const step = executionSteps[currentStepIndex];

      if (step.type === "char") {
         step.element.classList.add("cursor");
         step.element.scrollIntoView({ behavior: "smooth", block: "center" });
      } else if (step.type === "block") {
         step.element.classList.add("active-comment");
         step.element.scrollIntoView({ behavior: "smooth", block: "center" });
      }
   }

   const progress = (currentStepIndex / executionSteps.length) * 100 || 0;
   uiManager.updateProgressBar(progress);

   ipcRenderer.send("broadcast-cursor", currentStepIndex);
   ipcRenderer.send("broadcast-progress", {
      currentStep: currentStepIndex,
      totalSteps: executionSteps.length
   });
}

function advanceCursor() {
   if (currentStepIndex >= executionSteps.length) return;

   const currentStep = executionSteps[currentStepIndex];

   if (currentStep.type === "char") {
      currentStep.element.classList.add("consumed");
      
      logManager.addEntry({
         char: currentStep.char
      });
      
      ipcRenderer.send("type-character", currentStep.char);
      currentStepIndex++;
   } else if (currentStep.type === "block") {
      currentStep.element.classList.add("consumed");
      currentStepIndex++;
      ipcRenderer.send("input-complete");
   }

   localStorage.setItem("lastStepIndex", currentStepIndex);
   updateCursor();
}

function populateSpecialKeys() {
   const keys = ["↢", "►", "💾", "↑", "↓", "←", "→", "‒"];
   
   uiManager.populateSpecialKeys(keys, (char) => {
      document.execCommand("insertText", false, char);
      const selectedBlockIndex = uiManager.getSelectedBlockIndex();
      
      if (selectedBlockIndex !== null) {
         const activeDiv = document.querySelectorAll(".block")[selectedBlockIndex];
         lessonManager.updateBlock(selectedBlockIndex, activeDiv.innerText);
      }
   });
}

function addBlock(type) {
   const selectedBlockIndex = uiManager.getSelectedBlockIndex();
   lessonManager.addBlock(type, selectedBlockIndex);
   renderLesson();
}

function removeBlock() {
   const selectedBlockIndex = uiManager.getSelectedBlockIndex();
   if (selectedBlockIndex === null) return;
   
   lessonManager.removeBlock(selectedBlockIndex);
   uiManager.deselectBlock();
   renderLesson();
}

function formatBlock() {
   const selectedBlockIndex = uiManager.getSelectedBlockIndex();
   if (selectedBlockIndex === null) return;
   
   const block = lessonManager.getBlock(selectedBlockIndex);
   if (!block || block.type !== "code") return;
   
   const formatted = formatCodeForAutoTyping(block.text);
   lessonManager.updateBlock(selectedBlockIndex, formatted);
   renderLesson();
}

function formatCodeForAutoTyping(code) {
   let text = code;
   
   text = text.split('\n').map(line => line.trimStart()).join('\n');
   text = text.replace(/↑►/g, '');
   
   const tags = ["html", "head", "body", "script", "div"];
   tags.forEach(tag => {
      const closingRegex = new RegExp(`</${tag}>`, 'g');
      text = text.replace(closingRegex, '↓');
      
      const openingRegex = new RegExp(`<${tag}>`, 'g');
      text = text.replace(openingRegex, `<${tag}>\n</${tag}>↑►`);
   });
   
   text = text.replace(/ +/g, ' ');
   text = text.replace(/\n /g, '\n');
   text = text.replace(/\n}/g, '↓');
   text = text.replace(/{\n/g, '{\n}↑►\n');
   text = text.replace(/\n↓/g, '↓');
   text = text.replace(/↓💾/g, '💾');
   text = text.replace(/↑►↓/g, '↑►');
   
   return text;
}

function setInitialStateToInactive() {
   ipcRenderer.send("set-active", false);
}

function startTimer() {
   timerManager.start(TIMER_CONFIG.DEFAULT_MINUTES);
   uiManager.showTimerControls();
}

function adjustTimer(minutes) {
   timerManager.adjust(minutes);
}

function broadcastLessonData() {
   const blocks = lessonManager.getAllBlocks();
   
   ipcRenderer.send("broadcast-lesson-data", {
      blocks: blocks,
      executionSteps: executionSteps.map(step => ({
         type: step.type,
         blockIndex: step.blockIndex,
         globalIndex: step.globalIndex,
         char: step.char
      }))
   });
}

window.addEventListener("beforeunload", () => {
   logManager.save();
   timerManager.reset();
});