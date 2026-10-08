const { formatCodeForAutoTyping } = require("./code-formatter");

let copiedBlocks = [];

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
		return this.copyBlocks([index]);
	}

	copyBlocks(indices) {
		const blocks = indices.map((i) => this.lessonManager.getBlock(i));
		if (
			!blocks.length ||
			blocks.some((b) => !b || b.fromInclude || b.type === "include")
		)
			return false;
		copiedBlocks = blocks.map((b) => JSON.parse(JSON.stringify(b)));
		if (this.uiManager.setHasCopiedBlock)
			this.uiManager.setHasCopiedBlock(true);
		return true;
	}

	hasCopiedBlock() {
		return copiedBlocks.length > 0;
	}

	pasteBlock(afterIndex) {
		if (!copiedBlocks.length) return null;
		this._checkpoint("paste-block");

		const pasted = copiedBlocks.map((block, k) =>
			this.lessonManager.insertBlockCopy(block, afterIndex + k),
		);
		const at = pasted[0];
		if (pasted.length === 1) this.uiManager.selectBlock(at);
		else this.uiManager.selectBlocks(pasted, at);
		this.lessonRenderer.render();
		this.focusNewBlock(at);
		return at;
	}

	focusNewBlock(blockIdx) {
		this.uiManager.refocusBlock(blockIdx);
	}

	removeBlock(index) {
		const blockIdx =
			index === undefined ? this.uiManager.getSelectedBlockIndex() : index;
		if (blockIdx === null) return;
		this.removeBlocks([blockIdx]);
	}

	removeBlocks(indices) {
		if (!this.lessonManager.canRemoveBlocks(indices)) return;

		this._checkpoint("remove-block");

		this.lessonManager.removeBlocks(indices);
		this.uiManager.deselectBlock();
		const remaining = this.lessonManager.getAllBlocks().length;
		if (remaining > 0) {
			this.uiManager.selectBlock(Math.max(0, Math.min(...indices) - 1));
		}
		this.lessonRenderer.render();
	}

	moveBlock(index, delta) {
		this.moveBlocks([index], delta);
	}

	moveBlocks(indices, delta) {
		if (!this.lessonManager.canMoveBlocks(indices, delta)) return;

		this._checkpoint("move-block");

		this.lessonManager.moveBlocks(indices, delta);
		if (indices.length === 1) {
			this.uiManager.selectBlock(indices[0] + delta);
		} else {
			const primary = this.uiManager.getSelectedBlockIndex();
			const moved = indices.map((i) => i + delta);
			this.uiManager.selectBlocks(
				moved,
				indices.includes(primary) ? primary + delta : moved[0],
			);
		}
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
