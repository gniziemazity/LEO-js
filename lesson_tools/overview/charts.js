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
			backgroundColor: THEME.label,
			borderColor: THEME.label,
		},
		{
			data: restCounts,
			backgroundColor: _hexToRgba(THEME.label, 0.22),
			borderColor: _hexToRgba(THEME.label, 0.45),
		},
	]);
	_barCharts.push(chart);
}

function addAiUseCard(parent, title, labels, strong, medium, none, totals) {
	const card = mkCard(parent, title);
	const box = el("div", "chart-box");
	card.appendChild(box);
	const redC = artefactFiredColorFor("high");
	const orangeC = artefactFiredColorFor("medium");
	const grayC = THEME.artefactOk;
	const pct = (n, gi) => (totals[gi] ? Math.round((n / totals[gi]) * 100) : 0);
	const chart = new BarChart(box, {
		yMin: 0,
		yMax: Math.max(...totals, 1) + 1,
		stacked: true,
		tooltipCallback: (_l, _v, si, gi) => {
			if (si === 0)
				return [`strong AI: ${strong[gi]} (${pct(strong[gi], gi)}%)`];
			if (si === 1)
				return [
					`+ medium: ${medium[gi]} → up to ${pct(strong[gi] + medium[gi], gi)}%`,
				];
			return [`no AI: ${none[gi]} of ${totals[gi] || 0}`];
		},
		barLabel: (gi, si) => {
			if (!totals[gi]) return null;
			if (si === 0) return strong[gi] ? pct(strong[gi], gi) + "%" : null;
			if (si === 1)
				return medium[gi] ? pct(strong[gi] + medium[gi], gi) + "%" : null;
			return null;
		},
	});
	chart.setData(labels, [
		{ data: strong, backgroundColor: redC, borderColor: redC },
		{ data: medium, backgroundColor: orangeC, borderColor: orangeC },
		{ data: none, backgroundColor: grayC, borderColor: grayC },
	]);
	_barCharts.push(chart);
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
			backgroundColor: color + "44",
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
	const yMax = Math.ceil(Math.max(...allVals, 1) * 1.1);
	const chart = new BoxPlotChart(box, {
		xLabels: labels,
		leftAxis: {
			min: 0,
			max: yMax,
			ticks: _autoTicks(yMax, 5),
			color: THEME.textFaint,
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
