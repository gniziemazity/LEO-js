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
			"⌫": "Backspace",
			"⛔": "Delete Line",
			"⌦": "Delete",
			"⚓": "Anchor",
			"―": "Tab",
			"⇑": "Shift + Arrow Up",
			"⇓": "Shift + Arrow Down",
			"⇐": "Shift + Arrow Left",
			"⇒": "Shift + Arrow Right",
		};

		this.uiManager.populateSpecialKeys(keys, (char) => {
			this.insertSpecialChar(char);
		});
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
			this.blockEditor.updateBlockContent(
				selectedBlockIndex,
				activeDiv.innerText,
			);
		}
	}
}

module.exports = SpecialKeys;
