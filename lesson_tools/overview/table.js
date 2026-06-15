"use strict";

function renderTable() {
	const table = document.getElementById("grades-table");
	table.innerHTML = "";
	table.classList.toggle("hide-id", _hiddenCols.has("id"));
	table.classList.toggle("hide-name", _hiddenCols.has("name"));
	table.classList.toggle("hide-num", _hiddenCols.has("num"));

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
	const obsHeader = (a, cls, sep = false) => {
		const th = col("", cls, sep);
		const schema = _artefactSchema[(a.name || "").toLowerCase()];
		if (Array.isArray(schema) && schema.length) {
			const fmt = (code) =>
				String(code).replace(/([^_]+)|_(\w+)/g, (m, main, sub) =>
					main
						? escHtml(main.toUpperCase())
						: `<sub>${escHtml(sub.toLowerCase())}</sub>`,
				);
			th.innerHTML = schema
				.map(
					(e) =>
						`<span style="display:inline-block;width:14px;margin:0 1px;` +
						`text-align:center;font-size:9px;font-weight:600;text-transform:none">` +
						fmt(e.code || e.key || "?") +
						`</span>`,
				)
				.join("");
			const tip = schema
				.map(
					(e) =>
						`${artefactCodeHtml(String(e.code || e.key || "?"))}: ${escHtml(
							e.label || "",
						)}`,
				)
				.join("<br>");
			if (tip) attachHtmlTip(th, tip);
		} else {
			th.textContent = "Obs";
		}
		return th;
	};

	col("ID", "col-id sticky-l");
	col("Name", "col-name sticky-l");
	col("#", "col-num sticky-l");
	col("Self");
	col("KPM");
	col("Quiz");

	for (const a of ASSIGNMENTS) {
		if (a.follow != null) {
			_attachStudentsLink(
				grp(`${a.name} Lesson`, 2, true),
				a.name,
				"lessons",
			);
			_attachStudentsLink(
				grp("Assignment", 1, false),
				a.name,
				"assignments",
			);
			_attachTimelineLink(col("Follow%", "lhd", true), a.name);
			col("Obs", "lhd");
			obsHeader(a, "");
		} else {
			_attachStudentsLink(grp("Assignment", 1, true), a.name, "assignments");
			obsHeader(a, "", true);
		}
	}
	grp("", 5, true);
	col("KPM", "", true);
	col("Avg");
	col("Follow%");
	col("Int");
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
		tr.appendChild(cell(fmtN(s.self_eval), "num"));
		tr.appendChild(cell(fmtN(s.pre_typing), "num"));
		tr.appendChild(cell(fmtN(s.quiz_stii), "num"));

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
			if (!td.title) td.title = `Open ${entry.name} assignment`;
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
				tr.appendChild(fc);

				const _lo = (entry.lesson_obs || "").trim();
				const lobs = cell(_lo === "_" ? "" : _lo);
				if (_lo && _lo !== "_") {
					lobs.style.fontWeight = "bold";
					if (_lo.includes("<")) lobs.style.color = THEME.red;
				}
				makeLessonClickable(lobs, entry);
				tr.appendChild(lobs);

				const aobs = obsCell(entry, "asn-col");
				makeAssignClickable(aobs, entry);
				tr.appendChild(aobs);
			} else {
				const aobs = obsCell(entry, "asn-sep asn-col");
				makeAssignClickable(aobs, entry);
				tr.appendChild(aobs);
			}
		}

		tr.appendChild(cell(fmtN(s.post_typing), "num asn-sep"));
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

		tr.appendChild(
			cell(
				formatInteractionCounts(s.total_a, s.total_q, s.total_h),
				"col-int",
				true,
			),
		);
		tr.appendChild(
			followAvg(s) >= 0
				? cdiffCell(s.total_cdiff, cdiffMin, cdiffMax)
				: cell("", "num"),
		);
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
		addCell(fmtAvg(mean(cohort.map((s) => s.self_eval)), 0), "num"),
	);
	tr.appendChild(
		addCell(fmtAvg(mean(cohort.map((s) => s.pre_typing)), 0), "num"),
	);
	tr.appendChild(
		addCell(fmtAvg(mean(cohort.map((s) => s.quiz_stii)), 0), "num"),
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

		const asnObsCounts = obsCounts(a, "asn");
		const asnSchema = _artefactSchema[(a.name || "").toLowerCase()];
		tr.appendChild(
			addHtmlCell(
				renderArtefactTotals(asnObsCounts, asnSchema),
				"asn-col" + (hasFollow ? "" : " asn-sep"),
			),
		);
	}

	tr.appendChild(
		addCell(fmtAvg(mean(cohort.map((s) => s.post_typing)), 0), "num asn-sep"),
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

	tr.appendChild(
		addHtmlCell(
			formatInteractionCounts(
				sum(cohort.map((s) => s.total_a)),
				sum(cohort.map((s) => s.total_q)),
				sum(cohort.map((s) => s.total_h)),
			),
			"col-int",
		),
	);
	tr.appendChild(
		addCell(fmtAvg(sum(cohort.map((s) => s.total_cdiff)), 0), "num"),
	);

	tbody.appendChild(tr);
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

function _loadHiddenCols() {
	try {
		const raw = localStorage.getItem("overview.hiddenCols");
		if (!raw) return;
		const arr = JSON.parse(raw);
		if (!Array.isArray(arr)) return;
		_hiddenCols.clear();
		for (const k of arr) _hiddenCols.add(k);
	} catch {}
}

function _saveHiddenCols() {
	try {
		localStorage.setItem(
			"overview.hiddenCols",
			JSON.stringify([..._hiddenCols]),
		);
	} catch {}
}

function _renderColsPanel() {
	const panel = document.getElementById("cols-panel");
	if (!panel) return;
	panel.innerHTML = "";
	for (const { key, label } of COL_HIDE_KEYS) {
		const lab = document.createElement("label");
		const cb = document.createElement("input");
		cb.type = "checkbox";
		cb.checked = !_hiddenCols.has(key);
		cb.addEventListener("change", () => {
			if (cb.checked) _hiddenCols.delete(key);
			else _hiddenCols.add(key);
			_saveHiddenCols();
			if (_students.length) renderTable();
			requestAnimationFrame(applyStickyColumns);
		});
		lab.appendChild(cb);
		lab.appendChild(document.createTextNode(" " + label));
		panel.appendChild(lab);
	}
}

function _colsPanelOutsideClick(e) {
	const panel = document.getElementById("cols-panel");
	const btn = document.getElementById("cols-btn");
	if (!panel || !btn) return;
	if (panel.contains(e.target) || btn.contains(e.target)) return;
	panel.hidden = true;
	document.removeEventListener("click", _colsPanelOutsideClick, true);
}

function _toggleColsPanel() {
	const panel = document.getElementById("cols-panel");
	if (!panel) return;
	if (panel.hidden) {
		_renderColsPanel();
		panel.hidden = false;
		setTimeout(() => {
			document.addEventListener("click", _colsPanelOutsideClick, true);
		}, 0);
	} else {
		panel.hidden = true;
		document.removeEventListener("click", _colsPanelOutsideClick, true);
	}
}

_loadHiddenCols();

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
function followFg(pct) {
	if (pct < 40) return THEME.red;
	if (pct < 60) return THEME.orange;
	if (pct < 75) return THEME.label;
	return THEME.textStrong;
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
			navigateToStudents({ lesson: key, group: "assignments" });
		});
		return;
	}
	const key = findHandle(_lessonHandles, name);
	if (!key) return;
	th.classList.add("clickable");
	th.title = `Open ${name} students`;
	th.addEventListener("click", () => {
		navigateToStudents({ lesson: key, group: "lessons" });
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
