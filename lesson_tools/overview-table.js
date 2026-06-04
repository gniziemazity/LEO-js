"use strict";

function renderTable() {
	const table = document.getElementById("grades-table");
	table.innerHTML = "";
	table.classList.remove("anon-name", "anon-id");
	if (_anonMode === "name") table.classList.add("anon-name");
	else if (_anonMode === "id") table.classList.add("anon-id");

	const thead = document.createElement("thead");
	const r1 = document.createElement("tr");
	const r2 = document.createElement("tr");

	const mkBase = (cls) => {
		const th = document.createElement("th");
		th.className = "grp" + (cls ? " " + cls : "");
		r1.appendChild(th);
	};
	mkBase("col-id sticky-l");
	mkBase("col-name sticky-l");
	mkBase("col-num sticky-l");
	mkBase();
	mkBase();

	const grp = (label, colspan, sep = false) => {
		const th = document.createElement("th");
		th.textContent = label;
		th.colSpan = colspan;
		th.className = "grp";
		if (sep) th.classList.add("asn-sep");
		r1.appendChild(th);
		return th;
	};
	const col = (label, cls = "", sep = false) => {
		const th = document.createElement("th");
		th.textContent = label;
		if (cls) th.className = cls;
		if (sep) th.classList.add("asn-sep");
		r2.appendChild(th);
		return th;
	};

	col("ID", "col-id sticky-l");
	col("Name", "col-name sticky-l");
	col("#", "col-num sticky-l");
	col("KPM");
	col("Self");

	for (const a of ASSIGNMENTS) {
		if (a.follow != null) {
			_attachStudentsLink(
				grp(`${a.name} Lesson`, 2, true),
				a.name,
				"lessons",
			);
			_attachStudentsLink(
				grp(`${a.name} Assignment`, 3, false),
				a.name,
				"assignments",
			);
			_attachTimelineLink(col("Follow%", "lhd", true), a.name);
			col("Obs", "lhd");
			col("Grade", "ahd");
			col("Status", "ahd");
			col("Obs", "ahd");
		} else {
			_attachStudentsLink(
				grp(`${a.name} Assignment`, 3, true),
				a.name,
				"assignments",
			);
			col("Grade", "ahd", true);
			col("Status", "ahd");
			col("Obs", "ahd");
		}
	}
	grp("", 8, true);
	col("Quiz", "", true);
	col("KPM");
	col("Avg");
	col("Part%");
	col("Ans");
	col("Qs");
	col("Help");
	col("Comments");

	thead.appendChild(r1);
	thead.appendChild(r2);
	table.appendChild(thead);

	const cdiffMin = Math.min(0, ..._students.map((s) => s.total_cdiff ?? 0));
	const cdiffMax = Math.max(0, ..._students.map((s) => s.total_cdiff ?? 0));

	const tbody = document.createElement("tbody");
	const rows = _hideExcluded
		? _students.filter((s) => !s.excluded || s.ai_flagged)
		: _students;
	rows.forEach((s) => {
		const tr = document.createElement("tr");
		tr.classList.add(s.passed_course ? "row-pass" : "row-fail");
		if (s.excluded) tr.classList.add("row-excluded");
		if (s.ai_flagged) tr.classList.add("row-ai");

		const cell = (content, cls = "") => {
			const td = document.createElement("td");
			if (cls) td.className = cls;
			td.textContent = content ?? "";
			return td;
		};
		const obsCell = (entry, cls = "") => {
			const td = document.createElement("td");
			if (cls) td.className = cls;
			const schema = _artefactSchema[(entry.name || "").toLowerCase()];
			const badges = renderArtefactBadges(entry.obs, schema);
			if (badges) {
				td.innerHTML = badges;
				const tipHtml = buildArtefactSummaryHtml(entry.obs, schema);
				if (tipHtml) attachHtmlTip(td, tipHtml);
			} else {
				td.textContent = obsText(entry.obs);
			}
			return td;
		};

		tr.appendChild(cell(s.id, "id-cell col-id sticky-l"));
		tr.appendChild(cell(studentLabel(s), "name-cell col-name sticky-l"));
		tr.appendChild(cell(s.number, "num col-num sticky-l"));
		tr.appendChild(cell(fmtN(s.pre_typing), "num"));
		tr.appendChild(cell(fmtN(s.self_eval), "num"));

		const makeLessonClickable = (td, entry) => {
			td.classList.add("clickable");
			td.addEventListener("click", () => openLessonDiff(s, entry));
		};
		const makeAssignClickable = (td, entry) => {
			td.classList.add("clickable");
			td.addEventListener("click", () => openAssignDiff(s, entry));
		};

		for (const entry of s.lessons) {
			if (entry.hasFollowCol) {
				const fc = document.createElement("td");
				fc.className = "follow asn-sep";
				if (entry.follow != null) {
					fc.textContent = entry.follow.toFixed(0) + "%";
					fc.style.color = followFg(entry.follow);
				}
				makeLessonClickable(fc, entry);
				fc.title = `Open ${entry.name} lesson`;
				tr.appendChild(fc);

				const lobs = cell(obsText(entry.lesson_obs));
				makeLessonClickable(lobs, entry);
				tr.appendChild(lobs);

				const gc = document.createElement("td");
				gc.className = "follow asn-col";
				if (entry.grade != null) {
					gc.textContent = entry.grade;
					gc.style.color = followFg((entry.grade / 5) * 100);
					gc.style.fontWeight = "700";
				}
				makeAssignClickable(gc, entry);
				gc.title = `Open ${entry.name} assignment`;
				tr.appendChild(gc);

				const stc1 = document.createElement("td");
				stc1.textContent = entry.status || "";
				const sc1 = statusCellCls(entry.status);
				stc1.className = sc1 || "asn-col";
				makeAssignClickable(stc1, entry);
				if (!stc1.title) stc1.title = `Open ${entry.name} assignment`;
				tr.appendChild(stc1);

				const aobs = obsCell(entry, "asn-col");
				makeAssignClickable(aobs, entry);
				tr.appendChild(aobs);
			} else {
				const gc = document.createElement("td");
				gc.className = "follow asn-sep asn-col";
				if (entry.grade != null) {
					gc.textContent = entry.grade;
					gc.style.color = followFg((entry.grade / 5) * 100);
					gc.style.fontWeight = "700";
				}
				makeAssignClickable(gc, entry);
				gc.title = `Open ${entry.name} assignment`;
				tr.appendChild(gc);

				const stc2 = document.createElement("td");
				stc2.textContent = entry.status || "";
				const sc2 = statusCellCls(entry.status);
				stc2.className = sc2 || "asn-col";
				makeAssignClickable(stc2, entry);
				if (!stc2.title) stc2.title = `Open ${entry.name} assignment`;
				tr.appendChild(stc2);

				const aobs = obsCell(entry, "asn-col");
				makeAssignClickable(aobs, entry);
				tr.appendChild(aobs);
			}
		}

		tr.appendChild(cell(fmtN(s.quiz_stii), "num asn-sep"));
		tr.appendChild(cell(fmtN(s.post_typing), "num"));
		tr.appendChild(cell(fmtN(s.avg_assignments, 1), "num"));

		const pc = document.createElement("td");
		pc.className = "num";
		if (s.participation != null) {
			pc.textContent = s.participation.toFixed(0) + "%";
			pc.style.color = followFg(s.participation);
		} else {
			pc.textContent = "—";
			pc.style.color = THEME.codeMuted;
		}
		pc.style.fontWeight = "700";
		tr.appendChild(pc);

		tr.appendChild(numCellBold(s.total_a));
		tr.appendChild(numCellBold(s.total_q));
		tr.appendChild(numCellBold(s.total_h));
		tr.appendChild(cdiffCell(s.total_cdiff, cdiffMin, cdiffMax));
		tr.addEventListener("click", () => {
			tbody
				.querySelectorAll("tr.selected")
				.forEach((r) => r.classList.remove("selected"));
			tr.classList.add("selected");
		});
		tbody.appendChild(tr);
	});

	if (rows.length > 0) {
		_appendOverviewTotalsRow(tbody, rows);
	}

	table.appendChild(tbody);
}

