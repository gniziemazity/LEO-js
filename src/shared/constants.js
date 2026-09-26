const { Key } = require("@computer-use/nut-js");

const NUTJS_KEY_MAPPING = {
	"←": { key: Key.Left },
	"→": { key: Key.Right },
	"↑": { key: Key.Up },
	"↓": { key: Key.Down },
	"◄": { key: Key.Home },
	"►": { key: Key.End },
	"▲": { key: Key.PageUp },
	"▼": { key: Key.PageDown },

	"⌫": { key: Key.Backspace },
	"↢": { key: Key.Backspace },
	"―": { key: Key.Tab },
	"⛔": { modifier: Key.LeftControl, shift: true, key: Key.K },
	"⌦": { key: Key.Delete },

	"⇑": { shift: true, key: Key.Up },
	"⇓": { shift: true, key: Key.Down },
	"⇐": { shift: true, key: Key.Home },
	"⇒": { shift: true, key: Key.End },

	"💾": { modifier: Key.LeftControl, key: Key.S },
	"🔁": { modifier: Key.LeftAlt, key: Key.Tab },
	Ö: { modifier: Key.LeftAlt, key: Key.Tab },
	ö: { modifier: Key.LeftControl, key: Key.F5 },
	Ș: { modifier: Key.LeftControl, key: Key.Tab },
	ñ: { modifier: Key.LeftControl, key: Key.N },
	ω: { modifier: Key.LeftControl, key: Key.W },
	"↩": { key: Key.Enter },
	é: { key: Key.Escape },
	"🅴": { key: Key.Escape },
	Ț: { modifier: Key.LeftControl, key: Key.F },

	"🕛": { pause: 500 },
};

const WINDOW_CONFIG = {
	width: 650,
	height: 950,
	webPreferences: {
		nodeIntegration: true,
		contextIsolation: false,
	},
	alwaysOnTop: false,
	frame: true,
	skipTaskbar: false,
};

const TIMER_CONFIG = {
	DEFAULT_MINUTES: 90,
};

function buildWindowTitle(fileName, studentCount, hasUnsaved, courseName) {
	const baseTitle = "LEO";
	const parts = [];
	if (courseName && courseName.trim() !== "") parts.push(courseName.trim());
	if (fileName && fileName.trim() !== "")
		parts.push(fileName.replace(/\.(leo|json)$/i, ""));
	if (parts.length === 0) return baseTitle;
	let title = `${baseTitle} - ${parts.join(" / ")}`;
	if (studentCount !== null && studentCount !== undefined)
		title += ` [${studentCount} students]`;
	if (hasUnsaved) title += " *";
	return title;
}

module.exports = {
	NUTJS_KEY_MAPPING,
	TIMER_CONFIG,
	WINDOW_CONFIG,
	buildWindowTitle,
};
