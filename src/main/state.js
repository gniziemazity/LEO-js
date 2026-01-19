class AppState {
  constructor() {
    this.mainWindow = null;
    this.isLocked = false;
    this.isActive = false;
    this.lockQueue = [];
  }

  reset() {
    this.isLocked = false;
    this.isActive = false;
    this.lockQueue = [];
  }

  lock() {
    this.isLocked = true;
  }

  unlock() {
    this.isLocked = false;
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

// singleton
const state = new AppState();

module.exports = state;