const fs = require("fs");
const path = require("path");
const os = require("os");
const { LOG_CONFIG } = require("../shared/constants");

class LogManager {
	constructor() {
		this.keyPressLog = [];
		this.sessionStartTime = null;
		this.logFilePath = null;
		this.currentLessonPath = null;
		this.saveInterval = LOG_CONFIG.SAVE_INTERVAL;
	}

	initialize(lessonFilePath = null) {
		this.keyPressLog = [];
		this.sessionStartTime = Date.now();
		this.currentLessonPath = lessonFilePath;

		const { logsDir, basename } = this.getLogPaths(lessonFilePath);
		this.ensureLogsDirectory(logsDir);

		const timestamp = this.getTimestamp();
		this.logFilePath = path.join(
			logsDir,
			`${basename}_key_presses_${timestamp}.json`,
		);

		this.save();
	}

	getLogPaths(lessonFilePath) {
		if (lessonFilePath) {
			const dir = path.dirname(lessonFilePath);
			return {
				logsDir: path.join(dir, "logs"),
				basename: path.basename(lessonFilePath, ".json"),
			};
		} else {
			// fallback to temp directory
			return {
				logsDir: path.join(os.tmpdir(), "leo-logs"),
				basename: "unnamed_lesson",
			};
		}
	}

	ensureLogsDirectory(logsDir) {
		if (!fs.existsSync(logsDir)) {
			fs.mkdirSync(logsDir, { recursive: true });
		}
	}

	getTimestamp() {
		return new Date().toISOString().replace(/[:.]/g, "-");
	}

	addEntry(entry) {
		if (!this.sessionStartTime) {
			console.warn("LogManager not initialized. Call initialize() first.");
			return;
		}

		const logEntry = {
			timestamp: Date.now(),
			...entry,
		};

		this.keyPressLog.push(logEntry);

		// auto-save periodically
		if (this.keyPressLog.length % this.saveInterval === 0) {
			this.save();
		}
	}

	addInteraction(interactionType, info = null) {
		if (info) {
			this.addEntry({
				interaction: interactionType,
				info: info,
			});
		} else {
			this.addEntry({
				interaction: interactionType,
			});
		}
		this.save();
	}

	save() {
		if (!this.logFilePath) {
			console.warn("No log file path set. Cannot save.");
			return;
		}

		const logData = {
			lessonFile: this.currentLessonPath || "No file loaded",
			sessionStart: this.sessionStartTime,
			totalKeyPresses: this.keyPressLog.length,
			keyPresses: this.keyPressLog,
		};

		fs.writeFile(
			this.logFilePath,
			JSON.stringify(logData, null, 2),
			(err) => {
				if (err) {
					console.error("Failed to save key press log:", err);
				}
			},
		);
	}
}

module.exports = LogManager;
