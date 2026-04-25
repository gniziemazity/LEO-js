"use strict";

function _hexToRgba(hex, a) {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	return `rgba(${r},${g},${b},${a})`;
}

const OV_CLR = {
	accent: _cssVar("--clr-accent") || "#007acc",
	red: _cssVar("--clr-red") || "#cc2222",
	label: _cssVar("--clr-label") || "#555",
	muted: _cssVar("--clr-muted") || "#888",
};

function _idbOpen() {
	return new Promise((res, rej) => {
		const req = indexedDB.open("grades-dash", 1);
		req.onupgradeneeded = (e) => e.target.result.createObjectStore("state");
		req.onsuccess = (e) => res(e.target.result);
		req.onerror = () => rej(req.error);
	});
}
async function _idbGet(key) {
	try {
		const db = await _idbOpen();
		return await new Promise((res) => {
			const r = db.transaction("state").objectStore("state").get(key);
			r.onsuccess = () => res(r.result ?? null);
			r.onerror = () => res(null);
		});
	} catch {
		return null;
	}
}
async function _idbSet(key, value) {
	try {
		const db = await _idbOpen();
		await new Promise((res, rej) => {
			const tx = db.transaction("state", "readwrite");
			tx.objectStore("state").put(value, key);
			tx.oncomplete = res;
			tx.onerror = rej;
		});
	} catch {}
}

const COL = {
	id: 0,
	name: 1,
	number: 3,
	pre_typing: 12,
	self_eval: 16,
	quiz_stii: 71,
	post_typing: 74,
	avg_assignments: 75,
	final_grade: 77,
	answers: 83,
	questions: 84,
	help: 85,
};

const ASSIGNMENTS = [
	{
		n: 1,
		follow: 17,
		lesson_obs: 22,
		grade: 23,
		status: 24,
		obs: 25,
		name: "Wall",
	},
	{
		n: 2,
		follow: 26,
		lesson_obs: 31,
		grade: 32,
		status: 33,
		obs: 34,
		name: "Chess",
	},
	{
		n: 3,
		follow: 35,
		lesson_obs: 40,
		grade: 41,
		status: 42,
		obs: 43,
		name: "Sorting",
	},
	{
		n: 4,
		follow: 44,
		lesson_obs: 49,
		grade: 50,
		status: 51,
		obs: 52,
		name: "JS",
	},
	{
		n: 5,
		follow: 53,
		lesson_obs: 58,
		grade: 59,
		status: 60,
		obs: 61,
		name: "QR",
	},
	{
		n: 6,
		follow: null,
		lesson_obs: null,
		grade: 68,
		status: 69,
		obs: 70,
		name: "Web",
	},
];

const PASSING = new Set(["Pass", "Pass'", "Pass*"]);

let _students = [];
let _globalStudentMap = {};
let _lessonHandles = {};
let _assignHandles = {};
let _scatterCharts = [];
let _barCharts = [];
let _progressCharts = [];
let _pyStats = null;
let _curSort = "name";
let _anonMode = "name";

document.getElementById("open-btn").addEventListener("click", pickFolder);

async function pickFolder() {
	try {
		const lastDir = await _idbGet("lastCourseDir");
		const opts = { mode: "read" };
		if (lastDir) opts.startIn = lastDir;
		const handle = await window.showDirectoryPicker(opts);
		await _idbSet("lastCourseDir", handle);
		showLoading(true);
		await loadCourse(handle);
		showLoading(false);
	} catch (e) {
		showLoading(false);
		if (e.name !== "AbortError") alert("Error: " + e.message);
	}
}

