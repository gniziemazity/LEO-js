const EventEmitter = require("events");
const { TIMER_CONFIG } = require("../shared/constants");

class MainProcessTimer extends EventEmitter {
	constructor() {
		super();
		this.endTime = null;
		this.interval = null;
	}

	start(minutes = TIMER_CONFIG.DEFAULT_MINUTES) {
		if (this.interval) this.stop(false);
		this.endTime = Date.now() + minutes * 60 * 1000;
		this.interval = setInterval(() => this.tick(), 1000);
		this.tick();
	}

	stop(emit = true) {
		if (this.interval) {
			clearInterval(this.interval);
			this.interval = null;
		}
		this.endTime = null;
		if (emit) this.emit("stopped");
	}

	adjust(minutes) {
		if (!this.endTime) return;
		this.endTime += minutes * 60 * 1000;
		if (this.getRemainingSeconds() <= 0) {
			this.stop();
		} else {
			this.tick();
		}
	}

	tick() {
		const remaining = this.getRemainingSeconds();
		if (remaining <= 0) {
			this.stop();
			return;
		}
		this.emit("tick", remaining);
	}

	getRemainingSeconds() {
		if (!this.endTime) return 0;
		return Math.max(0, Math.floor((this.endTime - Date.now()) / 1000));
	}

	isRunning() {
		return this.interval !== null;
	}
}

module.exports = MainProcessTimer;
