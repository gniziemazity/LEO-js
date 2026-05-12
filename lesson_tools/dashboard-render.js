"use strict";

function tsToX(ts, L) {
	return L.M.left + (L.plotW * (ts - L.timeMin)) / (L.timeMax - L.timeMin);
}
function xToTs(x, L) {
	return L.timeMin + ((x - L.M.left) / L.plotW) * (L.timeMax - L.timeMin);
}

const RATE_Y_LO = 5,
	RATE_Y_HI = 1500;
function rateToY(r, L) {
	const t =
		(Math.log10(Math.max(r, RATE_Y_LO)) - Math.log10(RATE_Y_LO)) /
		(Math.log10(RATE_Y_HI) - Math.log10(RATE_Y_LO));
	return L.M.top + L.plotHmid * (1 - t);
}
function countToY(n, maxN, L) {
	const pad = L.plotHtopPad || 0;
	return L.M.top + pad + (L.plotHtop - 2 * pad) * (1 - n / Math.max(maxN, 1));
}
function pctToY(pct, L) {
	const pad = L.plotHbotPad || 0;
	return (
		L.M.top +
		pad +
		(L.plotHbot - 2 * pad) * (1 - Math.max(0, Math.min(100, pct)) / 100)
	);
}

const BOTTOM_CHART_LEGEND_HEIGHT = 22;

function makeLayout(p, W, Hmid, Htop, Hbot) {
	const M = CFG.M;
	return {
		W,
		M,
		Hmid,
		Htop,
		Hbot,
		plotW: W - M.left - M.right,
		plotHmid: Hmid - M.top - M.bottom,
		plotHtop: Htop - M.top - M.bottom,
		plotHtopPad: 8,
		plotHbot: Hbot - M.top - BOTTOM_CHART_LEGEND_HEIGHT,
		plotHbotPad: 8,
		timeMin: _zoomMin ?? p.sessionStart - CFG.PADDING,
		timeMax: _zoomMax ?? p.sessionEnd + CFG.PADDING,
	};
}

function prep(c, W, H) {
	const dpr = window.devicePixelRatio || 1;
	c.width = W * dpr;
	c.height = H * dpr;
	c.style.width = W + "px";
	c.style.height = H + "px";
	const ctx = c.getContext("2d");
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	return ctx;
}

function scheduleRender() {
	if (_renderScheduled) return;
	_renderScheduled = true;
	requestAnimationFrame(() => {
		_renderScheduled = false;
		showLoading(false);
		if (_p) renderCharts(_p);
	});
}

function renderCharts(p) {
	const middleChart = document.getElementById("chart-middle");
	const topChart = document.getElementById("chart-top");
	const bottomChart = document.getElementById("chart-bottom");
	const W = middleChart.parentElement.clientWidth;
	const Hmid = middleChart.parentElement.clientHeight;
	const Htop = topChart.parentElement.clientHeight;
	const Hbot = _students ? bottomChart.parentElement.clientHeight : 0;
	const L = makeLayout(p, W, Hmid, Htop, Hbot);
	_lastL = L;

	drawMiddleChart(prep(middleChart, W, Hmid), p, L);
	drawTopChart(prep(topChart, W, Htop), p, L);
	setupTopChartLegend(p);
	if (_students) {
		setupBottomChartLegend();
		drawBottomChart(prep(bottomChart, W, Hbot), p, _students, L);
	}

	setupZoomPan(middleChart, p, L);
	setupZoomPan(topChart, p, L);
	if (_students) setupZoomPan(bottomChart, p, L);
	setupHover(middleChart, topChart, bottomChart, p, L);
}

function redrawBottomChart() {
	if (!_p || !_students || !_lastL) return;
	const bottomChart = document.getElementById("chart-bottom");
	const dpr = window.devicePixelRatio || 1;
	const ctx = bottomChart.getContext("2d");
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	drawBottomChart(ctx, _p, _students, _lastL);
}

const BAR_COLORS = {
	normal: THEME.gray,
	dev: THEME.green,
	remove: THEME.red,
	anchor: THEME.blue,
	move: THEME.orange,
};

const LANG_BAR_COLORS = {
	HTML: THEME.red,
	CSS: THEME.blue,
	JS: THEME.orange,
	Py: THEME.green,
	"?": THEME.gray,
};
const LANG_STACK_ORDER = ["HTML", "CSS", "JS", "Py", "?"];

function _burstColorKey(b) {
	if (b.chars > 0) return b.colorType || "normal";
	if (b.hasCodeInserts) return "normal";
	if (b.hasAnchors) return "anchor";
	if (b.hasMoves) return "move";
	return "normal";
}

function _singletonColorKey(kp) {
	if (kp._virtualType === "anchor") return "anchor";
	if (kp._virtualType === "move") return "move";
	if (kp._virtualType === "code_insert") return "normal";
	if (kp._editor === "dev") return "dev";
	if (DELETE_CHARS.has(kp.char)) return "remove";
	return "normal";
}

