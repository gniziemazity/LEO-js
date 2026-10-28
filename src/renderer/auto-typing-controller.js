const { ipcRenderer } = require("electron");

class AutoTypingController {
	constructor(uiManager, lessonRenderer, cursorManager) {
		this.uiManager = uiManager;
		this.lessonRenderer = lessonRenderer;
		this.cursorManager = cursorManager;
	}

	toggleActive() {
		const isCurrentlyInactive = !this.uiManager.isActive();

		if (isCurrentlyInactive) {
			this.uiManager.deselectBlock();
		}

		this.uiManager.setAutoTypingActive(isCurrentlyInactive);
		ipcRenderer.send("set-active", isCurrentlyInactive);

		this.lessonRenderer.render();

		if (isCurrentlyInactive && this.cursorManager.getCurrentStep() > 0) {
			this.cursorManager.restoreConsumedSteps();
		}
	}
}

module.exports = AutoTypingController;
