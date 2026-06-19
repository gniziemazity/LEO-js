class QuestionOverlay extends RemoteOverlay {
	constructor() {
		super("questionOverlay");
		this.autoCloseTimer = null;
	}

	clearTimer() {
		if (this.autoCloseTimer) {
			clearTimeout(this.autoCloseTimer);
			this.autoCloseTimer = null;
		}
	}

	show(question, students, bgColor) {
		this.clearTimer();

		document.getElementById("qText").textContent = question;

		const grid = document.getElementById("qGrid");
		const answered = document.getElementById("qAnsweredRow");
		const showBtn = document.getElementById("qShowBtn");
		grid.innerHTML = "";
		grid.style.display = "none";
		answered.style.display = "none";
		if (showBtn) showBtn.style.display = "block";
		document.getElementById("qCloseBarFill").style.transition = "none";
		document.getElementById("qCloseBarFill").style.width = "0%";

		const list = students && students.length ? students : null;

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

		this.open(bgColor ? bgColor : "var(--clr-q-bg)");
	}

	showToTeacher() {
		sendMessage("show-question", {});
		const showBtn = document.getElementById("qShowBtn");
		if (showBtn) showBtn.style.display = "none";
		document.getElementById("qGrid").style.display = "flex";
	}

	studentAnswered(idx) {
		const studentId = idx != null && idx >= 0 ? idx + 1 : null;
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
