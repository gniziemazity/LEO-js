const { readCodeText } = require("../shared/code-text");

class SpecialKeys {
	constructor(uiManager, blockEditor, lessonManager) {
		this.uiManager = uiManager;
		this.blockEditor = blockEditor;
		this.lessonManager = lessonManager;
	}

	initialize() {
		const keys = {
			"←": "Arrow Left",
			"→": "Arrow Right",
			"↑": "Arrow Up",
			"↓": "Arrow Down",
			"◄": "Home",
			"►": "End",
			"▲": "Page Up",
			"▼": "Page Down",
			"💾": "Save File",
			"🔁": "Alt Tab",
			"🕛": "Pause",
			"🅴": "Escape",
			"↩": "Enter",
			"⚓": "Anchor",
			"―": "Tab",
			"⇑": "Shift + Arrow Up",
			"⇓": "Shift + Arrow Down",
			"⇐": "Shift + Home",
			"⇒": "Shift + End",
			"⌫": "Backspace",
			"⌦": "Delete",
			"⛔": "Delete Line",
		};

		this.uiManager.populateSpecialKeys(keys, (char) => {
			this.insertSpecialChar(char);
		});

		const formatBtn = document.getElementById("formatBtn");
		if (formatBtn) formatBtn.onclick = () => this.blockEditor.formatBlock();
	}

	insertSpecialChar(char) {
		const insertText =
			char === "⚓" && this.lessonManager
				? `⚓${this.lessonManager.getNextAnchorId()}⚓`
				: char;
		document.execCommand("insertText", false, insertText);
		const selectedBlockIndex = this.uiManager.getSelectedBlockIndex();

		if (selectedBlockIndex !== null) {
			const activeDiv =
				document.querySelectorAll(".block")[selectedBlockIndex];
			if (!activeDiv || !activeDiv.contains(document.activeElement)) return;
			this.blockEditor.updateBlockContent(
				selectedBlockIndex,
				readCodeText(activeDiv),
			);
		}
	}
}

module.exports = SpecialKeys;
