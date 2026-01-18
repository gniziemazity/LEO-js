const { ipcRenderer } = require("electron");
const fs = require("fs");

let lessonData = [];
let currentStepIndex = 0;
let executionSteps = [];
let currentFilePath = "";
let selectedBlockIndex = null;
let hasUnsavedChanges = false;
let timerInterval = null;
let timerSeconds = 0;
let keyPressLog = [];
let keyPressLogPath = "";
let sessionStartTime = null;

window.addEventListener("DOMContentLoaded", () => {
   const lastFile = localStorage.getItem("lastLessonPath");
   const lastIndex = localStorage.getItem("lastStepIndex");

   if (lastFile && fs.existsSync(lastFile)) {
      loadFilePath(lastFile, lastIndex ? parseInt(lastIndex) : 0);
   } else {
      // initialize logging even without a file
      initializeKeyPressLog();
   }
   
   populateSpecialKeys();
   setupEventListeners();
   setupKeyboardShortcuts();
   setupGlobalIpcListeners();
});

function setupGlobalIpcListeners() {
   ipcRenderer.on("global-toggle-active", () => {
      toggleActive();
   });

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
}

function setupEventListeners() {
   document.getElementById("newBtn").onclick = createNewLesson;
   document.getElementById("loadBtn").onclick = loadLesson;
   document.getElementById("saveBtn").onclick = saveLesson;
   document.getElementById("toggleBtn").onclick = toggleActive;
   document.getElementById("toggleBtn").title = "Start Auto-typing";

   document.getElementById("addCommentBtn").onclick = () => addBlock("comment");
   document.getElementById("addCodeBtn").onclick = () => addBlock("code");
   document.getElementById("removeBlockBtn").onclick = removeBlock;

   document.getElementById("timerStartBtn").onclick = startTimer;
   document.getElementById("timerPlusBtn").onclick = () => adjustTimer(10);
   document.getElementById("timerMinusBtn").onclick = () => adjustTimer(-10);
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
      return; // user cancelled
   }

   const defaultData = [
      { type: "comment", text: "Enter lesson title" },
      { type: "code", text: "// Enter first code snippet" },
   ];

   currentFilePath = filePath;
   lessonData = defaultData;
   resetProgress();

   // save the new file
   fs.writeFile(currentFilePath, JSON.stringify(lessonData, null, 2), (err) => {
      if (err) {
         alert("Failed to create file: " + err);
         currentFilePath = "";
         return;
      }
      
      localStorage.setItem("lastLessonPath", currentFilePath);
      hasUnsavedChanges = false;
      initializeKeyPressLog();
      renderLesson();
   });
}

async function loadLesson() {
   const filePath = await ipcRenderer.invoke("show-open-dialog");
   
   if (filePath) {
      loadFilePath(filePath, 0);
   }
}

function navigateBlocks(direction) {
   if (!lessonData.length) return;

   let currentBlockIdx = 0;
   if (currentStepIndex < executionSteps.length) {
      currentBlockIdx = executionSteps[currentStepIndex].blockIndex;
   } else {
      currentBlockIdx = lessonData.length - 1;
   }

   let newBlockIdx = currentBlockIdx + direction;

   if (newBlockIdx < 0) {
      newBlockIdx = 0;
   }
   if (newBlockIdx >= lessonData.length) {
      newBlockIdx = lessonData.length - 1;
   }

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

   const progressBar = document.getElementById("progressBar");
   if (progressBar) {
      progressBar.style.width = "0%";
   }
}

function loadFilePath(path, savedIndex = 0) {
   currentFilePath = path;
   fs.readFile(path, "utf8", (err, data) => {
      if (err) {
         alert("Failed to load file: " + err);
         return;
      }
      
      try {
         lessonData = JSON.parse(data);
         localStorage.setItem("lastLessonPath", path);
         currentStepIndex = savedIndex;
         hasUnsavedChanges = false;

         resetProgress();
         initializeKeyPressLog();
         renderLesson();
         setInitialStateToInactive();
      } catch (e) {
         alert("Invalid JSON file: " + e);
      }
   });
}

function saveLesson() {
   if (!currentFilePath) {
      alert("No file is currently open. Use 'New' to create a file first.");
      return;
   }

   fs.writeFile(currentFilePath, JSON.stringify(lessonData, null, 2), (err) => {
      if (err) {
         alert("Save failed: " + err);
      } else {
         hasUnsavedChanges = false;
      }
   });
}