function _buildBottomChartBlocks(p) {
	const blocks = [];
	const seen = new Set();
	for (const b of p.bursts || []) {
		const key = `b|${b.startTs}|${b.endTs}`;
		if (seen.has(key)) continue;
		seen.add(key);
		blocks.push({
			ts1: b.startTs,
			ts2: b.endTs,
			centerTs: b.centerTs,
			dur: b.dur,
			burst: b,
			kp: null,
			colorKey: _burstColorKey(b),
		});
	}
	const half = CFG.BAR_MIN_SECS / 2;
	for (const kp of p.singletons || []) {
		const ts = kp.timestamp / 1000;
		const key = `s|${ts}`;
		if (seen.has(key)) continue;
		seen.add(key);
		blocks.push({
			ts1: ts - half,
			ts2: ts + half,
			centerTs: ts,
			dur: 0,
			burst: null,
			kp,
			colorKey: _singletonColorKey(kp),
		});
	}
	return blocks;
}

const _topChartVisible = {
	chars: true,
	inserts: true,
	deletes: true,
	anchors: true,
	dev: true,
	moves: true,
};

const _bottomChartVisible = {
	firstMismatch: true,
	followRank: true,
	interactions: true,
	barMode: true,
};

let _studentYByName = new Map();

function _computeStudentYs(students, L) {
	_studentYByName = new Map();
	if (!students || !students.length) return;
	if (!_bottomChartVisible.followRank) {
		for (const s of students) {
			_studentYByName.set(s.name, pctToY(s.follow_pct ?? 0, L));
		}
		return;
	}
	const sorted = [...students].sort(
		(a, b) => (b.follow_pct ?? 0) - (a.follow_pct ?? 0),
	);
	const N = sorted.length;
	const pad = L.plotHbotPad || 0;
	const usableH = Math.max(0, L.plotHbot - 2 * pad);
	for (let i = 0; i < N; i++) {
		const y = L.M.top + pad + ((i + 0.5) / N) * usableH;
		_studentYByName.set(sorted[i].name, y);
	}
}

function studentY(s, L) {
	const y = _studentYByName.get(s.name);
	if (y != null) return y;
	return pctToY(s.follow_pct ?? 0, L);
}

function setupBottomChartLegend() {
	const cb1 = document.getElementById("leg-bottom-firstmismatch");
	if (cb1) {
		cb1.checked = _bottomChartVisible.firstMismatch;
		cb1.onchange = () => {
			_bottomChartVisible.firstMismatch = cb1.checked;
			scheduleRender();
		};
	}
	const cb2 = document.getElementById("leg-bottom-followrank");
	if (cb2) {
		cb2.checked = _bottomChartVisible.followRank;
		cb2.onchange = () => {
			_bottomChartVisible.followRank = cb2.checked;
			scheduleRender();
		};
	}
	const cb3 = document.getElementById("leg-bottom-interactions");
	if (cb3) {
		cb3.checked = _bottomChartVisible.interactions;
		cb3.onchange = () => {
			_bottomChartVisible.interactions = cb3.checked;
			scheduleRender();
		};
	}
	const cb4 = document.getElementById("leg-bottom-barmode");
	if (cb4) {
		cb4.checked = _bottomChartVisible.barMode;
		cb4.onchange = () => {
			_bottomChartVisible.barMode = cb4.checked;
			scheduleRender();
		};
	}
}

function setupTopChartLegend(p) {
	const lessonEl = document.getElementById("leg-lesson");
	if (lessonEl) lessonEl.textContent = _dirHandle?.name || "";
	const totalEl = document.getElementById("leg-total");
	if (totalEl) totalEl.textContent = `Total Events: ${p.eventCount}`;
	const items = [
		{ key: "chars", count: p.totalChars },
		{ key: "inserts", count: p.codeInserts.length },
		{ key: "deletes", count: p.deletes.length },
		{ key: "dev", count: p.devChars.length },
		{ key: "anchors", count: p.anchors.length },
		{ key: "moves", count: p.moves.length },
	];
	for (const { key, count } of items) {
		const cb = document.getElementById("leg-" + key);
		if (!cb) continue;
		const countEl = cb.closest("label")?.querySelector(".leg-count");
		if (countEl) countEl.textContent = `(${count})`;
		cb.onchange = () => {
			_topChartVisible[key] = cb.checked;
			scheduleRender();
		};
	}
}

