class MoveToOverlay extends RemoteOverlay {
	constructor() {
		super("moveToOverlay");
		this.typingName = false;
	}

	autoPilotPad() {
		return this.typingName ? "keyboard" : "mouse";
	}

	beginTypingName() {
		if (this.typingName) return;
		this.typingName = true;
		syncKeyInputGate();
	}

	show(payload) {
		const { mode, target, snippet, typeName, note } = payload || {};
		const overlay = this.el;
		const titleEl = document.getElementById("mtoTitle");
		const targetEl = document.getElementById("mtoTarget");
		const snippetEl = document.getElementById("mtoSnippet");
		if (!overlay) return;

		this.canTypeName = mode === "file" && !!typeName;

		if (titleEl)
			titleEl.textContent = MoveToTarget.moveToPopupTitle({
				mode,
				snippet,
				typeName,
			});

		const typeBtn = document.getElementById("mtoTypeName");
		if (typeBtn) typeBtn.style.display = this.canTypeName ? "" : "none";
		const okBtn = document.getElementById("mtoConfirm");
		if (okBtn) okBtn.style.display = this.canTypeName ? "none" : "";

		const noteEl = document.getElementById("mtoNote");
		if (noteEl) {
			noteEl.textContent = note || "";
			noteEl.style.display = note ? "" : "none";
		}

		snippetEl.style.display = "none";
		snippetEl.innerHTML = "";
		targetEl.style.display = "none";
		targetEl.textContent = "";

		if (mode === "dev" || mode === "main" || mode === "file") {
			targetEl.style.display = "";
			SnippetView.renderTypedName(
				targetEl,
				MoveToTarget.moveToDisplayName(target),
				null,
			);
			if (SnippetView.renderSnippet(snippetEl, snippet)) {
				snippetEl.style.display = "block";
			}
		} else if (mode === "anchor") {
			if (SnippetView.renderSnippet(snippetEl, snippet)) {
				snippetEl.style.display = "block";
			} else {
				targetEl.style.display = "";
				targetEl.textContent = target || "";
				snippetEl.style.display = "block";
				const div = document.createElement("div");
				div.className = "mt-modal-empty";
				div.textContent =
					"(Anchor not found in plan — move to the matching position.)";
				snippetEl.appendChild(div);
			}
		} else {
			targetEl.style.display = "";
			targetEl.textContent = target || "";
		}

		this.typingName = false;
		this.open("var(--clr-moveto-bg)");
	}

	chromeClose() {
		this.confirm();
	}

	typeName() {
		sendMessage("move-to-type-name", {});
		this.beginTypingName();
	}

	setTyped(data) {
		const targetEl = document.getElementById("mtoTarget");
		if (!targetEl || !data) return;
		SnippetView.renderTypedName(targetEl, data.target, data.typed);
		if (data.typed != null) this.beginTypingName();
	}

	closeUI() {
		this.typingName = false;
		this.close();
	}

	confirm() {
		sendMessage("move-to-confirmed", {});
		this.closeUI();
	}
}
