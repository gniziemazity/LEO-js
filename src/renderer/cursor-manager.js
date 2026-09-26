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
	note: { closeChannel: "close-note-window", pausesTyping: true },
	image: {
		closeChannel: "close-image-window",
		pausesTyping: true,
		keepsWindow: true,
	},
	web: {
		closeChannel: "close-web-window",
		pausesTyping: true,
		keepsWindow: true,
	},
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
const TRANSIENT_KINDS = ["code-insert", "move-to", "note"];

const BLOCK_ENTRIES = {
	"move-to": {
		keep: "move-to",
		clear: ["code-insert", "note"],
		enter: (cm, step) => cm._enterMoveToBlock(step),
	},
	note: {
		keep: "note",
		clear: ["code-insert", "move-to"],
		enter: (cm, step) => cm._enterNoteBlock(step),
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
		clear: ["note"],
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
		this._cursorEl = null;
		this._activeBlockEl = null;
		this._scrollPending = null;

		this.onEnterNoteBlock = null;
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
			b = { open: false, at: null, resumeAuto: false, waiting: false };
			this._blocks[kind] = b;
		}
		return b;
	}

	_arriveAt(kind, globalIndex, opensWindow) {
		const b = this._block(kind);
		if (b.at === globalIndex) return false;
		b.at = globalIndex;
		if (opensWindow) b.open = true;
		if (SPECIAL_BLOCKS[kind].pausesTyping) b.waiting = true;
		return true;
	}

	_leaveBlock(kind) {
		const b = this._block(kind);
		b.waiting = false;
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

	_passBlock(at) {
		const step = this.executionSteps[this.currentStepIndex];
		if (at === null || !step || step.type !== "block") return;
		if (step.globalIndex !== at) return;
		step.element.classList.add("consumed");
		this.currentStepIndex++;
		this.updateCursor();
	}

	_clearBlockIndices(kinds) {
		for (const kind of kinds) this._block(kind).at = null;
	}

	_enterNoteBlock(step) {
		const text = stripBlockPrefix(String(step.text || "")).trim();
		if (!text) return;
		if (!this._arriveAt("note", step.globalIndex, true)) return;
		if (this.onEnterNoteBlock) this.onEnterNoteBlock({ text });
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
		const at = b.at;
		b.waiting = false;
		if (!SPECIAL_BLOCKS[kind].keepsWindow) {
			b.open = false;
			b.at = null;
		}
		const shouldResume = !!b.resumeAuto;
		b.resumeAuto = false;
		this._passBlock(at);
		return shouldResume;
	}

	questionWindowClosed() {
		this._passBlock(this._block("question").at);
	}

	_broadcastProgress() {
		const progress =
			(this.currentStepIndex / this.executionSteps.length) * 100 || 0;
		this.uiManager.updateProgressBar(progress);

		this._sendProgress();
	}

	_sendProgress() {
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
		this._activeBlockEl = step.element;
		this._scrollIntoView(step.element);

		const key = step.kind || getBlockKind(String(step.text || "").trim());
		const entry = BLOCK_ENTRIES[key] || PLAIN_BLOCK;

		this._leaveSpecialBlocksExcept(entry.keep);
		this._clearBlockIndices(entry.clear);
		if (entry.enter) entry.enter(this, step);
	}

	_updateCharCursor(step) {
		this._leaveSpecialBlocksExcept();
		this._clearBlockIndices(TRANSIENT_KINDS);
		step.element.classList.add("cursor");
		this._cursorEl = step.element;
		this._scrollIntoView(step.element);
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

	_clearCursorMarks() {
		if (this._cursorEl) {
			this._cursorEl.classList.remove("cursor");
			this._cursorEl = null;
		}
		if (this._activeBlockEl) {
			this._activeBlockEl.classList.remove("active-block");
			this._activeBlockEl = null;
		}
	}

	forgetCursorMarks() {
		this._cursorEl = null;
		this._activeBlockEl = null;
	}

	_scrollIntoView(element) {
		if (typeof requestAnimationFrame !== "function") {
			element.scrollIntoView({ behavior: "smooth", block: "center" });
			return;
		}
		if (this._scrollPending) cancelAnimationFrame(this._scrollPending);
		this._scrollPending = requestAnimationFrame(() => {
			this._scrollPending = null;
			element.scrollIntoView({ behavior: "smooth", block: "center" });
		});
	}

	updateCursor() {
		this._clearCursorMarks();
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
		if (PAUSING_KINDS.some((kind) => this._block(kind).waiting)) {
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
		this.forgetCursorMarks();
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

	_stepOne(delta) {
		const to = this.currentStepIndex + delta;
		for (const b of Object.values(this._blocks)) b.at = null;

		const moved =
			delta > 0
				? this.executionSteps[this.currentStepIndex]
				: this.executionSteps[to];
		if (moved) {
			if (delta > 0) {
				moved.element.classList.add("consumed");
			} else {
				moved.element.classList.remove("consumed");
				if (moved.type === "anchor") moved._logged = false;
			}
		}

		this.currentStepIndex = to;
		this.updateCursor();
	}

	stepBackward() {
		if (this.currentStepIndex > 0) this._stepOne(-1);
	}

	stepForward() {
		if (this.currentStepIndex < this.executionSteps.length) this._stepOne(1);
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

CursorManager.PAUSING_KINDS = PAUSING_KINDS;

module.exports = CursorManager;
