class MediaOverlay extends RemoteOverlay {
	constructor() {
		super("mediaOverlay", "media-confirmed");
		this.type = null;
		this.pinned = { image: false, web: false };
	}

	show(payload) {
		const { type, name } = payload || {};
		const overlay = this.el;
		const nameEl = document.getElementById("mdName");
		if (!overlay || !nameEl) return;
		this.type = type;
		const titleEl = document.getElementById("mdTitle");
		if (titleEl) titleEl.textContent = LeoBlocks.POPUP_TITLES[type] || "";
		nameEl.textContent = name || "";
		this.syncPin();
		this.open("var(--clr-popup-bg)");
	}

	setPinned(pinned) {
		this.pinned = {
			image: !!(pinned && pinned.image),
			web: !!(pinned && pinned.web),
		};
		this.syncPin();
	}

	isPinned() {
		return !!this.pinned[this.type];
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
}
