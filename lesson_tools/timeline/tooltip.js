"use strict";

const tooltipEl = document.getElementById("tooltip");
const vlineEl = document.getElementById("hover-vline");
let _pinned = null;
let _lockKeyDown = false;
let _barBlockStudents = [];

tooltipEl.addEventListener("click", (e) => {
	const headerEl = e.target.closest("[data-header-student]");
	if (
		headerEl &&
		_pinned?.s &&
		typeof openDifferentiatorWindow === "function"
	) {
		e.stopPropagation();
		openDifferentiatorWindow(_pinned.s);
		return;
	}
	const el = e.target.closest("[data-bar-student-idx]");
	if (!el) return;
	const idx = parseInt(el.getAttribute("data-bar-student-idx"), 10);
	const entry = _barBlockStudents[idx];
	if (entry && entry.s && typeof openDifferentiatorWindow === "function") {
		e.stopPropagation();
		openDifferentiatorWindow(entry.s);
	}
});

let _studentPreviewEl = null;
let _previewedStudent = null;

function _ensureStudentPreviewEl() {
	if (_studentPreviewEl) return _studentPreviewEl;
	const el = document.createElement("div");
	el.id = "tooltip-student-preview";
	const base = window.getComputedStyle(tooltipEl);
	el.style.position = "fixed";
	el.style.display = "none";
	el.style.background = base.background;
	el.style.color = base.color;
	el.style.fontFamily = base.fontFamily;
	el.style.fontSize = base.fontSize;
	el.style.padding = base.padding;
	el.style.borderRadius = base.borderRadius;
	el.style.boxShadow = base.boxShadow;
	el.style.lineHeight = base.lineHeight;
	el.style.whiteSpace = "pre-wrap";
	el.style.wordBreak = "break-all";
	el.style.maxWidth = "min(440px, 35vw)";
	el.style.maxHeight = "50vh";
	el.style.overflow = "hidden";
	el.style.pointerEvents = "none";
	el.style.zIndex = "1001";
	el.style.borderLeft = "3px solid var(--clr-accent)";
	document.body.appendChild(el);
	_studentPreviewEl = el;
	return el;
}

function _renderStudentPreview(student, evs) {
	const el = _ensureStudentPreviewEl();
	let cluster = null;
	if (evs && evs.length) {
		let cl0 = evs[0].ts;
		let clN = evs[0].ts;
		for (const e of evs) {
			if (e.ts < cl0) cl0 = e.ts;
			if (e.ts > clN) clN = e.ts;
		}
		cluster = { ts1: cl0, ts2: clN };
	}
	el.innerHTML = formatHit({ type: "student", s: student, cluster }, false);
	el.style.display = "block";
}

function _positionStudentPreview(cx, cy) {
	if (!_studentPreviewEl) return;
	const tw = _studentPreviewEl.offsetWidth;
	const th = _studentPreviewEl.offsetHeight;
	let tx = cx + 16;
	let ty = cy + 16;
	if (tx + tw > window.innerWidth - 8) tx = cx - tw - 16;
	if (ty + th > window.innerHeight - 8) ty = cy - th - 8;
	if (tx < 8) tx = 8;
	if (ty < 8) ty = 8;
	_studentPreviewEl.style.left = tx + "px";
	_studentPreviewEl.style.top = ty + "px";
}

function _hideStudentPreview() {
	if (_studentPreviewEl) _studentPreviewEl.style.display = "none";
	_previewedStudent = null;
}

tooltipEl.addEventListener("mousemove", (e) => {
	const el = e.target.closest("[data-bar-student-idx]");
	if (!el) {
		if (_previewedStudent) _hideStudentPreview();
		return;
	}
	const idx = parseInt(el.getAttribute("data-bar-student-idx"), 10);
	const entry = _barBlockStudents[idx];
	if (!entry || !entry.s) {
		if (_previewedStudent) _hideStudentPreview();
		return;
	}
	if (_previewedStudent !== entry.s) {
		_previewedStudent = entry.s;
		_renderStudentPreview(entry.s, entry.evs);
	}
	_positionStudentPreview(e.clientX, e.clientY);
});

tooltipEl.addEventListener("mouseleave", _hideStudentPreview);

function _hitTs(hit) {
	if (!hit) return null;
	if (hit.type === "burst") return hit.b?.centerTs ?? null;
	if (hit.type === "anchor")
		return hit.anc?.ts != null ? hit.anc.ts / 1000 : null;
	if (hit.type === "move") return hit.mv?.ts != null ? hit.mv.ts / 1000 : null;
	if (hit.type === "student") {
		const c = hit.cluster;
		if (c) return (c.ts1 + c.ts2) / 2;
		return hit.s?.follow_dt ?? null;
	}
	if (hit.type === "interaction") return hit.q?.timestamp ?? null;
	if (hit.ev?.timestamp != null) return hit.ev.timestamp / 1000;
	return null;
}

function showVLine(ts, L) {
	if (ts == null || !vlineEl) return hideVLine();
	const charts = document.getElementById("charts");
	const topChart = document.getElementById("chart-top");
	if (!charts || !topChart) return;
	const cRect = topChart.getBoundingClientRect();
	const chartsRect = charts.getBoundingClientRect();
	const x = cRect.left - chartsRect.left + tsToX(ts, L) - 0.5;
	vlineEl.style.left = x + "px";
	vlineEl.style.display = "block";
}

function hideVLine() {
	if (vlineEl) vlineEl.style.display = "none";
}

function _sameCluster(a, b) {
	if (a == null && b == null) return true;
	if (a == null || b == null) return false;
	return a.ts1 === b.ts1 && a.ts2 === b.ts2;
}