function drawMiddleChart(ctx, p, L) {
	const { M, W, Hmid: H, plotW, plotHmid } = L;
	const bottomY = M.top + plotHmid;
	const minBarW =
		tsToX(p.sessionStart + CFG.BAR_MIN_SECS, L) - tsToX(p.sessionStart, L);

	ctx.fillStyle = "#fff";
	ctx.fillRect(0, 0, W, H);

	ctx.save();
	ctx.beginPath();
	ctx.rect(M.left, M.top, plotW, plotHmid);
	ctx.clip();

	ctx.strokeStyle = "#e8e8e8";
	ctx.lineWidth = 1;
	for (const r of [10, 20, 50, 100, 200, 500, 1000]) {
		const y = rateToY(r, L);
		ctx.beginPath();
		ctx.moveTo(M.left, y);
		ctx.lineTo(M.left + plotW, y);
		ctx.stroke();
	}

	function bar(ts, rate, dur, colorKey, alpha = 0.72) {
		const x = tsToX(ts - dur / 2, L);
		const x2 = tsToX(ts + dur / 2, L);
		const bw = Math.max(x2 - x, minBarW);
		const cx = (x + x2) / 2;
		const bx = cx - bw / 2;
		const y = rateToY(rate, L);
		const bh = bottomY - y;
		const fill = BAR_COLORS[colorKey] || BAR_COLORS.normal;
		ctx.globalAlpha = alpha;
		ctx.fillStyle = fill;
		ctx.fillRect(bx, y, bw, bh);
		ctx.globalAlpha = 1;
		ctx.strokeStyle = fill;
		ctx.lineWidth = 0.5;
		ctx.strokeRect(bx, y, bw, bh);
	}

	for (const b of p.bursts) {
		if (b.chars > 0) {
			const hasVirtual = b.hasCodeInserts || b.hasAnchors || b.hasMoves;
			const effectiveRate = hasVirtual ? Math.max(b.rate, 20) : b.rate;
			bar(b.centerTs, effectiveRate, b.dur, b.colorType);
		} else if (b.hasCodeInserts) {
			const insLen = b.evs
				.filter((e) => e._virtualType === "code_insert")
				.reduce((s, e) => s + (e.code_insert || "").length, 0);
			bar(
				b.centerTs,
				Math.max(10, insLen / (CFG.BAR_MIN_SECS / 60)),
				b.dur,
				"normal",
			);
		} else if (b.hasAnchors || b.hasMoves) {
			bar(b.centerTs, 20, b.dur, b.hasAnchors ? "anchor" : "move", 0.7);
		}
	}
	for (const kp of p.singletons) {
		if (kp._virtualType === "anchor") {
			bar(kp.timestamp / 1000, 20, 0, "anchor", 0.7);
		} else if (kp._virtualType === "move") {
			bar(kp.timestamp / 1000, 20, 0, "move", 0.7);
		} else if (kp._virtualType === "code_insert") {
			bar(
				kp.timestamp / 1000,
				Math.max(
					10,
					(kp.code_insert || "").length / (CFG.BAR_MIN_SECS / 60),
				),
				0,
				"normal",
			);
		} else {
			const ck =
				kp._editor === "dev"
					? "dev"
					: DELETE_CHARS.has(kp.char)
						? "remove"
						: "normal";
			bar(kp.timestamp / 1000, 20, 0, ck);
		}
	}

	ctx.lineWidth = 2;
	ctx.globalAlpha = 0.7;
	function rateLine(r, clr) {
		const y = rateToY(r, L);
		ctx.strokeStyle = clr;
		ctx.setLineDash([6, 4]);
		ctx.beginPath();
		ctx.moveTo(M.left, y);
		ctx.lineTo(M.left + plotW, y);
		ctx.stroke();
		ctx.setLineDash([]);
	}
	rateLine(p.sessionRate, "#888888");
	rateLine(p.activeRate, "#000000");
	ctx.globalAlpha = 1;

	ctx.restore();

	drawYAxisLog(ctx, L);
	rotatedLabel(
		ctx,
		22,
		L.M.top + L.plotHmid / 2,
		"Keys / Minute",
		THEME.label,
	);

	ctx.font = "10px Consolas,monospace";
	ctx.textAlign = "left";
	const lx = M.left + plotW - 110,
		ly = M.top - 2;
	[
		[`Session: ${p.sessionRate.toFixed(1)} kpm`, "#888888"],
		[`Active:  ${p.activeRate.toFixed(1)} kpm`, "#000000"],
	].forEach(([lbl, clr], i) => {
		const yy = ly + i * 16;
		ctx.fillStyle = clr;
		ctx.fillText(lbl, lx + 14, yy + 9);
	});

	drawTimeAxis(ctx, L, M.top + plotHmid, H);
}

