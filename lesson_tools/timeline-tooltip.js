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

function setupHover(middleChart, topChart, bottomChart, p, L) {
	for (const [canvas, id] of [
		[middleChart, "middle"],
		[topChart, "top"],
		[bottomChart, "bottom"],
	]) {
		if (!canvas) continue;
		const key = canvas.id + "_h";
		if (_hoverAborts.has(key)) _hoverAborts.get(key).abort();
		const ac = new AbortController();
		_hoverAborts.set(key, ac);
		const sig = { signal: ac.signal };

		canvas.addEventListener(
			"mousemove",
			(e) => {
				if (PAN_STATE.active || _pinned) return;
				const hit = findHit(e, canvas, id, p, L);

				let effectiveHit = hit;
				if (id === "bottom") {
					if (
						_lockKeyDown &&
						!_lockedStudent &&
						hit?.type === "student" &&
						hit.s
					) {
						_lockedStudent = hit.s;
					}
					let newStudent, newCluster;
					if (_lockedStudent) {
						newStudent = _lockedStudent;
						if (hit?.type === "student" && hit.s === _lockedStudent) {
							newCluster = hit.cluster ?? null;
						} else {
							newCluster = null;
							effectiveHit = null;
						}
					} else {
						newStudent = hit?.type === "student" ? hit.s : null;
						newCluster =
							hit?.type === "student" ? (hit.cluster ?? null) : null;
					}
					if (
						newStudent !== _hoveredStudent ||
						!_sameCluster(newCluster, _hoveredCluster)
					) {
						_hoveredStudent = newStudent;
						_hoveredCluster = newCluster;
						redrawBottomChart();
					}
				}

				if (effectiveHit) {
					showTip(e.clientX, e.clientY, effectiveHit, false, id);
					if (id === "top" && effectiveHit.type !== "interaction") {
						const ts = _hitTs(effectiveHit);
						if (ts != null) showVLine(ts, L);
						else hideVLine();
					} else {
						hideVLine();
					}
				} else {
					hideTip();
					hideVLine();
				}
			},
			sig,
		);

		canvas.addEventListener(
			"mouseleave",
			() => {
				if (id === "bottom") {
					if (_lockedStudent) {
						if (_hoveredCluster) {
							_hoveredCluster = null;
							redrawBottomChart();
						}
					} else if (_hoveredStudent) {
						_hoveredStudent = null;
						_hoveredCluster = null;
						redrawBottomChart();
					}
				}
				if (!_pinned) {
					hideTip();
					hideVLine();
				}
			},
			sig,
		);

		const handleSelect = (e) => {
			if (PAN_STATE.active) return;
			const hit = findHit(e, canvas, id, p, L);
			if (!hit) {
				_pinned = null;
				hideTip();
				hideVLine();
				return;
			}
			if (_pinned === hit) {
				_pinned = null;
				hideTip();
				hideVLine();
			} else {
				_pinned = hit;
				showTip(e.clientX, e.clientY, hit, true, id);
				if (id === "top" && hit.type !== "interaction") {
					const ts = _hitTs(hit);
					if (ts != null) showVLine(ts, L);
					else hideVLine();
				} else {
					hideVLine();
				}
			}
		};

		canvas.addEventListener("click", handleSelect, sig);
		canvas.addEventListener(
			"mousedown",
			(e) => {
				if (e.button === 1) e.preventDefault();
			},
			sig,
		);
		canvas.addEventListener(
			"auxclick",
			(e) => {
				if (e.button !== 1) return;
				if (PAN_STATE.active) return;
				const hit = findHit(e, canvas, id, p, L);
				if (id === "bottom" && hit?.type === "student") {
					openDifferentiatorWindow(hit.s);
				}
			},
			sig,
		);
	}
}

function canvasXY(e, canvas) {
	const r = canvas.getBoundingClientRect();
	return [e.clientX - r.left, e.clientY - r.top];
}

