const { formatCodeForAutoTyping } = require("./code-formatter");

class BlockEditor {
	constructor(lessonManager, uiManager, lessonRenderer, undoManager = null) {
		this.lessonManager = lessonManager;
		this.uiManager = uiManager;
		this.lessonRenderer = lessonRenderer;
		this.undoManager = undoManager;
	}

	_checkpoint(label) {
		if (this.lessonRenderer.endEditBurst) this.lessonRenderer.endEditBurst();
		if (this.undoManager) this.undoManager.saveState(label);
	}

	addBlock(type, initialText, afterIndex) {
		this._checkpoint(`add-${type}-block`);

		const after =
			afterIndex === undefined
				? this.uiManager.getSelectedBlockIndex()
				: afterIndex;
		const newBlockIdx = this.lessonManager.addBlock(type, after, initialText);
		this.uiManager.selectBlock(newBlockIdx);
		this.lessonRenderer.render();
		this.focusNewBlock(newBlockIdx);
		return newBlockIdx;
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

	removeBlock(index) {
		const blockIdx =
			index === undefined ? this.uiManager.getSelectedBlockIndex() : index;
		if (blockIdx === null) return;

		this._checkpoint("remove-block");

		this.lessonManager.removeBlock(blockIdx);
		this.uiManager.deselectBlock();
		const remaining = this.lessonManager.getAllBlocks().length;
		if (remaining > 0) {
			this.uiManager.selectBlock(Math.max(0, blockIdx - 1));
		}
		this.lessonRenderer.render();
	}

	moveBlock(index, delta) {
		if (!this.lessonManager.canMoveBlock(index, delta)) return;

		this._checkpoint("move-block");

		this.lessonManager.moveBlock(index, delta);
		this.uiManager.selectBlock(index + delta);
		this.lessonRenderer.render();
	}

	setSubtype(index, subtype) {
		if (!this.lessonManager.canSetBlockSubtype(index, subtype)) return;

		this._checkpoint("change-block-type");

		this.lessonManager.setBlockSubtype(index, subtype);
		this.lessonRenderer.render();
	}

	formatBlock(index) {
		const blockIdx =
			index === undefined ? this.uiManager.getSelectedBlockIndex() : index;
		if (blockIdx === null) return;

		const block = this.lessonManager.getBlock(blockIdx);
		if (!block || block.type !== "code") return;

		this._checkpoint("format-block");

		const formatted = formatCodeForAutoTyping(block.text);
		this.lessonManager.updateBlock(blockIdx, formatted);
		this.lessonRenderer.render();
	}

	updateBlockContent(blockIdx, content) {
		this.lessonManager.updateBlock(blockIdx, content);
	}
}

module.exports = BlockEditor;
