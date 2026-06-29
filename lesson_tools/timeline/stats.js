"use strict";

function computeSegments(bursts, sessionStart, sessionEnd) {
	const segs = [];
	let cursor = sessionStart;
	for (const b of bursts) {
		if (b.startTs > cursor) segs.push(["p", b.startTs - cursor, 0]);
		segs.push(["t", b.dur, b.tokens]);
		cursor = b.endTs;
	}
	if (sessionEnd > cursor) segs.push(["p", sessionEnd - cursor, 0]);
	return segs;
}

function formatSegments(segs) {
	return segs.map(([k, v, t]) => `${k}:${v.toFixed(2)}:${t}`).join(";");
}

function computePauseStats(pauseDurs) {
	if (!pauseDurs.length) return { count: 0, min: 0, max: 0, avg: 0 };
	let min = Infinity,
		max = -Infinity,
		sum = 0;
	for (const p of pauseDurs) {
		if (p < min) min = p;
		if (p > max) max = p;
		sum += p;
	}
	return { count: pauseDurs.length, min, max, avg: sum / pauseDurs.length };
}

function countDevTokens(p) {
	let text = "";
	for (const e of p.events) {
		if (e.char == null) continue;
		if (e._editor !== "dev") continue;
		if (DELETE_CHARS.has(e.char)) continue;
		text += e.char;
	}
	let n = 0;
	const re = newTokenRegex();
	while (re.exec(text) !== null) n++;
	return n;
}

function buildLessonStatsCsv(p, tokens) {
	const segments = computeSegments(p.bursts, p.sessionStart, p.sessionEnd);
	const pause = computePauseStats(
		segments.filter(([k]) => k === "p").map(([, v]) => v),
	);
	const duration = (p.sessionEnd - p.sessionStart) / 60;
	const codingMin = p.bursts.reduce((s, b) => s + (b.dur || 0), 0) / 60;
	const moves = p.moves.length;
	const anchors = p.anchors.length;
	const jumps = moves + anchors;
	const jumpsPer100c = p.totalChars > 0 ? (jumps / p.totalChars) * 100 : 0;
	const tk = tokens || { total: 0, html: 0, css: 0, js: 0, py: 0, comment: 0 };
	const devTokens = countDevTokens(p);

	const cols = [
		["duration_min", duration.toFixed(2)],
		["coding_min", codingMin.toFixed(2)],
		["events", p.eventCount],
		["chars", p.totalChars],
		["dev_chars", p.devChars.length],
		["code_inserts", p.codeInserts.length],
		["deletes", p.deletes.length],
		["move_to", moves],
		["anchors", anchors],
		["jumps", jumps],
		["jumps_per_100c", jumpsPer100c.toFixed(2)],
		["kpm_active", p.activeRate.toFixed(1)],
		["kpm_session", p.sessionRate.toFixed(1)],
		["bursts", p.bursts.length],
		["pause_count", pause.count],
		["pause_min_s", pause.min === Infinity ? 0 : pause.min.toFixed(2)],
		["pause_max_s", pause.max === -Infinity ? 0 : pause.max.toFixed(2)],
		["pause_avg_s", pause.avg.toFixed(2)],
		["teacher_q", p.interactions["teacher-question"].length],
		[
			"teacher_q_unanswered",
			p.interactions["teacher-question"].filter(
				(q) => !(q.answered_by && q.answered_by.length),
			).length,
		],
		["student_q", p.interactions["student-question"].length],
		["help", p.interactions["providing-help"].length],
		["tokens", tk.total],
		["tokens_html", tk.html],
		["tokens_css", tk.css],
		["tokens_js", tk.js],
		["tokens_py", tk.py],
		["tokens_comment", tk.comment ?? 0],
		["tokens_dev", devTokens],
		["segments", formatSegments(segments)],
	];

	const header = cols.map((c) => c[0]).join(",");
	const row = cols.map((c) => c[1]).join(",");
	return header + "\n" + row + "\n";
}