function findHit(e, canvas, id, p, L) {
	const [mx, my] = canvasXY(e, canvas);
	const { M, plotW } = L;
	const plotH =
		id === "middle" ? L.plotHmid : id === "top" ? L.plotHtop : L.plotHbot;
	if (mx < M.left || mx > M.left + plotW || my < M.top || my > M.top + plotH)
		return null;
	const ts = xToTs(mx, L);
	const thT = (L.timeMax - L.timeMin) * (10 / plotW);
	if (id === "middle") return hitMiddleChart(ts, my, p, L, thT);
	if (id === "top") return hitTopChart(ts, my, p, L, thT);
	if (id === "bottom") {
		if (_bottomChartVisible.barMode) {
			const overlayHit = _tokenOverlayHitTest(mx, my, L);
			if (overlayHit) return overlayHit;
			return hitBottomBarBlock(ts, my, p, L, thT);
		}
		const hit = hitBottomChart(ts, my, p, L, thT);
		if (_lockedStudent && (!hit || hit.s !== _lockedStudent)) {
			const restricted = hitBottomChart(ts, my, p, L, thT, _lockedStudent);
			if (restricted) return restricted;
		}
		return hit;
	}
	return null;
}

function hitBottomBarBlock(ts, my, p, L, thT) {
	if (!_students) return null;
	const blocks = _buildBottomChartBlocks(p);
	const pad = thT || 0;
	let blk = null;
	let bestD = Infinity;
	for (const b of blocks) {
		if (ts >= b.ts1 - pad && ts <= b.ts2 + pad) {
			const d = Math.abs(ts - b.centerTs);
			if (d < bestD) {
				bestD = d;
				blk = b;
			}
		}
	}
	if (!blk) return null;
	const studentsAffected = [];
	const langCounts = {};
	for (const s of _students) {
		const evs = (s.follow_events || []).filter(
			(e) => _isMistakeEvent(e) && e.ts >= blk.ts1 && e.ts <= blk.ts2,
		);
		if (!evs.length) continue;
		studentsAffected.push({ s, evs });
		for (const e of evs) {
			const l = e.lang || "?";
			langCounts[l] = (langCounts[l] || 0) + 1;
		}
	}
	if (!studentsAffected.length) return null;
	const { M, plotHbot } = L;
	const bottomY = M.top + plotHbot;
	const denom = Math.max(1, _students.length);
	const bh = Math.min(plotHbot, (studentsAffected.length / denom) * plotHbot);
	const barTop = bottomY - bh;
	const yPad = 10;
	if (my < barTop - yPad || my > bottomY) return null;
	return {
		type: "bar-block",
		blk,
		burst: blk.burst,
		kp: blk.kp,
		students: studentsAffected,
		langCounts,
	};
}

function hitMiddleChart(ts, my, p, L, thT) {
	const { M, plotHmid } = L;
	const bottomY = M.top + plotHmid;
	const yPad = 10;
	let best = null,
		bestD = Infinity;
	for (const b of p.bursts) {
		if (ts >= b.startTs - thT && ts <= b.endTs + thT) {
			let rate = null;
			if (b.chars > 0) {
				const hasVirtual = b.hasCodeInserts || b.hasAnchors || b.hasMoves;
				rate = hasVirtual ? Math.max(b.rate, 20) : b.rate;
			} else if (b.hasCodeInserts) {
				const insLen = b.evs
					.filter((e) => e._virtualType === "code_insert")
					.reduce((s, e) => s + (e.code_insert || "").length, 0);
				rate = Math.max(10, insLen / (CFG.BAR_MIN_SECS / 60));
			} else if (b.hasAnchors || b.hasMoves) {
				rate = 20;
			}
			if (rate == null) continue;
			const barTop = rateToY(rate, L);
			if (my < barTop - yPad || my > bottomY) continue;
			const d = Math.abs(ts - b.centerTs);
			if (d < bestD) {
				bestD = d;
				best = { type: "burst", b };
			}
		}
	}
	for (const kp of p.singletons) {
		const d = Math.abs(ts - kp.timestamp / 1000);
		if (d < thT * 2 && d < bestD) {
			bestD = d;
			if (kp._virtualType === "anchor")
				best = {
					type: "anchor",
					anc: { ts: kp.timestamp, ids: [kp._target] },
				};
			else if (kp._virtualType === "move")
				best = {
					type: "move",
					mv: { ts: kp.timestamp, target: kp._target },
				};
			else if (kp._virtualType === "code_insert")
				best = { type: "code_insert", ev: kp };
			else best = { type: "char", ev: kp };
		}
	}
	return best;
}

