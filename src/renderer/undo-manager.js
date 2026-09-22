function cloneBlock(block) {
	if (block === null || typeof block !== "object") return block;
	const copy = {};
	for (const key of Object.keys(block)) {
		const value = block[key];
		copy[key] =
			value !== null && typeof value === "object"
				? JSON.parse(JSON.stringify(value))
				: value;
	}
	return copy;
}

function clone(blocks) {
	return Array.isArray(blocks) ? blocks.map(cloneBlock) : blocks;
}

class UndoManager {
	constructor(lessonManager) {
		this.lessonManager = lessonManager;
		this.undoStack = [];
		this.redoStack = [];
		this.maxStackSize = 100;
		this.isUndoing = false;
		this.isRedoing = false;
	}

	saveState(actionType = "unknown") {
		if (this.isUndoing || this.isRedoing) {
			return;
		}

		const state = {
			data: clone(this.lessonManager.getAllBlocks()),
			actionType: actionType,
			timestamp: Date.now(),
		};

		this.undoStack.push(state);

		if (this.undoStack.length > this.maxStackSize) {
			this.undoStack.shift();
		}

		this.redoStack = [];
	}

	undo() {
		return this.step(this.undoStack, this.redoStack, "isUndoing");
	}

	redo() {
		return this.step(this.redoStack, this.undoStack, "isRedoing");
	}

	step(from, to, flag) {
		if (from.length === 0) {
			return false;
		}

		this[flag] = true;

		to.push({
			data: clone(this.lessonManager.getAllBlocks()),
			timestamp: Date.now(),
		});

		const target = from.pop();

		this.lessonManager.data = clone(target.data);
		this.lessonManager.markAsChanged();

		this[flag] = false;
		return true;
	}

	clear() {
		this.undoStack = [];
		this.redoStack = [];
	}
}

module.exports = UndoManager;
