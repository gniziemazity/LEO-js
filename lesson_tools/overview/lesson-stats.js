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
		const card = mkCard(body, "Typing Rate KPM (Active / Session)");
		const box = el("div", "chart-box");
		card.appendChild(box);
		const all = [...kpmActive, ...kpmSession].filter((v) => v != null);
		const chart = new BarChart(box, {
			yMin: 0,
			yMax: (Math.max(...all, 1) * 1.1) | 0 || 1,
			tooltipCallback: (_l, val, si) => [
				(si === 0 ? "Active: " : "Session: ") + val.toFixed(1) + " KPM",
			],
		});
		chart.setData(lessonNames, [
			{
				data: kpmActive.map((v) => v ?? 0),
				backgroundColor: _hexToRgba(THEME.label, 0.5),
				borderColor: THEME.label,
			},
			{
				data: kpmSession.map((v) => v ?? 0),
				backgroundColor: _hexToRgba(THEME.label, 0.18),
				borderColor: _hexToRgba(THEME.label, 0.35),
			},
		]);
		_barCharts.push(chart);
	}

	const tHtml = numFor("tokens_html");
	const tCss = numFor("tokens_css");
	const tJs = numFor("tokens_js");
	const tPy = numFor("tokens_py");
	const tComment = numFor("tokens_comment");
	const tDev = numFor("tokens_dev");
	if (
		anyPos(tHtml) ||
		anyPos(tCss) ||
		anyPos(tJs) ||
		anyPos(tPy) ||
		anyPos(tComment) ||
		anyPos(tDev)
	) {
		const card = mkCard(body, "Tokens per Lesson");
		const box = el("div", "chart-box");
		card.appendChild(box);
		const totals = lessonNames.map(
			(_, i) =>
				(tHtml[i] ?? 0) +
				(tCss[i] ?? 0) +
				(tJs[i] ?? 0) +
				(tPy[i] ?? 0) +
				(tComment[i] ?? 0) +
				(tDev[i] ?? 0),
		);
		const stackNames = ["HTML", "CSS", "JS", "Py", "Comment", "Dev"];
		const chart = new BarChart(box, {
			yMin: 0,
			yMax: Math.max(...totals, 1) * 1.1,
			stacked: true,
			tooltipCallback: (_l, val, si) => [
				stackNames[si] + ": " + Math.round(val),
			],
		});
		const langColor = [
			_cssVar("--clr-red"),
			_cssVar("--clr-accent"),
			_cssVar("--clr-orange"),
			_cssVar("--clr-black"),
			_cssVar("--clr-green"),
			_cssVar("--clr-purple"),
		];
		const stackData = [tHtml, tCss, tJs, tPy, tComment, tDev];
		chart.setData(
			lessonNames,
			stackData.map((arr, i) => ({
				data: arr.map((v) => v ?? 0),
				backgroundColor: _hexToRgba(langColor[i], 0.5),
				borderColor: langColor[i],
			})),
		);
		_barCharts.push(chart);
	}

	const LESSON_MIN = 90;
	const duration = numFor("coding_min");
	if (anyPos(duration)) {
		const durData = duration.map((v) =>
			v == null ? 0 : Math.round(v * 10) / 10,
		);
		addStackedShareCard(
			body,
			"Typing Duration (min)",
			lessonNames,
			durData,
			durData.map(() => LESSON_MIN),
			Math.max(LESSON_MIN, Math.max(...durData, 1)) * 1.05,
		);
	}

	const segmentsByLesson = orderedRows.map((r) =>
		_parseSegments(r["segments"]),
	);
	if (segmentsByLesson.some((s) => s.length)) {
		const codeCounts = segmentsByLesson.map(
			(segs) => segs.filter((s) => s.kind !== "p").length,
		);
		_addDurationBoxCard(
			body,
			"Pause Duration (min)",
			lessonNames,
			segmentsByLesson.map((segs) =>
				segs.filter((s) => s.kind === "p").map((s) => s.dur / 60),
			),
		);
	}

	const pauseCnt = numFor("pause_count");
	const pauseAvg = numFor("pause_avg_s");
	if (anyPos(pauseCnt)) {
		addBarCard(
			body,
			"Pause Count",
			lessonNames,
			pauseCnt.map((v) => v ?? 0),
			THEME.label,
			Math.max(...pauseCnt.filter((v) => v != null), 1) + 1,
			"int",
		);
	}
	if (anyPos(pauseAvg)) {
		const pauseAvgMin = pauseAvg.map((v) => (v != null ? v / 60 : null));
		addBarCard(
			body,
			"Avg Pause Duration (min)",
			lessonNames,
			pauseAvgMin.map((v) => v ?? 0),
			THEME.label,
			Math.max(...pauseAvgMin.filter((v) => v != null), 1) * 1.1,
			"dec1",
		);
	}

	const tQ = numFor("teacher_q");
	const tQun = numFor("teacher_q_unanswered");
	const sQ = numFor("student_q");
	const hG = numFor("help");
	if (anyPos(tQ) || anyPos(sQ) || anyPos(hG)) {
		const card = mkCard(body, "Lesson Interactions");
		const box = el("div", "chart-box");
		card.appendChild(box);
		const all = [...tQ, ...sQ, ...hG].filter((v) => v != null);
		const colors = [
			_cssVar("--clr-accent"),
			_cssVar("--clr-orange"),
			_cssVar("--clr-green"),
		];
		const tQAns = tQ.map((v, i) => {
			const t = v ?? 0;
			const u = tQun[i] ?? 0;
			return Math.max(0, t - u);
		});
		const tQUna = tQ.map((_, i) => tQun[i] ?? 0);
		const chart = new BarChart(box, {
			yMin: 0,
			yMax: Math.max(...all, 1) + 1,
			tooltipCallback: (_l, val, si) => [
				["Answered", "Unanswered", "Question", "Help"][si] +
					": " +
					Math.round(val),
			],
		});
		chart.setData(lessonNames, [
			{
				data: tQAns,
				stack: "answer",
				backgroundColor: _hexToRgba(colors[0], 0.5),
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
				backgroundColor: _hexToRgba(colors[1], 0.5),
				borderColor: colors[1],
			},
			{
				data: hG.map((v) => v ?? 0),
				backgroundColor: _hexToRgba(colors[2], 0.5),
				borderColor: colors[2],
			},
		]);
		_barCharts.push(chart);
	}
}
