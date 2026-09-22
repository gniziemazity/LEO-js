class QuestionOverlay extends RemoteOverlay {
	constructor() {
		super("questionOverlay");
		this.autoCloseTimer = null;
	}

	keepsInteractionBtns() {
		return false;
	}

	clearTimer() {
		if (this.autoCloseTimer) {
			clearTimeout(this.autoCloseTimer);
			this.autoCloseTimer = null;
		}
	}

	show(question, students, bgColor, options) {
		this.clearTimer();

		document.getElementById("qText").textContent = question;

		const grid = document.getElementById("qGrid");
		const showBtn = document.getElementById("qShowBtn");
		grid.innerHTML = "";
		grid.style.display = "none";
		if (showBtn) showBtn.style.display = "block";
		this.options = options && options.length ? options : null;

		const list = students && students.length ? students : null;
		this.students = list;

		if (list) {
			this.fillStudentGrid(
				grid,
				list,
				(idx) => () => this.studentAnswered(idx),
			);
		} else {
			grid.appendChild(
				this.makeStudentBtn(
					"Answered",
					() => this.studentAnswered(null),
					"width:100%;margin-bottom:4px",
				),
			);
		}

		grid.insertBefore(this.buildActionButtons(), grid.firstChild);

		this.open(bgColor ? bgColor : "var(--clr-q-bg)");
	}

	buildActionButtons() {
		const frag = document.createDocumentFragment();
		if (this.students) {
			frag.appendChild(this.makeActionBtn("🎲", () => this.randomize()));
		}
		if (this.options) {
			frag.appendChild(this.makeActionBtn("🔤", () => this.showOptions()));
		}
		return frag;
	}

	makeActionBtn(label, onClick) {
		const btn = this.makeStudentBtn(label, onClick);
		btn.classList.add("popup-action-btn");
		return btn;
	}

	showToTeacher(animate) {
		sendMessage("show-question", { animate: animate !== false });
		this.reveal();
	}

	reveal() {
		const showBtn = document.getElementById("qShowBtn");
		if (showBtn) showBtn.style.display = "none";
		document.getElementById("qGrid").style.display = "flex";
		syncTouchpadToolbar();
	}

	chromeClose() {
		this.dismiss();
	}

	randomize() {
		if (!this.students || !this.students.length) return;
		sendMessage("question-randomize", {});
	}

	showOptions() {
		if (!this.options || !this.options.length) return;
		sendMessage("question-show-options", {});
	}

	showRandomResult(index, name) {
		const grid = document.getElementById("qGrid");
		if (!grid) return;
		const buttons = grid.querySelectorAll(
			".popup-student-btn:not(.popup-action-btn)",
		);
		buttons.forEach((b) => b.classList.remove("popup-student-btn-picked"));
		const btn = [...buttons].find((b) => b.textContent === name);
		if (!btn) return;
		btn.classList.add("popup-student-btn-picked");
		btn.scrollIntoView({ behavior: "smooth", block: "center" });
	}

	studentAnswered(idx) {
		const studentId =
			idx != null && idx >= 0 ? InteractionView.participantId(idx) : null;
		sendMessage("student-answered", { studentName: studentId });
		this.close();
	}

	closeUI() {
		this.clearTimer();
		this.close();
	}

	dismiss() {
		sendMessage("dismiss-question", {});
		this.closeUI();
	}
}
