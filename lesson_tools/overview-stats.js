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

		if (names5.length)
			addBarCard(
				body,
				"Follow Scores (Lessons)",
				names5,
				py.assignments
					.filter((a) => a.follow_avg != null)
					.map((a) => a.follow_avg),
				ACCENT,
				100,
				"pct",
			);

		const submittedAssn = py.assignments.map((a) => a.n_submitted ?? 0);
		const names6 = py.assignments.map((a) => a.name);
		const aiAssn = py.assignments.map((a) => a.n_ai_high ?? a.n_ai ?? 0);
		addStackedShareCard(
			body,
			"AI Use (Assignments)",
			names6,
			aiAssn,
			submittedAssn,
			Math.max(...submittedAssn, 1) + 1,
		);
	}

	if (py.assignments?.some((a) => a.artefacts?.length)) {
		const card = mkCard(body, "Artefact Hit Rate per Assignment", "wide");
		const sideBySide = el("div", "artefact-rate-grid");
		sideBySide.style.cssText =
			"display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start";
		card.appendChild(sideBySide);
		const leftBox = el("div");
		const rightBox = el("div");
		sideBySide.appendChild(leftBox);
		sideBySide.appendChild(rightBox);
		let hL =
			'<table class="st-tbl artefact-rate-tbl"><tr><th>Assignment</th>' +
			"<th>Artefact</th><th>Sev</th><th>Stu fired</th><th>Stu rate</th>" +
			"<th>LLM rate</th></tr>";
		let hR =
			'<table class="st-tbl artefact-rate-tbl"><tr><th>Assignment</th>' +
			"<th>Artefact</th><th>Fire+Trbl</th><th>Fire+OK</th>" +
			"<th>OR</th><th>p(Fisher)</th><th>Grade f→o</th></tr>";
		const sevHtml = (sev) => {
			if (!sev) return "";
			const cls =
				sev === "high" ? "sev-high" : sev === "low" ? "sev-low" : "sev-med";
			return `<span class="sev-pill ${cls}">${sev[0].toUpperCase()}</span>`;
		};
		py.assignments.forEach((a, ai) => {
			if (!a.artefacts?.length) return;
			let maxRate = 0;
			a.artefacts.forEach((t) => {
				if ((t.hit_rate ?? 0) > maxRate) maxRate = t.hit_rate ?? 0;
			});
			const sepClass = ai > 0 ? " assn-sep" : "";
			a.artefacts.forEach((t, i) => {
				const isMax = (t.hit_rate ?? 0) === maxRate && maxRate > 0;
				const trClass = (i === 0 ? sepClass : "").trim();
				const trAttr = trClass ? ` class="${trClass}"` : "";
				const bo = isMax ? "<b>" : "";
				const bc = isMax ? "</b>" : "";
				const assnCell = i === 0 ? escHtml(a.name) : "";
				const stuRate = fmtPct(t.hit_rate);
				const llmRate =
					t.llm_hit_rate != null
						? `${fmtPct(t.llm_hit_rate)} <span style="color:var(--clr-muted);font-size:10px">(${t.llm_n_fired ?? "?"}/${t.llm_n_answered ?? "?"})</span>`
						: '<span style="color:var(--clr-muted)">—</span>';
				hL +=
					`<tr${trAttr}><td>${assnCell}</td>` +
					`<td>${bo}${escHtml(t.label)}${bc}</td>` +
					`<td>${sevHtml(t.severity)}</td>` +
					`<td>${bo}${t.n_fired}${bc}</td>` +
					`<td>${bo}${stuRate}${bc}</td>` +
					`<td>${llmRate}</td></tr>`;
				const gradeCell =
					t.fired_avg_grade != null && t.ok_avg_grade != null
						? `${t.fired_avg_grade.toFixed(2)} → ${t.ok_avg_grade.toFixed(2)}`
						: "—";
				hR +=
					`<tr${trAttr}><td>${assnCell}</td>` +
					`<td>${bo}${escHtml(t.label)}${bc}</td>` +
					`<td>${t.fired_trouble}</td>` +
					`<td>${t.fired_ok}</td>` +
					`<td>${t.odds_ratio != null ? t.odds_ratio.toFixed(2) + "×" : "—"}</td>` +
					`<td>${t.fisher_p != null ? fmtP(t.fisher_p) : "—"}</td>` +
					`<td>${gradeCell}</td></tr>`;
			});
		});
		leftBox.insertAdjacentHTML("beforeend", hL + "</table>");
		rightBox.insertAdjacentHTML("beforeend", hR + "</table>");
	}

	if (py.artefact_summary) {
		const t = py.artefact_summary;
		const card = mkCard(body, "Total Artefacts Fired (per student)", "sm");
		const gc = t.grade_corr || {};
		const pc = t.participation_corr || {};
		let html = "";
		[
			["Students with decoded OBS", t.n_students ?? "—"],
			[
				"Mean artefacts fired",
				t.mean_fired != null ? t.mean_fired.toFixed(2) : "—",
			],
			["Max artefacts fired", t.max_fired ?? "—"],
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
			// Extra engagement correlations added 2026-05.
			...[
				["Self-evaluation", t.self_eval_corr],
				["Questions asked", t.questions_corr],
				["Answers given", t.answers_corr],
				["Help received", t.help_corr],
				["Kahoot", t.kahoot_corr],
				["Final quiz (Știi)", t.quiz_stii_corr],
			]
				.filter(([, corr]) => corr)
				.map(([lbl, corr]) => [
					`→ ${lbl} (ρ, n=${corr.n ?? "—"})`,
					`${fmtR(corr.rho)} ${corr.p_rho != null ? "p=" + fmtP(corr.p_rho) : ""}`,
				]),
		].forEach(([k, v]) => {
			html += `<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0;border-bottom:1px solid var(--clr-border-mid)"><span>${escHtml(k)}</span><span>${v}</span></div>`;
		});
		card.insertAdjacentHTML("beforeend", html);
	}

	if (py.artefact_summary?.per_artefact_engagement?.length) {
		const card = mkCard(
			body,
			"Artefact firing × Engagement (per artefact)",
			"wide",
		);
		card.insertAdjacentHTML(
			"beforeend",
			'<div style="font-size:11px;color:var(--clr-muted);margin-bottom:6px">' +
				"Spearman ρ between firing the artefact (0/1) and the engagement " +
				"metric. Negative ρ on participation/self-eval = artefact fires " +
				"more often on less-engaged students. <i>*</i> = p &lt; 0.05.</div>",
		);
		const sevHtml = (sev) => {
			if (!sev) return "";
			const cls =
				sev === "high" ? "sev-high" : sev === "low" ? "sev-low" : "sev-med";
			return ` <span class="sev-pill ${cls}">${sev[0].toUpperCase()}</span>`;
		};
		let html2 =
			'<table class="st-tbl"><tr><th>Assignment</th><th>Artefact</th>' +
			"<th>n fired</th><th>Participation</th><th>Self-eval</th>" +
			"<th>Questions</th><th>Answers</th><th>Help</th></tr>";
		let lastAssn = "";
		py.artefact_summary.per_artefact_engagement.forEach((p) => {
			const assnCell =
				p.assignment !== lastAssn
					? escHtml(p.assn_name || p.assignment)
					: "";
			const trAttr =
				p.assignment !== lastAssn && lastAssn !== ""
					? ' class="assn-sep"'
					: "";
			lastAssn = p.assignment;
			const c = (k) => {
				const v = p[`${k}_corr`];
				if (!v) return "—";
				return `${fmtR(v.rho)}${v.p_rho != null && v.p_rho < 0.05 ? " *" : ""}`;
			};
			html2 +=
				`<tr${trAttr}><td>${assnCell}</td>` +
				`<td>${escHtml(p.label)}${sevHtml(p.severity)}</td>` +
				`<td>${p.n_fired}</td>` +
				`<td>${c("participation")}</td>` +
				`<td>${c("self_eval")}</td>` +
				`<td>${c("questions")}</td>` +
				`<td>${c("answers")}</td>` +
				`<td>${c("help")}</td></tr>`;
		});
		card.insertAdjacentHTML("beforeend", html2 + "</table>");
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
			[
				"Passed pre avg",
				t.passed_pre_avg != null
					? t.passed_pre_avg.toFixed(1) + " KPM"
					: "—",
			],
			[
				"Failed pre avg",
				t.failed_pre_avg != null
					? t.failed_pre_avg.toFixed(1) + " KPM"
					: "—",
			],
			[
				"Pass/fail MW p",
				t.pass_fail_mannwhitney_p != null
					? fmtP(t.pass_fail_mannwhitney_p)
					: "—",
			],
		].forEach(([k, v]) => {
			html += `<tr><td>${escHtml(k)}</td><td>${v}</td></tr>`;
		});
		html +=
			'</table><br><table class="st-tbl"><tr><th>Correlation</th><th>r</th><th>ρ</th><th>p(ρ)</th></tr>';
		[
			["Pre KPM → Final", t.corr_pre_grade],
			["Post KPM → Final", t.corr_post_grade],
			["Improvement → Final", t.corr_improvement_grade],
		].forEach(([label, c]) => {
			if (!c) return;
			html += `<tr><td>${escHtml(label)}</td><td>${fmtR(c.r)}</td><td>${fmtR(c.rho)}</td><td>${fmtP(c.p_rho)}</td></tr>`;
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
		const card = mkCard(
			body,
			"Engagement (Answers / Questions / Help)",
			"sm",
		);
		let html =
			'<table class="st-tbl"><tr><th>Type</th><th>n</th><th>Pass rate</th></tr>';
		py.engagement.forEach((e) => {
			html += `<tr><td>${escHtml(e.label)}</td><td>${e.n}</td><td>${fmtPct(e.pass_rate)}</td></tr>`;
		});
		card.insertAdjacentHTML("beforeend", html + "</table>");
	}

	renderCofiringMatrix(body);
	renderCuratedMoments(body);

	_renderEndOfPageCards(body, py, fmtP, fmtPct, fmtR, ACCENT);
}

