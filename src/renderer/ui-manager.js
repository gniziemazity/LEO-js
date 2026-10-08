const { getBlockKind, kindClass, MOVE_TO_KIND } = require("../shared/blocks");
const { KIND_PLACEHOLDERS } = require("./block-types");

function blockKindOf(block) {
	if (block.type === "comment") return getBlockKind(block.text);
	if (block.type === MOVE_TO_KIND) return MOVE_TO_KIND;
	return block.type;
}

class UIManager {
	constructor() {
		this.elements = {};
		this.isTypingActive = false;
		this.remotesConnected = false;
		this.selectedBlockIndex = null;
		this.selectedIndices = new Set();
		this.selectionAnchor = null;
		this.sidebarEnabled = false;
	}

	cacheElements() {
		this.elements = {
			toggleBtn: document.getElementById("toggleBtn"),
			progressBar: document.getElementById("progressBar"),
			lessonContainer: document.getElementById("lesson-container"),
			editorSidebar: document.getElementById("editor-sidebar"),
			specialKeysContainer: document.getElementById(
				"special-keys-container",
			),
		};
	}

	setTypingActive(active) {
		this.isTypingActive = active;

		if (active) {
			this.elements.toggleBtn.textContent = "❚❚";
			this.elements.toggleBtn.title = "Stop Auto-typing";
			this.elements.toggleBtn.classList.remove("btn-start");
			this.elements.toggleBtn.classList.add("btn-stop");
			this.elements.editorSidebar.classList.add("hidden");
			document.body.classList.add("typing-active");
		} else {
			this.elements.toggleBtn.textContent = "▶︎";
			this.elements.toggleBtn.title = "Start Auto-typing";
			this.elements.toggleBtn.classList.remove("btn-stop");
			this.elements.toggleBtn.classList.add("btn-start");
			this.elements.editorSidebar.classList.remove("hidden");
			document.body.classList.remove("typing-active");
		}
	}

	setRemotesConnected(connected) {
		this.remotesConnected = !!connected;
	}

	updateProgressBar(percentage) {
		this.elements.progressBar.style.width = percentage + "%";
	}

	clearLessonContainer() {
		this.elements.lessonContainer.innerHTML = "";
	}

	setStartCollapsed(collapsed) {
		this.elements.lessonContainer.classList.toggle(
			"start-collapsed",
			!!collapsed,
		);
	}

	selectBlock(index) {
		this.selectedBlockIndex = index;
		this.selectedIndices = new Set(index === null ? [] : [index]);
		this.selectionAnchor = index;
	}

	deselectBlock() {
		this.selectBlock(null);
	}

	selectBlocks(indices, primary) {
		this.selectedIndices = new Set(indices);
		this.selectedBlockIndex = primary;
		this.selectedIndices.add(primary);
		this.selectionAnchor = primary;
	}

	toggleInSelection(index) {
		if (this.selectedBlockIndex === null) {
			this.selectBlock(index);
			return;
		}
		this.selectionAnchor = index;
		if (!this.selectedIndices.has(index)) {
			this.selectedIndices.add(index);
			this.selectedBlockIndex = index;
			return;
		}
		if (this.selectedIndices.size === 1) return;
		this.selectedIndices.delete(index);
		if (this.selectedBlockIndex !== index) return;
		const rest = [...this.selectedIndices].sort((a, b) => a - b);
		const below = rest.filter((i) => i < index);
		this.selectedBlockIndex = below.length
			? below[below.length - 1]
			: rest[0];
	}

	selectRange(index, floor) {
		const from = this.selectionAnchor !== null ? this.selectionAnchor : index;
		const lo = Math.max(floor, Math.min(from, index));
		const hi = Math.max(from, index);
		this.selectedIndices = new Set();
		for (let i = lo; i <= hi; i++) this.selectedIndices.add(i);
		this.selectedBlockIndex = index;
	}

	collapseSelection() {
		const primary = this.selectedBlockIndex;
		this.selectedIndices = new Set(primary === null ? [] : [primary]);
		this.selectionAnchor = primary;
	}

	getSelectedBlockIndices() {
		return [...this.selectedIndices].sort((a, b) => a - b);
	}

	isMultiSelected() {
		return this.selectedIndices.size > 1;
	}

	setSidebarEnabled(enabled, formatEnabled = enabled) {
		this.sidebarEnabled = !!enabled;
		const sidebar = this.elements.editorSidebar;
		if (!sidebar) return;
		sidebar.querySelectorAll("button").forEach((btn) => {
			btn.disabled = !this.sidebarEnabled;
		});
		const format = sidebar.querySelector("#formatBtn");
		if (format) format.disabled = !formatEnabled;
	}

	getSelectedBlockIndex() {
		return this.selectedBlockIndex;
	}

	isActive() {
		return this.isTypingActive;
	}

