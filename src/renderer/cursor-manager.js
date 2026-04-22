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

		this._questionWindowOpen = false;
		this._imageWindowOpen = false;
		this._webWindowOpen = false;

		this._activeQuestionIndex = null;
		this._activeImageIndex = null;
		this._activeWebIndex = null;
		this._activeCodeInsertIndex = null;
		this._activeMoveToIndex = null;
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
		if (this._activeQuestionIndex === globalIndex) return;
		this._activeQuestionIndex = globalIndex;
		this._questionWindowOpen = true;
		const question = element.innerText.replace(/^❓ ?/, "");
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
		if (!this._imageWindowOpen) return;
		this._imageWindowOpen = false;
		this._activeImageIndex = null;
		ipcRenderer.send("close-image-window");
	}

	_enterWebBlock(element, globalIndex) {
		if (this._activeWebIndex === globalIndex) return;
		this._activeWebIndex = globalIndex;
		this._webWindowOpen = true;

		const raw = element.innerText.replace(/^🌐 ?/, "");
		const parts = raw.trim().split(/\s+/);
		const url = parts[0];
		const shouldPin = parts.slice(1).some((p) => p.toLowerCase() === "pin");
		if (this.onWebBlock) this.onWebBlock(url, shouldPin);
	}

	_leaveWebBlock() {
		if (!this._webWindowOpen) return;
		this._webWindowOpen = false;
		this._activeWebIndex = null;
		ipcRenderer.send("close-web-window");
	}

	_clearSpecialBlockState() {
		this._activeCodeInsertIndex = null;
		this._activeMoveToIndex = null;
	}

	updateLastStepIndex() {
		localStorage.setItem("lastStepIndex", this.currentStepIndex);
	}

	resetProgress() {
		this._leaveQuestionBlock();
		this._leaveImageBlock();
		this._leaveWebBlock();
		this._activeQuestionIndex = null;
		this._activeImageIndex = null;
		this._activeWebIndex = null;
		this._activeCodeInsertIndex = null;
		this._activeMoveToIndex = null;
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
				this._leaveWebBlock();
				this._clearSpecialBlockState();
				step.element.classList.add("cursor");
				step.element.scrollIntoView({
					behavior: "smooth",
					block: "center",
				});
			} else if (step.type === "anchor") {
				this._leaveQuestionBlock();
				this._leaveImageBlock();
				this._leaveWebBlock();
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

				const blockText = step.element.innerText.trim();
				const subtype = getBlockSubtype(blockText);
				if (subtype === "question-comment") {
					this._leaveImageBlock();
					this._leaveWebBlock();
					this._clearSpecialBlockState();
					this._enterQuestionBlock(step.element, step.globalIndex);
				} else if (subtype === "image-comment") {
					this._leaveQuestionBlock();
					this._leaveWebBlock();
					this._clearSpecialBlockState();
					this._enterImageBlock(step.element, step.globalIndex);
				} else if (subtype === "web-comment") {
					this._leaveQuestionBlock();
					this._leaveImageBlock();
					this._clearSpecialBlockState();
					this._enterWebBlock(step.element, step.globalIndex);
				} else if (subtype === "code-insert-comment") {
					this._leaveQuestionBlock();
					this._leaveImageBlock();
					this._leaveWebBlock();
					this._activeMoveToIndex = null;
					if (this._activeCodeInsertIndex !== step.globalIndex) {
						this._activeCodeInsertIndex = step.globalIndex;
						const text = step.element.innerText.replace(/^📋 ?/, "");
						this.logManager.addEntry({ code_insert: text });
					}
				} else if (subtype === "move-to-comment") {
					this._leaveQuestionBlock();
					this._leaveImageBlock();
					this._leaveWebBlock();
					this._activeCodeInsertIndex = null;
					if (this._activeMoveToIndex !== step.globalIndex) {
						this._activeMoveToIndex = step.globalIndex;
						const text = step.element.innerText.replace(/^➡️ ?/, "");
						this.logManager.addEntry({ move_to: text });
					}
				} else {
					this._leaveQuestionBlock();
					this._leaveImageBlock();
					this._leaveWebBlock();
					this._clearSpecialBlockState();
				}
			}
		} else {
			this._leaveQuestionBlock();
			this._leaveImageBlock();
			this._leaveWebBlock();
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

		if (!waitForCompletion || currentStep.type !== "char") {
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
			if (this.executionSteps[i].type !== "char" && i > currentIndex) break;
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

			let advanced = false;
			while (this.currentStepIndex < this.executionSteps.length) {
				const current = this.executionSteps[this.currentStepIndex];
				if (current.type === "anchor") {
					current.element.classList.add("consumed");
					if (!current._logged) {
						current._logged = true;
						this.logManager.addEntry({ anchor: current.value });
					}
					this.currentStepIndex++;
					advanced = true;
				} else if (current.type === "block") {
					current.element.classList.add("consumed");
					this.currentStepIndex++;
					this.updateLastStepIndex();
					this.updateCursor();
					ipcRenderer.send("input-complete");
					return;
				} else {
					break;
				}
			}
			this.updateLastStepIndex();
			this.updateCursor();
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
		this._activeWebIndex = null;
		this._activeCodeInsertIndex = null;
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

	buildArtificialLogEvents() {
		const KEYS_PER_MINUTE = 70;
		const intervalMs = Math.round(60000 / KEYS_PER_MINUTE);
		const startTime = Date.now();
		const events = [];

		let seenCodeInsert = null;
		let seenMoveTo = null;

		this.executionSteps.forEach((step, i) => {
			const t = startTime + i * intervalMs;
			if (step.type === "char") {
				seenCodeInsert = null;
				seenMoveTo = null;
				events.push({ timestamp: t, char: step.char });
			} else if (step.type === "anchor") {
				seenCodeInsert = null;
				seenMoveTo = null;
				events.push({ timestamp: t, anchor: step.value });
			} else if (step.type === "block") {
				const blockText = step.element ? step.element.innerText.trim() : "";
				const subtype = getBlockSubtype(blockText);
				if (subtype === "code-insert-comment") {
					if (seenCodeInsert !== step.globalIndex) {
						seenCodeInsert = step.globalIndex;
						seenMoveTo = null;
						const text = step.element
							? step.element.innerText.replace(/^📋 ?/, "")
							: "";
						events.push({ timestamp: t, code_insert: text });
					}
				} else if (subtype === "move-to-comment") {
					if (seenMoveTo !== step.globalIndex) {
						seenMoveTo = step.globalIndex;
						seenCodeInsert = null;
						const text = step.element
							? step.element.innerText.replace(/^➡️ ?/, "")
							: "";
						events.push({ timestamp: t, move_to: text });
					}
				} else {
					seenCodeInsert = null;
					seenMoveTo = null;
				}
			}
		});

		return events;
	}
}

module.exports = CursorManager;
