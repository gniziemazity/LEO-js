const { ipcRenderer } = require("electron");
const LogManager = require("./log-manager");
const LessonManager = require("./lesson-manager");
const UIManager = require("./ui-manager");
const CursorManager = require("./cursor-manager");
const LessonRenderer = require("./lesson-renderer");
const BlockEditor = require("./block-editor");
const UndoManager = require("./undo-manager");
const FileOperations = require("./file-operations");
const CourseManager = require("./course-manager");
const CourseUI = require("./course-ui");
const SettingsUI = require("./settings-ui");
const SpecialKeys = require("./special-keys");
const TypingController = require("./typing-controller");
const QRModalManager = require("./qr-modal");
const AnchorPreview = require("./anchor-preview");
const DeskPopup = require("./desk-popup");
const { buildArtificialLogEvents } = require("./log-event-builder");
const { parseQuestionOptions } = require("./question-options");
const { COLOR_SETTINGS, defaultsFrom } = require("../shared/settings-schema");
const path = require("path");
const fs = require("fs");

const COLOR_DEFAULTS = defaultsFrom(COLOR_SETTINGS);

const { PAUSING_KINDS } = CursorManager;

const soundPath = path.join(__dirname, "..", "..", "assets", "sounds");

const logManager = new LogManager();
const lessonManager = new LessonManager();
const undoManager = new UndoManager(lessonManager);
const uiManager = new UIManager();
const cursorManager = new CursorManager(uiManager, logManager);
const lessonRenderer = new LessonRenderer(
	lessonManager,
	uiManager,
	cursorManager,
	undoManager,
);
const blockEditor = new BlockEditor(
	lessonManager,
	uiManager,
	lessonRenderer,
	undoManager,
);
lessonRenderer.blockEditor = blockEditor;
const anchorPreview = new AnchorPreview(lessonManager, uiManager);
const deskPopup = new DeskPopup((type, args) =>
	ipcRenderer.send("desk-action", { type, args }),
);

const courseManager = new CourseManager();
const fileOperations = new FileOperations(
	lessonManager,
	logManager,
	cursorManager,
	lessonRenderer,
	undoManager,
	courseManager,
);
const courseUI = new CourseUI(courseManager, fileOperations, lessonManager);
const settingsUI = new SettingsUI();
const specialKeys = new SpecialKeys(uiManager, blockEditor, lessonManager);
const typingController = new TypingController(
	uiManager,
	lessonRenderer,
	cursorManager,
);
const qrModalManager = new QRModalManager();

window.leo = { lessonManager, cursorManager };

let pendingQuestion = null;

cursorManager.onEnterQuestionBlock = (question, timestamp) => {
	const { text, options } = parseQuestionOptions(question);
	pendingQuestion = {
		question: text,
		timestamp,
		answeredBy: null,
		entry: null,
	};
	const students = fileOperations.getStudents();
	const bgColor = getColor("questionColor");
	deskPopup.showQuestion({ question: text, options, students, bgColor });
	ipcRenderer.send("enter-question-block", {
		question: text,
		options,
		students,
		bgColor,
	});
};

function logTeacherQuestionShown() {
	if (!pendingQuestion || pendingQuestion.entry) return;
	pendingQuestion.entry = logManager.addEntry({
		timestamp: pendingQuestion.timestamp,
		interaction: "teacher-question",
		info: pendingQuestion.question,
		answered_by: pendingQuestion.answeredBy,
	});
}

function finalizeTeacherQuestion() {
	if (!pendingQuestion) return;
	if (pendingQuestion.entry) {
		pendingQuestion.entry.answered_by = pendingQuestion.answeredBy;
		pendingQuestion.entry.closed_at = Date.now();
		logManager.save();
	}
	pendingQuestion = null;
}

cursorManager.onLeaveQuestionBlock = () => {
	finalizeTeacherQuestion();
};

cursorManager.onEnterNoteBlock = (payload) => {
	cursorManager.suspendAutoTypingFor("note");
	deskPopup.showNote(payload);
	ipcRenderer.send("enter-note-block", payload);
};

function enterMediaBlock(kind, name) {
	const payload = { kind, name };
	cursorManager.suspendAutoTypingFor(kind);
	deskPopup.showMedia(payload);
	ipcRenderer.send(`enter-${kind}-block`, payload);
}

cursorManager.onImageBlock = (imageName, shouldPin) => {
	const lessonFilePath = lessonManager.getCurrentFilePath();
	const bgColor = getColor("imageBlockColor", null);
	ipcRenderer.send("open-image-window", {
		imageName,
		lessonFilePath,
		bgColor,
		shouldPin,
	});
	enterMediaBlock("image", imageName);
};

