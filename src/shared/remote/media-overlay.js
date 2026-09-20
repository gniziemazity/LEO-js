class MediaOverlay extends RemoteOverlay {
	constructor() {
		super("mediaOverlay");
		this.kind = null;
		this.pinned = { image: false, web: false };
	}

	show(payload) {
		const { kind, name } = payload || {};
		const overlay = this.el;
		const nameEl = document.getElementById("mdName");
		if (!overlay || !nameEl) return;
		this.kind = kind;
		const titleEl = document.getElementById("mdTitle");
		if (titleEl) titleEl.textContent = LeoBlocks.POPUP_TITLES[kind] || "";
		nameEl.textContent = name || "";
		this.syncPin();
		this.open("var(--clr-moveto-bg)");
	}

	setPinned(pinned) {
		this.pinned = {
			image: !!(pinned && pinned.image),
			web: !!(pinned && pinned.web),
		};
		this.syncPin();
	}

	isPinned() {
		return !!this.pinned[this.kind];
	}

	syncPin() {
		const btn = document.getElementById("mdPin");
		if (btn) btn.style.visibility = this.isPinned() ? "hidden" : "";
	}

	pin() {
		sendMessage("pin-window", { pinned: true });
	}

	chromeClose() {
		sendMessage("media-dismissed", {});
		this.closeUI();
	}

	closeUI() {
		this.close();
	}

	confirm() {
		sendMessage("media-confirmed", {});
		this.closeUI();
	}
}
