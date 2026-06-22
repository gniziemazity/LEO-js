"use strict";

function _extraLabel(name) {
	for (const [pre, post] of _extraColumns.pairs || []) {
		if (name === pre) return pre.replace(/^Pre\s+/, "");
		if (name === post) return post.replace(/^Post\s+/, "");
	}
	return name;
}

function _topicShowMap() {
	const m = {};
	for (const a of ASSIGNMENTS) m[a.name] = { grade: false, status: false };
	for (const s of _students) {
		for (const e of s.lessons || []) {
			const c = m[e.name];
			if (!c) continue;
			if (e.grade != null) c.grade = true;
			if ((e.status || "") !== "") c.status = true;
		}
	}
	return m;
}

function _overviewAssignmentSeps(hasFollow, ng) {
	let lead = hasFollow ? "asn-div" : "asn-sep";
	const take = () => {
		const c = lead;
		lead = "";
		return c;
	};
	const seps = {};
	if (ng.grade) seps.grade = take();
	if (ng.status) seps.status = take();
	seps.obs = take();
	return seps;
}

function _followBarFrag(pct) {
	return new FollowBar(pct).render();
}

function renderTable() {
	const table = document.getElementById("grades-table");
	table.innerHTML = "";
	table.classList.remove("hide-id", "hide-name");
	table.classList.add("hide-num");

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
	const obsHeader = (a, cls, sep = false) => {
		const th = col("", cls, sep);
		const schema = _artefactSchema[(a.name || "").toLowerCase()];
		if (Array.isArray(schema) && schema.length) {
			th.innerHTML = schema
				.map(
					(e) =>
						`<span class="art-hdr-code">${artefactCodeHtml(
							String(e.code || e.key || "?"),
						)}</span>`,
				)
				.join("");
			const tip = buildArtefactSchemaTipHtml(schema);
			if (tip) attachHtmlTip(th, tip);
		} else {
			th.textContent = "Obs";
		}
		return th;
	};

	col("ID", "col-id sticky-l");
	col("Name", "col-name sticky-l");
	col("#", "col-num sticky-l");
	_extraColumns.before.forEach((name, i) =>
		col(_extraLabel(name), "", i === 0),
	);
	if (_extraColumns.before.length)
		grp("Pre-Course Stats", _extraColumns.before.length, true);

	const topicShow = _topicShowMap();
	for (const a of ASSIGNMENTS) {
		const ng = topicShow[a.name] || { grade: false, status: false };
		const asnExtra = (ng.grade ? 1 : 0) + (ng.status ? 1 : 0);
		const lessonTopic = a.follow != null;
		const seps = _overviewAssignmentSeps(lessonTopic, ng);
		if (lessonTopic) {
			_attachStudentsLink(
				grp(`${a.name} Lesson`, 2, true),
				a.name,
				"lessons",
			);
			_attachStudentsLink(
				grp("Assignment", 1 + asnExtra, false),
				a.name,
				"assignments",
			);
			_attachTimelineLink(col("Follow%", "lhd", true), a.name);
			col("Obs", "lhd");
		} else {
			_attachStudentsLink(
				grp("Assignment", 1 + asnExtra, true),
				a.name,
				"assignments",
			);
		}
		if (ng.grade) col("Grade", ("num " + seps.grade).trim());
		if (ng.status) col("Status", seps.status);
		obsHeader(a, seps.obs);
	}
	grp("Totals", 3, true);
	if (_extraColumns.after.length)
		grp("Post-Course Stats", _extraColumns.after.length, true);
	col("Follow%", "asn-sep");
	col("Interactions", "col-int");
	col("Comments");
	_extraColumns.after.forEach((name, i) =>
		col(_extraLabel(name), "", i === 0),
	);

	thead.appendChild(r1);
	thead.appendChild(r2);
	table.appendChild(thead);

	const cdiffMin = Math.min(0, ..._students.map((s) => s.total_cdiff ?? 0));
	const cdiffMax = Math.max(0, ..._students.map((s) => s.total_cdiff ?? 0));

	const anyStatus = _hasAnyStatusValues();
	const tbody = document.createElement("tbody");
	const rows = _hideExcluded
		? _students.filter((s) => !s.excluded || s.ai_flagged)
		: _students;
	rows.forEach((s) => {
		const tr = document.createElement("tr");
		if (anyStatus) {
			tr.classList.add(s.passed_course ? "row-pass" : "row-fail");
		}
		if (s.excluded) tr.classList.add("row-excluded");
		if (s.ai_flagged) tr.classList.add("row-ai");

		const cell = (content, cls = "", html = false) => {
			const td = document.createElement("td");
			if (cls) td.className = cls;
			if (html) td.innerHTML = content ?? "";
			else td.textContent = content ?? "";
			return td;
		};
		const obsCell = (entry, cls = "") => {
			const td = document.createElement("td");
			if (cls) td.className = cls;
			const schema = _artefactSchema[(entry.name || "").toLowerCase()];
			const badges = renderArtefactBadges(entry.obs, schema);
			if (badges) {
				td.innerHTML = badges;
				td.dataset.artefactCell = "1";
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
		_extraColumns.before.forEach((name, i) => {
			tr.appendChild(
				cell(fmtN(s.extraVals[name]), "num" + (i === 0 ? " asn-sep" : "")),
			);
		});

		const makeLessonClickable = (td, entry) => {
			if (entry.follow == null) return;
			td.classList.add("clickable");
			if (!td.title) td.title = `Open ${entry.name} lesson`;
			td.addEventListener("click", () => openLessonDiff(s, entry));
		};
		const makeAssignClickable = (td, entry) => {
			if (!entry.hasAssignment) return;
			if (!_hasSubmission("assignments", entry.name, s.id)) {
				td.title = "Forgot to send the code";
				return;
			}
			td.classList.add("clickable");
			if (!td.title && !td.dataset.artefactCell)
				td.title = `Open ${entry.name} assignment`;
			td.addEventListener("click", () => openAssignDiff(s, entry));
		};

		for (const entry of s.lessons) {
			const ng = topicShow[entry.name] || { grade: false, status: false };
			const gradeText = entry.grade == null ? "" : String(entry.grade);
			const seps = _overviewAssignmentSeps(entry.hasFollowCol, ng);
			if (entry.hasFollowCol) {
				const fc = document.createElement("td");
				fc.className = "follow asn-sep";
				if (entry.follow != null) {
					fc.appendChild(_followBarFrag(entry.follow));
				}
				makeLessonClickable(fc, entry);
				tr.appendChild(fc);

				const _lo = (entry.lesson_obs || "").trim();
				const lobs = cell(
					_lo === "_" ? "" : formatLessonObsHtml(_lo),
					"",
					true,
				);
				if (_lo && _lo !== "_" && _lo.includes("<")) {
					lobs.style.color = THEME.red;
				}
				makeLessonClickable(lobs, entry);
				tr.appendChild(lobs);
			}
			if (ng.grade) {
				const gc = cell(gradeText, ("num " + seps.grade).trim());
				makeAssignClickable(gc, entry);
				tr.appendChild(gc);
			}
			if (ng.status) {
				const sc = cell(entry.status || "", seps.status);
				makeAssignClickable(sc, entry);
				tr.appendChild(sc);
			}
			const aobs = obsCell(entry, ("asn-col " + seps.obs).trim());
			makeAssignClickable(aobs, entry);
			tr.appendChild(aobs);
		}

		const pc = document.createElement("td");
		pc.className = "num asn-sep";
		if (s.participation != null) {
			pc.appendChild(_followBarFrag(s.participation));
		}
		tr.appendChild(pc);

		const intTd = document.createElement("td");
		intTd.className = "col-int";
		intTd.appendChild(
			new InteractionCell(s.total_a, s.total_q, s.total_h).render(),
		);
		tr.appendChild(intTd);

		tr.appendChild(
			followAvg(s) >= 0
				? cdiffCell(s.total_cdiff, cdiffMin, cdiffMax)
				: cell("", "num"),
		);

		_extraColumns.after.forEach((name, i) => {
			tr.appendChild(
				cell(fmtN(s.extraVals[name]), "num" + (i === 0 ? " asn-sep" : "")),
			);
		});
		tr.addEventListener("click", () => {
			tbody
				.querySelectorAll("tr.selected")
				.forEach((r) => r.classList.remove("selected"));
			tr.classList.add("selected");
		});
		tbody.appendChild(tr);
	});

	if (rows.length > 0) {
		_appendOverviewTotalsRow(tbody, rows, topicShow, cdiffMin, cdiffMax);
	}

	table.appendChild(tbody);
	requestAnimationFrame(applyStickyColumns);
}

function _appendOverviewTotalsRow(tbody, rows, topicShow, cdiffMin, cdiffMax) {
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

	const obsCounts = (entries, kind) =>
		countArtefactColumn(
			cohort.map((s) => {
				const entry = (s.lessons || []).find(
					(l) => l.name === entries.name,
				);
				if (!entry) return "";
				const raw = kind === "lesson" ? entry.lesson_obs : entry.obs;
				return (raw || "").trim();
			}),
		);

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
	_extraColumns.before.forEach((name, i) => {
		tr.appendChild(
			addCell(
				fmtAvg(mean(cohort.map((s) => s.extraVals[name])), 0),
				"num" + (i === 0 ? " asn-sep" : ""),
			),
		);
	});

	for (const a of ASSIGNMENTS) {
		const hasFollow = a.follow != null;
		const ng = (topicShow && topicShow[a.name]) || {
			grade: false,
			status: false,
		};
		const entries = cohort
			.map((s) => (s.lessons || []).find((l) => l.name === a.name))
			.filter(Boolean);

		if (hasFollow) {
			const followAvg = mean(entries.map((e) => e.follow));
			const fc = addCell(null, "follow asn-sep");
			if (followAvg != null) fc.appendChild(_followBarFrag(followAvg));
			tr.appendChild(fc);
			tr.appendChild(addCell(null));
		}

		const seps = _overviewAssignmentSeps(hasFollow, ng);
		if (ng.grade) {
			tr.appendChild(
				addCell(
					fmtAvg(mean(entries.map((e) => e.grade)), 1),
					("num " + seps.grade).trim(),
				),
			);
		}
		if (ng.status) {
			tr.appendChild(addCell(null, seps.status));
		}

		const asnObsCounts = obsCounts(a, "asn");
		const asnSchema = _artefactSchema[(a.name || "").toLowerCase()];
		tr.appendChild(
			addHtmlCell(
				renderArtefactTotals(asnObsCounts, asnSchema),
				("asn-col " + seps.obs).trim(),
			),
		);
	}

	const partAvg = mean(cohort.map((s) => s.participation));
	const pc = addCell(null, "num asn-sep");
	if (partAvg != null) pc.appendChild(_followBarFrag(partAvg));
	tr.appendChild(pc);

	const intTd = document.createElement("td");
	intTd.className = "col-int";
	intTd.appendChild(
		new InteractionCell(
			sum(cohort.map((s) => s.total_a)),
			sum(cohort.map((s) => s.total_q)),
			sum(cohort.map((s) => s.total_h)),
		).render(),
	);
	tr.appendChild(intTd);
	tr.appendChild(
		cdiffCell(sum(cohort.map((s) => s.total_cdiff)), cdiffMin, cdiffMax),
	);

	_extraColumns.after.forEach((name, i) => {
		tr.appendChild(
			addCell(
				fmtAvg(mean(cohort.map((s) => s.extraVals[name])), 0),
				"num" + (i === 0 ? " asn-sep" : ""),
			),
		);
	});

	tbody.appendChild(tr);
}

function cdiffCell(v, vmin, vmax) {
	const td = document.createElement("td");
	td.className = "num";
	if (v == null || isNaN(v)) return td;
	const n = +v;
	td.textContent = n >= 0 ? "+" + n : String(n);
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

function studentLabel(s) {
	if (!s) return "";
	return s.name;
}

function studentLabelWithId(s) {
	if (!s) return "";
	const name = studentLabel(s);
	return s.id ? `${s.id}. ${name}` : name;
}

function fmtN(v, dec = 0) {
	if (v == null || isNaN(v)) return null;
	return dec > 0 ? (+v).toFixed(dec) : Math.round(+v).toString();
}
function obsText(raw) {
	return !raw || !raw.trim() ? "" : raw.trim();
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
		const key = findHandle(_assignHandles, name) || name;
		th.classList.add("clickable");
		th.title = `Open ${name} students`;
		th.addEventListener("click", () => {
			navigateToStudents({
				lesson: key,
				group: "assignments",
				basis: _activeBasis,
			});
		});
		return;
	}
	const key = findHandle(_lessonHandles, name);
	if (!key) return;
	th.classList.add("clickable");
	th.title = `Open ${name} students`;
	th.addEventListener("click", () => {
		navigateToStudents({
			lesson: key,
			group: "lessons",
			basis: _activeBasis,
		});
	});
}

function _attachTimelineLink(th, name) {
	if (!findHandle(_lessonHandles, name)) return;
	th.classList.add("clickable");
	th.title = `Open ${name} timeline`;
	th.addEventListener("click", () => {
		navigateToTimeline({
			lesson: name,
			group: "lessons",
			basis: _activeBasis,
		});
	});
}

function openDiff(lesson, group, student, followPct) {
	const sid = (student.id || "").trim();
	if (!sid) {
		alert(`Cannot find anon folder for "${student.name}" (no ID).`);
		return;
	}
	const title = diffStudentTitle(
		student.id,
		studentLabel(student),
		followPct,
		{
			decimals: 0,
			fallback: "assignment",
		},
	);
	navigateToDifferentiator({
		lesson,
		group,
		id: sid,
		title,
		mode: basisToDiffMode(_activeBasis),
	});
}
