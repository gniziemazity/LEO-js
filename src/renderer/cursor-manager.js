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
		this.onWebBlock = null;
		this.onEnterMoveToBlock = null;
		this._moveToWindowOpen = false;

		this._isQuestionWindowOpen = false;
		this._isImageWindowOpen = false;
		this._isWebWindowOpen = false;

		this._currentQuestionStepIndex = null;
		this._currentImageStepIndex = null;
		this._currentWebStepIndex = null;
		this._currentCodeInsertStepIndex = null;
		this._activeMoveToIndex = null;

		this._onAutoStepComplete = (event, stepIndex) => {
			if (!this.autoTypingActive) return;
			if (stepIndex < this.executionSteps.length) {
				const step = this.executionSteps[stepIndex];
				if (step.type === "char") {
					step.element.classList.add("consumed");
					this.logManager.addEntry({ char: step.char });
				}
				this.currentStepIndex = stepIndex + 1;
				this.updateCursor();
			}
		};
		this._onAutoFinish = () => {
			if (!this.autoTypingActive) return;
			this.autoTypingActive = false;
			while (this.currentStepIndex < this.executionSteps.length) {
				const current = this.executionSteps[this.currentStepIndex];
				if (current.type === "anchor") {
					current.element.classList.add("consumed");
					if (!current._logged) {
						current._logged = true;
						this.logManager.addEntry({ anchor: current.value });
					}
					this.currentStepIndex++;
				} else if (current.type === "block") {
					current.element.classList.add("consumed");
					this.currentStepIndex++;
					this.updateCursor();
					ipcRenderer.send("input-complete");
					return;
				} else {
					break;
				}
			}
			this.updateCursor();
		};
		ipcRenderer.on("auto-type-step-complete", this._onAutoStepComplete);
		ipcRenderer.on("auto-typing-finished", this._onAutoFinish);
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
		if (this._currentQuestionStepIndex === globalIndex) return;
		this._currentQuestionStepIndex = globalIndex;
		this._isQuestionWindowOpen = true;
		const question = element.innerText.replace(/^❓ ?/, "");
		const timestamp = Date.now();
		if (this.onEnterQuestionBlock)
			this.onEnterQuestionBlock(question, timestamp);
	}

	_leaveQuestionBlock() {
		if (!this._isQuestionWindowOpen) return;
		this._isQuestionWindowOpen = false;
		this._currentQuestionStepIndex = null;
		ipcRenderer.send("close-question-window");
		if (this.onLeaveQuestionBlock) this.onLeaveQuestionBlock();
	}

	_enterImageBlock(element, globalIndex) {
		if (this._currentImageStepIndex === globalIndex) return;
		this._currentImageStepIndex = globalIndex;
		this._isImageWindowOpen = true;

		const match = element.innerText.trim().match(/^🖼️ ?(.+)$/);
		if (match) {
			const parts = match[1].trim().split(/\s+/);
			const imageName = parts[0];
			const shouldPin = parts
				.slice(1)
				.some((p) => p.toLowerCase() === "pin");
			if (this.onImageBlock) this.onImageBlock(imageName, shouldPin);
		}
	}

	_leaveImageBlock() {
		if (!this._isImageWindowOpen) return;
		this._isImageWindowOpen = false;
		this._currentImageStepIndex = null;
		ipcRenderer.send("close-image-window");
	}

	_enterWebBlock(element, globalIndex) {
		if (this._currentWebStepIndex === globalIndex) return;
		this._currentWebStepIndex = globalIndex;
		this._isWebWindowOpen = true;

		const raw = element.innerText.replace(/^🌐 ?/, "");
		const parts = raw.trim().split(/\s+/);
		const url = parts[0];
		const shouldPin = parts.slice(1).some((p) => p.toLowerCase() === "pin");
		if (this.onWebBlock) this.onWebBlock(url, shouldPin);
	}

	_leaveWebBlock() {
		if (!this._isWebWindowOpen) return;
		this._isWebWindowOpen = false;
		this._currentWebStepIndex = null;
		ipcRenderer.send("close-web-window");
	}

	_enterMoveToBlock(step) {
		if (this._activeMoveToIndex === step.globalIndex) return;
		this._activeMoveToIndex = step.globalIndex;
		this._moveToWindowOpen = true;
		this.logManager.addEntry({ move_to: step.target || "MAIN" });
		if (this.onEnterMoveToBlock) {
			const rawTarget = step.target || "MAIN";
			let mode = "main";
			let target = rawTarget;
			if (rawTarget === "DEV") {
				mode = "dev";
			} else if (rawTarget === "MAIN") {
				mode = "main";
			} else {
				const wrapped =
					rawTarget.startsWith("⚓") && rawTarget.endsWith("⚓");
				const inner = wrapped ? rawTarget.slice(1, -1) : rawTarget;
				if (/\.[a-z0-9]+$/i.test(inner)) {
					mode = "file";
					target = inner;
				} else if (wrapped) {
					mode = "anchor";
				}
			}
			this.onEnterMoveToBlock({
				mode,
				target,
				snippet: step.snippet || null,
			});
		}
	}

	_leaveMoveToBlock() {
		if (!this._moveToWindowOpen) return;
		this._moveToWindowOpen = false;
		this._activeMoveToIndex = null;
		ipcRenderer.send("close-move-to-window");
	}

	_clearSpecialBlockState() {
		this._currentCodeInsertStepIndex = null;
		this._activeMoveToIndex = null;
	}

	_leaveSpecialBlocksExcept(type) {
		if (type !== "question") this._leaveQuestionBlock();
		if (type !== "image") this._leaveImageBlock();
		if (type !== "web") this._leaveWebBlock();
		if (type !== "move-to") this._leaveMoveToBlock();
	}

	_broadcastProgress() {
		const progress =
			(this.currentStepIndex / this.executionSteps.length) * 100 || 0;
		this.uiManager.updateProgressBar(progress);
		ipcRenderer.send("update-cursor", this.currentStepIndex);
		ipcRenderer.send("update-progress", {
			currentStep: this.currentStepIndex,
			totalSteps: this.executionSteps.length,
		});
	}

	resetProgress() {
		this._leaveQuestionBlock();
		this._leaveImageBlock();
		this._leaveWebBlock();
		this._currentQuestionStepIndex = null;
		this._currentImageStepIndex = null;
		this._currentWebStepIndex = null;
		this._currentCodeInsertStepIndex = null;
		this._activeMoveToIndex = null;
		this.currentStepIndex = 0;
		this.uiManager.updateProgressBar(0);
	}

	updateCursor() {
		this.uiManager.removeCursorClasses();

		if (this.currentStepIndex < this.executionSteps.length) {
			const step = this.executionSteps[this.currentStepIndex];

			if (step.type === "char") {
				this._leaveSpecialBlocksExcept();
				this._clearSpecialBlockState();
				step.element.classList.add("cursor");
				step.element.scrollIntoView({
					behavior: "smooth",
					block: "center",
				});
			} else if (step.type === "anchor") {
				this._leaveSpecialBlocksExcept();
				this._clearSpecialBlockState();
				step.element.classList.add("cursor");
				step.element.scrollIntoView({
					behavior: "smooth",
					block: "center",
				});
				if (!step._logged) {
					step._logged = true;
					this.logManager.addEntry({ anchor: step.value });
				}
			} else if (step.type === "block") {
				step.element.classList.add("active-comment");
				step.element.scrollIntoView({
					behavior: "smooth",
					block: "center",
				});

				if (step.subtype === "move-to") {
					this._leaveSpecialBlocksExcept("move-to");
					this._currentCodeInsertStepIndex = null;
					this._enterMoveToBlock(step);
					this._broadcastProgress();
					return;
				}

				const blockText = step.element.innerText.trim();
				const subtype = getBlockSubtype(blockText);
				if (subtype === "question-comment") {
					this._leaveSpecialBlocksExcept("question");
					this._clearSpecialBlockState();
					this._enterQuestionBlock(step.element, step.globalIndex);
				} else if (subtype === "image-comment") {
					this._leaveSpecialBlocksExcept("image");
					this._clearSpecialBlockState();
					this._enterImageBlock(step.element, step.globalIndex);
				} else if (subtype === "web-comment") {
					this._leaveSpecialBlocksExcept("web");
					this._clearSpecialBlockState();
					this._enterWebBlock(step.element, step.globalIndex);
				} else if (subtype === "code-insert-comment") {
					this._leaveSpecialBlocksExcept();
					if (this._currentCodeInsertStepIndex !== step.globalIndex) {
						this._currentCodeInsertStepIndex = step.globalIndex;
						const fullText = step.element.title || step.element.innerText;
						const text = fullText.replace(/^📋 ?/, "");
						this.logManager.addEntry({ code_insert: text });
					}
				} else if (subtype === "move-to-comment") {
					this._leaveSpecialBlocksExcept("move-to");
					this._currentCodeInsertStepIndex = null;
					if (this._activeMoveToIndex !== step.globalIndex) {
						this._activeMoveToIndex = step.globalIndex;
						const text = step.element.innerText.replace(/^➡️ ?/, "");
						this.logManager.addEntry({ move_to: text });
					}
				} else {
					this._leaveSpecialBlocksExcept();
					this._clearSpecialBlockState();
				}
			}
		} else {
			this._leaveSpecialBlocksExcept();
		}

		this._broadcastProgress();
	}

	advanceCursor() {
		if (this.currentStepIndex >= this.executionSteps.length) return;
		const currentStep = this.executionSteps[this.currentStepIndex];

		if (currentStep.type === "char") {
			currentStep.element.classList.add("consumed");
			this.logManager.addEntry({ char: currentStep.char });
			ipcRenderer.send("type-character", currentStep.char);
			this.currentStepIndex++;
		} else if (currentStep.type === "anchor") {
			currentStep.element.classList.add("consumed");
			if (!currentStep._logged) {
				currentStep._logged = true;
				this.logManager.addEntry({ anchor: currentStep.value });
			}
			this.currentStepIndex++;
			ipcRenderer.send("input-complete");
		} else if (currentStep.type === "block") {
			currentStep.element.classList.add("consumed");
			this.currentStepIndex++;
			ipcRenderer.send("input-complete");
		}

		this.updateCursor();
	}

	async startAutoTyping() {
		if (this.autoTypingActive) return;
		if (this._moveToWindowOpen) {
			ipcRenderer.send("auto-typing-complete");
			return;
		}
		this.autoTypingActive = true;

		const settings = await ipcRenderer.invoke("get-settings");
		const speed = settings.autoTypingSpeed || 100;
		const currentIndex = this.currentStepIndex;
		const stepsToType = [];

		for (let i = currentIndex; i < this.executionSteps.length; i++) {
			if (this.executionSteps[i].type !== "char" && i > currentIndex) break;
			if (this.executionSteps[i].type === "char") {
				stepsToType.push({
					type: "char",
					char: this.executionSteps[i].char,
					index: i,
				});
			}
		}

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
		this._currentQuestionStepIndex = null;
		this._currentImageStepIndex = null;
		this._currentWebStepIndex = null;
		this._currentCodeInsertStepIndex = null;
		this._activeMoveToIndex = null;
		this.currentStepIndex = index;

		this.executionSteps.forEach((step, i) => {
			if (step.type === "char")
				step.element.classList.remove("cursor", "consumed");
			if (step.type === "anchor") {
				step.element.classList.remove("cursor", "consumed");
				step._logged = false;
			}
			if (step.type === "block")
				step.element.classList.remove("active-comment", "consumed");
			if (i < index) step.element.classList.add("consumed");
		});

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
}

module.exports = CursorManager;