function hitTopChart(ts, my, p, L, thT) {
	const cum = p.cumulative,
		maxN = p.totalChars || 1,
		PY = 8;
	let best = null,
		bestD = Infinity;

	function check(type, payload, evTs_secs) {
		const dx = Math.abs(ts - evTs_secs);
		const dy = Math.abs(my - countToY(charsAt(evTs_secs, cum), maxN, L));
		if (dx < thT * 2 && dy < PY) {
			const dxPx = (dx / (L.timeMax - L.timeMin)) * L.plotW;
			const d = dxPx * dxPx + dy * dy;
			if (d < bestD) {
				bestD = d;
				best = { type, ...payload };
			}
		}
	}

	for (const anc of p.anchors) check("anchor", { anc }, anc.ts / 1000);
	for (const mv of p.moves) check("move", { mv }, mv.ts / 1000);
	for (const ev of p.codeInserts)
		check("code_insert", { ev }, ev.timestamp / 1000);
	for (const ev of p.deletes) check("delete", { ev }, ev.timestamp / 1000);
	for (const ev of p.devChars) check("dev_char", { ev }, ev.timestamp / 1000);

	for (const grp of p.burstGroups) {
		for (const idx of grp.idxs) {
			const c = cum[idx];
			if (!c) continue;
			const dx = Math.abs(ts - c.ts);
			const dy = Math.abs(my - countToY(c.count, maxN, L));
			if (dx < thT * 2 && dy < PY) {
				const dxPx = (dx / (L.timeMax - L.timeMin)) * L.plotW;
				const d = dxPx * dxPx + dy * dy;
				if (d < bestD) {
					bestD = d;
					best = { type: "char", ev: c.event };
				}
			}
		}
	}
	return best || hitInteraction(ts, p);
}

function hitBottomChart(ts, my, p, L, thT, restrictStudent) {
	if (!_students) return null;
	const DASH_PY = 6;
	const DOT_PX = 7;
	let best = null,
		bestD = Infinity;
	for (const s of _students) {
		if (restrictStudent && s !== restrictStudent) continue;
		const jitter = _jitterFor(s.name);
		const sy = _clampStudentY(s, jitter, L);

		const dyDash = Math.abs(my - sy);
		const evs = _mistakeEventsFor(s);
		if (evs.length && dyDash <= DASH_PY) {
			for (const cl of _clusterMistakes(evs, CFG.BURST_GAP)) {
				const cl0 = cl[0].ts;
				const clN = cl[cl.length - 1].ts;
				let tIn;
				if (ts < cl0) tIn = cl0;
				else if (ts > clN) tIn = clN;
				else tIn = ts;
				const dxPx = ((ts - tIn) / (L.timeMax - L.timeMin)) * L.plotW;
				const d = dxPx * dxPx + dyDash * dyDash;
				if (d < DASH_PY * DASH_PY && d < bestD) {
					bestD = d;
					best = { type: "student", s, cluster: { ts1: cl0, ts2: clN } };
				}
			}
		}

		if (s.follow_dt != null) {
			const dotXPx = tsToX(s.follow_dt, L) + jitter.dx;
			const tsXPx = tsToX(ts, L);
			const dotDxPx = tsXPx - dotXPx;
			const dotDy = my - sy;
			const d = dotDxPx * dotDxPx + dotDy * dotDy;
			if (d < DOT_PX * DOT_PX && d < bestD) {
				bestD = d;
				best = { type: "student", s, cluster: null };
			}
		}
	}
	return best;
}

