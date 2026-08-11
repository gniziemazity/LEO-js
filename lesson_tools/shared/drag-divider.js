"use strict";

function installDragDivider({
	dividerEl,
	targetEl,
	containerEl,
	axis = "x",
	persistKey = null,
	minPct = 10,
	maxPct = 80,
}) {
	if (!dividerEl || !targetEl || !containerEl) return;

	if (persistKey && typeof localStorage !== "undefined") {
		const stored = parseFloat(localStorage.getItem(persistKey));
		if (Number.isFinite(stored) && stored > 5 && stored < 95) {
			targetEl.style.flex = `0 0 ${stored}%`;
		}
	}

	const cursor = axis === "x" ? "col-resize" : "row-resize";
	let dragging = false;

	dividerEl.addEventListener("pointerdown", (e) => {
		dragging = true;
		dividerEl.setPointerCapture(e.pointerId);
		document.body.style.cursor = cursor;
		document.body.style.userSelect = "none";
		e.preventDefault();
	});
	dividerEl.addEventListener("pointermove", (e) => {
		if (!dragging) return;
		const r = containerEl.getBoundingClientRect();
		const pct =
			axis === "x"
				? ((r.right - e.clientX) / r.width) * 100
				: ((r.bottom - e.clientY) / r.height) * 100;
		const clamped = Math.max(minPct, Math.min(maxPct, pct));
		targetEl.style.flex = `0 0 ${clamped}%`;
	});
	const stop = (e) => {
		if (!dragging) return;
		dragging = false;
		try {
			dividerEl.releasePointerCapture(e.pointerId);
		} catch {}
		document.body.style.cursor = "";
		document.body.style.userSelect = "";
		const m = targetEl.style.flex.match(/0 0 ([\d.]+)%/);
		if (m && persistKey && typeof localStorage !== "undefined") {
			localStorage.setItem(persistKey, m[1]);
		}
	};
	dividerEl.addEventListener("pointerup", stop);
	dividerEl.addEventListener("pointercancel", stop);
}
