const fs = require("fs");
const path = require("path");
const os = require("os");

class SettingsManager {
	constructor() {
		this.settingsPath = path.join(os.homedir(), ".leo-settings.json");
		this.defaultSettings = {
			hotkeys: {
				typing: "abcdefghijklmnopqrstuvwxyz".split(""),
				toggleActive: "CommandOrControl+P",
				stepBackward: "CommandOrControl+Left",
				stepForward: "CommandOrControl+Right",
				alwaysOnTop: "CommandOrControl+Shift+Space",
				toggleTransparency: "CommandOrControl+Shift+T",
			},
			colors: {
				commentNormal: "#fff9c4",
				commentActive: "#2c3e50",
				commentSelected: "#f0f8ff",
				commentActiveText: "#f1c40f",
				cursor: "#e74c3c",
				selectedBorder: "#3498db",
				textColor: "#333333",
			},
			fontSize: 14,
			hotkeyMode: "single-key", // "single-key" or "auto-run"
			autoTypingSpeed: 50,
		};

		this.settings = this.load();
	}

	load() {
		try {
			if (fs.existsSync(this.settingsPath)) {
				const data = fs.readFileSync(this.settingsPath, "utf8");
				return { ...this.defaultSettings, ...JSON.parse(data) };
			}
		} catch (error) {
			console.error("Failed to load settings:", error);
		}
		return { ...this.defaultSettings };
	}

	save() {
		try {
			fs.writeFileSync(
				this.settingsPath,
				JSON.stringify(this.settings, null, 2),
			);
			return true;
		} catch (error) {
			console.error("Failed to save settings:", error);
			return false;
		}
	}

	get(key) {
		const keys = key.split(".");
		let value = this.settings;
		for (const k of keys) {
			value = value[k];
			if (value === undefined) return undefined;
		}
		return value;
	}

	set(key, value) {
		const keys = key.split(".");
		let obj = this.settings;
		for (let i = 0; i < keys.length - 1; i++) {
			if (!obj[keys[i]]) obj[keys[i]] = {};
			obj = obj[keys[i]];
		}
		obj[keys[keys.length - 1]] = value;
		this.save();
	}

	getAll() {
		return { ...this.settings };
	}

	reset() {
		this.settings = { ...this.defaultSettings };
		this.save();
	}
}

module.exports = SettingsManager;
