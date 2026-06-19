class InteractionOverlay extends RemoteOverlay {
	constructor() {
		super("interactionOverlay");
		this.openedAt = null;
		this.waiting = false;
		this.pendingWaitingData = null;
	}

	handleBtn(interactionType) {
		if (currentStudents.length > 0) {
			this.openedAt = Date.now();
			const isQuestion = interactionType === "student-question";
			const title = isQuestion
				? "❓ Who asked a question?"
				: "🤝 Who needs help?";
			this.show(title, currentStudents, interactionType);
		} else {
			sendMessage("interaction", { interactionType });
		}
	}

	show(title, students, type) {
		const modal = document.getElementById("iModal");
		modal.className = "popup-modal";

		const bg =
			type === "student-question"
				? "var(--clr-ask-bg)"
				: "var(--clr-help-bg)";

		document.getElementById("iTitle").textContent = title;

		const questionInput = document.getElementById("iQuestionInput");
		if (type === "student-question") {
			questionInput.style.display = "block";
			questionInput.value = "";
			setTimeout(() => questionInput.focus(), 100);
		} else {
			questionInput.style.display = "none";
		}

		const grid = document.getElementById("iGrid");
		this.fillStudentGrid(grid, students, (idx) => () => {
			const qText =
				type === "student-question" ? questionInput.value.trim() : null;
			this.studentSelected(idx, type, qText);
		});

		this.open(bg);
		sendMessage("interaction-overlay-shown", {});
	}

	studentSelected(idx, type, questionText) {
		const studentId = idx != null && idx >= 0 ? idx + 1 : null;
		const name = currentStudents[idx] ?? "";
		const msgData = {
			interactionType: type,
			studentName: studentId,
			questionText: questionText || null,
			openedAt: this.openedAt,
		};
		sendMessage("show-student-interaction", msgData);

		this.waiting = true;
		this.pendingWaitingData = msgData;

		const isQuestion = type === "student-question";
		document.getElementById("iQuestionInput").style.display = "none";
		document.getElementById("iTitle").textContent = isQuestion
			? `❓ ${name}${questionText ? ": " + questionText : ""}`
			: `🤝 Helping ${name}`;

		const grid = document.getElementById("iGrid");
		grid.innerHTML = "";
		grid.appendChild(
			this.makeStudentBtn(
				"✓ Done — close",
				() => this.closeOverlay(),
				"width:100%;margin-top:8px;padding:14px;font-size:1rem;" +
					"background:var(--clr-done-bg);border-color:var(--clr-done-border);color:rgba(0,0,0,0.75);",
			),
		);
	}

	closeOverlay() {
		if (this.waiting && this.pendingWaitingData) {
			sendMessage("close-student-interaction", {
				...this.pendingWaitingData,
				closedAt: Date.now(),
			});
		}
		this.waiting = false;
		this.pendingWaitingData = null;
		this.close();
		document.getElementById("iQuestionInput").style.display = "none";
		sendMessage("interaction-overlay-closed", {});
	}
}
