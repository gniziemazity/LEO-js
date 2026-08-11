class AppState {
	constructor() {
		this.mainWindow = null;
		this.isLocked = false;
		this.isActive = false;
		this.isPaused = false;
		this.isAutoTyping = false;
		this.advanceQueue = [];
		this.typeQueue = [];
	}

	reset() {
		this.isLocked = false;
		this.isActive = false;
		this.isPaused = false;
		this.isAutoTyping = false;
		this.clearQueue();
	}

	send(channel, ...args) {
		if (!this.mainWindow || this.mainWindow.isDestroyed()) return false;
		this.mainWindow.webContents.send(channel, ...args);
		return true;
	}

	lock() {
		this.isLocked = true;
	}

	unlock() {
		this.isLocked = false;
	}

	pause() {
		this.isPaused = true;
	}

	unpause() {
		this.isPaused = false;
	}

	startAutoTyping() {
		this.isAutoTyping = true;
	}

	stopAutoTyping() {
		this.isAutoTyping = false;
	}

	queueAdvance(key) {
		this.advanceQueue.push(key);
	}

	dequeueAdvance() {
		return this.advanceQueue.shift();
	}

	hasQueuedAdvances() {
		return this.advanceQueue.length > 0;
	}

	queueChar(char) {
		this.typeQueue.push(char);
	}

	dequeueChar() {
		return this.typeQueue.shift();
	}

	hasQueuedChars() {
		return this.typeQueue.length > 0;
	}

	clearQueue() {
		this.advanceQueue = [];
		this.typeQueue = [];
	}
}

const state = new AppState();

module.exports = state;
