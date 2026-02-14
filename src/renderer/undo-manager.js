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
			data: JSON.parse(JSON.stringify(this.lessonManager.getAllBlocks())),
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
		if (this.undoStack.length === 0) {
			return false;
		}

		this.isUndoing = true;

		const currentState = {
			data: JSON.parse(JSON.stringify(this.lessonManager.getAllBlocks())),
			timestamp: Date.now(),
		};
		this.redoStack.push(currentState);

		const previousState = this.undoStack.pop();

		this.lessonManager.data = JSON.parse(JSON.stringify(previousState.data));
		this.lessonManager.markAsChanged();

		this.isUndoing = false;
		return true;
	}

	redo() {
		if (this.redoStack.length === 0) {
			return false;
		}

		this.isRedoing = true;

		const currentState = {
			data: JSON.parse(JSON.stringify(this.lessonManager.getAllBlocks())),
			timestamp: Date.now(),
		};
		this.undoStack.push(currentState);

		const nextState = this.redoStack.pop();

		this.lessonManager.data = JSON.parse(JSON.stringify(nextState.data));
		this.lessonManager.markAsChanged();

		this.isRedoing = false;
		return true;
	}

	canUndo() {
		return this.undoStack.length > 0;
	}

	canRedo() {
		return this.redoStack.length > 0;
	}

	clear() {
		this.undoStack = [];
		this.redoStack = [];
	}

	getUndoStackSize() {
		return this.undoStack.length;
	}

	getRedoStackSize() {
		return this.redoStack.length;
	}
}

module.exports = UndoManager;
