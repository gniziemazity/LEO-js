"use strict";

let COL = {};
let ASSIGNMENTS = [];

const _COL_ALIASES = {
	id: ["ID"],
	name: ["Name"],
	number: ["Number"],
	pre_typing: ["Pre Typing", "Pre KPM", "Pre-typing", "Pre K/min"],
	post_typing: ["Post Typing", "Post KPM", "Post-typing", "Post K/min"],
	self_eval: ["Self Eval", "Self Evaluation", "Self"],
	kahoot: ["Kahoot"],
	quiz_stii: ["Final Quiz", "Quiz Stii", "Stii", "Știi"],
	final_grade: ["Final Grade", "Grade"],
	avg_assignments: ["Avg Assignments", "Avg Grade"],
	participation: ["Participation"],
	answers: ["Total Answers", "Answers"],
	questions: ["Total Questions", "Questions"],
	help: ["Total Help", "Help"],
	excluded: ["Excluded"],
};

function _buildHeaderMap(headerRow) {
	const m = {};
	for (let i = 0; i < headerRow.length; i++) {
		const v = headerRow[i];
		if (v == null) continue;
		const orig = String(v).trim();
		if (!orig) continue;
		const lower = orig.toLowerCase();
		if (!(lower in m)) m[lower] = { orig, idx: i };
	}
	return m;
}

function _findCol(headerMap, names) {
	for (const n of names) {
		const e = headerMap[n.toLowerCase()];
		if (e != null) return e.idx;
	}
	return null;
}

function _detectAssignments(headerMap) {
	const result = [];
	const seen = new Set();
	const sorted = Object.values(headerMap).sort((a, b) => a.idx - b.idx);

	for (const { orig, idx } of sorted) {
		const m = orig.match(/^(.+?) Grade$/i);
		if (!m) continue;
		const name = m[1].trim();
		const lower = name.toLowerCase();
		if (seen.has(lower)) continue;
		seen.add(lower);

		const get = (suffix) => {
			const key1 = (name + " " + suffix).toLowerCase();
			const key2 = (name + suffix).toLowerCase();
			const e = headerMap[key1] || headerMap[key2];
			return e ? e.idx : null;
		};

		result.push({
			n: result.length + 1,
			name,
			follow_html: get("HTML Follow"),
			follow_css: get("CSS Follow"),
			follow_js: get("JS Follow"),
			follow: get("Follow"),
			inc: get("Inc"),
			a: get("A"),
			q: get("Q"),
			h: get("H"),
			c_plus: get("C+"),
			c_minus: get("C-"),
			c_diff: get("C Diff"),
			lesson_obs: get("LessonObs"),
			grade: idx,
			status: get("Status"),
			obs: get("Obs"),
		});
	}
	return result;
}

function _populateColumnsFromHeader(headerRow) {
	const headerMap = _buildHeaderMap(headerRow);
	COL = {};
	for (const [key, aliases] of Object.entries(_COL_ALIASES)) {
		COL[key] = _findCol(headerMap, aliases);
	}
	ASSIGNMENTS = _detectAssignments(headerMap);

	if (ASSIGNMENTS.length) {
		const lessonGrades = ASSIGNMENTS.map((a) => a.grade).filter(
			(g) => g != null,
		);
		const firstGrade = Math.min(...lessonGrades);
		const lastGrade = Math.max(...lessonGrades);
		const findAllByName = (lower) => {
			const out = [];
			for (let i = 0; i < headerRow.length; i++) {
				const v = headerRow[i];
				if (v != null && String(v).trim().toLowerCase() === lower)
					out.push(i);
			}
			return out;
		};
		const km = findAllByName("k/min");
		if (COL.pre_typing == null) {
			const before = km.find((i) => i < firstGrade);
			if (before != null) COL.pre_typing = before;
		}
		if (COL.post_typing == null) {
			const after = km.find((i) => i > lastGrade);
			if (after != null) COL.post_typing = after;
		}
	}
}

const LANG_FOLLOW_KEYS = [
	{
		key: "follow_html",
		entryKey: "follow_html",
		label: "HTML",
		colorVar: "--clr-red",
	},
	{
		key: "follow_css",
		entryKey: "follow_css",
		label: "CSS",
		colorVar: "--clr-accent",
	},
	{
		key: "follow_js",
		entryKey: "follow_js",
		label: "JS",
		colorVar: "--clr-orange",
	},
];

const PASSING = new Set(["Pass", "Pass'", "Pass*"]);

let _students = [];
let _globalStudentMap = {};
let _realToAlterMap = {};
let _lessonHandles = {};
let _assignHandles = {};
let _scatterCharts = [];
let _barCharts = [];
let _progressCharts = [];
let _pyStats = null;
let _trapSchema = {};
let _lessonStats = null;
let _curSort = "name";
let _anonMode = "name";

document.getElementById("open-btn").addEventListener("click", pickFolder);
document
	.getElementById("open-btn-toolbar")
	?.addEventListener("click", pickFolder);

async function pickFolder() {
	try {
		const handle = await pickFolderWithMemory("lastCourseDir", "grades-dash");
		showLoading(true);
		await loadCourse(handle);
		showLoading(false);
	} catch (e) {
		showLoading(false);
		if (e.name !== "AbortError") alert("Error: " + e.message);
	}
}

(async function tryAutoLoad() {
	const handle = await loadSavedDirHandle("lastCourseDir", "grades-dash");
	if (!handle) return;
	showLoading(true);
	try {
		await loadCourse(handle);
	} catch (e) {
		if (e.name !== "AbortError") alert("Error: " + e.message);
	}
	showLoading(false);
})();

