"use strict";

function addStackedShareCard(
	parent,
	title,
	labels,
	subsetCounts,
	totalCounts,
	yMax,
	opts = {},
) {
	const card = mkCard(parent, title);
	const box = el("div", "chart-box");
	card.appendChild(box);
	const restCounts = totalCounts.map((t, i) => t - subsetCounts[i]);
	const baseColor = opts.color ?? THEME.label;
	const chart = new BarChart(box, {
		yMin: 0,
		yMax: yMax ?? Math.max(...totalCounts, 1) + 1,
		stacked: true,
		tooltipCallback:
			opts.tooltipCallback ??
			((_label, _val, _si, gi) => [
				`${subsetCounts[gi]} / ${totalCounts[gi]}`,
			]),
		barLabel:
			opts.barLabel ??
			((gi, si) => {
				if (si !== 0) return null;
				const tot = totalCounts[gi];
				if (!tot) return null;
				return Math.round((subsetCounts[gi] / tot) * 100) + "%";
			}),
	});
	chart.setData(labels, [
		{
			data: subsetCounts,
			backgroundColor: baseColor,
			borderColor: baseColor,
		},
		{
			data: restCounts,
			backgroundColor: _hexToRgba(THEME.label, 0.22),
			borderColor: _hexToRgba(THEME.label, 0.45),
		},
	]);
	_barCharts.push(chart);
}

function addStackedBarCard(parent, title, labels, series, opts = {}) {
	const card = mkCard(parent, title, opts.size);
	const box = el("div", "chart-box");
	card.appendChild(box);
	const totals = labels.map((_, i) =>
		series.reduce((sum, s) => sum + (s.data[i] ?? 0), 0),
	);
	const chart = new BarChart(box, {
		yMin: 0,
		yMax:
			opts.yMax != null
				? opts.yMax
				: Math.max(...totals, 1) * (opts.yScale ?? 1) + (opts.yPad ?? 0),
		stacked: true,
		tooltipCallback:
			opts.tooltipCallback ??
			((_l, val, si) => [`${series[si].label}: ${Math.round(val)}`]),
		barLabel: opts.barLabel,
		barLabelAtTop: opts.barLabelAtTop,
	});
	chart.setData(
		labels,
		series.map((s) => ({
			data: s.data.map((v) => v ?? 0),
			backgroundColor: s.color,
			borderColor: s.color,
		})),
	);
	_barCharts.push(chart);
	return chart;
}

function addAiUseCard(parent, title, labels, strong, medium, none, totals) {
	const pct = (n, gi) => (totals[gi] ? Math.round((n / totals[gi]) * 100) : 0);
	addStackedBarCard(
		parent,
		title,
		labels,
		[
			{
				data: strong,
				color: artefactFiredColorFor("high"),
				label: "watermarks",
			},
			{
				data: medium,
				color: artefactFiredColorFor("medium"),
				label: "reliable artefacts",
			},
			{ data: none, color: THEME.artefactOk, label: "clean" },
		],
		{
			yMax:
				Math.max(
					...totals,
					...strong.map((s, i) => s + medium[i] + none[i]),
					1,
				) + 1,
			tooltipCallback: (_l, _v, si, gi) => {
				if (si === 0) return [`Watermarks: ${strong[gi]}`];
				if (si === 1) return [`Reliable artefacts: ${medium[gi]}`];
				return [`Clean: ${none[gi]}`];
			},
			barLabel: (gi, si) => {
				if (!totals[gi]) return null;
				if (si === 0) return strong[gi] ? pct(strong[gi], gi) + "%" : null;
				if (si === 1)
					return medium[gi]
						? pct(strong[gi] + medium[gi], gi) + "%"
						: null;
				return null;
			},
			barLabelAtTop: true,
		},
	);
}

