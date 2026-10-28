const {
	renderExcerpt,
	renderLines,
	renderTypedName,
} = require("../shared/excerpt-view");
const { goToDisplayName, goToPopupTitle } = require("../shared/go-to-target");
const { POPUP_TITLES } = require("../shared/blocks");
const {
	DONE_LABEL,
	ANSWERED_LABEL,
	TEACHER_ASKER,
	isQuestion,
	interactionTitle,
	waitingTitle,
	participantId,
	waitingName,
	sortedStudentIndexes,
	askerChoices,
	askerFromValue,
	fillAskerRow,
	QUESTION_BG,
} = require("../shared/interaction-view");

class DeskPopup {
	constructor(send) {
		this.send = send;
		this.el = null;
		this.type = null;
		this.students = [];
		this.teacherName = "Teacher";
		this.confirmKey = "";
		this.options = null;
		this.interaction = null;
		this.goToBody = null;
	}

	setStudents(students) {
		this.students = Array.isArray(students) ? students : [];
	}

	setTeacherName(name) {
		this.teacherName = name || "Teacher";
	}

	setConfirmKey(accelerator) {
		this.confirmKey = String(accelerator || "").replace(
			/CommandOrControl|CmdOrCtrl/g,
			"Ctrl/⌘",
		);
	}

	isOpen(type) {
		return type ? this.type === type : this.type !== null;
	}

	close() {
		this.type = null;
		this.interaction = null;
		this.goToBody = null;
		if (this.el) {
			this.el.innerHTML = "";
			this.el.style.display = "none";
		}
	}

	closeIf(type) {
		if (this.type === type) this.close();
	}

	_host() {
		if (!this.el) {
			this.el = document.createElement("div");
			this.el.className = "desk-popup";
			document.body.appendChild(this.el);
		}
		return this.el;
	}

	_open(type, bgColor) {
		const el = this._host();
		el.innerHTML = "";
		el.style.display = "block";
		el.style.background = bgColor || "";
		this.type = type;
		return el;
	}

	_title(el, text) {
		return this._panel(el, "desk-popup-title", text);
	}

	_body(el, className) {
		const b = document.createElement("div");
		b.className = `excerpt-view desk-popup-body ${className || ""}`.trim();
		el.appendChild(b);
		return b;
	}

	_actions(el) {
		const row = document.createElement("div");
		row.className = "desk-popup-actions";
		el.appendChild(row);
		return row;
	}

	_button(row, label, onClick, className) {
		const b = document.createElement("button");
		b.type = "button";
		b.className = className || "desk-popup-btn";
		b.textContent = label;
		b.addEventListener("click", onClick);
		row.appendChild(b);
		return b;
	}

	_fillStudentGrid(
		el,
		students,
		makeOnClick,
		indexes = sortedStudentIndexes(students),
	) {
		const grid = document.createElement("div");
		grid.className = "desk-popup-grid";
		el.appendChild(grid);
		for (const i of indexes) {
			this._studentBtn(grid, students[i], makeOnClick(i));
		}
		return grid;
	}

	_askerRow(el, choices, onChange) {
		const row = document.createElement("div");
		row.className = "asker-row";
		el.appendChild(row);
		return fillAskerRow(row, choices, onChange);
	}

	_studentBtn(grid, label, onClick) {
		return this._button(grid, label, onClick, "popup-student-btn");
	}

	showGoTo({ mode, target, excerpt, typeName, note }) {
		const el = this._open("go-to");
		const canTypeName = mode === "file" && !!typeName;
		this._title(el, goToPopupTitle({ mode, excerpt, typeName }));
		if (note) this._panel(el, "popup-note", note);
		const named = mode !== "anchor";
		if (named) this._goToName(el, target);
		if (!this._excerptBody(el, excerpt) && !named) this._goToName(el, target);
		const row = this._actions(el);
		if (canTypeName) {
			this._button(row, "Type name", () =>
				this._send("client-go-to-type-name"),
			);
			return;
		}
		this._button(row, "OK", () => this._act("client-go-to-confirmed"));
	}

	_goToName(el, target) {
		const body = this._body(el, "desk-popup-plain");
		renderTypedName(body, goToDisplayName(target || "MAIN"), null);
		this.goToBody = body;
	}

	_excerptBody(el, excerpt) {
		if (!excerpt) return false;
		const body = this._body(el);
		if (renderExcerpt(body, excerpt)) return true;
		body.remove();
		return false;
	}

	setGoToTyped(data) {
		if (this.type !== "go-to" || !this.goToBody || !data) return;
		renderTypedName(this.goToBody, data.target, data.typed);
	}

	showSnippet({ text, colored, paste }) {
		const el = this._open("snippet");
		this._title(el, "Code snippet:");
		renderLines(this._body(el), text, colored);
		if (paste !== false) {
			const hint = document.createElement("div");
			hint.className = "desk-popup-hint";
			hint.textContent = this.confirmKey
				? `(to paste: Ctrl/⌘+V in your editor, or ${this.confirmKey} to paste and carry on)`
				: "(to paste: Ctrl/⌘+V in your editor)";
			el.appendChild(hint);
		}
		this._button(this._actions(el), "OK", () =>
			this._act("client-snippet-confirmed"),
		);
	}

	_panel(el, className, text) {
		const p = document.createElement("div");
		p.className = className;
		p.textContent = text || "";
		el.appendChild(p);
		return p;
	}

