const { getBlockKind, kindClass, MOVE_TO_KIND } = require("../shared/blocks");

function blockKindOf(block) {
	if (block.type === "comment") return getBlockKind(block.text);
	if (block.type === MOVE_TO_KIND) return MOVE_TO_KIND;
	return block.type;
}

class UIManager {
	constructor() {
		this.elements = {};
		this.isTypingActive = false;
		this.selectedBlockIndex = null;
	}

	cacheElements() {
		this.elements = {
			toggleBtn: document.getElementById("toggleBtn"),
			generateArtificialLogBtn: document.getElementById(
				"generateArtificialLogBtn",
			),
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
			this.elements.toggleBtn.classList.add("interaction-btn");
			this.elements.editorSidebar.classList.add("hidden");
			if (this.elements.generateArtificialLogBtn)
				this.elements.generateArtificialLogBtn.classList.add("hidden");
			document.body.classList.add("typing-active");
		} else {
			this.elements.toggleBtn.textContent = "▶︎";
			this.elements.toggleBtn.title = "Start Auto-typing";
			this.elements.toggleBtn.classList.remove("btn-stop");
			this.elements.toggleBtn.classList.add("btn-start");
			this.elements.toggleBtn.classList.add("interaction-btn");
			this.elements.editorSidebar.classList.remove("hidden");
			if (this.elements.generateArtificialLogBtn)
				this.elements.generateArtificialLogBtn.classList.remove("hidden");
			document.body.classList.remove("typing-active");
		}
	}

	updateProgressBar(percentage) {
		this.elements.progressBar.style.width = percentage + "%";
	}

	clearLessonContainer() {
		this.elements.lessonContainer.innerHTML = "";
	}

	selectBlock(index) {
		this.selectedBlockIndex = index;
		this.elements.editorSidebar.classList.remove("hidden");
	}

	deselectBlock() {
		this.selectedBlockIndex = null;
		this.elements.editorSidebar.classList.add("hidden");
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

		if (block.type === "comment") {
			blockDiv.dataset.placeholder = "Type note here";
		} else if (block.type === "code") {
			blockDiv.dataset.placeholder = "Type code here";
		}

		if (this.selectedBlockIndex === blockIdx) {
			blockDiv.classList.add("selected");
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
		wrap.dataset.blockOpt = "1";
		wrap.contentEditable = "false";
		const input = document.createElement("input");
		input.type = "checkbox";
		input.checked = checked;
		input.disabled = disabled;
		wrap.appendChild(input);
		wrap.appendChild(document.createTextNode(label));
		for (const type of ["mousedown", "click", "input", "change", "keydown"])
			wrap.addEventListener(type, (e) => e.stopPropagation());
		input.addEventListener("change", () => onChange(input.checked));
		return wrap;
	}

	createBlockTool({ glyph, title, disabled, onClick, className }) {
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = className ? `block-tool ${className}` : "block-tool";
		btn.textContent = glyph;
		btn.title = title;
		btn.disabled = !!disabled;
		UIManager.sealIsland(btn);
		btn.addEventListener("click", () => {
			if (!btn.disabled) onClick(btn);
		});
		return btn;
	}

	attachBlockIsland(blockDiv, { option, tools } = {}) {
		if (!option && (!tools || !tools.length)) return null;
		if (blockDiv.contentEditable === "true" && !blockDiv.firstChild) {
			blockDiv.appendChild(document.createElement("br"));
		}
		const island = document.createElement("div");
		island.className = "block-opt";
		UIManager.sealIsland(island);
		if (option) island.appendChild(this.createBlockOption(option));
		for (const tool of tools || []) {
			island.appendChild(this.createBlockTool(tool));
		}
		blockDiv.appendChild(island);
		return island;
	}

	attachBlockOption(blockDiv, option) {
		return this.attachBlockIsland(blockDiv, { option });
	}

	removeCursorClasses() {
		document
			.querySelectorAll(".cursor")
			.forEach((el) => el.classList.remove("cursor"));
		document
			.querySelectorAll(".active-block")
			.forEach((el) => el.classList.remove("active-block"));
	}

	populateSpecialKeys(keys, onKeyClick) {
		this.elements.specialKeysContainer.innerHTML = "";

		Object.keys(keys).forEach((char) => {
			const btn = document.createElement("button");
			btn.className = "key-btn";
			btn.textContent = char;
			btn.title = keys[char];
			btn.dataset.char = char;
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