function _appendOverviewTotalsRow(tbody, rows) {
	const tr = document.createElement("tr");
	tr.className = "totals-row";

	const cohort = rows.filter((s) => !s.ai_flagged);
	const nonAiCount = cohort.length;

	const mean = (xs) => {
		const vs = xs.filter((x) => x != null && !isNaN(x));
		return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
	};
	const sum = (xs) => {
		const vs = xs.filter((x) => x != null && !isNaN(x));
		return vs.length ? vs.reduce((a, b) => a + Number(b), 0) : null;
	};

	const obsCounts = (entries, kind) => {
		const counts = [];
		for (const s of cohort) {
			const entry = (s.lessons || []).find((l) => l.name === entries.name);
			if (!entry) continue;
			const raw = kind === "lesson" ? entry.lesson_obs : entry.obs;
			const code = (raw || "").trim();
			if (!ARTEFACT_CODE_RE.test(code)) continue;
			for (let i = 0; i < code.length; i++) {
				counts[i] = (counts[i] || 0) + (code[i] === "1" ? 1 : 0);
			}
		}
		return counts;
	};

	const addCell = (content, cls = "") => {
		const td = document.createElement("td");
		if (cls) td.className = cls;
		if (content != null) td.textContent = content;
		return td;
	};
	const addHtmlCell = (html, cls = "") => {
		const td = document.createElement("td");
		if (cls) td.className = cls;
		if (html) td.innerHTML = html;
		return td;
	};
	const fmtPct = (v) => (v == null ? null : v.toFixed(0) + "%");
	const fmtAvg = (v, dec = 1) => (v == null ? null : v.toFixed(dec));

	tr.appendChild(addCell(null, "col-id sticky-l"));
	tr.appendChild(
		addCell(`${nonAiCount} students`, "name-cell col-name sticky-l"),
	);
	tr.appendChild(addCell(null, "col-num sticky-l"));
	tr.appendChild(
		addCell(fmtAvg(mean(cohort.map((s) => s.pre_typing)), 0), "num"),
	);
	tr.appendChild(
		addCell(fmtAvg(mean(cohort.map((s) => s.self_eval)), 0), "num"),
	);

	for (const a of ASSIGNMENTS) {
		const hasFollow = a.follow != null;
		const entries = cohort
			.map((s) => (s.lessons || []).find((l) => l.name === a.name))
			.filter(Boolean);

		if (hasFollow) {
			const followAvg = mean(entries.map((e) => e.follow));
			const fc = addCell(fmtPct(followAvg), "follow asn-sep");
			if (followAvg != null) {
				fc.style.color = followFg(followAvg);
				fc.style.fontWeight = "700";
			}
			tr.appendChild(fc);
			tr.appendChild(addCell(null));
		}

		const gradeAvg = mean(entries.map((e) => e.grade));
		const gc = addCell(
			fmtAvg(gradeAvg, 1),
			"follow asn-col" + (hasFollow ? "" : " asn-sep"),
		);
		if (gradeAvg != null) {
			gc.style.color = followFg((gradeAvg / 5) * 100);
			gc.style.fontWeight = "700";
		}
		tr.appendChild(gc);

		tr.appendChild(addCell(null, "asn-col"));

		const asnObsCounts = obsCounts(a, "asn");
		const asnSchema = _artefactSchema[(a.name || "").toLowerCase()];
		tr.appendChild(
			addHtmlCell(renderArtefactTotals(asnObsCounts, asnSchema), "asn-col"),
		);
	}

	tr.appendChild(
		addCell(fmtAvg(mean(cohort.map((s) => s.quiz_stii)), 0), "num asn-sep"),
	);
	tr.appendChild(
		addCell(fmtAvg(mean(cohort.map((s) => s.post_typing)), 0), "num"),
	);
	tr.appendChild(
		addCell(fmtAvg(mean(cohort.map((s) => s.avg_assignments)), 1), "num"),
	);

	const partAvg = mean(cohort.map((s) => s.participation));
	const pc = addCell(fmtPct(partAvg), "num");
	if (partAvg != null) {
		pc.style.color = followFg(partAvg);
		pc.style.fontWeight = "700";
	}
	tr.appendChild(pc);

	tr.appendChild(addCell(fmtAvg(sum(cohort.map((s) => s.total_a)), 0), "num"));
	tr.appendChild(addCell(fmtAvg(sum(cohort.map((s) => s.total_q)), 0), "num"));
	tr.appendChild(addCell(fmtAvg(sum(cohort.map((s) => s.total_h)), 0), "num"));
	tr.appendChild(
		addCell(fmtAvg(sum(cohort.map((s) => s.total_cdiff)), 0), "num"),
	);

	tbody.appendChild(tr);
}

