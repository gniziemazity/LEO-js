"use strict";

function _followMode() {
	const cb = document.getElementById("follow-mode-lang-cb");
	return cb && cb.checked ? "lang" : "total";
}

function _progressShow() {
	const mode = _followMode();
	return {
		grade: false,
		totalFollow: mode === "total",
		langFollow: mode === "lang",
		artefacts: !_hideArtefacts,
	};
}

function _onProgressControlChange() {
	if (typeof _students !== "undefined" && _students.length) renderClusters();
}

function _addProgressFollowBoxplot(body, students) {
	if (typeof BoxPlotChart === "undefined") return;
	const followAsgns = ASSIGNMENTS.filter((a) => a.follow != null);
	if (!followAsgns.length || !students.length) return;
	const labels = followAsgns.map((a) => a.name);
	const collect = (key) =>
		followAsgns.map((a) =>
			students
				.map((s) => s.lessons[a.n - 1])
				.filter((e) => e && !_tookCode(e))
				.map((e) => e[key])
				.filter((v) => v != null),
		);

	let datasets;
	if (_followMode() === "lang") {
		datasets = LANG_FOLLOW_KEYS.map(({ entryKey, color }) => {
			const c = color || THEME.label;
			return {
				data: collect(entryKey),
				color: _hexToRgba(c, 0.44),
				borderColor: c,
				yAxis: "left",
				coef: Infinity,
				outlierRadius: 3,
			};
		});
	} else {
		datasets = [
			{
				data: collect("follow"),
				color: _hexToRgba(THEME.label, 0.44),
				borderColor: THEME.label,
				yAxis: "left",
				coef: Infinity,
				outlierRadius: 3,
			},
		];
	}
	if (!datasets.some((d) => d.data.some((arr) => arr.length))) return;

	const section = el("div", "cluster-section prog-boxplot");
	const header = el("div", "cluster-header");
	const h3 = el("h3");
	h3.textContent =
		_followMode() === "lang"
			? "Follow Distribution by Language"
			: "Follow Distribution";
	header.appendChild(h3);
	if (_followMode() === "lang") {
		header.appendChild(
			new ChartLegend(
				LANG_FOLLOW_KEYS.map(({ label, color }) => ({
					label,
					color: color || THEME.label,
				})),
			).render(),
		);
	}
	section.appendChild(header);
	const box = el("div", "prog-boxplot-chart");
	section.appendChild(box);
	const chart = new BoxPlotChart(box, {
		xLabels: labels,
		leftAxis: {
			min: 0,
			max: 100,
			ticks: [0, 20, 40, 60, 80, 100],
			color: THEME.label,
			suffix: "%",
		},
	});
	chart.setData(datasets);
	_clusterCharts.push(chart);
	body.appendChild(section);
}

const _EMPH_IDS = (() => {
	try {
		return new Set((parseToolParams().ids || []).map((x) => String(x)));
	} catch (_e) {
		return new Set();
	}
})();

