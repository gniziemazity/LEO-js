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
let currentSettings = null;

window.addEventListener("DOMContentLoaded", () => {
   uiManager.cacheElements();

   const lastFile = localStorage.getItem("lastLessonPath");
   const lastIndex = localStorage.getItem("lastStepIndex");

   if (lastFile) {
      loadFilePath(lastFile, lastIndex ? parseInt(lastIndex) : 0);
      updateWindowTitle(lastFile.split(/[\\/]/).pop());
   } else {
      logManager.initialize();
   }

   setupManagers();
   setupEventListeners();
   setupKeyboardShortcuts();
   setupGlobalIpcListeners();
   setupSettingsListeners();
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

function setupEventListeners() {
   uiManager.getElement("toggleBtn").onclick = toggleActive;
   uiManager.getElement("addCommentBtn").onclick = () => addBlock("comment");
   uiManager.getElement("addCodeBtn").onclick = () => addBlock("code");
   uiManager.getElement("removeBlockBtn").onclick = removeBlock;
   uiManager.getElement("formatBlockBtn").onclick = formatBlock;
   uiManager.getElement("timerStartBtn").onclick = startTimer;
   uiManager.getElement("timerPlusBtn").onclick = () =>
      adjustTimer(TIMER_CONFIG.ADJUSTMENT_MINUTES);
   uiManager.getElement("timerMinusBtn").onclick = () =>
      adjustTimer(-TIMER_CONFIG.ADJUSTMENT_MINUTES);
}

function setupKeyboardShortcuts() {
   document.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.shiftKey && e.code === "KeyS") {
         ipcRenderer.send("resize-window");
      }
   });
}

function setupGlobalIpcListeners() {
   ipcRenderer.on("global-toggle-active", toggleActive);
   ipcRenderer.on("global-step-backward", stepBackward);
   ipcRenderer.on("global-step-forward", stepForward);
   ipcRenderer.on("advance-cursor", advanceCursor);
   ipcRenderer.on("toggle-transparency-event", () => {
      ipcRenderer.send("toggle-transparency");
   });
   ipcRenderer.on("settings-loaded", (event, settings) => {
      currentSettings = settings;
      applySettings(settings);
   });
   ipcRenderer.on("settings-saved", (event, settings) => {
      currentSettings = settings;
      applySettings(settings);
      closeSettingsModal();
   });
   ipcRenderer.on("new-plan", createNewLesson);
   ipcRenderer.on("save-plan", saveLesson);
   ipcRenderer.on("load-plan", loadLesson);
   ipcRenderer.on("open-settings", openSettingsModal);
}

function setupSettingsListeners() {
   const closeSettings = document.getElementById("closeSettings");
   const saveSettings = document.getElementById("saveSettings");
   const resetSettings = document.getElementById("resetSettings");
   const modal = document.getElementById("settingsModal");

   if (closeSettings) closeSettings.onclick = closeSettingsModal;
   if (saveSettings) saveSettings.onclick = saveSettingsFromModal;

   if (resetSettings) {
      resetSettings.onclick = async () => {
         if (confirm("Reset all settings to default values?")) {
            ipcRenderer.send("reset-settings");
            ipcRenderer.once("settings-loaded", (event, settings) => {
               loadSettingsIntoModal(settings);
            });
         }
      };
   }

   if (modal) {
      modal.onclick = (e) => {
         if (e.target === modal) closeSettingsModal();
      };
   }
}

// ============================================================================
// LESSON FILE OPERATIONS
// ============================================================================

async function createNewLesson() {
   const filePath = await ipcRenderer.invoke("show-save-dialog");
   if (!filePath) return;

   lessonManager.create(filePath, (err) => {
      if (err) {
         console.error("Failed to create file:", err);
         alert("Failed to create file: " + err);
         return;
      }

      const fileName = filePath.split(/[\\/]/).pop();
      updateWindowTitle(fileName);
      localStorage.setItem("lastLessonPath", filePath);
      logManager.initialize(filePath);
      resetProgress();
      renderLesson();
   });
}

async function loadLesson() {
   const filePath = await ipcRenderer.invoke("show-open-dialog");
   if (!filePath) return;

   const fileName = filePath.split(/[\\/]/).pop();
   updateWindowTitle(fileName);
   loadFilePath(filePath, 0);
}

