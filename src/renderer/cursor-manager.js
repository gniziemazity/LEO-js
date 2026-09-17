const { ipcRenderer } = require("electron");
const { getBlockKind, stripBlockPrefix } = require("../shared/blocks");
const { stepToLogEvents } = require("./log-event-builder");
const { classifyMoveToTarget } = require("../shared/move-to-target");
const { buildColoredLines } = require("./anchor-snippet");
const { stripAnchors } = require("../shared/code-text");

const SPECIAL_BLOCKS = {
	question: {
		closeChannel: "close-question-window",
		afterLeave: (cm) => {
			if (cm.onLeaveQuestionBlock) cm.onLeaveQuestionBlock();
		},
	},
	image: { closeChannel: "close-image-window" },
	web: { closeChannel: "close-web-window" },
	"move-to": { closeChannel: "close-move-to-window", pausesTyping: true },
	"code-insert": {
		closeChannel: "close-code-insert-window",
		pausesTyping: true,
	},
};

const SPECIAL_BLOCK_KINDS = Object.keys(SPECIAL_BLOCKS);
const PAUSING_KINDS = SPECIAL_BLOCK_KINDS.filter(
	(kind) => SPECIAL_BLOCKS[kind].pausesTyping,
);
const TRANSIENT_KINDS = ["code-insert", "move-to"];

const BLOCK_ENTRIES = {
	"move-to": {
		keep: "move-to",
		clear: ["code-insert"],
		enter: (cm, step) => cm._enterMoveToBlock(step),
	},
	question: {
		keep: "question",
		clear: TRANSIENT_KINDS,
		enter: (cm, step) => cm._enterQuestionBlock(step),
	},
	image: {
		keep: "image",
		clear: TRANSIENT_KINDS,
		enter: (cm, step) => cm._enterImageBlock(step),
	},
	web: {
		keep: "web",
		clear: TRANSIENT_KINDS,
		enter: (cm, step) => cm._enterWebBlock(step),
	},
	snippet: {
		keep: "code-insert",
		clear: [],
		enter: (cm, step) => cm._enterCodeInsertBlock(step),
	},
};

