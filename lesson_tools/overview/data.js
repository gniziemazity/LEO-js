"use strict";

const _COL_ALIASES = {
	id: ["ID"],
	name: ["Name"],
	number: ["Number"],
	pre_typing: [
		"Pre Typing",
		"Pre KPM",
		"Pre-typing",
		"Pre K/min",
		"Pre K/Min",
	],
	post_typing: [
		"Post Typing",
		"Post KPM",
		"Post-typing",
		"Post K/min",
		"Post K/Min",
	],
	self_eval: ["Self Eval", "Self Evaluation", "Self"],
	kahoot: ["Kahoot"],
	quiz_stii: ["Final Quiz", "Quiz Stii", "Stii", "Știi"],
	final_grade: ["Final Grade", "Grade"],
	avg_assignments: ["Avg Assignments", "Avg Grade"],
	participation: ["Participation"],
	answers: ["Total Answers", "Answers"],
	questions: ["Total Questions", "Questions"],
	help: ["Total Help", "Help"],
	excluded: ["Category", "Excluded"],
};

const _KPM_FALLBACK_NAMES = ["k/min", "kpm", "kpm avg", "k/min avg"];

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
		let km = [];
		for (const lower of _KPM_FALLBACK_NAMES) {
			km = km.concat(findAllByName(lower));
		}
		km = [...new Set(km)].sort((a, b) => a - b);
		if (COL.pre_typing == null) {
			const before = km.find((i) => i < firstGrade);
			if (before != null) COL.pre_typing = before;
		}
		if (COL.post_typing == null) {
			const after = km.find((i) => i > lastGrade);
			if (after != null) COL.post_typing = after;
		}
		console.log(
			"[overview] KPM columns detected: pre =",
			COL.pre_typing,
			"post =",
			COL.post_typing,
			"  candidate KPM-like columns:",
			km,
			"  headers at those indices:",
			km.map((i) => headerRow[i]),
		);
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
		const ds = new FsDataSource({
			idbKey: "lastCourseDir",
			dbName: "grades-dash",
		});
		await ds.open();
		await _idbSet(IDB_KEY_COURSE_ROOT, ds.rootHandle);
		showLoading(true);
		await ds.load();
		await loadCourse(ds);
		showLoading(false);
	} catch (e) {
		showLoading(false);
		if (e.name !== "AbortError") alert("Error: " + e.message);
	}
}

function _pickOverviewFile(files) {
	const canon = files.get("overview.xlsx") || files.get("overviewplus.xlsx");
	if (canon) return canon;
	let latest = null;
	let latestStamp = "";
	for (const path of files.keys()) {
		if (path.includes("/")) continue;
		const m = path.match(/^overview_(\d{8}-\d{6})\.xlsx$/i);
		if (m && m[1] > latestStamp) {
			latest = files.get(path);
			latestStamp = m[1];
		}
	}
	return latest;
}

