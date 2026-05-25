"use strict";

const _HIDE_PAIRS = [
	{ key: "grade", ids: ["prog-hide-grade", "cluster-hide-grade"] },
	{
		key: "totalFollow",
		ids: ["prog-hide-total-follow", "cluster-hide-total-follow"],
	},
	{
		key: "langFollow",
		ids: ["prog-hide-lang-follow", "cluster-hide-lang-follow"],
	},
];

function _progressHide() {
	const state = {};
	for (const { key, ids } of _HIDE_PAIRS) {
		state[key] = ids.some(
			(id) => document.getElementById(id)?.checked === true,
		);
	}
	return state;
}

(function _initProgressHidePrefs() {
	try {
		const saved = JSON.parse(localStorage.getItem("progress_hide") || "{}");
		for (const { key, ids } of _HIDE_PAIRS) {
			if (!saved[key]) continue;
			for (const id of ids) {
				const el = document.getElementById(id);
				if (el) el.checked = true;
			}
		}
	} catch {}
})();

for (const { ids } of _HIDE_PAIRS) {
	for (const id of ids) {
		document.getElementById(id)?.addEventListener("change", (e) => {
			const checked = e.currentTarget.checked;
			for (const other of ids) {
				if (other === id) continue;
				const el = document.getElementById(other);
				if (el) el.checked = checked;
			}
			try {
				localStorage.setItem(
					"progress_hide",
					JSON.stringify(_progressHide()),
				);
			} catch {}
			if (_students.length) {
				renderProgress();
				renderClusters();
			}
		});
	}
}

function addProgressTotals(container) {
	const hide = _progressHide();
	if (hide.totalFollow && hide.grade) return;

	const card = el("div", "prog-totals");
	const h4 = el("h4");
	h4.textContent = "Totals";
	card.appendChild(h4);
	const box = el("div", "prog-chart-box");
	box.style.height = "180px";
	card.appendChild(box);
	container.appendChild(card);

	const labels = ASSIGNMENTS.map((a) => a.name);
	const followData = ASSIGNMENTS.map((a) =>
		a.follow != null
			? _students
					.map((s) => s.lessons[a.n - 1].follow)
					.filter((v) => v != null)
			: [],
	);
	const gradeData = ASSIGNMENTS.map((a) =>
		_students.map((s) => s.lessons[a.n - 1].grade).filter((v) => v != null),
	);

	const followAxis = {
		min: 0,
		max: 100,
		ticks: [0, 20, 40, 60, 80, 100],
		color: THEME.textFaint,
	};
	const gradeAxis = {
		min: 0,
		max: 5,
		ticks: [0, 1, 2, 3, 4, 5],
		color: THEME.blue,
	};

	let leftAxis,
		rightAxis,
		gradeYAxis = "right";
	if (!hide.totalFollow && !hide.grade) {
		leftAxis = followAxis;
		rightAxis = gradeAxis;
	} else if (!hide.totalFollow) {
		leftAxis = followAxis;
	} else {
		leftAxis = gradeAxis;
		gradeYAxis = "left";
	}

	const chart = new BoxPlotChart(box, {
		xLabels: labels,
		leftAxis,
		rightAxis,
	});

	const datasets = [];
	if (!hide.totalFollow) {
		datasets.push({
			data: followData,
			color: _hexToRgba(THEME.label, 0.44),
			borderColor: THEME.label,
			yAxis: "left",
			coef: 25,
			outlierColor: _hexToRgba(THEME.label, 0.5),
			outlierRadius: 3,
		});
	}
	if (!hide.grade) {
		datasets.push({
			data: gradeData,
			color: _hexToRgba(THEME.blue, 0.44),
			borderColor: THEME.blue,
			yAxis: gradeYAxis,
			coef: 25,
			outlierColor: _hexToRgba(THEME.blue, 0.5),
			outlierRadius: 3,
		});
	}
	chart.setData(datasets);
	_progressCharts.push(chart);
}

