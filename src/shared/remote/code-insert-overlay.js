class CodeInsertOverlay extends RemoteOverlay {
	constructor() {
		super("codeInsertOverlay");
	}

	show(payload) {
		const { text, colored } = payload || {};
		const overlay = this.el;
		const codeEl = document.getElementById("ciCode");
		if (!overlay || !codeEl) return;

		const pasteBtn = document.getElementById("ciPaste");
		const hint = document.getElementById("ciHint");
		if (pasteBtn) pasteBtn.style.display = "";
		if (hint) hint.style.display = "none";

		SnippetView.renderLines(codeEl, text, colored);

		this.open("var(--clr-code-insert-bg)");
	}

	padActions() {
		const actions = [];
		actions.push({ label: "Paste", onClick: () => this.paste() });
		actions.push({
			label: "OK",
			kind: "confirm",
			onClick: () => this.confirm(),
		});
		return actions;
	}

	setPadCovered(covered) {
		const actions = document.getElementById("ciActions");
		if (actions) actions.style.display = covered ? "none" : "";
	}

	paste() {
		sendMessage("code-insert-paste", {});
	}

	closeUI() {
		this.setPadCovered(false);
		this.close();
	}

	confirm() {
		sendMessage("code-insert-confirmed", {});
		this.closeUI();
	}
}
