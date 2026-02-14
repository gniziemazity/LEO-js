const { ipcRenderer } = require("electron");

class SettingsUI {
	constructor() {
		this.currentSettings = null;
		this.modal = null;
	}

	initialize() {
		this.modal = document.getElementById("settingsModal");
		this.setupEventListeners();
	}

	setupEventListeners() {
		const closeSettings = document.getElementById("closeSettings");
		const saveSettings = document.getElementById("saveSettings");
		const resetSettings = document.getElementById("resetSettings");

		if (closeSettings) closeSettings.onclick = () => this.close();
		if (saveSettings) saveSettings.onclick = () => this.save();

		if (resetSettings) {
			resetSettings.onclick = async () => {
				if (confirm("Reset all settings to default values?")) {
					ipcRenderer.send("reset-settings");
					ipcRenderer.once("settings-loaded", (event, settings) => {
						this.loadIntoModal(settings);
					});
				}
			};
		}

		if (this.modal) {
			this.modal.onclick = (e) => {
				if (e.target === this.modal) this.close();
			};
		}

		const hotkeyModeSelect = document.getElementById("hotkeyMode");
		if (hotkeyModeSelect) {
			hotkeyModeSelect.addEventListener("change", (e) => {
				this.updateSpeedVisibility(e.target.value);
			});
		}

		const speedSlider = document.getElementById("autoTypingSpeed");
		if (speedSlider) {
			speedSlider.addEventListener("input", (e) => {
				document.getElementById("speedValue").textContent = e.target.value;
			});
		}
	}

	async open() {
		const settings = await ipcRenderer.invoke("get-settings");
		this.currentSettings = settings;
		this.loadIntoModal(settings);
		this.modal.classList.add("active");
	}

	close() {
		this.modal.classList.remove("active");
	}

	loadIntoModal(settings) {
		document.getElementById("typingHotkeys").value =
			settings.hotkeys.typing.join("");
		document.getElementById("toggleActiveKey").value =
			settings.hotkeys.toggleActive;
		document.getElementById("stepBackwardKey").value =
			settings.hotkeys.stepBackward;
		document.getElementById("stepForwardKey").value =
			settings.hotkeys.stepForward;
		document.getElementById("alwaysOnTopKey").value =
			settings.hotkeys.alwaysOnTop;
		document.getElementById("toggleTransparencyKey").value =
			settings.hotkeys.toggleTransparency;

		document.getElementById("commentNormalColor").value =
			settings.colors.commentNormal;
		document.getElementById("questionCommentColor").value =
			settings.colors.questionCommentColor;
		document.getElementById("commentActiveColor").value =
			settings.colors.commentActive;
		document.getElementById("commentSelectedColor").value =
			settings.colors.commentSelected;
		document.getElementById("commentActiveTextColor").value =
			settings.colors.commentActiveText;
		document.getElementById("cursorColor").value = settings.colors.cursor;
		document.getElementById("selectedBorderColor").value =
			settings.colors.selectedBorder;
		document.getElementById("textColor").value = settings.colors.textColor;

		document.getElementById("fontSize").value = settings.fontSize;

		document.getElementById("hotkeyMode").value =
			settings.hotkeyMode || "single-key";
		document.getElementById("autoTypingSpeed").value =
			settings.autoTypingSpeed;
		document.getElementById("speedValue").textContent =
			settings.autoTypingSpeed;

		this.updateSpeedVisibility(settings.hotkeyMode || "single-key");
	}

	updateSpeedVisibility(mode) {
		const speedContainer = document.getElementById("speedSettingContainer");
		if (speedContainer) {
			speedContainer.style.display = mode === "auto-run" ? "block" : "none";
		}
	}

	save() {
		const typingHotkeysStr = document.getElementById("typingHotkeys").value;
		const typingHotkeys = typingHotkeysStr.split("").filter((c) => c.trim());

		const settings = {
			hotkeys: {
				typing: typingHotkeys,
				toggleActive: document.getElementById("toggleActiveKey").value,
				stepBackward: document.getElementById("stepBackwardKey").value,
				stepForward: document.getElementById("stepForwardKey").value,
				alwaysOnTop: document.getElementById("alwaysOnTopKey").value,
				toggleTransparency: document.getElementById("toggleTransparencyKey")
					.value,
			},
			colors: {
				commentNormal: document.getElementById("commentNormalColor").value,
				questionCommentColor: document.getElementById("questionCommentColor").value,
				commentActive: document.getElementById("commentActiveColor").value,
				commentSelected: document.getElementById("commentSelectedColor")
					.value,
				commentActiveText: document.getElementById("commentActiveTextColor")
					.value,
				cursor: document.getElementById("cursorColor").value,
				selectedBorder: document.getElementById("selectedBorderColor")
					.value,
				textColor: document.getElementById("textColor").value,
			},
			fontSize: parseInt(document.getElementById("fontSize").value),
			hotkeyMode: document.getElementById("hotkeyMode").value,
			autoTypingSpeed: parseInt(
				document.getElementById("autoTypingSpeed").value,
			),
		};

		ipcRenderer.send("save-settings", settings);
	}

	applySettings(settings) {
		if (!settings) return;

		this.currentSettings = settings;

		const styleId = "dynamic-settings-styles";
		let styleEl = document.getElementById(styleId);

		if (!styleEl) {
			styleEl = document.createElement("style");
			styleEl.id = styleId;
			document.head.appendChild(styleEl);
		}

		styleEl.textContent = `
         body {
            font-size: ${settings.fontSize}px;
         }
         
         .comment-block,
         .code-block {
            color: ${settings.colors.textColor};
         }
         
         .comment-block {
            background: ${settings.colors.commentNormal};
         }
         
         .comment-block.question-comment {
            background: ${settings.colors.questionCommentColor};
         }
         
         .comment-block.active-comment {
            background: ${settings.colors.commentActive};
            color: ${settings.colors.commentActiveText};
         }
         
         .block.selected {
            background-color: ${settings.colors.commentSelected};
            border-left-color: ${settings.colors.selectedBorder};
         }
         
         .char.cursor {
            background: ${settings.colors.cursor};
         }
         
         #speedSettingContainer {
            display: ${settings.hotkeyMode === "auto-run" ? "block" : "none"};
         }
         
         .speed-labels {
            display: flex;
            justify-content: space-between;
            font-size: 0.8em;
            color: #666;
            margin-top: 5px;
         }
      `;
	}
}

module.exports = SettingsUI;