function drawTopChart(ctx, p, L) {
	const { M, W, Htop: H, plotW, plotHtop } = L;
	const cum = p.cumulative;
	const maxN = p.totalChars || 1;
	const gs = niceStep(maxN, 5);

	ctx.fillStyle = "#fff";
	ctx.fillRect(0, 0, W, H);

	ctx.save();
	ctx.beginPath();
	ctx.rect(M.left, M.top, plotW, plotHtop);
	ctx.clip();

	ctx.strokeStyle = "#e8e8e8";
	ctx.lineWidth = 1;
	for (let v = gs; v <= maxN; v += gs) {
		const y = countToY(v, maxN, L);
		ctx.beginPath();
		ctx.moveTo(M.left, y);
		ctx.lineTo(M.left + plotW, y);
		ctx.stroke();
	}

	drawInteractionSpans(ctx, p, L, M.top, plotHtop, {
		...Object.fromEntries(
			Object.entries(INTERACTION_COLORS).map(([k, v]) => [k, v.spanRgba]),
		),
		"teacher-question": (q) =>
			q.answered_by?.length
				? INTERACTION_COLORS["teacher-question"].spanRgba
				: INTERACTION_COLORS["teacher-question"].spanRgbaUnanswered,
	});

	if (cum.length > 1) {
		const pts = cum.map((c) => [tsToX(c.ts, L), countToY(c.count, maxN, L)]);
		ctx.beginPath();
		ctx.moveTo(pts[0][0], pts[0][1]);
		for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
		ctx.lineTo(pts[pts.length - 1][0], M.top + plotHtop);
		ctx.lineTo(pts[0][0], M.top + plotHtop);
		ctx.closePath();
		ctx.fillStyle = "rgba(204,204,204,0.3)";
		ctx.fill();
		ctx.beginPath();
		ctx.moveTo(pts[0][0], pts[0][1]);
		for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
		ctx.strokeStyle = "#CCCCCC";
		ctx.lineWidth = 2;
		ctx.stroke();
	}

	const R = CFG.DOT_R,
		DR = CFG.DIA_R;

	function dot(x, y, fill, alpha = 1) {
		ctx.save();
		ctx.globalAlpha = alpha;
		ctx.beginPath();
		ctx.arc(x, y, R, 0, Math.PI * 2);
		ctx.fillStyle = fill;
		ctx.fill();
		ctx.restore();
	}
	function dia(x, y, fill, alpha = 1) {
		ctx.save();
		ctx.globalAlpha = alpha;
		const outerR = DR - 2;
		ctx.beginPath();
		ctx.moveTo(x, y - outerR);
		ctx.lineTo(x + outerR, y);
		ctx.lineTo(x, y + outerR);
		ctx.lineTo(x - outerR, y);
		ctx.closePath();
		ctx.fillStyle = fill;
		ctx.fill();
		ctx.strokeStyle = "#888";
		ctx.lineWidth = 2.5;
		ctx.stroke();
		const ir = 3;
		ctx.beginPath();
		ctx.moveTo(x, y - ir);
		ctx.lineTo(x + ir, y);
		ctx.lineTo(x, y + ir);
		ctx.lineTo(x - ir, y);
		ctx.closePath();
		ctx.fillStyle = "#000";
		ctx.fill();
		ctx.restore();
	}

	if (_topChartVisible.chars)
		for (const grp of p.burstGroups)
			for (const idx of grp.idxs) {
				const c = cum[idx];
				if (!c) continue;
				dot(tsToX(c.ts, L), countToY(c.count, maxN, L), "#000", 1.0);
			}
	if (_topChartVisible.deletes)
		for (const ev of p.deletes) {
			const ts = ev.timestamp / 1000;
			dot(
				tsToX(ts, L),
				countToY(charsAt(ts, cum), maxN, L),
				ev._isStructuralDelete ? THEME.paleRed : BAR_COLORS.remove,
				1.0,
			);
		}
	if (_topChartVisible.dev)
		for (const ev of p.devChars) {
			const ts = ev.timestamp / 1000;
			dot(
				tsToX(ts, L),
				countToY(charsAt(ts, cum), maxN, L),
				BAR_COLORS.dev,
				1.0,
			);
		}
	if (_topChartVisible.anchors)
		for (const anc of p.anchors) {
			const ts = anc.ts / 1000;
			dot(
				tsToX(ts, L),
				countToY(charsAt(ts, cum), maxN, L),
				BAR_COLORS.anchor,
				1.0,
			);
		}
	if (_topChartVisible.moves)
		for (const mv of p.moves) {
			const ts = mv.ts / 1000;
			dot(
				tsToX(ts, L),
				countToY(charsAt(ts, cum), maxN, L),
				BAR_COLORS.move,
				1.0,
			);
		}
	if (_topChartVisible.inserts)
		for (const ev of p.codeInserts) {
			const ts = ev.timestamp / 1000;
			dia(tsToX(ts, L), countToY(charsAt(ts, cum), maxN, L), "#999999");
		}

	ctx.restore();

	ctx.fillStyle = "#555";
	ctx.font = "11px Consolas,monospace";
	ctx.textAlign = "right";
	ctx.strokeStyle = "#aaa";
	ctx.lineWidth = 1;
	for (let v = gs; v <= maxN; v += gs) {
		const y = countToY(v, maxN, L);
		ctx.fillText(v, M.left - 3, y + 4);
		ctx.beginPath();
		ctx.moveTo(M.left - 3, y);
		ctx.lineTo(M.left, y);
		ctx.stroke();
	}
	rotatedLabel(ctx, 22, M.top + plotHtop / 2, "Chars Typed", THEME.label);

	drawTimeAxis(ctx, L, M.top + plotHtop, H);
}