function addBarCard(
	parent,
	title,
	labels,
	data,
	color,
	yMax,
	tooltipFmt,
	tooltipFn,
	opts = {},
) {
	const card = mkCard(parent, title);
	const box = el("div", "chart-box");
	card.appendChild(box);
	const chart = new BarChart(box, {
		yMin: 0,
		yMax,
		yTickSuffix: tooltipFmt === "pct" ? "%" : "",
		tooltipCallback:
			tooltipFn ??
			((_label, val) => [
				tooltipFmt === "dec1"
					? val.toFixed(1)
					: tooltipFmt === "pct"
						? val.toFixed(1) + "%"
						: Math.round(val).toString(),
			]),
		barLabel: opts.barLabel,
	});
	chart.setData(labels, [
		{
			data,
			backgroundColor: color,
			borderColor: color,
			labelColor: opts.labelColor,
		},
	]);
	_barCharts.push(chart);
}

function _parseSegments(raw) {
	if (raw == null || raw === "") return [];
	return String(raw)
		.split(";")
		.map((s) => {
			const parts = s.split(":");
			if (parts.length < 2) return null;
			const k = parts[0];
			const dur = +parts[1];
			if (!k || isNaN(dur)) return null;
			const seg = { kind: k, dur };
			if (parts.length >= 3) {
				const t = +parts[2];
				if (!isNaN(t)) seg.tokens = t;
			}
			return seg;
		})
		.filter(Boolean);
}

function _autoTicks(maxVal, n = 5) {
	if (maxVal <= 0) return [0];
	const step = Math.max(1, Math.ceil(maxVal / n));
	return Array.from({ length: n + 1 }, (_, i) => i * step);
}

function _addDurationBoxCard(
	parent,
	title,
	labels,
	durationsByLesson,
	opts = {},
) {
	if (!durationsByLesson.some((d) => d.length)) return;
	const hideOutliers = opts.hideOutliers !== false;
	const card = mkCard(parent, title);
	const box = el("div", "chart-box");
	card.appendChild(box);
	const allVals = durationsByLesson.flat();
	const yMax =
		opts.yMax != null ? opts.yMax : Math.ceil(Math.max(...allVals, 1) * 1.1);
	const xLabels = opts.subLabels
		? labels.map((l, i) => `${l}\n${opts.subLabels[i] ?? ""}`)
		: labels;
	const chart = new BoxPlotChart(box, {
		xLabels,
		leftAxis: {
			min: 0,
			max: yMax,
			ticks: opts.ticks || _autoTicks(yMax, 5),
			color: THEME.label,
			suffix: opts.tickSuffix || "",
		},
	});
	chart.setData([
		{
			data: durationsByLesson,
			color: _hexToRgba(THEME.label, 0.44),
			borderColor: THEME.label,
			yAxis: "left",
			coef: hideOutliers ? Infinity : 1.5,
			outlierColor: hideOutliers ? null : _hexToRgba(THEME.label, 0.5),
			outlierRadius: 3,
		},
	]);
	_barCharts.push(chart);
}

function linReg(pts) {
	const n = pts.length;
	if (n < 2) return [];
	const mx = pts.reduce((s, p) => s + p.x, 0) / n,
		my = pts.reduce((s, p) => s + p.y, 0) / n;
	const den = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
	if (!den) return [];
	const slope = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / den;
	const intercept = my - slope * mx;
	const xs = [
		Math.min(...pts.map((p) => p.x)),
		Math.max(...pts.map((p) => p.x)),
	];
	return xs.map((x) => ({
		x,
		y: Math.round((slope * x + intercept) * 100) / 100,
	}));
}

