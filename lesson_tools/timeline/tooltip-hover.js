"use strict";

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
