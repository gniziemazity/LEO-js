let currentStudents = [];
let pendingInteraction = null;
let autoCloseTimer = null;
let interactionOpenedAt = null;
let interactionWaiting = false;
let pendingWaitingData = null;

const AUTO_CLOSE_MS = 3000;

function setInteractionBtnsVisible(visible) {
	document
		.querySelectorAll(".mode-side-btn-question, .mode-side-btn-help")
		.forEach((btn) => (btn.style.display = visible ? "" : "none"));
}

function formatAnsweredText(name) {
	return name ? `Answered by ${name}` : "Answered";
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
	overlay.style.background = bgColor ? bgColor : "rgb(255,235,238)";

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
		btn.textContent = "Answered";
		btn.onclick = () => onStudentAnswered(null);
		grid.appendChild(btn);
	}

	overlay.classList.add("active");
	setInteractionBtnsVisible(false);
}

function onStudentAnswered(name) {
	const studentId = name ? currentStudents.indexOf(name) + 1 : null;
	sendMessage("student-answered", { studentName: studentId });

	document.getElementById("questionOverlay").classList.remove("active");
	setInteractionBtnsVisible(true);
}

function hideQuestionOverlay() {
	clearAutoCloseTimer();
	sendMessage("dismiss-question", {});
	document.getElementById("questionOverlay").classList.remove("active");
	setInteractionBtnsVisible(true);
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
	setInteractionBtnsVisible(false);
}

function onStudentSelected(name, type, questionText) {
	const studentId = currentStudents.indexOf(name) + 1;
	const msgData = {
		interactionType: type,
		studentName: studentId,
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

function makeSegSpan(text, color) {
	const span = document.createElement("span");
	span.textContent = text;
	if (color) span.style.color = color;
	return span;
}

function renderLine(row, segs) {
	for (const seg of segs) row.appendChild(makeSegSpan(seg.text, seg.color));
}

function makeCursorSpan() {
	const cursor = document.createElement("span");
	cursor.className = "mt-modal-anchor-cursor";
	cursor.textContent = " ";
	return cursor;
}

function renderLineWithArrow(row, segs, col) {
	let consumed = 0;
	let inserted = false;
	for (const seg of segs) {
		if (!inserted && consumed + seg.text.length >= col) {
			const cut = col - consumed;
			if (cut > 0)
				row.appendChild(makeSegSpan(seg.text.slice(0, cut), seg.color));
			row.appendChild(makeCursorSpan());
			if (cut < seg.text.length)
				row.appendChild(makeSegSpan(seg.text.slice(cut), seg.color));
			inserted = true;
		} else {
			row.appendChild(makeSegSpan(seg.text, seg.color));
		}
		consumed += seg.text.length;
	}
	if (!inserted) row.appendChild(makeCursorSpan());
}

function showMoveToOverlay(payload) {
	const { mode, target, snippet } = payload || {};
	const overlay = document.getElementById("moveToOverlay");
	const emojiEl = document.getElementById("mtoEmoji");
	const titleEl = document.getElementById("mtoTitle");
	const targetEl = document.getElementById("mtoTarget");
	const snippetEl = document.getElementById("mtoSnippet");
	if (!overlay) return;

	overlay.style.background = "#ecf0f1";

	if (emojiEl) emojiEl.style.display = "none";
	if (titleEl) titleEl.textContent = "Go to:";

	snippetEl.style.display = "none";
	snippetEl.innerHTML = "";
	targetEl.style.display = "none";
	targetEl.textContent = "";

	if (mode === "dev") {
		targetEl.style.display = "";
		targetEl.textContent = "Dev Tools";
	} else if (mode === "main") {
		targetEl.style.display = "";
		targetEl.textContent = "Main Editor";
	} else if (mode === "file") {
		targetEl.style.display = "";
		const fname =
			target && target.startsWith("⚓") && target.endsWith("⚓")
				? target.slice(1, -1)
				: target || "";
		targetEl.textContent = fname;
	} else if (mode === "anchor") {
		if (snippet && snippet.lines && snippet.lines.length) {
			snippetEl.style.display = "block";
			const col = Math.max(0, snippet.anchorCol || 0);
			const colored = snippet.colored || null;
			snippet.lines.forEach((line, i) => {
				const row = document.createElement("div");
				row.className = "mt-modal-line";
				const segs =
					colored && colored[i]
						? colored[i]
						: [{ text: line || "", color: null }];
				if (i === snippet.arrowIdx) {
					renderLineWithArrow(row, segs, col);
				} else {
					renderLine(row, segs);
				}
				snippetEl.appendChild(row);
			});
		} else {
			targetEl.style.display = "";
			targetEl.textContent = target || "";
			snippetEl.style.display = "block";
			const div = document.createElement("div");
			div.className = "mt-modal-empty";
			div.textContent =
				"(Anchor not found in plan — move to the matching position.)";
			snippetEl.appendChild(div);
		}
	} else {
		targetEl.style.display = "";
		targetEl.textContent = target || "";
	}

	overlay.classList.add("active");
	setInteractionBtnsVisible(false);

	const modal = document.getElementById("mtModal");
	if (modal) {
		const snippetVisible = snippetEl.style.display !== "none";
		if (snippetVisible) {
			requestAnimationFrame(() => {
				if (snippetEl.offsetHeight > 0) {
					const center = snippetEl.offsetTop + snippetEl.offsetHeight / 2;
					modal.style.setProperty("--mt-confirm-top", center + "px");
				} else {
					modal.style.removeProperty("--mt-confirm-top");
				}
			});
		} else {
			modal.style.removeProperty("--mt-confirm-top");
		}
	}
}

function hideMoveToOverlay() {
	const overlay = document.getElementById("moveToOverlay");
	if (overlay) overlay.classList.remove("active");
	setInteractionBtnsVisible(true);
}

function confirmMoveTo() {
	sendMessage("move-to-confirmed", {});
	hideMoveToOverlay();
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
	setInteractionBtnsVisible(true);
	document.getElementById("iQuestionInput").style.display = "none";
	pendingInteraction = null;
}
