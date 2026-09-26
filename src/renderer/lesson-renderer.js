const { ipcRenderer } = require("electron");

const {
	getBlockKind,
	isMultilineSnippet,
	kindClass,
	SUPPORT_KINDS,
	collapsedLabel,
	startingCodeLabel,
	stripBlockPrefix,
} = require("../shared/blocks");
const { computeMoveToSnippets } = require("./anchor-snippet");
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
const { addChoices, kindChoices, kindGlyph } = require("./block-types");

const EDIT_BURST_IDLE_MS = 1000;

const BLOCK_RENDERERS = {
	comment: "renderKindBlock",
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
		this.lastEditedBlockIndex = null;
		this.lastEditTime = 0;
		this.expandedIncludes = new Set();
		this.startCollapsed = true;
		this._moveToSnippets = new Map();
		this.onRendered = null;
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
		this.expandedIncludes.clear();
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
		const isTypingActive = this.uiManager.isActive();

		this.uiManager.clearLessonContainer();
		this.uiManager.setStartCollapsed(this.startCollapsed);
		const executionSteps = [];
		let globalStepCounter = 0;

		const blocks = this.lessonManager.getAllBlocks();
		this._moveToSnippets = computeMoveToSnippets(blocks);

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

		this._syncSidebar();

		this.cursorManager.setExecutionSteps(executionSteps);

		if (isTypingActive) {
			this.cursorManager.updateCursor();
		}

		this.broadcastLessonData(executionSteps);
		if (this.onRendered) this.onRendered();
	}

	_syncSidebar() {
		const selected = this.uiManager.getSelectedBlockIndex();
		const block =
			selected === null ? null : this.lessonManager.getAllBlocks()[selected];
		const authored = !!block && !block.fromInclude;
		const codeSelected = authored && block.type === "code";
		const snippetSelected =
			authored &&
			block.type === "comment" &&
			getBlockKind(block.text) === "snippet";
		this.uiManager.setSidebarEnabled(
			codeSelected ||
				snippetSelected ||
				(!this.startCollapsed && this.expandedIncludes.size > 0),
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

	_kindPicker(block, blockIdx, isTypingActive) {
		const kind = this._kindOf(block);
		return {
			glyph: kindGlyph(kind),
			title: "Change block type",
			disabled: isTypingActive,
			onClick: (btn) =>
				openDropdown({
					anchorEl: btn,
					blockIdx,
					value: kind,
					options: kindChoices().map((c) => ({
						value: c.kind,
						label: `${c.glyph} ${c.label}`,
					})),
					listClass: "bt-options",
					itemClass: "bt-option",
					onPick: (v) =>
						this.blockEditor && this.blockEditor.setKind(blockIdx, v),
				}),
		};
	}

	_attachKind(blockDiv, block, blockIdx, isTypingActive) {
		if (!this._hasControls(block)) return;
		this.uiManager.attachKindPicker(
			blockDiv,
			this._kindPicker(block, blockIdx, isTypingActive),
		);
	}

	_kindOf(block) {
		if (block.type === "move-to") return "move-to";
		if (block.type === "code") return "code";
		return getBlockKind(block.text);
	}

	_hasControls(block) {
		return !block.fromInclude && block.type !== "include";
	}

	_addTools(after, where) {
		return addChoices().map((c, i) => ({
			glyph: `+${c.glyph}`,
			title: `Add a ${c.label.toLowerCase()} block ${where} (Ctrl+${i + 1})`,
			className: `block-tool-add block-tool-hover ${where}`,
			dataset: { addKind: c.kind },
			onClick: () =>
				this.blockEditor &&
				this.blockEditor.addBlock(c.type, c.initialText || null, after),
		}));
	}

	_pasteTool(after, where) {
		return {
			glyph: "📥",
			title: `Paste the copied block ${where} (Ctrl+Shift+V)`,
			className: `block-tool-paste block-tool-hover ${where}`,
			onClick: () => this.blockEditor && this.blockEditor.pasteBlock(after),
		};
	}

	_addRow(block, blockIdx, isTypingActive, where) {
		if (isTypingActive || !this._hasControls(block)) return [];
		const above = where === "above";
		const delta = above ? -1 : 1;
		const after = above ? blockIdx - 1 : blockIdx;
		return [
			...this._addTools(after, where),
			this._pasteTool(after, where),
			{
				glyph: above ? "▲" : "▼",
				title: above
					? "Move this block up (Ctrl+Up)"
					: "Move this block down (Ctrl+Down)",
				className: "block-tool-hover",
				disabled: !this.lessonManager.canMoveBlock(blockIdx, delta),
				onClick: () =>
					this.blockEditor && this.blockEditor.moveBlock(blockIdx, delta),
			},
		];
	}

	_blockTools(block, blockIdx, isTypingActive) {
		if (isTypingActive || !this._hasControls(block)) return [];

		return [
			{
				glyph: "⧉",
				title: "Copy this block (Ctrl+Shift+C)",
				className: "block-tool-hover",
				onClick: () =>
					this.blockEditor && this.blockEditor.copyBlock(blockIdx),
			},
			{
				glyph: "🗑️",
				title: "Delete this block (Ctrl+D)",
				className: "block-tool-remove block-tool-hover",
				disabled: !this.lessonManager.canRemoveBlock(blockIdx),
				onClick: () =>
					this.blockEditor && this.blockEditor.removeBlock(blockIdx),
			},
		];
	}

	_optionFor(block, blockIdx, isTypingActive) {
		if (block.fromInclude) return null;
		const option = (label, checked, key, byDefault) =>
			this._blockOption({
				label,
				checked,
				disabled: isTypingActive,
				blockIdx,
				key,
				byDefault,
			});
		if (block.type === "comment") {
			const kind = getBlockKind(block.text);
			if (kind === "snippet") {
				return option("Show Paste", block.paste !== false, "paste", true);
			}
			if (kind === "image" || kind === "web") {
				return option("Pin window", block.pin === true, "pin", false);
			}
		}
		if (block.type === "move-to" && this._createsFile(block, blockIdx)) {
			return option("Auto-type", block.typeName !== false, "typeName", true);
		}
		return null;
	}

	_createsFile(block, blockIdx) {
		return (
			classifyMoveToTarget(block.target || "MAIN").mode === "file" &&
			this.lessonManager.isFirstMoveToFile(blockIdx)
		);
	}

	_attachIsland(blockDiv, block, blockIdx, isTypingActive) {
		this.uiManager.attachBlockIsland(blockDiv, {
			tools: this._addRow(block, blockIdx, isTypingActive, "above"),
			className: "block-opt-above",
		});
		const island = this.uiManager.attachBlockIsland(blockDiv, {
			option: this._optionFor(block, blockIdx, isTypingActive),
			tools: this._blockTools(block, blockIdx, isTypingActive),
		});
		this.uiManager.attachBlockIsland(blockDiv, {
			tools: this._addRow(block, blockIdx, isTypingActive, "below"),
			className: "block-opt-below",
		});
		this._attachKind(blockDiv, block, blockIdx, isTypingActive);
		return island;
	}

	_onFoldArrow(e) {
		const el = e && e.currentTarget;
		if (!el || typeof e.clientX !== "number") return false;
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		let node;
		while ((node = walker.nextNode())) {
			if (node.length && !node.parentElement.closest("[data-block-opt]"))
				break;
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

	_caretOffset(el) {
		const sel = window.getSelection();
		if (!sel || !sel.rangeCount) return null;
		const range = sel.getRangeAt(0);
		if (!el.contains(range.endContainer)) return null;
		const before = document.createRange();
		before.selectNodeContents(el);
		before.setEnd(range.endContainer, range.endOffset);
		return before.toString().length;
	}

	caretFocus() {
		if (this.uiManager.isActive()) return null;
		const active = document.activeElement;
		const blockEl =
			active && active.closest ? active.closest(".block") : null;
		if (!blockEl) return null;
		const index = [...document.querySelectorAll(".block")].indexOf(blockEl);
		const block = this.lessonManager.getAllBlocks()[index];
		if (!block || block.fromInclude || block.type === "include") return null;
		const sel = window.getSelection();
		if (
			block.type !== "code" ||
			!sel ||
			!sel.rangeCount ||
			!blockEl.contains(sel.focusNode)
		) {
			return { index, caret: null };
		}
		const before = document.createRange();
		before.selectNodeContents(blockEl);
		before.setEnd(sel.focusNode, sel.focusOffset);
		const holder = document.createElement("div");
		holder.appendChild(before.cloneContents());
		return { index, caret: readCodeText(holder).length };
	}

	_caretAtBodyStart(el) {
		const sel = window.getSelection();
		if (!sel || !sel.rangeCount || !sel.isCollapsed) return false;
		const range = sel.getRangeAt(0);
		if (!el.contains(range.endContainer)) return false;
		const before = document.createRange();
		before.selectNodeContents(el);
		before.setEnd(range.endContainer, range.endOffset);
		const fragment = before.cloneContents();
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
			if (node.parentElement.closest("[data-block-opt]")) continue;
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
			el.querySelector(":scope > .block-kind")
		)
			return;
		this.refreshIsland(blockIdx);
	}

	refreshIsland(blockIdx) {
		if (blockIdx === null || blockIdx === undefined) return;
		const el = document.querySelectorAll(".block")[blockIdx];
		const block = this.lessonManager.getAllBlocks()[blockIdx];
		if (!el || !block) return;
		for (const old of el.querySelectorAll(
			":scope > .block-opt, :scope > .block-kind",
		))
			old.remove();
		this._attachIsland(el, block, blockIdx, this.uiManager.isActive());
	}

	_syncEmpty(el, text) {
		if (text) el.classList.remove("is-empty");
		else el.classList.add("is-empty");
	}

	renderKindBlock(ctx) {
		const { blockDiv, block, blockIdx, isTypingActive, stepIndex, steps } =
			ctx;
		const kind = getBlockKind(block.text);

		const selectedBlockIndex = this.uiManager.getSelectedBlockIndex();
		const isMultilineInsert = isMultilineSnippet(block.text);
		const isExpanded =
			isMultilineInsert &&
			!isTypingActive &&
			(block.fromInclude
				? this.expandedIncludes.has(blockIdx)
				: selectedBlockIndex === blockIdx);

		const shown = this._hasControls(block)
			? stripBlockPrefix(block.text)
			: block.text;

		if (isMultilineInsert && !isExpanded) {
			blockDiv.contentEditable = "false";
			blockDiv.textContent = collapsedLabel(shown);
			blockDiv.dataset.fullText = block.text;
			blockDiv.classList.add("collapsed");
		} else {
			blockDiv.contentEditable =
				!isTypingActive && (!block.fromInclude || !!block.startFile);
			blockDiv.textContent = shown;
			delete blockDiv.dataset.fullText;
		}

		this._syncEmpty(blockDiv, shown);
		this._attachIsland(blockDiv, block, blockIdx, isTypingActive);

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
			const kind = getBlockKind(current.text);
			blockDiv.classList.remove(...SUPPORT_KINDS.map(kindClass));
			blockDiv.classList.add(kindClass(kind));
			const picker = blockDiv.querySelector(":scope > .block-kind");
			if (picker) picker.textContent = kindGlyph(kind);
		};

		this.attachEditHandlers(blockDiv, kind === "snippet");

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
			this._attachIsland(blockDiv, block, blockIdx, isTypingActive);
			return stepIndex;
		} else {
			blockDiv.contentEditable = "false";

			stepIndex = buildCodeText(block.text, blockDiv, stepIndex, (step) =>
				steps.push({ ...step, blockIndex: blockIdx }),
			);
			this._syncEmpty(blockDiv, block.text);
			this._attachIsland(blockDiv, block, blockIdx, isTypingActive);

			steps.push({
				type: "block",
				kind: "code",
				element: blockDiv,
				blockIndex: blockIdx,
				globalIndex: stepIndex,
			});

			blockDiv.dataset.stepIndex = stepIndex;
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

	renderMoveToBlock(ctx) {
		const { blockDiv, block, blockIdx, isTypingActive, stepIndex, steps } =
			ctx;
		blockDiv.contentEditable = "false";
		const target = block.target || "MAIN";
		blockDiv.dataset.target = target;

		if (!this._hasControls(block)) {
			const arrow = document.createElement("span");
			arrow.className = "move-to-arrow";
			arrow.textContent = "➡️ ";
			blockDiv.appendChild(arrow);
		}

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

		const creates = this._createsFile(block, blockIdx);
		this._attachIsland(blockDiv, block, blockIdx, isTypingActive);

		steps.push({
			type: "block",
			kind: "move-to",
			fromInclude: !!block.fromInclude,
			target,
			note: block.note || "",
			typeName: creates && block.typeName !== false,
			snippet: this._moveToSnippets.get(blockIdx) || null,
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
		if (block.type === "include") {
			if (block.dir) this.toggleStartCollapsed();
			return;
		}
		if (block.fromInclude) {
			if (this.uiManager.isActive() || !this.isMultilineSnippet(blockIdx))
				return;
			const openStartFile =
				!!block.startFile && this.expandedIncludes.has(blockIdx);
			if (openStartFile ? this._onFoldArrow(e) : !this._isScrollbarClick(e))
				this.toggleIncludeExpanded(blockIdx);
			return;
		}
		if (this.uiManager.isActive()) {
			this._handleClickWhileTyping(e, block, blockIdx);
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
			if (
				node.parentElement &&
				node.parentElement.closest("[data-block-opt]")
			) {
				continue;
			}
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
			const target = document.querySelectorAll(".block")[blockIdx];
			if (target && caretOffset !== null) {
				target.focus();
				this._placeCaret(target, caretOffset);
			} else {
				this.uiManager.focusBlock(blockIdx, clickX, clickY);
			}
		}, 0);
	}

	_handleClickWhileEditing(e, block, blockIdx) {
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
		if (executionSteps) this._lastBroadcastSteps = executionSteps;
		const steps = executionSteps || this._lastBroadcastSteps;
		if (!steps) return;
		if (!this.uiManager.remotesConnected) return;

		ipcRenderer.send("update-lesson-data", {
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
