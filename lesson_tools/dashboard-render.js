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
	dev: THEME.purple,
	remove: THEME.red,
	anchor: THEME.blue,
	move: THEME.orange,
	comment: THEME.green,
};

function _langBarColorOf(key) {
	if (!key) return null;
	if (key === "comment") return THEME.green;
	if (key === "?") return THEME.muted;
	return langColorFor(key);
}
const LANG_STACK_ORDER = ["HTML", "CSS", "JS", "Py", "comment"];

function _fillStriped(ctx, x, y, w, h, color, baseAlpha = 0.18) {
	if (w <= 0 || h <= 0) return;
	ctx.save();
	ctx.globalAlpha = baseAlpha;
	ctx.fillStyle = color;
	ctx.fillRect(x, y, w, h);
	ctx.globalAlpha = 1;
	ctx.beginPath();
	ctx.rect(x, y, w, h);
	ctx.clip();
	ctx.strokeStyle = color;
	ctx.lineWidth = 2;
	const step = 5;
	for (let lx = x - h; lx < x + w + h; lx += step) {
		ctx.beginPath();
		ctx.moveTo(lx, y + h);
		ctx.lineTo(lx + h, y);
		ctx.stroke();
	}
	ctx.restore();
}

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

function _studentMistakes(students) {
	return (students || []).map(_mistakeEventsFor);
}

