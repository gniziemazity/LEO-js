"use strict";

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
