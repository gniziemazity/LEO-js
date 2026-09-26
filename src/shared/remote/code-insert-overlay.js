class CodeInsertOverlay extends RemoteOverlay {
	constructor() {
		super("codeInsertOverlay");
	}

	show(payload) {
		const { text, colored, paste } = payload || {};
		const overlay = this.el;
		const codeEl = document.getElementById("ciCode");
		if (!overlay || !codeEl) return;

		this.canPaste = paste !== false;

		const pasteBtn = document.getElementById("ciPaste");
		if (pasteBtn) pasteBtn.style.display = this.canPaste ? "" : "none";
		const okBtn = document.getElementById("ciConfirm");
		if (okBtn) okBtn.style.display = this.canPaste ? "none" : "";

		SnippetView.renderLines(codeEl, text, colored);

		this.open("var(--clr-code-insert-bg)");
	}

	chromeClose() {
		this.confirm();
	}

	paste() {
		sendMessage("code-insert-paste", {});
		this.closeUI();
	}

	confirm() {
		sendMessage("code-insert-confirmed", {});
		this.closeUI();
	}
}