cursorManager.onWebBlock = (url, shouldPin) => {
	const bgColor = getColor("imageBlockColor", null);
	ipcRenderer.send("open-web-window", { url, bgColor, shouldPin });
	enterMediaBlock("web", url);
};

cursorManager.onEnterMoveToBlock = (payload) => {
	cursorManager.suspendAutoTypingFor("move-to");
	deskPopup.showMoveTo(payload);
	ipcRenderer.send("enter-move-to-block", payload);
};

cursorManager.onEnterCodeInsertBlock = (payload) => {
	cursorManager.suspendAutoTypingFor("code-insert");
	deskPopup.showCodeInsert(payload);
	ipcRenderer.send("enter-code-insert-block", payload);
};

cursorManager.onLeaveSpecialBlock = (kind) => deskPopup.closeIf(kind);

function getColor(key, fallback = COLOR_DEFAULTS[key] ?? null) {
	return (
		(settingsUI.currentSettings &&
			settingsUI.currentSettings.colors &&
			settingsUI.currentSettings.colors[key]) ||
		fallback
	);
}

fileOperations.onStudentsLoaded = (students) => {
	deskPopup.setStudents(students);
	ipcRenderer.send("update-students", students);
};

fileOperations.onLessonLoaded = () => courseUI.refresh();

let _fireworksSoundUrl = null;
function playFireworksSound() {
	if (!_fireworksSoundUrl) {
		try {
			const filePath = path.join(
				soundPath,
				"fireworks (by dragon studio).mp3",
			);
			const buffer = fs.readFileSync(filePath);
			const blob = new Blob([buffer], { type: "audio/mpeg" });
			_fireworksSoundUrl = URL.createObjectURL(blob);
		} catch (e) {
			console.warn("[fireworks] load failed:", e);
			return;
		}
	}
	const audio = new Audio(_fireworksSoundUrl);
	audio.play().catch((e) => console.warn("[fireworks] play failed:", e));
}

window.addEventListener("DOMContentLoaded", () => {
	uiManager.cacheElements();
	anchorPreview.attach(uiManager.getElement("lessonContainer"));
	settingsUI.initialize();
	specialKeys.initialize();
	const coursePlanLoaded = courseUI.init();
	if (!coursePlanLoaded) {
		fileOperations.loadLastLesson();
	}
	setupEventListeners();
	setupGlobalIpcListeners();
	setupUndoRedoShortcuts();

	const bq = document.getElementById("btnStudentQuestion");
	const bh = document.getElementById("btnProvidingHelp");
	const interaction = (type) => () => {
		ipcRenderer.send("start-interaction", type);
		deskPopup.showInteraction(type);
	};
	if (bq) bq.addEventListener("click", interaction("student-question"));
	if (bh) bh.addEventListener("click", interaction("providing-help"));
});

function setupEventListeners() {
	uiManager.getElement("toggleBtn").onclick = () =>
		typingController.toggleActive();
	uiManager.getElement("autoPilotBtn").onclick = () =>
		ipcRenderer.send("set-auto-pilot", !uiManager.autoPilotOn);
}

function openArtificialSimulator() {
	const savedSelection = uiManager.getSelectedBlockIndex();
	if (savedSelection !== null) {
		uiManager.deselectBlock();
		lessonRenderer.render();
	}

	const events = buildArtificialLogEvents(cursorManager.getExecutionSteps());
	const logPath = logManager.saveArtificialLog(events);

	if (savedSelection !== null) {
		uiManager.selectBlock(savedSelection);
		lessonRenderer.render();
	}

	if (logPath) {
		ipcRenderer.send("open-log-visualizer", logPath);
	}
}

