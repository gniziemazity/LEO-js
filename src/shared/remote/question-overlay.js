class QuestionOverlay extends RemoteOverlay {
	constructor() {
		super("questionOverlay");
	}

	keepsInteractionBtns() {
		return false;
	}

	show(question, students, bgColor, options) {
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
					InteractionView.ANSWERED_LABEL,
					() => this.studentAnswered(null),
					"width:100%;margin-bottom:4px",
				),
			);
		}
		grid.appendChild(
			this.makeStudentBtn(teacherName, () =>
				this.studentAnswered(InteractionView.TEACHER_ASKER),
			),
		);

		grid.insertBefore(this.buildActionButtons(), grid.firstChild);

		this.open(bgColor ? bgColor : "var(--clr-question-bg)");
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
		this.markPicked(document.getElementById("qGrid"), name);
	}

	studentAnswered(idx) {
		sendMessage("student-answered", {
			studentName: InteractionView.answererId(idx),
		});
		this.close();
	}

	dismiss() {
		sendMessage("dismiss-question", {});
		this.closeUI();
	}
}
