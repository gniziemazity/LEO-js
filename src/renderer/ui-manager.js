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
			addCommentBtn: document.getElementById("addCommentBtn"),
			addQuestionCommentBtn: document.getElementById(
				"addQuestionCommentBtn",
			),
			addImageCommentBtn: document.getElementById("addImageCommentBtn"),
			addWebCommentBtn: document.getElementById("addWebCommentBtn"),
			addCodeInsertBlockBtn: document.getElementById(
				"addCodeInsertBlockBtn",
			),
			addMoveToBlockBtn: document.getElementById("addMoveToBlockBtn"),
			addCodeBtn: document.getElementById("addCodeBtn"),
			removeBlockBtn: document.getElementById("removeBlockBtn"),
			formatBlockBtn: document.getElementById("formatBlockBtn"),
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
		if (block.type === "move-to") {
			blockDiv.className = "block comment-block";
		} else {
			blockDiv.className = `block ${block.type}-block`;
		}

		if (block.type === "comment") {
			blockDiv.dataset.placeholder = "Type comment here";
		} else if (block.type === "code") {
			blockDiv.dataset.placeholder = "Type code here";
		}

		if (this.selectedBlockIndex === blockIdx) {
			blockDiv.classList.add("selected");
		}

		return blockDiv;
	}

	appendToLessonContainer(element) {
		this.elements.lessonContainer.appendChild(element);
	}

	removeCursorClasses() {
		document
			.querySelectorAll(".cursor")
			.forEach((el) => el.classList.remove("cursor"));
		document
			.querySelectorAll(".active-comment")
			.forEach((el) => el.classList.remove("active-comment"));
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

	focusBlock(blockIdx, clickX, clickY) {
		setTimeout(() => {
			const blocks = document.querySelectorAll(".block");
			const targetBlock = blocks[blockIdx];
			if (targetBlock) {
				targetBlock.focus();

				const range = document.caretRangeFromPoint(clickX, clickY);
				if (range) {
					const selection = window.getSelection();
					selection.removeAllRanges();
					selection.addRange(range);
				}
			}
		}, 0);
	}

	getElement(name) {
		return this.elements[name];
	}
}

module.exports = UIManager;