function addProgressLanguageTotals(container) {
	if (_progressHide().langFollow) return;

	const card = el("div", "prog-totals");
	const h4 = el("h4");
	h4.textContent = "Totals by Language";
	card.appendChild(h4);
	const box = el("div", "prog-chart-box");
	box.style.height = "180px";
	card.appendChild(box);
	container.appendChild(card);

	const labels = ASSIGNMENTS.map((a) => a.name);
	const seriesData = LANG_FOLLOW_KEYS.map(({ entryKey }) =>
		ASSIGNMENTS.map((a) =>
			a.follow != null
				? _students
						.map((s) => s.lessons[a.n - 1][entryKey])
						.filter((v) => v != null)
				: [],
		),
	);
	const hasAny = seriesData.some((s) => s.some((arr) => arr.length > 0));
	if (!hasAny) return;

	const chart = new BoxPlotChart(box, {
		xLabels: labels,
		leftAxis: {
			min: 0,
			max: 100,
			ticks: [0, 20, 40, 60, 80, 100],
			color: THEME.textFaint,
		},
	});
	chart.setData(
		LANG_FOLLOW_KEYS.map(({ colorVar }, i) => {
			const c = _cssVar(colorVar) || THEME.label;
			return {
				data: seriesData[i],
				color: _hexToRgba(c, 0.44),
				borderColor: c,
				yAxis: "left",
				coef: 25,
				outlierColor: _hexToRgba(c, 0.5),
				outlierRadius: 3,
			};
		}),
	);
	_progressCharts.push(chart);
}

function renderProgress() {
	_progressCharts.forEach((c) => {
		try {
			c.destroy();
		} catch {}
	});
	_progressCharts = [];

	const grid = document.getElementById("prog-grid");
	grid.innerHTML = "";

	addProgressTotals(grid);
	addProgressLanguageTotals(grid);

	const labels = ASSIGNMENTS.map((a) => a.name);
	const sorted = sortedStudents();

	for (const s of sorted) {
		const { card, chart } = _buildStudentProgressCard(s, labels);
		grid.appendChild(card);
		_progressCharts.push(chart);
	}
}

function _buildStudentProgressCard(s, labels) {
	const card = el("div", "prog-card" + (s.passed_course ? "" : " not-passed"));
	const h4 = el("h4");
	const titleParts = [studentLabelWithId(s)];
	const avgF = followAvg(s);
	if (avgF >= 0) titleParts.push(`follow ${avgF.toFixed(1)}%`);
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

	const hide = _progressHide();
	const showAnyFollow = !hide.totalFollow || !hide.langFollow;
	const followAxis = {
		min: -4,
		max: 104,
		ticks: [0, 20, 40, 60, 80, 100],
		color: THEME.textFaint,
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
	if (showAnyFollow && !hide.grade) {
		lcLeftAxis = followAxis;
		lcRightAxis = gradeAxis;
	} else if (showAnyFollow) {
		lcLeftAxis = followAxis;
	} else if (!hide.grade) {
		lcLeftAxis = gradeAxis;
		gradeYAxis = "left";
	}
	const chart = new LineChart(box, {
		xLabels: labels,
		leftAxis: lcLeftAxis,
		rightAxis: lcRightAxis,
		onClick: (di, pi) => {
			const asgn = ASSIGNMENTS[pi];
			if (!asgn) return;
			const entry = s.lessons[asgn.n - 1];
			const langCount = hide.langFollow ? 0 : LANG_FOLLOW_KEYS.length;
			if (di < langCount) openLessonDiff(s, entry);
			else if (di === langCount && !hide.totalFollow)
				openLessonDiff(s, entry);
			else openAssignDiff(s, entry);
		},
	});

	const datasets = [];
	if (!hide.langFollow) {
		for (const { entryKey, colorVar } of LANG_FOLLOW_KEYS) {
			const c = _cssVar(colorVar) || THEME.label;
			datasets.push({
				data: s.lessons.map((l) =>
					l.hasFollowCol ? (l[entryKey] ?? null) : null,
				),
				color: _hexToRgba(c, 0.45),
				pointFillColor: _hexToRgba(c, 0.25),
				lineWidth: 1.0,
				pointRadius: 2.5,
				yAxis: "left",
			});
		}
	}
	if (!hide.totalFollow) {
		datasets.push({
			data: follows,
			color: THEME.label,
			pointFillColor: _hexToRgba(THEME.label, 0.44),
			lineWidth: 1.5,
			pointRadius: 4,
			yAxis: "left",
			pointLabels: s.lessons.map((l) => {
				const v = l.lesson_obs?.trim();
				return v && v !== "_" ? v : null;
			}),
			labelColor: THEME.label,
		});
	}
	if (!hide.grade) {
		datasets.push({
			data: grades,
			color: THEME.blue,
			pointFillColor: _hexToRgba(THEME.blue, 0.44),
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
	return { card, chart };
}
