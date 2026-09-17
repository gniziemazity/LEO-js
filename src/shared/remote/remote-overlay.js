const remoteOverlays = [];

function activeRemoteOverlay() {
	for (const overlay of remoteOverlays) {
		const el = overlay.el;
		if (el && el.classList.contains("active")) return overlay;
	}
	return null;
}

function syncOverlayChrome() {
	const open = !!activeRemoteOverlay();
	const btn = document.getElementById("overlayCloseBtn");
	if (btn) btn.style.display = open ? "" : "none";
}

function closeActiveOverlay() {
	const overlay = activeRemoteOverlay();
	if (overlay) overlay.chromeClose();
}

function activePadOverlay() {
	for (const overlay of remoteOverlays) {
		const el = overlay.el;
		if (
			el &&
			el.classList.contains("active") &&
			el.classList.contains("overlay-pad-ok")
		)
			return overlay;
	}
	return null;
}

class RemoteOverlay {
	constructor(overlayId) {
		this.overlayId = overlayId;
		remoteOverlays.push(this);
	}

	get el() {
		return document.getElementById(this.overlayId);
	}

	chromeClose() {
		this.closeUI();
	}

	setPadCovered(covered) {
		const overlay = this.el;
		if (overlay) overlay.classList.toggle("pad-lifted", !!covered);
	}

	open(bg) {
		const overlay = this.el;
		if (!overlay) return;
		if (bg) overlay.style.background = bg;
		overlay.classList.add("active");
		setInteractionBtnsVisible(false);
		syncOverlayChrome();
		syncKeyInputGate();
	}

	close() {
		const overlay = this.el;
		if (overlay) overlay.classList.remove("active", "pad-lifted");
		setInteractionBtnsVisible(true);
		syncOverlayChrome();
		syncKeyInputGate();
	}

	makeStudentBtn(label, onClick, cssText) {
		const btn = document.createElement("button");
		btn.className = "popup-student-btn";
		if (cssText) btn.style.cssText = cssText;
		btn.textContent = label;
		btn.onclick = onClick;
		return btn;
	}

	fillStudentGrid(grid, students, makeOnClick) {
		grid.innerHTML = "";
		students.forEach((name, idx) => {
			grid.appendChild(this.makeStudentBtn(name, makeOnClick(idx, name)));
		});
	}
}
