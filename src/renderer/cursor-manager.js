const { ipcRenderer } = require("electron");
const { getBlockSubtype } = require("../shared/constants");

class CursorManager {
	constructor(uiManager, logManager) {
		this.uiManager = uiManager;
		this.logManager = logManager;
		this.currentStepIndex = 0;
		this.executionSteps = [];
		this.autoTypingActive = false;

		this.onEnterQuestionBlock = null;
		this.onLeaveQuestionBlock = null;
		this.onImageBlock = null;

		this._questionWindowOpen = false;
		this._imageWindowOpen = false;

		this._activeQuestionIndex = null;
		this._activeImageIndex = null;
	}

	setExecutionSteps(steps) {
		this.executionSteps = steps;
	}
	getExecutionSteps() {
		return this.executionSteps;
	}
	getCurrentStep() {
		return this.currentStepIndex;
	}

	_enterQuestionBlock(element, globalIndex) {
		if (this._activeQuestionIndex === globalIndex) return; // already shown
		this._activeQuestionIndex = globalIndex;
		this._questionWindowOpen = true;

		const question = element.innerText.trim().substring(1).trim(); // strip ❓
		const timestamp = Date.now();
		if (this.onEnterQuestionBlock)
			this.onEnterQuestionBlock(question, timestamp);
	}

	_leaveQuestionBlock() {
		if (!this._questionWindowOpen) return;
		this._questionWindowOpen = false;
		this._activeQuestionIndex = null;
		ipcRenderer.send("close-question-window");
		if (this.onLeaveQuestionBlock) this.onLeaveQuestionBlock();
	}

	_enterImageBlock(element, globalIndex) {
		if (this._activeImageIndex === globalIndex) return;
		this._activeImageIndex = globalIndex;
		this._imageWindowOpen = true;

		const match = element.innerText.trim().match(/^🖼️\s*(.+)$/);
		if (match && this.onImageBlock) this.onImageBlock(match[1].trim());
	}

	_leaveImageBlock() {
		if (!this._imageWindowOpen) return;
		this._imageWindowOpen = false;
		this._activeImageIndex = null;
		ipcRenderer.send("close-image-window");
	}

	updateLastStepIndex() {
		localStorage.setItem("lastStepIndex", this.currentStepIndex);
	}

	resetProgress() {
		this._leaveQuestionBlock();
		this._leaveImageBlock();
		this._activeQuestionIndex = null;
		this._activeImageIndex = null;
		this.currentStepIndex = 0;
		this.updateLastStepIndex();
		this.uiManager.updateProgressBar(0);
	}

	updateCursor() {
		this.uiManager.removeCursorClasses();

		if (this.currentStepIndex < this.executionSteps.length) {
			const step = this.executionSteps[this.currentStepIndex];

			if (step.type === "char") {
				this._leaveQuestionBlock();
				this._leaveImageBlock();
				step.element.classList.add("cursor");
				step.element.scrollIntoView({
					behavior: "smooth",
					block: "center",
				});
			} else if (step.type === "block") {
				step.element.classList.add("active-comment");
				step.element.scrollIntoView({
					behavior: "smooth",
					block: "center",
				});

				const blockText = step.element.innerText.trim();
				const subtype = getBlockSubtype(blockText);
				if (subtype === "question-comment") {
					this._leaveImageBlock();
					this._enterQuestionBlock(step.element, step.globalIndex);
				} else if (subtype === "image-comment") {
					this._leaveQuestionBlock();
					this._enterImageBlock(step.element, step.globalIndex);
				} else {
					this._leaveQuestionBlock();
					this._leaveImageBlock();
				}
			}
		} else {
			this._leaveQuestionBlock();
			this._leaveImageBlock();
		}

		const progress =
			(this.currentStepIndex / this.executionSteps.length) * 100 || 0;
		this.uiManager.updateProgressBar(progress);
		ipcRenderer.send("broadcast-cursor", this.currentStepIndex);
		ipcRenderer.send("broadcast-progress", {
			currentStep: this.currentStepIndex,
			totalSteps: this.executionSteps.length,
		});
	}

