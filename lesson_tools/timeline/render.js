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
	const secPerChar = CFG.CODE_INSERT_MS_PER_CHAR / 1000;
	if (
		ev._virtualType === "code_insert" &&
		typeof ev.code_insert === "string"
	) {
		return ev.code_insert.length * secPerChar;
	}
	if (ev.char === "⛔" && typeof ev._removed_len === "number") {
		return ev._removed_len * secPerChar;
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
	if (p._bottomBlocks) return p._bottomBlocks;
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
	p._bottomBlocks = blocks;
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
