"use strict";

function setupZoomPan(canvas, p, L) {
	if (_abortCtrls.has(canvas.id)) _abortCtrls.get(canvas.id).abort();
	const ac = new AbortController();
	_abortCtrls.set(canvas.id, ac);
	const sig = ac.signal;

	canvas.addEventListener(
		"wheel",
		(e) => {
			e.preventDefault();
			const rect = canvas.getBoundingClientRect();
			const mx = e.clientX - rect.left;
			if (mx < L.M.left || mx > L.M.left + L.plotW) return;
			const focusTs = xToTs(mx, L);
			const factor = e.deltaY > 0 ? 1.25 : 1 / 1.25;
			const range = L.timeMax - L.timeMin;
			const newRange = Math.max(10, range * factor);
			const t = (focusTs - L.timeMin) / range;
			const dMin = p.sessionStart - CFG.PADDING;
			const dMax = p.sessionEnd + CFG.PADDING;
			_zoomMin = Math.max(dMin, focusTs - t * newRange);
			_zoomMax = Math.min(dMax, _zoomMin + newRange);
			_zoomMin = Math.max(dMin, _zoomMax - newRange);
			scheduleRender();
		},
		{ passive: false, signal: sig },
	);

	canvas.addEventListener(
		"mousedown",
		(e) => {
			if (e.button !== 0) return;
			PAN_STATE.active = true;
			PAN_STATE.startX = e.clientX;
			PAN_STATE.startMin = L.timeMin;
			PAN_STATE.startMax = L.timeMax;
			_pinned = null;
			hideTip();
		},
		{ signal: sig },
	);

	canvas.addEventListener(
		"mousemove",
		(e) => {
			if (!PAN_STATE.active) return;
			const dx = e.clientX - PAN_STATE.startX;
			const dtSec =
				(dx / L.plotW) * (PAN_STATE.startMax - PAN_STATE.startMin);
			const dMin = p.sessionStart - CFG.PADDING;
			const dMax = p.sessionEnd + CFG.PADDING;
			const range = PAN_STATE.startMax - PAN_STATE.startMin;
			let newMin = PAN_STATE.startMin - dtSec;
			let newMax = PAN_STATE.startMax - dtSec;
			if (newMin < dMin) {
				newMin = dMin;
				newMax = dMin + range;
			}
			if (newMax > dMax) {
				newMax = dMax;
				newMin = dMax - range;
			}
			_zoomMin = newMin;
			_zoomMax = newMax;
			scheduleRender();
		},
		{ signal: sig },
	);

	const endPan = () => {
		PAN_STATE.active = false;
	};
	canvas.addEventListener("mouseup", endPan, { signal: sig });
	canvas.addEventListener("mouseleave", endPan, { signal: sig });
	canvas.addEventListener("dblclick", () => resetZoom(), { signal: sig });
}

function resetZoom() {
	_zoomMin = _zoomMax = null;
	scheduleRender();
}

function updateZoomLabel(p, L) {
	const fullRange = p.sessionEnd - p.sessionStart + 2 * CFG.PADDING;
	const curRange = L.timeMax - L.timeMin;
	const zoom = fullRange / curRange;
	if (zoom > 1.05) {
		document.title =
			document.title.replace(/ \[.*?\]$/, "") +
			` [Zoom ×${zoom.toFixed(1)}]`;
	} else {
		document.title = document.title.replace(/ \[.*?\]$/, "");
	}
}