	advanceCursor(waitForCompletion = false) {
		if (this.currentStepIndex >= this.executionSteps.length) return;
		const currentStep = this.executionSteps[this.currentStepIndex];

		if (currentStep.type === "char") {
			currentStep.element.classList.add("consumed");
			this.logManager.addEntry({ char: currentStep.char });
			if (waitForCompletion) {
				return new Promise((resolve) => {
					ipcRenderer.once("character-typed", () => {
						this.currentStepIndex++;
						this.updateLastStepIndex();
						this.updateCursor();
						resolve();
					});
					ipcRenderer.send("type-character", currentStep.char);
				});
			} else {
				ipcRenderer.send("type-character", currentStep.char);
				this.currentStepIndex++;
			}
		} else if (currentStep.type === "block") {
			currentStep.element.classList.add("consumed");
			this.currentStepIndex++;
			ipcRenderer.send("input-complete");
		}

		if (!waitForCompletion || currentStep.type === "block") {
			this.updateLastStepIndex();
			this.updateCursor();
		}
	}

	async startAutoTyping() {
		if (this.autoTypingActive) return;
		this.autoTypingActive = true;

		const settings = await ipcRenderer.invoke("get-settings");
		const speed = settings.autoTypingSpeed || 100;
		const currentIndex = this.currentStepIndex;
		const stepsToType = [];

		for (let i = currentIndex; i < this.executionSteps.length; i++) {
			if (this.executionSteps[i].type === "block" && i > currentIndex) break;
			if (this.executionSteps[i].type === "char") {
				stepsToType.push({
					type: "char",
					char: this.executionSteps[i].char,
					index: i,
				});
			}
		}

		const stepCompleteHandler = (event, stepIndex) => {
			if (stepIndex < this.executionSteps.length) {
				const step = this.executionSteps[stepIndex];
				if (step.type === "char") {
					step.element.classList.add("consumed");
					this.logManager.addEntry({ char: step.char });
				}
				this.currentStepIndex = stepIndex + 1;
				this.updateLastStepIndex();
				this.updateCursor();
			}
		};

		const finishHandler = () => {
			ipcRenderer.removeListener(
				"auto-type-step-complete",
				stepCompleteHandler,
			);
			ipcRenderer.removeListener("auto-typing-finished", finishHandler);
			this.autoTypingActive = false;

			if (this.currentStepIndex < this.executionSteps.length) {
				this.currentStepIndex++;
				const current = this.executionSteps[this.currentStepIndex];
				if (current && current.type === "block") {
					current.element.classList.add("consumed");
					this.updateLastStepIndex();
					this.updateCursor();
					ipcRenderer.send("input-complete");
				}
			}
		};

		ipcRenderer.on("auto-type-step-complete", stepCompleteHandler);
		ipcRenderer.on("auto-typing-finished", finishHandler);
		ipcRenderer.send("start-auto-type-block", {
			steps: stepsToType,
			startIndex: 0,
			speed,
		});
	}

	stopAutoTyping() {
		if (this.autoTypingActive) {
			this.autoTypingActive = false;
			ipcRenderer.send("auto-typing-complete");
		}
	}

	jumpTo(index) {
		this._activeQuestionIndex = null;
		this._activeImageIndex = null;
		this.currentStepIndex = index;

		this.executionSteps.forEach((step, i) => {
			if (step.type === "char")
				step.element.classList.remove("cursor", "consumed");
			if (step.type === "block")
				step.element.classList.remove("active-comment", "consumed");
			if (i < index) step.element.classList.add("consumed");
		});

		this.updateLastStepIndex();
		this.updateCursor();
	}

	stepBackward() {
		if (this.currentStepIndex > 0) this.jumpTo(this.currentStepIndex - 1);
	}

	stepForward() {
		if (this.currentStepIndex < this.executionSteps.length)
			this.jumpTo(this.currentStepIndex + 1);
	}

	restoreConsumedSteps() {
		setTimeout(() => {
			this.executionSteps.forEach((step, i) => {
				if (i < this.currentStepIndex)
					step.element.classList.add("consumed");
			});
			this.updateCursor();
		}, 0);
	}

	loadSavedProgress() {
		const lastIndex = localStorage.getItem("lastStepIndex");
		if (lastIndex) this.currentStepIndex = parseInt(lastIndex);
	}
}

module.exports = CursorManager;
