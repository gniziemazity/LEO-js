"use strict";

const tooltipEl = document.getElementById("tooltip");
const vlineEl = document.getElementById("hover-vline");
let _pinned = null;
let _lockKeyDown = false;

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
	const c1 = document.getElementById("chart1");
	if (!charts || !c1) return;
	const cRect = c1.getBoundingClientRect();
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
	return html.replace(/^(?:[ \t]*\n)+/, "").replace(/\n+[ \t]*$/, "");
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

function setupHover(c1, c2, c3, p, L) {
	for (const [canvas, id] of [
		[c1, "c1"],
		[c2, "c2"],
		[c3, "c3"],
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
				if (id === "c3") {
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
						redrawChart3();
					}
				}

				if (effectiveHit) {
					showTip(e.clientX, e.clientY, effectiveHit, false, id);
					if (id === "c2" && effectiveHit.type !== "interaction") {
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
				if (id === "c3") {
					if (_lockedStudent) {
						if (_hoveredCluster) {
							_hoveredCluster = null;
							redrawChart3();
						}
					} else if (_hoveredStudent) {
						_hoveredStudent = null;
						_hoveredCluster = null;
						redrawChart3();
					}
				}
				if (!_pinned) {
					hideTip();
					hideVLine();
				}
			},
			sig,
		);

		canvas.addEventListener(
			"click",
			(e) => {
				if (PAN_STATE.active) return;
				const hit = findHit(e, canvas, id, p, L);
				if (!hit) {
					_pinned = null;
					hideTip();
					hideVLine();
					return;
				}
				if (id === "c3" && hit.type === "student") {
					openDifferentiatorWindow(hit.s);
					return;
				}
				if (_pinned === hit) {
					_pinned = null;
					hideTip();
					hideVLine();
				} else {
					_pinned = hit;
					showTip(e.clientX, e.clientY, hit, true, id);
					if (id === "c2" && hit.type !== "interaction") {
						const ts = _hitTs(hit);
						if (ts != null) showVLine(ts, L);
						else hideVLine();
					} else {
						hideVLine();
					}
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
	const plotH = id === "c1" ? L.plotH1 : id === "c2" ? L.plotH2 : L.plotH3;
	if (mx < M.left || mx > M.left + plotW || my < M.top || my > M.top + plotH)
		return null;
	const ts = xToTs(mx, L);
	const thT = (L.timeMax - L.timeMin) * (10 / plotW);
	if (id === "c1") return hitChart1(ts, p, L, thT);
	if (id === "c2") return hitChart2(ts, my, p, L, thT);
	if (id === "c3") {
		const hit = hitChart3(ts, my, p, L, thT);
		if (_lockedStudent && (!hit || hit.s !== _lockedStudent)) {
			const restricted = hitChart3(ts, my, p, L, thT, _lockedStudent);
			if (restricted) return restricted;
		}
		return hit;
	}
	return null;
}

function hitChart1(ts, p, L, thT) {
	let best = null,
		bestD = Infinity;
	for (const b of p.bursts) {
		if (ts >= b.startTs - thT && ts <= b.endTs + thT) {
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

function hitChart2(ts, my, p, L, thT) {
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

function hitChart3(ts, my, p, L, thT, restrictStudent) {
	if (!_students) return null;
	const DASH_PY = 6;
	const DOT_PX = 7;
	let best = null,
		bestD = Infinity;
	const _minY = L.M.top + (L.plotH3Pad || 0);
	const _maxY = L.M.top + L.plotH3 - (L.plotH3Pad || 0);

	for (const s of _students) {
		if (restrictStudent && s !== restrictStudent) continue;
		const jitter = _shake
			? _jitterMap.get(s.name) || { dx: 0, dy: 0 }
			: { dx: 0, dy: 0 };
		const sy = Math.max(_minY, Math.min(_maxY, studentY(s, L) + jitter.dy));

		const dyDash = Math.abs(my - sy);
		const evs = (s.follow_events || []).filter(
			(e) =>
				e.ts != null && (e.kind === "missing" || e.kind === "extra-star"),
		);
		if (evs.length && dyDash <= DASH_PY) {
			const sorted = [...evs].sort((a, b) => a.ts - b.ts);
			let cl0 = sorted[0].ts;
			let clN = sorted[0].ts;
			for (let i = 1; i <= sorted.length; i++) {
				const cur = i < sorted.length ? sorted[i] : null;
				if (cur && cur.ts - clN < CFG.BURST_GAP) {
					clN = cur.ts;
					continue;
				}
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
				if (cur) {
					cl0 = cur.ts;
					clN = cur.ts;
				}
			}
		}

		if (s.follow_dt != null && s.follow_pct === 100) {
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
	tooltipEl.style.display = "block";
	tooltipEl.style.background = bgForHit(hit);
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

function bgForHit(hit) {
	if (!hit) return "var(--clr-bg)";
	switch (hit.type) {
		case "move":
			return "var(--clr-tip-bg-orange)";
		case "anchor":
			return "var(--clr-tip-bg-blue)";
		case "code_insert":
			return "#F5F5F5";
		case "dev_char":
			return "var(--clr-tip-bg-green)";
		case "delete":
			return "#FFEBEE";
		case "char":
			return "var(--clr-bg)";
		case "burst":
			return hit.b?.colorType === "dev"
				? "var(--clr-tip-bg-green)"
				: "var(--clr-bg)";
		case "interaction":
			return INTERACTION_COLORS[hit.itype]?.tipBg ?? "var(--clr-bg)";
		default:
			return "var(--clr-bg)";
	}
}

function textPartsToHtml(parts, partColors) {
	const colors = partColors || null;
	let charCount = 0;
	const MAX = 300;
	let html = "";
	let truncated = false;
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
		if (truncated) break;
		const p = parts[i];
		if (p.type === "anchor") {
			flushPending();
			html += `<span style="color:${BAR_COLORS.anchor}">${escHtml(p.t)}</span>`;
		} else if (p.type === "move") {
			flushPending();
			html += `<span style="color:${BAR_COLORS.move}">→${escHtml(p.t)}</span>`;
		} else if (p.type === "code_insert") {
			flushPending();
			const raw = (p.t || "").replace(/⚓[^⚓]*⚓/g, "").replace(/↩/g, "\n");
			const display = raw.length > 200 ? raw.slice(0, 200) + "…" : raw;
			const offsetColors = colors ? colors.get(i) : null;
			if (offsetColors instanceof Map && offsetColors.size > 0) {
				let curColor = null;
				let curBuf = "";
				const flushSeg = () => {
					if (!curBuf) return;
					if (curColor) {
						html += `<span style="color:${curColor};font-weight:bold;text-decoration:underline">${escHtml(curBuf)}</span>`;
					} else {
						html += `<span style="color:${THEME.muted}">${escHtml(curBuf)}</span>`;
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
				html += `<span style="color:${THEME.muted}">${escHtml(display)}</span>`;
			}
		} else {
			if (charCount >= MAX) {
				flushPending();
				html += escHtml("\n… (+more chars)");
				truncated = true;
			} else {
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
					const col = isPaleRed ? THEME.paleRed : THEME.red;
					html += `<span style="color:${col}">${escHtml(ch)}</span>`;
				} else {
					const color = colors ? colors.get(i) || null : null;
					const rendered = escHtml(ch === "↩" ? "\n" : ch);
					if (color !== pendingColor) {
						flushPending();
						pendingColor = color;
					}
					pendingBuf += rendered;
				}
				charCount++;
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
			text = (p.t || "").replace(/⚓[^⚓]*⚓/g, "").replace(/↩/g, "\n");
		}
		if (!text) continue;
		const ts = (evs[pi]?.timestamp ?? 0) / 1000;
		for (let k = 0; k < text.length; k++) {
			codeChars.push({ partIdx: pi, partOffset: k, ch: text[k], ts });
		}
	}
	const codeStr = codeChars.map((c) => c.ch).join("");
	const TOKEN_RE = /[a-zA-Z0-9]+|[^\s]/g;
	const burstTokens = [];
	let m;
	while ((m = TOKEN_RE.exec(codeStr)) !== null) {
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
		candidates.push({ token: tok, ts: mm.ts, claimed: false });
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
	const missingColor = _cssVar("--clr-mark-missing");
	for (const pair of pairs) {
		if (burstTokens[pair.bi].claimed || candidates[pair.ci].claimed) continue;
		burstTokens[pair.bi].claimed = true;
		candidates[pair.ci].claimed = true;
		const bt = burstTokens[pair.bi];
		for (let j = bt.startIdx; j < bt.endIdx; j++) {
			const cc = codeChars[j];
			const part = parts[cc.partIdx];
			if (part.type === "code_insert") {
				let m = partColors.get(cc.partIdx);
				if (!(m instanceof Map)) {
					m = new Map();
					partColors.set(cc.partIdx, m);
				}
				m.set(cc.partOffset, missingColor);
			} else {
				partColors.set(cc.partIdx, missingColor);
			}
		}
	}
	return partColors;
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
		case "code_insert": {
			const code = hit.ev.code_insert || "";
			const raw = code.replace(/↩/g, "\n");
			const trimmed = raw
				.replace(/^(?:[ \t]*\n)+/, "")
				.replace(/\n+[ \t]*$/, "");
			const display =
				trimmed.length > 280
					? trimmed.slice(0, 280) +
						`\n… (+${trimmed.length - 280} more chars)`
					: trimmed;
			lines.push(
				`<span style="color:${THEME.muted}">${escHtml(display)}</span>`,
			);
			break;
		}
		case "student": {
			const s = hit.s;
			const pct =
				s.follow_pct != null ? s.follow_pct.toFixed(1) + "%" : "N/A";
			let html = `👤 ${escHtml(s.name)} (${escHtml(pct)})`;
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
				const evs = (s.follow_events || []).filter(
					(e) =>
						e.ts != null &&
						(e.kind === "missing" || e.kind === "extra-star"),
				);
				if (evs.length) {
					const sorted = [...evs].sort((a, b) => a.ts - b.ts);
					let cl0 = sorted[0].ts;
					let clN = sorted[0].ts;
					for (let i = 1; i < sorted.length; i++) {
						if (sorted[i].ts - clN < CFG.BURST_GAP) {
							clN = sorted[i].ts;
						} else {
							break;
						}
					}
					cluster = { ts1: cl0, ts2: clN };
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
						let textPart;
						if (kp._virtualType === "anchor")
							textPart = { t: kp._target || "", type: "anchor" };
						else if (kp._virtualType === "move")
							textPart = { t: kp._target || "", type: "move" };
						else if (kp._virtualType === "code_insert")
							textPart = {
								t: kp.code_insert || "",
								type: "code_insert",
							};
						else textPart = { t: kp.char || "", type: "char" };
						return {
							startTs: ts,
							endTs: ts,
							textParts: [textPart],
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
						return _trimBlankLines(
							textPartsToHtml(b.textParts, partColors),
						);
					})
					.filter(Boolean);
				if (blockHtmls.length) {
					html += "\n──────────\n" + blockHtmls.join("\n──────────\n");
				}
			}

			const mismatches = (s.follow_events || []).filter(
				(ev) => ev.kind && ev.kind !== "normal",
			);
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
						const color =
							ev.kind === "missing"
								? _cssVar("--clr-mark-missing")
								: ev.kind === "extra-star"
									? _cssVar("--clr-mark-ghost")
									: _cssVar("--clr-mark-extra");
						const label = escHtml(ev.token || ev.label);
						const suffix = n > 1 ? `<b>×${n}</b>` : "";
						const emph = inSection.has(key)
							? "font-weight:bold;text-decoration:underline;"
							: "";
						return `<span style="color:${color};${emph}">${label}${suffix}</span>`;
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
			return `<span style="color:${BAR_COLORS.move}">→${escHtml(hit.mv.target)}</span>`;
		}
		case "anchor": {
			return `<span style="color:${BAR_COLORS.anchor}">${hit.anc.ids.map(escHtml).join("\n")}</span>`;
		}
		case "code_insert": {
			const raw = (hit.ev.code_insert || "").replace(/↩/g, "\n");
			const trimmed = raw
				.replace(/^(?:[ \t]*\n)+/, "")
				.replace(/\n+[ \t]*$/, "");
			const display =
				trimmed.length > 280
					? trimmed.slice(0, 280) +
						`\n… (+${trimmed.length - 280} more chars)`
					: trimmed;
			return `<span style="color:${THEME.muted}">${escHtml(display)}</span>`;
		}
		case "interaction": {
			const q = hit.q;
			const clr = INTERACTION_COLORS[hit.itype]?.hex;
			if (hit.itype === "teacher-question") {
				let h = `<span style="color:${clr}">❓ ${escHtml(q.info || "")}</span>`;
				if (q.answered_by && q.answered_by.length) {
					const names = q.answered_by.map((field) =>
						resolveInteractionStudentDisplay(field),
					);
					h += `\nAnswered by: ${names.map(escHtml).join(", ")}`;
				}
				return h;
			} else if (hit.itype === "student-question") {
				let h = `<span style="color:${clr}">🙋 ${escHtml(q.info || "")}</span>`;
				if (q.asked_by) {
					const name = resolveInteractionStudentDisplay(q.asked_by);
					h += `\nAsked by: ${escHtml(name)}`;
				}
				return h;
			} else if (hit.itype === "providing-help") {
				let h = `<span style="color:${clr}">🤝 Providing Help</span>`;
				if (q.student) {
					const name = resolveInteractionStudentDisplay(q.student);
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
