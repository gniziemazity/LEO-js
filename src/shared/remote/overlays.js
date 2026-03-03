let currentStudents = [];
let pendingInteraction = null;
let autoCloseTimer = null;
let interactionOpenedAt = null;
let interactionWaiting = false;
let pendingWaitingData = null;

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
		: "rgba(255,235,238,0.94)";

	const grid = document.getElementById("qGrid");
	const answered = document.getElementById("qAnsweredRow");
	grid.innerHTML = "";
	grid.style.display = "flex";
	answered.style.display = "none";
	document.getElementById("qCloseBarFill").style.transition = "none";
	document.getElementById("qCloseBarFill").style.width = "0%";

	const list = students && students.length ? students : null;

	if (list) {
		list.forEach((name) => {
			const btn = document.createElement("button");
			btn.className = "q-student-btn";
			btn.textContent = name;
			btn.onclick = () => onStudentAnswered(name);
			grid.appendChild(btn);
		});
	} else {
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
		document.getElementById("interactionOverlay").style.background =
			"rgb(255,224,178)";
	} else {
		document.getElementById("interactionOverlay").style.background =
			"rgb(200,230,201)";
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
			onStudentSelected(name, type, qText);
		};
		grid.appendChild(btn);
	});
	document.getElementById("interactionOverlay").classList.add("active");
}

function onStudentSelected(name, type, questionText) {
	const msgData = {
		interactionType: type,
		studentName: name,
		questionText: questionText || null,
		openedAt: interactionOpenedAt,
	};
	sendMessage("show-student-interaction", msgData);

	interactionWaiting = true;
	pendingWaitingData = msgData;

	const isQuestion = type === "student-question";
	document.getElementById("iQuestionInput").style.display = "none";
	document.getElementById("iTitle").textContent = isQuestion
		? `❓ ${name}${questionText ? ": " + questionText : ""}`
		: `🤝 Helping ${name}`;

	const grid = document.getElementById("iGrid");
	grid.innerHTML = "";
	const doneBtn = document.createElement("button");
	doneBtn.className = "i-student-btn";
	doneBtn.style.cssText =
		"width:100%;margin-top:8px;padding:14px;font-size:1rem;" +
		"background:rgba(231,76,60,0.15);border-color:rgba(231,76,60,0.4);color:rgba(0,0,0,0.75);";
	doneBtn.textContent = "✓ Done — close";
	doneBtn.onclick = () => closeInteractionOverlay();
	grid.appendChild(doneBtn);
}

function closeInteractionOverlay() {
	if (interactionWaiting && pendingWaitingData) {
		sendMessage("close-student-interaction", {
			...pendingWaitingData,
			closedAt: Date.now(),
		});
	}
	interactionWaiting = false;
	pendingWaitingData = null;
	document.getElementById("interactionOverlay").classList.remove("active");
	document.getElementById("iQuestionInput").style.display = "none";
	pendingInteraction = null;
}
