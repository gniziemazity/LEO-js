const { ipcRenderer } = require("electron");
const path = require("path");
const { buildWindowTitle } = require("../shared/constants");
const LessonManager = require("./lesson-manager");

class FileOperations {
	constructor(
		lessonManager,
		logManager,
		cursorManager,
		lessonRenderer,
		undoManager = null,
		courseManager = null,
	) {
		this.lessonManager = lessonManager;
		this.logManager = logManager;
		this.cursorManager = cursorManager;
		this.lessonRenderer = lessonRenderer;
		this.undoManager = undoManager;
		this.courseManager = courseManager;
		this.students = [];
		this.onStudentsLoaded = null;
		this.onLessonLoaded = null;

		this.lessonManager.onChange(() => {
			this.updateWindowTitleWithUnsavedIndicator();
		});
	}

	async createNewLesson() {
		if (!(await this.confirmDiscard())) return;

		const filePath = await ipcRenderer.invoke("show-save-dialog");
		if (!filePath) return;

		this.lessonManager.create(filePath, async (err) => {
			if (err) {
				console.error("[LEO] create failed:", err);
				alert("Failed to create file: " + err);
				return;
			}

			this.refreshStudents();
			this.updateWindowTitle(path.basename(filePath));
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

		this.loadFilePath(filePath);
	}

	async confirmDiscard() {
		if (!this.lessonManager.hasChanges()) return true;

		const name =
			path.basename(this.lessonManager.getCurrentFilePath() || "") ||
			"This lesson";
		const choice = await ipcRenderer.invoke("show-choice-dialog", {
			type: "warning",
			message: `${name} has unsaved changes.`,
			detail: "Save them before opening another lesson?",
			buttons: ["Save", "Discard", "Cancel"],
			defaultId: 0,
			cancelId: 2,
		});

		if (choice === 2 || choice === -1) return false;
		if (choice === 1) {
			this.lessonManager.discardChanges();
			this.updateWindowTitleWithUnsavedIndicator();
			return true;
		}
		return new Promise((resolve) => {
			this.lessonManager.save((err) => {
				if (err) {
					console.error("[LEO] save failed:", err);
					alert("Save failed: " + err);
					resolve(false);
					return;
				}
				this.updateWindowTitleWithUnsavedIndicator();
				resolve(true);
			});
		});
	}

	async _autosaveToRecover(filePath) {
		const pending = LessonManager.pendingAutosave(filePath);
		if (!pending) return null;

		const choice = await ipcRenderer.invoke("show-choice-dialog", {
			type: "warning",
			message: "LEO closed with unsaved changes to this lesson.",
			detail: "Recover them, or open the last saved version?",
			buttons: ["Recover", "Open saved"],
			defaultId: 0,
			cancelId: 1,
		});

		if (choice === 0) return pending;
		this.lessonManager.currentFilePath = filePath;
		this.lessonManager.clearAutosave();
		this.lessonManager.currentFilePath = "";
		return null;
	}

	async loadFilePath(filePath) {
		if (!(await this.confirmDiscard())) return;
		const from = await this._autosaveToRecover(filePath);

		this.refreshStudents();
		this.updateWindowTitle(path.basename(filePath));

		this.lessonManager.load(
			filePath,
			(err, data) => {
				if (err) {
					console.error("[LEO] load failed:", err);
					alert("Failed to load file: " + err);
					if (localStorage.getItem("lastLessonPath") === filePath) {
						localStorage.removeItem("lastLessonPath");
					}
					return;
				}

				localStorage.setItem("lastLessonPath", filePath);
				this.cursorManager.resetProgress();
				this.logManager.initialize(filePath);

				if (this.undoManager) {
					this.undoManager.clear();
				}

				this.lessonRenderer.resetView();
				this.lessonRenderer.render();
				this.setInitialStateToInactive();
				this.updateWindowTitleWithUnsavedIndicator();

				if (this.onLessonLoaded) {
					this.onLessonLoaded();
				}
			},
			{ from },
		);
	}

	refreshStudents() {
		const students =
			this.courseManager && this.courseManager.isOpen()
				? this.courseManager.getStudentNames()
				: [];
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
				console.error("[LEO] save failed:", err);
				alert("Save failed: " + err);
			} else {
				this.updateWindowTitleWithUnsavedIndicator();
			}
		});
	}

	loadLastLesson() {
		const lastFile = localStorage.getItem("lastLessonPath");
		if (lastFile) {
			this.loadFilePath(lastFile);
		} else {
			this.logManager.initialize();
		}
	}

	_courseName() {
		return this.courseManager && this.courseManager.isOpen()
			? this.courseManager.getName()
			: null;
	}

	refreshTitle() {
		const filePath = this.lessonManager.getCurrentFilePath();
		this.updateWindowTitle(filePath ? path.basename(filePath) : "");
	}

	updateWindowTitle(fileName = "", hasUnsaved = false) {
		const studentCount =
			this.students.length > 0 ? this.students.length : null;
		document.title = buildWindowTitle(
			fileName,
			studentCount,
			hasUnsaved,
			this._courseName(),
		);
	}

	updateWindowTitleWithUnsavedIndicator() {
		const filePath = this.lessonManager.getCurrentFilePath();
		if (!filePath) return;
		this.updateWindowTitle(
			path.basename(filePath),
			this.lessonManager.hasChanges(),
		);
	}

	setInitialStateToInactive() {
		ipcRenderer.send("set-active", false);
	}
}

module.exports = FileOperations;