(async function tryAutoLoad() {
	const handle = await _idbGet("lastCourseDir");
	if (!handle || handle.kind !== "directory") return;
	try {
		const perm = await handle.requestPermission({ mode: "read" });
		if (perm !== "granted") return;
	} catch {
		return;
	}
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

	let gradesFile = null,
		pyStatsFile = null;
	const gradesCandidates = [];
	for await (const [name, entry] of rootHandle.entries()) {
		if (entry.kind !== "file") continue;
		if (/^grades\.xlsx?$/i.test(name))
			gradesCandidates.unshift(await entry.getFile());
		else if (/^grades.*\.xlsx?$/i.test(name))
			gradesCandidates.push(await entry.getFile());
		if (/^grades_stats\.json$/i.test(name))
			pyStatsFile = await entry.getFile();
	}
	gradesFile = gradesCandidates[0] ?? null;
	if (!gradesFile) {
		alert("No Grades.xls / Grades.xlsx found.");
		return;
	}

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
	const dataRows = rows
		.slice(1, 85)
		.filter(
			(r) =>
				Array.isArray(r) &&
				r[COL.id] != null &&
				String(r[COL.id]).trim() !== "",
		);
	if (!dataRows.length) {
		alert("No student rows found in rows 2-85.");
		return;
	}

	_students = dataRows.map((r) => parseStudent(r));
	_pyStats = null;
	if (pyStatsFile)
		try {
			_pyStats = JSON.parse(await pyStatsFile.text());
		} catch {}

	_globalStudentMap = {};
	try {
		const fh = await rootHandle.getFileHandle("students.csv");
		_globalStudentMap = parseStudentCsv(await (await fh.getFile()).text());
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
		.querySelectorAll(".sort-bar button")
		.forEach((b) => b.classList.toggle("active", b.dataset.sort === "name"));
	renderTable();
	renderStats();
	renderProgress();
	showPage("students");
}

function parseStudentCsv(text) {
	const map = {};
	const lines = text.split(/\r?\n/).filter(Boolean);
	if (lines.length < 2) return map;
	const delim = lines[0].includes(";") ? ";" : ",";
	for (let i = 1; i < lines.length; i++) {
		const parts = lines[i]
			.split(delim)
			.map((s) => s.trim().replace(/^"|"$/g, ""));
		if (parts.length >= 3 && parts[0]) map[parts[0]] = parts[2];
	}
	return map;
}

function parseStudent(r) {
	const str = (c) => (r[c] != null ? String(r[c]).trim() : "");
	const num = (c) => {
		const v = r[c];
		if (v == null || v === "") return null;
		const n = +v;
		return isNaN(n) ? null : n;
	};

	const s = {
		id: str(COL.id),
		name: str(COL.name),
		number: str(COL.number),
		pre_typing: num(COL.pre_typing),
		self_eval: num(COL.self_eval),
		quiz_stii: num(COL.quiz_stii),
		post_typing: num(COL.post_typing),
		avg_assignments: num(COL.avg_assignments),
		final_grade: num(COL.final_grade),
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
			follow: a.follow != null ? num(a.follow) : null,
			lesson_obs: a.lesson_obs != null ? str(a.lesson_obs) : "",
			grade: num(a.grade),
			status: str(a.status),
			obs: str(a.obs),
		};
		if (!PASSING.has(entry.status)) s.passed_course = false;
		s.lessons.push(entry);
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
			grp(a.name, 5, true);
			col("Follow%", "lhd", true);
			col("Obs", "lhd");
			col("Grade", "ahd");
			col("Status", "ahd");
			col("Obs", "ahd");
		} else {
			grp(a.name, 3, true);
			col("Grade", "ahd", true);
			col("Status", "ahd");
			col("Obs", "ahd");
		}
	}
	grp("", 7, true);
	col("Quiz", "", true);
	col("KPM");
	col("Avg");
	col("Final");
	col("Ans");
	col("Qs");
	col("Help");

	thead.appendChild(r1);
	thead.appendChild(r2);
	table.appendChild(thead);

	const tbody = document.createElement("tbody");
	_students.forEach((s) => {
		const tr = document.createElement("tr");
		tr.classList.add(s.passed_course ? "row-pass" : "row-fail");

		const cell = (content, cls = "") => {
			const td = document.createElement("td");
			if (cls) td.className = cls;
			if (typeof content === "string" && content.includes("<"))
				td.innerHTML = content;
			else td.textContent = content ?? "";
			return td;
		};

		tr.appendChild(cell(s.id, "id-cell col-id sticky-l"));
		tr.appendChild(cell(s.name, "name-cell col-name sticky-l"));
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
				tr.appendChild(cell(obsText(entry.obs), "asn-col"));
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
				tr.appendChild(cell(obsText(entry.obs), "asn-col"));
			}
		}

		tr.appendChild(cell(fmtN(s.quiz_stii), "num asn-sep"));
		tr.appendChild(cell(fmtN(s.post_typing), "num"));
		tr.appendChild(cell(fmtN(s.avg_assignments, 1), "num"));

		const fg = document.createElement("td");
		fg.className = "num";
		fg.textContent = fmtN(s.final_grade, 1) || "—";
		fg.style.color = s.passed_course
			? ""
			: s.final_grade != null
				? "#dc2626"
				: "#bbb";
		fg.style.fontWeight = "700";
		tr.appendChild(fg);

		tr.appendChild(cell(fmtN(s.answers), "num"));
		tr.appendChild(cell(fmtN(s.questions), "num"));
		tr.appendChild(cell(fmtN(s.help), "num"));
		tbody.appendChild(tr);
	});
	table.appendChild(tbody);
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
	const table = document.getElementById("grades-table");
	table.classList.remove("anon-name", "anon-id");
	if (val === "name") table.classList.add("anon-name");
	else if (val === "id") table.classList.add("anon-id");
	requestAnimationFrame(applyStickyColumns);
}