function addScatterCard(parent, assignment, points, isFirst) {
	const card = mkCard(parent, assignment.name, "sm");
	const box = el("div", "chart-box");
	card.appendChild(box);

	const noAI = points.filter((p) => !p.ai);
	const aiPts = points.filter((p) => p.ai);
	const trend = linReg(points);

	const chart = new ScatterChart(box, {
		xLabel: "Follow %",
		yLabel: "Grade",
		xMin: -2,
		xMax: 102,
		yMin: -0.1,
		yMax: 5.1,
		onClick: (pt) => {
			if (!pt?.student) return;
			openLessonDiff(pt.student, pt.student.lessons[pt.assignment.n - 1]);
		},
		onRightClick: (pt) => {
			if (!pt?.student) return;
			openAssignDiff(pt.student, pt.student.lessons[pt.assignment.n - 1]);
		},
	});
	chart.setDatasets([
		{
			data: noAI,
			color: _hexToRgba(THEME.textStrong, 0.6),
			pointRadius: 4,
			tooltip: (p) => {
				const grade = p.student?.lessons[p.assignment?.n - 1]?.grade;
				return [p.name, `(${Math.round(p.x)}%, ${grade ?? "?"})`];
			},
		},
		{
			data: aiPts,
			color: _hexToRgba(THEME.red, 0.6),
			pointRadius: 4,
			tooltip: (p) => {
				const grade = p.student?.lessons[p.assignment?.n - 1]?.grade;
				return [p.name, `(${Math.round(p.x)}%, ${grade ?? "?"})`];
			},
		},
		{
			data: trend,
			type: "line",
			color: THEME.muted,
			lineDash: [4, 4],
			lineWidth: 1.5,
		},
	]);
	_scatterCharts.push(chart);
}

function _chartSlug(text, fallback) {
	const s = String(text || "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return s || fallback;
}

function _chartCanvasFilename(canvas, idx) {
	const card = canvas.closest(".stat-card, .prog-card, .cluster-section");
	const heading = card?.querySelector("h3, h4");
	const base = _chartSlug(heading?.textContent, "chart");
	return `${String(idx + 1).padStart(2, "0")}_${base}.png`;
}

const CHART_DL_SCALE = 3;

function _chartByCanvas() {
	const all = [..._barCharts, ..._scatterCharts, ..._clusterCharts];
	return new Map(all.map((c) => [c._canvas, c]));
}

const MAX_CHART_DL_PX = 16384;

function _exportChartAtScale(chart, scale) {
	return new Promise((resolve) => {
		const canvas = chart._canvas;
		const r = canvas.getBoundingClientRect();
		const baseDpr = chart._dpr || 1;
		const cssW = r.width || canvas.width / baseDpr;
		const cssH = r.height || canvas.height / baseDpr;
		let dpr = (window.devicePixelRatio || 1) * scale;
		const maxDim = Math.max(cssW, cssH) * dpr;
		if (maxDim > MAX_CHART_DL_PX) dpr *= MAX_CHART_DL_PX / maxDim;
		canvas.width = Math.max(1, Math.round(cssW * dpr));
		canvas.height = Math.max(1, Math.round(cssH * dpr));
		chart._dpr = dpr;
		chart._draw();
		canvas.toBlob((blob) => {
			try {
				chart._resize();
			} catch {}
			resolve(blob);
		}, "image/png");
	});
}

async function _downloadTabChartsZip(bodyEl, zipName) {
	if (!bodyEl) return;
	const canvases = Array.from(bodyEl.querySelectorAll("canvas"));
	if (!canvases.length) return;
	const byCanvas = _chartByCanvas();
	const files = new Map();
	const order = [];
	for (let i = 0; i < canvases.length; i++) {
		const canvas = canvases[i];
		const chart = byCanvas.get(canvas);
		const blob = await (chart
			? _exportChartAtScale(chart, CHART_DL_SCALE)
			: new Promise((res) => canvas.toBlob(res, "image/png")));
		if (!blob) continue;
		const name = _chartCanvasFilename(canvas, i);
		files.set(name, new Uint8Array(await blob.arrayBuffer()));
		order.push(name);
	}
	if (!order.length) return;
	const zip = await miniZipBuild(files, order);
	const url = URL.createObjectURL(
		new Blob([zip], { type: "application/zip" }),
	);
	const a = document.createElement("a");
	a.href = url;
	a.download = zipName;
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}

function _refreshChartDownloadBtns() {
	for (const [btnId, bodyId] of [
		["stats-download-btn", "stats-body"],
		["progress-download-btn", "clusters-body"],
	]) {
		const btn = document.getElementById(btnId);
		if (!btn) continue;
		const body = document.getElementById(bodyId);
		btn.style.display = body && body.querySelector("canvas") ? "" : "none";
	}
}
