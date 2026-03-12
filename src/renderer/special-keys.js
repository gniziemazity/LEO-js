class SpecialKeys {
	constructor(uiManager, blockEditor) {
		this.uiManager = uiManager;
		this.blockEditor = blockEditor;
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
			"↢": "Backspace",
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
		document.execCommand("insertText", false, char);
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