	createBlockElement(block, blockIdx) {
		const blockDiv = document.createElement("div");
		blockDiv.className = `block ${kindClass(blockKindOf(block))}`;

		const placeholder =
			block.placeholder || KIND_PLACEHOLDERS[blockKindOf(block)];
		if (placeholder) blockDiv.dataset.placeholder = placeholder;

		if (this.selectedBlockIndex === blockIdx) {
			blockDiv.classList.add("selected");
		} else if (this.selectedIndices.has(blockIdx)) {
			blockDiv.classList.add("multi-selected");
		}

		if (block.fromInclude) {
			blockDiv.classList.add("from-include");
		}

		return blockDiv;
	}

	appendToLessonContainer(element) {
		this.elements.lessonContainer.appendChild(element);
	}

	static sealIsland(el) {
		el.dataset.blockOpt = "1";
		el.contentEditable = "false";
		for (const type of ["mousedown", "click", "input", "change", "keydown"])
			el.addEventListener(type, (e) => e.stopPropagation());
		return el;
	}

	createBlockOption({ label, checked, disabled, onChange }) {
		const wrap = document.createElement("label");
		wrap.className = "block-opt-check";
		const input = document.createElement("input");
		input.type = "checkbox";
		input.checked = checked;
		input.disabled = disabled;
		wrap.appendChild(input);
		wrap.appendChild(document.createTextNode(label));
		UIManager.sealIsland(wrap);
		input.addEventListener("change", () => onChange(input.checked));
		return wrap;
	}

	setHasCopiedBlock(has) {
		document.body.classList.toggle("has-copied-block", !!has);
	}

	createBlockTool({ glyph, title, disabled, onClick, className, dataset }) {
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = className ? `block-tool ${className}` : "block-tool";
		btn.textContent = glyph;
		btn.title = title;
		btn.disabled = !!disabled;
		if (dataset) Object.assign(btn.dataset, dataset);
		UIManager.sealIsland(btn);
		btn.addEventListener("click", () => {
			if (!btn.disabled) onClick(btn);
		});
		return btn;
	}

	attachBlockIsland(blockDiv, { option, tools, className } = {}) {
		if (!option && (!tools || !tools.length)) return null;
		if (blockDiv.contentEditable === "true" && !blockDiv.firstChild) {
			blockDiv.appendChild(document.createElement("br"));
		}
		const island = document.createElement("div");
		island.className = className ? `block-opt ${className}` : "block-opt";
		UIManager.sealIsland(island);
		if (option) island.appendChild(this.createBlockOption(option));
		for (const tool of tools || []) {
			island.appendChild(this.createBlockTool(tool));
		}
		const last = blockDiv.lastChild;
		if (last && last.nodeName === "BR") blockDiv.insertBefore(island, last);
		else blockDiv.appendChild(island);
		return island;
	}

	attachKindPicker(blockDiv, { glyph, title, disabled, onClick }) {
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "block-kind";
		btn.textContent = glyph;
		btn.title = title;
		btn.disabled = !!disabled;
		UIManager.sealIsland(btn);
		btn.addEventListener("click", () => {
			if (!btn.disabled) onClick(btn);
		});
		blockDiv.classList.add("has-kind");
		blockDiv.insertBefore(btn, blockDiv.firstChild);
		return btn;
	}

	populateSpecialKeys(keys, onKeyClick) {
		this.elements.specialKeysContainer.innerHTML = "";

		Object.keys(keys).forEach((char) => {
			const btn = document.createElement("button");
			btn.className = "key-btn";
			btn.textContent = char;
			btn.title = keys[char];
			btn.dataset.char = char;
			btn.disabled = !this.sidebarEnabled;
			btn.onclick = () => onKeyClick(char);
			this.elements.specialKeysContainer.appendChild(btn);
		});
	}

	static isIsland(node) {
		if (!node) return false;
		const el = node.nodeType === 1 ? node : node.parentElement;
		return !!(el && el.closest && el.closest("[data-block-opt]"));
	}

	static caretAtTextEnd(el) {
		const text = [...el.childNodes].filter((n) => !UIManager.isIsland(n));
		const last = text[text.length - 1];
		const range = document.createRange();
		if (!last) {
			range.setStart(el, 0);
		} else if (last.nodeType === 3) {
			range.setStart(last, last.length);
		} else {
			range.selectNodeContents(last);
			range.collapse(false);
		}
		range.collapse(true);
		return range;
	}

	static putCaret(el, range) {
		const selection = window.getSelection();
		if (!selection) return;
		const safe =
			range && !UIManager.isIsland(range.startContainer)
				? range
				: UIManager.caretAtTextEnd(el);
		selection.removeAllRanges();
		selection.addRange(safe);
	}

	refocusBlock(blockIdx) {
		setTimeout(() => {
			const block = document.querySelectorAll(".block")[blockIdx];
			if (!block || block.contentEditable !== "true") return;
			block.focus();
			UIManager.putCaret(block, null);
		}, 0);
	}

	focusBlock(blockIdx, clickX, clickY) {
		setTimeout(() => {
			const blocks = document.querySelectorAll(".block");
			const targetBlock = blocks[blockIdx];
			if (targetBlock) {
				targetBlock.focus();
				UIManager.putCaret(
					targetBlock,
					document.caretRangeFromPoint(clickX, clickY),
				);
			}
		}, 0);
	}

	getElement(name) {
		return this.elements[name];
	}
}

module.exports = UIManager;
