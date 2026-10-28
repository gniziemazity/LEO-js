class SnippetOverlay extends RemoteOverlay {
	constructor() {
		super("snippetOverlay", "snippet-confirmed");
	}

	show(payload) {
		const { text, colored, paste } = payload || {};
		const overlay = this.el;
		const codeEl = document.getElementById("snCode");
		if (!overlay || !codeEl) return;

		this.canPaste = paste !== false;

		this.swapActions("snPaste", "snConfirm", this.canPaste);

		ExcerptView.renderLines(codeEl, text, colored);

		this.open("var(--clr-snippet-bg)");
	}

	paste() {
		sendMessage("snippet-paste", {});
		this.closeUI();
	}
}
