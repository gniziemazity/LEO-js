const { formatCodeForAutoTyping } = require("./code-formatter");
const UIManager = require("./ui-manager");

let copiedBlock = null;

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

	copyBlock(index) {
		const block = this.lessonManager.getBlock(index);
		if (!block || block.fromInclude || block.type === "include") return false;
		copiedBlock = JSON.parse(JSON.stringify(block));
		if (this.uiManager.setHasCopiedBlock)
			this.uiManager.setHasCopiedBlock(true);
		return true;
	}

	hasCopiedBlock() {
		return copiedBlock !== null;
	}

	pasteBlock(afterIndex) {
		if (!copiedBlock) return null;
		this._checkpoint("paste-block");

		const at = this.lessonManager.insertBlockCopy(copiedBlock, afterIndex);
		this.uiManager.selectBlock(at);
		this.lessonRenderer.render();
		this.focusNewBlock(at);
		return at;
	}

	focusNewBlock(blockIdx) {
		setTimeout(() => {
			const blocks = document.querySelectorAll(".block");
			const target = blocks[blockIdx];
			if (target && target.contentEditable !== "false") {
				target.focus();
				UIManager.putCaret(target, null);
			}
		}, 0);
	}

	removeBlock(index) {
		const blockIdx =
			index === undefined ? this.uiManager.getSelectedBlockIndex() : index;
		if (blockIdx === null) return;
		if (!this.lessonManager.canRemoveBlock(blockIdx)) return;

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

	setKind(index, kind) {
		if (!this.lessonManager.canSetBlockKind(index, kind)) return;

		this._checkpoint("change-block-type");

		this.lessonManager.setBlockKind(index, kind);
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
		this.lessonManager.updateBlockBody(blockIdx, content);
	}
}

module.exports = BlockEditor;
