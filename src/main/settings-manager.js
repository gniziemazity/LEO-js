const fs = require("fs");
const path = require("path");
const os = require("os");
const {
	COLOR_SETTINGS,
	HOTKEY_SETTINGS,
	defaultsFrom,
} = require("../shared/settings-schema");

class SettingsManager {
	constructor() {
		this.settingsPath = path.join(os.homedir(), ".leo-settings.json");
		this.defaultSettings = {
			platform: process.platform === "darwin" ? "macos" : "windows",
			hotkeys: {
				typing: "abcdefghijklmnopqrstuvwxyz".split(""),
				...defaultsFrom(HOTKEY_SETTINGS),
			},
			colors: defaultsFrom(COLOR_SETTINGS),
			fontSize: 14,
			mode: "record",
			hotkeyMode: "single-key",
			autoTypingSpeed: 50,
			touchpadSensitivity: 3,
			touchpadSide: "right",
			floatingTheme: "solid",
			randomizerStyle: "shuffle",
			answerEffect: "fireworks",
			teacherName: "Teacher",
		};

		this.settings = this.load();
	}

	load() {
		try {
			if (fs.existsSync(this.settingsPath)) {
				const data = fs.readFileSync(this.settingsPath, "utf8");
				const saved = JSON.parse(data);
				return {
					...this.defaultSettings,
					...saved,
					colors: {
						...this.defaultSettings.colors,
						...(saved.colors || {}),
					},
					hotkeys: {
						...this.defaultSettings.hotkeys,
						...(saved.hotkeys || {}),
					},
				};
			}
		} catch (error) {
			console.error("[LEO] settings load failed:", error);
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
			console.error("[LEO] settings save failed:", error);
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
