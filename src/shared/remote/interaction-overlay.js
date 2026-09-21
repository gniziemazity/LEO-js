class InteractionOverlay extends RemoteOverlay {
	constructor() {
		super("interactionOverlay");
		this.openedAt = null;
		this.waiting = false;
		this.pendingWaitingData = null;
		this._recognition = null;
		this._starting = false;
	}

	chromeClose() {
		this.closeOverlay();
	}

	handleBtn(interactionType) {
		if (currentStudents.length > 0) {
			this.openedAt = Date.now();
			this.show(
				InteractionView.interactionTitle(interactionType),
				currentStudents,
				interactionType,
			);
		} else {
			sendMessage("interaction", { interactionType });
		}
	}

	show(title, students, type) {
		const modal = document.getElementById("iModal");
		modal.className = "popup-modal";

		const bg = InteractionView.interactionBgVar(type);

		document.getElementById("iTitle").textContent = title;

		const questionInput = document.getElementById("iQuestionInput");
		const questionRow = document.getElementById("iQuestionRow");
		if (InteractionView.isQuestion(type)) {
			questionRow.style.display = "flex";
			questionInput.value = "";
			const micBtn = document.getElementById("iMicBtn");
			if (micBtn) {
				const hasSR = !!(
					window.SpeechRecognition || window.webkitSpeechRecognition
				);
				const canDictate = hasSR && window.isSecureContext;
				micBtn.style.display = canDictate ? "" : "none";
			}
		} else {
			questionRow.style.display = "none";
		}

		const grid = document.getElementById("iGrid");
		const pick = (idx) => () => {
			const qText = InteractionView.isQuestion(type)
				? questionInput.value.trim()
				: null;
			this.studentSelected(idx, type, qText);
		};
		this.fillStudentGrid(grid, students, pick);
		if (InteractionView.isQuestion(type)) {
			grid.appendChild(this.makeStudentBtn(teacherName, pick("teacher")));
		}

		this.open(bg);
		sendMessage("interaction-overlay-shown", {});
	}

	studentSelected(idx, type, questionText) {
		this.stopDictation();
		const isTeacher = idx === "teacher";
		const studentId =
			isTeacher || (idx != null && idx >= 0)
				? InteractionView.participantId(idx)
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

		document.getElementById("iQuestionRow").style.display = "none";
		document.getElementById("iTitle").textContent =
			InteractionView.waitingTitle(type, name, questionText);

		const grid = document.getElementById("iGrid");
		grid.innerHTML = "";
		grid.appendChild(
			this.makeStudentBtn(
				InteractionView.DONE_LABEL,
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
		// keeping final form of recognized phrase
		const tidy = (s) =>
			String(s || "")
				.replace(/\s+/g, " ")
				.trim();
		const continues = (whole, part) =>
			whole.startsWith(part) &&
			(whole.length === part.length || whole[part.length] === " ");

		rec.onresult = (e) => {
			let heard = "";
			for (let i = 0; i < e.results.length; i++) {
				const next = tidy(e.results[i][0].transcript);
				if (!next) continue;
				if (!heard) {
					heard = next;
					continue;
				}
				const a = heard.toLowerCase();
				const b = next.toLowerCase();
				if (continues(b, a)) heard = next;
				else if (!continues(a, b) && !a.endsWith(b)) heard += " " + next;
			}
			input.value = [base, heard].filter(Boolean).join(" ");
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
