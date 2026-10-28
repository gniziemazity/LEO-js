const { ipcRenderer } = require("electron");
const { getBlockType, stripBlockPrefix } = require("../shared/blocks");
const { stepToLogEvents } = require("./log-event-builder");
const { classifyGoToTarget } = require("../shared/go-to-target");
const { buildColoredLines } = require("./plan-replay");
const { stripAnchors } = require("../shared/code-text");

const SUPPORT_BLOCKS = {
	question: {
		closeChannel: "close-question-window",
		afterLeave: (cm) => {
			if (cm.onLeaveQuestionBlock) cm.onLeaveQuestionBlock();
		},
	},
	note: { closeChannel: "close-note-popup", pausesAutoTyping: true },
	image: {
		closeChannel: "close-image-window",
		pausesAutoTyping: true,
		keepsWindow: true,
	},
	web: {
		closeChannel: "close-web-window",
		pausesAutoTyping: true,
		keepsWindow: true,
	},
	"go-to": { closeChannel: "close-go-to-popup", pausesAutoTyping: true },
	snippet: {
		closeChannel: "close-snippet-popup",
		pausesAutoTyping: true,
	},
};

const SUPPORT_BLOCK_TYPES = Object.keys(SUPPORT_BLOCKS);
const PAUSING_TYPES = SUPPORT_BLOCK_TYPES.filter(
	(type) => SUPPORT_BLOCKS[type].pausesAutoTyping,
);
const TRANSIENT_TYPES = ["snippet", "go-to", "note"];

const BLOCK_ENTRIES = {
	"go-to": {
		keep: "go-to",
		clear: ["snippet", "note"],
		enter: (cm, step) => cm._enterGoToBlock(step),
	},
	note: {
		keep: "note",
		clear: ["snippet", "go-to"],
		enter: (cm, step) => cm._enterNoteBlock(step),
	},
	question: {
		keep: "question",
		clear: TRANSIENT_TYPES,
		enter: (cm, step) => cm._enterQuestionBlock(step),
	},
	image: {
		keep: "image",
		clear: TRANSIENT_TYPES,
		enter: (cm, step) => cm._enterImageBlock(step),
	},
	web: {
		keep: "web",
		clear: TRANSIENT_TYPES,
		enter: (cm, step) => cm._enterWebBlock(step),
	},
	snippet: {
		keep: "snippet",
		clear: ["note"],
		enter: (cm, step) => cm._enterSnippetBlock(step),
	},
};

const PLAIN_BLOCK = { clear: TRANSIENT_TYPES };

