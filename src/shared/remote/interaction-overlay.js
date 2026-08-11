class InteractionOverlay extends RemoteOverlay {
	constructor() {
		super("interactionOverlay");
		this.openedAt = null;
		this.waiting = false;
		this.pendingWaitingData = null;
		this._recognition = null;
		this._starting = false;
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
		const questionRow = document.getElementById("iQuestionRow");
		if (type === "student-question") {
			questionRow.style.display = "flex";
			questionInput.value = "";
			const micBtn = document.getElementById("iMicBtn");
			if (micBtn) {
				const hasSR = !!(
					window.SpeechRecognition || window.webkitSpeechRecognition
				);
				const canDictate =
					hasSR && window.isSecureContext && !IS_CONTROL_PANEL;
				micBtn.style.display = canDictate ? "" : "none";
			}
		} else {
			questionRow.style.display = "none";
		}

		const grid = document.getElementById("iGrid");
		const pick = (idx) => () => {
			const qText =
				type === "student-question" ? questionInput.value.trim() : null;
			this.studentSelected(idx, type, qText);
		};
		this.fillStudentGrid(grid, students, pick);
		if (type === "student-question") {
			grid.appendChild(this.makeStudentBtn(teacherName, pick("teacher")));
		}

		this.open(bg);
		sendMessage("interaction-overlay-shown", {});
	}

	studentSelected(idx, type, questionText) {
		this.stopDictation();
		const isTeacher = idx === "teacher";
		const studentId = isTeacher
			? 0
			: idx != null && idx >= 0
				? idx + 1
				: null;
		const name = isTeacher ? teacherName : (currentStudents[idx] ?? "");
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
		document.getElementById("iQuestionRow").style.display = "none";
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
		this.stopDictation();
		if (this.waiting && this.pendingWaitingData) {
			sendMessage("close-student-interaction", {
				...this.pendingWaitingData,
				closedAt: Date.now(),
			});
		}
		this.waiting = false;
		this.pendingWaitingData = null;
		this.close();
		document.getElementById("iQuestionRow").style.display = "none";
		sendMessage("interaction-overlay-closed", {});
	}

	toggleDictation() {
		if (this._starting) return;
		if (this._recognition) {
			this.stopDictation();
			return;
		}
		const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
		const input = document.getElementById("iQuestionInput");
		if (!SR || !input) return;
		const rec = new SR();
		rec.lang = navigator.language || "en-US";
		rec.interimResults = true;
		rec.continuous = true;
		const base = input.value.trim();
		rec.onresult = (e) => {
			let txt = "";
			for (let i = 0; i < e.results.length; i++) {
				txt += e.results[i][0].transcript;
			}
			input.value = [base, txt.trim()].filter(Boolean).join(" ");
		};
		rec.onstart = () => {
			const micBtn = document.getElementById("iMicBtn");
			if (micBtn) micBtn.classList.add("listening");
		};
		rec.onend = () => this.stopDictation();
		rec.onerror = () => this.stopDictation();
		this._recognition = rec;
		this._starting = true;
		try {
			rec.start();
		} catch (e) {
			this._recognition = null;
			this.stopDictation();
		} finally {
			this._starting = false;
		}
	}

	stopDictation() {
		if (this._recognition) {
			try {
				this._recognition.stop();
			} catch (e) {}
			this._recognition = null;
		}
		const micBtn = document.getElementById("iMicBtn");
		if (micBtn) {
			micBtn.classList.remove("listening");
			micBtn.blur();
		}
	}
}