function drawBottomChart(ctx, p, students, L) {
	const { M, W, Hbot: H, plotW, plotHbot } = L;
	const gs = 10;

	ctx.fillStyle = "#fff";
	ctx.fillRect(0, 0, W, H);

	if (_bottomChartVisible.barMode) {
		_drawBottomChartBars(ctx, p, students, L);
		return;
	}

	_computeStudentYs(students, L);

	ctx.save();
	ctx.beginPath();
	ctx.rect(M.left, M.top, plotW, plotHbot);
	ctx.clip();

	drawBlockBackgrounds(ctx, p, L);

	if (!_bottomChartVisible.followRank) {
		ctx.strokeStyle = "#e8e8e8";
		ctx.lineWidth = 1;
		for (let v = gs; v <= 100; v += gs) {
			const y = pctToY(v, L);
			ctx.beginPath();
			ctx.moveTo(M.left, y);
			ctx.lineTo(M.left + plotW, y);
			ctx.stroke();
		}
	}

	const drawDashesFor = (s, emphasized) => {
		const jitter = _shake
			? _jitterMap.get(s.name) || { dx: 0, dy: 0 }
			: { dx: 0, dy: 0 };
		const evs = (s.follow_events || []).filter(_isMistakeEvent);
		if (!evs.length) return;
		const sorted = [...evs].sort((a, b) => a.ts - b.ts);
		const clusters = [];
		let cur = [sorted[0]];
		for (let i = 1; i < sorted.length; i++) {
			if (sorted[i].ts - sorted[i - 1].ts < CFG.BURST_GAP)
				cur.push(sorted[i]);
			else {
				clusters.push(cur);
				cur = [sorted[i]];
			}
		}
		clusters.push(cur);
		const minY = L.M.top + (L.plotHbotPad || 0);
		const maxY = L.M.top + L.plotHbot - (L.plotHbotPad || 0);
		const cy = Math.max(minY, Math.min(maxY, studentY(s, L) + jitter.dy));
		const dotR = emphasized ? 2.0 : 1.5;
		for (const cl of clusters) {
			const isActiveCluster =
				emphasized &&
				_hoveredCluster &&
				cl[0].ts === _hoveredCluster.ts1 &&
				cl[cl.length - 1].ts === _hoveredCluster.ts2;
			if (isActiveCluster) {
				ctx.fillStyle = THEME.orange;
				for (const ev of cl) {
					const cx = tsToX(ev.ts, L);
					ctx.beginPath();
					ctx.arc(cx, cy, dotR + 2, 0, Math.PI * 2);
					ctx.fill();
				}
			}
			ctx.fillStyle = emphasized
				? "rgba(0,0,0,0.85)"
				: "rgba(130,130,130,0.55)";
			for (const ev of cl) {
				const cx = tsToX(ev.ts, L);
				ctx.beginPath();
				ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
				ctx.fill();
			}
		}
	};

	const drawDotFor = (s, emphasized, ans, ask, hlp) => {
		if (s.follow_dt == null) return;
		const jitter = _shake
			? _jitterMap.get(s.name) || { dx: 0, dy: 0 }
			: { dx: 0, dy: 0 };
		const x = tsToX(s.follow_dt, L) + jitter.dx;
		const _minY = L.M.top + (L.plotHbotPad || 0);
		const _maxY = L.M.top + L.plotHbot - (L.plotHbotPad || 0);
		const y = Math.max(_minY, Math.min(_maxY, studentY(s, L) + jitter.dy));
		const active = ans || ask || hlp;

		ctx.save();
		if (active) {
			if (emphasized) {
				drawStar(ctx, x, y, 9, "#000000", 1.0);
			} else {
				drawStudentStar(ctx, x, y, ans, ask, hlp);
			}
		} else {
			ctx.globalAlpha = emphasized ? 1.0 : 0.65;
			ctx.beginPath();
			ctx.arc(x, y, 5, 0, Math.PI * 2);
			ctx.fillStyle = emphasized ? "#000" : "#A8A8A8";
			ctx.fill();
			ctx.strokeStyle = emphasized ? "#000" : "#777";
			ctx.lineWidth = emphasized ? 1.5 : 0.8;
			ctx.stroke();
		}
		ctx.restore();
	};

	const answering = new Set(),
		asking = new Set(),
		helping = new Set();
	if (_bottomChartVisible.firstMismatch && _bottomChartVisible.interactions) {
		for (const q of p.interactions["teacher-question"])
			for (const field of q.answered_by) {
				const name = resolveInteractionStudent(field);
				if (name) answering.add(name);
			}
		for (const q of p.interactions["student-question"]) {
			const nm = resolveInteractionStudent(q.asked_by) || "";
			if (nm.trim()) asking.add(nm.trim());
		}
		for (const q of p.interactions["providing-help"]) {
			const nm = resolveInteractionStudent(q.student) || "";
			if (nm.trim()) helping.add(nm.trim());
		}
	}

	for (const s of students) {
		if (_hoveredStudent && s.name === _hoveredStudent.name) continue;
		drawDashesFor(s, false);
	}
	if (_bottomChartVisible.firstMismatch) {
		for (const s of students) {
			if (_hoveredStudent && s.name === _hoveredStudent.name) continue;
			drawDotFor(
				s,
				false,
				answering.has(s.name),
				asking.has(s.name),
				helping.has(s.name),
			);
		}
	}

	if (_hoveredStudent) {
		const hs = _hoveredStudent;
		const hEvs = (hs.follow_events || []).filter(_isMistakeEvent);
		if (hEvs.length) {
			const hSorted = [...hEvs].sort((a, b) => a.ts - b.ts);
			const hJitter = _shake
				? _jitterMap.get(hs.name) || { dx: 0, dy: 0 }
				: { dx: 0, dy: 0 };
			const minY = L.M.top + (L.plotHbotPad || 0);
			const maxY = L.M.top + L.plotHbot - (L.plotHbotPad || 0);
			const cy = Math.max(
				minY,
				Math.min(maxY, studentY(hs, L) + hJitter.dy),
			);
			const x1 = tsToX(hSorted[0].ts, L);
			const x2 = tsToX(hSorted[hSorted.length - 1].ts, L);
			const bandH = 10;
			const padX = 6;
			const radius = 5;
			const bx = x1 - padX;
			const bw = x2 - x1 + 2 * padX;
			const by = cy - bandH / 2;
			ctx.fillStyle = _hexToRgba(THEME.blue, 0.5);
			ctx.beginPath();
			if (typeof ctx.roundRect === "function") {
				ctx.roundRect(bx, by, bw, bandH, radius);
			} else {
				const r = Math.min(radius, bw / 2, bandH / 2);
				ctx.moveTo(bx + r, by);
				ctx.lineTo(bx + bw - r, by);
				ctx.arcTo(bx + bw, by, bx + bw, by + r, r);
				ctx.lineTo(bx + bw, by + bandH - r);
				ctx.arcTo(bx + bw, by + bandH, bx + bw - r, by + bandH, r);
				ctx.lineTo(bx + r, by + bandH);
				ctx.arcTo(bx, by + bandH, bx, by + bandH - r, r);
				ctx.lineTo(bx, by + r);
				ctx.arcTo(bx, by, bx + r, by, r);
				ctx.closePath();
			}
			ctx.fill();
		}

		drawDashesFor(hs, true);
		if (_bottomChartVisible.firstMismatch) {
			drawDotFor(
				hs,
				true,
				answering.has(hs.name),
				asking.has(hs.name),
				helping.has(hs.name),
			);
		}
	}

	ctx.restore();

	ctx.fillStyle = "#555";
	ctx.font = "11px Consolas,monospace";
	ctx.textAlign = "right";
	ctx.strokeStyle = "#aaa";
	ctx.lineWidth = 1;
	if (_bottomChartVisible.followRank) {
		const N = students.length;
		if (N > 0) {
			for (let r = 1; r <= N; r++) {
				const y = M.top + ((r - 0.5) / N) * plotHbot;
				ctx.beginPath();
				ctx.moveTo(M.left - 3, y);
				ctx.lineTo(M.left, y);
				ctx.stroke();
				if (r === 1 || r === N) {
					ctx.fillText(String(r), M.left - 3, y + 4);
				}
			}
		}
	} else {
		for (let v = 0; v <= 100; v += 10) {
			const y = pctToY(v, L);
			ctx.beginPath();
			ctx.moveTo(M.left - 3, y);
			ctx.lineTo(M.left, y);
			ctx.stroke();
			if (v === 0 || v === 100) {
				ctx.fillText(v + "%", M.left - 3, y + 4);
			}
		}
	}

	const yLabel = _bottomChartVisible.followRank
		? "Follow Rank"
		: "Follow Score";
	rotatedLabel(ctx, 22, M.top + plotHbot / 2, yLabel, THEME.label);

	drawTimeAxis(ctx, L, M.top + plotHbot, H);
	drawBlockMistakeCounts(ctx, p, students, L);
}

