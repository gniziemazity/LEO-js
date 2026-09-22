const fs = require("fs");
const path = require("path");
const os = require("os");

const JOURNAL_EXT = ".jsonl";

class LogManager {
	constructor() {
		this.keyPressLog = [];
		this.sessionStartTime = null;
		this.logFilePath = null;
		this.journalPath = null;
		this.journal = null;
		this.currentLessonPath = null;
	}

	initialize(lessonFilePath = null) {
		this.finalize();

		this.keyPressLog = [];
		this.sessionStartTime = Date.now();
		this.currentLessonPath = lessonFilePath;

		const { logsDir, basename } = this.getLogPaths(lessonFilePath);
		this.ensureLogsDirectory(logsDir);
		LogManager.recoverJournals(logsDir);

		const timestamp = this.getTimestamp();
		this.logFilePath = path.join(
			logsDir,
			`${basename}_key_presses_${timestamp}.log`,
		);
		this.journalPath = this.logFilePath + JOURNAL_EXT;
		this.openJournal();
		this.save();
	}

	getLogPaths(lessonFilePath) {
		if (lessonFilePath) {
			const dir = path.dirname(lessonFilePath);
			return {
				logsDir: path.join(dir, "logs"),
				basename: path.basename(
					lessonFilePath,
					path.extname(lessonFilePath),
				),
			};
		} else {
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

	header() {
		return {
			lessonFile: this.currentLessonPath || "No file loaded",
			sessionStart: this.sessionStartTime,
		};
	}

	openJournal() {
		try {
			this.journal = fs.openSync(this.journalPath, "a");
			this.writeJournal(this.header());
		} catch (error) {
			console.error("[LEO] log journal failed:", error);
			this.journal = null;
		}
	}

	writeJournal(entry) {
		if (this.journal === null) return;
		try {
			fs.writeSync(this.journal, JSON.stringify(entry) + "\n");
		} catch (error) {
			console.error("[LEO] log append failed:", error);
			this.journal = null;
		}
	}

	addEntry(entry) {
		if (!this.sessionStartTime) {
			console.warn("[LEO] log not initialized");
			return null;
		}

		const logEntry = {
			timestamp: Date.now(),
			...entry,
		};

		this.keyPressLog.push(logEntry);
		this.writeJournal(logEntry);

		return logEntry;
	}

	addInteraction(interactionType, extraFields = null) {
		const entry = { interaction: interactionType };
		if (extraFields) Object.assign(entry, extraFields);
		this.addEntry(entry);
	}

	saveArtificialLog(events) {
		if (!this.currentLessonPath && !this.logFilePath) {
			console.warn("[LEO] no lesson path, log not saved");
			return;
		}

		const { logsDir, basename } = this.getLogPaths(this.currentLessonPath);
		this.ensureLogsDirectory(logsDir);

		const timestamp = this.getTimestamp();
		const artificialPath = path.join(
			logsDir,
			`artificial_${basename}_${timestamp}.log`,
		);

		LogManager.writeAtomic(artificialPath, {
			lessonFile: this.currentLessonPath || "No file loaded",
			sessionStart: events.length > 0 ? events[0].timestamp : Date.now(),
			artificial: true,
			events,
		});
		return artificialPath;
	}

	save() {
		if (!this.logFilePath) {
			console.warn("[LEO] no log path, not saved");
			return;
		}

		LogManager.writeAtomic(this.logFilePath, {
			...this.header(),
			events: this.keyPressLog,
		});
	}

	finalize() {
		if (!this.logFilePath) return;
		this.save();
		if (this.journal !== null) {
			try {
				fs.closeSync(this.journal);
			} catch (_) {}
			this.journal = null;
		}
		if (this.journalPath) {
			try {
				fs.unlinkSync(this.journalPath);
			} catch (_) {}
			this.journalPath = null;
		}
	}

	static writeAtomic(filePath, data) {
		const temp = `${filePath}.tmp`;
		try {
			fs.writeFileSync(temp, JSON.stringify(data, null, 2));
			fs.renameSync(temp, filePath);
		} catch (error) {
			console.error("[LEO] log save failed:", error);
			try {
				fs.unlinkSync(temp);
			} catch (_) {}
		}
	}

	static readJournal(journalPath) {
		const text = fs.readFileSync(journalPath, "utf8");
		let header = null;
		const events = [];
		for (const line of text.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			let parsed;
			try {
				parsed = JSON.parse(trimmed);
			} catch (_) {
				continue;
			}
			if (header === null) header = parsed;
			else events.push(parsed);
		}
		if (!header) return null;
		return {
			lessonFile: header.lessonFile,
			sessionStart: header.sessionStart,
			events,
		};
	}

	static recoverJournals(logsDir) {
		let names = [];
		try {
			names = fs.readdirSync(logsDir);
		} catch (_) {
			return [];
		}
		const recovered = [];
		for (const name of names) {
			if (!name.endsWith(JOURNAL_EXT)) continue;
			const journalPath = path.join(logsDir, name);
			try {
				const data = LogManager.readJournal(journalPath);
				if (data && data.events.length > 0) {
					const target = journalPath.slice(0, -JOURNAL_EXT.length);
					LogManager.writeAtomic(target, data);
					recovered.push(target);
				}
				fs.unlinkSync(journalPath);
			} catch (error) {
				console.error("[LEO] log recovery failed:", error);
			}
		}
		return recovered;
	}
}

module.exports = LogManager;
