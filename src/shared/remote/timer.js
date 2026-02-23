function startTimer() {
	sendMessage("timer-start", {});
}

function stopTimer() {
	sendMessage("timer-stop", {});
}

function adjustTimer(minutes) {
	sendMessage("timer-adjust", { minutes });
}

function showTimerRunning(totalSecs) {
	const timerStartBtn = document.getElementById("timerStartBtn");
	const timerControls = document.getElementById("timerControls");
	const timerDisplay = document.getElementById("timerDisplay");

	timerStartBtn.classList.add("hidden");
	timerControls.classList.add("show");
	const h = Math.floor(totalSecs / 3600);
	const m = Math.floor((totalSecs % 3600) / 60);
	const s = totalSecs % 60;
	timerDisplay.textContent =
		h > 0
			? `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
			: `${m}:${s.toString().padStart(2, "0")}`;
}

function showTimerStopped() {
	const timerDisplay = document.getElementById("timerDisplay");
	const timerControls = document.getElementById("timerControls");
	const timerStartBtn = document.getElementById("timerStartBtn");

	timerDisplay.textContent = "";
	timerControls.classList.remove("show");
	timerStartBtn.classList.remove("hidden");
}
