const { ipcRenderer } = require("electron");
const LogManager = require("./main/log-manager");
const LessonManager = require("./renderer/lesson-manager");
const UIManager = require("./renderer/ui-manager");
const CursorManager = require("./renderer/cursor-manager");
const LessonRenderer = require("./renderer/lesson-renderer");
const BlockEditor = require("./renderer/block-editor");
const UndoManager = require("./renderer/undo-manager");
const FileOperations = require("./renderer/file-operations");
const SettingsUI = require("./renderer/settings-ui");
const SpecialKeys = require("./renderer/special-keys");
const TypingController = require("./renderer/typing-controller");
const QRModalManager = require("./renderer/qr-modal");

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
const fileOperations = new FileOperations(
	lessonManager,
	logManager,
	cursorManager,
	lessonRenderer,
	undoManager,
);
const settingsUI = new SettingsUI();
const specialKeys = new SpecialKeys(uiManager, blockEditor);
const typingController = new TypingController(
	uiManager,
	lessonRenderer,
	cursorManager,
);
const qrModalManager = new QRModalManager();

let pendingQuestion = null;

cursorManager.onEnterQuestionBlock = (question, timestamp) => {
	pendingQuestion = { question, timestamp, answeredBy: null };
	const students = fileOperations.getStudents();
	const bgColor = getColor("questionCommentColor", "#ffcdd2");
	ipcRenderer.send("enter-question-block", { question, students, bgColor });
};

cursorManager.onLeaveQuestionBlock = () => {
	if (pendingQuestion) {
		logManager.addEntry({
			timestamp: pendingQuestion.timestamp,
			interaction: "teacher-question",
			info: pendingQuestion.question,
			answered_by: pendingQuestion.answeredBy,
			closed_at: Date.now(),
		});
		pendingQuestion = null;
	}
};

cursorManager.onImageBlock = (imageName) => {
	const lessonFilePath = lessonManager.getCurrentFilePath();
	const bgColor = getColor("imageBlockColor", null);
	ipcRenderer.send("open-image-window", {
		imageName,
		lessonFilePath,
		bgColor,
	});
};

function getColor(key, fallback) {
	return (
		(settingsUI.currentSettings &&
			settingsUI.currentSettings.colors &&
			settingsUI.currentSettings.colors[key]) ||
		fallback
	);
}

fileOperations.onStudentsLoaded = (students) => {
	ipcRenderer.send("broadcast-students", students);
};

window.addEventListener("DOMContentLoaded", () => {
	uiManager.cacheElements();
	settingsUI.initialize();
	specialKeys.initialize();
	fileOperations.loadLastLesson();
	setupEventListeners();
	setupGlobalIpcListeners();
	setupUndoRedoShortcuts();
});

function setupEventListeners() {
	uiManager.getElement("toggleBtn").onclick = () =>
		typingController.toggleActive();
	uiManager.getElement("addCommentBtn").onclick = () =>
		blockEditor.addBlock("comment");
	uiManager.getElement("addCodeBtn").onclick = () =>
		blockEditor.addBlock("code");
	uiManager.getElement("removeBlockBtn").onclick = () =>
		blockEditor.removeBlock();
	uiManager.getElement("formatBlockBtn").onclick = () =>
		blockEditor.formatBlock();
}

function setupGlobalIpcListeners() {
	ipcRenderer.on("global-toggle-active", () =>
		typingController.toggleActive(),
	);
	ipcRenderer.on("global-step-backward", () => cursorManager.stepBackward());
	ipcRenderer.on("global-step-forward", () => cursorManager.stepForward());
	ipcRenderer.on("advance-cursor", () => cursorManager.advanceCursor());
	ipcRenderer.on("toggle-transparency-event", () =>
		ipcRenderer.send("toggle-transparency"),
	);
	ipcRenderer.on("settings-loaded", (e, s) => settingsUI.applySettings(s));
	ipcRenderer.on("settings-saved", (e, s) => {
		settingsUI.applySettings(s);
		settingsUI.close();
	});
	ipcRenderer.on("new-plan", () => fileOperations.createNewLesson());
	ipcRenderer.on("save-plan", () => fileOperations.saveLesson());
	ipcRenderer.on("load-plan", () => fileOperations.loadLesson());
	ipcRenderer.on("open-settings", () => settingsUI.open());
	ipcRenderer.on("client-jump-to", (e, idx) => cursorManager.jumpTo(idx));
	ipcRenderer.on("log-interaction", (e, type) =>
		logManager.addInteraction(type),
	);

	ipcRenderer.on("start-auto-typing", () => cursorManager.startAutoTyping());
	ipcRenderer.on("stop-auto-typing", () => cursorManager.stopAutoTyping());

	ipcRenderer.on("question-answered", (event, { studentName }) => {
		if (pendingQuestion) {
			pendingQuestion.answeredBy = studentName;
		}
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
