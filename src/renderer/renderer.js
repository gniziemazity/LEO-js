const { ipcRenderer } = require("electron");
const LogManager = require("./main/log-manager");
const TimerManager = require("./renderer/timer-manager");
const LessonManager = require("./renderer/lesson-manager");
const UIManager = require("./renderer/ui-manager");
const CursorManager = require("./renderer/cursor-manager");
const LessonRenderer = require("./renderer/lesson-renderer");
const BlockEditor = require("./renderer/block-editor");
const FileOperations = require("./renderer/file-operations");
const SettingsUI = require("./renderer/settings-ui");
const SpecialKeys = require("./renderer/special-keys");
const TypingController = require("./renderer/typing-controller");
const { TIMER_CONFIG } = require("./shared/constants");

const logManager = new LogManager();
const timerManager = new TimerManager();
const lessonManager = new LessonManager();
const uiManager = new UIManager();
const cursorManager = new CursorManager(uiManager, logManager);
const lessonRenderer = new LessonRenderer(
	lessonManager,
	uiManager,
	cursorManager,
);
const blockEditor = new BlockEditor(lessonManager, uiManager, lessonRenderer);
const fileOperations = new FileOperations(
	lessonManager,
	logManager,
	cursorManager,
	lessonRenderer,
);
const settingsUI = new SettingsUI();
const specialKeys = new SpecialKeys(uiManager, blockEditor);
const typingController = new TypingController(
	uiManager,
	lessonRenderer,
	cursorManager,
);

window.addEventListener("DOMContentLoaded", () => {
	uiManager.cacheElements();
	settingsUI.initialize();
	specialKeys.initialize();

	fileOperations.loadLastLesson();

	setupManagers();
	setupEventListeners();
	setupGlobalIpcListeners();
});

function setupManagers() {
	timerManager.onTick((formattedTime) => {
		uiManager.updateTimerDisplay(formattedTime);
	});

	timerManager.onComplete(() => {
		uiManager.hideTimerControls();
	});
}

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
	uiManager.getElement("timerStartBtn").onclick = () => startTimer();
	uiManager.getElement("timerPlusBtn").onclick = () =>
		adjustTimer(TIMER_CONFIG.ADJUSTMENT_MINUTES);
	uiManager.getElement("timerMinusBtn").onclick = () =>
		adjustTimer(-TIMER_CONFIG.ADJUSTMENT_MINUTES);
	uiManager.getElement("askQuestionBtn").onclick = () =>
		logInteraction("student-question");
	uiManager.getElement("helpBtn").onclick = () =>
		logInteraction("providing-help");
}

function setupGlobalIpcListeners() {
	ipcRenderer.on("global-toggle-active", () =>
		typingController.toggleActive(),
	);
	ipcRenderer.on("global-step-backward", () => cursorManager.stepBackward());
	ipcRenderer.on("global-step-forward", () => cursorManager.stepForward());
	ipcRenderer.on("advance-cursor", () => cursorManager.advanceCursor());
	ipcRenderer.on("toggle-transparency-event", () => {
		ipcRenderer.send("toggle-transparency");
	});
	ipcRenderer.on("settings-loaded", (event, settings) => {
		settingsUI.applySettings(settings);
	});
	ipcRenderer.on("settings-saved", (event, settings) => {
		settingsUI.applySettings(settings);
		settingsUI.close();
	});
	ipcRenderer.on("new-plan", () => fileOperations.createNewLesson());
	ipcRenderer.on("save-plan", () => fileOperations.saveLesson());
	ipcRenderer.on("load-plan", () => fileOperations.loadLesson());
	ipcRenderer.on("open-settings", () => settingsUI.open());
	ipcRenderer.on("client-jump-to", (event, stepIndex) => {
		cursorManager.jumpTo(stepIndex);
	});
	ipcRenderer.on("log-interaction", (event, interactionType) => {
		logInteraction(interactionType);
	});
	ipcRenderer.on("start-auto-typing", () => {
		cursorManager.startAutoTyping();
	});
	ipcRenderer.on("stop-auto-typing", () => {
		cursorManager.stopAutoTyping();
	});
}

function logInteraction(interactionType) {
	logManager.addInteraction(interactionType);
}

function startTimer() {
	timerManager.start(TIMER_CONFIG.DEFAULT_MINUTES);
	uiManager.showTimerControls();
}

function adjustTimer(minutes) {
	timerManager.adjust(minutes);
}

window.addEventListener("beforeunload", () => {
	logManager.save();
	timerManager.reset();
});
