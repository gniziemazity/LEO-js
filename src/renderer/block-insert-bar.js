const { addChoices } = require("./block-types");
const { isOpen: isDropdownOpen } = require("./move-to-dropdown");

const BAND = 8;
const SHOW_DELAY_MS = 150;

let bar = null;
let ctx = null;
let pending = null;
let timer = null;

function fillBar(el, afterIndex, blockEditor) {
	el.innerHTML = "";
	el.dataset.afterIndex = String(afterIndex);
	for (const choice of addChoices()) {
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "block-add-btn";
		btn.dataset.addType = choice.type;
		btn.dataset.addKind = choice.kind;
		btn.textContent = `+ ${choice.glyph} ${choice.label}`;
		btn.title = `Add a ${choice.label.toLowerCase()} block here`;
		btn.addEventListener("mousedown", (e) => {
			e.preventDefault();
			e.stopPropagation();
		});
		btn.addEventListener("click", (e) => {
			e.stopPropagation();
			const at = Number(el.dataset.afterIndex);
			if (!blockEditor || !Number.isFinite(at)) return;
			blockEditor.addBlock(choice.type, choice.initialText || null, at);
			hide();
		});
		el.appendChild(btn);
	}
	return el;
}

function buildEndBar(afterIndex, blockEditor) {
	const el = document.createElement("div");
	el.className = "block-insert-bar block-insert-end";
	return fillBar(el, afterIndex, blockEditor);
}

function cancelPending() {
	if (timer) clearTimeout(timer);
	timer = null;
	pending = null;
}

function hide() {
	cancelPending();
	if (bar) bar.classList.remove("visible");
}

function hideUnlessInside(e) {
	if (bar && e.target && bar.contains(e.target)) return;
	hide();
}

function hideUnlessEntering(e) {
	if (bar && e.relatedTarget && bar.contains(e.relatedTarget)) return;
	hide();
}

function seamAt(idx, rect, clientY, floor) {
	if (clientY - rect.top <= BAND) {
		return idx - 1 >= floor - 1 ? { after: idx - 1, y: rect.top } : null;
	}
	if (rect.bottom - clientY <= BAND) {
		return idx >= floor - 1 ? { after: idx, y: rect.bottom } : null;
	}
	return null;
}

function seamFor(e) {
	if (!e.target || !e.target.closest) return null;
	const block = e.target.closest(".block");
	if (!block) return null;
	const idx = [...ctx.container.querySelectorAll(".block")].indexOf(block);
	if (idx < 0) return null;
	return seamAt(
		idx,
		block.getBoundingClientRect(),
		e.clientY,
		ctx.lessonManager.firstAuthoredIndex(),
	);
}

function show(seam) {
	fillBar(bar, seam.after, ctx.blockEditor);
	bar.classList.add("visible");
	const c = ctx.container.getBoundingClientRect();
	const h = bar.offsetHeight || 24;
	bar.style.left = `${c.left + 12}px`;
	bar.style.top = `${seam.y - h / 2}px`;
}

function showing(after) {
	return (
		bar.classList.contains("visible") &&
		bar.dataset.afterIndex === String(after)
	);
}

function onMove(e) {
	if (!ctx || !bar) return;
	if (ctx.uiManager.isActive() || isDropdownOpen()) return hide();
	if (bar.contains(e.target)) return;
	const seam = seamFor(e);
	if (!seam) return hide();
	if (showing(seam.after)) return;
	if (pending && pending.after === seam.after) return;
	hide();
	pending = seam;
	timer = setTimeout(() => {
		const next = pending;
		cancelPending();
		if (next) show(next);
	}, SHOW_DELAY_MS);
}

function attach({ container, lessonManager, blockEditor, uiManager }) {
	ctx = { container, lessonManager, blockEditor, uiManager };
	bar = document.createElement("div");
	bar.className = "block-insert-bar block-insert-hover";
	document.body.appendChild(bar);

	document.addEventListener("mousemove", onMove);
	document.addEventListener("mousedown", hideUnlessInside, true);
	document.addEventListener("scroll", hide, true);
	window.addEventListener("resize", hide);
	container.addEventListener("mouseleave", hideUnlessEntering);
	return bar;
}

module.exports = { attach, buildEndBar, hide, seamAt, BAND, SHOW_DELAY_MS };
