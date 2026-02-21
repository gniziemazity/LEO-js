const { ipcRenderer } = require("electron");
const path = require("path");
const { buildWindowTitle } = require("../shared/constants");

class FileOperations {
	constructor(
		lessonManager,
		logManager,
		cursorManager,
		lessonRenderer,
		undoManager = null,
	) {
		this.lessonManager = lessonManager;
		this.logManager = logManager;
		this.cursorManager = cursorManager;
		this.lessonRenderer = lessonRenderer;
		this.undoManager = undoManager;
		this.students = [];
		this.onStudentsLoaded = null;

		this.lessonManager.onChange(() => {
			this.updateWindowTitleWithUnsavedIndicator();
		});
	}

	async createNewLesson() {
		const filePath = await ipcRenderer.invoke("show-save-dialog");
		if (!filePath) return;

		this.lessonManager.create(filePath, async (err) => {
			if (err) {
				console.error("Failed to create file:", err);
				alert("Failed to create file: " + err);
				return;
			}

			const fileName = filePath.split(/[\\/]/).pop();
			await this._loadStudents(filePath);
			this.updateWindowTitle(fileName);
			localStorage.setItem("lastLessonPath", filePath);
			this.logManager.initialize(filePath);
			this.cursorManager.resetProgress();

			if (this.undoManager) {
				this.undoManager.clear();
			}

			this.lessonRenderer.render();
		});
	}

	async loadLesson() {
		const filePath = await ipcRenderer.invoke("show-open-dialog");
		if (!filePath) return;

		const fileName = filePath.split(/[\\/]/).pop();
		await this._loadStudents(filePath);
		this.updateWindowTitle(fileName);
		this.loadFilePath(filePath, 0);
	}

	async loadFilePath(filePath, savedIndex = 0) {
		await this._loadStudents(filePath);
		this.updateWindowTitle(filePath.split(/[\\/]/).pop());

		this.lessonManager.load(filePath, (err, data) => {
			if (err) {
				console.error("Failed to load file:", err);
				alert("Failed to load file: " + err);
				return;
			}

			localStorage.setItem("lastLessonPath", filePath);
			this.cursorManager.currentStepIndex = savedIndex;

			this.cursorManager.resetProgress();
			this.logManager.initialize(filePath);

			if (this.undoManager) {
				this.undoManager.clear();
			}

			this.lessonRenderer.render();
			this.setInitialStateToInactive();

			const lessonName = path.basename(filePath, ".json");
			ipcRenderer.send("broadcast-lesson", lessonName);
		});
	}

	async _loadStudents(filePath) {
		const students = await ipcRenderer.invoke("load-students-file", filePath);
		this.students = students;
		if (this.onStudentsLoaded) {
			this.onStudentsLoaded(students);
		}
	}

	getStudents() {
		return this.students;
	}

	saveLesson() {
		this.lessonManager.save((err) => {
			if (err) {
				console.error("Save failed:", err);
				alert("Save failed: " + err);
			} else {
				this.updateWindowTitleWithUnsavedIndicator();
			}
		});
	}

	loadLastLesson() {
		const lastFile = localStorage.getItem("lastLessonPath");
		const lastIndex = localStorage.getItem("lastStepIndex");

		if (lastFile) {
			this.loadFilePath(lastFile, lastIndex ? parseInt(lastIndex) : 0);
		} else {
			this.logManager.initialize();
		}
	}

	updateWindowTitle(fileName = "") {
		const studentCount =
			this.students.length > 0 ? this.students.length : null;
		ipcRenderer.send("update-window-title", { fileName, studentCount });
		document.title = buildWindowTitle(fileName, studentCount, false);
	}

	updateWindowTitleWithUnsavedIndicator() {
		const filePath = this.lessonManager.getCurrentFilePath();
		if (!filePath) return;

		const fileName = filePath.split(/[\\/]/).pop();
		const hasUnsaved = this.lessonManager.hasChanges();
		const studentCount =
			this.students.length > 0 ? this.students.length : null;

		document.title = buildWindowTitle(fileName, studentCount, hasUnsaved);

		const titleFileName = hasUnsaved ? `${fileName} *` : fileName;
		ipcRenderer.send("update-window-title", {
			fileName: titleFileName,
			studentCount,
		});
	}

	setInitialStateToInactive() {
		ipcRenderer.send("set-active", false);
	}
}

module.exports = FileOperations;