function hitInteraction(ts, p) {
	for (const [itype, qs] of Object.entries(p.interactions)) {
		for (const q of qs) {
			const end =
				q.closed_at ||
				(
					p.events.find((e) => e.timestamp / 1000 > q.timestamp) || {
						timestamp: (q.timestamp + 5) * 1000,
					}
				).timestamp / 1000;
			if (ts >= q.timestamp && ts <= end)
				return { type: "interaction", itype, q };
		}
	}
	return null;
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

function textPartsToHtml(parts, partColors, evs, replay) {
	const colors = partColors || null;
	const deco = _computeBurstDecorations(parts, evs, replay);
	let html = "";
	let pendingBuf = "";
	let pendingColor = null;
	let pendingDeco = null;
	const flushPending = () => {
		if (!pendingBuf) return;
		if (pendingColor) {
			html += `<span style="color:${pendingColor};font-weight:bold;text-decoration:underline">${pendingBuf}</span>`;
		} else {
			const open = _decoSpanOpen(pendingDeco);
			html += open ? `${open}${pendingBuf}</span>` : pendingBuf;
		}
		pendingBuf = "";
		pendingColor = null;
		pendingDeco = null;
	};
	for (let i = 0; i < parts.length; i++) {
		const p = parts[i];
		if (p.type === "anchor") {
			flushPending();
			html += `<span class="tt-anchor">${escHtml(p.t)}</span>`;
		} else if (p.type === "move") {
			flushPending();
			html += `<span class="tt-move">→${escHtml(p.t)}</span>`;
		} else if (p.type === "code_insert") {
			flushPending();
			const display = _displayCodeInsert(p.t);
			const offsetColors = colors ? colors.get(i) : null;
			const offsetColorsMap =
				offsetColors instanceof Map ? offsetColors : null;
			let curColor = null;
			let curDeco = null;
			let curBuf = "";
			const flushSeg = () => {
				if (!curBuf) return;
				if (curColor) {
					html += `<span style="color:${curColor};font-weight:bold;text-decoration:underline ${THEME.codeMuted}">${escHtml(curBuf)}</span>`;
				} else if (curDeco === "ghost") {
					html += `<span class="tt-mark-ghost" style="text-decoration:underline ${THEME.codeMuted}">${escHtml(curBuf)}</span>`;
				} else if (curDeco === "comment") {
					html += `<span class="tt-mark-comment" style="text-decoration:underline ${THEME.codeMuted}">${escHtml(curBuf)}</span>`;
				} else {
					html += `<span style="color:${THEME.black};text-decoration:underline ${THEME.codeMuted}">${escHtml(curBuf)}</span>`;
				}
				curBuf = "";
			};
			for (let k = 0; k < display.length; k++) {
				const c = offsetColorsMap ? offsetColorsMap.get(k) || null : null;
				const d = c ? null : _decoForInsertOffset(deco, i, k);
				if (c !== curColor || d !== curDeco) {
					flushSeg();
					curColor = c;
					curDeco = d;
				}
				curBuf += display[k];
			}
			flushSeg();
		} else {
			{
				const ch = p.t;
				if (DELETE_CHARS.has(ch)) {
					flushPending();
					let isPaleRed = false;
					if (ch === "\u232b") {
						const nextChars = parts
							.slice(i + 1)
							.filter((x) => x.type === "char")
							.slice(0, 4)
							.map((x) => x.t)
							.join("");
						isPaleRed = nextChars.startsWith("</");
					}
					const cls = isPaleRed ? "tt-delete-pale" : "tt-delete";
					html += `<span class="${cls}">${escHtml(ch)}</span>`;
				} else {
					const color = colors ? colors.get(i) || null : null;
					const d = color ? null : _decoForChar(deco, i);
					const rendered = escHtml(ch === "↩" ? "\n" : ch);
					if (color !== pendingColor || d !== pendingDeco) {
						flushPending();
						pendingColor = color;
						pendingDeco = d;
					}
					pendingBuf += rendered;
				}
			}
		}
	}
	flushPending();
	return html;
}

function _buildPartColorsForMismatches(b, mismatches) {
	const parts = b.textParts || [];
	const evs = b.evs || [];
	const codeChars = [];
	let needsBoundary = false;
	for (let pi = 0; pi < parts.length; pi++) {
		const p = parts[pi];
		if (p.type === "move") {
			needsBoundary = true;
			continue;
		}
		if (p.type !== "char" && p.type !== "code_insert") continue;
		if (p.type === "char" && DELETE_CHARS.has(p.t)) {
			needsBoundary = true;
			continue;
		}
		let text;
		if (p.type === "char") {
			text = p.t === "↩" ? "\n" : p.t || "";
		} else {
			text = _displayCodeInsert(p.t);
		}
		if (!text) continue;
		if (needsBoundary && codeChars.length > 0) {
			codeChars.push({ partIdx: -1, partOffset: -1, ch: " ", ts: 0 });
		}
		needsBoundary = false;
		const baseTs = (evs[pi]?.timestamp ?? 0) / 1000;
		const secPerChar = CFG.CODE_INSERT_MS_PER_CHAR / 1000;
		const perCharBump = p.type === "code_insert" ? secPerChar : 0;
		for (let k = 0; k < text.length; k++) {
			const ts = baseTs + k * perCharBump;
			codeChars.push({ partIdx: pi, partOffset: k, ch: text[k], ts });
		}
	}
	const codeStr = codeChars.map((c) => c.ch).join("");
	const tokenRe = newTokenRegex();
	const burstTokens = [];
	let m;
	while ((m = tokenRe.exec(codeStr)) !== null) {
		const tok = m[0];
		const startIdx = m.index;
		const endIdx = m.index + tok.length;
		if (endIdx - 1 >= codeChars.length) break;
		const ts = codeChars[endIdx - 1].ts;
		burstTokens.push({
			token: tok,
			startIdx,
			endIdx,
			ts,
			claimed: false,
		});
	}
	const candidates = [];
	const candKeys = new Set();
	for (const mm of mismatches || []) {
		if (mm.kind !== "missing") continue;
		const tok = mm.token || mm.label || "";
		if (!tok || mm.ts == null) continue;
		const key = `${tok} ${mm.ts}`;
		if (candKeys.has(key)) continue;
		candKeys.add(key);
		candidates.push({
			token: tok,
			ts: mm.ts,
			lang: mm.lang || null,
			claimed: false,
		});
	}
	const maxCodeInsertChars = parts.reduce((acc, p) => {
		if (p.type !== "code_insert") return acc;
		const len = _displayCodeInsert(p.t || "").length;
		return Math.max(acc, len);
	}, 0);
	const tolerance =
		1 + (maxCodeInsertChars * CFG.CODE_INSERT_MS_PER_CHAR) / 1000;
	const pairs = [];
	for (let bi = 0; bi < burstTokens.length; bi++) {
		for (let ci = 0; ci < candidates.length; ci++) {
			if (burstTokens[bi].token !== candidates[ci].token) continue;
			const diff = burstTokens[bi].ts - candidates[ci].ts;
			if (diff < -tolerance || diff > tolerance) continue;
			pairs.push({ bi, ci, diff });
		}
	}
	pairs.sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff));
	const partColors = new Map();
	const fallbackColor = _cssVar("--clr-mark-missing");
	for (const pair of pairs) {
		if (burstTokens[pair.bi].claimed || candidates[pair.ci].claimed) continue;
		burstTokens[pair.bi].claimed = true;
		candidates[pair.ci].claimed = true;
		const bt = burstTokens[pair.bi];
		const cand = candidates[pair.ci];
		const color = _langBarColorOf(cand.lang) || fallbackColor;
		for (let j = bt.startIdx; j < bt.endIdx; j++) {
			const cc = codeChars[j];
			const part = parts[cc.partIdx];
			if (part.type === "code_insert") {
				let m = partColors.get(cc.partIdx);
				if (!(m instanceof Map)) {
					m = new Map();
					partColors.set(cc.partIdx, m);
				}
				m.set(cc.partOffset, color);
			} else {
				partColors.set(cc.partIdx, color);
			}
		}
	}
	return partColors;
}

