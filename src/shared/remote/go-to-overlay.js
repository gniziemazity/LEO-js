class GoToOverlay extends RemoteOverlay {
	constructor() {
		super("goToOverlay", "go-to-confirmed");
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
		const { mode, target, excerpt, typeName, note } = payload || {};
		const overlay = this.el;
		const titleEl = document.getElementById("gtoTitle");
		const targetEl = document.getElementById("gtoTarget");
		const excerptEl = document.getElementById("gtoExcerpt");
		if (!overlay) return;

		this.canTypeName = mode === "file" && !!typeName;

		if (titleEl)
			titleEl.textContent = GoToTarget.goToPopupTitle({
				mode,
				excerpt,
				typeName,
			});

		this.swapActions("gtoTypeName", "gtoConfirm", this.canTypeName);

		const noteEl = document.getElementById("gtoNote");
		if (noteEl) {
			noteEl.textContent = note || "";
			noteEl.style.display = note ? "" : "none";
		}

		excerptEl.style.display = "none";
		excerptEl.innerHTML = "";
		targetEl.style.display = "none";
		targetEl.textContent = "";

		if (mode !== "anchor") {
			targetEl.style.display = "";
			ExcerptView.renderTypedName(
				targetEl,
				GoToTarget.goToDisplayName(target),
				null,
			);
			if (ExcerptView.renderExcerpt(excerptEl, excerpt)) {
				excerptEl.style.display = "block";
			}
		} else if (ExcerptView.renderExcerpt(excerptEl, excerpt)) {
			excerptEl.style.display = "block";
		} else {
			targetEl.style.display = "";
			targetEl.textContent = target || "";
			excerptEl.style.display = "block";
			const div = document.createElement("div");
			div.className = "excerpt-empty";
			div.textContent =
				"(Anchor not found in plan — go to the matching position.)";
			excerptEl.appendChild(div);
		}

		this.typingName = false;
		this.open("var(--clr-popup-bg)");
	}

	typeName() {
		sendMessage("go-to-type-name", {});
		this.beginTypingName();
	}

	setTyped(data) {
		const targetEl = document.getElementById("gtoTarget");
		if (!targetEl || !data) return;
		ExcerptView.renderTypedName(targetEl, data.target, data.typed);
		if (data.typed != null) this.beginTypingName();
	}

	closeUI() {
		this.typingName = false;
		this.close();
	}
}
