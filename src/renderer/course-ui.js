const { ipcRenderer } = require("electron");
const path = require("path");

const PLAN_EXT_RE = /\.(leo|json)$/i;

class CourseUI {
	constructor(courseManager, fileOperations, lessonManager) {
		this.courseManager = courseManager;
		this.fileOperations = fileOperations;
		this.lessonManager = lessonManager;
		this._cacheElements();
		this._wireEvents();
	}

	_cacheElements() {
		this.modal = document.getElementById("studentsModal");
		this.textarea = document.getElementById("studentsTextarea");
		this.saveBtn = document.getElementById("saveStudentsBtn");
		this.closeBtn = document.getElementById("closeStudentsModal");
		this.statusEl = document.getElementById("studentsStatus");
	}

	_wireEvents() {
		this.closeBtn.addEventListener("click", () => this.hideStudents());
		this.saveBtn.addEventListener("click", () => this._saveStudents());
		this.modal.addEventListener("click", (e) => {
			if (e.target === this.modal) this.hideStudents();
		});
		document.addEventListener("keydown", (e) => {
			if (e.key === "Escape" && this.modal.classList.contains("active")) {
				this.hideStudents();
			}
		});
	}

	init() {
		const last = localStorage.getItem("lastCoursePath");
		if (!last) return false;
		try {
			this.courseManager.open(last);
		} catch {
			localStorage.removeItem("lastCoursePath");
			return false;
		}
		const loaded = this._loadDefaultPlan();
		if (!loaded) this.refresh();
		return loaded;
	}

	refresh() {
		const open = this.courseManager.isOpen();
		const plans = open
			? this.courseManager
					.listPlans()
					.map((p) => ({ name: p.name, path: path.resolve(p.path) }))
			: [];
		const current = this.lessonManager.getCurrentFilePath();
		if (open && current && this.courseManager.isInPlans(current)) {
			this.courseManager.setLastPlan(
				path.basename(current).replace(PLAN_EXT_RE, ""),
			);
		}
		ipcRenderer.send("set-course-menu", {
			open,
			plans,
			currentPath: current ? path.resolve(current) : "",
		});
		this.fileOperations.refreshTitle();
	}

	_loadDefaultPlan() {
		const planPath = this.courseManager.planToOpen();
		if (!planPath) return false;
		this.fileOperations.loadFilePath(planPath);
		return true;
	}

	async newCourse() {
		const target = await ipcRenderer.invoke("show-create-course-dialog");
		if (!target) return;
		try {
			this.courseManager.create(target, path.basename(target));
		} catch (e) {
			alert("Failed to create course: " + e.message);
			return;
		}
		localStorage.setItem("lastCoursePath", target);
		this.refresh();
	}

	async openCourse() {
		const dir = await ipcRenderer.invoke("show-open-course-dialog");
		if (!dir) return;
		try {
			this.courseManager.open(dir);
		} catch (e) {
			alert("Not a valid course folder: " + e.message);
			return;
		}
		localStorage.setItem("lastCoursePath", dir);
		if (!this._loadDefaultPlan()) this.refresh();
	}

	closeCourse() {
		if (!this.courseManager.isOpen()) return;
		this.courseManager.close();
		localStorage.removeItem("lastCoursePath");
		this.refresh();
	}

	saveCourse() {
		if (!this.courseManager.isOpen()) {
			alert("No course is open.");
			return;
		}
		try {
			this.courseManager.saveCourseMeta();
		} catch (e) {
			alert("Failed to save course: " + e.message);
		}
	}

	async newPlan() {
		if (!this.courseManager.isOpen()) {
			this.fileOperations.createNewLesson();
			return;
		}
		const target = await ipcRenderer.invoke("show-save-dialog", {
			defaultPath: this.courseManager.defaultPlanPath("plan.leo"),
			title: "New Plan",
		});
		if (!target) return;
		const name = path.basename(target).replace(PLAN_EXT_RE, "");
		let planPath;
		try {
			planPath = this.courseManager.addPlan(name);
		} catch (e) {
			alert("Failed to add plan: " + e.message);
			return;
		}
		this.fileOperations.loadFilePath(planPath);
	}

	async loadPlan() {
		if (!this.courseManager.isOpen()) {
			this.fileOperations.loadLesson();
			return;
		}
		const file = await ipcRenderer.invoke("show-open-dialog", {
			defaultPath: this.courseManager.plansDir(),
		});
		if (!file) return;
		let planPath = file;
		const name = path.basename(file).replace(PLAN_EXT_RE, "");
		if (this.courseManager.isInPlans(file)) {
			this.courseManager.ensurePlanFolders(name);
		} else {
			try {
				planPath = this.courseManager.addPlan(name, file);
			} catch (e) {
				alert("Failed to import plan: " + e.message);
				return;
			}
		}
		this.fileOperations.loadFilePath(planPath);
	}

	showStudents() {
		if (!this.courseManager.isOpen()) {
			alert("Open or create a course first.");
			return;
		}
		this.textarea.value = this.courseManager.readStudentsRaw();
		this.statusEl.textContent = "";
		this.modal.classList.add("active");
		this.textarea.focus();
	}

	hideStudents() {
		this.modal.classList.remove("active");
	}

	_saveStudents() {
		try {
			const { count } = this.courseManager.writeStudentsCsv(
				this.textarea.value,
			);
			this.statusEl.textContent = `Saved ${count} student(s) to students.csv`;
			this.fileOperations.refreshStudents();
			setTimeout(() => this.hideStudents(), 1000);
		} catch (e) {
			this.statusEl.textContent = "Error: " + e.message;
		}
	}
}

module.exports = CourseUI;