function loadFilePath(filePath, savedIndex = 0) {
   lessonManager.load(filePath, (err, data) => {
      if (err) {
         console.error("Failed to load file:", err);
         alert("Failed to load file: " + err);
         return;
      }

      localStorage.setItem("lastLessonPath", filePath);
      currentStepIndex = savedIndex;

      resetProgress();
      logManager.initialize(filePath);
      renderLesson();
      setInitialStateToInactive();

      const path = require("path");
      const lessonName = path.basename(filePath, ".json");
      ipcRenderer.send("broadcast-lesson", lessonName);
   });
}

function saveLesson() {
   lessonManager.save((err) => {
      if (err) {
         console.error("Save failed:", err);
         alert("Save failed: " + err);
      }
   });
}

function resetProgress() {
   currentStepIndex = 0;
   localStorage.setItem("lastStepIndex", 0);
   uiManager.updateProgressBar(0);
}

// ============================================================================
// LESSON RENDERING
// ============================================================================

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
         globalStepCounter = renderCommentBlock(
            blockDiv,
            block,
            blockIdx,
            isTypingActive,
            globalStepCounter,
         );
      } else if (block.type === "code") {
         globalStepCounter = renderCodeBlock(
            blockDiv,
            block,
            blockIdx,
            isTypingActive,
            globalStepCounter,
         );
      }

      uiManager.appendToLessonContainer(blockDiv);
   });

   if (isTypingActive) {
      updateCursor();
   }

   broadcastLessonData();
}

