class AppState {
	constructor() {
		this.mainWindow = null;
		this.isLocked = false;
		this.isActive = false;
		this.isPaused = false;
		this.isAutoTyping = false;
		this.lockQueue = [];
	}

	reset() {
		this.isLocked = false;
		this.isActive = false;
		this.isPaused = false;
		this.isAutoTyping = false;
		this.lockQueue = [];
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

	queueKey(key) {
		this.lockQueue.push(key);
	}

	dequeueKey() {
		return this.lockQueue.shift();
	}

	hasQueuedKeys() {
		return this.lockQueue.length > 0;
	}

	clearQueue() {
		this.lockQueue = [];
	}
}

const state = new AppState();

module.exports = state;
