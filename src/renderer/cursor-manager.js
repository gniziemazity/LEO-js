const { ipcRenderer } = require("electron");

class CursorManager {
	constructor(uiManager, logManager) {
		this.uiManager = uiManager;
		this.logManager = logManager;
		this.currentStepIndex = 0;
		this.executionSteps = [];
		this.autoTypingActive = false;
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

	resetProgress() {
		this.currentStepIndex = 0;
		localStorage.setItem("lastStepIndex", 0);
		this.uiManager.updateProgressBar(0);
	}

	updateCursor() {
		this.uiManager.removeCursorClasses();

		if (this.currentStepIndex < this.executionSteps.length) {
			const step = this.executionSteps[this.currentStepIndex];

			if (step.type === "char") {
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
			}
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

			this.logManager.addEntry({
				char: currentStep.char,
			});

			if (waitForCompletion) {
				return new Promise((resolve) => {
					ipcRenderer.once("character-typed", () => {
						this.currentStepIndex++;
						localStorage.setItem("lastStepIndex", this.currentStepIndex);
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

			// check if this is a question block (starts with ❓)
			const blockText = currentStep.element.innerText.trim();
			if (blockText.startsWith("❓")) {
				const question = blockText.substring(1).trim();
				this.logManager.addInteraction("teacher-question", question);
			}

			this.currentStepIndex++;
			ipcRenderer.send("input-complete");
		}

		if (!waitForCompletion || currentStep.type === "block") {
			localStorage.setItem("lastStepIndex", this.currentStepIndex);
			this.updateCursor();
		}
	}

	async startAutoTyping() {
		if (this.autoTypingActive) {
			console.log("Auto-typing already active");
			return;
		}

		this.autoTypingActive = true;

		const settings = await ipcRenderer.invoke("get-settings");
		const speed = settings.autoTypingSpeed || 100;

		const currentIndex = this.currentStepIndex;

		let endIndex = currentIndex;
		const stepsToType = [];

		for (let i = currentIndex; i < this.executionSteps.length; i++) {
			if (this.executionSteps[i].type === "block" && i > currentIndex) {
				endIndex = i;
				break;
			}

			if (this.executionSteps[i].type === "char") {
				stepsToType.push({
					type: "char",
					char: this.executionSteps[i].char,
					index: i,
				});
			}

			endIndex = i + 1;
		}

		const stepCompleteHandler = (event, stepIndex) => {
			if (stepIndex < this.executionSteps.length) {
				const step = this.executionSteps[stepIndex];
				if (step.type === "char") {
					step.element.classList.add("consumed");
					this.logManager.addEntry({ char: step.char });
				}
				this.currentStepIndex = stepIndex + 1;
				localStorage.setItem("lastStepIndex", this.currentStepIndex);
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
			debugger;

			if (this.currentStepIndex < this.executionSteps.length) {
				this.currentStepIndex++;
				const currentStep = this.executionSteps[this.currentStepIndex];
				if (currentStep.type === "block") {
					currentStep.element.classList.add("consumed");

					const blockText = currentStep.element.innerText.trim();
					if (blockText.startsWith("❓")) {
						const question = blockText.substring(1).trim();
						this.logManager.addInteraction("teacher-question", question);
					}

					localStorage.setItem("lastStepIndex", this.currentStepIndex);
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
			speed: speed,
		});
	}

	stopAutoTyping() {
		if (this.autoTypingActive) {
			console.log("Stopping auto-typing...");
			this.autoTypingActive = false;
			ipcRenderer.send("auto-typing-complete");
		}
	}

	jumpTo(index) {
		this.currentStepIndex = index;

		this.executionSteps.forEach((step, i) => {
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

		localStorage.setItem("lastStepIndex", this.currentStepIndex);
		this.updateCursor();

		ipcRenderer.send("broadcast-cursor", this.currentStepIndex);
	}

	stepBackward() {
		if (this.currentStepIndex > 0) {
			this.jumpTo(this.currentStepIndex - 1);
		}
	}

	stepForward() {
		if (this.currentStepIndex < this.executionSteps.length) {
			this.jumpTo(this.currentStepIndex + 1);
		}
	}

	restoreConsumedSteps() {
		setTimeout(() => {
			this.executionSteps.forEach((step, i) => {
				if (i < this.currentStepIndex) {
					step.element.classList.add("consumed");
				}
			});
			this.updateCursor();
		}, 0);
	}

	loadSavedProgress() {
		const lastIndex = localStorage.getItem("lastStepIndex");
		if (lastIndex) {
			this.currentStepIndex = parseInt(lastIndex);
		}
	}
}

module.exports = CursorManager;