function fmtN(v, dec = 0) {
	if (v == null || isNaN(v)) return null;
	return dec > 0 ? (+v).toFixed(dec) : Math.round(+v).toString();
}
function followFg(pct) {
	if (pct < 40) return "#cc2222";
	if (pct < 60) return "#993311";
	if (pct < 75) return "#555";
	return "#111";
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
	return !raw || !raw.trim() ? "" : escHtml(raw.trim());
}

async function openLessonDiff(student, entry) {
	const key = findHandle(_lessonHandles, entry.name);
	if (!key) {
		alert(`No lesson folder found for "${entry.name}".`);
		return;
	}
	await openDiff(_lessonHandles[key], student, entry.follow);
}
async function openAssignDiff(student, entry) {
	const key = findHandle(_assignHandles, entry.name);
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
function matchAnonFolder(options, student) {
	const id = student.id.trim(),
		idN = id.replace(/^0+/, "");
	const byId = options.find(
		(o) =>
			o === id ||
			o.replace(/^0+/, "") === idN ||
			o.includes(id) ||
			id.includes(o),
	);
	if (byId) return byId;
	const parts = student.name
		.toLowerCase()
		.split(/\s+/)
		.filter((p) => p.length > 3);
	return (
		options.find((o) => parts.some((p) => o.toLowerCase().includes(p))) ||
		null
	);
}
async function openDiff(dirHandle, student, followPct) {
	try {
		showLoading(true);
		let anonName = null;
		const opts = [];
		try {
			const anonDir = await dirHandle.getDirectoryHandle("anon_names");
			for await (const [n, e] of anonDir.entries())
				if (e.kind === "directory") opts.push(n);
		} catch {}
		anonName = opts.find((o) => o === student.name) ?? null;
		if (!anonName)
			anonName =
				opts.find((o) => o.toLowerCase() === student.name.toLowerCase()) ??
				null;
		if (!anonName) anonName = matchAnonFolder(opts, student);
		if (!anonName) {
			showLoading(false);
			alert(`Cannot find anon folder for "${student.name}".`);
			return;
		}

		const teacherFiles = {};
		const _readCodeFiles = async (dirHandleSrc) => {
			const out = {};
			for await (const [name, entry] of dirHandleSrc.entries())
				if (entry.kind === "file" && /\.(html|css|js)$/i.test(name))
					out[name] = await (await entry.getFile()).text();
			return out;
		};
		try {
			const recoDir = await dirHandle.getDirectoryHandle("reconstructed");
			Object.assign(teacherFiles, await _readCodeFiles(recoDir));
		} catch {}
		if (!Object.keys(teacherFiles).length) {
			try {
				const correctDir = await dirHandle.getDirectoryHandle("correct");
				Object.assign(teacherFiles, await _readCodeFiles(correctDir));
			} catch {}
		}

		const studentFiles = {};
		const allMarks = {};
		try {
			const anonDir = await dirHandle.getDirectoryHandle("anon_names");
			const studentDir = await anonDir.getDirectoryHandle(anonName);
			for await (const [name, entry] of studentDir.entries()) {
				if (entry.kind !== "file") continue;
				if (/\.(html|css|js)$/i.test(name))
					studentFiles[name] = await (await entry.getFile()).text();
			}
			for (const [mode, fname] of Object.entries(DIFF_MARKS_FILES)) {
				try {
					const fh = await studentDir.getFileHandle(fname);
					allMarks[mode] = JSON.parse(await (await fh.getFile()).text());
				} catch {}
			}
		} catch (e) {
			console.warn("Student dir error:", e.message);
		}

		if (
			!Object.keys(teacherFiles).length &&
			!Object.keys(studentFiles).length
		) {
			showLoading(false);
			alert(`No code files found for ${student.name}.`);
			return;
		}

		const label =
			followPct != null ? followPct.toFixed(0) + "%" : "assignment";
		showLoading(false);
		openDifferentiator(
			teacherFiles,
			studentFiles,
			allMarks,
			{},
			`${escHtml(student.name)} (${escHtml(label)})`,
		);
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
	const ACCENT = OV_CLR.label;

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
		addPassingCard(body, asgNames, passCounts, participCounts);

		addBarCard(
			body,
			"Average Grades",
			names6,
			py.assignments.map((a) => a.avg_grade ?? 0),
			ACCENT,
			5,
			"dec1",
		);
		addBarCard(
			body,
			"Trouble Rates",
			names6,
			py.assignments.map((a) =>
				a.trouble_rate != null ? a.trouble_rate * 100 : 0,
			),
			ACCENT,
			100,
			"pct",
		);
		addBarCard(
			body,
			"AI Use",
			names6,
			py.assignments.map((a) => (a.ai_rate != null ? a.ai_rate * 100 : 0)),
			ACCENT,
			100,
			"pct",
		);
		if (names5.length)
			addBarCard(
				body,
				"Follow Scores",
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
					name: s.name,
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
			html += `<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0;border-bottom:1px solid #f0f0f0"><span>${escHtml(k)}</span><span>${v}</span></div>`;
		});
		card.insertAdjacentHTML("beforeend", html);
	}

	if (py.early_ai?.length) {
		const card = mkCard(body, "Early AI & Course Pass Rate", "sm");
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
}

function addPassingCard(parent, labels, passCounts, participCounts) {
	const card = mkCard(parent, "Students Passing");
	const box = el("div", "chart-box");
	card.appendChild(box);
	const notPassCounts = participCounts.map((p, i) => p - passCounts[i]);
	const chart = new BarChart(box, {
		yMin: 0,
		yMax: Math.max(...participCounts, 1) + 1,
		stacked: true,
		tooltipCallback: (_label, _val, _si, gi) => [
			`${passCounts[gi]} / ${participCounts[gi]}`,
		],
	});
	chart.setData(labels, [
		{
			data: passCounts,
			backgroundColor: "#555555",
			borderColor: "#555555",
		},
		{
			data: notPassCounts,
			backgroundColor: "#cccccc",
			borderColor: "#bbbbbb",
		},
	]);
	_barCharts.push(chart);
}

function addBarCard(parent, title, labels, data, color, yMax, tooltipFmt) {
	const card = mkCard(parent, title);
	const box = el("div", "chart-box");
	card.appendChild(box);
	const chart = new BarChart(box, {
		yMin: 0,
		yMax,
		tooltipCallback: (_label, val) => [
			tooltipFmt === "dec1"
				? val.toFixed(1)
				: tooltipFmt === "pct"
					? val.toFixed(1) + "%"
					: Math.round(val).toString(),
		],
	});
	chart.setData(labels, [
		{
			data,
			backgroundColor: color + "44",
			borderColor: color,
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
			`<span style="margin-left:6px;font-size:11px;color:#111111">●</span>` +
				`<span style="font-size:9px;color:${OV_CLR.muted};font-weight:400;text-transform:none;letter-spacing:0"> No AI &nbsp;</span>` +
				`<span style="font-size:11px;color:${OV_CLR.red}">●</span>` +
				`<span style="font-size:9px;color:${OV_CLR.muted};font-weight:400;text-transform:none;letter-spacing:0"> AI</span>`,
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
			color: "#11111199",
			pointRadius: 4,
			tooltip: (p) => {
				const grade = p.student?.lessons[p.assignment?.n - 1]?.grade;
				return [p.name, `(${Math.round(p.x)}%, ${grade ?? "?"})`];
			},
		},
		{
			data: aiPts,
			color: OV_CLR.red + "99",
			pointRadius: 4,
			tooltip: (p) => {
				const grade = p.student?.lessons[p.assignment?.n - 1]?.grade;
				return [p.name, `(${Math.round(p.x)}%, ${grade ?? "?"})`];
			},
		},
		{
			data: trend,
			type: "line",
			color: "#888",
			lineDash: [4, 4],
			lineWidth: 1.5,
		},
	]);
	_scatterCharts.push(chart);
}

function sortedStudents() {
	const sl = [..._students];
	if (_curSort === "avg-follow")
		sl.sort((a, b) => followAvg(b) - followAvg(a));
	else if (_curSort === "total-follow")
		sl.sort((a, b) => followTotal(b) - followTotal(a));
	else if (_curSort === "avg-grade")
		sl.sort((a, b) => (b.avg_assignments ?? -1) - (a.avg_assignments ?? -1));
	else if (_curSort === "total-grade")
		sl.sort((a, b) => gradeTotal(b) - gradeTotal(a));
	else sl.sort((a, b) => a.name.localeCompare(b.name));
	return sl;
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

document.querySelectorAll(".sort-bar button[data-sort]").forEach((btn) => {
	btn.addEventListener("click", () => {
		_curSort = btn.dataset.sort;
		document
			.querySelectorAll(".sort-bar button[data-sort]")
			.forEach((b) => b.classList.toggle("active", b === btn));
		renderProgress();
	});
});

function addProgressTotals(container) {
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

	const chart = new BoxPlotChart(box, {
		xLabels: labels,
		leftAxis: {
			min: 0,
			max: 100,
			ticks: [0, 20, 40, 60, 80, 100],
			color: "#999",
		},
		rightAxis: {
			min: 0,
			max: 5,
			ticks: [0, 1, 2, 3, 4, 5],
			color: OV_CLR.accent,
		},
	});
	chart.setData([
		{
			data: followData,
			color: _hexToRgba(OV_CLR.label, 0.44),
			borderColor: OV_CLR.label,
			yAxis: "left",
			coef: 25,
			outlierColor: _hexToRgba(OV_CLR.label, 0.5),
			outlierRadius: 3,
		},
		{
			data: gradeData,
			color: _hexToRgba(OV_CLR.accent, 0.44),
			borderColor: OV_CLR.accent,
			yAxis: "right",
			coef: 25,
			outlierColor: _hexToRgba(OV_CLR.accent, 0.5),
			outlierRadius: 3,
		},
	]);
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

	const labels = ASSIGNMENTS.map((a) => a.name);
	const sorted = sortedStudents();

	for (const s of sorted) {
		const card = el("div", "prog-card");
		const h4 = el("h4");
		h4.textContent = s.name;
		card.appendChild(h4);
		const box = el("div", "prog-chart-box");
		card.appendChild(box);
		grid.appendChild(card);

		const follows = s.lessons.map((l) =>
			l.hasFollowCol ? (l.follow ?? null) : null,
		);
		const grades = s.lessons.map((l) => l.grade ?? null);

		const chart = new LineChart(box, {
			xLabels: labels,
			leftAxis: {
				min: -4,
				max: 104,
				ticks: [0, 20, 40, 60, 80, 100],
				color: "#999",
			},
			rightAxis: {
				min: -0.25,
				max: 5.25,
				ticks: [0, 1, 2, 3, 4, 5],
				color: OV_CLR.accent,
			},
			onClick: (di, pi) => {
				const asgn = ASSIGNMENTS[pi];
				if (!asgn) return;
				const entry = s.lessons[asgn.n - 1];
				if (di === 0) openLessonDiff(s, entry);
				else openAssignDiff(s, entry);
			},
		});
		chart.setDatasets([
			{
				data: follows,
				color: OV_CLR.label,
				pointFillColor: _hexToRgba(OV_CLR.label, 0.44),
				lineWidth: 1.5,
				pointRadius: 4,
				yAxis: "left",
				pointLabels: s.lessons.map((l) => {
					const v = l.lesson_obs?.trim();
					return v && v !== "_" ? v : null;
				}),
				labelColor: OV_CLR.label,
			},
			{
				data: grades,
				color: OV_CLR.accent,
				pointFillColor: _hexToRgba(OV_CLR.accent, 0.44),
				lineWidth: 1.5,
				lineDash: [4, 3],
				pointRadius: 4,
				yAxis: "right",
				pointLabels: s.lessons.map((l) => {
					const v = l.obs?.trim();
					return v && v !== "_" ? v : null;
				}),
				labelColor: OV_CLR.accent,
			},
		]);
		_progressCharts.push(chart);
	}
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
