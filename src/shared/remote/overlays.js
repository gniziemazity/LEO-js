let currentStudents = [];
let pendingInteraction = null;
let autoCloseTimer = null;
let interactionOpenedAt = null;

const AUTO_CLOSE_MS = 3000;

function formatAnsweredText(name) {
	return name ? `✅ Answered by ${name}` : "✅ Answered";
}

function hexToRgba(hex, alpha) {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	return `rgba(${r},${g},${b},${alpha})`;
}

function setStudents(students) {
	currentStudents = students || [];
}

function showQuestionOverlay(question, students, bgColor) {
	clearAutoCloseTimer();

	document.getElementById("qText").textContent = question;

	const overlay = document.getElementById("questionOverlay");
	overlay.style.background = bgColor
		? hexToRgba(bgColor, 0.94)
		: "rgba(0,0,0,0.78)";

	const grid = document.getElementById("qGrid");
	const subtitle = document.getElementById("qSubtitle");
	const answered = document.getElementById("qAnsweredRow");
	grid.innerHTML = "";
	grid.style.display = "flex";
	subtitle.style.display = "";
	answered.style.display = "none";
	document.getElementById("qCloseBarFill").style.transition = "none";
	document.getElementById("qCloseBarFill").style.width = "0%";

	const list = students && students.length ? students : null;

	if (list) {
		subtitle.textContent = "Who answered?";
		list.forEach((name) => {
			const btn = document.createElement("button");
			btn.className = "q-student-btn";
			btn.textContent = name;
			btn.onclick = () => onStudentAnswered(name);
			grid.appendChild(btn);
		});
	} else {
		subtitle.textContent = "";
		const btn = document.createElement("button");
		btn.className = "q-student-btn";
		btn.style.cssText = "width:100%;margin-bottom:4px";
		btn.textContent = "✅ Answered";
		btn.onclick = () => onStudentAnswered(null);
		grid.appendChild(btn);
	}

	overlay.classList.add("active");
}

function onStudentAnswered(name) {
	sendMessage("student-answered", { studentName: name });

	document.getElementById("qGrid").style.display = "none";
	document.getElementById("qSubtitle").style.display = "none";

	const answeredRow = document.getElementById("qAnsweredRow");
	const answeredText = document.getElementById("qAnsweredText");
	answeredText.textContent = formatAnsweredText(name);
	answeredRow.style.display = "flex";

	const fill = document.getElementById("qCloseBarFill");
	fill.style.transition = "none";
	fill.style.width = "0%";
	requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			fill.style.transition = `width ${AUTO_CLOSE_MS}ms linear`;
			fill.style.width = "100%";
		});
	});

	autoCloseTimer = setTimeout(() => hideQuestionOverlay(), AUTO_CLOSE_MS);
}

function hideQuestionOverlay() {
	clearAutoCloseTimer();
	document.getElementById("questionOverlay").classList.remove("active");
}

function clearAutoCloseTimer() {
	if (autoCloseTimer) {
		clearTimeout(autoCloseTimer);
		autoCloseTimer = null;
	}
}

function handleInteractionBtn(interactionType) {
	if (currentStudents.length > 0) {
		pendingInteraction = interactionType;
		interactionOpenedAt = Date.now();
		const isQuestion = interactionType === "student-question";
		const title = isQuestion
			? "❓ Who asked a question?"
			: "🤝 Who needs help?";
		showInteractionOverlay(title, currentStudents, interactionType);
	} else {
		sendMessage("interaction", { interactionType });
	}
}

function showInteractionOverlay(title, students, type) {
	const modal = document.getElementById("iModal");
	modal.className = "i-modal";
	if (type === "student-question") {
		modal.classList.add("type-student-question");
		document.getElementById("interactionOverlay").style.background =
			"rgba(120,50,0,0.82)";
	} else {
		modal.classList.add("type-providing-help");
		document.getElementById("interactionOverlay").style.background =
			"rgba(0,80,30,0.82)";
	}

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
	grid.innerHTML = "";
	students.forEach((name) => {
		const btn = document.createElement("button");
		btn.className = "i-student-btn";
		btn.textContent = name;
		btn.onclick = () => {
			const qText =
				type === "student-question" ? questionInput.value.trim() : null;
			const msgData = {
				interactionType: pendingInteraction,
				studentName: name,
				openedAt: interactionOpenedAt,
				closedAt: Date.now(),
			};
			if (qText) msgData.questionText = qText;
			sendMessage("student-interaction", msgData);
			closeInteractionOverlay();
		};
		grid.appendChild(btn);
	});
	document.getElementById("interactionOverlay").classList.add("active");
}

function closeInteractionOverlay() {
	document.getElementById("interactionOverlay").classList.remove("active");
	document.getElementById("iQuestionInput").style.display = "none";
	pendingInteraction = null;
}
