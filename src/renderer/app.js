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
const AutoTypingController = require("./auto-typing-controller");
const QRModalManager = require("./qr-modal");
const GoToPreview = require("./go-to-preview");
const DeskPopup = require("./desk-popup");
const SimPanel = require("./sim-panel");
const { buildArtificialLogEvents } = require("./log-event-builder");
const { parseQuestionOptions } = require("./question-options");
const { COLOR_SETTINGS, defaultsFrom } = require("../shared/settings-schema");
const { addChoices } = require("./block-types");
const { questionLogEntry, isQuestion } = require("../shared/interaction-view");
const { hasBlockControls } = require("../shared/blocks");
const path = require("path");
const fs = require("fs");

const COLOR_DEFAULTS = defaultsFrom(COLOR_SETTINGS);

const { PAUSING_TYPES } = CursorManager;

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
const goToPreview = new GoToPreview(lessonManager, uiManager);
const deskPopup = new DeskPopup((type, args) =>
	ipcRenderer.send("desk-action", { type, args }),
);
const simPanel = new SimPanel(lessonManager, () => lessonRenderer.caretFocus());
lessonManager.onChange(() => simPanel.changed());
lessonRenderer.onRendered = () => simPanel.changed();

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
const autoTypingController = new AutoTypingController(
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

function enterPausingBlock(type, payload, showCard) {
	cursorManager.suspendAutoRunFor(type);
	showCard.call(deskPopup, payload);
	ipcRenderer.send(`enter-${type}-block`, payload);
}

cursorManager.onEnterNoteBlock = (payload) =>
	enterPausingBlock("note", payload, deskPopup.showNote);

function enterMediaBlock(type, name) {
	enterPausingBlock(type, { type, name }, deskPopup.showMedia);
}

cursorManager.onImageBlock = (imageName, shouldPin) => {
	const lessonFilePath = lessonManager.getCurrentFilePath();
	ipcRenderer.send("open-image-window", {
		imageName,
		lessonFilePath,
		shouldPin,
	});
	enterMediaBlock("image", imageName);
};

cursorManager.onWebBlock = (url, shouldPin) => {
	ipcRenderer.send("open-web-window", { url, shouldPin });
	enterMediaBlock("web", url);
};

cursorManager.onEnterGoToBlock = (payload) =>
	enterPausingBlock("go-to", payload, deskPopup.showGoTo);

cursorManager.onEnterSnippetBlock = (payload) =>
	enterPausingBlock("snippet", payload, deskPopup.showSnippet);

cursorManager.onLeaveSupportBlock = (type) => deskPopup.closeIf(type);

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
	goToPreview.attach(uiManager.getElement("lessonContainer"));
	simPanel.attach(
		document.getElementById("sim-panel"),
		uiManager.getElement("lessonContainer"),
	);
	for (const type of ["selectionchange", "focusin", "focusout"]) {
		document.addEventListener(type, () => simPanel.schedule());
	}
	settingsUI.initialize();
	specialKeys.initialize();
	const coursePlanLoaded = courseUI.init();
	if (!coursePlanLoaded) {
		fileOperations.loadLastLesson();
	}
	setupEventListeners();
	setupGlobalIpcListeners();
	setupUndoRedoShortcuts();
	setupBlockShortcuts();

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
		autoTypingController.toggleActive();
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
		ipcRenderer.send("open-simulator-window", logPath);
	}
}