async function loadCourse(ds) {
	if (typeof XLSX === "undefined") {
		alert("SheetJS not loaded.");
		return;
	}

	console.log("[overview] loadCourse rootName =", ds.rootName);

	const gradesFile = _pickOverviewFile(ds.files);
	const pyStatsFile = ds.files.get("grades_stats.json") || null;
	if (!gradesFile) {
		alert("No Overview.xlsx or OverviewPlus.xlsx found.");
		return;
	}
	console.log("[overview] picked grades file:", gradesFile.name);

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
	_artefactSchema = _pyStats?.artefact_schema || {};

	_globalStudentMap = {};
	_realToAlterMap = {};
	const studentsCsvFile = ds.files.get("students.csv");
	if (studentsCsvFile) {
		try {
			const text = await readCsvText(studentsCsvFile);
			_globalStudentMap = parseStudentCsv(text);
			_realToAlterMap = parseAlterEgoMap(text, { keyTransform: _nfc });
		} catch {}
	}
	const nameMapCsvFile = ds.files.get("name_map.csv");
	if (nameMapCsvFile) {
		try {
			const text = await readCsvText(nameMapCsvFile);
			const m = parseAlterEgoMap(text, { keyTransform: _nfc });
			if (Object.keys(m).length) _realToAlterMap = m;
		} catch {}
	}

	_lessonHandles = {};
	_assignHandles = {};
	for (const path of ds.files.keys()) {
		const m = path.match(/^(lessons|assignments)\/([^/]+)\//);
		if (!m) continue;
		const bucket = m[1] === "lessons" ? _lessonHandles : _assignHandles;
		bucket[m[2].toLowerCase()] = true;
	}
	for (const name of Object.keys(_assignHandles)) {
		const f = ds.files.get(`assignments/${name}/artefact_labels.csv`);
		if (!f) continue;
		try {
			const labels = parseArtefactLabelsCsv(await readCsvText(f));
			if (labels.length) _artefactSchema[name] = labels;
		} catch {}
	}
	for (const name of Object.keys(_lessonHandles)) {
		if (_artefactSchema[name]) continue;
		const f = ds.files.get(`lessons/${name}/artefact_labels.csv`);
		if (!f) continue;
		try {
			const labels = parseArtefactLabelsCsv(await readCsvText(f));
			if (labels.length) _artefactSchema[name] = labels;
		} catch {}
	}
	console.log(
		"[overview] lesson folders:",
		Object.keys(_lessonHandles),
		"assignment folders:",
		Object.keys(_assignHandles),
	);

	_submittedIds = await _gatherSubmittedIds(ds);

	finishLoad(gradesFile.name);
}

async function _gatherSubmittedIds(ds) {
	const out = {};
	let deep = false;
	for (const path of ds.files.keys()) {
		const m = path.match(/^assignments\/([^/]+)\/anon_ids\/([^/]+)\//);
		if (!m) continue;
		deep = true;
		const key = `assignments/${m[1].toLowerCase()}`;
		(out[key] || (out[key] = new Set())).add(String(m[2]).toLowerCase());
	}
	if (deep || typeof listServerDir !== "function") return out;
	let dirs;
	try {
		dirs = await listServerDir(`/grades-data/assignments/`);
	} catch {
		return out;
	}
	for (const d of dirs || []) {
		if (!d || d.kind !== "directory" || !d.name) continue;
		let sidDirs;
		try {
			sidDirs = await listServerDir(
				`/grades-data/assignments/${d.name}/anon_ids/`,
			);
		} catch {
			continue;
		}
		const set = new Set();
		await Promise.all(
			(sidDirs || []).map(async (e) => {
				if (!e || e.kind !== "directory" || !e.name) return;
				try {
					const inner = await listServerDir(
						`/grades-data/assignments/${d.name}/anon_ids/${e.name}/`,
					);
					if ((inner || []).some((x) => x && x.name)) {
						set.add(String(e.name).toLowerCase());
					}
				} catch {}
			}),
		);
		if (set.size) out[`assignments/${d.name.toLowerCase()}`] = set;
	}
	return out;
}

function _hasSubmission(group, name, sid) {
	const set = _submittedIds[`${group}/${String(name).toLowerCase()}`];
	if (!set) return true;
	return set.has(String(sid).toLowerCase());
}

function finishLoad(filename) {
	[..._scatterCharts, ..._barCharts].forEach((c) => {
		try {
			c.destroy();
		} catch {}
	});
	_scatterCharts = [];
	_barCharts = [];
	document.getElementById("landing").style.display = "none";
	document.getElementById("toolbar").classList.add("show");
	_clusterSort = "id";
	document
		.querySelectorAll(".cluster-sort[data-cluster-sort]")
		.forEach((b) =>
			b.classList.toggle("active", b.dataset.clusterSort === "id"),
		);
	renderTable();
	renderStats();
	renderClusters();
	showPage("students");
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

	const _excVal = str(COL.excluded).toUpperCase();
	const _nameStr = str(COL.name);
	const _isLlm = _excVal === "LLM" || _excVal === "AI";
	const s = {
		id: str(COL.id),
		name: _nameStr,
		number: str(COL.number),
		excluded: _excVal === "EXCLUDED" || _isLlm,
		ai_flagged: _isLlm,
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
		const _rawStatus = str(a.status);
		const hasAssignment =
			_rawStatus !== "" || str(a.obs) !== "" || num(a.grade) != null;
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
			hasAssignment,
			status: _isLlm
				? PASSING.has(_rawStatus)
					? ""
					: _rawStatus
				: hasAssignment
					? "Pass"
					: "",
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
