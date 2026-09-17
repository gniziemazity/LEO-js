class MoveToOverlay extends RemoteOverlay {
	constructor() {
		super("moveToOverlay");
	}

	show(payload) {
		const { mode, target, snippet, typeName, note } = payload || {};
		const overlay = this.el;
		const titleEl = document.getElementById("mtoTitle");
		const targetEl = document.getElementById("mtoTarget");
		const snippetEl = document.getElementById("mtoSnippet");
		if (!overlay) return;

		const switchTo = mode === "anchor" && snippet ? snippet.switchTo : null;
		this.canTypeName = mode === "file" && !!typeName;

		if (titleEl) {
			if (this.canTypeName) titleEl.textContent = "Create file:";
			else
				titleEl.textContent = switchTo
					? `Go to (${MoveToTarget.moveToDisplayName(switchTo)}):`
					: "Go to:";
		}

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

		this.open("var(--clr-moveto-bg)");
		padEnterMoveTo();
	}

	chromeClose() {
		this.confirm();
	}

	typeName() {
		sendMessage("move-to-type-name", {});
		padTypeName();
	}

	setTyped(data) {
		const targetEl = document.getElementById("mtoTarget");
		if (!targetEl || !data) return;
		SnippetView.renderTypedName(targetEl, data.target, data.typed);
	}

	closeUI() {
		this.close();
		padLeaveMoveTo();
	}

	confirm() {
		sendMessage("move-to-confirmed", {});
		this.closeUI();
	}
}