function _drawBottomChartBars(ctx, p, students, L) {
	const { M, W, Hbot: H, plotW, plotHbot } = L;
	const bottomY = M.top + plotHbot;
	const minBarW =
		tsToX(p.sessionStart + CFG.BAR_MIN_SECS, L) - tsToX(p.sessionStart, L);

	const blocks = _buildBottomChartBlocks(p);

	const studentEvs = (students || []).map((s) =>
		(s.follow_events || []).filter(_isMistakeEvent),
	);
	const countStudents = (t1, t2) => {
		let n = 0;
		for (const evs of studentEvs) {
			for (const e of evs) {
				if (e.ts >= t1 && e.ts <= t2) {
					n++;
					break;
				}
			}
		}
		return n;
	};
	const langEventCounts = (t1, t2) => {
		const counts = {};
		for (const evs of studentEvs) {
			for (const e of evs) {
				if (e.ts >= t1 && e.ts <= t2) {
					const l = e.lang || "?";
					if (!counts[l]) counts[l] = { ghost: 0, nonGhost: 0 };
					if (e.kind === "extra-star") counts[l].ghost++;
					else counts[l].nonGhost++;
				}
			}
		}
		return counts;
	};

	const counts = blocks.map((blk) => countStudents(blk.ts1, blk.ts2));
	const totalStudents = (students || []).length;
	const denom = Math.max(1, totalStudents);

	ctx.save();
	ctx.beginPath();
	ctx.rect(M.left, M.top, plotW, plotHbot);
	ctx.clip();

	for (let i = 0; i < blocks.length; i++) {
		const c = counts[i];
		if (c <= 0) continue;
		const blk = blocks[i];
		const x = tsToX(blk.centerTs - blk.dur / 2, L);
		const x2 = tsToX(blk.centerTs + blk.dur / 2, L);
		const bw = Math.max(x2 - x, minBarW);
		const bx = (x + x2) / 2 - bw / 2;
		const bh = Math.min(plotHbot, (c / denom) * plotHbot);
		const by = bottomY - bh;
		const langC = langEventCounts(blk.ts1, blk.ts2);
		let totalEv = 0;
		for (const v of Object.values(langC)) totalEv += v.ghost + v.nonGhost;
		if (totalEv === 0) {
			ctx.globalAlpha = 0.72;
			ctx.fillStyle = LANG_BAR_COLORS["?"];
			ctx.fillRect(bx, by, bw, bh);
			ctx.globalAlpha = 1;
		} else {
			let segBottom = bottomY;
			for (const lang of LANG_STACK_ORDER) {
				const v = langC[lang];
				if (!v) continue;
				const n = v.ghost + v.nonGhost;
				if (n === 0) continue;
				const segH = bh * (n / totalEv);
				const color = LANG_BAR_COLORS[lang] || THEME.gray;
				const nonGhostH = segH * (v.nonGhost / n);
				const ghostH = segH - nonGhostH;
				ctx.fillStyle = color;
				if (nonGhostH > 0) {
					ctx.globalAlpha = 0.72;
					ctx.fillRect(bx, segBottom - nonGhostH, bw, nonGhostH);
				}
				if (ghostH > 0) {
					ctx.globalAlpha = 0.28;
					ctx.fillRect(bx, segBottom - segH, bw, ghostH);
				}
				ctx.globalAlpha = 1;
				segBottom -= segH;
			}
		}
	}

	ctx.restore();

	const presentLangs = new Set();
	for (let i = 0; i < blocks.length; i++) {
		if (counts[i] <= 0) continue;
		const lc = langEventCounts(blocks[i].ts1, blocks[i].ts2);
		for (const l of Object.keys(lc)) {
			const v = lc[l];
			if (v.ghost + v.nonGhost > 0) presentLangs.add(l);
		}
	}
	const legendItems = LANG_STACK_ORDER.filter((l) => presentLangs.has(l));
	if (legendItems.length) {
		ctx.font = "bold 10px Consolas,monospace";
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		const swatchW = 10;
		const swatchH = 8;
		const gapInside = 4;
		const gapBetween = 12;
		let lx = M.left + 6;
		const ly = M.top + 8;
		for (const l of legendItems) {
			ctx.globalAlpha = 0.72;
			ctx.fillStyle = LANG_BAR_COLORS[l];
			ctx.fillRect(lx, ly - swatchH / 2, swatchW, swatchH);
			ctx.globalAlpha = 1;
			ctx.fillStyle = "#333";
			ctx.fillText(l, lx + swatchW + gapInside, ly);
			lx += swatchW + gapInside + ctx.measureText(l).width + gapBetween;
		}
	}

	ctx.fillStyle = "#555";
	ctx.font = "11px Consolas,monospace";
	ctx.textAlign = "right";
	ctx.textBaseline = "alphabetic";
	ctx.strokeStyle = "#aaa";
	ctx.lineWidth = 1;
	for (const v of [0, totalStudents]) {
		const y = bottomY - (v / denom) * plotHbot;
		ctx.beginPath();
		ctx.moveTo(M.left - 3, y);
		ctx.lineTo(M.left, y);
		ctx.stroke();
		ctx.fillText(String(v), M.left - 3, y + 4);
	}
	rotatedLabel(ctx, 22, M.top + plotHbot / 2, "Students", THEME.label);

	drawTimeAxis(ctx, L, M.top + plotHbot, H);
	drawBlockMistakeCounts(ctx, p, students, L);
}