function _countStudentsInRange(studentEvs, t1, t2) {
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

function _blockBarGeom(centerTs, dur, L) {
	const x = tsToX(centerTs - dur / 2, L);
	const x2 = tsToX(centerTs + dur / 2, L);
	return { bx: x, bw: x2 - x };
}

function _eventDurationSec(ev) {
	if (
		ev._virtualType === "code_insert" &&
		typeof ev.code_insert === "string"
	) {
		return ev.code_insert.length / 1000;
	}
	if (ev.char === "⛔" && typeof ev._removed_len === "number") {
		return ev._removed_len / 1000;
	}
	return 0;
}

function _burstEffectiveSpan(b) {
	let endTs = b.endTs;
	for (const ev of b.evs || []) {
		const extra = _eventDurationSec(ev);
		if (extra > 0) {
			const evEnd = ev.timestamp / 1000 + extra;
			if (evEnd > endTs) endTs = evEnd;
		}
	}
	return {
		startTs: b.startTs,
		endTs,
		centerTs: (b.startTs + endTs) / 2,
		dur: endTs - b.startTs,
	};
}

function _buildBottomChartBlocks(p) {
	const blocks = [];
	const seen = new Set();
	for (const b of p.bursts || []) {
		const key = `b|${b.startTs}|${b.endTs}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const span = _burstEffectiveSpan(b);
		blocks.push({
			ts1: span.startTs,
			ts2: span.endTs,
			centerTs: span.centerTs,
			dur: span.dur,
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
		const extra = _eventDurationSec(kp);
		blocks.push({
			ts1: ts - half,
			ts2: ts + half + extra,
			centerTs: ts + extra / 2,
			dur: extra,
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

const BOTTOM_LEGEND_ITEMS = [
	{ id: "leg-bottom-firstmismatch", key: "firstMismatch" },
	{ id: "leg-bottom-followrank", key: "followRank" },
	{ id: "leg-bottom-interactions", key: "interactions" },
	{
		id: "leg-bottom-barmode",
		key: "barMode",
		onChange: _updateBottomLegendState,
	},
];

function setupBottomChartLegend() {
	for (const { id, key, onChange } of BOTTOM_LEGEND_ITEMS) {
		const cb = document.getElementById(id);
		if (!cb) continue;
		cb.checked = _bottomChartVisible[key];
		cb.onchange = () => {
			_bottomChartVisible[key] = cb.checked;
			if (onChange) onChange();
			scheduleRender();
		};
	}
	_updateBottomLegendState();
}

function _updateBottomLegendState() {
	const btn = document.getElementById("btn-shake");
	if (btn) btn.style.display = _bottomChartVisible.barMode ? "none" : "";
	for (const { id, key } of BOTTOM_LEGEND_ITEMS) {
		if (key === "barMode") continue;
		const cb = document.getElementById(id);
		if (!cb) continue;
		cb.disabled = _bottomChartVisible.barMode;
		const label = cb.closest("label");
		if (label)
			label.classList.toggle("is-disabled", _bottomChartVisible.barMode);
	}
}

function setupTopChartLegend(p) {
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

	ctx.fillStyle = THEME.chartBg;
	ctx.fillRect(0, 0, W, H);

	ctx.save();
	ctx.beginPath();
	ctx.rect(M.left, M.top, plotW, plotHmid);
	ctx.clip();

	ctx.strokeStyle = THEME.chartGrid;
	ctx.lineWidth = 1;
	for (const r of [10, 20, 50, 100, 200, 500, 1000]) {
		const y = rateToY(r, L);
		ctx.beginPath();
		ctx.moveTo(M.left, y);
		ctx.lineTo(M.left + plotW, y);
		ctx.stroke();
	}

	function bar(ts, rate, dur, colorKey, alpha = 0.72) {
		const { bx, bw } = _blockBarGeom(ts, dur, L);
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
		const span = _burstEffectiveSpan(b);
		if (b.chars > 0) {
			const hasVirtual = b.hasCodeInserts || b.hasAnchors || b.hasMoves;
			const effectiveRate = hasVirtual ? Math.max(b.rate, 20) : b.rate;
			bar(span.centerTs, effectiveRate, span.dur, b.colorType);
		} else if (b.hasCodeInserts) {
			const insLen = b.evs
				.filter((e) => e._virtualType === "code_insert")
				.reduce((s, e) => s + (e.code_insert || "").length, 0);
			bar(
				span.centerTs,
				Math.max(10, insLen / (CFG.BAR_MIN_SECS / 60)),
				span.dur,
				"normal",
			);
		} else if (b.hasAnchors || b.hasMoves) {
			bar(
				span.centerTs,
				20,
				span.dur,
				b.hasAnchors ? "anchor" : "move",
				0.7,
			);
		}
	}
	for (const kp of p.singletons) {
		const ts = kp.timestamp / 1000;
		const extra = _eventDurationSec(kp);
		if (kp._virtualType === "anchor") {
			bar(ts, 20, 0, "anchor", 0.7);
		} else if (kp._virtualType === "move") {
			bar(ts, 20, 0, "move", 0.7);
		} else if (kp._virtualType === "code_insert") {
			bar(
				ts + extra / 2,
				Math.max(
					10,
					(kp.code_insert || "").length / (CFG.BAR_MIN_SECS / 60),
				),
				extra,
				"normal",
			);
		} else {
			const ck =
				kp._editor === "dev"
					? "dev"
					: DELETE_CHARS.has(kp.char)
						? "remove"
						: "normal";
			bar(ts + extra / 2, 20, extra, ck);
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
	rateLine(p.sessionRate, THEME.chartKpmSession);
	rateLine(p.activeRate, THEME.chartKpmActive);
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
		[`Session: ${p.sessionRate.toFixed(1)} kpm`, THEME.chartKpmSession],
		[`Active:  ${p.activeRate.toFixed(1)} kpm`, THEME.chartKpmActive],
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

	ctx.fillStyle = THEME.chartBg;
	ctx.fillRect(0, 0, W, H);

	ctx.save();
	ctx.beginPath();
	ctx.rect(M.left, M.top, plotW, plotHtop);
	ctx.clip();

	ctx.strokeStyle = THEME.chartGrid;
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
				: {
						striped: true,
						color: INTERACTION_COLORS["teacher-question"].hex,
					},
	});

	if (cum.length > 1) {
		const pts = cum.map((c) => [tsToX(c.ts, L), countToY(c.count, maxN, L)]);
		ctx.beginPath();
		ctx.moveTo(pts[0][0], pts[0][1]);
		for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
		ctx.lineTo(pts[pts.length - 1][0], M.top + plotHtop);
		ctx.lineTo(pts[0][0], M.top + plotHtop);
		ctx.closePath();
		ctx.fillStyle = THEME.chartCumulativeFill;
		ctx.fill();
		ctx.beginPath();
		ctx.moveTo(pts[0][0], pts[0][1]);
		for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
		ctx.strokeStyle = THEME.chartCumulative;
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
		ctx.strokeStyle = THEME.muted;
		ctx.lineWidth = 2.5;
		ctx.stroke();
		const ir = 3;
		ctx.beginPath();
		ctx.moveTo(x, y - ir);
		ctx.lineTo(x + ir, y);
		ctx.lineTo(x, y + ir);
		ctx.lineTo(x - ir, y);
		ctx.closePath();
		ctx.fillStyle = THEME.black;
		ctx.fill();
		ctx.restore();
	}

	if (_topChartVisible.chars)
		for (const grp of p.burstGroups)
			for (const idx of grp.idxs) {
				const c = cum[idx];
				if (!c) continue;
				dot(tsToX(c.ts, L), countToY(c.count, maxN, L), THEME.black, 1.0);
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
			dia(
				tsToX(ts, L),
				countToY(charsAt(ts, cum), maxN, L),
				THEME.chartInsertMarker,
			);
		}

	ctx.restore();

	ctx.fillStyle = THEME.chartAxisText;
	ctx.font = "11px Consolas,monospace";
	ctx.textAlign = "right";
	ctx.strokeStyle = THEME.chartAxisTick;
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

	ctx.fillStyle = THEME.chartBg;
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
		ctx.strokeStyle = THEME.chartGrid;
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
		const jitter = _jitterFor(s.name);
		const evs = _mistakeEventsFor(s);
		if (!evs.length) return;
		const clusters = _clusterMistakes(evs, CFG.BURST_GAP);
		const cy = _clampStudentY(s, jitter, L);
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
		const jitter = _jitterFor(s.name);
		const x = tsToX(s.follow_dt, L) + jitter.dx;
		const y = _clampStudentY(s, jitter, L);
		const active = ans || ask || hlp;

		ctx.save();
		if (active) {
			if (emphasized) {
				drawStar(ctx, x, y, 9, THEME.black, 1.0);
			} else {
				drawStudentStar(ctx, x, y, ans, ask, hlp);
			}
		} else {
			ctx.globalAlpha = emphasized ? 1.0 : 0.65;
			ctx.beginPath();
			ctx.arc(x, y, 5, 0, Math.PI * 2);
			ctx.fillStyle = emphasized ? THEME.black : THEME.chartDotMutedFill;
			ctx.fill();
			ctx.strokeStyle = emphasized ? THEME.black : THEME.chartDotMutedStroke;
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
		const hEvs = _mistakeEventsFor(hs);
		if (hEvs.length) {
			const hSorted = [...hEvs].sort((a, b) => a.ts - b.ts);
			const hJitter = _jitterFor(hs.name);
			const cy = _clampStudentY(hs, hJitter, L);
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

	ctx.fillStyle = THEME.chartAxisText;
	ctx.font = "11px Consolas,monospace";
	ctx.textAlign = "right";
	ctx.strokeStyle = THEME.chartAxisTick;
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

	const blocks = _buildBottomChartBlocks(p);
	const studentEvs = _studentMistakes(students);
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

	const counts = blocks.map((blk) =>
		_countStudentsInRange(studentEvs, blk.ts1, blk.ts2),
	);
	const totalStudents = (students || []).length;
	const denom = Math.max(1, totalStudents);

	ctx.save();
	ctx.beginPath();
	ctx.rect(M.left, M.top, plotW, plotHbot);
	ctx.clip();

	ctx.fillStyle = THEME.barTrack;
	for (let i = 0; i < blocks.length; i++) {
		const c = counts[i];
		if (c <= 0) continue;
		const blk = blocks[i];
		const { bx, bw } = _blockBarGeom(blk.centerTs, blk.dur, L);
		const bh = Math.min(plotHbot, (c / denom) * plotHbot);
		const by = bottomY - bh;
		ctx.fillRect(bx, by, bw, bh);
	}

	_drawTokenOverlay(ctx, p, students, L, denom);

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
	const legendItems = LANG_STACK_ORDER.filter(
		(l) => l !== "comment" && presentLangs.has(l),
	);
	if (legendItems.length) {
		ctx.font = "bold 10px Consolas,monospace";
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		const gapBetween = 12;
		let lx = M.left + 6;
		const ly = M.top + 8;
		for (const l of legendItems) {
			ctx.fillStyle = _langBarColorOf(l);
			ctx.fillText(l, lx, ly);
			lx += ctx.measureText(l).width + gapBetween;
		}
	}

	ctx.fillStyle = THEME.chartAxisText;
	ctx.font = "11px Consolas,monospace";
	ctx.textAlign = "right";
	ctx.textBaseline = "alphabetic";
	ctx.strokeStyle = THEME.chartAxisTick;
	ctx.lineWidth = 1;
	const ticks = totalStudents > 0 ? [0, totalStudents] : [0];
	for (const v of ticks) {
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

let _tokenOverlaySlots = [];

function _drawTokenOverlay(ctx, p, students, L, denom) {
	_tokenOverlaySlots = [];
	if (!_teacherTokens || !_teacherTokens.length) return;
	const { M, plotW, plotHbot } = L;
	const scaleDenom = Math.max(1, denom || (students || []).length);
	const baseY = M.top + plotHbot;
	const blocks = _buildBottomChartBlocks(p);
	const tokenBars = _buildTokenViewBars(students);
	if (!tokenBars.length) return;

	for (const blk of blocks) {
		const tbs = tokenBars
			.filter((t) => !t.isComment && t.ts >= blk.ts1 && t.ts <= blk.ts2)
			.sort((a, b) => a.ts - b.ts);
		if (!tbs.length) continue;
		const blockLangCounts = {};
		for (const t of tbs) {
			if (!_langBarColorOf(t.lang)) continue;
			const w = t.students ? t.students.size : 0;
			blockLangCounts[t.lang] = (blockLangCounts[t.lang] || 0) + w + 1;
		}
		let dominantLang = null;
		let dominantCount = 0;
		for (const [l, c] of Object.entries(blockLangCounts)) {
			if (c > dominantCount) {
				dominantCount = c;
				dominantLang = l;
			}
		}
		const { bx, bw } = _blockBarGeom(blk.centerTs, blk.dur, L);
		const slotW = bw / tbs.length;
		for (let j = 0; j < tbs.length; j++) {
			const tb = tbs[j];
			const sx = bx + j * slotW;
			const nStudents = tb.students ? tb.students.size : 0;
			if (nStudents === 0) continue;
			const totalH = (nStudents / scaleDenom) * plotHbot;
			_tokenOverlaySlots.push({ bar: tb, sx, slotW, totalH });
			const nonGhost = tb.regularStudents ? tb.regularStudents.size : 0;
			const ghost = tb.ghostStudents ? tb.ghostStudents.size : 0;
			const subDenom = Math.max(1, nonGhost + ghost);
			const nonGhostH = totalH * (nonGhost / subDenom);
			const ghostH = totalH - nonGhostH;
			const lang = tb.lang || dominantLang;
			const color = _langBarColorOf(lang);
			if (!color) continue;
			if (nonGhostH > 0) {
				ctx.globalAlpha = 0.95;
				ctx.fillStyle = color;
				ctx.fillRect(sx, baseY - nonGhostH, slotW, nonGhostH);
				ctx.globalAlpha = 1;
			}
			if (ghostH > 0) {
				_fillStriped(ctx, sx, baseY - totalH, slotW, ghostH, color);
			}
		}
	}
}

function _tokenOverlayHitTest(mx, my, L) {
	const slots = _tokenOverlaySlots;
	if (!slots || !slots.length) return null;
	const baseY = L.M.top + L.plotHbot;
	for (let i = 0; i < slots.length; i++) {
		const sl = slots[i];
		if (mx < sl.sx || mx > sl.sx + sl.slotW) continue;
		if (my < baseY - Math.max(sl.totalH, 6) || my > baseY) continue;
		return { type: "token-bar", bar: sl.bar, idx: i };
	}
	return null;
}

function _buildTokenViewBars(students) {
	const byKey = new Map();
	const keyOf = (ts, token) => `${ts}|${token}`;
	for (const s of students || []) {
		const perKey = new Map();
		const evsByKey = new Map();
		for (const ev of s.follow_events || []) {
			if (!_isMistakeEvent(ev)) continue;
			const k = keyOf(ev.ts, ev.token);
			const cur = perKey.get(k);
			if (cur !== "ghost") {
				perKey.set(
					k,
					ev.kind === "extra-star" ? "ghost" : cur || "regular",
				);
			}
			if (!evsByKey.has(k)) evsByKey.set(k, []);
			evsByKey.get(k).push(ev);
			let entry = byKey.get(k);
			if (!entry) {
				entry = {
					ts: ev.ts,
					token: ev.token,
					students: new Set(),
					studentEntries: [],
					ghostStudents: new Set(),
					regularStudents: new Set(),
					lang: ev.lang || null,
				};
				byKey.set(k, entry);
			}
			if (!entry.lang && ev.lang) entry.lang = ev.lang;
		}
		for (const [k, kind] of perKey) {
			const entry = byKey.get(k);
			entry.studentEntries.push({ s, evs: evsByKey.get(k) || [] });
			entry.students.add(s.name);
			if (kind === "ghost") entry.ghostStudents.add(s.name);
			else entry.regularStudents.add(s.name);
		}
	}

	const EMPTY_SET = new Set();
	const EMPTY_ARR = [];
	return _teacherTokens.map((t) => {
		const lookupTs = t.isRemoved && t.delTs != null ? t.delTs : t.ts;
		const m = byKey.get(keyOf(lookupTs, t.token));
		return {
			ts: lookupTs,
			token: t.token,
			students: m ? m.students : EMPTY_SET,
			studentEntries: m ? m.studentEntries : EMPTY_ARR,
			ghostStudents: m ? m.ghostStudents : EMPTY_SET,
			regularStudents: m ? m.regularStudents : EMPTY_SET,
			lang: m ? m.lang : null,
			isComment: t.isComment,
			isRemoved: t.isRemoved,
			empty: !m,
		};
	});
}

function drawBlockBackgrounds(ctx, p, L) {
	const { M, plotHbot } = L;

	ctx.save();

	const drawBand = (cx, dur, key) => {
		const { bx, bw } = _blockBarGeom(cx, dur, L);
		const color = BAR_COLORS[key] || BAR_COLORS.normal;
		ctx.fillStyle = _hexToRgba(color, 0.15);
		ctx.fillRect(bx, M.top, bw, plotHbot);
	};

	for (const b of p.bursts || []) {
		const span = _burstEffectiveSpan(b);
		drawBand(span.centerTs, span.dur, _burstColorKey(b));
	}
	for (const kp of p.singletons || []) {
		const ts = kp.timestamp / 1000;
		const extra = _eventDurationSec(kp);
		drawBand(ts + extra / 2, extra, _singletonColorKey(kp));
	}
	ctx.restore();
}

function drawBlockMistakeCounts(ctx, p, students, L) {
	if (!students || !students.length) return;
	const { M, plotW } = L;
	const xMin = M.left;
	const xMax = M.left + plotW;
	const labelY = Math.max(8, M.top - 10);

	const blocks = _buildBottomChartBlocks(p);
	const studentEvs = _studentMistakes(students);

	ctx.save();
	ctx.fillStyle = THEME.textStrong;
	ctx.font = "bold 10px Consolas,monospace";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";

	for (const blk of blocks) {
		const cx = (tsToX(blk.ts1, L) + tsToX(blk.ts2, L)) / 2;
		if (cx < xMin || cx > xMax) continue;
		const count = _countStudentsInRange(studentEvs, blk.ts1, blk.ts2);
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
			const w = Math.max(x2 - x1, 2);
			const spec = typeof clrOrFn === "function" ? clrOrFn(q) : clrOrFn;
			if (spec && typeof spec === "object" && spec.striped) {
				_fillStriped(ctx, x1, plotTop, w, plotH, spec.color);
			} else {
				ctx.fillStyle = spec;
				ctx.fillRect(x1, plotTop, w, plotH);
			}
		}
	}
}

function drawYAxisLog(ctx, L) {
	const { M, plotHmid } = L;
	ctx.strokeStyle = THEME.chartAxisLine;
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(M.left, M.top);
	ctx.lineTo(M.left, M.top + plotHmid);
	ctx.stroke();
	ctx.fillStyle = THEME.chartAxisText;
	ctx.font = "11px Consolas,monospace";
	ctx.textAlign = "right";
	ctx.strokeStyle = THEME.chartAxisTick;
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

	ctx.strokeStyle = THEME.chartAxisLine;
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(M.left, axisY);
	ctx.lineTo(M.left + plotW, axisY);
	ctx.stroke();
	ctx.fillStyle = THEME.chartAxisText;
	ctx.font = "10px Consolas,monospace";
	ctx.textAlign = "center";
	ctx.strokeStyle = THEME.chartAxisTick;
	for (let ts = firstTick; ts <= timeMax; ts += tickInt) {
		const x = tsToX(ts, L);
		ctx.beginPath();
		ctx.moveTo(x, axisY);
		ctx.lineTo(x, axisY + 4);
		ctx.stroke();
		ctx.fillText(fmtTime(ts), x, axisY + 14);
	}
}
