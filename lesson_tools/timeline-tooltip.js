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
	const middleChart = document.getElementById("chart-middle");
	if (!charts || !middleChart) return;
	const cRect = middleChart.getBoundingClientRect();
	const chartsRect = charts.getBoundingClientRect();
	const x = cRect.left - chartsRect.left + tsToX(ts, L);
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
			return "#F5F5F5";
		case "dev_char":
			return _overlayOnWhite("var(--clr-tip-bg-purple)");
		case "delete":
			return "#FFEBEE";
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

function _posInRanges(pos, ranges) {
	if (!ranges) return false;
	for (const r of ranges) {
		const lo = r.length !== undefined ? r[0] : r.lo;
		const hi = r.length !== undefined ? r[1] : r.hi;
		if (pos >= lo && pos < hi) return true;
	}
	return false;
}

function _isInsertableChar(ch) {
	if (ch == null) return false;
	if (DELETE_CHARS.has(ch)) return false;
	if (
		typeof CURSOR_MOVES !== "undefined" &&
		Object.prototype.hasOwnProperty.call(CURSOR_MOVES, ch)
	)
		return false;
	if (
		typeof SHIFT_CURSOR_MOVES !== "undefined" &&
		Object.prototype.hasOwnProperty.call(SHIFT_CURSOR_MOVES, ch)
	)
		return false;
	if (typeof IGNORED_CHARS !== "undefined" && IGNORED_CHARS.has(ch))
		return false;
	if (typeof PAUSE_CHAR !== "undefined" && ch === PAUSE_CHAR) return false;
	return true;
}

function _computeBurstDecorations(parts, evs, replay) {
	const ghostChars = new Set();
	const ghostInserts = new Map();
	const commentChars = new Set();
	const commentInserts = new Map();
	if (!replay || !evs) {
		return { ghostChars, ghostInserts, commentChars, commentInserts };
	}

	const claimed = new Map();
	const claim = (file, pos) => {
		let s = claimed.get(file);
		if (!s) {
			s = new Set();
			claimed.set(file, s);
		}
		if (s.has(pos)) return false;
		s.add(pos);
		return true;
	};

	for (let i = 0; i < parts.length; i++) {
		const p = parts[i];
		const ev = evs[i];
		if (!ev || ev.timestamp == null) continue;
		const hitsAll = replay.tsToPos.get(ev.timestamp) || [];

		if (p.type === "char") {
			if (ev._editor === "dev") continue;
			let didClaim = false;
			for (const { file, pos } of hitsAll) {
				if (!claim(file, pos)) continue;
				didClaim = true;
				const ranges = replay.commentRangesByFile.get(file);
				if (_posInRanges(pos, ranges)) commentChars.add(i);
				break;
			}
			if (!didClaim && _isInsertableChar(p.t)) ghostChars.add(i);
		} else if (p.type === "code_insert") {
			const text = _displayCodeInsert(p.t || "");
			const claimedItems = [];
			for (const { file, pos } of hitsAll) {
				if (!claim(file, pos)) continue;
				const fileState = replay.files?.get(file);
				const ch = fileState ? fileState.text[pos] : null;
				claimedItems.push({ file, pos, ch });
			}
			const dispChars = [];
			const dispOff = [];
			for (let k = 0; k < text.length; k++) {
				if (!_isInsertableChar(text[k])) continue;
				dispChars.push(text[k]);
				dispOff.push(k);
			}
			const nD = dispChars.length;
			const nS = claimedItems.length;
			const dp = new Array(nD + 1);
			for (let a = 0; a <= nD; a++) dp[a] = new Uint16Array(nS + 1);
			for (let a = 1; a <= nD; a++) {
				const ca = dispChars[a - 1];
				for (let b = 1; b <= nS; b++) {
					if (ca === claimedItems[b - 1].ch) {
						dp[a][b] = dp[a - 1][b - 1] + 1;
					} else {
						dp[a][b] =
							dp[a - 1][b] >= dp[a][b - 1] ? dp[a - 1][b] : dp[a][b - 1];
					}
				}
			}
			const matchedItemForOff = new Map();
			{
				let a = nD;
				let b = nS;
				while (a > 0 && b > 0) {
					if (dispChars[a - 1] === claimedItems[b - 1].ch) {
						matchedItemForOff.set(dispOff[a - 1], b - 1);
						a--;
						b--;
					} else if (dp[a - 1][b] >= dp[a][b - 1]) {
						a--;
					} else {
						b--;
					}
				}
			}
			const ghostSet = new Set();
			for (let k = 0; k < text.length; k++) {
				if (!_isInsertableChar(text[k])) continue;
				if (!matchedItemForOff.has(k)) ghostSet.add(k);
			}
			if (ghostSet.size > 0) {
				let m = ghostInserts.get(i);
				if (!m) {
					m = new Set();
					ghostInserts.set(i, m);
				}
				for (const k of ghostSet) m.add(k);
			}
			let cm = null;
			for (const [off, itemIdx] of matchedItemForOff) {
				const item = claimedItems[itemIdx];
				const ranges = replay.commentRangesByFile.get(item.file);
				if (_posInRanges(item.pos, ranges)) {
					if (!cm) {
						cm = commentInserts.get(i);
						if (!cm) {
							cm = new Set();
							commentInserts.set(i, cm);
						}
					}
					cm.add(off);
				}
			}
		}
	}

	return { ghostChars, ghostInserts, commentChars, commentInserts };
}

function _decoForChar(deco, partIdx) {
	if (deco.ghostChars.has(partIdx)) return "ghost";
	if (deco.commentChars.has(partIdx)) return "comment";
	return null;
}

function _decoForInsertOffset(deco, partIdx, offset) {
	const g = deco.ghostInserts.get(partIdx);
	if (g && g.has(offset)) return "ghost";
	const c = deco.commentInserts.get(partIdx);
	if (c && c.has(offset)) return "comment";
	return null;
}

function _decoSpanOpen(decoKind) {
	if (decoKind === "ghost") return '<span class="tt-mark-ghost">';
	if (decoKind === "comment") return '<span class="tt-mark-comment">';
	return null;
}