function renderCommentBlock(
   blockDiv,
   block,
   blockIdx,
   isTypingActive,
   globalStepCounter,
) {
   blockDiv.contentEditable = !isTypingActive;
   blockDiv.innerText = block.text;
   blockDiv.oninput = () => {
      lessonManager.updateBlock(blockIdx, blockDiv.innerText);
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

function renderCodeBlock(
   blockDiv,
   block,
   blockIdx,
   isTypingActive,
   globalStepCounter,
) {
   const selectedBlockIndex = uiManager.getSelectedBlockIndex();

   if (selectedBlockIndex === blockIdx && !isTypingActive) {
      blockDiv.contentEditable = "true";
      blockDiv.innerText = block.text;
      blockDiv.oninput = () => {
         lessonManager.updateBlock(blockIdx, blockDiv.innerText);
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

function broadcastLessonData() {
   const blocks = lessonManager.getAllBlocks();

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

// ============================================================================
// PROGRESS MANAGEMENT
// ============================================================================

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
      totalSteps: executionSteps.length,
   });
}

function advanceCursor() {
   if (currentStepIndex >= executionSteps.length) return;

   const currentStep = executionSteps[currentStepIndex];

   if (currentStep.type === "char") {
      currentStep.element.classList.add("consumed");

      logManager.addEntry({
         char: currentStep.char,
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

function stepBackward() {
   if (currentStepIndex > 0) {
      jumpTo(currentStepIndex - 1);
   }
}

function stepForward() {
   if (currentStepIndex < executionSteps.length) {
      jumpTo(currentStepIndex + 1);
   }
}

function toggleActive() {
   const isCurrentlyInactive = !uiManager.isActive();

   if (isCurrentlyInactive) {
      uiManager.deselectBlock();
   }

   uiManager.setTypingActive(isCurrentlyInactive);
   ipcRenderer.send("set-active", isCurrentlyInactive);
   ipcRenderer.send("broadcast-active", isCurrentlyInactive);

   renderLesson();

   if (isCurrentlyInactive && currentStepIndex > 0) {
      setTimeout(() => {
         executionSteps.forEach((step, i) => {
            if (i < currentStepIndex) {
               step.element.classList.add("consumed");
            }
         });
         updateCursor();
      }, 0);
   }
}

// ============================================================================
// BLOCK OPERATIONS
// ============================================================================

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
         const step = executionSteps.find((s) => s.blockIndex === blockIdx);
         if (step) {
            jumpTo(step.globalIndex);
         }
      }
   }
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

function populateSpecialKeys() {
   const keys = ["←", "→", "↑", "↓", "◄", "►", "▲", "▼", "↢", "‒", "⇑", "⇓", "⇐", "⇒", "💾", "🔁"];

   uiManager.populateSpecialKeys(keys, (char) => {
      document.execCommand("insertText", false, char);
      const selectedBlockIndex = uiManager.getSelectedBlockIndex();

      if (selectedBlockIndex !== null) {
         const activeDiv =
            document.querySelectorAll(".block")[selectedBlockIndex];
         lessonManager.updateBlock(selectedBlockIndex, activeDiv.innerText);
      }
   });
}

// ============================================================================
// SETTINGS MANAGEMENT
// ============================================================================

async function openSettingsModal() {
   const settings = await ipcRenderer.invoke("get-settings");
   currentSettings = settings;
   loadSettingsIntoModal(settings);
   document.getElementById("settingsModal").classList.add("active");
}

function closeSettingsModal() {
   document.getElementById("settingsModal").classList.remove("active");
}

function loadSettingsIntoModal(settings) {
   document.getElementById("typingHotkeys").value =
      settings.hotkeys.typing.join("");
   document.getElementById("toggleActiveKey").value =
      settings.hotkeys.toggleActive;
   document.getElementById("stepBackwardKey").value =
      settings.hotkeys.stepBackward;
   document.getElementById("stepForwardKey").value =
      settings.hotkeys.stepForward;
   document.getElementById("alwaysOnTopKey").value =
      settings.hotkeys.alwaysOnTop;
   document.getElementById("toggleTransparencyKey").value =
      settings.hotkeys.toggleTransparency;

   document.getElementById("commentNormalColor").value =
      settings.colors.commentNormal;
   document.getElementById("commentActiveColor").value =
      settings.colors.commentActive;
   document.getElementById("commentSelectedColor").value =
      settings.colors.commentSelected;
   document.getElementById("commentActiveTextColor").value =
      settings.colors.commentActiveText;
   document.getElementById("cursorColor").value = settings.colors.cursor;
   document.getElementById("selectedBorderColor").value =
      settings.colors.selectedBorder;
   document.getElementById("textColor").value = settings.colors.textColor;

   document.getElementById("fontSize").value = settings.fontSize;
}

function saveSettingsFromModal() {
   const typingHotkeysStr = document.getElementById("typingHotkeys").value;
   const typingHotkeys = typingHotkeysStr.split("").filter((c) => c.trim());

   const settings = {
      hotkeys: {
         typing: typingHotkeys,
         toggleActive: document.getElementById("toggleActiveKey").value,
         stepBackward: document.getElementById("stepBackwardKey").value,
         stepForward: document.getElementById("stepForwardKey").value,
         alwaysOnTop: document.getElementById("alwaysOnTopKey").value,
         toggleTransparency: document.getElementById("toggleTransparencyKey")
            .value,
      },
      colors: {
         commentNormal: document.getElementById("commentNormalColor").value,
         commentActive: document.getElementById("commentActiveColor").value,
         commentSelected: document.getElementById("commentSelectedColor").value,
         commentActiveText: document.getElementById("commentActiveTextColor")
            .value,
         cursor: document.getElementById("cursorColor").value,
         selectedBorder: document.getElementById("selectedBorderColor").value,
         textColor: document.getElementById("textColor").value,
      },
      fontSize: parseInt(document.getElementById("fontSize").value),
   };

   ipcRenderer.send("save-settings", settings);
}

function applySettings(settings) {
   if (!settings) return;

   const styleId = "dynamic-settings-styles";
   let styleEl = document.getElementById(styleId);

   if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
   }

   styleEl.textContent = `
      body {
         font-size: ${settings.fontSize}px;
      }
      
      .comment-block,
      .code-block {
         color: ${settings.colors.textColor};
      }
      
      .comment-block {
         background: ${settings.colors.commentNormal};
      }
      
      .comment-block.active-comment {
         background: ${settings.colors.commentActive};
         color: ${settings.colors.commentActiveText};
      }
      
      .block.selected {
         background-color: ${settings.colors.commentSelected};
         border-left-color: ${settings.colors.selectedBorder};
      }
      
      .char.cursor {
         background: ${settings.colors.cursor};
      }
   `;
}

// ============================================================================
// TIMER OPERATIONS
// ============================================================================

function startTimer() {
   timerManager.start(TIMER_CONFIG.DEFAULT_MINUTES);
   uiManager.showTimerControls();
}

function adjustTimer(minutes) {
   timerManager.adjust(minutes);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function setInitialStateToInactive() {
   ipcRenderer.send("set-active", false);
}

function updateWindowTitle(fileName = "") {
   ipcRenderer.send("update-window-title", fileName);

   const baseTitle = "LEO";
   if (fileName && fileName.trim() !== "") {
      const displayName = fileName.replace(/\.json$/i, "");
      document.title = `${baseTitle} - ${displayName}`;
   } else {
      document.title = baseTitle;
   }
}

// ============================================================================
// CLEANUP
// ============================================================================

window.addEventListener("beforeunload", () => {
   logManager.save();
   timerManager.reset();
});
