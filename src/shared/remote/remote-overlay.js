class RemoteOverlay {
	constructor(overlayId) {
		this.overlayId = overlayId;
	}

	get el() {
		return document.getElementById(this.overlayId);
	}

	open(bg) {
		const overlay = this.el;
		if (!overlay) return;
		if (bg) overlay.style.background = bg;
		overlay.classList.add("active");
		setInteractionBtnsVisible(false);
	}

	close() {
		const overlay = this.el;
		if (overlay) overlay.classList.remove("active");
		setInteractionBtnsVisible(true);
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
