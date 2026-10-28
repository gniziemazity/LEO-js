class NoteOverlay extends RemoteOverlay {
	constructor() {
		super("noteOverlay", "note-confirmed");
	}

	show(payload) {
		const overlay = this.el;
		const titleEl = document.getElementById("ntTitle");
		const textEl = document.getElementById("ntText");
		if (!overlay || !textEl) return;
		if (titleEl) titleEl.textContent = LeoBlocks.POPUP_TITLES.note;
		textEl.textContent = (payload && payload.text) || "";
		this.open("var(--clr-popup-bg)");
	}
}
