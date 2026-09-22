(function (root) {
	const TEACHER_ID = 0;
	const DONE_LABEL = "✓ Done — close";

	function isQuestion(type) {
		return type === "student-question";
	}

	function interactionTitle(type) {
		return isQuestion(type)
			? "❓ Who asked a question?"
			: "🤝 Who needs help?";
	}

	function waitingTitle(type, name, questionText) {
		if (!isQuestion(type)) return `🤝 Helping ${name}`;
		return `❓ ${name}${questionText ? ": " + questionText : ""}`;
	}

	function participantId(idx) {
		return idx === "teacher" ? TEACHER_ID : idx + 1;
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

	const INTERACTION_BG = {
		question: "rgb(255, 224, 178)",
		help: "rgb(200, 230, 201)",
	};

	function interactionBgVar(type) {
		return isQuestion(type) ? "var(--clr-ask-bg)" : "var(--clr-help-bg)";
	}

	function interactionBgColor(type) {
		return isQuestion(type) ? INTERACTION_BG.question : INTERACTION_BG.help;
	}

	const api = {
		DONE_LABEL,
		isQuestion,
		interactionTitle,
		waitingTitle,
		participantId,
		sortedStudentIndexes,
		INTERACTION_BG,
		interactionBgVar,
		interactionBgColor,
	};

	if (typeof module !== "undefined" && module.exports) {
		module.exports = api;
	}
	root.InteractionView = api;
})(typeof window !== "undefined" ? window : this);
