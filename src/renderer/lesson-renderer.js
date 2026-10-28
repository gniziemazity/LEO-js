const { ipcRenderer } = require("electron");

const {
	getBlockType,
	blockTypeOf,
	hasBlockControls,
	isMultilineSnippet,
	typeClass,
	SUPPORT_TYPES,
	collapsedLabel,
	startingCodeLabel,
	stripBlockPrefix,
} = require("../shared/blocks");
const { computeGoToExcerpts } = require("./plan-replay");
const UIManager = require("./ui-manager");
const {
	buildCodeText,
	readCodeText,
	writeCodeText,
} = require("../shared/code-text");
const {
	isFileName,
	wrapAnchor,
	goToTargetLabel,
	classifyGoToTarget,
} = require("../shared/go-to-target");
const {
	openDropdown,
	closeDropdown,
	isOpen: isDropdownOpen,
} = require("./go-to-dropdown");
const { addChoices, typeChoices, typeGlyph } = require("./block-types");

const EDIT_BURST_IDLE_MS = 1000;

const BLOCK_RENDERERS = {
	comment: "renderCommentBlock",
	code: "renderCodeBlock",
	"go-to": "renderGoToBlock",
	include: "renderIncludeBlock",
};

class LessonRenderer {
	constructor(lessonManager, uiManager, cursorManager, undoManager = null) {
		this.lessonManager = lessonManager;
		this.uiManager = uiManager;
		this.cursorManager = cursorManager;
		this.undoManager = undoManager;
		this.lastEditedBlockIndex = null;
		this.lastEditTime = 0;
		this.expandedStartFiles = new Set();
		this.startCollapsed = true;
		this._goToExcerpts = new Map();
		this.onRendered = null;
	}

	_isScrollbarClick(e) {
		const el = e && e.currentTarget;
		return (
			!!el && typeof e.offsetX === "number" && e.offsetX > el.clientWidth
		);
	}

	toggleStartFile(blockIdx) {
		if (this.expandedStartFiles.has(blockIdx)) {
			this.expandedStartFiles.delete(blockIdx);
		} else {
			this.expandedStartFiles.add(blockIdx);
		}
		this.render();
	}

	toggleStartCollapsed() {
		this.startCollapsed = !this.startCollapsed;
		this.uiManager.setStartCollapsed(this.startCollapsed);
		this._syncSidebar();
	}

	attachEditHandlers(element, allowTab = false) {
		element.onbeforeinput = (e) => {
			if (e.inputType === "historyUndo" || e.inputType === "historyRedo") {
				e.preventDefault();
			}
		};
		element.onpaste = (e) => {
			e.preventDefault();
			const text = e.clipboardData
				.getData("text/plain")
				.replace(/\r\n?/g, "\n");
			document.execCommand("insertText", false, text);
		};
		element.onkeydown = (e) => {
			if (e.key === "Backspace" && this._caretAtBodyStart(element)) {
				e.preventDefault();
			} else if (e.key === "Enter") {
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
		this._syncEmpty(element, block.text);
		element.oninput = () => {
			const text = readCodeText(element);
			this.saveEditState(blockIdx, text);
			this.lessonManager.updateBlock(blockIdx, text);
			this._syncEmpty(element, text);
			this._keepIsland(element, blockIdx);
		};
		this.attachEditHandlers(element);
	}

	resetView() {
		this.endEditBurst();
		this.expandedStartFiles.clear();
		this.startCollapsed = true;
		if (this.uiManager.getSelectedBlockIndex() !== null) {
			this.uiManager.deselectBlock();
		}
	}

	endEditBurst() {
		this.lastEditedBlockIndex = null;
		this.lastEditTime = 0;
	}

	saveEditState(blockIndex) {
		if (!this.undoManager) return;

		const now = Date.now();
		const startsBurst =
			this.lastEditedBlockIndex !== blockIndex ||
			now - this.lastEditTime > EDIT_BURST_IDLE_MS;

		if (startsBurst) this.undoManager.saveState("edit-block");

		this.lastEditedBlockIndex = blockIndex;
		this.lastEditTime = now;
	}

	render() {
		const isAutoTypingActive = this.uiManager.isActive();

		this.uiManager.clearLessonContainer();
		this.uiManager.setStartCollapsed(this.startCollapsed);
		const executionSteps = [];
		let globalStepCounter = 0;

		const blocks = this.lessonManager.getAllBlocks();
		this._goToExcerpts = computeGoToExcerpts(blocks);

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
					isAutoTypingActive,
					stepIndex: globalStepCounter,
					steps: executionSteps,
				});
			}