	showNote({ text }) {
		const el = this._open("note");
		this._title(el, POPUP_TITLES.note);
		this._panel(el, "popup-note note-modal-text", text);
		this._button(this._actions(el), "OK", () =>
			this._act("client-note-confirmed"),
		);
	}

	showMedia({ type, name }) {
		const el = this._open(type);
		this._title(el, POPUP_TITLES[type] || "");
		this._panel(el, "media-modal-panel", name);
		this._button(this._actions(el), "OK", () =>
			this._act("client-media-confirmed"),
		);
	}

	showQuestion({ question, options, students, bgColor }) {
		const el = this._open("question", bgColor);
		this.options = options && options.length ? options : null;
		const list = students && students.length ? students : null;
		this._title(el, question || "");

		const actions = this._actions(el);
		let revealed = false;
		const reveal = () => {
			if (revealed) return;
			revealed = true;
			show.remove();
			grid.style.display = "";
			if (list)
				this._button(
					actions,
					"🎲",
					() => this._send("client-question-randomize"),
					"desk-popup-btn desk-popup-icon",
				);
			if (this.options)
				this._button(
					actions,
					"🔤",
					() => this._send("client-question-show-options"),
					"desk-popup-btn desk-popup-icon",
				);
		};
		const show = this._button(actions, "Show", () => {
			this._send("client-show-question", true);
			reveal();
		});
		this._revealQuestionUI = reveal;
		this._button(
			actions,
			"✕",
			() => this._act("client-dismiss-question"),
			"desk-popup-btn desk-popup-icon",
		);

		const grid = this._fillStudentGrid(
			el,
			list || [],
			(i) => () => this._answered(participantId(i)),
		);
		grid.style.display = "none";
		if (!list)
			this._studentBtn(grid, ANSWERED_LABEL, () => this._answered(null));
		this._studentBtn(grid, this.teacherName, () =>
			this._answered(participantId(TEACHER_ASKER)),
		);
	}

	revealQuestion() {
		if (this.type === "question" && this._revealQuestionUI) {
			this._revealQuestionUI();
		}
	}

	_answered(studentId) {
		this._act("client-student-answered", studentId);
	}

	showInteraction(interactionType) {
		if (!this.students.length) {
			this._send("client-interaction", interactionType);
			return;
		}
		const el = this._open("interaction");
		this.interaction = { type: interactionType, openedAt: Date.now() };
		this._title(el, interactionTitle(interactionType));

		if (isQuestion(interactionType)) {
			const asker = this._askerRow(
				el,
				askerChoices(this.students, this.teacherName),
				(picked) => (el.style.background = this._askerBg(picked)),
			);
			el.style.background = this._askerBg(askerFromValue(asker.value));
			const input = document.createElement("input");
			input.type = "text";
			input.className = "desk-popup-input";
			input.placeholder = "What was asked?";
			el.appendChild(input);
			const actions = this._actions(el);
			this._button(actions, "Show", () =>
				this._questionAsked(
					askerFromValue(asker.value),
					input.value.trim(),
				),
			);
			this._button(
				actions,
				"✕",
				() => this._interactionDone(),
				"desk-popup-btn desk-popup-icon",
			);
		} else {
			this._fillStudentGrid(
				el,
				this.students,
				(idx) => () => this._interactionPicked(idx),
			);
		}

		this._send("client-interaction-overlay-shown");
	}

	_startInteraction(idx, questionText) {
		const it = this.interaction;
		it.studentName = participantId(idx);
		it.questionText = questionText || null;
		const name = waitingName(idx, this.students);

		this._send(
			"client-show-student-interaction",
			it.type,
			it.studentName,
			it.questionText,
			it.openedAt,
		);

		const el = this._open("interaction", this._askerBg(idx));
		this.interaction = it;
		this._title(el, waitingTitle(it.type, name, it.questionText));
		return el;
	}

	_askerBg(asker) {
		return asker === TEACHER_ASKER ? QUESTION_BG : "";
	}

	_interactionPicked(idx) {
		if (!this.interaction) return;
		const el = this._startInteraction(idx, null);
		this._button(
			this._actions(el),
			DONE_LABEL,
			() => this._interactionDone(),
			"desk-popup-btn desk-popup-done",
		);
	}

	_questionAsked(asker, questionText) {
		if (!this.interaction) return;
		const el = this._startInteraction(asker, questionText);
		const actions = this._actions(el);
		this._button(
			actions,
			"🎲",
			() => this._send("client-question-randomize"),
			"desk-popup-btn desk-popup-icon",
		);
		this._button(
			actions,
			"✕",
			() => this._interactionDone(),
			"desk-popup-btn desk-popup-icon",
		);
		const answered = (idx) => () => this._interactionDone(participantId(idx));
		const grid = this._fillStudentGrid(el, this.students, answered);
		this._studentBtn(grid, this.teacherName, answered(TEACHER_ASKER));
	}

	_interactionDone(answeredBy = null) {
		const it = this.interaction;
		if (it && it.studentName !== undefined) {
			this._send(
				"client-close-student-interaction",
				it.type,
				it.studentName,
				it.questionText,
				it.openedAt,
				Date.now(),
				answeredBy,
			);
		}
		this.close();
		this._send("client-interaction-overlay-closed");
	}

	_send(type, ...args) {
		this.send(type, args);
	}

	_act(type, ...args) {
		this.close();
		this.send(type, args);
	}
}

module.exports = DeskPopup;
