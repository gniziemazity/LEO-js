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
	"🆕": { modifier: Key.LeftControl, key: Key.N },
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

const LOG_CONFIG = {
	SAVE_INTERVAL: 10,
};

const TIMER_CONFIG = {
	DEFAULT_MINUTES: 90,
	ADJUSTMENT_MINUTES: 10,
};

const AUTO_CLOSE_MS = 3000;

function getBlockSubtype(text) {
	const t = text.trim();
	if (t.startsWith("❓")) return "question-comment";
	if (t.startsWith("🖼️")) return "image-comment";
	if (t.startsWith("🌐")) return "web-comment";
	if (t.startsWith("📋")) return "code-insert-comment";
	if (t.startsWith("➡️")) return "move-to-comment";
	return null;
}

function buildWindowTitle(fileName, studentCount, hasUnsaved) {
	const baseTitle = "LEO";
	if (!fileName || fileName.trim() === "") return baseTitle;
	const displayName = fileName.replace(/\.json$/i, "");
	let title = `${baseTitle} - ${displayName}`;
	if (studentCount !== null && studentCount !== undefined)
		title += ` [${studentCount} students]`;
	if (hasUnsaved) title += " *";
	return title;
}

function buildSettingsCSS(settings) {
	return `
		body { font-size: ${settings.fontSize}px; }
		.comment-block, .code-block { color: ${settings.colors.textColor}; }
		.comment-block { background: ${settings.colors.commentNormal}; }
		.code-block { background: ${settings.colors.codeBlockColor}; }
		.comment-block.question-comment { background: ${settings.colors.questionCommentColor}; }
		.comment-block.image-comment { background: ${settings.colors.imageBlockColor}; }
		.comment-block.web-comment { background: ${settings.colors.imageBlockColor}; }
		.comment-block.code-insert-comment { background: ${settings.colors.codeInsertBlockColor}; }
		.comment-block.move-to-comment { background: ${settings.colors.moveToBlockColor}; color: ${settings.colors.moveToTextColor}; }
		.comment-block.active-comment {
			background: ${settings.colors.commentActive};
			color: ${settings.colors.commentActiveText};
		}
		.block.selected {
			background-color: ${settings.colors.commentSelected};
			border-left-color: ${settings.colors.selectedBorder};
		}
		.char.cursor { background: ${settings.colors.cursor}; }
		.anchor-token.cursor { background: ${settings.colors.cursor}; }
		#addQuestionCommentBtn { background: ${settings.colors.questionCommentColor}; }
		#addImageCommentBtn { background: ${settings.colors.imageBlockColor}; }
		#addWebCommentBtn { background: ${settings.colors.imageBlockColor}; }
		#addCodeInsertBlockBtn { background: ${settings.colors.codeInsertBlockColor}; }
		#addMoveToBlockBtn { background: ${settings.colors.moveToBlockColor}; color: ${settings.colors.moveToTextColor}; }
		#addCommentBtn { background: ${settings.colors.commentNormal}; color: #333; }
		#addCodeBtn { background: ${settings.colors.codeBlockColor}; color: #333; }
	`;
}

function formatAnsweredText(studentName) {
	return studentName ? `Answered by ${studentName}` : "Answered";
}

module.exports = {
	NUTJS_KEY_MAPPING,
	TIMER_CONFIG,
	WINDOW_CONFIG,
	LOG_CONFIG,
	AUTO_CLOSE_MS,
	getBlockSubtype,
	buildWindowTitle,
	buildSettingsCSS,
	formatAnsweredText,
};
