const fs = require("fs");
const path = require("path");
const os = require("os");
const { writeFileAtomicSync } = require("../shared/atomic-write");
const {
	COLOR_SETTINGS,
	HOTKEY_SETTINGS,
	defaultsFrom,
} = require("../shared/settings-schema");

const RENAMED_COLORS = {
	commentNormal: "noteColor",
	questionCommentColor: "questionColor",
	codeInsertBlockColor: "snippetColor",
	commentActive: "activeBlockColor",
	commentActiveText: "activeBlockTextColor",
	commentSelected: "selectedBlockColor",
	codeBlockColor: "codeColor",
	imageBlockColor: "imageColor",
	moveToBlockColor: "goToColor",
	moveToColor: "goToColor",
	moveToTextColor: "goToTextColor",
};

const RENAMED_SETTINGS = {
	autoTypingSpeed: "autoRunSpeed",
};

const RETIRED_SETTINGS = ["mode"];

function deepClone(value) {
	return JSON.parse(JSON.stringify(value));
}

function renameKeys(source, renames) {
	const out = { ...(source || {}) };
	for (const [was, now] of Object.entries(renames)) {
		if (was in out) {
			if (!(now in out)) out[now] = out[was];
			delete out[was];
		}
	}
	return out;
}

function migrateColors(colors) {
	return renameKeys(colors, RENAMED_COLORS);
}

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
			hotkeyMode: "single-key",
			autoRunSpeed: 50,
			touchpadSensitivity: 3,
			touchpadSide: "right",
			floatingTheme: "solid",
			randomizerStyle: "shuffle",
			answerEffect: "fireworks",
			teacherName: "Teacher",
			editorTipSeen: false,
			typingHotkeysOffWithRemote: false,
		};

		this.settings = this.load();
	}

	defaults() {
		return deepClone(this.defaultSettings);
	}

	load() {
		try {
			if (fs.existsSync(this.settingsPath)) {
				const data = fs.readFileSync(this.settingsPath, "utf8");
				const saved = renameKeys(JSON.parse(data), RENAMED_SETTINGS);
				for (const key of RETIRED_SETTINGS) delete saved[key];
				const defaults = this.defaults();
				return {
					...defaults,
					...saved,
					colors: {
						...defaults.colors,
						...migrateColors(saved.colors),
					},
					hotkeys: {
						...defaults.hotkeys,
						...(saved.hotkeys || {}),
					},
				};
			}
		} catch (error) {
			console.error("[LEO] settings load failed:", error);
		}
		return this.defaults();
	}

	save() {
		try {
			writeFileAtomicSync(
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
		return deepClone(this.settings);
	}

	reset() {
		this.settings = this.defaults();
		this.save();
	}
}

module.exports = SettingsManager;
module.exports.migrateColors = migrateColors;
module.exports.RENAMED_COLORS = RENAMED_COLORS;
module.exports.RENAMED_SETTINGS = RENAMED_SETTINGS;