function setupGlobalIpcListeners() {
	ipcRenderer.on("hotkey-toggle-active", () =>
		autoTypingController.toggleActive(),
	);
	ipcRenderer.on("hotkey-step-backward", () => cursorManager.stepBackward());
	ipcRenderer.on("hotkey-step-forward", () => cursorManager.stepForward());
	ipcRenderer.on("advance-cursor", () => cursorManager.advanceCursor());
	ipcRenderer.on("window-maximized", (e, maximized) =>
		simPanel.setVisible(maximized),
	);
	ipcRenderer.on("go-to-typing", (e, p) => deskPopup.setGoToTyped(p));
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
	ipcRenderer.on("save-plan", () => fileOperations.savePlan());
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
	ipcRenderer.on("remote-count", (e, count) => {
		const had = uiManager.remotesConnected;
		uiManager.setRemotesConnected(count > 0);
		if (!had && count > 0) lessonRenderer.broadcastLessonData();
	});
	ipcRenderer.on("log-interaction", (e, type) =>
		logManager.addInteraction(type),
	);

	ipcRenderer.on("start-auto-run", () => cursorManager.startAutoRun());
	ipcRenderer.on("stop-auto-run", () => cursorManager.stopAutoRun());

	for (const type of PAUSING_TYPES) {
		ipcRenderer.on(`${type}-confirmed`, () => {
			deskPopup.closeIf(type);
			if (cursorManager.confirmSpecial(type)) cursorManager.startAutoRun();
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
		if (studentName != null) {
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
		cursorManager.questionWindowClosed();
	});

	ipcRenderer.on("log-student-interaction", (event, payload) => {
		const { interactionType, studentName, openedAt, closedAt } = payload;
		if (isQuestion(interactionType)) {
			logManager.addInteraction(...questionLogEntry(payload));
			if (payload.answeredBy) playFireworksSound();
		} else if (interactionType === "providing-help") {
			const fields = { student: studentName };
			if (openedAt) fields.timestamp = openedAt;
			if (closedAt) fields.closed_at = closedAt;
			logManager.addInteraction("providing-help", fields);
		} else {
			logManager.addInteraction(interactionType);
		}
	});

	ipcRenderer.on("undo", () => performUndo());
	ipcRenderer.on("redo", () => performRedo());
}

function rerenderAfterHistory(changed) {
	if (!changed) return;
	const editing =
		document.activeElement &&
		document.activeElement.classList &&
		document.activeElement.classList.contains("block");
	const selected = uiManager.getSelectedBlockIndex();
	uiManager.collapseSelection();
	lessonRenderer.endEditBurst();
	lessonRenderer.render();
	if (editing && selected !== null) uiManager.refocusBlock(selected);
}

function performUndo() {
	if (!uiManager.isActive()) rerenderAfterHistory(undoManager.undo());
}

function performRedo() {
	if (!uiManager.isActive()) rerenderAfterHistory(undoManager.redo());
}

function setupUndoRedoShortcuts() {
	document.addEventListener("keydown", (e) => {
		if (uiManager.isActive()) return;

		if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
			e.preventDefault();
			performUndo();
		} else if (
			((e.ctrlKey || e.metaKey) && e.key === "y") ||
			((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "z")
		) {
			e.preventDefault();
			performRedo();
		}
	});
}

function setupBlockShortcuts() {
	document.addEventListener("keydown", (e) => {
		if (uiManager.isActive()) return;
		const modified = e.ctrlKey || e.metaKey || e.altKey || e.shiftKey;
		if (e.key === "Escape" && !modified && uiManager.isMultiSelected()) {
			e.preventDefault();
			uiManager.collapseSelection();
			lessonRenderer.render();
			uiManager.refocusBlock(uiManager.getSelectedBlockIndex());
			return;
		}
		if (!(e.ctrlKey || e.metaKey) || e.altKey) return;

		const blockIdx = uiManager.getSelectedBlockIndex();
		if (blockIdx === null) return;
		const block = lessonManager.getAllBlocks()[blockIdx];
		if (!block) return;
		const hasControls = hasBlockControls(block);
		const picked = uiManager.getSelectedBlockIndices();

		const key = e.key.toLowerCase();
		if (key === "d" && !e.shiftKey) {
			if (!lessonManager.canRemoveBlocks(picked)) return;
			e.preventDefault();
			blockEditor.removeBlocks(picked);
			return;
		}
		if (key === "c" && e.shiftKey) {
			if (!hasControls) return;
			e.preventDefault();
			blockEditor.copyBlocks(picked);
			return;
		}
		if (key === "v" && e.shiftKey) {
			if (!hasControls || !blockEditor.hasCopiedBlock()) return;
			e.preventDefault();
			blockEditor.pasteBlock(blockIdx);
			return;
		}
		if ((key === "arrowup" || key === "arrowdown") && e.shiftKey) {
			if (!hasControls) return;
			const delta = key === "arrowup" ? -1 : 1;
			if (!lessonManager.canMoveBlocks(picked, delta)) return;
			e.preventDefault();
			blockEditor.moveBlocks(picked, delta);
			return;
		}
		if (key === "arrowup" || key === "arrowdown") {
			const delta = key === "arrowup" ? -1 : 1;
			const next = blockIdx + delta;
			const blocks = lessonManager.getAllBlocks();
			if (next < lessonManager.firstAuthoredIndex() || next >= blocks.length)
				return;
			e.preventDefault();
			uiManager.selectBlock(next);
			lessonRenderer.render();
			uiManager.refocusBlock(next);
			return;
		}

		const digit = Number(e.key);
		if (hasControls && Number.isInteger(digit) && digit >= 1 && digit <= 7) {
			const choice = addChoices()[digit - 1];
			if (!choice) return;
			e.preventDefault();
			blockEditor.addBlock(
				choice.storedType,
				choice.initialText || null,
				blockIdx,
			);
		}
	});
}

window.addEventListener("beforeunload", () => {
	logManager.finalize();
});