async function loadCourse(rootHandle) {
	if (typeof XLSX === "undefined") {
		alert("SheetJS not loaded.");
		return;
	}

	console.log("[overview] loadCourse rootHandle.name =", rootHandle.name);

	let gradesFile = null,
		pyStatsFile = null;
	let overviewPlusFile = null;
	let overviewFile = null;
	const rootFileNames = [];
	for await (const [name, entry] of rootHandle.entries()) {
		if (entry.kind !== "file") continue;
		rootFileNames.push(name);
		if (/^overviewplus\.xlsx?$/i.test(name)) {
			overviewPlusFile = await entry.getFile();
		} else if (/^overview\.xlsx?$/i.test(name)) {
			overviewFile = await entry.getFile();
		}
		if (/^grades_stats\.json$/i.test(name))
			pyStatsFile = await entry.getFile();
	}
	console.log("[overview] root files:", rootFileNames);
	gradesFile = overviewPlusFile || overviewFile;
	if (!gradesFile) {
		alert("No Overview.xlsx or OverviewPlus.xlsx found.");
		return;
	}
	console.log(
		"[overview] picked grades file:",
		gradesFile.name,
		"size =",
		gradesFile.size,
		"lastModified =",
		new Date(gradesFile.lastModified).toISOString(),
	);
	if (pyStatsFile)
		console.log(
			"[overview] picked grades_stats.json size =",
			pyStatsFile.size,
			"lastModified =",
			new Date(pyStatsFile.lastModified).toISOString(),
		);
	else console.log("[overview] no grades_stats.json present");

	const buf = await gradesFile.arrayBuffer();
	if (!buf.byteLength) {
		alert("Could not read grades file — is it open in Excel?");
		return;
	}
	let wb;
	try {
		wb = XLSX.read(new Uint8Array(buf), { type: "array" });
	} catch (e) {
		alert("Failed to parse: " + e.message);
		return;
	}

	const ws =
		wb.Sheets[
			wb.SheetNames.find((n) => /^grades$/i.test(n)) ?? wb.SheetNames[0]
		];
	const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

	_lessonStats = null;
	const lsName = wb.SheetNames.find((n) => /^lesson\s*stats$/i.test(n));
	if (lsName) {
		const lsRows = XLSX.utils.sheet_to_json(wb.Sheets[lsName], {
			header: 1,
		});
		if (lsRows.length >= 2) {
			const lsHeader = lsRows[0].map((c) =>
				c != null ? String(c).trim() : "",
			);
			const lsData = lsRows
				.slice(1)
				.filter(
					(r) =>
						Array.isArray(r) &&
						r[0] != null &&
						String(r[0]).trim() !== "",
				)
				.map((r) => {
					const obj = {};
					for (let i = 0; i < lsHeader.length; i++) {
						const key = lsHeader[i];
						if (key) obj[key] = r[i];
					}
					return obj;
				});
			if (lsData.length) _lessonStats = { header: lsHeader, rows: lsData };
		}
	}
	if (!rows.length) {
		alert("Empty workbook.");
		return;
	}
	_populateColumnsFromHeader(rows[0]);
	if (COL.id == null) {
		alert("Could not find 'ID' column in " + gradesFile.name);
		return;
	}
	if (!ASSIGNMENTS.length) {
		alert(
			"No assignment columns detected (looking for '<Name> Grade' headers).",
		);
		return;
	}
	const dataRows = rows
		.slice(1)
		.filter(
			(r) =>
				Array.isArray(r) &&
				r[COL.id] != null &&
				String(r[COL.id]).trim() !== "",
		);
	if (!dataRows.length) {
		alert("No student rows found.");
		return;
	}

	_students = dataRows.map((r) => parseStudent(r));
	_pyStats = null;
	if (pyStatsFile)
		try {
			_pyStats = JSON.parse(await pyStatsFile.text());
		} catch {}
	_trapSchema = _pyStats?.trap_schema || {};

	_globalStudentMap = {};
	_realToAlterMap = {};
	try {
		const fh = await rootHandle.getFileHandle("students.csv");
		const text = await readCsvText(await fh.getFile());
		_globalStudentMap = parseStudentCsv(text);
		_realToAlterMap = parseAlterEgoMap(text, { keyTransform: _nfc });
	} catch {}
	try {
		const fh = await rootHandle.getFileHandle("name_map.csv");
		const text = await readCsvText(await fh.getFile());
		_realToAlterMap = parseAlterEgoMap(text, { keyTransform: _nfc });
	} catch {}

	_lessonHandles = {};
	_assignHandles = {};
	for await (const [name, entry] of rootHandle.entries()) {
		if (entry.kind !== "directory") continue;
		if (/^lessons$/i.test(name)) {
			for await (const [n2, e2] of entry.entries())
				if (e2.kind === "directory") _lessonHandles[n2.toLowerCase()] = e2;
		}
		if (/^assignments$/i.test(name)) {
			for await (const [n2, e2] of entry.entries())
				if (e2.kind === "directory") _assignHandles[n2.toLowerCase()] = e2;
		}
	}
	console.log(
		"[overview] lesson folders:",
		Object.keys(_lessonHandles),
		"assignment folders:",
		Object.keys(_assignHandles),
	);

	finishLoad(gradesFile.name);
}

function finishLoad(filename) {
	[..._scatterCharts, ..._barCharts, ..._progressCharts].forEach((c) => {
		try {
			c.destroy();
		} catch {}
	});
	_scatterCharts = [];
	_barCharts = [];
	_progressCharts = [];
	document.getElementById("landing").style.display = "none";
	document.getElementById("toolbar").classList.add("show");
	document.getElementById("nav-info").textContent =
		`${_students.length} students · ${filename}`;
	_curSort = "name";
	document
		.querySelectorAll(".sort-bar button[data-sort]")
		.forEach((b) => b.classList.toggle("active", b.dataset.sort === "name"));
	_clusterSort = "total-follow";
	document
		.querySelectorAll(".cluster-sort[data-cluster-sort]")
		.forEach((b) =>
			b.classList.toggle("active", b.dataset.clusterSort === "total-follow"),
		);
	renderTable();
	renderStats();
	renderProgress();
	renderClusters();
	showPage("students");
}

