"use strict";

function _curatedFindGhostEl(ghostRef, { activeOnly = false } = {}) {
	const wrap = document.getElementById("code-teacher");
	if (!wrap || !ghostRef) return null;
	const paneSel = activeOnly ? ".code-pane.active " : "";
	const candidates = wrap.querySelectorAll(
		`${paneSel}.leo-mark[data-leo-side="teacher"][data-leo-ghost-offset]`,
	);
	for (const el of candidates) {
		const pane = el.closest(".code-pane");
		if (!pane || pane.dataset.paneFile !== ghostRef.file) continue;
		const blobPos = parseInt(el.dataset.leoPos, 10);
		const offset = parseInt(el.dataset.leoGhostOffset, 10);
		if (!Number.isFinite(blobPos) || !Number.isFinite(offset)) continue;
		if (blobPos + offset === ghostRef.start && el.dataset.leoToken === ghostRef.token) {
			return el;
		}
	}
	return null;
}
