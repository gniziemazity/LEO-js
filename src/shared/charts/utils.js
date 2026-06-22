"use strict";

const CHART_FONT = {
	tick: "9px sans-serif",
	label: "10px sans-serif",
	labelBold: "bold 10px sans-serif",
	subBold: "bold 9px sans-serif",
	tooltip: "11px sans-serif",
	tooltipBold: "bold 11px sans-serif",
	pointLabel: 'bold 7.5px "Segoe UI", sans-serif',
	obsMark: 'bold 10px "Segoe UI", sans-serif',
};

const CHART_COLOR = {
	axisText: "#595959",
	grid: "#e8e8e8",
	gridFaint: "#f0f0f0",
	axisLine: "#ccc",
	white: "#fff",
	border: "#ddd",
	text: "#333",
	barBorder: "#999",
	muted: "#555",
	faint: "#888",
	rightAxis: "#007acc",
};

function niceStep(range, targetSteps) {
	if (!(range > 0)) return 1;
	const raw = range / targetSteps;
	const mag = Math.pow(10, Math.floor(Math.log10(raw)));
	const norm = raw / mag;
	let nice = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
	return nice * mag;
}

function _boxStats(values, coef = 1.5) {
	const sorted = (values || []).filter(Number.isFinite).sort((a, b) => a - b);
	const n = sorted.length;
	if (!n) return null;
	const q = (p) => {
		const pos = p * (n - 1);
		const lo = Math.floor(pos);
		const hi = Math.ceil(pos);
		return sorted[lo] + (pos - lo) * (sorted[hi] - sorted[lo]);
	};
	const q1 = q(0.25);
	const median = q(0.5);
	const q3 = q(0.75);
	const mean = sorted.reduce((s, v) => s + v, 0) / n;
	const iqr = q3 - q1;
	const lo = q1 - coef * iqr;
	const hi = q3 + coef * iqr;
	const whiskerMin = sorted.find((v) => v >= lo) ?? sorted[0];
	const whiskerMax =
		[...sorted].reverse().find((v) => v <= hi) ?? sorted[n - 1];
	const outliers = sorted.filter((v) => v < lo || v > hi);
	return { q1, median, q3, mean, whiskerMin, whiskerMax, outliers };
}

function _resizeChartCanvas(chart, fallbackH = 200) {
	const c = chart._canvas;
	const r = c.getBoundingClientRect();
	const dpr = window.devicePixelRatio || 1;
	const w = r.width || c.offsetWidth || 300;
	const h = r.height || c.offsetHeight || fallbackH;
	c.width = w * dpr;
	c.height = h * dpr;
	chart._dpr = dpr;
	chart._draw();
}