async function readCsvText(file) {
	const buf = await file.arrayBuffer();
	const bytes = new Uint8Array(buf);
	const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
	try {
		return stripBom(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch {}
	try {
		return stripBom(new TextDecoder("windows-1252").decode(bytes));
	} catch {}
	return stripBom(new TextDecoder("latin1").decode(bytes));
}

function _nfc(s) {
	return typeof s === "string" && s.normalize ? s.normalize("NFC") : s;
}

function parseStudentCsv(text) {
	const map = {};
	for (const parts of parseCsv(text).rows) {
		if (parts.length >= 3 && parts[0]) map[parts[0]] = parts[2];
	}
	return map;
}

function parseStudent(r) {
	const str = (c) => (c != null && r[c] != null ? String(r[c]).trim() : "");
	const num = (c) => {
		if (c == null) return null;
		const v = r[c];
		if (v == null || v === "") return null;
		const n = +v;
		return isNaN(n) ? null : n;
	};

	const s = {
		id: str(COL.id),
		name: str(COL.name),
		number: str(COL.number),
		excluded: str(COL.excluded).toUpperCase() === "EXCLUDED",
		pre_typing: num(COL.pre_typing),
		self_eval: num(COL.self_eval),
		quiz_stii: num(COL.quiz_stii),
		post_typing: num(COL.post_typing),
		avg_assignments: num(COL.avg_assignments),
		final_grade: num(COL.final_grade),
		participation: num(COL.participation),
		kahoot: num(COL.kahoot),
		answers: num(COL.answers),
		questions: num(COL.questions),
		help: num(COL.help),
		lessons: [],
		passed_course: true,
	};

	for (const a of ASSIGNMENTS) {
		const entry = {
			name: a.name,
			n: a.n,
			hasFollowCol: a.follow != null,
			follow: num(a.follow),
			follow_html: num(a.follow_html),
			follow_css: num(a.follow_css),
			follow_js: num(a.follow_js),
			inc: num(a.inc),
			a: num(a.a),
			q: num(a.q),
			h: num(a.h),
			c_plus: num(a.c_plus),
			c_minus: num(a.c_minus),
			c_diff: num(a.c_diff),
			lesson_obs: str(a.lesson_obs),
			grade: num(a.grade),
			status: str(a.status),
			obs: str(a.obs),
		};
		if (!PASSING.has(entry.status)) s.passed_course = false;
		s.lessons.push(entry);
	}

	const sumLessons = (key) => {
		let sum = null;
		for (const l of s.lessons) {
			const v = l[key];
			if (v == null) continue;
			sum = (sum ?? 0) + v;
		}
		return sum;
	};
	s.total_a = sumLessons("a");
	s.total_q = sumLessons("q");
	s.total_h = sumLessons("h");
	s.total_cdiff = sumLessons("c_diff");

	if (s.avg_assignments == null) {
		const grades = s.lessons.map((l) => l.grade).filter((v) => v != null);
		if (grades.length) {
			s.avg_assignments = grades.reduce((a, b) => a + b, 0) / grades.length;
		}
	}

	if (s.participation == null) {
		const follows = s.lessons
			.filter((l) => l.hasFollowCol && l.follow != null)
			.map((l) => l.follow);
		if (follows.length) {
			s.participation = follows.reduce((a, b) => a + b, 0) / follows.length;
		}
	}

	if (s.final_grade == null && s.avg_assignments != null) {
		s.final_grade = s.avg_assignments;
	}

	return s;
}

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
	};

	col("ID", "col-id sticky-l");
	col("Name", "col-name sticky-l");
	col("#", "col-num sticky-l");
	col("KPM");
	col("Self");

	for (const a of ASSIGNMENTS) {
		if (a.follow != null) {
			attachLessonGroup(grp(a.name, 5, true), a);
			col("Follow%", "lhd", true);
			col("Obs", "lhd");
			col("Grade", "ahd");
			col("Status", "ahd");
			col("Obs", "ahd");
		} else {
			attachLessonGroup(grp(a.name, 3, true), a);
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
	_students.forEach((s) => {
		const tr = document.createElement("tr");
		tr.classList.add(s.passed_course ? "row-pass" : "row-fail");
		if (s.excluded) tr.classList.add("row-excluded");

		const cell = (content, cls = "") => {
			const td = document.createElement("td");
			if (cls) td.className = cls;
			td.textContent = content ?? "";
			return td;
		};
		const obsCell = (entry, cls = "") => {
			const td = document.createElement("td");
			if (cls) td.className = cls;
			const badges = trapBadges(entry.obs, entry.name);
			if (badges) {
				td.innerHTML = badges;
				td.title = `${entry.name} traps (${entry.obs}) — green = ok, red = trap fired`;
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

		for (const entry of s.lessons) {
			if (entry.hasFollowCol) {
				const fc = document.createElement("td");
				fc.className = "follow clickable asn-sep";
				fc.title = `Open ${entry.name} lesson`;
				fc.addEventListener("click", () => openLessonDiff(s, entry));
				if (entry.follow != null) {
					fc.textContent = entry.follow.toFixed(0) + "%";
					fc.style.color = followFg(entry.follow);
				}
				tr.appendChild(fc);
				tr.appendChild(cell(obsText(entry.lesson_obs)));

				const gc = document.createElement("td");
				gc.className = "follow clickable asn-col";
				gc.title = `Open ${entry.name} assignment`;
				gc.addEventListener("click", () => openAssignDiff(s, entry));
				if (entry.grade != null) {
					gc.textContent = entry.grade;
					gc.style.color = followFg((entry.grade / 5) * 100);
					gc.style.fontWeight = "700";
				}
				tr.appendChild(gc);
				const stc1 = document.createElement("td");
				stc1.textContent = entry.status || "";
				const sc1 = statusCellCls(entry.status);
				stc1.className = sc1 || "asn-col";
				tr.appendChild(stc1);
				tr.appendChild(obsCell(entry, "asn-col"));
			} else {
				const gc = document.createElement("td");
				gc.className = "follow clickable asn-sep asn-col";
				gc.title = `Open ${entry.name} assignment`;
				gc.addEventListener("click", () => openAssignDiff(s, entry));
				if (entry.grade != null) {
					gc.textContent = entry.grade;
					gc.style.color = followFg((entry.grade / 5) * 100);
					gc.style.fontWeight = "700";
				}
				tr.appendChild(gc);
				const stc2 = document.createElement("td");
				stc2.textContent = entry.status || "";
				const sc2 = statusCellCls(entry.status);
				stc2.className = sc2 || "asn-col";
				tr.appendChild(stc2);
				tr.appendChild(obsCell(entry, "asn-col"));
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
	table.appendChild(tbody);
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
	if (pct < 60) return _cssVar("--clr-orange");
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

function trapBadges(raw, assignmentName) {
	const code = (raw ?? "").trim();
	if (!/^[01]+$/.test(code)) return null;
	const schema = _trapSchema[(assignmentName || "").toLowerCase()];
	if (!schema || schema.length !== code.length) return null;
	return schema
		.map((t, i) => {
			const fired = code[i] === "0";
			const clr = fired ? THEME.red : THEME.green;
			const title = `${t.label} — ${fired ? "trap fired (0)" : "ok (1)"}`;
			return (
				`<span title="${escHtml(title)}" style="display:inline-block;` +
				`width:9px;height:9px;border-radius:2px;margin:0 1px;` +
				`vertical-align:middle;background:${clr}"></span>`
			);
		})
		.join("");
}

async function openLessonDiff(student, entry) {
	const key = findHandle(_lessonHandles, entry.name);
	console.log(
		"[overview] openLessonDiff student.id =",
		student.id,
		"entry.name =",
		entry.name,
		"entry.follow =",
		entry.follow,
		"resolved lesson folder key =",
		key,
	);
	if (!key) {
		alert(`No lesson folder found for "${entry.name}".`);
		return;
	}
	await openDiff(_lessonHandles[key], student, entry.follow);
}
async function openAssignDiff(student, entry) {
	const key = findHandle(_assignHandles, entry.name);
	console.log(
		"[overview] openAssignDiff student.id =",
		student.id,
		"entry.name =",
		entry.name,
		"resolved assign folder key =",
		key,
	);
	if (!key) {
		alert(`No assignment folder found for "${entry.name}".`);
		return;
	}
	await openDiff(_assignHandles[key], student, null);
}
function findHandle(handles, name) {
	const nl = name.toLowerCase();
	if (handles[nl]) return nl;
	for (const k of Object.keys(handles))
		if (k.includes(nl) || nl.includes(k)) return k;
	return null;
}
function attachLessonGroup(th, assignment) {
	const key = findHandle(_lessonHandles, assignment.name);
	if (!key) return;
	const handle = _lessonHandles[key];
	th.classList.add("clickable");
	th.title = `Open ${assignment.name} timeline`;
	th.addEventListener("click", async () => {
		try {
			const perm = await handle.requestPermission({ mode: "read" });
			if (perm !== "granted") {
				alert(`Permission denied for "${assignment.name}" folder.`);
				return;
			}
			await _idbSet("lastDir", handle);
			window.open("timeline.html?autoload=1", "_blank");
		} catch (e) {
			alert("Could not open timeline: " + e.message);
		}
	});
}
const _OVERVIEW_IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|ico|bmp)$/i;
const _OVERVIEW_CODE_EXT = /\.(html|css|js|py)$/i;

async function _readOverviewDiffPayload(dirHandle, student, followPct) {
	const sid = (student.id || "").trim();
	if (!sid)
		throw new Error(`Cannot find anon folder for "${student.name}" (no ID).`);

	console.log(
		"[overview] _readOverviewDiffPayload dirHandle.name =",
		dirHandle.name,
		"sid =",
		sid,
		"followPct =",
		followPct,
	);

	const fileMap = new Map();
	await readDirHandle(dirHandle, "", fileMap, [], { lowercaseKeys: true });
	const anonIdsKeys = [...fileMap.keys()].filter((p) =>
		p.startsWith("anon_ids/"),
	);
	const anonIdFolders = [
		...new Set(anonIdsKeys.map((p) => p.split("/")[1])),
	].sort();
	console.log("[overview] anon_ids/ folders inside lesson:", anonIdFolders);
	console.log(
		"[overview] anon_ids/" + sid.toLowerCase() + "/ present? =",
		anonIdFolders.includes(sid.toLowerCase()),
	);

	const recoEntries = [...fileMap.entries()].filter(
		([p]) => /^reconstructed\//i.test(p) && _OVERVIEW_CODE_EXT.test(p),
	);
	const startEntries = [...fileMap.entries()].filter(
		([p]) => /^start\//i.test(p) && _OVERVIEW_CODE_EXT.test(p),
	);
	const correctEntries = [...fileMap.entries()].filter(
		([p]) => /^correct\//i.test(p) && _OVERVIEW_CODE_EXT.test(p),
	);
	const teacherEntries = recoEntries.length
		? recoEntries
		: startEntries.length
			? startEntries
			: correctEntries;
	const studentPrefix = "anon_ids/" + sid.toLowerCase() + "/";
	const studentEntries = [...fileMap.entries()].filter(
		([p]) => p.startsWith(studentPrefix) && _OVERVIEW_CODE_EXT.test(p),
	);

	const teacherFiles = {};
	for (const [, file] of teacherEntries) {
		teacherFiles[file.name] = await readFileText(file);
	}
	const studentFiles = {};
	for (const [, file] of studentEntries) {
		studentFiles[file.name] = await readFileText(file);
	}

	const imageUris = {};
	const imageEntries = [...fileMap.entries()].filter(
		([p]) =>
			_OVERVIEW_IMAGE_EXT.test(p) &&
			(/^correct\//i.test(p) ||
				/^start\//i.test(p) ||
				p.startsWith(studentPrefix)),
	);
	for (const [, file] of imageEntries) {
		if (!imageUris[file.name]) {
			imageUris[file.name] = await readFileDataUri(file);
		}
	}

	const allMarks = {};
	for (const [mode, fname] of Object.entries(DIFF_MARKS_FILES)) {
		const entry = fileMap.get(studentPrefix + fname.toLowerCase());
		if (entry) {
			try {
				allMarks[mode] = JSON.parse(await readFileText(entry));
			} catch {}
		}
	}

	if (!Object.keys(teacherFiles).length && !Object.keys(studentFiles).length) {
		throw new Error(`No code files found for ${student.name}.`);
	}

	const label = followPct != null ? followPct.toFixed(0) + "%" : "assignment";
	return {
		teacherFiles,
		studentFiles,
		allMarks,
		imageUris,
		title: `${student.id ? escHtml(String(student.id)) + ". " : ""}${escHtml(studentLabel(student))} (${escHtml(label)})`,
	};
}

async function openDiff(dirHandle, student, followPct) {
	try {
		showLoading(true);
		await openDifferentiator(() =>
			_readOverviewDiffPayload(dirHandle, student, followPct),
		);
		showLoading(false);
	} catch (e) {
		showLoading(false);
		alert("Error: " + e.message);
	}
}

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

	const _appendStatsTableAtEnd = () => renderLessonStatsTable(body);

	if (py.assignments) {
		const names6 = py.assignments.map((a) => a.name);
		const names5 = py.assignments
			.filter((a) => a.follow_avg != null)
			.map((a) => a.name);

		const asgNames = ASSIGNMENTS.map((a) => a.name);
		const passCounts = ASSIGNMENTS.map(
			(a) =>
				_students.filter((s) => PASSING.has(s.lessons[a.n - 1].status))
					.length,
		);
		const participCounts = ASSIGNMENTS.map(
			(a) =>
				_students.filter(
					(s) => (s.lessons[a.n - 1].obs ?? "").trim() !== "",
				).length,
		);
		const participMax = Math.max(...participCounts, 1) + 1;
		const failedCounts = participCounts.map((t, i) =>
			Math.max(0, t - passCounts[i]),
		);
		addStackedShareCard(
			body,
			"Students Passing (Assignments)",
			asgNames,
			passCounts,
			participCounts,
			participMax,
		);

		const passedAndFollowedAny = ASSIGNMENTS.map(
			(a) =>
				_students.filter((s) => {
					const l = s.lessons[a.n - 1];
					return (
						PASSING.has(l.status) && l.hasFollowCol && l.follow != null
					);
				}).length,
		);
		addStackedShareCard(
			body,
			"Passed & Followed Lesson",
			asgNames,
			passedAndFollowedAny,
			passCounts,
			participMax,
		);

		const failedAndFollowedAny = ASSIGNMENTS.map(
			(a) =>
				_students.filter((s) => {
					const l = s.lessons[a.n - 1];
					return (
						(l.obs ?? "").trim() !== "" &&
						!PASSING.has(l.status) &&
						l.hasFollowCol &&
						l.follow != null
					);
				}).length,
		);
		addStackedShareCard(
			body,
			"Failed & Followed Lesson",
			asgNames,
			failedAndFollowedAny,
			failedCounts,
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
		const submittedAssn = py.assignments.map((a) => a.n_submitted ?? 0);

		const troubleAssn = py.assignments.map((a) => a.n_trouble ?? 0);
		addStackedShareCard(
			body,
			"Trouble (Assignments)",
			names6,
			troubleAssn,
			submittedAssn,
			Math.max(...submittedAssn, 1) + 1,
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
			const lessonNames = lessonTroubleEntries.map((a) => a.name);
			addStackedShareCard(
				body,
				"Trouble (Lessons)",
				lessonNames,
				lessonTroubleVals,
				lessonTotals,
				Math.max(...lessonTotals, 1) + 1,
			);
		}

		const aiAssn = py.assignments.map((a) => a.n_ai ?? 0);
		addStackedShareCard(
			body,
			"AI Use (Assignments)",
			names6,
			aiAssn,
			submittedAssn,
			Math.max(...submittedAssn, 1) + 1,
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
	}

	{
		const scatterAssns = ASSIGNMENTS.filter((a) => a.follow != null);
		const nonEmpty = scatterAssns.filter((a) =>
			_students.some(
				(s) =>
					s.lessons[a.n - 1].follow != null &&
					s.lessons[a.n - 1].grade != null,
			),
		);
		nonEmpty.forEach((a, idx) => {
			const points = _students
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

	if (py.early_ai?.length) {
		const card = mkCard(body, "Early AI & Course Pass Rate", "mid");
		let html =
			'<table class="st-tbl"><tr><th>Group</th><th>With AI</th><th>Without AI</th><th>Fisher p</th></tr>';
		py.early_ai.forEach((e) => {
			html +=
				`<tr><td>${escHtml(e.label)}</td>` +
				`<td>${e.with_ai_pass_rate != null ? `${fmtPct(e.with_ai_pass_rate)} (n=${e.n_with})` : "—"}</td>` +
				`<td>${e.without_ai_pass_rate != null ? `${fmtPct(e.without_ai_pass_rate)} (n=${e.n_without})` : "—"}</td>` +
				`<td>${e.fisher_p != null ? fmtP(e.fisher_p) : "—"}</td></tr>`;
		});
		card.insertAdjacentHTML("beforeend", html + "</table>");
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

	if (py.per_language_follow?.length) {
		const card = mkCard(body, "Per-Language Follow vs Final Grade", "sm");
		let html =
			'<table class="st-tbl"><tr><th>Lang</th><th>Mean</th><th>r</th><th>ρ</th><th>p(ρ)</th><th>n</th></tr>';
		py.per_language_follow.forEach((e) => {
			html +=
				`<tr><td>${escHtml(e.lang)}</td>` +
				`<td>${e.mean != null ? e.mean.toFixed(1) : "—"}</td>` +
				`<td>${fmtR(e.r)}</td><td>${fmtR(e.rho)}</td>` +
				`<td>${fmtP(e.p_rho)}</td><td>${e.n}</td></tr>`;
		});
		card.insertAdjacentHTML("beforeend", html + "</table>");
	}

	if (py.per_language_follow_per_lesson?.length) {
		const card = mkCard(
			body,
			"Per-Language Follow vs Assignment Grade (per lesson)",
			"mid",
		);
		let html =
			'<table class="st-tbl"><tr><th>Lesson</th><th>Lang</th><th>r</th><th>ρ</th><th>p(ρ)</th><th>n</th></tr>';
		py.per_language_follow_per_lesson.forEach((e) => {
			html +=
				`<tr><td>${escHtml(e.lesson)}</td><td>${escHtml(e.lang)}</td>` +
				`<td>${fmtR(e.r)}</td><td>${fmtR(e.rho)}</td>` +
				`<td>${fmtP(e.p_rho)}</td><td>${e.n}</td></tr>`;
		});
		card.insertAdjacentHTML("beforeend", html + "</table>");
	}

	if (py.lesson_interactions?.length) {
		const card = mkCard(body, "Lesson Interactions (A / Q / H)", "sm");
		let html =
			'<table class="st-tbl"><tr><th>Lesson</th>' +
			"<th>A</th><th>Q</th><th>H</th></tr>";
		py.lesson_interactions.forEach((e) => {
			html +=
				`<tr><td>${escHtml(e.lesson)}</td>` +
				`<td>${e.A_sum ?? "—"}</td>` +
				`<td>${e.Q_sum ?? "—"}</td>` +
				`<td>${e.H_sum ?? "—"}</td>` +
				"</tr>";
		});
		card.insertAdjacentHTML("beforeend", html + "</table>");
	}

	if (py.comment_diff_per_lesson?.length) {
		const card = mkCard(
			body,
			"Comments per Lesson vs Assignment Grade (Spearman ρ)",
			"wide",
		);
		const f = (v, dec = 1, sign = "") =>
			v != null ? (sign && v > 0 ? "+" : "") + v.toFixed(dec) : "—";
		let html =
			'<table class="st-tbl"><tr><th>Lesson</th>' +
			"<th>mean C+</th><th>ρ(C+)</th><th>p</th>" +
			"<th>mean C-</th><th>ρ(C-)</th><th>p</th>" +
			"<th>mean Δ</th><th>ρ(Δ)</th><th>p</th>" +
			"<th>n</th></tr>";
		py.comment_diff_per_lesson.forEach((e) => {
			html +=
				`<tr><td>${escHtml(e.lesson)}</td>` +
				`<td>${f(e.mean_cplus)}</td>` +
				`<td>${fmtR(e.rho_cplus)}</td>` +
				`<td>${fmtP(e.p_cplus)}</td>` +
				`<td>${f(e.mean_cminus)}</td>` +
				`<td>${fmtR(e.rho_cminus)}</td>` +
				`<td>${fmtP(e.p_cminus)}</td>` +
				`<td>${f(e.mean_cdiff, 1, "+")}</td>` +
				`<td>${fmtR(e.rho)}</td>` +
				`<td>${fmtP(e.p_rho)}</td>` +
				`<td>${e.n}</td></tr>`;
		});
		card.insertAdjacentHTML("beforeend", html + "</table>");
	}

	if (py.comment_totals?.length) {
		const card = mkCard(
			body,
			"Comment Totals vs Final Grade & Assignment Average",
			"mid",
		);
		let html =
			'<table class="st-tbl"><tr><th>Metric</th><th>mean</th>' +
			"<th>ρ → Final</th><th>p</th>" +
			"<th>ρ → Avg</th><th>p</th>" +
			"<th>n</th></tr>";
		py.comment_totals.forEach((e) => {
			const meanStr =
				e.mean != null
					? (e.label.includes("Diff") && e.mean > 0 ? "+" : "") +
						e.mean.toFixed(1)
					: "—";
			html +=
				`<tr><td>${escHtml(e.label)}</td>` +
				`<td>${meanStr}</td>` +
				`<td>${fmtR(e.final_grade_rho)}</td>` +
				`<td>${fmtP(e.final_grade_p_rho)}</td>` +
				`<td>${fmtR(e.avg_assignments_rho)}</td>` +
				`<td>${fmtP(e.avg_assignments_p_rho)}</td>` +
				`<td>${e.final_grade_n ?? e.avg_assignments_n ?? "—"}</td></tr>`;
		});
		card.insertAdjacentHTML("beforeend", html + "</table>");
	}

	_appendStatsTableAtEnd();
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
	const tPy = numFor("tokens_py");
	const tComment = numFor("tokens_comment");
	const tDev = numFor("tokens_dev");
	if (
		anyPos(tHtml) ||
		anyPos(tCss) ||
		anyPos(tJs) ||
		anyPos(tPy) ||
		anyPos(tComment) ||
		anyPos(tDev)
	) {
		const card = mkCard(body, "Tokens per Lesson");
		const box = el("div", "chart-box");
		card.appendChild(box);
		const totals = lessonNames.map(
			(_, i) =>
				(tHtml[i] ?? 0) +
				(tCss[i] ?? 0) +
				(tJs[i] ?? 0) +
				(tPy[i] ?? 0) +
				(tComment[i] ?? 0) +
				(tDev[i] ?? 0),
		);
		const stackNames = ["HTML", "CSS", "JS", "Py", "Comment", "Dev"];
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
			_cssVar("--clr-black"),
			_cssVar("--clr-green"),
			_cssVar("--clr-purple"),
		];
		const stackData = [tHtml, tCss, tJs, tPy, tComment, tDev];
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
			"Typing Duration (min)",
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
		if (codeCounts.some((v) => v > 0)) {
			addBarCard(
				body,
				"Code Segments per Lesson",
				lessonNames,
				codeCounts,
				THEME.label,
				Math.max(...codeCounts, 1) + 1,
				"int",
			);
		}

		_addDurationBoxCard(
			body,
			"Code Segment Duration (s)",
			lessonNames,
			segmentsByLesson.map((segs) =>
				segs.filter((s) => s.kind !== "p").map((s) => s.dur),
			),
		);
		_addDurationBoxCard(
			body,
			"Pause Duration (s)",
			lessonNames,
			segmentsByLesson.map((segs) =>
				segs.filter((s) => s.kind === "p").map((s) => s.dur),
			),
		);

		const codeSegTokensByLesson = segmentsByLesson.map((segs) =>
			segs
				.filter((s) => s.kind !== "p" && s.tokens != null)
				.map((s) => s.tokens),
		);
		if (codeSegTokensByLesson.some((arr) => arr.length)) {
			_addDurationBoxCard(
				body,
				"Tokens per Code Segment",
				lessonNames,
				codeSegTokensByLesson,
			);
		}
	}

	const pauseCnt = numFor("pause_count");
	const pauseAvg = numFor("pause_avg_s");
	if (anyPos(pauseCnt)) {
		addBarCard(
			body,
			"Pause Count",
			lessonNames,
			pauseCnt.map((v) => v ?? 0),
			THEME.label,
			Math.max(...pauseCnt.filter((v) => v != null), 1) + 1,
			"int",
		);
	}
	if (anyPos(pauseAvg)) {
		addBarCard(
			body,
			"Avg Pause Duration (s)",
			lessonNames,
			pauseAvg.map((v) => v ?? 0),
			THEME.label,
			Math.max(...pauseAvg.filter((v) => v != null), 1) * 1.1,
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

function _sortStudents(list, key) {
	const sl = [...list];
	if (key === "avg-follow") sl.sort((a, b) => followAvg(b) - followAvg(a));
	else if (key === "total-follow")
		sl.sort((a, b) => followTotal(b) - followTotal(a));
	else if (key === "avg-grade")
		sl.sort((a, b) => (b.avg_assignments ?? -1) - (a.avg_assignments ?? -1));
	else if (key === "total-grade")
		sl.sort((a, b) => gradeTotal(b) - gradeTotal(a));
	else if (key === "ai-count") sl.sort((a, b) => aiCount(a) - aiCount(b));
	else sl.sort((a, b) => a.name.localeCompare(b.name));
	return sl;
}

function sortedStudents() {
	return _sortStudents(_students, _curSort);
}
const followAvg = (s) => {
	const vs = s.lessons
		.filter((l) => l.hasFollowCol && l.follow != null)
		.map((l) => l.follow);
	return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : -1;
};
const followTotal = (s) =>
	s.lessons
		.filter((l) => l.hasFollowCol && l.follow != null)
		.reduce((a, l) => a + l.follow, 0);
const gradeTotal = (s) =>
	s.lessons.filter((l) => l.grade != null).reduce((a, l) => a + l.grade, 0);
const aiCount = (s) =>
	s.lessons.reduce(
		(n, l) => n + ((l.obs || "").match(/\bAI\b/gi)?.length || 0),
		0,
	);

document.querySelectorAll(".sort-bar button[data-sort]").forEach((btn) => {
	btn.addEventListener("click", () => {
		_curSort = btn.dataset.sort;
		document
			.querySelectorAll(".sort-bar button[data-sort]")
			.forEach((b) => b.classList.toggle("active", b === btn));
		renderProgress();
	});
});

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

let _clusterCharts = [];
let _clusterSeed = 42;
let _clusterSort = "total-follow";

const _DEFAULT_MANUAL_A_PARTITIONS = [
	"80, 81, 78, 50, 55, 23, 82, 20, 24, 3",
	"70, 77, 48, 72, 18, 30, 76, 67, 4, 74, 58, 34, 69, 35, 49, 8",
	"61, 29, 25, 11, 44, 63, 71, 31, 47, 45, 36, 65, 10, 41, 38, 60, 28, 17, 62, 73, 84, 13, 59, 66, 15, 22, 53",
	"rest",
].join("\n");

const _DEFAULT_MANUAL_B_PARTITIONS = [
	"80, 81, 78, 23, 20, 30, 61, 29, 44, 70, 50, 4",
	"24, 3, 72, 18, 11, 63, 45, 38, 10, 53, 59, 47, 74, 60, 34",
	"rest",
].join("\n");

const _MANUAL_LS_KEYS = {
	A: "cluster_manual_text_a_v1",
	B: "cluster_manual_text_b_v1",
};
const _MANUAL_DEFAULTS = {
	A: _DEFAULT_MANUAL_A_PARTITIONS,
	B: _DEFAULT_MANUAL_B_PARTITIONS,
};

function _clusterMode() {
	const v = document.getElementById("cluster-mode")?.value;
	return v === "manualA" || v === "manualB" ? v : "kmeans";
}

function _manualSlot() {
	return _clusterMode() === "manualB" ? "B" : "A";
}

function _clusterOpts() {
	return {
		k: Math.max(
			2,
			Math.min(25, +document.getElementById("cluster-k")?.value || 4),
		),
		useFollow:
			document.getElementById("cluster-feat-follow")?.checked ?? true,
		useGrade: document.getElementById("cluster-feat-grade")?.checked ?? true,
		useLang: document.getElementById("cluster-feat-lang")?.checked ?? true,
	};
}

function _parseManualPartitions(text, students) {
	const lines = String(text || "")
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => l.length);
	const idMap = new Map();
	students.forEach((s, i) => {
		if (s.id != null && s.id !== "") idMap.set(String(s.id).trim(), i);
	});
	const labels = new Array(students.length).fill(-1);
	let restLineIdx = -1;
	lines.forEach((line, ci) => {
		if (/^rest$/i.test(line)) {
			restLineIdx = ci;
			return;
		}
		const tokens = line.split(/[\s,;]+/).filter(Boolean);
		for (const t of tokens) {
			const idx = idMap.get(t);
			if (idx != null && labels[idx] === -1) labels[idx] = ci;
		}
	});
	if (restLineIdx === -1) restLineIdx = lines.length;
	for (let i = 0; i < labels.length; i++) {
		if (labels[i] === -1) labels[i] = restLineIdx;
	}
	const numClusters = Math.max(
		lines.length,
		restLineIdx === lines.length ? lines.length + 1 : 0,
	);
	return { labels, numClusters };
}

function _applyClusterModeUI() {
	const mode = _clusterMode();
	const isManual = mode === "manualA" || mode === "manualB";
	document
		.querySelectorAll(".cluster-kmeans-only")
		.forEach((el) => (el.style.display = mode === "kmeans" ? "" : "none"));
	const panel = document.getElementById("cluster-manual-panel");
	if (panel) panel.style.display = isManual ? "" : "none";
	const slot = _manualSlot();
	document
		.querySelectorAll("[data-manual]")
		.forEach(
			(el) => (el.style.display = el.dataset.manual === slot ? "" : "none"),
		);
}

function _buildClusterFeatures(students, opts) {
	const numOrNull = (v) => (v == null || isNaN(v) ? null : +v);
	const rows = [];
	for (const s of students) {
		const row = [];
		for (const l of s.lessons) {
			if (opts.useFollow) {
				row.push(l.hasFollowCol ? numOrNull(l.follow) : null);
			}
			if (opts.useGrade) row.push(numOrNull(l.grade));
			if (opts.useLang) {
				for (const { entryKey } of LANG_FOLLOW_KEYS) {
					row.push(l.hasFollowCol ? numOrNull(l[entryKey]) : null);
				}
			}
		}
		rows.push(row);
	}
	const nCols = rows[0]?.length || 0;
	for (let c = 0; c < nCols; c++) {
		let hi = 0;
		for (const r of rows) {
			const v = r[c];
			if (v != null && v > hi) hi = v;
		}
		if (hi <= 0) {
			for (const r of rows) r[c] = 0;
			continue;
		}
		for (const r of rows) {
			const v = r[c];
			r[c] = v == null ? -1 : v / hi;
		}
	}
	return rows;
}

function _seededRng(seed) {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 0x100000000;
	};
}

function _sqDist(a, b) {
	let d = 0;
	for (let i = 0; i < a.length; i++) {
		const v = a[i] - b[i];
		d += v * v;
	}
	return d;
}

function _kmeansPlusPlusInit(points, k, rng) {
	const n = points.length;
	const centroids = [points[Math.floor(rng() * n)].slice()];
	while (centroids.length < k) {
		const d2 = points.map((p) => {
			let m = Infinity;
			for (const c of centroids) {
				const d = _sqDist(p, c);
				if (d < m) m = d;
			}
			return m;
		});
		const sum = d2.reduce((a, b) => a + b, 0);
		if (!sum) {
			centroids.push(points[Math.floor(rng() * n)].slice());
			continue;
		}
		let r = rng() * sum;
		let picked = n - 1;
		for (let i = 0; i < n; i++) {
			r -= d2[i];
			if (r <= 0) {
				picked = i;
				break;
			}
		}
		centroids.push(points[picked].slice());
	}
	return centroids;
}

function _kmeans(points, k, maxIter = 10000, seed = 42) {
	if (!points.length) return { labels: [], centroids: [] };
	if (points.length <= k) {
		return {
			labels: points.map((_, i) => i),
			centroids: points.map((p) => p.slice()),
		};
	}
	const rng = _seededRng(seed);
	let centroids = _kmeansPlusPlusInit(points, k, rng);
	const labels = new Array(points.length).fill(0);
	for (let iter = 0; iter < maxIter; iter++) {
		let changed = false;
		for (let i = 0; i < points.length; i++) {
			let best = 0,
				bestD = Infinity;
			for (let c = 0; c < k; c++) {
				const d = _sqDist(points[i], centroids[c]);
				if (d < bestD) {
					bestD = d;
					best = c;
				}
			}
			if (labels[i] !== best) {
				labels[i] = best;
				changed = true;
			}
		}
		const sums = Array.from({ length: k }, () =>
			new Array(points[0].length).fill(0),
		);
		const counts = new Array(k).fill(0);
		for (let i = 0; i < points.length; i++) {
			const c = labels[i];
			counts[c]++;
			for (let j = 0; j < points[0].length; j++) sums[c][j] += points[i][j];
		}
		for (let c = 0; c < k; c++) {
			if (counts[c] === 0) {
				const farthest = points
					.map((p, i) => ({
						i,
						d: _sqDist(p, centroids[labels[i]]),
					}))
					.sort((a, b) => b.d - a.d)[0];
				centroids[c] = points[farthest.i].slice();
			} else {
				for (let j = 0; j < points[0].length; j++)
					centroids[c][j] = sums[c][j] / counts[c];
			}
		}
		if (!changed) break;
	}
	return { labels, centroids };
}

function renderClusters() {
	_clusterCharts.forEach((c) => {
		try {
			c.destroy();
		} catch {}
	});
	_clusterCharts = [];

	const body = document.getElementById("clusters-body");
	if (!body) return;
	body.innerHTML = "";
	if (!_students.length) return;

	const mode = _clusterMode();
	const labelsX = ASSIGNMENTS.map((a) => a.name);
	let labels, centroids, k;

	if (mode === "manualA" || mode === "manualB") {
		const slot = _manualSlot();
		const ta = document.querySelector(`[data-manual-text="${slot}"]`);
		const text = (ta && ta.value) || _MANUAL_DEFAULTS[slot];
		const parsed = _parseManualPartitions(text, _students);
		labels = parsed.labels;
		k = parsed.numClusters;
		const opts = { useFollow: true, useGrade: true, useLang: true };
		const features = _buildClusterFeatures(_students, opts);
		const nCols = features[0]?.length || 0;
		centroids = Array.from({ length: k }, () => new Array(nCols).fill(0));
		const counts = new Array(k).fill(0);
		for (let i = 0; i < _students.length; i++) {
			const c = labels[i];
			counts[c]++;
			for (let j = 0; j < nCols; j++) centroids[c][j] += features[i][j];
		}
		for (let c = 0; c < k; c++) {
			if (counts[c] === 0) continue;
			for (let j = 0; j < nCols; j++) centroids[c][j] /= counts[c];
		}
	} else {
		const opts = _clusterOpts();
		if (!opts.useFollow && !opts.useGrade && !opts.useLang) {
			body.innerHTML =
				'<div class="cluster-empty">Pick at least one feature to cluster on.</div>';
			return;
		}
		const features = _buildClusterFeatures(_students, opts);
		k = Math.min(opts.k, _students.length);
		const res = _kmeans(features, k, 10000, _clusterSeed);
		labels = res.labels;
		centroids = res.centroids;
	}

	const buckets = Array.from({ length: k }, () => []);
	_students.forEach((s, i) => buckets[labels[i]].push(s));

	const centroidMean = (c) =>
		c && c.length ? c.reduce((a, b) => a + b, 0) / c.length : 0;
	const ordered = buckets
		.map((bucket, idx) => ({
			idx,
			bucket,
			score: centroidMean(centroids[idx]),
		}))
		.filter((b) => b.bucket.length)
		.sort((a, b) => b.score - a.score);

	ordered.forEach((entry, displayIdx) => {
		const { bucket } = entry;
		const section = el("div", "cluster-section");
		const header = el("div", "cluster-header");
		const h3 = el("h3");
		h3.textContent = `Cluster ${displayIdx + 1}`;
		header.appendChild(h3);
		const meta = el("span", "cluster-meta");
		const followVals = bucket.map(followAvg).filter((v) => v >= 0);
		const gradeVals = bucket
			.map((s) => s.avg_assignments)
			.filter((v) => v != null);
		const summarize = (vals, digits, suffix) => {
			if (!vals.length) return "—";
			const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
			const mn = Math.min(...vals);
			const mx = Math.max(...vals);
			return `${avg.toFixed(digits)}${suffix} (${mn.toFixed(digits)}–${mx.toFixed(digits)})`;
		};
		meta.textContent = `${bucket.length} student${bucket.length === 1 ? "" : "s"} · follow ${summarize(followVals, 1, "%")} · grade ${summarize(gradeVals, 2, "")}`;
		header.appendChild(meta);
		section.appendChild(header);
		const grid = el("div", "cluster-grid");
		const sortedBucket = _sortStudents(bucket, _clusterSort);
		for (const s of sortedBucket) {
			const { card, chart } = _buildStudentProgressCard(s, labelsX);
			grid.appendChild(card);
			_clusterCharts.push(chart);
		}
		section.appendChild(grid);
		body.appendChild(section);
	});
}

document.getElementById("cluster-k")?.addEventListener("change", () => {
	if (_students.length) renderClusters();
});
document.getElementById("cluster-recluster")?.addEventListener("click", () => {
	_clusterSeed = (_clusterSeed * 1103515245 + 12345) >>> 0;
	if (_students.length) renderClusters();
});
["cluster-feat-follow", "cluster-feat-grade", "cluster-feat-lang"].forEach(
	(id) => {
		document.getElementById(id)?.addEventListener("change", () => {
			if (_students.length) renderClusters();
		});
	},
);

(function _initClusterModeUI() {
	let legacy = null;
	try {
		legacy = localStorage.getItem("cluster_manual_text_v2");
	} catch {}
	for (const slot of ["A", "B"]) {
		const ta = document.querySelector(`[data-manual-text="${slot}"]`);
		if (!ta || ta.value) continue;
		let saved = null;
		try {
			saved = localStorage.getItem(_MANUAL_LS_KEYS[slot]);
		} catch {}
		if (!saved && slot === "A" && legacy) {
			saved = legacy;
			try {
				localStorage.setItem(_MANUAL_LS_KEYS.A, legacy);
				localStorage.removeItem("cluster_manual_text_v2");
			} catch {}
		}
		ta.value = saved || _MANUAL_DEFAULTS[slot];
	}
	_applyClusterModeUI();
})();

document.getElementById("cluster-mode")?.addEventListener("change", () => {
	_applyClusterModeUI();
	if (_students.length) renderClusters();
});

document
	.getElementById("cluster-manual-apply")
	?.addEventListener("click", () => {
		const slot = _manualSlot();
		const ta = document.querySelector(`[data-manual-text="${slot}"]`);
		try {
			if (ta) localStorage.setItem(_MANUAL_LS_KEYS[slot], ta.value);
		} catch {}
		if (_students.length) renderClusters();
	});

document.querySelectorAll(".cluster-sort[data-cluster-sort]").forEach((btn) => {
	btn.addEventListener("click", () => {
		_clusterSort = btn.dataset.clusterSort;
		document
			.querySelectorAll(".cluster-sort[data-cluster-sort]")
			.forEach((b) => b.classList.toggle("active", b === btn));
		if (_students.length) renderClusters();
	});
});

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

function mkCard(page, title, size = "sm") {
	const card = el("div", `stat-card ${size}`);
	const h = el("h3");
	h.textContent = title;
	card.appendChild(h);
	page.appendChild(card);
	return card;
}
function el(tag, cls = "") {
	const e = document.createElement(tag);
	if (cls) e.className = cls;
	return e;
}

document.querySelectorAll("#toolbar button[data-page]").forEach((btn) => {
	btn.addEventListener("click", () => {
		document
			.querySelectorAll("#toolbar button[data-page]")
			.forEach((b) => b.classList.toggle("active", b === btn));
		showPage(btn.dataset.page);
	});
});
function showPage(name) {
	document
		.querySelectorAll(".page")
		.forEach((p) => p.classList.remove("active"));
	document.getElementById("page-" + name).classList.add("active");
	if (name === "students") requestAnimationFrame(applyStickyColumns);
}