function _renderEndOfPageCards(body, py, fmtP, fmtPct, fmtR, ACCENT) {
	if (py.assignments) {
		const names6 = py.assignments.map((a) => a.name);
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
			const lessonTroubleVals = lessonTroubleEntries.map(
				(a) => a.n_lesson_trouble ?? 0,
			);
			const lessonTotals = lessonTroubleEntries.map(
				(a) => a.n_followed ?? a.n_total ?? 0,
			);
			const lessonTroubleNames = lessonTroubleEntries.map((a) => a.name);
			addStackedShareCard(
				body,
				"Trouble (Lessons)",
				lessonTroubleNames,
				lessonTroubleVals,
				lessonTotals,
				Math.max(...lessonTotals, 1) + 1,
			);
		}
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

	const cohort = _students.filter((s) => !s.excluded);
	const scatterAssns = ASSIGNMENTS.filter((a) => a.follow != null);
	const nonEmpty = scatterAssns.filter((a) =>
		cohort.some(
			(s) =>
				s.lessons[a.n - 1].follow != null &&
				s.lessons[a.n - 1].grade != null,
		),
	);
	if (nonEmpty.length) {
		const divider = el("div", "stats-section-divider");
		divider.style.cssText =
			"grid-column:1/-1;border-top:1px solid var(--clr-border-mid);margin:18px 0 4px;";
		body.appendChild(divider);
		nonEmpty.forEach((a, idx) => {
			const points = cohort
				.filter(
					(s) =>
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
}

function _idChips(ids, max, assignmentLower) {
	const total = ids?.length ?? 0;
	if (!total) return "<span style='color:var(--clr-muted)'>—</span>";
	const shown = ids.slice(0, max);
	const more = total - shown.length;
	const parts = shown.map((sid) => {
		const url = buildToolUrl("differentiator.html", {
			lesson: assignmentLower,
			group: "assignments",
			id: sid,
		});
		return `<a href="${url}" target="_blank" class="id-chip">${escHtml(sid)}</a>`;
	});
	if (more > 0) parts.push(`<span class="id-chip-more">+${more}</span>`);
	return parts.join(" ");
}

function renderCofiringMatrix(body) {
	const pairs = _pyStats?.cofiring;
	if (!pairs?.length) return;
	const minN = 3;
	const filtered = pairs.filter((p) => p.n_xy >= minN);
	if (!filtered.length) return;
	const card = mkCard(
		body,
		`Co-firing within an Assignment (n ≥ ${minN})`,
		"wide",
	);
	card.insertAdjacentHTML(
		"beforeend",
		'<div style="font-size:11px;color:var(--clr-muted);margin-bottom:6px">' +
			"For every mark (X) on each assignment we list every other " +
			"mark (Y) on the same assignment that co-fires with it. " +
			"<i>Lift = P(Y | X) / P(Y)</i>; a lift far from 1 means the " +
			"two marks are not independent. Lift is asymmetric, so " +
			"(X→Y) and (Y→X) both appear. Click a student-ID chip to " +
			"open that submission in the differentiator. Computed on " +
			"the student subset only.</div>",
	);
	filtered.sort((a, b) => {
		if (a.assignment !== b.assignment)
			return a.assignment.localeCompare(b.assignment);
		if (a.x_key !== b.x_key) return a.x_key.localeCompare(b.x_key);
		return (b.lift ?? 0) - (a.lift ?? 0);
	});
	// Group rows by assignment (with separators) and by X within each.
	// Render bold for the maximum-lift row in each X-group.
	const byAssn = new Map();
	filtered.forEach((p) => {
		if (!byAssn.has(p.assignment))
			byAssn.set(p.assignment, {
				name: p.assn_name || p.assignment,
				groups: new Map(),
			});
		const a = byAssn.get(p.assignment);
		if (!a.groups.has(p.x_key)) a.groups.set(p.x_key, []);
		a.groups.get(p.x_key).push(p);
	});
	const sevHtml = (sev) => {
		if (!sev) return "";
		const cls =
			sev === "high" ? "sev-high" : sev === "low" ? "sev-low" : "sev-med";
		return ` <span class="sev-pill ${cls}">${sev[0].toUpperCase()}</span>`;
	};
	let html =
		'<table class="st-tbl"><tr><th>Assignment</th><th>X (mark)</th>' +
		"<th>Y (co-mark)</th><th>P(Y|X)</th><th>P(Y)</th><th>Lift</th>" +
		"<th>n_xy / n_x</th><th>Joint firers</th></tr>";
	let firstAssnSeen = false;
	byAssn.forEach((aGroup, assnLower) => {
		const assnSep = firstAssnSeen ? ' class="assn-sep"' : "";
		firstAssnSeen = true;
		let firstRowOfAssn = true;
		aGroup.groups.forEach((rows, xKey) => {
			let maxLift = 0;
			rows.forEach((r) => {
				if ((r.lift ?? 0) > maxLift) maxLift = r.lift ?? 0;
			});
			let firstRowOfX = true;
			rows.forEach((p) => {
				const isMax = (p.lift ?? 0) === maxLift && maxLift > 0;
				const bo = isMax ? "<b>" : "";
				const bc = isMax ? "</b>" : "";
				const pyx =
					p.p_y_given_x != null
						? (p.p_y_given_x * 100).toFixed(0) + "%"
						: "—";
				const py = p.p_y != null ? (p.p_y * 100).toFixed(0) + "%" : "—";
				const liftStr = p.lift != null ? p.lift.toFixed(2) + "×" : "—";
				const chips = _idChips(p.joint_ids, 8, p.assignment);
				const trAttr = firstRowOfAssn ? assnSep : "";
				const xLabelCell = firstRowOfX
					? escHtml(p.x_label) + sevHtml(p.x_severity)
					: "";
				html +=
					`<tr${trAttr}><td>${firstRowOfAssn ? escHtml(aGroup.name) : ""}</td>` +
					`<td>${xLabelCell}</td>` +
					`<td>${bo}${escHtml(p.y_label)}${bc}${sevHtml(p.y_severity)}</td>` +
					`<td>${pyx}</td><td>${py}</td>` +
					`<td>${bo}${liftStr}${bc}</td>` +
					`<td>${p.n_xy} / ${p.n_x}</td>` +
					`<td>${chips}</td></tr>`;
				firstRowOfAssn = false;
				firstRowOfX = false;
			});
		});
	});
	card.insertAdjacentHTML("beforeend", html + "</table>");
}

function renderCuratedMoments(body) {
	const groups = _pyStats?.curated_moments;
	if (!groups?.length) return;
	const card = mkCard(
		body,
		"Curated Learning Moments — Reached vs Missed",
		"wide",
	);
	card.insertAdjacentHTML(
		"beforeend",
		'<div style="font-size:11px;color:var(--clr-muted);margin-bottom:6px">' +
			"Per-assignment teacher-defined moments " +
			"(<code>assignments/&lt;a&gt;/curated_moments.csv</code>). " +
			"<i>Reached</i> = a student whose underlying artefact " +
			"<i>did not</i> fire (polarity <code>not_fired</code>) or " +
			"<i>did</i> fire (polarity <code>fired</code>). Click a " +
			"missed-id chip to inspect that student's submission.</div>",
	);
	let html =
		'<table class="st-tbl"><tr><th>Assignment</th><th>Moment</th>' +
		"<th>Reached</th><th>Missed by</th></tr>";
	groups.forEach((g) => {
		g.moments.forEach((m, i) => {
			const reached =
				`${m.n_reached}/${m.n_valid}` +
				` <span style='color:var(--clr-muted)'>` +
				`(${m.n_valid ? ((m.n_reached / m.n_valid) * 100).toFixed(0) + "%" : "—"})</span>`;
			const chips = _idChips(m.missed_ids, 12, g.assignment);
			html +=
				`<tr><td>${i === 0 ? escHtml(g.name) : ""}</td>` +
				`<td>${escHtml(m.label)}</td>` +
				`<td>${reached}</td><td>${chips}</td></tr>`;
		});
	});
	card.insertAdjacentHTML("beforeend", html + "</table>");
}

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
	if (anyPos(tHtml) || anyPos(tCss) || anyPos(tJs)) {
		const card = mkCard(body, "Tokens per Lesson");
		const box = el("div", "chart-box");
		card.appendChild(box);
		const totals = lessonNames.map(
			(_, i) => (tHtml[i] ?? 0) + (tCss[i] ?? 0) + (tJs[i] ?? 0),
		);
		const stackNames = ["HTML", "CSS", "JS"];
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
		];
		const stackData = [tHtml, tCss, tJs];
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
			"Typing Time (min)",
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
			"Typing Pause Duration (min)",
			lessonNames,
			segmentsByLesson.map((segs) =>
				segs.filter((s) => s.kind === "p").map((s) => s.dur / 60),
			),
		);
	}

	const pauseCnt = numFor("pause_count");
	if (anyPos(pauseCnt)) {
		addBarCard(
			body,
			"Typing Pause Count",
			lessonNames,
			pauseCnt.map((v) => v ?? 0),
			THEME.label,
			Math.max(...pauseCnt.filter((v) => v != null), 1) + 1,
			"int",
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

function renderLessonStatsTable(body) {
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
	const cols = ls.header.filter(
		(h) => h && h !== "Lesson" && h !== "Source" && h !== "segments",
	);
	const tableCard = mkCard(body, "Lesson Stats (Teacher Keylog)", "wide");
	const fmtVal = (v) => {
		if (v == null || v === "") return "—";
		if (typeof v === "number") {
			return Number.isInteger(v) ? String(v) : v.toFixed(2);
		}
		const n = +v;
		if (!isNaN(n) && String(n) === String(v).trim()) return String(n);
		return escHtml(String(v));
	};
	let tableHtml =
		'<div style="overflow-x:auto"><table class="st-tbl"><tr><th>Stat</th>' +
		lessonNames.map((n) => `<th>${escHtml(String(n))}</th>`).join("") +
		"</tr>";
	cols.forEach((stat) => {
		tableHtml +=
			`<tr><td>${escHtml(stat)}</td>` +
			orderedRows.map((r) => `<td>${fmtVal(r[stat])}</td>`).join("") +
			"</tr>";
	});
	tableCard.insertAdjacentHTML("beforeend", tableHtml + "</table></div>");
}

function addStackedShareCard(
	parent,
	title,
	labels,
	subsetCounts,
	totalCounts,
	yMax,
) {
	const card = mkCard(parent, title);
	const box = el("div", "chart-box");
	card.appendChild(box);
	const restCounts = totalCounts.map((t, i) => t - subsetCounts[i]);
	const chart = new BarChart(box, {
		yMin: 0,
		yMax: yMax ?? Math.max(...totalCounts, 1) + 1,
		stacked: true,
		tooltipCallback: (_label, _val, _si, gi) => [
			`${subsetCounts[gi]} / ${totalCounts[gi]}`,
		],
		barLabel: (gi, si) => {
			if (si !== 0) return null;
			const tot = totalCounts[gi];
			if (!tot) return null;
			return Math.round((subsetCounts[gi] / tot) * 100) + "%";
		},
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
	if (isFirst) {
		const h = card.querySelector("h3");
		h.insertAdjacentHTML(
			"beforeend",
			`<span style="margin-left:6px;font-size:11px;color:${THEME.textStrong}">●</span>` +
				`<span style="font-size:9px;color:${THEME.muted};font-weight:400;text-transform:none;letter-spacing:0"> No AI &nbsp;</span>` +
				`<span style="font-size:11px;color:${THEME.red}">●</span>` +
				`<span style="font-size:9px;color:${THEME.muted};font-weight:400;text-transform:none;letter-spacing:0"> AI</span>`,
		);
	}
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
