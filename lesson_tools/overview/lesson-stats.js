"use strict";

function renderLessonStats(body) {
	if (!_lessonStats) return;
	const ls = _lessonStats;

	const displayByLower = new Map();
	ASSIGNMENTS.forEach((a) => {
		displayByLower.set(a.name.toLowerCase(), a.name);
	});
	const _lower = (r) =>
		String(r["Lesson"] ?? "")
			.trim()
			.toLowerCase();
	const orderedRows = [];
	const seenRows = new Set();
	ASSIGNMENTS.forEach((a) => {
		const key = a.name.toLowerCase();
		const row = ls.rows.find((r) => _lower(r) === key);
		if (row) {
			orderedRows.push(row);
			seenRows.add(row);
		}
	});
	ls.rows.forEach((row) => {
		if (!seenRows.has(row)) orderedRows.push(row);
	});

	const lessonNames = orderedRows.map(
		(r) => displayByLower.get(_lower(r)) || r["Lesson"],
	);
	const numFor = (key) =>
		orderedRows.map((r) => {
			const v = r[key];
			if (v == null || v === "") return null;
			const n = +v;
			return isNaN(n) ? null : n;
		});
	const anyPos = (arr) => arr.some((v) => v != null && v > 0);

	const kpmActive = numFor("kpm_active");
	const kpmSession = numFor("kpm_session");
	if (anyPos(kpmActive) || anyPos(kpmSession)) {
		const cc = new ChartCard(body, "Typing Rate KPM", {
			legend: [
				{ label: "Active", color: THEME.label },
				{ label: "Session", color: _hexToRgba(THEME.label, 0.35) },
			],
		});
		const all = [...kpmActive, ...kpmSession].filter((v) => v != null);
		const chart = new BarChart(cc.box, {
			yMin: 0,
			yMax: (Math.max(...all, 1) * 1.1) | 0 || 1,
			tooltip: false,
		});
		chart.setData(lessonNames, [
			{
				data: kpmActive.map((v) => v ?? 0),
				backgroundColor: THEME.label,
				borderColor: THEME.label,
			},
			{
				data: kpmSession.map((v) => v ?? 0),
				backgroundColor: _hexToRgba(THEME.label, 0.18),
				borderColor: _hexToRgba(THEME.label, 0.35),
			},
		]);
		cc.register(chart);
	}

	const tQun = numFor("teacher_q_unanswered");
	const _cohortLessonSum = (lessonName, key) => {
		let sum = 0;
		for (const s of _students || []) {
			if (s.excluded) continue;
			const e = (s.lessons || []).find((l) => l.name === lessonName);
			if (e && e[key] != null) sum += e[key];
		}
		return sum;
	};
	const tQAns = lessonNames.map((n) => _cohortLessonSum(n, "a"));
	const tQUna = lessonNames.map((_, i) => tQun[i] ?? 0);
	const sQ = lessonNames.map((n) => _cohortLessonSum(n, "q"));
	const hG = lessonNames.map((n) => _cohortLessonSum(n, "h"));
	if (anyPos(tQAns) || anyPos(tQUna) || anyPos(sQ) || anyPos(hG)) {
		const cc = new ChartCard(body, "Interactions", {
			legend: [
				{ label: "Answered", color: THEME.blue },
				{ label: "Asked", color: THEME.orange },
				{ label: "Got Help", color: THEME.green },
			],
		});
		const teacherTot = tQAns.map((v, i) => v + (tQUna[i] ?? 0));
		const all = [...teacherTot, ...sQ, ...hG];
		const colors = [THEME.blue, THEME.orange, THEME.green];
		const chart = new BarChart(cc.box, {
			yMin: 0,
			yMax: Math.max(...all, 1) + 1,
			unifiedTooltip: true,
			tooltipCallback: (_l, val, si, gi) => {
				if (si === 0 || si === 1) {
					const a = tQAns[gi] ?? 0;
					const b = a + (tQUna[gi] ?? 0);
					return [`Answered Questions: ${a}/${b}`];
				}
				return [
					["", "", "Asked Questions", "Provided Help"][si] +
						": " +
						Math.round(val),
				];
			},
		});
		chart.setData(lessonNames, [
			{
				data: tQAns,
				stack: "answer",
				backgroundColor: colors[0],
				borderColor: colors[0],
			},
			{
				data: tQUna,
				stack: "answer",
				backgroundColor: colors[0],
				borderColor: colors[0],
				pattern: "stripes",
			},
			{
				data: sQ.map((v) => v ?? 0),
				backgroundColor: colors[1],
				borderColor: colors[1],
			},
			{
				data: hG.map((v) => v ?? 0),
				backgroundColor: colors[2],
				borderColor: colors[2],
			},
		]);
		cc.register(chart);
	}

	const tHtml = numFor("tokens_html");
	const tCss = numFor("tokens_css");
	const tJs = numFor("tokens_js");
	const tPy = numFor("tokens_py");
	if (anyPos(tHtml) || anyPos(tCss) || anyPos(tJs) || anyPos(tPy)) {
		const tokenLangs = [
			{ label: "HTML", data: tHtml, color: THEME.red },
			{ label: "CSS", data: tCss, color: THEME.blue },
			{ label: "JS", data: tJs, color: THEME.orange },
			{ label: "Py", data: tPy, color: THEME.black },
		].filter((l) => anyPos(l.data));
		addStackedBarCard(
			body,
			"Code Tokens",
			lessonNames,
			tokenLangs.map((l) => ({
				data: l.data,
				color: l.color,
				label: l.label,
			})),
			{
				yScale: 1.1,
				legend: true,
				tooltip: false,
			},
		);
	}

	const LESSON_MIN = 90;
	const duration = numFor("coding_min");
	if (anyPos(duration)) {
		const durData = duration.map((v) =>
			v == null ? 0 : Math.round(v * 10) / 10,
		);
		const bursts = numFor("bursts");
		addStackedShareCard(
			body,
			"Typing Duration (min)",
			lessonNames,
			durData,
			durData.map(() => LESSON_MIN),
			Math.max(LESSON_MIN, Math.max(...durData, 1)) * 1.05,
			{
				subLabels: bursts.map((n) => (n != null ? `n=${n}` : "")),
				tooltip: false,
			},
		);
	}

	const segmentsByLesson = orderedRows.map((r) =>
		_parseSegments(r["segments"]),
	);
	// Both pause charts derive from the SAME "p" (pause) segments, so the box
	// plot, the average bar, and their shared n= can never disagree (and don't
	// depend on the pause_count / pause_avg_s columns, which may be stale).
	const pauseData = segmentsByLesson.map((segs) =>
		segs.filter((s) => s.kind === "p").map((s) => s.dur / 60),
	);
	const pauseSubLabels = pauseData.map((d) => `n=${d.length}`);
	if (pauseData.some((d) => d.length)) {
		_addDurationBoxCard(
			body,
			"Pause Duration (min)",
			lessonNames,
			pauseData,
			{ subLabels: pauseSubLabels },
		);

		const pauseAvgMin = pauseData.map((d) =>
			d.length ? d.reduce((a, b) => a + b, 0) / d.length : 0,
		);
		addBarCard(
			body,
			"Avg Pause Duration (min)",
			lessonNames,
			pauseAvgMin,
			THEME.label,
			Math.max(...pauseAvgMin, 1) * 1.1,
			"dec1",
			undefined,
			{ subLabels: pauseSubLabels, tooltip: false },
		);
	}
}