function numCellBold(v) {
	const td = document.createElement("td");
	td.className = "num";
	if (v != null && !isNaN(v) && +v !== 0) {
		td.textContent = Math.round(+v).toString();
		td.style.fontWeight = "700";
	}
	return td;
}

function cdiffCell(v, vmin, vmax) {
	const td = document.createElement("td");
	td.className = "num";
	if (v == null || isNaN(v)) return td;
	const n = +v;
	td.textContent = n > 0 ? "+" + n : String(n);
	td.style.fontWeight = "700";
	if (n === 0) {
		td.style.color = THEME.black;
	} else if (n < 0 && vmin < 0) {
		const t = Math.min(1, n / vmin);
		td.style.color = `rgb(${Math.round(204 * t)}, ${Math.round(34 * t)}, ${Math.round(34 * t)})`;
	} else if (n > 0 && vmax > 0) {
		const t = Math.min(1, n / vmax);
		td.style.color = `rgb(0, ${Math.round(122 * t)}, ${Math.round(204 * t)})`;
	} else {
		td.style.color = THEME.black;
	}
	return td;
}

function applyStickyColumns() {
	const table = document.getElementById("grades-table");
	if (!table) return;
	const r2Sticky = table.querySelectorAll("thead tr:nth-child(2) th.sticky-l");
	let acc = 0;
	const lefts = [];
	r2Sticky.forEach((th) => {
		lefts.push(acc);
		acc += th.offsetWidth;
	});
	table.querySelectorAll("tr").forEach((row) => {
		row.querySelectorAll(".sticky-l").forEach((cell, i) => {
			if (i < lefts.length) cell.style.left = lefts[i] + "px";
		});
	});
	const hdr1 = table.querySelector("thead tr:first-child");
	const hdr2 = table.querySelector("thead tr:last-child");
	if (hdr1 && hdr2 && hdr1 !== hdr2)
		hdr2.querySelectorAll("th").forEach((th) => {
			th.style.top = hdr1.offsetHeight + "px";
		});
}