function _langClassFor(lang) {
	return _langBarColorOf(lang)
		? `tt-lang-${lang.toLowerCase()}`
		: "tt-lang-unk";
}

function _tokenSpansHtml(evs) {
	return (evs || [])
		.map((e) => {
			const tok = e.token != null ? e.token : e.label || "";
			const cls = _langClassFor(e.lang);
			const ghost = e.kind === "extra-star" ? " tt-ghost" : "";
			return `<span class="${cls}${ghost}">${escHtml(tok)}</span>`;
		})
		.join(" ");
}

function _renderStudentGrid(sorted, blockLangs, perLangCounts, maxLangWidths) {
	const maxIdLen = sorted.reduce(
		(m, { s }) => Math.max(m, (s.id || "").length),
		0,
	);
	const hasLangCells = blockLangs && blockLangs.length > 0;
	let grid = '<div class="tt-grid">';
	sorted.forEach(({ s, evs }, i) => {
		const langCellsHtml = hasLangCells
			? blockLangs
					.map((l, ci) => {
						const num = perLangCounts[i][ci].padStart(
							maxLangWidths[ci],
							_NBSP,
						);
						return `<span class="${_langClassFor(l)}">${escHtml(num)}</span>`;
					})
					.join('<span class="tt-lang-sep">+</span>')
			: "";
		const idPadded = (s.id || "").padStart(maxIdLen, _NBSP);
		const idPrefix = s.id ? `${escHtml(idPadded)}: ` : "";
		grid +=
			`<div><span data-bar-student-idx="${i}" class="tt-student">${idPrefix}${escHtml(s.name)}</span></div>` +
			`<div class="tt-langcell">${langCellsHtml}</div>` +
			`<div class="tt-tokens">${_tokenSpansHtml(evs)}</div>`;
	});
	grid += "</div>";
	return grid;
}

function _wrapBarTooltip(headerHtml, gridHtml) {
	return [
		`<div class="tt-bar-fixed">${headerHtml}</div>`,
		`<div class="tt-bar-fixed">──────────</div>`,
		`<div class="tt-bar-scroll">${gridHtml}</div>`,
	].join("");
}

