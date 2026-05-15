"use strict";

const tooltipEl = document.getElementById("tooltip");
const vlineEl = document.getElementById("hover-vline");
let _pinned = null;
let _lockKeyDown = false;
let _barBlockStudents = [];

tooltipEl.addEventListener("click", (e) => {
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

		const handleSelect = (e, openDiff) => {
			if (PAN_STATE.active) return;
			const hit = findHit(e, canvas, id, p, L);
			if (openDiff && id === "bottom" && hit && hit.type === "student") {
				openDifferentiatorWindow(hit.s);
			}
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

		canvas.addEventListener(
			"click",
			(e) => {
				handleSelect(e, true);
			},
			sig,
		);
		canvas.addEventListener(
			"contextmenu",
			(e) => {
				e.preventDefault();
				handleSelect(e, false);
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
	const allStudentEvs = _students.map(_mistakeEventsFor);
	let maxCount = 0;
	for (const b of blocks) {
		const n = _countStudentsInRange(allStudentEvs, b.ts1, b.ts2);
		if (n > maxCount) maxCount = n;
	}
	const denom = Math.max(1, maxCount);
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
	tooltipEl.innerHTML = formatHit(hit, chartId === "c2");
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

function _filterAnchorMoveParts(parts, partColors) {
	const out = [];
	const colorsOut = partColors ? new Map() : null;
	for (let i = 0; i < parts.length; i++) {
		const p = parts[i];
		if (p.type === "anchor" || p.type === "move") continue;
		const newIdx = out.length;
		out.push(p);
		if (partColors && partColors.has(i)) {
			colorsOut.set(newIdx, partColors.get(i));
		}
	}
	return { parts: out, partColors: colorsOut };
}

function _truncatePartsAtLines(parts, maxLines) {
	const isNL = (ch) => ch === "↩" || ch === "\n";
	let n = 0;
	const out = [];
	for (const p of parts) {
		if (p.type === "char" && isNL(p.t)) {
			if (n >= maxLines) return { parts: out, truncated: true };
			n++;
			out.push(p);
		} else if (p.type === "code_insert") {
			const t = p.t || "";
			let newlinesInInsert = 0;
			for (const ch of t) if (isNL(ch)) newlinesInInsert++;
			if (n + newlinesInInsert > maxLines) {
				const remaining = maxLines - n;
				let seen = 0;
				let cutAt = t.length;
				for (let i = 0; i < t.length; i++) {
					if (isNL(t[i])) {
						seen++;
						if (seen > remaining) {
							cutAt = i;
							break;
						}
					}
				}
				out.push({ ...p, t: t.slice(0, cutAt) });
				return { parts: out, truncated: true };
			}
			n += newlinesInInsert;
			out.push(p);
		} else {
			out.push(p);
		}
	}
	return { parts: out, truncated: false };
}

function textPartsToHtml(parts, partColors) {
	const colors = partColors || null;
	let html = "";
	let pendingBuf = "";
	let pendingColor = null;
	const flushPending = () => {
		if (!pendingBuf) return;
		if (pendingColor) {
			html += `<span style="color:${pendingColor};font-weight:bold;text-decoration:underline">${pendingBuf}</span>`;
		} else {
			html += pendingBuf;
		}
		pendingBuf = "";
		pendingColor = null;
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
			if (offsetColors instanceof Map && offsetColors.size > 0) {
				let curColor = null;
				let curBuf = "";
				const flushSeg = () => {
					if (!curBuf) return;
					if (curColor) {
						html += `<span style="color:${curColor};font-weight:bold;text-decoration:underline">${escHtml(curBuf)}</span>`;
					} else {
						html += `<span class="tt-muted">${escHtml(curBuf)}</span>`;
					}
					curBuf = "";
				};
				for (let k = 0; k < display.length; k++) {
					const c = offsetColors.get(k) || null;
					if (c !== curColor) {
						flushSeg();
						curColor = c;
					}
					curBuf += display[k];
				}
				flushSeg();
			} else {
				html += `<span class="tt-muted">${escHtml(display)}</span>`;
			}
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
					const rendered = escHtml(ch === "↩" ? "\n" : ch);
					if (color !== pendingColor) {
						flushPending();
						pendingColor = color;
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
	for (let pi = 0; pi < parts.length; pi++) {
		const p = parts[pi];
		if (p.type !== "char" && p.type !== "code_insert") continue;
		if (p.type === "char" && DELETE_CHARS.has(p.t)) continue;
		let text;
		if (p.type === "char") {
			text = p.t === "↩" ? "\n" : p.t || "";
		} else {
			text = _displayCodeInsert(p.t);
		}
		if (!text) continue;
		const baseTs = (evs[pi]?.timestamp ?? 0) / 1000;
		const perCharBump = p.type === "code_insert";
		for (let k = 0; k < text.length; k++) {
			const ts = perCharBump ? baseTs + k / 1000 : baseTs;
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
	for (const mm of mismatches || []) {
		if (mm.kind !== "missing") continue;
		const tok = mm.token || mm.label || "";
		if (!tok || mm.ts == null) continue;
		candidates.push({
			token: tok,
			ts: mm.ts,
			lang: mm.lang || null,
			claimed: false,
		});
	}
	const pairs = [];
	for (let bi = 0; bi < burstTokens.length; bi++) {
		for (let ci = 0; ci < candidates.length; ci++) {
			if (burstTokens[bi].token !== candidates[ci].token) continue;
			const diff = burstTokens[bi].ts - candidates[ci].ts;
			if (diff < -0.001 || diff >= 1) continue;
			pairs.push({ bi, ci, diff });
		}
	}
	pairs.sort((a, b) => a.diff - b.diff);
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

function _renderLangLegend(langs) {
	if (!langs || !langs.length) return "";
	const items = [];
	for (const l of langs) {
		if (l === "comment" || !_langBarColorOf(l)) continue;
		if (items.indexOf(l) === -1) items.push(l);
	}
	if (!items.length) return "";
	return `<span class="tt-lang-legend">${items
		.map(
			(l) =>
				`<span style="color:${_langBarColorOf(l)}">${escHtml(l)}</span>`,
		)
		.join("")}</span>`;
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
				lines.push(_trimBlankLines(textPartsToHtml(b.textParts)));
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
				const { parts: filtered, partColors: filteredColors } =
					_filterAnchorMoveParts(burst.textParts, partColors);
				const { parts: trunc, truncated } = _truncatePartsAtLines(
					filtered,
					MAX_HEADER_LINES,
				);
				headerHtml = _trimBlankLines(
					textPartsToHtml(trunc, filteredColors),
				);
				if (truncated) headerHtml += "\n…";
			} else if (kp) {
				if (kp._virtualType === "code_insert") {
					const raw = _displayCodeInsert(kp.code_insert);
					const trimmed = raw
						.replace(/^(?:[ \t]*\n)+/, "")
						.replace(/\n+[ \t]*$/, "");
					const allLines = trimmed.split("\n");
					const truncated = allLines.length > MAX_HEADER_LINES;
					const display = truncated
						? allLines.slice(0, MAX_HEADER_LINES).join("\n") + "\n…"
						: trimmed;
					headerHtml = `<span class="tt-muted">${escHtml(display)}</span>`;
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
			lines.push(`<span class="tt-muted">${escHtml(trimmed)}</span>`);
			break;
		}
		case "student": {
			const s = hit.s;
			const pct =
				s.follow_pct != null ? s.follow_pct.toFixed(1) + "%" : "N/A";
			const idPrefix = s.id ? `${escHtml(s.id)}. ` : "";
			let html = `👤 ${idPrefix}${escHtml(s.name)} (${escHtml(pct)})`;
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
						const { parts: filtered, partColors: filteredColors } =
							_filterAnchorMoveParts(b.textParts, partColors);
						const { parts: trunc, truncated } = _truncatePartsAtLines(
							filtered,
							10,
						);
						let h = _trimBlankLines(
							textPartsToHtml(trunc, filteredColors),
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
			return ch === "↩" ? "↩ (Enter)" : escHtml(ch);
		}
		case "dev_char": {
			const ch = hit.ev.char;
			return ch === "↩" ? "↩ (Enter)" : escHtml(ch);
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
			return `<span class="tt-muted">${escHtml(trimmed)}</span>`;
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
