let currentSettings = null;
let isActive = false;

function getBlockSubtype(text) {
	const t = text.trim();
	if (t.startsWith("❓")) return "question-comment";
	if (t.startsWith("🖼️")) return "image-comment";
	if (t.startsWith("🌐")) return "web-comment";
	if (t.startsWith("📋")) return "code-insert-comment";
	if (t.startsWith("➡️")) return "move-to-comment";
	return null;
}

function buildSettingsCSS(settings) {
	return `
		body { font-size: ${settings.fontSize}px; }
		.comment-block, .code-block { color: ${settings.colors.textColor}; }
		.comment-block { background: ${settings.colors.commentNormal}; }
		.code-block { background: ${settings.colors.codeBlockColor}; }
		.comment-block.question-comment { background: ${settings.colors.questionCommentColor}; }
		.comment-block.image-comment,
		.comment-block.web-comment { background: ${settings.colors.imageBlockColor}; }
		.comment-block.code-insert-comment { background: ${settings.colors.codeInsertBlockColor}; }
		.comment-block.move-to-comment { background: ${settings.colors.moveToBlockColor}; color: ${settings.colors.moveToTextColor}; }
		.comment-block.active-comment {
			background: ${settings.colors.commentActive};
			color: ${settings.colors.commentActiveText};
		}
		.char.cursor { background: ${settings.colors.cursor}; }
	`;
}

function renderMoveToTargetLabel(target) {
	if (!target) return "MAIN";
	if (target === "MAIN") return "Main Editor";
	if (target === "DEV") return "Dev Tools";
	const wrapped = target.startsWith("⚓") && target.endsWith("⚓");
	const inner = wrapped ? target.slice(1, -1) : target;
	if (/\.[a-z0-9]+$/i.test(inner)) return `📄 ${inner}`;
	if (wrapped) return `⚓${inner}⚓`;
	return target;
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
			div.className = "block comment-block move-to-comment";
			div.innerText = `➡️ ${renderMoveToTargetLabel(block.target)}`;
			div.dataset.stepIndex = ctr++;
			div.onclick = handleBlockClick;
			container.appendChild(div);
			return;
		}
		div.className = `block ${block.type}-block`;
		if (block.type === "comment") {
			const subtype = getBlockSubtype(block.text);
			if (subtype) div.classList.add(subtype);
			const isMultilineInsert =
				subtype === "code-insert-comment" && block.text.includes("\n");
			if (isMultilineInsert) {
				div.innerText = block.text.split("\n")[0] + "...";
				div.title = block.text;
				div.classList.add("collapsed");
			} else {
				div.innerText = block.text;
			}
			div.dataset.stepIndex = ctr++;
			div.onclick = handleBlockClick;
		} else if (block.type === "code") {
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