function drawBlockBackgrounds(ctx, p, L) {
	const { M, plotHbot } = L;
	const minBarW =
		tsToX(p.sessionStart + CFG.BAR_MIN_SECS, L) - tsToX(p.sessionStart, L);

	ctx.save();

	const drawBand = (cx, dur, key) => {
		const x = tsToX(cx - dur / 2, L);
		const x2 = tsToX(cx + dur / 2, L);
		const bw = Math.max(x2 - x, minBarW);
		const bx = (x + x2) / 2 - bw / 2;
		const color = BAR_COLORS[key] || BAR_COLORS.normal;
		ctx.fillStyle = _hexToRgba(color, 0.15);
		ctx.fillRect(bx, M.top, bw, plotHbot);
	};

	for (const b of p.bursts || []) {
		drawBand(b.centerTs, b.dur, _burstColorKey(b));
	}
	for (const kp of p.singletons || []) {
		drawBand(kp.timestamp / 1000, 0, _singletonColorKey(kp));
	}
	ctx.restore();
}

function drawBlockMistakeCounts(ctx, p, students, L) {
	if (!students || !students.length) return;
	const { M, plotW } = L;
	const xMin = M.left;
	const xMax = M.left + plotW;
	const labelY = Math.max(8, M.top - 10);

	const blocks = [];
	const seen = new Set();
	for (const b of p.bursts || []) {
		const key = `${b.startTs}|${b.endTs}`;
		if (seen.has(key)) continue;
		seen.add(key);
		blocks.push({ ts1: b.startTs, ts2: b.endTs });
	}
	const half = CFG.BAR_MIN_SECS / 2;
	for (const kp of p.singletons || []) {
		const ts = kp.timestamp / 1000;
		const key = `s|${ts}`;
		if (seen.has(key)) continue;
		seen.add(key);
		blocks.push({ ts1: ts - half, ts2: ts + half });
	}

	const studentEvs = students.map((s) =>
		(s.follow_events || []).filter(_isMistakeEvent),
	);

	function countStudents(t1, t2) {
		let n = 0;
		for (const evs of studentEvs) {
			for (const e of evs) {
				if (e.ts >= t1 && e.ts <= t2) {
					n++;
					break;
				}
			}
		}
		return n;
	}

	ctx.save();
	ctx.fillStyle = "#222";
	ctx.font = "bold 10px Consolas,monospace";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";

	for (const blk of blocks) {
		const cx = (tsToX(blk.ts1, L) + tsToX(blk.ts2, L)) / 2;
		if (cx < xMin || cx > xMax) continue;
		const count = countStudents(blk.ts1, blk.ts2);
		if (count === 0) continue;
		ctx.fillText(String(count), cx, labelY);
	}
	ctx.restore();
}