function setupGlobalIpcListeners() {
	ipcRenderer.on("hotkey-toggle-active", () =>
		typingController.toggleActive(),
	);
	ipcRenderer.on("hotkey-step-backward", () => cursorManager.stepBackward());
	ipcRenderer.on("hotkey-step-forward", () => cursorManager.stepForward());
	ipcRenderer.on("advance-cursor", () => cursorManager.advanceCursor());
	ipcRenderer.on("move-to-typing", (e, p) => deskPopup.setMoveToTyped(p));
	const syncDesk = (s) => {
		deskPopup.setTeacherName(s.teacherName);
		deskPopup.setConfirmKey(s.hotkeys && s.hotkeys.confirmPopup);
	};
	ipcRenderer.on("settings-loaded", (e, s) => {
		settingsUI.applySettings(s);
		syncDesk(s);
	});
	ipcRenderer.on("settings-saved", (e, s) => {
		settingsUI.applySettings(s);
		syncDesk(s);
		settingsUI.close();
	});
	ipcRenderer.on("new-plan", () => courseUI.newPlan());
	ipcRenderer.on("save-plan", () => fileOperations.saveLesson());
	ipcRenderer.on("load-plan", () => courseUI.loadPlan());
	ipcRenderer.on("new-course", () => courseUI.newCourse());
	ipcRenderer.on("open-course", () => courseUI.openCourse());
	ipcRenderer.on("save-course", () => courseUI.saveCourse());
	ipcRenderer.on("close-course", () => courseUI.closeCourse());
	ipcRenderer.on("add-students", () => courseUI.showStudents());
	ipcRenderer.on("open-plan-file", (e, filePath) =>
		fileOperations.loadFilePath(filePath),
	);
	ipcRenderer.on("open-course-path", (e, dir) => courseUI.openCoursePath(dir));
	ipcRenderer.on("open-artificial-simulator", openArtificialSimulator);
	ipcRenderer.on("open-settings", () => settingsUI.open());
	ipcRenderer.on("client-jump-to", (e, idx) => cursorManager.jumpTo(idx));
	ipcRenderer.on("client-connected", () => qrModalManager.hideModal());
	ipcRenderer.on("auto-pilot", (e, on) => uiManager.setAutoPilot(on));
	ipcRenderer.on("remote-count", (e, count) =>
		uiManager.setRemotesConnected(count > 0),
	);
	ipcRenderer.on("log-interaction", (e, type) =>
		logManager.addInteraction(type),
	);

	ipcRenderer.on("start-auto-typing", () => cursorManager.startAutoTyping());
	ipcRenderer.on("stop-auto-typing", () => cursorManager.stopAutoTyping());

	for (const kind of PAUSING_KINDS) {
		ipcRenderer.on(`${kind}-confirmed`, () => {
			deskPopup.closeIf(kind);
			if (cursorManager.confirmSpecial(kind))
				cursorManager.startAutoTyping();
		});
	}

	ipcRenderer.on("question-answered", (event, { studentName }) => {
		deskPopup.closeIf("question");
		if (pendingQuestion) {
			pendingQuestion.answeredBy = studentName;
			if (pendingQuestion.entry) {
				pendingQuestion.entry.answered_by = studentName;
				logManager.save();
			}
		}
		if (studentName) {
			playFireworksSound();
		}
	});

	ipcRenderer.on("question-shown", () => {
		logTeacherQuestionShown();
		deskPopup.revealQuestion();
	});

	ipcRenderer.on("question-window-closed", () => {
		deskPopup.closeIf("question");
		finalizeTeacherQuestion();
	});

	ipcRenderer.on(
		"log-student-interaction",
		(
			event,
			{ interactionType, studentName, questionText, openedAt, closedAt },
		) => {
			if (interactionType === "student-question") {
				const fields = { asked_by: studentName };
				if (questionText) fields.info = questionText;
				if (openedAt) fields.timestamp = openedAt;
				if (closedAt) fields.closed_at = closedAt;
				logManager.addInteraction("student-question", fields);
			} else if (interactionType === "providing-help") {
				const fields = { student: studentName };
				if (openedAt) fields.timestamp = openedAt;
				if (closedAt) fields.closed_at = closedAt;
				logManager.addInteraction("providing-help", fields);
			} else {
				logManager.addInteraction(interactionType);
			}
		},
	);

	ipcRenderer.on("undo", () => performUndo());
	ipcRenderer.on("redo", () => performRedo());
}

function performUndo() {
	if (!uiManager.isActive()) {
		if (undoManager.undo()) lessonRenderer.render();
	}
}

function performRedo() {
	if (!uiManager.isActive()) {
		if (undoManager.redo()) lessonRenderer.render();
	}
}

function setupUndoRedoShortcuts() {
	document.addEventListener("keydown", (e) => {
		if (uiManager.isActive()) return;
		const active = document.activeElement;
		const isEditing =
			active &&
			active.contentEditable === "true" &&
			active.classList.contains("block");

		if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
			if (isEditing) return;
			e.preventDefault();
			performUndo();
		} else if (
			((e.ctrlKey || e.metaKey) && e.key === "y") ||
			((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "z")
		) {
			if (isEditing) return;
			e.preventDefault();
			performRedo();
		}
	});
}

window.addEventListener("beforeunload", () => {
	logManager.save();
});