const PLAIN_BLOCK = { clear: TRANSIENT_KINDS };

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
		this.onEnterCodeInsertBlock = null;
		this.onLeaveSpecialBlock = null;

		this._blocks = {};

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

	_block(kind) {
		let b = this._blocks[kind];
		if (!b) {
			b = { open: false, at: null, resumeAuto: false };
			this._blocks[kind] = b;
		}
		return b;
	}

	_arriveAt(kind, globalIndex, opensWindow) {
		const b = this._block(kind);
		if (b.at === globalIndex) return false;
		b.at = globalIndex;
		if (opensWindow) b.open = true;
		return true;
	}

	_leaveBlock(kind) {
		const b = this._block(kind);
		if (!b.open) return;
		b.open = false;
		b.at = null;
		ipcRenderer.send(SPECIAL_BLOCKS[kind].closeChannel);
		if (this.onLeaveSpecialBlock) this.onLeaveSpecialBlock(kind);
		const afterLeave = SPECIAL_BLOCKS[kind].afterLeave;
		if (afterLeave) afterLeave(this);
	}

	_leaveSpecialBlocksExcept(kind) {
		for (const k of SPECIAL_BLOCK_KINDS) {
			if (k !== kind) this._leaveBlock(k);
		}
	}

	_clearBlockIndices(kinds) {
		for (const kind of kinds) this._block(kind).at = null;
	}

	_enterQuestionBlock(step) {
		if (!this._arriveAt("question", step.globalIndex, true)) return;
		const question = stripBlockPrefix(step.text);
		const timestamp = Date.now();
		if (this.onEnterQuestionBlock)
			this.onEnterQuestionBlock(question, timestamp);
	}

	_enterImageBlock(step) {
		if (!this._arriveAt("image", step.globalIndex, true)) return;
		const spec = stripBlockPrefix(String(step.text || "").trim());
		if (spec) {
			const imageName = spec.trim().split(/\s+/)[0];
			if (this.onImageBlock) this.onImageBlock(imageName, !!step.pin);
		}
	}

	markImageWindowOpen() {
		const b = this._block("image");
		b.open = true;
		b.at = null;
	}

	_enterWebBlock(step) {
		if (!this._arriveAt("web", step.globalIndex, true)) return;
		const url = stripBlockPrefix(String(step.text || ""))
			.trim()
			.split(/\s+/)[0];
		if (this.onWebBlock) this.onWebBlock(url, !!step.pin);
	}

	_enterMoveToBlock(step) {
		if (!this._arriveAt("move-to", step.globalIndex, true)) return;
		for (const e of stepToLogEvents(step)) this.logManager.addEntry(e);
		if (this.onEnterMoveToBlock) {
			const { mode, target } = classifyMoveToTarget(step.target);
			this.onEnterMoveToBlock({
				mode,
				target,
				typeName: !!step.typeName,
				note: step.note || "",
				snippet: step.snippet || null,
			});
		}
	}

	_enterCodeInsertBlock(step) {
		if (!this._arriveAt("code-insert", step.globalIndex, true)) return;
		const text = stripBlockPrefix(step.text);
		this.logManager.addEntry({ code_insert: text });
		if (this.onEnterCodeInsertBlock) {
			const pasted = stripAnchors(text);
			this.onEnterCodeInsertBlock({
				text: pasted,
				paste: step.paste !== false,
				colored: buildColoredLines(
					pasted,
					0,
					pasted.split("\n").length - 1,
				),
			});
		}
	}

	suspendAutoTypingFor(kind) {
		this._block(kind).resumeAuto = this.autoTypingActive;
		if (this.autoTypingActive) this.stopAutoTyping();
	}

	confirmSpecial(kind) {
		const b = this._block(kind);
		b.open = false;
		b.at = null;
		const shouldResume = !!b.resumeAuto;
		b.resumeAuto = false;
		return shouldResume;
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
		this._leaveSpecialBlocksExcept();
		for (const b of Object.values(this._blocks)) b.at = null;
		this.currentStepIndex = 0;
		this.uiManager.updateProgressBar(0);
	}

	_updateBlockCursor(step) {
		step.element.classList.add("active-block");
		step.element.scrollIntoView({ behavior: "smooth", block: "center" });

		const key =
			step.kind === "move-to"
				? "move-to"
				: getBlockKind(String(step.text || "").trim());
		const entry = BLOCK_ENTRIES[key] || PLAIN_BLOCK;

		this._leaveSpecialBlocksExcept(entry.keep);
		this._clearBlockIndices(entry.clear);
		if (entry.enter) entry.enter(this, step);
	}

	_updateCharCursor(step) {
		this._leaveSpecialBlocksExcept();
		this._clearBlockIndices(TRANSIENT_KINDS);
		step.element.classList.add("cursor");
		step.element.scrollIntoView({ behavior: "smooth", block: "center" });
	}

	_skipInheritedSteps() {
		while (this.currentStepIndex < this.executionSteps.length) {
			const step = this.executionSteps[this.currentStepIndex];
			if (!step || !step.fromInclude) return;
			step.element.classList.add("consumed");
			if (!step._logged) {
				step._logged = true;
				for (const e of stepToLogEvents(step)) this.logManager.addEntry(e);
			}
			this.currentStepIndex++;
		}
	}

	updateCursor() {
		this.uiManager.removeCursorClasses();
		this._skipInheritedSteps();

		if (this.currentStepIndex < this.executionSteps.length) {
			const step = this.executionSteps[this.currentStepIndex];

			if (step.type === "char") {
				this._updateCharCursor(step);
			} else if (step.type === "anchor") {
				this._updateCharCursor(step);
				if (!step._logged) {
					step._logged = true;
					this.logManager.addEntry({ anchor: step.value });
				}
			} else if (step.type === "block") {
				this._updateBlockCursor(step);
			}
		} else {
			this._leaveSpecialBlocksExcept();
		}

		this._broadcastProgress();
	}

	advanceCursor() {
		this._skipInheritedSteps();
		if (this.currentStepIndex >= this.executionSteps.length) {
			ipcRenderer.send("input-complete");
			return;
		}
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
		} else {
			this.currentStepIndex++;
			ipcRenderer.send("input-complete");
		}

		this.updateCursor();
	}

	async startAutoTyping() {
		if (this.autoTypingActive) return;
		if (PAUSING_KINDS.some((kind) => this._block(kind).open)) {
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
		for (const b of Object.values(this._blocks)) b.at = null;
		this.currentStepIndex = index;

		this.executionSteps.forEach((step, i) => {
			if (step.type === "char")
				step.element.classList.remove("cursor", "consumed");
			if (step.type === "anchor") {
				step.element.classList.remove("cursor", "consumed");
				step._logged = false;
			}
			if (step.type === "block")
				step.element.classList.remove("active-block", "consumed");
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
