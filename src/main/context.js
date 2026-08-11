const SettingsManager = require("./settings-manager");
const LEOBroadcastServer = require("./websocket-server");
const HotkeyManager = require("./hotkey-manager");
const KeyboardHandler = require("./keyboard-handler");

const settingsManager = new SettingsManager();
const broadcastServer = new LEOBroadcastServer(8080);
const hotkeyManager = new HotkeyManager(settingsManager);
const keyboardHandler = new KeyboardHandler(hotkeyManager, settingsManager);

function resolveStudentName(field) {
	if (field == null) return null;
	if (field === 0 || field === "0") {
		return settingsManager.get("teacherName") || "Teacher";
	}
	const students = broadcastServer.currentState.students || [];
	if (typeof field === "number" && Number.isInteger(field)) {
		return students[field - 1] || null;
	}
	if (typeof field === "string") {
		const trimmed = field.trim();
		if (!trimmed) return null;
		const asNum = Number(trimmed);
		if (Number.isInteger(asNum) && String(asNum) === trimmed) {
			return students[asNum - 1] || null;
		}
		return trimmed;
	}
	return null;
}

module.exports = {
	settingsManager,
	broadcastServer,
	hotkeyManager,
	keyboardHandler,
	resolveStudentName,
};
