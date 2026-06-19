const { ipcRenderer } = require("electron");

const { getBlockSubtype } = require("../shared/constants");
const { extractAnchorSnippet } = require("./anchor-snippet");
const { buildCodeText } = require("../shared/code-text");

class LessonRenderer {
	constructor(lessonManager, uiManager, cursorManager, undoManager = null) {
		this.lessonManager = lessonManager;
		this.uiManager = uiManager;
		this.cursorManager = cursorManager;
		this.undoManager = undoManager;
		this.editDebounceTimer = null;
		this.lastEditedBlockIndex = null;
		this.lastEditedContent = null;
	}

	attachEditHandlers(element) {
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
			}
		};
	}

	makeCodeBlockEditable(element, block, blockIdx) {
		element.contentEditable = "true";
		element.textContent = block.text;
		element.oninput = () => {
			this.saveEditState(blockIdx, element.innerText);
			this.lessonManager.updateBlock(blockIdx, element.innerText);
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

			if (block.type === "comment") {
				globalStepCounter = this.renderCommentBlock(
					blockDiv,
					block,
					blockIdx,
					isTypingActive,
					globalStepCounter,
					executionSteps,
				);
			} else if (block.type === "code") {
				globalStepCounter = this.renderCodeBlock(
					blockDiv,
					block,
					blockIdx,
					isTypingActive,
					globalStepCounter,
					executionSteps,
				);
			} else if (block.type === "move-to") {
				globalStepCounter = this.renderMoveToBlock(
					blockDiv,
					block,
					blockIdx,
					isTypingActive,
					globalStepCounter,
					executionSteps,
				);
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
		return (
			block &&
			getBlockSubtype(block.text) === "code-insert-comment" &&
			block.text.includes("\n")
		);
	}

	renderCommentBlock(
		blockDiv,
		block,
		blockIdx,
		isTypingActive,
		globalStepCounter,
		executionSteps,
	) {
		const subtype = getBlockSubtype(block.text);
		if (subtype) blockDiv.classList.add(subtype);

		const selectedBlockIndex = this.uiManager.getSelectedBlockIndex();
		const isMultilineInsert =
			subtype === "code-insert-comment" && block.text.includes("\n");
		const isExpanded =
			isMultilineInsert &&
			selectedBlockIndex === blockIdx &&
			!isTypingActive;

		if (isMultilineInsert && !isExpanded) {
			blockDiv.contentEditable = "false";
			blockDiv.textContent = block.text.split("\n")[0] + "...";
			blockDiv.title = block.text;
			blockDiv.classList.add("collapsed");
		} else {
			blockDiv.contentEditable = !isTypingActive;
			blockDiv.textContent = block.text;
			blockDiv.title = "";
		}

		blockDiv.oninput = () => {
			this.saveEditState(blockIdx, blockDiv.innerText);
			this.lessonManager.updateBlock(blockIdx, blockDiv.innerText);

			blockDiv.classList.remove(
				"question-comment",
				"image-comment",
				"web-comment",
				"code-insert-comment",
				"move-to-comment",
			);
			const sub = getBlockSubtype(blockDiv.innerText);
			if (sub) blockDiv.classList.add(sub);
		};

		this.attachEditHandlers(blockDiv);

		executionSteps.push({
			type: "block",
			element: blockDiv,
			blockIndex: blockIdx,
			globalIndex: globalStepCounter,
		});

		blockDiv.dataset.stepIndex = globalStepCounter;
		return globalStepCounter + 1;
	}

	renderCodeBlock(
		blockDiv,
		block,
		blockIdx,
		isTypingActive,
		globalStepCounter,
		executionSteps,
	) {
		const selectedBlockIndex = this.uiManager.getSelectedBlockIndex();

		if (selectedBlockIndex === blockIdx && !isTypingActive) {
			this.makeCodeBlockEditable(blockDiv, block, blockIdx);
			return globalStepCounter;
		} else {
			blockDiv.contentEditable = "false";

			globalStepCounter = buildCodeText(
				block.text,
				blockDiv,
				globalStepCounter,
				(step) => executionSteps.push({ ...step, blockIndex: blockIdx }),
			);

			executionSteps.push({
				type: "block",
				element: blockDiv,
				blockIndex: blockIdx,
				globalIndex: globalStepCounter,
			});

			blockDiv.dataset.stepIndex = globalStepCounter;
			return globalStepCounter + 1;
		}
	}

	renderMoveToBlock(
		blockDiv,
		block,
		blockIdx,
		isTypingActive,
		globalStepCounter,
		executionSteps,
	) {
		blockDiv.classList.add("move-to-comment");
		blockDiv.contentEditable = "false";
		const target = block.target || "MAIN";
		blockDiv.dataset.target = target;

		const arrow = document.createElement("span");
		arrow.className = "move-to-arrow";
		arrow.textContent = "➡️ ";
		blockDiv.appendChild(arrow);

		const select = document.createElement("select");
		select.className = "move-to-select";
		select.disabled = isTypingActive;
		this._populateMoveToSelect(select, target);
		select.addEventListener("mousedown", (e) => {
			e.stopPropagation();
			this._populateMoveToSelect(select, block.target);
		});
		select.addEventListener("click", (e) => e.stopPropagation());
		select.addEventListener("change", () => {
			const v = select.value;
			if (v === "__new__") {
				this._promptNewFile(blockDiv, blockIdx, select);
				return;
			}
			this.lessonManager.updateMoveToTarget(blockIdx, v);
			blockDiv.dataset.target = v;
		});
		blockDiv.appendChild(select);

		executionSteps.push({
			type: "block",
			subtype: "move-to",
			target,
			snippet: extractAnchorSnippet(
				target,
				blockIdx,
				this.lessonManager.getAllBlocks(),
			),
			element: blockDiv,
			blockIndex: blockIdx,
			globalIndex: globalStepCounter,
		});

		blockDiv.dataset.stepIndex = globalStepCounter;
		return globalStepCounter + 1;
	}

	_populateMoveToSelect(select, currentTarget) {
		const anchorIds = this.lessonManager.getAllAnchorIds();
		const fileRe = /\.[a-z0-9]+$/i;
		const fileLike = anchorIds.filter((id) => fileRe.test(id));
		const anchorLike = anchorIds
			.filter((id) => !fileRe.test(id))
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

		const opts = [];
		for (const id of anchorLike) {
			opts.push({ value: `⚓${id}⚓`, label: `⚓${id}⚓` });
		}
		for (const id of fileLike) {
			opts.push({ value: `⚓${id}⚓`, label: `📄 ${id}` });
		}
		opts.push({ value: "MAIN", label: "Main Editor" });
		opts.push({ value: "DEV", label: "Dev Tools" });
		opts.push({ value: "__new__", label: "+ New File" });

		select.innerHTML = "";
		let hasCurrent = false;
		for (const o of opts) {
			const el = document.createElement("option");
			el.value = o.value;
			el.textContent = o.label;
			if (o.value === currentTarget) {
				el.selected = true;
				hasCurrent = true;
			}
			select.appendChild(el);
		}
		if (!hasCurrent && currentTarget && currentTarget !== "__new__") {
			const el = document.createElement("option");
			el.value = currentTarget;
			el.textContent = `? ${currentTarget}`;
			el.selected = true;
			select.appendChild(el);
		}
	}

	_promptNewFile(blockDiv, blockIdx, select) {
		const currentTarget =
			(this.lessonManager.getBlock(blockIdx) || {}).target || "MAIN";
		select.style.display = "none";
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
					const target = `⚓${val}⚓`;
					this.lessonManager.updateMoveToTarget(blockIdx, target);
					this.render();
				} else {
					select.value = currentTarget;
					input.remove();
					select.style.display = "";
				}
			} else if (e.key === "Escape") {
				e.preventDefault();
				select.value = currentTarget;
				input.remove();
				select.style.display = "";
			}
		});
		blockDiv.appendChild(input);
		input.focus();
	}

	handleBlockClick(e, block, blockIdx) {
		const isTypingActive = this.uiManager.isActive();

		if (!isTypingActive) {
			const previousSelectedIndex = this.uiManager.getSelectedBlockIndex();

			if (previousSelectedIndex === blockIdx) return;

			const selection = window.getSelection();
			const hasSelection = selection && selection.toString().length > 0;

			this.uiManager.selectBlock(blockIdx);

			if (hasSelection) {
				const blocks = document.querySelectorAll(".block");

				if (
					previousSelectedIndex !== null &&
					blocks[previousSelectedIndex]
				) {
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

			const blocks = document.querySelectorAll(".block");

			if (previousSelectedIndex !== null && blocks[previousSelectedIndex]) {
				blocks[previousSelectedIndex].classList.remove("selected");
				if (
					blocks[previousSelectedIndex].classList.contains("code-block")
				) {
					const prevBlock =
						this.lessonManager.getAllBlocks()[previousSelectedIndex];
					if (
						prevBlock &&
						blocks[previousSelectedIndex].contentEditable === "true"
					) {
						this.render();

						setTimeout(() => {
							this.uiManager.focusBlock(blockIdx, clickX, clickY);
						}, 0);
						return;
					}
				} else if (this.isMultilineCodeInsert(previousSelectedIndex)) {
					this.render();
					setTimeout(() => {
						this.uiManager.focusBlock(blockIdx, clickX, clickY);
					}, 0);
					return;
				}
			}

			if (blocks[blockIdx]) {
				blocks[blockIdx].classList.add("selected");

				if (block.type === "code") {
					this.makeCodeBlockEditable(blocks[blockIdx], block, blockIdx);
				} else if (this.isMultilineCodeInsert(blockIdx)) {
					this.render();
					setTimeout(() => {
						this.uiManager.focusBlock(blockIdx, clickX, clickY);
					}, 0);
					return;
				}
			}

			this.uiManager.focusBlock(blockIdx, clickX, clickY);
		} else {
			if (block.type === "code") {
				const clickedSpan = e.target.closest(".char");
				if (clickedSpan) {
					this.cursorManager.jumpTo(
						parseInt(clickedSpan.dataset.stepIndex),
					);
				}
			} else {
				const executionSteps = this.cursorManager.getExecutionSteps();
				const step = executionSteps.find((s) => s.blockIndex === blockIdx);
				if (step) {
					this.cursorManager.jumpTo(step.globalIndex);
				}
			}
		}
	}

	broadcastLessonData(executionSteps) {
		const blocks = this.lessonManager.getAllBlocks();

		ipcRenderer.send("broadcast-lesson-data", {
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
