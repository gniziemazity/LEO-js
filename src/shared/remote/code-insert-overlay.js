class CodeInsertOverlay extends RemoteOverlay {
	constructor() {
		super("codeInsertOverlay");
	}

	makeSegSpan(text, color) {
		const span = document.createElement("span");
		span.textContent = text;
		if (color) span.style.color = color;
		return span;
	}

	renderLine(row, segs) {
		for (const seg of segs)
			row.appendChild(this.makeSegSpan(seg.text, seg.color));
	}

	canPressKeys() {
		return typeof IS_CONTROL_PANEL === "undefined" || !IS_CONTROL_PANEL;
	}

	show(payload) {
		const { text, colored } = payload || {};
		const overlay = this.el;
		const codeEl = document.getElementById("ciCode");
		if (!overlay || !codeEl) return;

		const pasteBtn = document.getElementById("ciPaste");
		const hint = document.getElementById("ciHint");
		const remote = this.canPressKeys();
		if (pasteBtn) pasteBtn.style.display = remote ? "" : "none";
		if (hint) hint.style.display = remote ? "none" : "";

		codeEl.innerHTML = "";
		const lines = String(text || "").split("\n");
		lines.forEach((line, i) => {
			const row = document.createElement("div");
			row.className = "mt-modal-line";
			const segs =
				colored && colored[i] ? colored[i] : [{ text: line, color: null }];
			this.renderLine(row, segs);
			codeEl.appendChild(row);
		});

		this.open("var(--clr-code-insert-bg)");
	}

	padActions() {
		const actions = [];
		if (this.canPressKeys())
			actions.push({ label: "📋 Paste", onClick: () => this.paste() });
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
