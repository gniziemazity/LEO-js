const { ipcRenderer } = require("electron");

const {
	getBlockSubtype,
	isMultilineCodeInsert,
	collapsedLabel,
} = require("../shared/blocks");
const { extractAnchorSnippet } = require("./anchor-snippet");
const {
	buildCodeText,
	readCodeText,
	writeCodeText,
} = require("../shared/code-text");
const {
	isFileName,
	wrapAnchor,
	moveToTargetLabel,
	classifyMoveToTarget,
} = require("../shared/move-to-target");
const {
	openDropdown,
	closeDropdown,
	isOpen: isDropdownOpen,
} = require("./move-to-dropdown");

const BLOCK_RENDERERS = {
	comment: "renderCommentBlock",
	code: "renderCodeBlock",
	"move-to": "renderMoveToBlock",
	include: "renderIncludeBlock",
};

class LessonRenderer {
	constructor(lessonManager, uiManager, cursorManager, undoManager = null) {
		this.lessonManager = lessonManager;
		this.uiManager = uiManager;
		this.cursorManager = cursorManager;
		this.undoManager = undoManager;
		this.editDebounceTimer = null;
		this.lastEditedBlockIndex = null;
		this.lastEditedContent = null;
		this.expandedIncludes = new Set();
	}

	_isScrollbarClick(e) {
		const el = e && e.currentTarget;
		return (
			!!el && typeof e.offsetX === "number" && e.offsetX > el.clientWidth
		);
	}

	toggleIncludeExpanded(blockIdx) {
		if (this.expandedIncludes.has(blockIdx)) {
			this.expandedIncludes.delete(blockIdx);
		} else {
			this.expandedIncludes.add(blockIdx);
		}
		this.render();
	}