function _buildStudentProgressCard(s, labels) {
	const markPass = _hasAnyStatusValues();
	const card = el(
		"div",
		"prog-card" +
			(!markPass || s.passed_course ? "" : " not-passed") +
			(s.ai_flagged ? " row-ai" : "") +
			(_EMPH_IDS.has(String(s.id)) ? " prog-emph" : ""),
	);
	const h4 = el("h4");
	const avgF = followAvg(s);
	const nameLabel =
		studentLabelWithId(s) +
		(avgF >= 0 ? ` (average ${avgF.toFixed(1)}%)` : "");
	const titleParts = [nameLabel];
	const avgG = s.avg_assignments;
	if (avgG != null) titleParts.push(`grade ${avgG.toFixed(2)}`);
	h4.textContent = titleParts.join(" · ");
	card.appendChild(h4);
	const box = el("div", "prog-chart-box");
	card.appendChild(box);

	const follows = s.lessons.map((l) =>
		l.hasFollowCol ? (l.follow ?? null) : null,
	);
	const grades = s.lessons.map((l) => l.grade ?? null);
	const redObs = s.lessons.map((l) => {
		const t = l.lesson_obs?.trim();
		return !!t && t !== "_" && t.includes("<");
	});

	const show = _progressShow();
	const showAnyFollow = show.totalFollow || show.langFollow;
	const followAxis = {
		min: -4,
		max: 104,
		ticks: [0, 20, 40, 60, 80, 100],
		color: THEME.label,
		suffix: "%",
	};
	const gradeAxis = {
		min: -0.25,
		max: 5.25,
		ticks: [0, 1, 2, 3, 4, 5],
		color: THEME.blue,
	};
	let lcLeftAxis,
		lcRightAxis,
		gradeYAxis = "right";
	if (showAnyFollow && show.grade) {
		lcLeftAxis = followAxis;
		lcRightAxis = gradeAxis;
	} else if (showAnyFollow) {
		lcLeftAxis = followAxis;
	} else if (show.grade) {
		lcLeftAxis = gradeAxis;
		gradeYAxis = "left";
	}
	const obsMarks = s.lessons.map((l) => {
		const text = l.lesson_obs?.trim();
		if (!text || text === "_") return null;
		if (show.langFollow) {
			const vals = LANG_FOLLOW_KEYS.map(({ entryKey }) =>
				l.hasFollowCol ? l[entryKey] : null,
			).filter((v) => v != null);
			if (!vals.length) return null;
			return {
				text: formatLessonObs(text),
				belowVal: Math.min(...vals),
				aboveVal: Math.max(...vals),
				axis: "left",
				color: text.includes("<") ? THEME.red : THEME.label,
			};
		}
		const v = l.hasFollowCol ? l.follow : null;
		if (v == null) return null;
		return {
			text: formatLessonObs(text),
			belowVal: v,
			aboveVal: v,
			axis: "left",
			color: text.includes("<") ? THEME.red : THEME.label,
		};
	});
	const chart = new LineChart(box, {
		xLabels: labels,
		leftAxis: lcLeftAxis,
		rightAxis: lcRightAxis,
		obsMarks,
		onClick: (di, pi) => {
			const asgn = ASSIGNMENTS[pi];
			if (!asgn) return;
			const entry = s.lessons[asgn.n - 1];
			const langCount = show.langFollow ? LANG_FOLLOW_KEYS.length : 0;
			if (di < langCount) openLessonDiff(s, entry);
			else if (di === langCount && show.totalFollow)
				openLessonDiff(s, entry);
			else openAssignDiff(s, entry);
		},
	});

	const datasets = [];
	if (show.langFollow) {
		for (const { entryKey, color } of LANG_FOLLOW_KEYS) {
			const c = color || THEME.label;
			datasets.push({
				data: s.lessons.map((l) =>
					l.hasFollowCol ? (l[entryKey] ?? null) : null,
				),
				color: c,
				pointFillColor: c,
				lineWidth: 1.0,
				pointRadius: 2.5,
				yAxis: "left",
			});
		}
	}
	if (show.totalFollow) {
		datasets.push({
			data: follows,
			color: THEME.label,
			pointFillColor: THEME.label,
			pointColors: redObs.map((r) => (r ? THEME.red : THEME.label)),
			lineWidth: 1.5,
			pointRadius: 4,
			yAxis: "left",
		});
	}
	if (show.grade) {
		datasets.push({
			data: grades,
			color: THEME.blue,
			pointFillColor: THEME.blue,
			lineWidth: 1.5,
			lineDash: [4, 3],
			pointRadius: 4,
			yAxis: gradeYAxis,
			pointLabels: s.lessons.map((l) => {
				const v = l.obs?.trim();
				return v && v !== "_" ? v : null;
			}),
			labelColor: THEME.blue,
		});
	}
	chart.setDatasets(datasets);
	if (show.artefacts) {
		const artefacts = _buildArtefactsRow(s);
		if (artefacts) card.appendChild(artefacts);
	}
	return { card, chart };
}

function _buildArtefactsRow(s) {
	const cols = [];
	let maxRows = 0;
	let anyPattern = false;
	for (const a of ASSIGNMENTS) {
		const entry = s.lessons[a.n - 1];
		const obs = entry?.obs || "";
		const schema = _artefactSchema[(a.name || "").toLowerCase()];
		const schemaArr = Array.isArray(schema) ? schema : [];
		const has = isArtefactPattern(obs);
		if (has) anyPattern = true;
		const rows = has ? Math.max(obs.length, schemaArr.length) : 0;
		if (rows > maxRows) maxRows = rows;
		cols.push({ entry, obs, schema, schemaArr, has, rows });
	}
	if (!anyPattern || maxRows === 0) return null;
	const row = el("div", "prog-artefacts-row");
	const n = ASSIGNMENTS.length;
	row.style.height = maxRows * 12 + Math.max(0, maxRows - 1) * 2 + "px";
	cols.forEach(({ entry, obs, schema, schemaArr, has, rows }, idx) => {
		const col = el("div", "prog-artefact-col");
		const frac = n <= 1 ? 0.5 : idx / (n - 1);
		col.style.left = `calc(34px + ${frac} * (100% - 62px))`;
		if (has) {
			for (let i = 0; i < rows; i++) {
				const ch = obs[i] || "0";
				const fired = ch === "1";
				const sev = (schemaArr[i] && schemaArr[i].severity) || "high";
				const clr = fired ? artefactFiredColorFor(sev) : THEME.artefactOk;
				const badge = el("div", "prog-artefact-badge");
				badge.style.background = clr;
				col.appendChild(badge);
			}
			const tipHtml = buildArtefactSummaryHtml(obs, schema);
			if (tipHtml) attachHtmlTip(col, tipHtml);
			col.style.cursor = "pointer";
			col.addEventListener("click", () => {
				if (entry) openAssignDiff(s, entry);
			});
		}
		row.appendChild(col);
	});
	return row;
}
