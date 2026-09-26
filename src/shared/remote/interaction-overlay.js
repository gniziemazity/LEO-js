class InteractionOverlay extends RemoteOverlay {
	constructor() {
		super("interactionOverlay");
		this.openedAt = null;
		this.waiting = false;
		this.pendingWaitingData = null;
		this.type = null;
		this.askerSelect = null;
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
		this.type = type;

		let bg = InteractionView.interactionBgVar(type);

		document.getElementById("iTitle").textContent = title;

		const grid = document.getElementById("iGrid");
		const asks = InteractionView.isQuestion(type);
		this.setQuestionForm(asks);
		if (asks) {
			this.askerSelect = InteractionView.fillAskerRow(
				document.getElementById("iAskerRow"),
				InteractionView.askerChoices(students, teacherName),
				(asker) =>
					(this.el.style.background = InteractionView.interactionBgVar(
						type,
						asker,
					)),
			);
			bg = InteractionView.interactionBgVar(
				type,
				InteractionView.askerFromValue(this.askerSelect.value),
			);
			document.getElementById("iQuestionInput").value = "";
			const micBtn = document.getElementById("iMicBtn");
			if (micBtn) {
				const hasSR = !!(
					window.SpeechRecognition || window.webkitSpeechRecognition
				);
				const canDictate = hasSR && window.isSecureContext;
				micBtn.style.display = canDictate ? "" : "none";
			}
			grid.innerHTML = "";
		} else {
			this.fillStudentGrid(
				grid,
				students,
				(idx) => () => this.studentSelected(idx, type),
			);
		}

		this.open(bg);
		sendMessage("interaction-overlay-shown", {});
	}

	setQuestionForm(visible) {
		for (const id of ["iAskerRow", "iQuestionRow"]) {
			document.getElementById(id).style.display = visible ? "flex" : "none";
		}
		document.getElementById("iShowBtn").style.display = visible
			? "block"
			: "none";
	}

	ask() {
		if (this.waiting || !InteractionView.isQuestion(this.type)) return;
		const asker = InteractionView.askerFromValue(
			this.askerSelect ? this.askerSelect.value : "",
		);
		const questionText = document
			.getElementById("iQuestionInput")
			.value.trim();
		this.startWaiting(asker, this.type, questionText);

		const grid = document.getElementById("iGrid");
		const answered = (idx) => () =>
			this.closeOverlay(InteractionView.participantId(idx));
		this.fillStudentGrid(grid, currentStudents, answered);
		grid.appendChild(
			this.makeStudentBtn(
				teacherName,
				answered(InteractionView.TEACHER_ASKER),
			),
		);
		grid.insertBefore(
			this.makeActionBtn("🎲", () => sendMessage("question-randomize", {})),
			grid.firstChild,
		);
	}

	studentSelected(idx, type) {
		this.startWaiting(idx, type, null);
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

	startWaiting(idx, type, questionText) {
		this.stopDictation();
		const isTeacher = idx === InteractionView.TEACHER_ASKER;
		const studentId =
			isTeacher || (idx != null && idx >= 0)
				? InteractionView.participantId(idx)
				: null;
		const name = isTeacher ? null : (currentStudents[idx] ?? "");
		const msgData = {
			interactionType: type,
			studentName: studentId,
			questionText: questionText || null,
			openedAt: this.openedAt,
		};
		sendMessage("show-student-interaction", msgData);

		this.waiting = true;
		this.pendingWaitingData = msgData;

		this.setQuestionForm(false);
		document.getElementById("iTitle").textContent =
			InteractionView.waitingTitle(type, name, questionText);
	}

	showRandomResult(index, name) {
		if (this.waiting) this.markPicked(document.getElementById("iGrid"), name);
	}

	closeOverlay(answeredBy = null) {
		this.stopDictation();
		if (this.waiting && this.pendingWaitingData) {
			sendMessage("close-student-interaction", {
				...this.pendingWaitingData,
				closedAt: Date.now(),
				answeredBy,
			});
		}
		this.waiting = false;
		this.pendingWaitingData = null;
		this.close();
		this.setQuestionForm(false);
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