function formatHit(hit, simple = false) {
	if (simple) return formatHitSimple(hit);

	const lines = [];
	function add(s) {
		lines.push(escHtml(String(s)));
	}

	switch (hit.type) {
		case "burst": {
			const b = hit.b;
			if (b.textParts)
				lines.push(
					_trimBlankLines(
						textPartsToHtml(b.textParts, null, b.evs, _p?.replay),
					),
				);
			break;
		}
		case "bar-block": {
			const { blk, burst, kp, students, langCounts } = hit;
			const MAX_HEADER_LINES = 10;
			let headerHtml = "";
			if (burst && burst.textParts) {
				const blockMissings = (students || []).flatMap(({ evs }) =>
					(evs || []).filter((e) => e.kind === "missing"),
				);
				const partColors = _buildPartColorsForMismatches(
					burst,
					blockMissings,
				);
				const {
					parts: filtered,
					partColors: filteredColors,
					evs: filteredEvs,
				} = _filterAnchorMoveParts(burst.textParts, partColors, burst.evs);
				const {
					parts: trunc,
					truncated,
					evs: truncEvs,
				} = _truncatePartsAtLines(filtered, MAX_HEADER_LINES, filteredEvs);
				headerHtml = _trimBlankLines(
					textPartsToHtml(trunc, filteredColors, truncEvs, _p?.replay),
				);
				if (truncated) headerHtml += "\n…";
			} else if (kp) {
				if (kp._virtualType === "code_insert") {
					const synthBurst = {
						textParts: [_singletonToTextPart(kp)],
						evs: [kp],
					};
					const blockMissings = (students || []).flatMap(({ evs }) =>
						(evs || []).filter((e) => e.kind === "missing"),
					);
					const partColors = _buildPartColorsForMismatches(
						synthBurst,
						blockMissings,
					);
					const {
						parts: filtered,
						partColors: filteredColors,
						evs: filteredEvs,
					} = _filterAnchorMoveParts(
						synthBurst.textParts,
						partColors,
						synthBurst.evs,
					);
					const {
						parts: trunc,
						truncated,
						evs: truncEvs,
					} = _truncatePartsAtLines(filtered, MAX_HEADER_LINES, filteredEvs);
					headerHtml = _trimBlankLines(
						textPartsToHtml(trunc, filteredColors, truncEvs, _p?.replay),
					);
					if (truncated) headerHtml += "\n…";
				} else if (
					kp._virtualType === "anchor" ||
					kp._virtualType === "move"
				) {
					headerHtml = "";
				} else {
					headerHtml = escHtml(kp.char || "");
				}
			}
			const headerLine =
				headerHtml ||
				`<b>${escHtml(fmtTime(blk.ts1))} – ${escHtml(fmtTime(blk.ts2))}</b>`;
			const sorted = [...students].sort(
				(a, b) => (b.s.follow_pct ?? 0) - (a.s.follow_pct ?? 0),
			);
			_barBlockStudents = sorted;
			const blockLangs = LANG_STACK_ORDER.filter(
				(l) => l !== "?" && (langCounts[l] || 0) > 0,
			);
			const perLangCounts = sorted.map(({ evs }) => {
				const pl = {};
				for (const e of evs) {
					const l = e.lang || "?";
					pl[l] = (pl[l] || 0) + 1;
				}
				return blockLangs.map((l) => String(pl[l] || 0));
			});
			const maxLangWidths = blockLangs.map((_l, i) =>
				perLangCounts.reduce((m, arr) => Math.max(m, arr[i].length), 0),
			);
			return _wrapBarTooltip(
				headerLine,
				_renderStudentGrid(
					sorted,
					blockLangs,
					perLangCounts,
					maxLangWidths,
				),
				blockLangs,
			);
		}
		case "token-bar": {
			const { bar } = hit;
			const tokenEsc = escHtml(bar.token || "");
			const tags = [];
			if (bar.isComment) tags.push("comment");
			if (bar.lang) tags.push(bar.lang);
			if (bar.isRemoved) tags.push("ghost");
			const tagStr = tags.length ? ` [${escHtml(tags.join(", "))}]` : "";
			const entries = bar.studentEntries || [];
			if (!entries.length) {
				_barBlockStudents = [];
				return `<b>${tokenEsc}</b>${tagStr}<br><span style="color:#aaa">no mismatches</span>`;
			}
			const sorted = [...entries].sort(
				(a, b) => (b.s.follow_pct ?? 0) - (a.s.follow_pct ?? 0),
			);
			_barBlockStudents = sorted;
			const nStudents = sorted.length;
			const header = nStudents === 1 ? "1 student" : `${nStudents} students`;
			const legendLangs = bar.lang ? [bar.lang] : [];
			return _wrapBarTooltip(
				header,
				_renderStudentGrid(sorted, [], [], []),
				legendLangs,
			);
		}
		case "code_insert": {
			const code = hit.ev.code_insert || "";
			const raw = code.replace(/↩/g, "\n");
			const trimmed = raw
				.replace(/^(?:[ \t]*\n)+/, "")
				.replace(/\n+[ \t]*$/, "");
			lines.push(
				`<span style="color:${THEME.black};text-decoration:underline ${THEME.codeMuted}">${escHtml(trimmed)}</span>`,
			);
			break;
		}
		case "student": {
			const s = hit.s;
			const pct =
				s.follow_pct != null ? s.follow_pct.toFixed(1) + "%" : "N/A";
			const idPrefix = s.id ? `${escHtml(s.id)}. ` : "";
			let html = `<span class="tt-student" data-header-student="1">👤 ${idPrefix}${escHtml(s.name)} (${escHtml(pct)})</span>`;
			const interTypes = [];
			if (_p) {
				const answered = (_p.interactions["teacher-question"] || []).filter(
					(q) =>
						q.answered_by &&
						q.answered_by.some((field) =>
							matchesStudentName(field, s.name),
						),
				);
				for (const q of answered)
					interTypes.push(
						`<span style="color:${INTERACTION_COLORS["teacher-question"].hex}">Answered: ${escHtml(q.info || "?")}</span>`,
					);
				const asked = (_p.interactions["student-question"] || []).filter(
					(q) => q.asked_by && matchesStudentName(q.asked_by, s.name),
				);
				for (const q of asked)
					interTypes.push(
						`<span style="color:${INTERACTION_COLORS["student-question"].hex}">Asked: ${escHtml(q.info || "?")}</span>`,
					);
				const helped = (_p.interactions["providing-help"] || []).filter(
					(q) => q.student && matchesStudentName(q.student, s.name),
				);
				if (helped.length)
					interTypes.push(
						`<span style="color:${INTERACTION_COLORS["providing-help"].hex}">Got help${helped.length > 1 ? " ×" + helped.length : ""}</span>`,
					);
			}
			if (interTypes.length) {
				html += "\n──────────\n" + interTypes.join("\n");
			}

			let cluster = hit.cluster;
			const isDashHover = cluster != null;
			if (!cluster) {
				const clusters = _clusterMistakes(
					_mistakeEventsFor(s),
					CFG.BURST_GAP,
				);
				if (clusters.length) {
					const first = clusters[0];
					cluster = {
						ts1: first[0].ts,
						ts2: first[first.length - 1].ts,
					};
				}
			}

			if (cluster) {
				const allMissings = (s.follow_events || []).filter(
					(ev) => ev.kind === "missing",
				);
				const lookback = CFG.BURST_GAP;
				const winLo = cluster.ts1 - lookback;
				const winHi = cluster.ts2 + lookback;
				const singletonBlocks = (_p?.singletons || [])
					.filter((kp) => {
						const ts = kp.timestamp / 1000;
						return ts >= winLo && ts <= winHi;
					})
					.map((kp) => {
						const ts = kp.timestamp / 1000;
						return {
							startTs: ts,
							endTs: ts,
							textParts: [_singletonToTextPart(kp)],
							evs: [kp],
						};
					});
				const allBlocks = [
					...(_p?.bursts || []).filter(
						(b) => b.endTs >= winLo && b.startTs <= winHi,
					),
					...singletonBlocks,
				].sort((a, b) => a.startTs - b.startTs);
				const blockHtmls = allBlocks
					.map((b) => {
						if (!b.textParts) return "";
						const partColors = _buildPartColorsForMismatches(
							b,
							allMissings,
						);
						const {
							parts: filtered,
							partColors: filteredColors,
							evs: filteredEvs,
						} = _filterAnchorMoveParts(b.textParts, partColors, b.evs);
						const {
							parts: trunc,
							truncated,
							evs: truncEvs,
						} = _truncatePartsAtLines(filtered, 10, filteredEvs);
						let h = _trimBlankLines(
							textPartsToHtml(
								trunc,
								filteredColors,
								truncEvs,
								_p?.replay,
							),
						);
						if (truncated) h += "\n…";
						return h;
					})
					.filter(Boolean);
				if (blockHtmls.length) {
					html += "\n──────────\n" + blockHtmls.join("\n──────────\n");
				}
			}

			const mismatches = (s.follow_events || []).filter(
				(ev) => ev.kind && ev.kind !== "normal",
			);
			mismatches.sort((a, b) => {
				const ea = a.kind === "extra" ? 1 : 0;
				const eb = b.kind === "extra" ? 1 : 0;
				return ea - eb;
			});
			if (mismatches.length) {
				html += "\n──────────\n";
				const counts = new Map();
				const order = [];
				const inSection = new Set();
				for (const ev of mismatches) {
					const key = (ev.token || ev.label) + "|" + ev.kind;
					if (!counts.has(key)) {
						counts.set(key, { ev, n: 0 });
						order.push(key);
					}
					counts.get(key).n++;
					if (
						isDashHover &&
						cluster &&
						ev.ts != null &&
						ev.ts >= cluster.ts1 &&
						ev.ts <= cluster.ts2
					) {
						inSection.add(key);
					}
				}
				html += order
					.map((key) => {
						const { ev, n } = counts.get(key);
						const langCls =
							(ev.kind === "missing" || ev.kind === "extra-star") &&
							ev.lang
								? `${_langClassFor(ev.lang)}${ev.kind === "extra-star" ? " tt-ghost" : ""}`
								: null;
						const markCls =
							langCls ||
							(ev.kind === "missing"
								? "tt-mark-missing"
								: ev.kind === "extra-star"
									? "tt-mark-ghost"
									: "tt-mark-extra");
						const label = escHtml(ev.token || ev.label);
						const suffix = n > 1 ? `<b>×${n}</b>` : "";
						const emphCls = inSection.has(key) ? " tt-emph" : "";
						return `<span class="${markCls}${emphCls}">${label}${suffix}</span>`;
					})
					.join(", ");
			}
			return html;
		}
		default:
			return formatHitSimple(hit);
	}
	return lines.join("\n");
}

