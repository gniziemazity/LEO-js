const { ipcRenderer } = require("electron");
const { buildSettingsCSS } = require("../shared/blocks");
const {
	COLOR_SETTINGS,
	HOTKEY_SETTINGS,
	domFieldsFor,
} = require("../shared/settings-schema");

const COLOR_FIELDS = domFieldsFor(COLOR_SETTINGS);
const HOTKEY_FIELDS = domFieldsFor(HOTKEY_SETTINGS);

const REGISTRY_SELECTS = [
	{
		id: "floatingTheme",
		fallback: "solid",
		list: () => (typeof listThemes === "function" ? listThemes() : []),
	},
	{
		id: "randomizerStyle",
		fallback: "shuffle",
		list: () =>
			typeof listRandomizers === "function" ? listRandomizers() : [],
	},
	{
		id: "answerEffect",
		fallback: "fireworks",
		list: () => (typeof listEffects === "function" ? listEffects() : []),
	},
];

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

		const sensitivitySlider = document.getElementById("touchpadSensitivity");
		if (sensitivitySlider) {
			sensitivitySlider.addEventListener("input", (e) => {
				document.getElementById("sensitivityValue").textContent =
					parseFloat(e.target.value).toFixed(1);
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
		document.getElementById("platformSelect").value =
			settings.platform || "windows";

		document.getElementById("typingHotkeys").value =
			settings.hotkeys.typing.join("");
		this._applyFields(HOTKEY_FIELDS, settings.hotkeys);
		this._applyFields(COLOR_FIELDS, settings.colors);

		document.getElementById("fontSize").value = settings.fontSize;

		document.getElementById("hotkeyMode").value =
			settings.hotkeyMode || "single-key";
		document.getElementById("autoTypingSpeed").value =
			settings.autoTypingSpeed;
		document.getElementById("speedValue").textContent =
			settings.autoTypingSpeed;

		document.getElementById("touchpadSensitivity").value =
			settings.touchpadSensitivity || 3;
		document.getElementById("sensitivityValue").textContent = parseFloat(
			settings.touchpadSensitivity || 3,
		).toFixed(1);

		document.getElementById("touchpadSide").value =
			settings.touchpadSide || "right";

		this.applyRegistrySelects(settings);

		const teacherNameInput = document.getElementById("teacherName");
		if (teacherNameInput)
			teacherNameInput.value = settings.teacherName || "Teacher";

		document.getElementById("typingHotkeysOffWithRemote").checked =
			settings.typingHotkeysOffWithRemote === true;

		this.updateSpeedVisibility(settings.hotkeyMode || "single-key");
	}

	_applyFields(fields, values) {
		for (const [id, key] of fields) {
			const el = document.getElementById(id);
			if (el) el.value = values[key];
		}
	}

	_fieldValues(fields) {
		const out = {};
		for (const [id, key] of fields) {
			const el = document.getElementById(id);
			if (el) out[key] = el.value;
		}
		return out;
	}

	applyRegistrySelects(settings) {
		for (const spec of REGISTRY_SELECTS)
			this.fillRegistrySelect(spec, settings);
	}

	fillRegistrySelect(spec, settings) {
		const select = document.getElementById(spec.id);
		if (!select) return;
		for (const name of spec.list()) {
			if (select.querySelector(`option[value="${name}"]`)) continue;
			const opt = document.createElement("option");
			opt.value = name;
			opt.textContent = name.charAt(0).toUpperCase() + name.slice(1);
			select.appendChild(opt);
		}
		select.value = settings[spec.id] || spec.fallback;
		if (!select.value && select.options.length) {
			select.value = select.options[0].value;
		}
	}

	registrySelectValues() {
		const out = {};
		for (const spec of REGISTRY_SELECTS) {
			const select = document.getElementById(spec.id);
			out[spec.id] = select ? select.value : spec.fallback;
		}
		return out;
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
			platform: document.getElementById("platformSelect").value,
			hotkeys: {
				typing: typingHotkeys,
				...this._fieldValues(HOTKEY_FIELDS),
			},
			colors: this._fieldValues(COLOR_FIELDS),
			fontSize: parseInt(document.getElementById("fontSize").value),
			hotkeyMode: document.getElementById("hotkeyMode").value,
			autoTypingSpeed: parseInt(
				document.getElementById("autoTypingSpeed").value,
			),
			touchpadSensitivity: parseFloat(
				document.getElementById("touchpadSensitivity").value,
			),
			touchpadSide: document.getElementById("touchpadSide").value,
			...this.registrySelectValues(),
			teacherName: document.getElementById("teacherName")
				? document.getElementById("teacherName").value.trim() || "Teacher"
				: "Teacher",
			typingHotkeysOffWithRemote: document.getElementById(
				"typingHotkeysOffWithRemote",
			).checked,
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

		styleEl.textContent = buildSettingsCSS(settings);
	}
}

SettingsUI.COLOR_FIELDS = COLOR_FIELDS;
SettingsUI.HOTKEY_FIELDS = HOTKEY_FIELDS;

module.exports = SettingsUI;
