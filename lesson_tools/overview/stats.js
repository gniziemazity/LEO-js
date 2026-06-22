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
				{ color: THEME.red, titleColor: THEME.red },
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
					subLabels: followDists.map((d) =>
						d.length ? `n=${d.length}` : "",
					),
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
			addScatterCard(body, a, points);
		});
	}

	if (py.assignments?.some((a) => a.ai_trouble != null)) {
		const card = mkCard(body, "AI vs Trouble per Assignment", "wide");
		const tbl = new StatTable([
			"Assignment",
			"AI+Trbl",
			"AI+Pass",
			"NoAI+Trbl",
			"NoAI+Pass",
			"Rate AI",
			"Rate NoAI",
			"OR",
			"p(Fisher)",
		]);
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
			tbl.row([
				escHtml(a.name),
				a.ai_trouble,
				a.ai_pass,
				a.no_ai_trouble,
				a.no_ai_pass,
				fmtPct(rAI),
				fmtPct(rNoAI),
				a.odds_ratio != null ? a.odds_ratio.toFixed(2) + "×" : "—",
				a.fisher_p != null ? fmtP(a.fisher_p) : "—",
			]);
		});
		card.insertAdjacentHTML("beforeend", tbl.html());
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
		html += new KvList()
			.addAll([
				["Trouble rate (AI)", fmtPct(a.trouble_rate_ai)],
				["Trouble rate (no AI)", fmtPct(a.trouble_rate_no_ai)],
				[
					"Odds ratio",
					a.odds_ratio != null ? a.odds_ratio.toFixed(2) + "×" : "—",
				],
				["Fisher p", a.fisher_p != null ? fmtP(a.fisher_p) : "—"],
				["χ²", a.chi2 != null ? a.chi2.toFixed(2) : "—"],
				["χ² p", a.chi2_p != null ? fmtP(a.chi2_p) : "—"],
			])
			.html();
		card.insertAdjacentHTML("beforeend", html);
	}

	if (py.assignments?.some((a) => a.traps?.length)) {
		const card = mkCard(body, "Trap Hit Rate per Assignment", "wide");
		const tbl = new StatTable([
			"Assignment",
			"Trap",
			"Fired",
			"Valid",
			"Hit rate",
		]);
		py.assignments.forEach((a) => {
			if (!a.traps?.length) return;
			a.traps.forEach((t, i) => {
				tbl.row([
					i === 0 ? escHtml(a.name) : "",
					escHtml(t.label),
					t.n_fired,
					a.n_trap_valid ?? "—",
					fmtPct(t.hit_rate),
				]);
			});
			tbl.row([
				"",
				"<b>Any trap fired</b>",
				a.any_trap_fired ?? "—",
				a.n_trap_valid ?? "—",
				`<b>${fmtPct(a.any_trap_rate)}</b>`,
			]);
		});
		card.insertAdjacentHTML("beforeend", tbl.html());
	}

	if (py.assignments?.some((a) => a.traps?.length)) {
		const card = mkCard(body, "Trap Fired vs Trouble (per trap)", "wide");
		const tbl = new StatTable([
			"Assignment",
			"Trap",
			"Fire+Trbl",
			"Fire+OK",
			"Ok+Trbl",
			"Ok+OK",
			"OR",
			"p(Fisher)",
			"Grade fired→ok",
		]);
		py.assignments.forEach((a) => {
			if (!a.traps?.length) return;
			a.traps.forEach((t, i) => {
				const gradeCell =
					t.fired_avg_grade != null && t.ok_avg_grade != null
						? `${t.fired_avg_grade.toFixed(2)} → ${t.ok_avg_grade.toFixed(2)}`
						: "—";
				tbl.row([
					i === 0 ? escHtml(a.name) : "",
					escHtml(t.label),
					t.fired_trouble,
					t.fired_ok,
					t.ok_trouble,
					t.safe_ok,
					t.odds_ratio != null ? t.odds_ratio.toFixed(2) + "×" : "—",
					t.fisher_p != null ? fmtP(t.fisher_p) : "—",
					gradeCell,
				]);
			});
		});
		card.insertAdjacentHTML("beforeend", tbl.html());
	}

	if (py.trap_summary) {
		const t = py.trap_summary;
		const card = mkCard(body, "Total Traps Fired (per student)", "sm");
		const gc = t.grade_corr || {};
		const pc = t.participation_corr || {};
		const html = new KvList()
			.addAll([
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
			])
			.html();
		card.insertAdjacentHTML("beforeend", html);
	}

	if (py.follow_vs_grade?.length) {
		const card = mkCard(
			body,
			"Follow Score vs Assignment Grade (per lesson)",
			"sm",
		);
		const tbl = new StatTable(["Lesson", "r", "ρ", "p(ρ)", "n"]);
		py.follow_vs_grade.forEach((f) => {
			tbl.row([escHtml(f.name), fmtR(f.r), fmtR(f.rho), fmtP(f.p_rho), f.n]);
		});
		card.insertAdjacentHTML("beforeend", tbl.html());
	}

	if (py.typing) {
		const t = py.typing;
		const card = mkCard(body, "Typing Speed", "sm");
		const tbl = new StatTable();
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
			tbl.row([escHtml(k), v]);
		});
		card.insertAdjacentHTML("beforeend", tbl.html());
	}

	if (py.self_eval) {
		const se = py.self_eval,
			c = se.corr_grade;
		const card = mkCard(body, "Self-Evaluation", "sm");
		const tbl = new StatTable();
		tbl.row([
			"Avg self-eval (1–5)",
			se.avg != null ? se.avg.toFixed(2) : "—",
		]);
		if (c) {
			tbl.row(["r vs final grade", fmtR(c.r)]);
			tbl.row(["ρ vs final grade", fmtR(c.rho)]);
			tbl.row(["p(ρ)", fmtP(c.p_rho)]);
			tbl.row(["n", c.n]);
		}
		card.insertAdjacentHTML("beforeend", tbl.html());
	}

	if (py.correlations?.length) {
		const card = mkCard(body, "Correlation Summary", "mid");
		const tbl = new StatTable(["Relationship", "r", "ρ", "p(ρ)", "n"]);
		py.correlations.forEach((c) => {
			tbl.row([
				escHtml(c.label),
				fmtR(c.r),
				fmtR(c.rho),
				fmtP(c.p_rho),
				c.n,
			]);
		});
		card.insertAdjacentHTML("beforeend", tbl.html());
	}

	if (py.engagement?.length) {
		const card = mkCard(body, "Engagement", "sm");
		const _engLabel = {
			Answers: "Students answering questions",
			Questions: "Students asking questions",
			Help: "Students accepting help",
		};
		const tbl = new StatTable();
		py.engagement.forEach((e) => {
			tbl.row([escHtml(_engLabel[e.label] ?? e.label), e.n]);
		});
		card.insertAdjacentHTML("beforeend", tbl.html());
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
			"AI Use",
			py.assignments.map((a) => a.name),
			aiStrong,
			aiMedium,
			aiNone,
			aiTotal,
		);
		addAiBandCard(
			body,
			"AI Use Bounds",
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