function _trimBlankLines(html) {
	return html
		.replace(/^(?:[ \t]*\n)+/, "")
		.replace(/^<span\b[^>]*>(?:[ \t]*\n)+<\/span>/, "")
		.replace(/^(<span\b[^>]*>)(?:[ \t]*\n)+/, "$1")
		.replace(/<span\b[^>]*>(?:\n[ \t]*)+<\/span>$/, "")
		.replace(/(\n+[ \t]*)<\/span>$/, "</span>")
		.replace(/\n+[ \t]*$/, "");
}

document.addEventListener("keydown", (e) => {
	if (e.key === " " && !_lockKeyDown) {
		_lockKeyDown = true;
		if (_hoveredStudent) _lockedStudent = _hoveredStudent;
		e.preventDefault();
	}
});

document.addEventListener("keyup", (e) => {
	if (e.key === " " && _lockKeyDown) {
		_lockKeyDown = false;
		_lockedStudent = null;
	}
});

window.addEventListener("blur", () => {
	_lockKeyDown = false;
	if (_lockedStudent) {
		_lockedStudent = null;
	}
});

function matchesStudentName(interactionField, studentName) {
	const interactionName = resolveInteractionStudentDisplay(interactionField);
	if (!interactionName || !studentName) return false;
	return interactionName.trim() === studentName.trim();
}

function showTip(cx, cy, hit, pinned, chartId) {
	tooltipEl.innerHTML = formatHit(hit, chartId === "top");
	const isBar = hit?.type === "bar-block" || hit?.type === "token-bar";
	tooltipEl.style.display = isBar ? "flex" : "block";
	tooltipEl.style.flexDirection = isBar ? "column" : "";
	tooltipEl.style.overflowY = isBar ? "hidden" : "";
	tooltipEl.style.background = bgForHit(hit);
	tooltipEl.style.maxWidth = isBar ? "50vw" : "";
	tooltipEl.classList.toggle("pinned", pinned);
	const tw = tooltipEl.offsetWidth,
		th = tooltipEl.offsetHeight;
	let tx = cx + 16,
		ty = cy + 16;
	if (tx + tw > window.innerWidth - 8) tx = cx - tw - 16;
	if (ty + th > window.innerHeight - 8) ty = cy - th - 8;
	tooltipEl.style.left = tx + "px";
	tooltipEl.style.top = ty + "px";
}

function hideTip() {
	tooltipEl.style.display = "none";
}

function _overlayOnWhite(color) {
	return `linear-gradient(${color}, ${color}), var(--clr-bg)`;
}

function bgForHit(hit) {
	if (!hit) return "var(--clr-bg)";
	switch (hit.type) {
		case "move":
			return _overlayOnWhite("var(--clr-tip-bg-orange)");
		case "anchor":
			return _overlayOnWhite("var(--clr-tip-bg-blue)");
		case "code_insert":
			return "var(--clr-tip-bg-gray)";
		case "dev_char":
			return _overlayOnWhite("var(--clr-tip-bg-purple)");
		case "delete":
			return "var(--clr-tip-bg-delete)";
		case "char":
			return "var(--clr-bg)";
		case "burst":
			return hit.b?.colorType === "dev"
				? _overlayOnWhite("var(--clr-tip-bg-purple)")
				: "var(--clr-bg)";
		case "interaction": {
			const tip = INTERACTION_COLORS[hit.itype]?.tipBg;
			return tip ? _overlayOnWhite(tip) : "var(--clr-bg)";
		}
		default:
			return "var(--clr-bg)";
	}
}

function _filterAnchorMoveParts(parts, partColors, evs) {
	const out = [];
	const evsOut = evs ? [] : null;
	const colorsOut = partColors ? new Map() : null;
	for (let i = 0; i < parts.length; i++) {
		const p = parts[i];
		if (p.type === "anchor" || p.type === "move") continue;
		const newIdx = out.length;
		out.push(p);
		if (evsOut) evsOut.push(evs[i]);
		if (partColors && partColors.has(i)) {
			colorsOut.set(newIdx, partColors.get(i));
		}
	}
	return { parts: out, partColors: colorsOut, evs: evsOut };
}

function _truncatePartsAtLines(parts, maxLines, evs) {
	const isNL = (ch) => ch === "↩" || ch === "\n";
	let n = 0;
	const out = [];
	const evsOut = evs ? [] : null;
	const push = (p, srcIdx) => {
		out.push(p);
		if (evsOut) evsOut.push(evs[srcIdx]);
	};
	for (let i = 0; i < parts.length; i++) {
		const p = parts[i];
		if (p.type === "char" && isNL(p.t)) {
			if (n >= maxLines) {
				return { parts: out, truncated: true, evs: evsOut };
			}
			n++;
			push(p, i);
		} else if (p.type === "code_insert") {
			const t = p.t || "";
			let newlinesInInsert = 0;
			for (const ch of t) if (isNL(ch)) newlinesInInsert++;
			if (n + newlinesInInsert > maxLines) {
				const remaining = maxLines - n;
				let seen = 0;
				let cutAt = t.length;
				for (let j = 0; j < t.length; j++) {
					if (isNL(t[j])) {
						seen++;
						if (seen > remaining) {
							cutAt = j;
							break;
						}
					}
				}
				push({ ...p, t: t.slice(0, cutAt) }, i);
				return { parts: out, truncated: true, evs: evsOut };
			}
			n += newlinesInInsert;
			push(p, i);
		} else {
			push(p, i);
		}
	}
	return { parts: out, truncated: false, evs: evsOut };
}