	attachEditHandlers(element, allowTab = false) {
		element.onpaste = (e) => {
			e.preventDefault();
			const text = e.clipboardData
				.getData("text/plain")
				.replace(/\r\n?/g, "\n");
			document.execCommand("insertText", false, text);
		};
		element.onkeydown = (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				document.execCommand("insertText", false, "\n");
			} else if (allowTab && e.key === "Tab" && !e.shiftKey) {
				e.preventDefault();
				document.execCommand("insertText", false, "\t");
			}
		};
	}

	makeCodeBlockEditable(element, block, blockIdx) {
		element.contentEditable = "true";
		writeCodeText(element, block.text);
		element.oninput = () => {
			const text = readCodeText(element);
			this.saveEditState(blockIdx, text);
			this.lessonManager.updateBlock(blockIdx, text);
		};
		this.attachEditHandlers(element);
	}

	saveEditState(blockIndex, content) {
		if (!this.undoManager) return;

		if (this.lastEditedBlockIndex !== blockIndex) {
			if (this.editDebounceTimer) {
				clearTimeout(this.editDebounceTimer);
			}
			this.undoManager.saveState("edit-block");
			this.lastEditedBlockIndex = blockIndex;
			this.lastEditedContent = content;
			return;
		}

		if (this.editDebounceTimer) {
			clearTimeout(this.editDebounceTimer);
		}

		this.editDebounceTimer = setTimeout(() => {
			this.undoManager.saveState("edit-block");
			this.lastEditedContent = content;
		}, 1000);
	}

	render() {
		const isTypingActive = this.uiManager.isActive();

		this.uiManager.clearLessonContainer();
		const executionSteps = [];
		let globalStepCounter = 0;

		const blocks = this.lessonManager.getAllBlocks();

		blocks.forEach((block, blockIdx) => {
			const blockDiv = this.uiManager.createBlockElement(block, blockIdx);

			blockDiv.onmousedown = (e) =>
				this.handleBlockClick(e, block, blockIdx);

			const render = BLOCK_RENDERERS[block.type];
			if (render) {
				globalStepCounter = this[render]({
					blockDiv,
					block,
					blockIdx,
					isTypingActive,
					stepIndex: globalStepCounter,
					steps: executionSteps,
				});
			}

			this.uiManager.appendToLessonContainer(blockDiv);
		});

		this.cursorManager.setExecutionSteps(executionSteps);

		if (isTypingActive) {
			this.cursorManager.updateCursor();
		}

		this.broadcastLessonData(executionSteps);
	}

	isMultilineCodeInsert(blockIdx) {
		const block = this.lessonManager.getAllBlocks()[blockIdx];
		return !!block && isMultilineCodeInsert(block.text);
	}

	_blockOption({ label, checked, disabled, blockIdx, key, byDefault }) {
		return {
			label,
			checked,
			disabled,
			onChange: (on) =>
				this.lessonManager.updateBlockOption(blockIdx, key, on, byDefault),
		};
	}

	renderCommentBlock(ctx) {
		const { blockDiv, block, blockIdx, isTypingActive, stepIndex, steps } =
			ctx;
		const subtype = getBlockSubtype(block.text);
		if (subtype) blockDiv.classList.add(subtype);

		const selectedBlockIndex = this.uiManager.getSelectedBlockIndex();
		const isMultilineInsert = isMultilineCodeInsert(block.text);
		const isExpanded =
			isMultilineInsert &&
			!isTypingActive &&
			(block.fromInclude
				? this.expandedIncludes.has(blockIdx)
				: selectedBlockIndex === blockIdx);

		if (isMultilineInsert && !isExpanded) {
			blockDiv.contentEditable = "false";
			blockDiv.textContent = collapsedLabel(block.text);
			blockDiv.dataset.fullText = block.text;
			blockDiv.classList.add("collapsed");
		} else {
			blockDiv.contentEditable = !isTypingActive && !block.fromInclude;
			blockDiv.textContent = block.text;
			delete blockDiv.dataset.fullText;
		}

		if (!block.fromInclude) {
			if (subtype === "code-insert-comment") {
				this.uiManager.attachBlockOption(
					blockDiv,
					this._blockOption({
						label: "Show Paste button",
						checked: block.paste !== false,
						disabled: isTypingActive,
						blockIdx,
						key: "paste",
						byDefault: true,
					}),
				);
			} else if (subtype === "image-comment" || subtype === "web-comment") {
				this.uiManager.attachBlockOption(
					blockDiv,
					this._blockOption({
						label: "Pin window",
						checked: block.pin === true,
						disabled: isTypingActive,
						blockIdx,
						key: "pin",
						byDefault: false,
					}),
				);
			}
		}

		blockDiv.oninput = () => {
			if (blockDiv.contentEditable !== "true") return;
			const text = readCodeText(blockDiv);
			this.saveEditState(blockIdx, text);
			this.lessonManager.updateBlock(blockIdx, text);

			blockDiv.classList.remove(
				"question-comment",
				"image-comment",
				"web-comment",
				"code-insert-comment",
			);
			const sub = getBlockSubtype(text);
			if (sub) blockDiv.classList.add(sub);
		};

		this.attachEditHandlers(blockDiv, subtype === "code-insert-comment");

		steps.push({
			type: "block",
			fromInclude: !!block.fromInclude,
			text: block.text,
			paste: block.paste !== false,
			pin: block.pin === true,
			element: blockDiv,
			blockIndex: blockIdx,
			globalIndex: stepIndex,
		});

		blockDiv.dataset.stepIndex = stepIndex;
		return stepIndex + 1;
	}

	renderCodeBlock(ctx) {
		const { blockDiv, block, blockIdx, isTypingActive, steps } = ctx;
		let stepIndex = ctx.stepIndex;
		const selectedBlockIndex = this.uiManager.getSelectedBlockIndex();

		if (selectedBlockIndex === blockIdx && !isTypingActive) {
			this.makeCodeBlockEditable(blockDiv, block, blockIdx);
			return stepIndex;
		} else {
			blockDiv.contentEditable = "false";

			stepIndex = buildCodeText(block.text, blockDiv, stepIndex, (step) =>
				steps.push({ ...step, blockIndex: blockIdx }),
			);

			steps.push({
				type: "block",
				element: blockDiv,
				blockIndex: blockIdx,
				globalIndex: stepIndex,
			});

			blockDiv.dataset.stepIndex = stepIndex;
			return stepIndex + 1;
		}
	}

	renderIncludeBlock(ctx) {
		const { blockDiv, block, isTypingActive, stepIndex } = ctx;
		blockDiv.classList.add("include-block");
		blockDiv.contentEditable = "false";

		const label = document.createElement("span");
		label.className = "start-with-label";
		label.textContent = "Start with";
		blockDiv.appendChild(label);

		const select = document.createElement("select");
		select.className = "move-to-select";
		select.disabled = isTypingActive;
		const opts = [
			{ value: "", label: "— nothing —" },
			...this.lessonManager
				.listSiblingPlans()
				.map((p) => ({ value: p, label: p.replace(/^\.\//, "") })),
		];
		const current = block.path || "";
		if (current && !opts.some((o) => o.value === current)) {
			opts.push({ value: current, label: `? ${current}` });
		}
		for (const o of opts) {
			const el = document.createElement("option");
			el.value = o.value;
			el.textContent = o.label;
			if (o.value === current) el.selected = true;
			select.appendChild(el);
		}
		select.addEventListener("mousedown", (e) => e.stopPropagation());
		select.addEventListener("click", (e) => e.stopPropagation());
		select.addEventListener("change", () => {
			this.expandedIncludes.clear();
			this.lessonManager.setStartWith(select.value);
			if (this.onStartWithChanged) this.onStartWithChanged();
		});
		blockDiv.appendChild(select);

		return stepIndex;
	}

	renderMoveToBlock(ctx) {
		const { blockDiv, block, blockIdx, isTypingActive, stepIndex, steps } =
			ctx;
		blockDiv.classList.add("move-to-comment");
		blockDiv.contentEditable = "false";
		const target = block.target || "MAIN";
		blockDiv.dataset.target = target;

		const arrow = document.createElement("span");
		arrow.className = "move-to-arrow";
		arrow.textContent = "➡️ ";
		blockDiv.appendChild(arrow);

		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "move-to-select";
		btn.textContent = moveToTargetLabel(target);
		btn.disabled = isTypingActive || !!block.fromInclude;
		btn.addEventListener("mousedown", (e) => e.stopPropagation());
		btn.addEventListener("click", (e) => {
			e.stopPropagation();
			if (btn.disabled) return;
			if (isDropdownOpen()) {
				closeDropdown();
				return;
			}
			openDropdown({
				anchorEl: btn,
				blockIdx,
				options: this._moveToOptions(block.target, blockIdx),
				value: block.target,
				onPick: (v) => {
					if (v === "__new__") {
						this._promptNewFile(blockDiv, blockIdx, btn);
						return;
					}
					this.lessonManager.updateMoveToTarget(blockIdx, v);
					blockDiv.dataset.target = v;
					btn.textContent = moveToTargetLabel(v);
				},
			});
		});
		blockDiv.appendChild(btn);

		const note = document.createElement("input");
		note.type = "text";
		note.className = "move-to-note";
		note.value = block.note || "";
		note.placeholder = "why go here?";
		note.disabled = isTypingActive || !!block.fromInclude;
		note.addEventListener("mousedown", (e) => e.stopPropagation());
		note.addEventListener("click", (e) => e.stopPropagation());
		note.addEventListener("keydown", (e) => e.stopPropagation());
		note.addEventListener("input", () => {
			this.lessonManager.updateMoveToNote(blockIdx, note.value);
		});
		blockDiv.appendChild(note);

		const creates =
			classifyMoveToTarget(target).mode === "file" &&
			this.lessonManager.isFirstMoveToFile(blockIdx);

		if (creates && !block.fromInclude) {
			this.uiManager.attachBlockOption(
				blockDiv,
				this._blockOption({
					label: "Auto-type file name",
					checked: block.typeName !== false,
					disabled: isTypingActive,
					blockIdx,
					key: "typeName",
					byDefault: true,
				}),
			);
		}

		steps.push({
			type: "block",
			subtype: "move-to",
			fromInclude: !!block.fromInclude,
			target,
			note: block.note || "",
			typeName: creates && block.typeName !== false,
			snippet: extractAnchorSnippet(
				target,
				blockIdx,
				this.lessonManager.getAllBlocks(),
			),
			element: blockDiv,
			blockIndex: blockIdx,
			globalIndex: stepIndex,
		});

		blockDiv.dataset.stepIndex = stepIndex;
		return stepIndex + 1;
	}

	_moveToOptions(currentTarget, blockIdx) {
		const anchorLike = this.lessonManager
			.anchorIdsBefore(blockIdx)
			.filter((id) => !isFileName(id))
			.sort((a, b) => {
				const na = Number(a);
				const nb = Number(b);
				const aNum = Number.isFinite(na) && /^\d+$/.test(a);
				const bNum = Number.isFinite(nb) && /^\d+$/.test(b);
				if (aNum && bNum) return na - nb;
				if (aNum) return -1;
				if (bNum) return 1;
				return a.localeCompare(b);
			});
		const fileLike = this.lessonManager.getAllMoveToFiles();

		const opts = [];
		const option = (value) => ({ value, label: moveToTargetLabel(value) });
		for (const id of anchorLike) opts.push(option(wrapAnchor(id)));
		for (const name of fileLike) opts.push(option(name));
		opts.push(option("MAIN"));
		opts.push(option("DEV"));
		opts.push({ value: "__new__", label: "+ New File" });

		const hasCurrent = opts.some((o) => o.value === currentTarget);
		if (!hasCurrent && currentTarget && currentTarget !== "__new__") {
			opts.push({ value: currentTarget, label: `? ${currentTarget}` });
		}
		return opts;
	}

	_promptNewFile(blockDiv, blockIdx, trigger) {
		trigger.style.display = "none";
		const restore = () => {
			input.remove();
			trigger.style.display = "";
		};
		const input = document.createElement("input");
		input.type = "text";
		input.className = "move-to-new-file-input";
		input.placeholder = "filename.ext";
		input.addEventListener("mousedown", (e) => e.stopPropagation());
		input.addEventListener("click", (e) => e.stopPropagation());
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				const val = input.value.trim();
				if (val) {
					this.lessonManager.updateMoveToTarget(blockIdx, val);
					this.render();
				} else {
					restore();
				}
			} else if (e.key === "Escape") {
				e.preventDefault();
				restore();
			}
		});
		blockDiv.appendChild(input);
		input.focus();
	}

	handleBlockClick(e, block, blockIdx) {
		if (block.type === "include") return;
		if (block.fromInclude) {
			if (
				!this.uiManager.isActive() &&
				this.isMultilineCodeInsert(blockIdx) &&
				!this._isScrollbarClick(e)
			) {
				this.toggleIncludeExpanded(blockIdx);
			}
			return;
		}
		if (this.uiManager.isActive()) {
			this._handleClickWhileTyping(e, block, blockIdx);
		} else {
			this._handleClickWhileEditing(e, block, blockIdx);
		}
	}

	_rerenderAndFocus(blockIdx, clickX, clickY) {
		this.render();
		setTimeout(() => {
			this.uiManager.focusBlock(blockIdx, clickX, clickY);
		}, 0);
	}

	_handleClickWhileEditing(e, block, blockIdx) {
		const previousSelectedIndex = this.uiManager.getSelectedBlockIndex();

		if (previousSelectedIndex === blockIdx) return;

		const selection = window.getSelection();
		const hasSelection = selection && selection.toString().length > 0;

		this.uiManager.selectBlock(blockIdx);

		const blocks = document.querySelectorAll(".block");

		if (hasSelection) {
			if (previousSelectedIndex !== null && blocks[previousSelectedIndex]) {
				blocks[previousSelectedIndex].classList.remove("selected");
			}
			if (blocks[blockIdx]) {
				blocks[blockIdx].classList.add("selected");

				if (block.type === "code") {
					this.makeCodeBlockEditable(blocks[blockIdx], block, blockIdx);
				}

				blocks[blockIdx].focus();
			}

			return;
		}

		const clickX = e.clientX;
		const clickY = e.clientY;

		if (previousSelectedIndex !== null && blocks[previousSelectedIndex]) {
			blocks[previousSelectedIndex].classList.remove("selected");
			if (blocks[previousSelectedIndex].classList.contains("code-block")) {
				const prevBlock =
					this.lessonManager.getAllBlocks()[previousSelectedIndex];
				if (
					prevBlock &&
					blocks[previousSelectedIndex].contentEditable === "true"
				) {
					this._rerenderAndFocus(blockIdx, clickX, clickY);
					return;
				}
			} else if (this.isMultilineCodeInsert(previousSelectedIndex)) {
				this._rerenderAndFocus(blockIdx, clickX, clickY);
				return;
			}
		}

		if (blocks[blockIdx]) {
			blocks[blockIdx].classList.add("selected");

			if (block.type === "code") {
				this.makeCodeBlockEditable(blocks[blockIdx], block, blockIdx);
			} else if (this.isMultilineCodeInsert(blockIdx)) {
				this._rerenderAndFocus(blockIdx, clickX, clickY);
				return;
			}
		}

		this.uiManager.focusBlock(blockIdx, clickX, clickY);
	}

	_handleClickWhileTyping(e, block, blockIdx) {
		if (block.type === "code") {
			const clickedSpan = e.target.closest(".char");
			if (clickedSpan) {
				this.cursorManager.jumpTo(parseInt(clickedSpan.dataset.stepIndex));
			}
		} else {
			const executionSteps = this.cursorManager.getExecutionSteps();
			const step = executionSteps.find((s) => s.blockIndex === blockIdx);
			if (step) {
				this.cursorManager.jumpTo(step.globalIndex);
			}
		}
	}

	broadcastLessonData(executionSteps) {
		const blocks = this.lessonManager.getAllBlocks();

		ipcRenderer.send("update-lesson-data", {
			blocks: blocks,
			executionSteps: executionSteps.map((step) => ({
				type: step.type,
				blockIndex: step.blockIndex,
				globalIndex: step.globalIndex,
				char: step.char,
				value: step.value,
			})),
		});
	}
}

module.exports = LessonRenderer;