function drawStar(ctx, cx, cy, r, fill, alpha = 1) {
	ctx.save();
	ctx.globalAlpha = alpha;
	ctx.beginPath();
	for (let i = 0; i < 5; i++) {
		const a1 = (i * 4 * Math.PI) / 5 - Math.PI / 2;
		const a2 = ((i * 4 + 2) * Math.PI) / 5 - Math.PI / 2;
		if (i === 0) ctx.moveTo(cx + r * Math.cos(a1), cy + r * Math.sin(a1));
		else ctx.lineTo(cx + r * Math.cos(a1), cy + r * Math.sin(a1));
		ctx.lineTo(cx + r * 0.4 * Math.cos(a2), cy + r * 0.4 * Math.sin(a2));
	}
	ctx.closePath();
	ctx.fillStyle = fill;
	ctx.fill();
	ctx.restore();
}

function drawStudentStar(ctx, x, y, ans, ask, hlp) {
	const blue = INTERACTION_COLORS["teacher-question"].hex;
	const orange = INTERACTION_COLORS["student-question"].hex;
	const green = INTERACTION_COLORS["providing-help"].hex;
	const n = (ans ? 1 : 0) + (ask ? 1 : 0) + (hlp ? 1 : 0);
	if (n === 3) {
		drawStar(ctx, x, y, 9, green, 1.0);
		drawStar(ctx, x, y, 5, orange, 1.0);
		drawStar(ctx, x, y, 2, blue, 1.0);
	} else if (n === 2) {
		const [outerClr, innerClr] =
			ans && ask
				? [orange, blue]
				: ans && hlp
					? [green, blue]
					: [green, orange];
		drawStar(ctx, x, y, 9, outerClr, 1.0);
		drawStar(ctx, x, y, 5, innerClr, 1.0);
	} else {
		const fill = ans ? blue : ask ? orange : green;
		drawStar(ctx, x, y, 9, fill, 1.0);
	}
}

function drawInteractionSpans(ctx, p, L, plotTop, plotH, colors) {
	for (const [type, qs] of Object.entries(p.interactions)) {
		const clrOrFn = colors[type];
		if (!clrOrFn) continue;
		for (const q of qs) {
			let endTs;
			if (q.closed_at) {
				endTs = q.closed_at;
			} else {
				const nxt = p.events.find((e) => e.timestamp / 1000 > q.timestamp);
				endTs = nxt ? nxt.timestamp / 1000 : q.timestamp + 5;
			}
			const x1 = tsToX(q.timestamp, L),
				x2 = tsToX(endTs, L);
			ctx.fillStyle = typeof clrOrFn === "function" ? clrOrFn(q) : clrOrFn;
			ctx.fillRect(x1, plotTop, Math.max(x2 - x1, 2), plotH);
		}
	}
}

function drawYAxisLog(ctx, L) {
	const { M, plotHmid } = L;
	ctx.strokeStyle = "#ccc";
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(M.left, M.top);
	ctx.lineTo(M.left, M.top + plotHmid);
	ctx.stroke();
	ctx.fillStyle = "#555";
	ctx.font = "11px Consolas,monospace";
	ctx.textAlign = "right";
	ctx.strokeStyle = "#aaa";
	for (const r of [10, 100, 1000]) {
		const y = rateToY(r, L);
		ctx.fillText(r, M.left - 3, y + 4);
		ctx.beginPath();
		ctx.moveTo(M.left - 3, y);
		ctx.lineTo(M.left, y);
		ctx.stroke();
	}
}

function drawTimeAxis(ctx, L, axisY, _H) {
	const { M, plotW, timeMin, timeMax } = L;
	const totalSecs = timeMax - timeMin;
	const targets = [5, 10, 15, 20, 30, 60, 120, 180, 300, 600, 900, 1800, 3600];
	const want = Math.min(plotW / 80, 14);
	const tickInt = targets.find((t) => totalSecs / t <= want) || 3600;
	const firstTick = Math.ceil(timeMin / tickInt) * tickInt;

	ctx.strokeStyle = "#ccc";
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(M.left, axisY);
	ctx.lineTo(M.left + plotW, axisY);
	ctx.stroke();
	ctx.fillStyle = "#555";
	ctx.font = "10px Consolas,monospace";
	ctx.textAlign = "center";
	ctx.strokeStyle = "#aaa";
	for (let ts = firstTick; ts <= timeMax; ts += tickInt) {
		const x = tsToX(ts, L);
		ctx.beginPath();
		ctx.moveTo(x, axisY);
		ctx.lineTo(x, axisY + 4);
		ctx.stroke();
		ctx.fillText(fmtTime(ts), x, axisY + 14);
	}
}