function markAsChanged() {
   hasUnsavedChanges = true;
}

function renderLesson() {
   const container = document.getElementById("lesson-container");
   const sidebar = document.getElementById("editor-sidebar");
   const isTypingActive =
      document.getElementById("toggleBtn").textContent === "STOP";

   // Show sidebar when not in typing mode
   if (!isTypingActive) {
      sidebar.classList.remove("hidden");
   } else {
      sidebar.classList.add("hidden");
   }

   container.innerHTML = "";
   executionSteps = [];
   let globalStepCounter = 0;

   lessonData.forEach((block, blockIdx) => {
      const blockDiv = document.createElement("div");
      blockDiv.className = `block ${block.type}-block`;

      if (selectedBlockIndex === blockIdx) {
         blockDiv.classList.add("selected");
      }
      
      blockDiv.onclick = (e) => {
         if (!isTypingActive) {
            // If already selected, don't re-render (to preserve cursor position)
            if (selectedBlockIndex === blockIdx) return;
            
            // Store the click position before re-rendering
            const clickX = e.clientX;
            const clickY = e.clientY;
            
            selectedBlockIndex = blockIdx;
            sidebar.classList.remove("hidden");
            renderLesson();
            
            // Focus and restore cursor position after render
            setTimeout(() => {
               const blocks = document.querySelectorAll(".block");
               const targetBlock = blocks[blockIdx];
               if (targetBlock) {
                  targetBlock.focus();
                  
                  // Try to place cursor at the clicked position
                  const range = document.caretRangeFromPoint(clickX, clickY);
                  if (range) {
                     const selection = window.getSelection();
                     selection.removeAllRanges();
                     selection.addRange(range);
                  }
               }
            }, 0);
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
      };

      if (block.type === "comment") {
         blockDiv.contentEditable = !isTypingActive;
         // Use innerText to properly handle newlines
         blockDiv.innerText = block.text;
         blockDiv.oninput = () => {
            // Use innerText to preserve newlines when saving
            block.text = blockDiv.innerText;
            markAsChanged();
         };

         executionSteps.push({
            type: "block",
            element: blockDiv,
            blockIndex: blockIdx,
            globalIndex: globalStepCounter,
         });

         blockDiv.dataset.stepIndex = globalStepCounter;
         globalStepCounter++;
      } else if (block.type === "code") {
         if (selectedBlockIndex === blockIdx && !isTypingActive) {
            blockDiv.contentEditable = "true";
            blockDiv.innerText = block.text;
            blockDiv.oninput = () => {
               block.text = blockDiv.innerText;
               markAsChanged();
            };
         } else {
            blockDiv.contentEditable = "false";
            for (const char of block.text) {
               const span = document.createElement("span");
               span.className = "char";
               if (char === "\n") {
                  span.style.display = "block";
               } else if (char === " ") {
                  span.innerHTML = "&nbsp;";
               } else {
                  span.textContent = char;
               }

               span.dataset.stepIndex = globalStepCounter;
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
         }
      }
      container.appendChild(blockDiv);
   });

   if (isTypingActive) updateCursor();
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
}

function toggleActive() {
   const btn = document.getElementById("toggleBtn");
   const isCurrentlyInactive = btn.textContent === "START";

   if (isCurrentlyInactive) {
      btn.textContent = "STOP";
      btn.title = "Stop Auto-typing";
      btn.style.background = "#e74c3c";
      ipcRenderer.send("set-active", true);
   } else {
      btn.textContent = "START";
      btn.title = "Start Auto-typing";
      btn.style.background = "#27ae60";
      ipcRenderer.send("set-active", false);
   }
   renderLesson();
}

function updateCursor() {
   document
      .querySelectorAll(".cursor")
      .forEach((el) => el.classList.remove("cursor"));
   document
      .querySelectorAll(".active-comment")
      .forEach((el) => el.classList.remove("active-comment"));

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
   document.getElementById("progressBar").style.width = progress + "%";
}

function advanceCursor() {
   if (currentStepIndex >= executionSteps.length) return;

   const currentStep = executionSteps[currentStepIndex];

   if (currentStep.type === "char") {
      currentStep.element.classList.add("consumed");
      
      // Log the auto-typed character
      addToKeyPressLog({
         char: currentStep.char,
         source: "auto-typed",
         stepIndex: currentStepIndex,
         blockIndex: currentStep.blockIndex
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
   const grid = document.getElementById("special-keys-container");
   grid.innerHTML = "";
   keys.forEach((char) => {
      const btn = document.createElement("button");
      btn.className = "key-btn";
      btn.textContent = char;
      btn.onclick = () => {
         document.execCommand("insertText", false, char);
         if (selectedBlockIndex !== null) {
            const activeDiv =
               document.querySelectorAll(".block")[selectedBlockIndex];
            lessonData[selectedBlockIndex].text = activeDiv.innerText;
            markAsChanged();
         }
      };
      grid.appendChild(btn);
   });
}

function addBlock(type) {
   const newBlock = { type, text: type === "code" ? "" : "New Comment" };
   if (selectedBlockIndex === null) lessonData.push(newBlock);
   else lessonData.splice(selectedBlockIndex + 1, 0, newBlock);
   markAsChanged();
   renderLesson();
}

function removeBlock() {
   if (selectedBlockIndex === null) return;
   lessonData.splice(selectedBlockIndex, 1);
   selectedBlockIndex = null;
   document.getElementById("editor-sidebar").classList.add("hidden");
   markAsChanged();
   renderLesson();
}

function setInitialStateToInactive() {
   ipcRenderer.send("set-active", false);
}

function startTimer() {
   timerSeconds = 10 * 60; // 10 minutes
   document.getElementById("timerStartBtn").style.display = "none";
   document.getElementById("timerControls").style.display = "flex";
   updateTimerDisplay();
   
   timerInterval = setInterval(() => {
      timerSeconds--;
      updateTimerDisplay();
      
      if (timerSeconds <= 0) {
         stopTimer();
      }
   }, 1000);
}

function adjustTimer(minutes) {
   timerSeconds += minutes * 60;
   
   if (timerSeconds <= 0) {
      stopTimer();
   } else {
      updateTimerDisplay();
   }
}

function stopTimer() {
   if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
   }
   timerSeconds = 0;
   document.getElementById("timerStartBtn").style.display = "block";
   document.getElementById("timerControls").style.display = "none";
}

function updateTimerDisplay() {
   const hours = Math.floor(timerSeconds / 3600);
   const minutes = Math.floor((timerSeconds % 3600) / 60);
   const seconds = timerSeconds % 60;
   
   let display;
   if (hours > 0) {
      display = `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
   } else {
      display = `${minutes}:${seconds.toString().padStart(2, '0')}`;
   }
   
   document.getElementById("timerDisplay").textContent = display;
}

function initializeKeyPressLog() {
   keyPressLog = [];
   sessionStartTime = Date.now();
   
   const path = require("path");
   let dir, basename;
   
   if (currentFilePath) {
      dir = path.dirname(currentFilePath);
      basename = path.basename(currentFilePath, ".json");
   } else {
      // if no file is loaded, use a temporary location
      dir = require("os").tmpdir();
      basename = "unnamed_lesson";
   }
   
   const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
   keyPressLogPath = path.join(dir, `${basename}_key_presses_${timestamp}.json`);
   
   saveKeyPressLog();
}

// Centralized function to add entries to the log
function addToKeyPressLog(entry) {
   if (!sessionStartTime) return;
   
   const logEntry = {
      timestamp: Date.now(),
      relativeTime: Date.now() - sessionStartTime,
      isTypingActive: document.getElementById("toggleBtn").textContent === "STOP",
      ...entry
   };
   
   keyPressLog.push(logEntry);
   
   // save every 10 keypresses to avoid too many writes
   if (keyPressLog.length % 10 === 0) {
      saveKeyPressLog();
   }
}

function saveKeyPressLog() {
   if (!keyPressLogPath) return;
   
   const logData = {
      lessonFile: currentFilePath || "No file loaded",
      sessionStart: sessionStartTime,
      keyPresses: keyPressLog
   };
   
   fs.writeFile(keyPressLogPath, JSON.stringify(logData, null, 2), (err) => {
      if (err) {
         console.error("Failed to save key press log:", err);
      }
   });
}

// save log when window closes
window.addEventListener("beforeunload", () => {
   saveKeyPressLog();
});

ipcRenderer.on("advance-cursor", advanceCursor);