class CursorManager {
	constructor(uiManager, logManager) {
		this.uiManager = uiManager;
		this.logManager = logManager;
		this.currentStepIndex = 0;
		this.executionSteps = [];
		this.autoRunActive = false;
		this._cursorEl = null;
		this._activeBlockEl = null;
		this._scrollPending = null;

		this.onEnterNoteBlock = null;
		this.onEnterQuestionBlock = null;
		this.onLeaveQuestionBlock = null;
		this.onImageBlock = null;
		this.onWebBlock = null;
		this.onEnterGoToBlock = null;
		this.onEnterSnippetBlock = null;
		this.onLeaveSupportBlock = null;

		this._blocks = {};

		this._onAutoStepComplete = (event, stepIndex) => {
			if (!this.autoRunActive) return;
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
			if (!this.autoRunActive) return;
			this.autoRunActive = false;
			while (this.currentStepIndex < this.executionSteps.length) {
				const current = this.executionSteps[this.currentStepIndex];
				if (current.type === "anchor") {
					current.element.classList.add("consumed");
					this._logAnchor(current);
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
		ipcRenderer.on("auto-run-step-complete", this._onAutoStepComplete);
		ipcRenderer.on("auto-run-finished", this._onAutoFinish);
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

	_block(type) {
		let b = this._blocks[type];
		if (!b) {
			b = { open: false, at: null, resumeAuto: false, waiting: false };
			this._blocks[type] = b;
		}
		return b;
	}

	_arriveAt(type, globalIndex, opensWindow) {
		const b = this._block(type);
		if (b.at === globalIndex) return false;
		b.at = globalIndex;
		if (opensWindow) b.open = true;
		if (SUPPORT_BLOCKS[type].pausesAutoTyping) b.waiting = true;
		return true;
	}

	_leaveBlock(type) {
		const b = this._block(type);
		b.waiting = false;
		if (!b.open) return;
		b.open = false;
		b.at = null;
		ipcRenderer.send(SUPPORT_BLOCKS[type].closeChannel);
		if (this.onLeaveSupportBlock) this.onLeaveSupportBlock(type);
		const afterLeave = SUPPORT_BLOCKS[type].afterLeave;
		if (afterLeave) afterLeave(this);
	}

	_leaveSupportBlocksExcept(type) {
		for (const k of SUPPORT_BLOCK_TYPES) {
			if (k !== type) this._leaveBlock(k);
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

	_clearBlockIndices(types) {
		for (const type of types) this._block(type).at = null;
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

	_enterGoToBlock(step) {
		if (!this._arriveAt("go-to", step.globalIndex, true)) return;
		for (const e of stepToLogEvents(step)) this.logManager.addEntry(e);
		if (this.onEnterGoToBlock) {
			const { mode, target } = classifyGoToTarget(step.target);
			this.onEnterGoToBlock({
				mode,
				target,
				typeName: !!step.typeName,
				note: step.note || "",
				excerpt: step.excerpt || null,
			});
		}
	}

	_enterSnippetBlock(step) {
		if (!this._arriveAt("snippet", step.globalIndex, true)) return;
		const text = stripBlockPrefix(step.text);
		this.logManager.addEntry({ code_insert: text });
		if (this.onEnterSnippetBlock) {
			const pasted = stripAnchors(text);
			this.onEnterSnippetBlock({
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

	suspendAutoRunFor(type) {
		this._block(type).resumeAuto = this.autoRunActive;
		if (this.autoRunActive) this.stopAutoRun();
	}

	confirmSpecial(type) {
		const b = this._block(type);
		const at = b.at;
		b.waiting = false;
		if (!SUPPORT_BLOCKS[type].keepsWindow) {
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
		this._leaveSupportBlocksExcept();
		this._forgetBlockPositions();
		this.currentStepIndex = 0;
		this.uiManager.updateProgressBar(0);
	}

	_updateBlockCursor(step) {
		step.element.classList.add("active-block");
		this._activeBlockEl = step.element;
		this._scrollIntoView(step.element);

		const key = step.blockType || getBlockType(step.text);
		const entry = BLOCK_ENTRIES[key] || PLAIN_BLOCK;

		this._leaveSupportBlocksExcept(entry.keep);
		this._clearBlockIndices(entry.clear);
		if (entry.enter) entry.enter(this, step);
	}

	_updateCharCursor(step) {
		this._leaveSupportBlocksExcept();
		this._clearBlockIndices(TRANSIENT_TYPES);
		step.element.classList.add("cursor");
		this._cursorEl = step.element;
		this._scrollIntoView(step.element);
	}

	_skipStartSteps() {
		while (this.currentStepIndex < this.executionSteps.length) {
			const step = this.executionSteps[this.currentStepIndex];
			if (!step || !step.fromStart) return;
			step.element.classList.add("consumed");
			if (!step._logged) {
				step._logged = true;
				for (const e of stepToLogEvents(step)) this.logManager.addEntry(e);
			}
			this.currentStepIndex++;
		}
	}

	_logAnchor(step) {
		if (step._logged) return;
		step._logged = true;
		this.logManager.addEntry({ anchor: step.value });
	}

	_forgetBlockPositions() {
		for (const b of Object.values(this._blocks)) b.at = null;
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
		this._skipStartSteps();

		if (this.currentStepIndex < this.executionSteps.length) {
			const step = this.executionSteps[this.currentStepIndex];

			if (step.type === "char") {
				this._updateCharCursor(step);
			} else if (step.type === "anchor") {
				this._updateCharCursor(step);
				this._logAnchor(step);
			} else if (step.type === "block") {
				this._updateBlockCursor(step);
			}
		} else {
			this._leaveSupportBlocksExcept();
		}

		this._broadcastProgress();
	}

	advanceCursor() {
		this._skipStartSteps();
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
			this._logAnchor(currentStep);
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

	async startAutoRun() {
		if (this.autoRunActive) return;
		if (PAUSING_TYPES.some((type) => this._block(type).waiting)) {
			ipcRenderer.send("auto-run-complete");
			return;
		}
		this.autoRunActive = true;

		const settings = await ipcRenderer.invoke("get-settings");
		const speed = settings.autoRunSpeed || 100;
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

		ipcRenderer.send("start-auto-run-block", {
			steps: stepsToType,
			startIndex: 0,
			speed,
		});
	}

	stopAutoRun() {
		if (this.autoRunActive) {
			this.autoRunActive = false;
			ipcRenderer.send("auto-run-complete");
		}
	}

	jumpTo(index) {
		this._forgetBlockPositions();
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
		this._forgetBlockPositions();

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

CursorManager.PAUSING_TYPES = PAUSING_TYPES;

module.exports = CursorManager;