			this.uiManager.appendToLessonContainer(blockDiv);
		});

		this._syncSidebar();

		this.cursorManager.setExecutionSteps(executionSteps);

		if (isAutoTypingActive) {
			this.cursorManager.updateCursor();
		}

		this.broadcastLessonData(executionSteps);
		if (this.onRendered) this.onRendered();
	}

	_syncSidebar() {
		const selected = this.uiManager.getSelectedBlockIndex();
		const block =
			selected === null ? null : this.lessonManager.getAllBlocks()[selected];
		const authored = !!block && !block.fromStart;
		const codeSelected = authored && block.type === "code";
		const snippetSelected =
			authored &&
			block.type === "comment" &&
			getBlockType(block.text) === "snippet";
		this.uiManager.setSidebarEnabled(
			codeSelected ||
				snippetSelected ||
				(!this.startCollapsed && this.expandedStartFiles.size > 0),
			codeSelected,
		);
	}

	isMultilineSnippet(blockIdx) {
		const block = this.lessonManager.getAllBlocks()[blockIdx];
		return !!block && isMultilineSnippet(block.text);
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

	_typePicker(block, blockIdx, isAutoTypingActive) {
		const type = blockTypeOf(block);
		return {
			glyph: typeGlyph(type),
			title: "Change block type",
			disabled: isAutoTypingActive,
			onClick: (btn) =>
				openDropdown({
					anchorEl: btn,
					blockIdx,
					value: type,
					options: typeChoices().map((c) => ({
						value: c.type,
						label: `${c.glyph} ${c.label}`,
					})),
					listClass: "type-options",
					itemClass: "type-option",
					onPick: (v) =>
						this.blockEditor && this.blockEditor.setType(blockIdx, v),
				}),
		};
	}

	_attachType(blockDiv, block, blockIdx, isAutoTypingActive) {
		if (!hasBlockControls(block)) return;
		this.uiManager.attachTypePicker(
			blockDiv,
			this._typePicker(block, blockIdx, isAutoTypingActive),
		);
	}

	_addTools(after, where) {
		return addChoices().map((c, i) => ({
			glyph: `+${c.glyph}`,
			title: `Add a ${c.label.toLowerCase()} block ${where} (Ctrl+${i + 1})`,
			className: `block-tool-add block-tool-hover ${where}`,
			dataset: { addType: c.type },
			onClick: () =>
				this.blockEditor &&
				this.blockEditor.addBlock(
					c.storedType,
					c.initialText || null,
					after,
				),
		}));
	}

	_pasteTool(after, where) {
		return {
			glyph: "📥",
			title: `Paste what was copied ${where} (Ctrl+Shift+V)`,
			className: `block-tool-paste block-tool-hover ${where}`,
			onClick: () => this.blockEditor && this.blockEditor.pasteBlock(after),
		};
	}

	_targetsFor(blockIdx) {
		const picked = this.uiManager.getSelectedBlockIndices
			? this.uiManager.getSelectedBlockIndices()
			: [];
		return picked.length > 1 && picked.includes(blockIdx)
			? picked
			: [blockIdx];
	}

	_targetsLabel(targets) {
		return targets.length > 1
			? `${targets.length} selected blocks`
			: "this block";
	}

	_addRow(block, blockIdx, isAutoTypingActive, where) {
		if (isAutoTypingActive || !hasBlockControls(block)) return [];
		const above = where === "above";
		const delta = above ? -1 : 1;
		const after = above ? blockIdx - 1 : blockIdx;
		const targets = this._targetsFor(blockIdx);
		return [
			...this._addTools(after, where),
			this._pasteTool(after, where),
			{
				glyph: above ? "▲" : "▼",
				title: `Move ${this._targetsLabel(targets)} ${
					above ? "up (Ctrl+Shift+Up)" : "down (Ctrl+Shift+Down)"
				}`,
				className: "block-tool-hover",
				disabled: !this.lessonManager.canMoveBlocks(targets, delta),
				onClick: () =>
					this.blockEditor && this.blockEditor.moveBlocks(targets, delta),
			},
		];
	}

	_blockTools(block, blockIdx, isAutoTypingActive) {
		if (isAutoTypingActive || !hasBlockControls(block)) return [];
		const targets = this._targetsFor(blockIdx);
		const label = this._targetsLabel(targets);

		return [
			{
				glyph: "⧉",
				title: `Copy ${label} (Ctrl+Shift+C)`,
				className: "block-tool-hover",
				onClick: () =>
					this.blockEditor && this.blockEditor.copyBlocks(targets),
			},
			{
				glyph: "🗑️",
				title: `Delete ${label} (Ctrl+D)`,
				className: "block-tool-remove block-tool-hover",
				disabled: !this.lessonManager.canRemoveBlocks(targets),
				onClick: () =>
					this.blockEditor && this.blockEditor.removeBlocks(targets),
			},
		];
	}

	_optionFor(block, blockIdx, isAutoTypingActive) {
		if (block.fromStart) return null;
		const option = (label, checked, key, byDefault) =>
			this._blockOption({
				label,
				checked,
				disabled: isAutoTypingActive,
				blockIdx,
				key,
				byDefault,
			});
		if (block.type === "comment") {
			const type = getBlockType(block.text);
			if (type === "snippet") {
				return option("Show Paste", block.paste !== false, "paste", true);
			}
			if (type === "image" || type === "web") {
				return option("Pin window", block.pin === true, "pin", false);
			}
		}
		if (block.type === "go-to" && this._createsFile(block, blockIdx)) {
			return option("Type name", block.typeName !== false, "typeName", true);
		}
		return null;
	}

	_createsFile(block, blockIdx) {
		return (
			classifyGoToTarget(block.target || "MAIN").mode === "file" &&
			this.lessonManager.isFirstGoToFile(blockIdx)
		);
	}

	_attachIsland(blockDiv, block, blockIdx, isAutoTypingActive) {
		this.uiManager.attachBlockIsland(blockDiv, {
			tools: this._addRow(block, blockIdx, isAutoTypingActive, "above"),
			className: "block-opt-above",
		});
		const island = this.uiManager.attachBlockIsland(blockDiv, {
			option: this._optionFor(block, blockIdx, isAutoTypingActive),
			tools: this._blockTools(block, blockIdx, isAutoTypingActive),
		});
		this.uiManager.attachBlockIsland(blockDiv, {
			tools: this._addRow(block, blockIdx, isAutoTypingActive, "below"),
			className: "block-opt-below",
		});
		this._attachType(blockDiv, block, blockIdx, isAutoTypingActive);
		return island;
	}

	_onFoldArrow(e) {
		const el = e && e.currentTarget;
		if (!el || typeof e.clientX !== "number") return false;
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		let node;
		while ((node = walker.nextNode())) {
			if (node.length && !UIManager.isIsland(node)) break;
		}
		if (!node) return false;
		const range = document.createRange();
		range.setStart(node, 0);
		range.setEnd(node, node.data.codePointAt(0) > 0xffff ? 2 : 1);
		const first = range.getBoundingClientRect();
		return (
			e.clientX < first.left &&
			e.clientY >= first.top &&
			e.clientY <= first.bottom
		);
	}

	_onStartFileInput(el, blockIdx) {
		const typed = readCodeText(el);
		const body = stripBlockPrefix(typed);
		const caret = this._caretOffset(el);
		const block = this.lessonManager.getAllBlocks()[blockIdx];
		if (
			body !== stripBlockPrefix(block.text) &&
			this.lessonManager.canSetStartAnchors(blockIdx, body)
		) {
			this.saveEditState(blockIdx, typed);
		}
		this.lessonManager.setStartAnchors(blockIdx, body);
		if (typed === block.text) return;
		el.textContent = block.text;
		if (caret !== null)
			this._placeCaret(el, caret - (typed.length - block.text.length));
	}

	_fragmentBefore(el, node, offset) {
		const before = document.createRange();
		before.selectNodeContents(el);
		before.setEnd(node, offset);
		const holder = document.createElement("div");
		holder.appendChild(before.cloneContents());
		return holder;
	}

	_caretOffset(el) {
		const sel = window.getSelection();
		if (!sel || !sel.rangeCount) return null;
		const range = sel.getRangeAt(0);
		if (!el.contains(range.endContainer)) return null;
		return readCodeText(
			this._fragmentBefore(el, range.endContainer, range.endOffset),
		).length;
	}

	caretFocus() {
		if (this.uiManager.isActive()) return null;
		const active = document.activeElement;
		const blockEl =
			active && active.closest ? active.closest(".block") : null;
		if (!blockEl) return null;
		const index = UIManager.blockIndexOf(blockEl);
		const block = this.lessonManager.getAllBlocks()[index];
		if (!hasBlockControls(block)) return null;
		const sel = window.getSelection();
		if (
			block.type !== "code" ||
			!sel ||
			!sel.rangeCount ||
			!blockEl.contains(sel.focusNode)
		) {
			return { index, caret: null };
		}
		const holder = this._fragmentBefore(
			blockEl,
			sel.focusNode,
			sel.focusOffset,
		);
		return { index, caret: readCodeText(holder).length };
	}

	_caretAtBodyStart(el) {
		const sel = window.getSelection();
		if (!sel || !sel.rangeCount || !sel.isCollapsed) return false;
		const range = sel.getRangeAt(0);
		if (!el.contains(range.endContainer)) return false;
		const fragment = this._fragmentBefore(
			el,
			range.endContainer,
			range.endOffset,
		);
		fragment
			.querySelectorAll("[data-block-opt]")
			.forEach((island) => island.remove());
		return (
			fragment.textContent.length === 0 && !fragment.querySelector("br, div")
		);
	}

	_placeCaret(el, offset) {
		const sel = window.getSelection();
		if (!sel) return;
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		let left = Math.max(0, offset);
		let node;
		while ((node = walker.nextNode())) {
			if (UIManager.isIsland(node)) continue;
			if (left <= node.length) {
				const range = document.createRange();
				range.setStart(node, left);
				range.collapse(true);
				sel.removeAllRanges();
				sel.addRange(range);
				return;
			}
			left -= node.length;
		}
	}

	_keepIsland(el, blockIdx) {
		if (el.classList.contains("is-empty")) {
			const placeholder = el.querySelector(":scope > br");
			if (placeholder && placeholder !== el.lastChild)
				el.appendChild(placeholder);
		}
		if (
			el.querySelector(":scope > .block-opt-below") &&
			el.querySelector(":scope > .block-type")
		)
			return;
		this.refreshIsland(blockIdx);
	}

	refreshIsland(blockIdx) {
		if (blockIdx === null || blockIdx === undefined) return;
		const el = UIManager.blockElement(blockIdx);
		const block = this.lessonManager.getAllBlocks()[blockIdx];
		if (!el || !block) return;
		for (const old of el.querySelectorAll(
			":scope > .block-opt, :scope > .block-type",
		))
			old.remove();
		this._attachIsland(el, block, blockIdx, this.uiManager.isActive());
	}

	_syncEmpty(el, text) {
		if (text) el.classList.remove("is-empty");
		else el.classList.add("is-empty");
	}

	renderCommentBlock(ctx) {
		const {
			blockDiv,
			block,
			blockIdx,
			isAutoTypingActive,
			stepIndex,
			steps,
		} = ctx;
		const type = getBlockType(block.text);

		const selectedBlockIndex = this.uiManager.getSelectedBlockIndex();
		const isMultilineInsert = isMultilineSnippet(block.text);
		const isExpanded =
			isMultilineInsert &&
			!isAutoTypingActive &&
			(block.fromStart
				? this.expandedStartFiles.has(blockIdx)
				: selectedBlockIndex === blockIdx);

		const shown = hasBlockControls(block)
			? stripBlockPrefix(block.text)
			: block.text;

		if (isMultilineInsert && !isExpanded) {
			blockDiv.contentEditable = "false";
			blockDiv.textContent = collapsedLabel(shown);
			blockDiv.classList.add("collapsed");
		} else {
			blockDiv.contentEditable =
				!isAutoTypingActive && (!block.fromStart || !!block.startFile);
			blockDiv.textContent = shown;
		}

		this._syncEmpty(blockDiv, shown);
		this._attachIsland(blockDiv, block, blockIdx, isAutoTypingActive);

		if (block.startFile) blockDiv.classList.add("start-file");

		blockDiv.oninput = () => {
			if (block.startFile) {
				this._onStartFileInput(blockDiv, blockIdx);
				return;
			}
			if (blockDiv.contentEditable !== "true") return;
			const body = readCodeText(blockDiv);
			this.saveEditState(blockIdx, body);
			this.lessonManager.updateBlockBody(blockIdx, body);
			this._syncEmpty(blockDiv, body);
			this._keepIsland(blockDiv, blockIdx);

			const current = this.lessonManager.getAllBlocks()[blockIdx];
			const type = getBlockType(current.text);
			blockDiv.classList.remove(...SUPPORT_TYPES.map(typeClass));
			blockDiv.classList.add(typeClass(type));
			const picker = blockDiv.querySelector(":scope > .block-type");
			if (picker) picker.textContent = typeGlyph(type);
		};

		this.attachEditHandlers(blockDiv, type === "snippet");

		steps.push({
			type: "block",
			fromStart: !!block.fromStart,
			text: block.text,
			paste: block.paste !== false,
			pin: block.pin === true,
			element: blockDiv,
			blockIndex: blockIdx,
			globalIndex: stepIndex,
		});

		return stepIndex + 1;
	}

	renderCodeBlock(ctx) {
		const { blockDiv, block, blockIdx, isAutoTypingActive, steps } = ctx;
		let stepIndex = ctx.stepIndex;
		const selectedBlockIndex = this.uiManager.getSelectedBlockIndex();

		if (selectedBlockIndex === blockIdx && !isAutoTypingActive) {
			this.makeCodeBlockEditable(blockDiv, block, blockIdx);
			this._attachIsland(blockDiv, block, blockIdx, isAutoTypingActive);
			return stepIndex;
		} else {
			blockDiv.contentEditable = "false";

			stepIndex = buildCodeText(block.text, blockDiv, stepIndex, (step) =>
				steps.push({ ...step, blockIndex: blockIdx }),
			);
			this._syncEmpty(blockDiv, block.text);
			this._attachIsland(blockDiv, block, blockIdx, isAutoTypingActive);

			steps.push({
				type: "block",
				blockType: "code",
				element: blockDiv,
				blockIndex: blockIdx,
				globalIndex: stepIndex,
			});

			return stepIndex + 1;
		}
	}

	renderIncludeBlock(ctx) {
		const { blockDiv, block, stepIndex } = ctx;
		blockDiv.contentEditable = "false";
		if (!block.dir) {
			blockDiv.style.display = "none";
			return stepIndex;
		}
		blockDiv.classList.add("include-block");
		blockDiv.textContent = startingCodeLabel(block.files);
		blockDiv.title = `${block.dir}/ · open a file to add or remove ⚓ anchors`;
		return stepIndex;
	}

	renderGoToBlock(ctx) {
		const {
			blockDiv,
			block,
			blockIdx,
			isAutoTypingActive,
			stepIndex,
			steps,
		} = ctx;
		blockDiv.contentEditable = "false";
		const target = block.target || "MAIN";
		blockDiv.dataset.target = target;

		if (!hasBlockControls(block)) {
			const arrow = document.createElement("span");
			arrow.className = "go-to-arrow";
			arrow.textContent = "➡️ ";
			blockDiv.appendChild(arrow);
		}

		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "go-to-select";
		btn.textContent = goToTargetLabel(target);
		btn.disabled = isAutoTypingActive || !!block.fromStart;
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
				options: this._goToOptions(block.target, blockIdx),
				value: block.target,
				onPick: (v) => {
					if (v === "__new__") {
						this._promptNewFile(blockDiv, blockIdx, btn);
						return;
					}
					this.lessonManager.updateGoToTarget(blockIdx, v);
					blockDiv.dataset.target = v;
					btn.textContent = goToTargetLabel(v);
				},
			});
		});
		blockDiv.appendChild(btn);

		const note = document.createElement("input");
		note.type = "text";
		note.className = "go-to-note";
		note.value = block.note || "";
		note.placeholder = "why go here?";
		note.disabled = isAutoTypingActive || !!block.fromStart;
		note.addEventListener("mousedown", (e) => e.stopPropagation());
		note.addEventListener("click", (e) => e.stopPropagation());
		note.addEventListener("keydown", (e) => e.stopPropagation());
		note.addEventListener("input", () => {
			this.lessonManager.updateGoToNote(blockIdx, note.value);
		});
		blockDiv.appendChild(note);

		const creates = this._createsFile(block, blockIdx);
		this._attachIsland(blockDiv, block, blockIdx, isAutoTypingActive);

		steps.push({
			type: "block",
			blockType: "go-to",
			fromStart: !!block.fromStart,
			target,
			note: block.note || "",
			typeName: creates && block.typeName !== false,
			excerpt: this._goToExcerpts.get(blockIdx) || null,
			element: blockDiv,
			blockIndex: blockIdx,
			globalIndex: stepIndex,
		});

		return stepIndex + 1;
	}

	_goToOptions(currentTarget, blockIdx) {
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
		const fileLike = this.lessonManager.getAllGoToFiles();

		const opts = [];
		const option = (value) => ({ value, label: goToTargetLabel(value) });
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
		input.className = "go-to-new-file-input";
		input.placeholder = "filename.ext";
		input.addEventListener("mousedown", (e) => e.stopPropagation());
		input.addEventListener("click", (e) => e.stopPropagation());
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				const val = input.value.trim();
				if (val) {
					this.lessonManager.updateGoToTarget(blockIdx, val);
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
		if (block.type === "include") {
			if (block.dir) this.toggleStartCollapsed();
			return;
		}
		if (block.fromStart) {
			if (this.uiManager.isActive() || !this.isMultilineSnippet(blockIdx))
				return;
			const openStartFile =
				!!block.startFile && this.expandedStartFiles.has(blockIdx);
			if (openStartFile ? this._onFoldArrow(e) : !this._isScrollbarClick(e))
				this.toggleStartFile(blockIdx);
			return;
		}
		if (this.uiManager.isActive()) {
			this._handleClickWhileAutoTyping(e, block, blockIdx);
		} else {
			this._handleClickWhileEditing(e, block, blockIdx);
		}
	}

	_offsetAtPoint(el, x, y) {
		if (typeof document.caretRangeFromPoint !== "function") return null;
		const range = document.caretRangeFromPoint(x, y);
		if (!range || range.startContainer.nodeType !== Node.TEXT_NODE) {
			return null;
		}
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		let offset = 0;
		let node;
		while ((node = walker.nextNode())) {
			if (UIManager.isIsland(node)) continue;
			if (node === range.startContainer) return offset + range.startOffset;
			offset += node.length;
		}
		return null;
	}

	_rerenderAndFocus(blockIdx, clickX, clickY) {
		const clickedEl = document.elementFromPoint(clickX, clickY);
		const clickedBlock = clickedEl && clickedEl.closest(".block");
		const caretOffset = clickedBlock
			? this._offsetAtPoint(clickedBlock, clickX, clickY)
			: null;

		this.render();

		setTimeout(() => {
			const target = UIManager.blockElement(blockIdx);
			if (target && caretOffset !== null) {
				target.focus();
				this._placeCaret(target, caretOffset);
			} else {
				this.uiManager.focusBlock(blockIdx, clickX, clickY);
			}
		}, 0);
	}

	_extendSelection(e, blockIdx) {
		const ui = this.uiManager;
		const primary = ui.getSelectedBlockIndex();
		const toggle = e.ctrlKey || e.metaKey;
		if (primary === null || (!toggle && !e.shiftKey)) return false;
		if (!toggle && primary === blockIdx) return false;
		e.preventDefault();
		if (toggle) ui.toggleInSelection(blockIdx);
		else ui.selectRange(blockIdx, this.lessonManager.firstAuthoredIndex());
		this.render();
		ui.refocusBlock(ui.getSelectedBlockIndex());
		return true;
	}

	_handleClickWhileEditing(e, block, blockIdx) {
		if (this._extendSelection(e, blockIdx)) return;

		if (this.uiManager.isMultiSelected()) {
			this.uiManager.selectBlock(blockIdx);
			this._rerenderAndFocus(blockIdx, e.clientX, e.clientY);
			return;
		}

		const previousSelectedIndex = this.uiManager.getSelectedBlockIndex();

		if (previousSelectedIndex === blockIdx) return;

		const selection = window.getSelection();
		const hasSelection = selection && selection.toString().length > 0;

		this.uiManager.selectBlock(blockIdx);
		this._syncSidebar();

		const blocks = document.querySelectorAll(".block");

		if (hasSelection) {
			if (previousSelectedIndex !== null && blocks[previousSelectedIndex]) {
				blocks[previousSelectedIndex].classList.remove("selected");
				this.refreshIsland(previousSelectedIndex);
			}
			if (blocks[blockIdx]) {
				blocks[blockIdx].classList.add("selected");

				if (block.type === "code") {
					this.makeCodeBlockEditable(blocks[blockIdx], block, blockIdx);
				}
				this.refreshIsland(blockIdx);

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
			} else if (this.isMultilineSnippet(previousSelectedIndex)) {
				this._rerenderAndFocus(blockIdx, clickX, clickY);
				return;
			}
			this.refreshIsland(previousSelectedIndex);
		}

		if (blocks[blockIdx]) {
			blocks[blockIdx].classList.add("selected");

			if (block.type === "code") {
				this.makeCodeBlockEditable(blocks[blockIdx], block, blockIdx);
			} else if (this.isMultilineSnippet(blockIdx)) {
				this._rerenderAndFocus(blockIdx, clickX, clickY);
				return;
			}
			this.refreshIsland(blockIdx);
		}

		this.uiManager.focusBlock(blockIdx, clickX, clickY);
	}

	_handleClickWhileAutoTyping(e, block, blockIdx) {
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
		if (executionSteps) this._lastBroadcastSteps = executionSteps;
		const steps = executionSteps || this._lastBroadcastSteps;
		if (!steps) return;
		if (!this.uiManager.remotesConnected) return;

		ipcRenderer.send("update-plan-data", {
			blocks: this.lessonManager.getAllBlocks(),
			executionSteps: steps.map((step) => ({
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