function formatHitSimple(hit) {
	switch (hit.type) {
		case "char": {
			const ch = hit.ev.char;
			return ch === "↩" || ch === "\n"
				? `<span class="tt-nl">\\n</span>`
				: escHtml(ch);
		}
		case "dev_char": {
			const ch = hit.ev.char;
			return ch === "↩" || ch === "\n"
				? `<span class="tt-nl">\\n</span>`
				: escHtml(ch);
		}
		case "delete": {
			return escHtml(hit.ev.char);
		}
		case "move": {
			return `<span class="tt-move">→${escHtml(hit.mv.target)}</span>`;
		}
		case "anchor": {
			return `<span class="tt-anchor">${hit.anc.ids.map(escHtml).join("\n")}</span>`;
		}
		case "code_insert": {
			const raw = (hit.ev.code_insert || "").replace(/↩/g, "\n");
			const trimmed = raw
				.replace(/^(?:[ \t]*\n)+/, "")
				.replace(/\n+[ \t]*$/, "");
			return `<span style="color:${THEME.black};text-decoration:underline ${THEME.codeMuted}">${escHtml(trimmed)}</span>`;
		}
		case "interaction": {
			const q = hit.q;
			const clr = INTERACTION_COLORS[hit.itype]?.hex;
			if (hit.itype === "teacher-question") {
				let h = `<span style="color:${clr}">❓ ${escHtml(q.info || "")}</span>`;
				if (q.answered_by && q.answered_by.length) {
					const names = q.answered_by.map((field) =>
						resolveInteractionStudentDisplayWithId(field),
					);
					h += `\nAnswered by: ${names.map(escHtml).join(", ")}`;
				}
				return h;
			} else if (hit.itype === "student-question") {
				let h = `<span style="color:${clr}">🙋 ${escHtml(q.info || "")}</span>`;
				if (q.asked_by) {
					const name = resolveInteractionStudentDisplayWithId(q.asked_by);
					h += `\nAsked by: ${escHtml(name)}`;
				}
				return h;
			} else if (hit.itype === "providing-help") {
				let h = `<span style="color:${clr}">🤝 Providing Help</span>`;
				if (q.student) {
					const name = resolveInteractionStudentDisplayWithId(q.student);
					h += `\nStudent: ${escHtml(name)}`;
				}
				return h;
			}
			return "";
		}
		default:
			return formatHit(hit);
	}
}
