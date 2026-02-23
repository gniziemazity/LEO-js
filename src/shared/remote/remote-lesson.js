let currentSettings = null;
let isActive = false;

function getBlockSubtype(text) {
	const t = text.trim();
	if (t.startsWith("❓")) return "question-comment";
	if (t.startsWith("🖼️")) return "image-comment";
	return null;
}

function buildSettingsCSS(settings) {
	return `
		body { font-size: ${settings.fontSize}px; }
		.comment-block, .code-block { color: ${settings.colors.textColor}; }
		.comment-block { background: ${settings.colors.commentNormal}; }
		.comment-block.question-comment { background: ${settings.colors.questionCommentColor}; }
		.comment-block.image-comment { background: ${settings.colors.imageBlockColor}; }
		.comment-block.active-comment {
			background: ${settings.colors.commentActive};
			color: ${settings.colors.commentActiveText};
		}
		.char.cursor { background: ${settings.colors.cursor}; }
	`;
}

function createCharSpan(char, stepIndex) {
	let el = document.createElement("span");
	el.className = "char";
	if (char === "\n") el = document.createElement("br");
	else if (char === " ") el.innerHTML = "&nbsp;";
	else el.textContent = char;
	el.dataset.stepIndex = stepIndex;
	return el;
}

function updateActiveState(active) {
	isActive = active;
	const toggleBtn = document.getElementById("toggleBtn");
	toggleBtn.textContent = active ? "❚❚" : "▶︎";
	toggleBtn.classList.toggle("btn-stop", active);
	toggleBtn.classList.toggle("btn-start", !active);
	toggleBtn.classList.add("interaction-btn");
}

function applySettings(settings) {
	currentSettings = settings;
	const id = "dynamic-settings-styles";
	let s = document.getElementById(id);
	if (!s) {
		s = document.createElement("style");
		s.id = id;
		document.head.appendChild(s);
	}
	s.textContent = buildSettingsCSS(settings);

	if (settings.touchpadSensitivity != null) {
		setTouchpadSensitivity(settings.touchpadSensitivity);
	}
}

function updateLessonData(data) {
	const container = document.getElementById("lesson-container");
	const { blocks } = data;
	container.innerHTML = "";
	if (!blocks || !blocks.length) return;
	let ctr = 0;
	blocks.forEach((block) => {
		const div = document.createElement("div");
		div.className = `block ${block.type}-block`;
		if (block.type === "comment") {
			div.innerText = block.text;
			const subtype = getBlockSubtype(block.text);
			if (subtype) div.classList.add(subtype);
			div.dataset.stepIndex = ctr++;
			div.onclick = handleBlockClick;
		} else if (block.type === "code") {
			for (const char of block.text) {
				div.appendChild(createCharSpan(char, ctr++));
			}
			div.dataset.stepIndex = ctr++;
			div.onclick = handleCodeClick;
		}
		container.appendChild(div);
	});
}

function updateCursor(data) {
	const { currentStep } = data;
	document
		.querySelectorAll(".cursor, .consumed, .active-comment")
		.forEach((el) => {
			el.classList.remove("cursor", "consumed", "active-comment");
		});
	document.querySelectorAll("[data-step-index]").forEach((el) => {
		const idx = parseInt(el.dataset.stepIndex);
		if (idx < currentStep) {
			el.classList.add("consumed");
		} else if (idx === currentStep) {
			el.classList.add(
				el.classList.contains("char") ? "cursor" : "active-comment",
			);
			el.scrollIntoView({ behavior: "smooth", block: "center" });
		}
	});
}

function updateProgress(data) {
	if (data.progress !== undefined)
		document.getElementById("progressBar").style.width = `${data.progress}%`;
}

function handleCodeClick(e) {
	if (!isActive) return;
	const span = e.target.closest(".char");
	if (span)
		sendMessage("jump-to", {
			stepIndex: parseInt(span.dataset.stepIndex),
		});
}

function handleBlockClick(e) {
	if (!isActive) return;
	const div = e.target.closest(".block");
	if (div && div.dataset.stepIndex)
		sendMessage("jump-to", {
			stepIndex: parseInt(div.dataset.stepIndex),
		});
}

function toggleActive() {
	sendMessage("toggle-active", {});
}
