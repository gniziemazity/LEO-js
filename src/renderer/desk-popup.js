const {
	renderSnippet,
	renderLines,
	renderTypedName,
} = require("../shared/snippet-view");
const { moveToDisplayName } = require("../shared/move-to-target");
const {
	DONE_LABEL,
	isQuestion,
	interactionTitle,
	waitingTitle,
	participantId,
} = require("../shared/interaction-view");

class DeskPopup {
	constructor(send) {
		this.send = send;
		this.el = null;
		this.kind = null;
		this.students = [];
		this.teacherName = "Teacher";
		this.options = null;
		this.interaction = null;
		this.moveToBody = null;
	}

	setStudents(students) {
		this.students = Array.isArray(students) ? students : [];
	}

	setTeacherName(name) {
		this.teacherName = name || "Teacher";
	}

	isOpen(kind) {
		return kind ? this.kind === kind : this.kind !== null;
	}

	close() {
		this.kind = null;
		this.interaction = null;
		this.moveToBody = null;
		if (this.el) {
			this.el.innerHTML = "";
			this.el.style.display = "none";
		}
	}

	closeIf(kind) {
		if (this.kind === kind) this.close();
	}

	_host() {
		if (!this.el) {
			this.el = document.createElement("div");
			this.el.className = "desk-popup";
			document.body.appendChild(this.el);
		}
		return this.el;
	}

	_open(kind, bgColor) {
		const el = this._host();
		el.innerHTML = "";
		el.style.display = "block";
		el.style.background = bgColor || "";
		this.kind = kind;
		return el;
	}

	_title(el, text) {
		const t = document.createElement("div");
		t.className = "desk-popup-title";
		t.textContent = text;
		el.appendChild(t);
		return t;
	}

	_body(el, className) {
		const b = document.createElement("div");
		b.className = `snippet-view desk-popup-body ${className || ""}`.trim();
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

	_grid(el) {
		const grid = document.createElement("div");
		grid.className = "desk-popup-grid";
		el.appendChild(grid);
		return grid;
	}

	_studentBtn(grid, label, onClick, extraClass) {
		const b = document.createElement("button");
		b.type = "button";
		b.className = `popup-student-btn${extraClass ? " " + extraClass : ""}`;
		b.textContent = label;
		b.addEventListener("click", onClick);
		grid.appendChild(b);
		return b;
	}

	showMoveTo({ mode, target, snippet, typeName }) {
		const el = this._open("move-to");
		const switchTo = mode === "anchor" && snippet ? snippet.switchTo : null;
		const canTypeName = mode === "file" && !!typeName;
		this._title(
			el,
			canTypeName
				? "Create file:"
				: switchTo
					? `Go to (${moveToDisplayName(switchTo)}):`
					: "Go to:",
		);
		const body = this._body(el);
		if (mode === "anchor" && renderSnippet(body, snippet)) {
		} else {
			renderTypedName(body, moveToDisplayName(target || "MAIN"), null);
			body.classList.add("desk-popup-plain");
			this.moveToBody = body;
		}
		const row = this._actions(el);
		if (canTypeName) {
			this._button(row, "Auto-type", () =>
				this._send("client-move-to-type-name"),
			);
			return;
		}
		this._button(row, "OK", () => this._act("client-move-to-confirmed"));
	}

	setMoveToTyped(data) {
		if (this.kind !== "move-to" || !this.moveToBody || !data) return;
		renderTypedName(this.moveToBody, data.target, data.typed);
	}

	showCodeInsert({ text, colored, paste }) {
		const el = this._open("code-insert");
		this._title(el, "Code snippet:");
		renderLines(this._body(el), text, colored);
		if (paste !== false) {
			const hint = document.createElement("div");
			hint.className = "desk-popup-hint";
			hint.textContent = "(to paste: Ctrl/⌘+V in your editor)";
			el.appendChild(hint);
		}
		this._button(this._actions(el), "OK", () =>
			this._act("client-code-insert-confirmed"),
		);
	}

	showQuestion({ question, options, students, bgColor }) {
		const el = this._open("question", bgColor);
		this.options = options && options.length ? options : null;
		const list = students && students.length ? students : null;
		this._title(el, question || "");

		const actions = this._actions(el);
		const show = this._button(actions, "Show", () => {
			this._send("client-show-question", true);
			show.remove();
			grid.style.display = "";
			if (list)
				this._button(
					actions,
					"🎲",
					() => this._randomize(list),
					"desk-popup-btn desk-popup-icon",
				);
			if (this.options)
				this._button(
					actions,
					"🔤",
					() => this._send("client-question-show-options"),
					"desk-popup-btn desk-popup-icon",
				);
		});
		this._button(
			actions,
			"✕",
			() => this._act("client-dismiss-question"),
			"desk-popup-btn desk-popup-icon",
		);

		const grid = this._grid(el);
		grid.style.display = "none";
		if (list) {
			list.forEach((name, i) =>
				this._studentBtn(grid, name, () => this._answered(i + 1)),
			);
		} else {
			this._studentBtn(grid, "Answered", () => this._answered(null));
		}
	}

	_randomize(list) {
		if (!list || !list.length) return;
		this._send("client-question-randomize");
	}

	_answered(studentId) {
		this._act("client-student-answered", studentId);
	}

	showInteraction(interactionType) {
		const asksQuestion = isQuestion(interactionType);
		if (!this.students.length) {
			this._send("client-interaction", interactionType);
			return;
		}
		const el = this._open("interaction");
		this.interaction = { type: interactionType, openedAt: Date.now() };
		this._title(el, interactionTitle(interactionType));

		let input = null;
		if (asksQuestion) {
			input = document.createElement("input");
			input.type = "text";
			input.className = "desk-popup-input";
			input.placeholder = "What did they ask?";
			el.appendChild(input);
		}

		const grid = this._grid(el);
		const pick = (idx) => () =>
			this._interactionPicked(idx, input ? input.value.trim() : null);
		this.students.forEach((name, i) => this._studentBtn(grid, name, pick(i)));
		if (asksQuestion)
			this._studentBtn(grid, this.teacherName, pick("teacher"));

		this._send("client-interaction-overlay-shown");
	}

	_interactionPicked(idx, questionText) {
		const it = this.interaction;
		if (!it) return;
		const isTeacher = idx === "teacher";
		it.studentName = participantId(idx);
		it.questionText = questionText || null;
		const name = isTeacher ? this.teacherName : (this.students[idx] ?? "");

		this._send(
			"client-show-student-interaction",
			it.type,
			it.studentName,
			it.questionText,
			it.openedAt,
		);

		const el = this._open("interaction", "");
		this.interaction = it;
		this._title(el, waitingTitle(it.type, name, it.questionText));
		this._button(
			this._actions(el),
			DONE_LABEL,
			() => this._interactionDone(),
			"desk-popup-btn desk-popup-done",
		);
	}

	_interactionDone() {
		const it = this.interaction;
		if (it && it.studentName !== undefined) {
			this._send(
				"client-close-student-interaction",
				it.type,
				it.studentName,
				it.questionText,
				it.openedAt,
				Date.now(),
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
