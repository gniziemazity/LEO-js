"use strict";

function renderStats() {
	const body = document.getElementById("stats-body");
	const noData = document.getElementById("stats-no-data");
	body.innerHTML = "";
	[..._scatterCharts, ..._barCharts].forEach((c) => {
		try {
			c.destroy();
		} catch {}
	});
	_scatterCharts = [];
	_barCharts = [];

	if (!_pyStats) {
		noData.style.display = "";
		_refreshChartDownloadBtns();
		return;
	}
	noData.style.display = "none";

	const py = _pyStats;
	const fmtP = (p) => {
		if (p == null) return "—";
		const s = p < 0.001 ? "***" : p < 0.01 ? "**" : p < 0.05 ? "*" : "";
		return p.toFixed(4) + (s ? `<span class="sig"> ${s}</span>` : "");
	};
	const fmtR = (r) => {
		if (r == null) return "—";
		const cls =
			(Math.abs(r) > 0.3 ? "r-bold " : "") + (r > 0 ? "r-pos" : "r-neg");
		return `<span class="${cls}">${r > 0 ? "+" : ""}${r.toFixed(3)}</span>`;
	};
	const fmtPct = (v) => (v != null ? (v * 100).toFixed(1) + "%" : "—");
	const ACCENT = THEME.label;

	renderLessonStats(body);

	if (py.assignments) {
		const names6 = py.assignments.map((a) => a.name);
		const names5 = py.assignments
			.filter((a) => a.follow_avg != null)
			.map((a) => a.name);

		const asgNames = ASSIGNMENTS.map((a) => a.name);
		const passCounts = ASSIGNMENTS.map(
			(a) =>
				_students.filter(
					(s) => !s.excluded && PASSING.has(s.lessons[a.n - 1].status),
				).length,
		);
		const participCounts = ASSIGNMENTS.map(
			(a) =>
				_students.filter(
					(s) =>
						!s.excluded && (s.lessons[a.n - 1].obs ?? "").trim() !== "",
				).length,
		);
		const participMax = Math.max(...participCounts, 1) + 1;
		addStackedShareCard(
			body,
			"Students Passing (Assignments)",
			asgNames,
			passCounts,
			participCounts,
			participMax,
		);

		addBarCard(
			body,
			"Average Grades (Assignments)",
			names6,
			py.assignments.map((a) => a.avg_grade ?? 0),
			ACCENT,
			5,
			"dec1",
		);
		const lessonTroubleEntries = py.assignments.filter(
			(a) => a.follow_avg != null,
		);
		if (lessonTroubleEntries.length) {
			const lessonNames = lessonTroubleEntries.map((a) => a.name);
			const copyVals = lessonTroubleEntries.map((a) => {
				const asgn = ASSIGNMENTS.find((x) => x.name === a.name);
				if (!asgn) return 0;
				return _students.filter(
					(s) =>
						!s.excluded &&
						s.lessons[asgn.n - 1]?.follow != null &&
						_tookCode(s.lessons[asgn.n - 1]),
				).length;
			});
			const lessonTotals = lessonTroubleEntries.map((a) => {
				const asgn = ASSIGNMENTS.find((x) => x.name === a.name);
				if (!asgn) return a.n_followed ?? a.n_total ?? 0;
				return _students.filter(
					(s) => !s.excluded && s.lessons[asgn.n - 1]?.follow != null,
				).length;
			});
			addStackedShareCard(
				body,
				"Copying Follow-Along",
				lessonNames,
				copyVals,
				lessonTotals,
				Math.max(...lessonTotals, 1) + 1,
				{ color: THEME.red },
			);
		}

		if (names5.length) {
			const followBox = ASSIGNMENTS.filter((a) => a.follow != null);
			const followNames = followBox.map((a) => a.name);
			const followDists = followBox.map((a) =>
				_students
					.filter((s) => !s.excluded)
					.map((s) => s.lessons[a.n - 1])
					.filter(
						(e) => e.follow != null && (!_hideCopiers || !_tookCode(e)),
					)
					.map((e) => e.follow),
			);
			addBarCard(
				body,
				"Follow Scores",
				followNames,
				followDists.map((d) =>
					d.length ? d.reduce((a, b) => a + b, 0) / d.length : 0,
				),
				ACCENT,
				100,
				"pct",
				null,
				{
					barLabel: (gi) =>
						followDists[gi].length ? `n=${followDists[gi].length}` : "",
				},
			);
			_addDurationBoxCard(
				body,
				"Follow Distribution",
				followBox.map((a) => a.name),
				followDists,
				{
					yMax: 100,
					ticks: [0, 20, 40, 60, 80, 100],
					tickSuffix: "%",
					subLabels: followDists.map((d) => `n=${d.length}`),
				},
			);
		}
	}

	{
		const scatterAssns = ASSIGNMENTS.filter((a) => a.follow != null);
		const nonEmpty = scatterAssns.filter((a) =>
			_students.some(
				(s) =>
					!s.excluded &&
					s.lessons[a.n - 1].follow != null &&
					s.lessons[a.n - 1].grade != null,
			),
		);
		nonEmpty.forEach((a, idx) => {
			const points = _students
				.filter(
					(s) =>
						!s.excluded &&
						s.lessons[a.n - 1].follow != null &&
						s.lessons[a.n - 1].grade != null,
				)
				.map((s) => ({
					x: s.lessons[a.n - 1].follow,
					y: s.lessons[a.n - 1].grade,
					name: studentLabel(s),
					ai: /\bAI\b/i.test(s.lessons[a.n - 1].obs),
					student: s,
					assignment: a,
				}));
			addScatterCard(body, a, points, idx === 0);
		});
	}

	if (py.assignments?.some((a) => a.ai_trouble != null)) {
		const card = mkCard(body, "AI vs Trouble per Assignment", "wide");
		let html =
			'<table class="st-tbl"><tr><th>Assignment</th><th>AI+Trbl</th><th>AI+Pass</th><th>NoAI+Trbl</th><th>NoAI+Pass</th><th>Rate AI</th><th>Rate NoAI</th><th>OR</th><th>p(Fisher)</th></tr>';
		py.assignments.forEach((a) => {
			if (a.ai_trouble == null) return;
			const rAI =
				a.ai_trouble + a.ai_pass > 0
					? a.ai_trouble / (a.ai_trouble + a.ai_pass)
					: null;
			const rNoAI =
				a.no_ai_trouble + a.no_ai_pass > 0
					? a.no_ai_trouble / (a.no_ai_trouble + a.no_ai_pass)
					: null;
			html +=
				`<tr><td>${escHtml(a.name)}</td><td>${a.ai_trouble}</td><td>${a.ai_pass}</td>` +
				`<td>${a.no_ai_trouble}</td><td>${a.no_ai_pass}</td>` +
				`<td>${fmtPct(rAI)}</td><td>${fmtPct(rNoAI)}</td>` +
				`<td>${a.odds_ratio != null ? a.odds_ratio.toFixed(2) + "×" : "—"}</td>` +
				`<td>${a.fisher_p != null ? fmtP(a.fisher_p) : "—"}</td></tr>`;
		});
		card.insertAdjacentHTML("beforeend", html + "</table>");
	}

	if (py.ai_overall) {
		const a = py.ai_overall;
		const card = mkCard(body, "AI vs Trouble — Overall (A1–A5 pooled)", "sm");
		let html = '<table class="st-tbl">';
		[
			["", "Trouble", "Pass"],
			["AI flagged", a.ai_trouble, a.ai_pass],
			["No AI flag", a.no_ai_trouble, a.no_ai_pass],
		].forEach((row, i) => {
			html += `<tr>${row.map((v, j) => (i === 0 || j === 0 ? `<th>${escHtml(String(v))}</th>` : `<td>${fmtN(v)}</td>`)).join("")}</tr>`;
		});
		html += "</table><br>";
		[
			["Trouble rate (AI)", fmtPct(a.trouble_rate_ai)],
			["Trouble rate (no AI)", fmtPct(a.trouble_rate_no_ai)],
			[
				"Odds ratio",
				a.odds_ratio != null ? a.odds_ratio.toFixed(2) + "×" : "—",
			],
			["Fisher p", a.fisher_p != null ? fmtP(a.fisher_p) : "—"],
			["χ²", a.chi2 != null ? a.chi2.toFixed(2) : "—"],
			["χ² p", a.chi2_p != null ? fmtP(a.chi2_p) : "—"],
		].forEach(([k, v]) => {
			html += `<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0;border-bottom:1px solid var(--clr-border-mid)"><span>${escHtml(k)}</span><span>${v}</span></div>`;
		});
		card.insertAdjacentHTML("beforeend", html);
	}

	if (py.assignments?.some((a) => a.traps?.length)) {
		const card = mkCard(body, "Trap Hit Rate per Assignment", "wide");
		let html =
			'<table class="st-tbl"><tr><th>Assignment</th><th>Trap</th><th>Fired</th><th>Valid</th><th>Hit rate</th></tr>';
		py.assignments.forEach((a) => {
			if (!a.traps?.length) return;
			a.traps.forEach((t, i) => {
				html +=
					`<tr><td>${i === 0 ? escHtml(a.name) : ""}</td>` +
					`<td>${escHtml(t.label)}</td><td>${t.n_fired}</td>` +
					`<td>${a.n_trap_valid ?? "—"}</td><td>${fmtPct(t.hit_rate)}</td></tr>`;
			});
			html +=
				`<tr><td></td><td><b>Any trap fired</b></td>` +
				`<td>${a.any_trap_fired ?? "—"}</td><td>${a.n_trap_valid ?? "—"}</td>` +
				`<td><b>${fmtPct(a.any_trap_rate)}</b></td></tr>`;
		});
		card.insertAdjacentHTML("beforeend", html + "</table>");
	}

	if (py.assignments?.some((a) => a.traps?.length)) {
		const card = mkCard(body, "Trap Fired vs Trouble (per trap)", "wide");
		let html =
			'<table class="st-tbl"><tr><th>Assignment</th><th>Trap</th><th>Fire+Trbl</th><th>Fire+OK</th><th>Ok+Trbl</th><th>Ok+OK</th><th>OR</th><th>p(Fisher)</th><th>Grade fired→ok</th></tr>';
		py.assignments.forEach((a) => {
			if (!a.traps?.length) return;
			a.traps.forEach((t, i) => {
				const gradeCell =
					t.fired_avg_grade != null && t.ok_avg_grade != null
						? `${t.fired_avg_grade.toFixed(2)} → ${t.ok_avg_grade.toFixed(2)}`
						: "—";
				html +=
					`<tr><td>${i === 0 ? escHtml(a.name) : ""}</td>` +
					`<td>${escHtml(t.label)}</td>` +
					`<td>${t.fired_trouble}</td><td>${t.fired_ok}</td>` +
					`<td>${t.ok_trouble}</td><td>${t.safe_ok}</td>` +
					`<td>${t.odds_ratio != null ? t.odds_ratio.toFixed(2) + "×" : "—"}</td>` +
					`<td>${t.fisher_p != null ? fmtP(t.fisher_p) : "—"}</td>` +
					`<td>${gradeCell}</td></tr>`;
			});
		});
		card.insertAdjacentHTML("beforeend", html + "</table>");
	}

	if (py.trap_summary) {
		const t = py.trap_summary;
		const card = mkCard(body, "Total Traps Fired (per student)", "sm");
		const gc = t.grade_corr || {};
		const pc = t.participation_corr || {};
		let html = "";
		[
			["Students with decoded OBS", t.n_students ?? "—"],
			[
				"Mean traps fired",
				t.mean_fired != null ? t.mean_fired.toFixed(2) : "—",
			],
			["Max traps fired", t.max_fired ?? "—"],
			[
				"Passed-course mean",
				t.passed_mean != null ? t.passed_mean.toFixed(2) : "—",
			],
			[
				"Failed-course mean",
				t.failed_mean != null ? t.failed_mean.toFixed(2) : "—",
			],
			[
				"Pass/fail Mann-Whitney p",
				t.pass_fail_mannwhitney_p != null
					? fmtP(t.pass_fail_mannwhitney_p)
					: "—",
			],
			[
				`→ Final grade (ρ, n=${gc.n ?? "—"})`,
				`${fmtR(gc.rho)} ${gc.p_rho != null ? "p=" + fmtP(gc.p_rho) : ""}`,
			],
			[
				`→ Participation (ρ, n=${pc.n ?? "—"})`,
				`${fmtR(pc.rho)} ${pc.p_rho != null ? "p=" + fmtP(pc.p_rho) : ""}`,
			],
		].forEach(([k, v]) => {
			html += `<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0;border-bottom:1px solid var(--clr-border-mid)"><span>${escHtml(k)}</span><span>${v}</span></div>`;
		});
		card.insertAdjacentHTML("beforeend", html);
	}

	if (py.follow_vs_grade?.length) {
		const card = mkCard(
			body,
			"Follow Score vs Assignment Grade (per lesson)",
			"sm",
		);
		let html =
			'<table class="st-tbl"><tr><th>Lesson</th><th>r</th><th>ρ</th><th>p(ρ)</th><th>n</th></tr>';
		py.follow_vs_grade.forEach((f) => {
			html += `<tr><td>${escHtml(f.name)}</td><td>${fmtR(f.r)}</td><td>${fmtR(f.rho)}</td><td>${fmtP(f.p_rho)}</td><td>${f.n}</td></tr>`;
		});
		card.insertAdjacentHTML("beforeend", html + "</table>");
	}

	if (py.typing) {
		const t = py.typing;
		const card = mkCard(body, "Typing Speed", "sm");
		let html = '<table class="st-tbl">';
		[
			[
				"Pre-course avg",
				t.pre_avg != null ? t.pre_avg.toFixed(1) + " KPM" : "—",
			],
			[
				"Post-course avg",
				t.post_avg != null ? t.post_avg.toFixed(1) + " KPM" : "—",
			],
			[
				"Improvement avg",
				t.improvement_avg != null
					? (t.improvement_avg > 0 ? "+" : "") +
						t.improvement_avg.toFixed(1) +
						" KPM"
					: "—",
			],
		].forEach(([k, v]) => {
			html += `<tr><td>${escHtml(k)}</td><td>${v}</td></tr>`;
		});
		card.insertAdjacentHTML("beforeend", html + "</table>");
	}

	if (py.self_eval) {
		const se = py.self_eval,
			c = se.corr_grade;
		const card = mkCard(body, "Self-Evaluation", "sm");
		let html = `<table class="st-tbl"><tr><td>Avg self-eval (1–5)</td><td>${se.avg != null ? se.avg.toFixed(2) : "—"}</td></tr>`;
		if (c)
			html +=
				`<tr><td>r vs final grade</td><td>${fmtR(c.r)}</td></tr>` +
				`<tr><td>ρ vs final grade</td><td>${fmtR(c.rho)}</td></tr>` +
				`<tr><td>p(ρ)</td><td>${fmtP(c.p_rho)}</td></tr><tr><td>n</td><td>${c.n}</td></tr>`;
		card.insertAdjacentHTML("beforeend", html + "</table>");
	}

	if (py.correlations?.length) {
		const card = mkCard(body, "Correlation Summary", "mid");
		let html =
			'<table class="st-tbl"><tr><th>Relationship</th><th>r</th><th>ρ</th><th>p(ρ)</th><th>n</th></tr>';
		py.correlations.forEach((c) => {
			html += `<tr><td>${escHtml(c.label)}</td><td>${fmtR(c.r)}</td><td>${fmtR(c.rho)}</td><td>${fmtP(c.p_rho)}</td><td>${c.n}</td></tr>`;
		});
		card.insertAdjacentHTML("beforeend", html + "</table>");
	}

	if (py.engagement?.length) {
		const card = mkCard(body, "Engagement", "sm");
		let html = '<table class="st-tbl">';
		const _engLabel = {
			Answers: "Students answering questions",
			Questions: "Students asking questions",
			Help: "Students accepting help",
		};
		py.engagement.forEach((e) => {
			html += `<tr><td>${escHtml(_engLabel[e.label] ?? e.label)}</td><td>${e.n}</td></tr>`;
		});
		card.insertAdjacentHTML("beforeend", html + "</table>");
	}

	renderCuratedMoments(body);

	if (py.assignments) {
		const aiStrong = py.assignments.map((a) => a.n_ai_strong ?? 0);
		const aiUpper = py.assignments.map(
			(a) => a.n_ai_upper ?? a.n_ai_strong ?? 0,
		);
		const aiTotal = py.assignments.map(
			(a) => a.n_artefact_valid ?? a.n_submitted ?? 0,
		);
		const aiMedium = aiUpper.map((u, i) => Math.max(0, u - aiStrong[i]));
		const aiNone = aiTotal.map((t, i) => Math.max(0, t - aiUpper[i]));
		addAiUseCard(
			body,
			"AI Use (Assignments)",
			py.assignments.map((a) => a.name),
			aiStrong,
			aiMedium,
			aiNone,
			aiTotal,
		);
		addAiBandCard(
			body,
			"AI Use Bounds (Assignments)",
			py.assignments.map((a) => a.name),
			aiStrong,
			aiMedium,
			aiNone,
			aiTotal,
		);
	}

	const _hideCard = (t) =>
		t === "Students Passing (Assignments)" ||
		t === "Average Grades (Assignments)" ||
		t.startsWith("AI vs Trouble") ||
		t.startsWith("Follow Score vs Assignment Grade") ||
		t === "Self-Evaluation" ||
		t === "Correlation Summary";
	body.querySelectorAll(".stat-card").forEach((card) => {
		const h = card.querySelector("h3");
		if (h && _hideCard(h.textContent)) card.remove();
	});

	_refreshChartDownloadBtns();
}
