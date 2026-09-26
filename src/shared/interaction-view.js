(function (root) {
	const TEACHER_ID = 0;
	const DONE_LABEL = "✓ Done — close";
	const ASKED_BY_LABEL = "Asked by";
	const TEACHER_ASKER = "teacher";

	function isQuestion(type) {
		return type === "student-question";
	}

	function interactionTitle(type) {
		return isQuestion(type) ? "❓ Question" : "🤝 Who needs help?";
	}

	function waitingTitle(type, name, questionText) {
		if (!isQuestion(type)) return `🤝 Helping ${name}`;
		if (name === null) return questionText || interactionTitle(type);
		return `❓ ${name}${questionText ? ": " + questionText : ""}`;
	}

	function isTeacher(participant) {
		return participant === TEACHER_ID;
	}

	function participantId(idx) {
		return idx === TEACHER_ASKER ? TEACHER_ID : idx + 1;
	}

	function sortedStudentIndexes(students) {
		return students
			.map((_, idx) => idx)
			.sort((a, b) =>
				String(students[a]).localeCompare(String(students[b]), undefined, {
					sensitivity: "base",
				}),
			);
	}

	function askerChoices(students, teacherName) {
		return [
			{ value: TEACHER_ASKER, label: teacherName },
			...sortedStudentIndexes(students).map((idx) => ({
				value: String(idx),
				label: String(students[idx]),
			})),
		];
	}

	function askerFromValue(value) {
		const idx = Number(value);
		return value !== "" && Number.isInteger(idx) && idx >= 0
			? idx
			: TEACHER_ASKER;
	}

	function questionLogEntry({
		studentName,
		questionText,
		answeredBy,
		openedAt,
		closedAt,
	}) {
		const teacherAsked = isTeacher(studentName);
		const fields = teacherAsked ? {} : { asked_by: studentName };
		if (questionText) fields.info = questionText;
		fields.answered_by = answeredBy ?? null;
		if (openedAt) fields.timestamp = openedAt;
		if (closedAt) fields.closed_at = closedAt;
		return [teacherAsked ? "teacher-question" : "student-question", fields];
	}

	function fillAskerRow(row, choices, onChange) {
		row.innerHTML = "";
		const label = document.createElement("label");
		label.className = "asker-label";
		label.textContent = ASKED_BY_LABEL;
		const select = document.createElement("select");
		select.className = "asker-select";
		for (const choice of choices) {
			const option = document.createElement("option");
			option.value = choice.value;
			option.textContent = choice.label;
			select.appendChild(option);
		}
		if (onChange) select.onchange = () => onChange(askerFromValue(select.value));
		label.appendChild(select);
		row.appendChild(label);
		return select;
	}

	const INTERACTION_BG = {
		question: "rgb(255, 224, 178)",
		help: "rgb(200, 230, 201)",
	};
	const QUESTION_BG = "var(--clr-question-bg)";

	function interactionBgVar(type, asker) {
		if (!isQuestion(type)) return "var(--clr-help-bg)";
		return asker === TEACHER_ASKER ? QUESTION_BG : "var(--clr-ask-bg)";
	}

	function interactionBgColor(type) {
		return isQuestion(type) ? INTERACTION_BG.question : INTERACTION_BG.help;
	}

	const api = {
		DONE_LABEL,
		ASKED_BY_LABEL,
		TEACHER_ASKER,
		isQuestion,
		interactionTitle,
		waitingTitle,
		isTeacher,
		participantId,
		sortedStudentIndexes,
		askerChoices,
		askerFromValue,
		questionLogEntry,
		fillAskerRow,
		INTERACTION_BG,
		QUESTION_BG,
		interactionBgVar,
		interactionBgColor,
	};

	if (typeof module !== "undefined" && module.exports) {
		module.exports = api;
	}
	root.InteractionView = api;
})(typeof window !== "undefined" ? window : this);
