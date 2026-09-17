let currentSettings = null;
let isActive = false;
let teacherName = "Teacher";

const { getBlockKind, buildSettingsCSS, isMultilineSnippet, collapsedLabel } =
	LeoBlocks;

function renderMoveToTargetLabel(target) {
	return MoveToTarget.moveToTargetLabel(target);
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
	if (settings.teacherName) teacherName = settings.teacherName;
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

	const side = settings.touchpadSide || "right";
	document.body.classList.remove("side-left", "side-right");
	document.body.classList.add("side-" + side);
	if (typeof setTouchpadSide === "function") setTouchpadSide(side);
}

function updateLessonData(data) {
	const container = document.getElementById("lesson-container");
	const { blocks } = data;
	container.innerHTML = "";
	if (!blocks || !blocks.length) return;
	let ctr = 0;
	blocks.forEach((block) => {
		const div = document.createElement("div");
		if (block.type === "move-to") {
			div.className = "block move-to-block";
			div.innerText = `➡️ ${renderMoveToTargetLabel(block.target)}`;
			div.dataset.stepIndex = ctr++;
			div.onclick = handleBlockClick;
			container.appendChild(div);
			return;
		}
		if (block.type === "comment") {
			div.className = `block ${getBlockKind(block.text)}-block`;
			const isMultilineInsert = isMultilineSnippet(block.text);
			if (isMultilineInsert) {
				div.innerText = collapsedLabel(block.text);
				div.dataset.fullText = block.text;
				div.classList.add("collapsed");
			} else {
				div.innerText = block.text;
			}
			div.dataset.stepIndex = ctr++;
			div.onclick = handleBlockClick;
		} else if (block.type === "code") {
			div.className = "block code-block";
			ctr = CodeTextRenderer.buildCodeText(block.text, div, ctr);
			div.dataset.stepIndex = ctr++;
			div.onclick = handleCodeClick;
		}
		container.appendChild(div);
	});
}

function updateCursor(data) {
	const { currentStep } = data;
	document
		.querySelectorAll(".cursor, .consumed, .active-block")
		.forEach((el) => {
			el.classList.remove("cursor", "consumed", "active-block");
		});
	document.querySelectorAll("[data-step-index]").forEach((el) => {
		const idx = parseInt(el.dataset.stepIndex);
		if (idx < currentStep) {
			el.classList.add("consumed");
		} else if (idx === currentStep) {
			el.classList.add(
				el.classList.contains("char") ? "cursor" : "active-block",
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
