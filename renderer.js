const { ipcRenderer } = require("electron");
const fs = require("fs");

let lessonData = [];
let currentStepIndex = 0;
let executionSteps = [];
let currentFilePath = "";
let selectedBlockIndex = null;

window.addEventListener("DOMContentLoaded", () => {
   const lastFile = localStorage.getItem("lastLessonPath");
   const lastIndex = localStorage.getItem("lastStepIndex");

   if (lastFile && fs.existsSync(lastFile)) {
      loadFilePath(lastFile, lastIndex ? parseInt(lastIndex) : 0);
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
   document.getElementById("loadBtn").onclick = () =>
      document.getElementById("fileInput").click();
   document.getElementById("saveBtn").onclick = saveLesson;
   document.getElementById("toggleBtn").onclick = toggleActive;

   document.getElementById("addCommentBtn").onclick = () => addBlock("comment");
   document.getElementById("addCodeBtn").onclick = () => addBlock("code");
   document.getElementById("removeBlockBtn").onclick = removeBlock;

   document.getElementById("fileInput").onchange = (e) => {
      if (e.target.files[0]) loadFilePath(e.target.files[0].path, 0);
   };
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

function createNewLesson() {
   const defaultData = [
      { type: "comment", text: "Enter plan title" },
      { type: "code", text: "Enter first code snippet" },
   ];

   currentFilePath = "";
   localStorage.removeItem("lastLessonPath");
   localStorage.removeItem("lastStepIndex");

   lessonData = defaultData;
   resetProgress();

   renderLesson();
   alert(
      "New lesson created. Don't forget to 'Save' to choose a file location!"
   );
}

function navigateBlocks(direction) {
   if (!lessonData.length) return;

   // find current block
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

   // find the first step (stepIndex) that belongs to this new block
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
      if (err) return console.error(err);
      try {
         lessonData = JSON.parse(data);
         localStorage.setItem("lastLessonPath", path);
         currentStepIndex = savedIndex;

         resetProgress();

         renderLesson();
         setInitialStateToInactive();
      } catch (e) {
         console.error("JSON Error:", e);
      }
   });
}

function saveLesson() {
   if (!currentFilePath) {
      const { dialog } = require("electron").remote;
      const path = dialog.showSaveDialogSync({
         filters: [{ name: "JSON", extensions: ["json"] }],
      });

      if (path) {
         currentFilePath = path;
         localStorage.setItem("lastLessonPath", path);
      } else {
         return; // user cancelled
      }
   }

   fs.writeFile(currentFilePath, JSON.stringify(lessonData, null), (err) => {
      if (err) alert("Save failed: " + err);
      else alert("Saved successfully!");
   });
}

function renderLesson() {
   const container = document.getElementById("lesson-container");
   const sidebar = document.getElementById("editor-sidebar");
   const isTypingActive =
      document.getElementById("toggleBtn").textContent === "STOP";

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
            if (selectedBlockIndex === blockIdx) return;
            selectedBlockIndex = blockIdx;
            sidebar.classList.remove("hidden");
            renderLesson();
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
         blockDiv.textContent = block.text;
         blockDiv.oninput = () => {
            block.text = blockDiv.textContent;
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
            // edit mode
            blockDiv.contentEditable = "true";
            blockDiv.innerText = block.text;
            blockDiv.oninput = () => {
               block.text = blockDiv.innerText;
            };
         } else {
            // auto-typing mode
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

      // past items
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
      btn.style.background = "#e74c3c";
      ipcRenderer.send("set-active", true);
   } else {
      btn.textContent = "START";
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
   const keys = ["↢", "►", "💾", "↑", "↓", "←", "→", "‒"]; // TO-DO: Interface for choosing special keys
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
         }
      };
      grid.appendChild(btn);
   });
}

function addBlock(type) {
   const newBlock = { type, text: type === "code" ? "" : "New Comment" };
   if (selectedBlockIndex === null) lessonData.push(newBlock);
   else lessonData.splice(selectedBlockIndex + 1, 0, newBlock);
   renderLesson();
}

function removeBlock() {
   if (selectedBlockIndex === null) return;
   lessonData.splice(selectedBlockIndex, 1);
   selectedBlockIndex = null;
   document.getElementById("editor-sidebar").classList.add("hidden");
   renderLesson();
}

function setInitialStateToInactive() {
   ipcRenderer.send("set-active", false);
}

ipcRenderer.on("advance-cursor", advanceCursor);