function onAnonChange(val) {
	_anonMode = val;
	if (_students.length) {
		renderTable();
		renderStats();
		renderProgress();
		renderClusters();
	} else {
		const table = document.getElementById("grades-table");
		table.classList.remove("anon-name", "anon-id");
		if (val === "name") table.classList.add("anon-name");
		else if (val === "id") table.classList.add("anon-id");
	}
	requestAnimationFrame(applyStickyColumns);
}

function studentLabel(s) {
	if (!s) return "";
	if (_anonMode === "id") return s.id || "—";
	if (_anonMode === "name") return _realToAlterMap[_nfc(s.name)] || s.name;
	return s.name;
}

function studentLabelWithId(s) {
	if (!s) return "";
	if (_anonMode === "id") return s.id || "—";
	const name = studentLabel(s);
	return s.id ? `${s.id}. ${name}` : name;
}

function fmtN(v, dec = 0) {
	if (v == null || isNaN(v)) return null;
	return dec > 0 ? (+v).toFixed(dec) : Math.round(+v).toString();
}
function followFg(pct) {
	if (pct < 40) return THEME.red;
	if (pct < 60) return THEME.orange;
	if (pct < 75) return THEME.label;
	return THEME.textStrong;
}
function statusCellCls(s) {
	if (!s) return "";
	return (
		{
			Pass: "st-bg-pass",
			"Pass'": "st-bg-prime",
			"Pass*": "st-bg-star",
			"Fail*": "st-bg-fail",
			Fail: "st-bg-fail",
		}[s] || ""
	);
}
function obsText(raw) {
	return !raw || !raw.trim() ? "" : raw.trim();
}

function artefactBadges(raw, assignmentName) {
	const schema = _artefactSchema[(assignmentName || "").toLowerCase()];
	return renderArtefactBadges(raw, schema);
}

async function openLessonDiff(student, entry) {
	const key = findHandle(_lessonHandles, entry.name);
	if (!key) {
		alert(`No lesson folder found for "${entry.name}".`);
		return;
	}
	openDiff(entry.name, "lessons", student, entry.follow);
}
async function openAssignDiff(student, entry) {
	const key = findHandle(_assignHandles, entry.name);
	if (!key) {
		alert(`No assignment folder found for "${entry.name}".`);
		return;
	}
	openDiff(entry.name, "assignments", student, null);
}
function findHandle(handles, name) {
	const nl = name.toLowerCase();
	if (handles[nl]) return nl;
	for (const k of Object.keys(handles))
		if (k.includes(nl) || nl.includes(k)) return k;
	return null;
}
function _attachStudentsLink(th, name, group) {
	if (group === "assignments") {
		th.classList.add("clickable");
		th.title = `Open ${name} assignment instructions`;
		th.addEventListener("click", () => {
			navigateToAssignments({ lesson: name });
		});
		return;
	}
	if (!findHandle(_lessonHandles, name)) return;
	th.classList.add("clickable");
	th.title = `Open ${name} lesson`;
	th.addEventListener("click", () => {
		navigateToLessons({ lesson: name });
	});
}

function _attachTimelineLink(th, name) {
	if (!findHandle(_lessonHandles, name)) return;
	th.classList.add("clickable");
	th.title = `Open ${name} timeline`;
	th.addEventListener("click", () => {
		navigateToTimeline({ lesson: name, group: "lessons" });
	});
}

function openDiff(lesson, group, student, followPct) {
	const sid = (student.id || "").trim();
	if (!sid) {
		alert(`Cannot find anon folder for "${student.name}" (no ID).`);
		return;
	}
	const label = followPct != null ? followPct.toFixed(0) + "%" : "assignment";
	const title = `${student.id ? String(student.id) + ". " : ""}${studentLabel(student)} (${label})`;
	navigateToDifferentiator({ lesson, group, id: sid, title });
}
