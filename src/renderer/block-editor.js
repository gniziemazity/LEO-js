const { formatCodeForAutoTyping } = require("./code-formatter");

class BlockEditor {
	constructor(lessonManager, uiManager, lessonRenderer, undoManager = null) {
		this.lessonManager = lessonManager;
		this.uiManager = uiManager;
		this.lessonRenderer = lessonRenderer;
		this.undoManager = undoManager;
	}

	addBlock(type, initialText) {
		if (this.undoManager) {
			this.undoManager.saveState(`add-${type}-block`);
		}

		const selectedBlockIndex = this.uiManager.getSelectedBlockIndex();
		const newBlockIdx =
			(selectedBlockIndex === null ? -1 : selectedBlockIndex) + 1;
		this.lessonManager.addBlock(type, selectedBlockIndex, initialText);
		this.uiManager.selectBlock(newBlockIdx);
		this.lessonRenderer.render();
		this.focusNewBlock(newBlockIdx);
	}

	focusNewBlock(blockIdx) {
		setTimeout(() => {
			const blocks = document.querySelectorAll(".block");
			const target = blocks[blockIdx];
			if (target && target.contentEditable !== "false") {
				target.focus();
				const range = document.createRange();
				const sel = window.getSelection();
				range.selectNodeContents(target);
				range.collapse(false);
				sel.removeAllRanges();
				sel.addRange(range);
			}
		}, 0);
	}

	removeBlock() {
		const selectedBlockIndex = this.uiManager.getSelectedBlockIndex();
		if (selectedBlockIndex === null) return;

		if (this.undoManager) {
			this.undoManager.saveState("remove-block");
		}

		this.lessonManager.removeBlock(selectedBlockIndex);
		this.uiManager.deselectBlock();
		this.uiManager.selectBlock(selectedBlockIndex - 1);
		this.lessonRenderer.render();
	}

	formatBlock() {
		const selectedBlockIndex = this.uiManager.getSelectedBlockIndex();
		if (selectedBlockIndex === null) return;

		const block = this.lessonManager.getBlock(selectedBlockIndex);
		if (!block || block.type !== "code") return;

		if (this.undoManager) {
			this.undoManager.saveState("format-block");
		}

		const formatted = formatCodeForAutoTyping(block.text);
		this.lessonManager.updateBlock(selectedBlockIndex, formatted);
		this.lessonRenderer.render();
	}

	updateBlockContent(blockIdx, content) {
		this.lessonManager.updateBlock(blockIdx, content);
	}
}

module.exports = BlockEditor;
