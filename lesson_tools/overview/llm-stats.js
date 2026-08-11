"use strict";

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
			mode: basisToDiffMode(_activeBasis),
		});
		return `<a href="${url}" target="_blank" class="id-chip">${escHtml(sid)}</a>`;
	});
	if (more > 0) parts.push(`<span class="id-chip-more">+${more}</span>`);
	return parts.join(" ");
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
			"<i>Reached</i> = a student whose underlying trap " +
			"<i>did not</i> fire (polarity <code>not_fired</code>) or " +
			"<i>did</i> fire (polarity <code>fired</code>). Click a " +
			"missed-id chip to inspect that student's submission.</div>",
	);
	const tbl = new StatTable(["Assignment", "Moment", "Reached", "Missed by"]);
	groups.forEach((g) => {
		g.moments.forEach((m, i) => {
			const reached =
				`${m.n_reached}/${m.n_valid}` +
				` <span style='color:var(--clr-muted)'>` +
				`(${m.n_valid ? ((m.n_reached / m.n_valid) * 100).toFixed(0) + "%" : "—"})</span>`;
			const chips = _idChips(m.missed_ids, 12, g.assignment);
			tbl.row([
				i === 0 ? escHtml(g.name) : "",
				escHtml(m.label),
				reached,
				chips,
			]);
		});
	});
	card.insertAdjacentHTML("beforeend", tbl.html());
}
