"use strict";

let _students = [];
let _remarkCols = [];
let _hasInteractions = false;
let _followLabel = "FOLLOW";
let _allFiles = new Map();
let _dirHandle = null;
let _anonMode = "";
let _sortCol = "id";
let _sortDir = "asc";
let _shownUnicodeCorruptionWarning = false;

const GRADES_KEY = "_grades";

let _basisFiles = new Map();
let _basisFallbackFile = null;
let _activeBasis = null;
let _baseStudents = null;

const INTERACTION_MAP = { Q: "❓", A: "🙋", H: "🤝" };

const LANG_COL_DEFS = [
	{
		key: "html",
		label: "HTML",
		header: "HTML (E)",
		descHeader: "HTML (E) Desc",
	},
	{ key: "css", label: "CSS", header: "CSS (E)", descHeader: "CSS (E) Desc" },
	{ key: "js", label: "JS", header: "JS (E)", descHeader: "JS (E) Desc" },
];

const MISMATCH_COLORS = {
	missing: _cssVar("--clr-mark-missing") || "#cc2222",
	"extra-star": _cssVar("--clr-mark-ghost") || "#3aa0e0",
	extra: _cssVar("--clr-mark-extra") || "#007acc",
};

const UI_COLORS = {
	faint: _cssVar("--clr-code-muted") || "#aaa",
	muted: _cssVar("--clr-muted") || "#888",
};

const landingEl = document.getElementById("landing");
const mainEl = document.getElementById("main");
const lessonNameEl = document.getElementById("lesson-name");
const anonSelectEl = document.getElementById("anon-select");

lessonNameEl.title = "Open dashboard for this lesson";
lessonNameEl.addEventListener("click", async () => {
	if (!_dirHandle) return;
	try {
		const perm = await _dirHandle.requestPermission({ mode: "read" });
		if (perm !== "granted") {
			alert("Permission denied for the lesson folder.");
			return;
		}
		await _idbSet("lastDir", _dirHandle);
		window.open("dashboard.html?autoload=1", "_blank");
	} catch (e) {
		alert("Could not open dashboard: " + e.message);
	}
});

(function () {
	const qs = new URLSearchParams(location.search);
	const anon = qs.get("anon") || "";
	if (anon && ["name", "id"].includes(anon)) {
		_anonMode = anon;
		anonSelectEl.value = anon;
	}
})();

async function _tryAutoLoad() {
	const handle = await _idbGet("lastDir");
	if (!handle || handle.kind !== "directory") return false;
	try {
		const perm = await handle.requestPermission({ mode: "read" });
		if (perm !== "granted") return false;
	} catch {
		return false;
	}
	showLoading(true);
	_dirHandle = handle;
	_allFiles.clear();
	const files = [];
	await readDirHandle(handle, "", _allFiles, files, { lowercaseKeys: true });
	lessonNameEl.textContent = handle.name;
	lessonNameEl.classList.add("clickable");
	document.title = "Students: " + handle.name;
	await loadXlsxFiles(files);
	return true;
}

(async function () {
	const qs = new URLSearchParams(location.search);
	if (qs.get("autoload") !== "1") return;
	if (typeof XLSX === "undefined") {
		await new Promise((resolve) => {
			const s = document.querySelector('script[src*="xlsx"]');
			if (s) {
				s.addEventListener("load", resolve, { once: true });
				s.addEventListener("error", resolve, { once: true });
			} else {
				resolve();
			}
		});
	}
	const ok = await _tryAutoLoad();
	if (!ok) {
		const btn = document.createElement("button");
		btn.className = "landing-btn";
		btn.textContent = "🔄 Load Students";
		btn.onclick = async () => {
			btn.disabled = true;
			await _tryAutoLoad();
			btn.disabled = false;
		};
		document.getElementById("landing-buttons").prepend(btn);
	}
})();

async function openFolderPicker() {
	try {
		const lastDir = await _idbGet("lastDir");
		const opts = { mode: "read" };
		if (lastDir) opts.startIn = lastDir;
		const dirHandle = await window.showDirectoryPicker(opts);
		_idbSet("lastDir", dirHandle);
		showLoading(true);
		_dirHandle = dirHandle;
		_allFiles.clear();
		const files = [];
		await readDirHandle(dirHandle, "", _allFiles, files, {
			lowercaseKeys: true,
		});
		const name = dirHandle.name;
		lessonNameEl.textContent = name;
		lessonNameEl.classList.add("clickable");
		document.title = "Students: " + name;
		await loadXlsxFiles(files);
	} catch (e) {
		if (e.name !== "AbortError") alert("Could not open folder: " + e.message);
		showLoading(false);
	}
}

async function loadXlsxFiles(files) {
	if (typeof XLSX === "undefined") {
		await new Promise((resolve) => {
			const s = document.querySelector('script[src*="xlsx"]');
			if (s) {
				s.addEventListener("load", resolve, { once: true });
				s.addEventListener("error", resolve, { once: true });
			} else {
				resolve();
			}
		});
	}
	if (typeof XLSX === "undefined") {
		alert(
			"SheetJS not loaded — need an internet connection or xlsx.full.min.js next to this file.",
		);
		showLoading(false);
		return;
	}
	const xlsxFiles = files.filter((f) =>
		f.name.toLowerCase().endsWith(".xlsx"),
	);
	const _ts = (f) => {
		const m = f.name.match(/_(\d{8,})/);
		return m ? Number(m[1]) : f.lastModified || 0;
	};

	_basisFiles = new Map();
	for (const f of xlsxFiles) {
		const n = f.name.toLowerCase();
		for (const { key } of REMARKS_BASES) {
			if (n === `remarks_${key}.xlsx`) {
				_basisFiles.set(key, f);
				break;
			}
		}
	}

	const gradesFiles = xlsxFiles
		.filter((f) => /grades/i.test(f.name))
		.sort((a, b) => _ts(b) - _ts(a));
	_basisFallbackFile = gradesFiles[0] || null;

	let legacyRemarksFile = null;
	if (!_basisFallbackFile && _basisFiles.size === 0) {
		const remarksFiles = xlsxFiles
			.filter((f) => /remarks/i.test(f.name))
			.sort((a, b) => _ts(b) - _ts(a));
		legacyRemarksFile = remarksFiles[0] || null;
	}

	let initialFile = null;
	if (_basisFallbackFile) {
		_activeBasis = GRADES_KEY;
		initialFile = _basisFallbackFile;
	} else {
		for (const key of DEFAULT_BASIS_ORDER) {
			if (_basisFiles.has(key)) {
				_activeBasis = key;
				initialFile = _basisFiles.get(key);
				break;
			}
		}
		if (!initialFile) {
			for (const { key } of REMARKS_BASES) {
				if (_basisFiles.has(key)) {
					_activeBasis = key;
					initialFile = _basisFiles.get(key);
					break;
				}
			}
		}
		if (!initialFile && legacyRemarksFile) {
			_activeBasis = null;
			initialFile = legacyRemarksFile;
		}
	}

	if (!initialFile) {
		showLoading(false);
		alert(
			"No grades xlsx file found. Make sure a file with 'grades' or 'remarks' in its name exists.",
		);
		return;
	}

	try {
		await _loadRemarksFile(initialFile);
		_renderBasisPicker();
	} catch (ex) {
		showLoading(false);
		alert("Error loading xlsx files:\n" + ex.message);
	}
}

async function _loadRemarksFile(file) {
	showLoading(true);
	const remarksBuf = await readFileArray(file);
	const result = parseStudentRows(remarksBuf);
	_students = result.students;
	_remarkCols = result.remarkCols;
	_hasInteractions = result.hasInteractions;
	_followLabel = result.followLabel;
	_baseStudents = _students.map((s) => ({ ...s }));
	showLoading(false);
	if (!_students.length) {
		alert("No students found in remarks xlsx.");
		return;
	}
	landingEl.style.display = "none";
	mainEl.style.display = "flex";
	renderTable();
}

async function _overlayBasisFollow(file) {
	showLoading(true);
	const buf = await readFileArray(file);
	const result = parseStudentRows(buf);
	showLoading(false);
	if (!_baseStudents) return;
	const byId = new Map();
	const byName = new Map();
	for (const s of result.students) {
		if (s.id) byId.set(s.id, s);
		if (s.name) byName.set(s.name, s);
	}
	_students = _baseStudents.map((s) => {
		const o = (s.id && byId.get(s.id)) || (s.name && byName.get(s.name));
		if (!o) return { ...s };
		return {
			...s,
			followPct: o.followPct,
			followEvents: o.followEvents,
			langPcts: o.langPcts,
			langEvents: o.langEvents,
			commentEvents: o.commentEvents,
		};
	});
	renderTable();
}

function _restoreBaseStudents() {
	if (!_baseStudents) return;
	_students = _baseStudents.map((s) => ({ ...s }));
	renderTable();
}

function _renderBasisPicker() {
	const container = document.getElementById("basis-picker");
	if (!container) return;

	const options = [];
	if (_basisFallbackFile) options.push({ key: GRADES_KEY, label: "Grades" });
	for (const { key, label } of REMARKS_BASES) {
		if (_basisFiles.has(key)) options.push({ key, label });
	}

	if (options.length === 0) {
		container.innerHTML = "";
		return;
	}

	let select = container.querySelector("select");
	if (!select) {
		container.innerHTML = "";
		const label = document.createElement("label");
		label.appendChild(document.createTextNode("Basis:"));
		select = document.createElement("select");
		select.id = "basis-select";
		label.appendChild(select);
		container.appendChild(label);
		select.addEventListener("change", async () => {
			_activeBasis = select.value;
			select.classList.toggle(
				"is-curated",
				_activeBasis === "ideal" || _activeBasis === "required",
			);
			try {
				if (_activeBasis === GRADES_KEY) {
					_restoreBaseStudents();
					return;
				}
				const f = _basisFiles.get(_activeBasis);
				if (!f) return;
				if (_baseStudents) {
					await _overlayBasisFollow(f);
				} else {
					await _loadRemarksFile(f);
				}
			} catch (ex) {
				showLoading(false);
				alert("Error loading basis xlsx:\n" + ex.message);
			}
		});
	}
	select.innerHTML = "";
	for (const { key, label } of options) {
		const opt = document.createElement("option");
		opt.value = key;
		opt.textContent = label;
		select.appendChild(opt);
	}
	if (_activeBasis && options.some((o) => o.key === _activeBasis)) {
		select.value = _activeBasis;
	} else {
		_activeBasis = select.value;
	}
	select.classList.toggle(
		"is-curated",
		select.value === "ideal" || select.value === "required",
	);
}

function parseStudentRows(remarksBuf) {
	const wbR = XLSX.read(remarksBuf, { type: "array" });
	const wsR =
		wbR.Sheets["Grades"] ||
		wbR.Sheets["Remarks"] ||
		wbR.Sheets[wbR.SheetNames[0]];
	const rowsR = XLSX.utils.sheet_to_json(wsR, {
		header: 1,
		defval: "",
	});
	const hdrR = (rowsR[0] || []).map((h) => String(h || "").trim());

	const iName = findCol(hdrR, /^(student|name|student.?name)$/i);
	const iId = findCol(hdrR, /^(student.?id|id)$/i);
	const iNum = findCol(hdrR, /^(number|no\.?|phone|tel|student.?no\.?)$/i);
	let iFollowPct = hdrR.indexOf("Follow (E)");
	let iFollowDesc = hdrR.indexOf("Follow (E) Desc");
	const iSimilarity = iFollowPct === -1 ? hdrR.indexOf("Similarity") : -1;
	if (iSimilarity !== -1) {
		iFollowPct = iSimilarity;
		iFollowDesc = hdrR.indexOf("Similarity Desc");
	}
	let iCommentDesc = hdrR.indexOf("Follow (C) Desc");
	if (iCommentDesc === -1) iCommentDesc = hdrR.indexOf("Sim (C) Desc");
	const iRemarksDesc = findCol(hdrR, /^remarks?\s*desc/i);

	const iInteractions = findCol(hdrR, /^interactions?$/i);
	const langIdx = {};
	const langDescIdx = {};
	for (const def of LANG_COL_DEFS) {
		const i = hdrR.indexOf(def.header);
		if (i !== -1) langIdx[def.key] = i;
		const di = hdrR.indexOf(def.descHeader);
		if (di !== -1) langDescIdx[def.key] = di;
	}
	const specialSet = new Set(
		[
			iName,
			iId,
			iNum,
			iFollowPct,
			iFollowDesc,
			iRemarksDesc,
			iInteractions,
			...Object.values(langIdx),
			...Object.values(langDescIdx),
		].filter((i) => i !== -1),
	);

	const REMARK_WHITELIST = /^(remarks?|expected|obs\.?|interactions?)$/i;
	const remarkCols = hdrR
		.map((name, idx) => ({ name, idx }))
		.filter(
			({ name, idx }) => !specialSet.has(idx) && REMARK_WHITELIST.test(name),
		);
	if (iName === -1) throw new Error('Remarks xlsx: missing "Student" column');

	const students = [];
	const unicodeCorruptionHits = [];
	const unicodeRepairHits = [];
	for (let i = 1; i < rowsR.length; i++) {
		const row = rowsR[i];
		const name = String(row[iName] || "").trim();
		if (!name || name === "undefined") continue;
		const followPct = iFollowPct !== -1 ? parseFloat(row[iFollowPct]) : NaN;
		const followDesc =
			iFollowDesc !== -1 ? String(row[iFollowDesc] || "") : "";
		const followEvents = isNaN(followPct)
			? []
			: iSimilarity !== -1
				? parseSimilarityEvents(followDesc)
				: parseFollowEvents(followDesc);
		const remarksDesc =
			iRemarksDesc !== -1 ? String(row[iRemarksDesc] ?? "").trim() : "";
		const remarks = remarkCols.map(({ name: colName, idx }) => {
			const addr = XLSX.utils.encode_cell({ r: i, c: idx });
			const cell = wsR[addr];
			const note =
				cell && cell.c
					? cell.c
							.map((c) => c.t || "")
							.filter(Boolean)
							.join("\n")
							.trim()
					: "";
			const rawVal = String(row[idx] ?? "").trim();
			const repaired = repairLikelyAstralEmojiFallbacks(rawVal);
			if (repaired.repairedCount) {
				unicodeRepairHits.push({
					rowIndex: i + 1,
					name,
					column: colName,
					before: rawVal,
					after: repaired.text,
				});
			}
			const val = repaired.text;
			if (hasLikelyAstralTruncation(val)) {
				unicodeCorruptionHits.push({
					rowIndex: i + 1,
					name,
					column: colName,
					value: val,
				});
			}
			return {
				col: colName,
				val,
				note,
			};
		});
		const obsEmpty = (r) => /^obs$/i.test(r.col) && (r.val === "_" || !r.val);
		if (remarks.every((r) => !r.val || obsEmpty(r))) continue;
		const interactions =
			iInteractions !== -1
				? String(row[iInteractions] ?? "")
						.trim()
						.split(/[\s,;]+/)
						.filter(Boolean)
						.map((t) => INTERACTION_MAP[t.toUpperCase()] || t)
						.join("")
				: "";
		const langPcts = {};
		const langEvents = [];
		const langParser =
			iSimilarity !== -1 ? parseSimilarityEvents : parseFollowEvents;
		for (const def of LANG_COL_DEFS) {
			if (langIdx[def.key] != null) {
				const v = parseFloat(row[langIdx[def.key]]);
				if (!isNaN(v)) langPcts[def.key] = v;
			}
			if (langDescIdx[def.key] != null) {
				const descText = String(row[langDescIdx[def.key]] ?? "");
				for (const ev of langParser(descText)) {
					ev.lang = def.key;
					langEvents.push(ev);
				}
			}
		}
		const commentDescText =
			iCommentDesc !== -1 ? String(row[iCommentDesc] ?? "") : "";
		const commentParser =
			hdrR[iCommentDesc] === "Sim (C) Desc"
				? parseSimilarityEvents
				: parseFollowEvents;
		const commentEvents = commentDescText
			? commentParser(commentDescText)
			: [];
		students.push({
			name,
			id: iId !== -1 ? String(row[iId] ?? "").trim() : "",
			num: iNum !== -1 ? String(row[iNum] ?? "").trim() : "",
			followPct,
			followEvents,
			remarksDesc,
			remarks,
			interactions,
			langPcts,
			langEvents,
			commentEvents,
		});
	}
	students.sort((a, b) =>
		a.id.localeCompare(b.id, undefined, { numeric: true }),
	);
	warnLikelyAstralTruncation(unicodeCorruptionHits, unicodeRepairHits);
	return {
		students,
		remarkCols: remarkCols.map((c) => c.name),
		hasInteractions: iInteractions !== -1,
		followLabel: iSimilarity !== -1 ? "SIM" : "FOLLOW",
	};
}

function hasLikelyAstralTruncation(text) {
	if (!text) return false;
	for (const ch of text) {
		if (isLikelyAstralEmojiFallbackChar(ch)) return true;
	}
	return false;
}

function isLikelyAstralEmojiFallbackChar(ch) {
	if (!ch || ch.length === 0) return false;
	const cp = ch.codePointAt(0);
	if (cp < 0xf900 || cp > 0xfaff) return false;
	const candidate = String.fromCodePoint(0x10000 + cp);
	return /\p{Extended_Pictographic}/u.test(candidate);
}

function repairLikelyAstralEmojiFallbacks(text) {
	if (!text) return { text, repairedCount: 0 };
	let repairedCount = 0;
	let out = "";
	for (const ch of text) {
		if (isLikelyAstralEmojiFallbackChar(ch)) {
			repairedCount += 1;
			out += String.fromCodePoint(0x10000 + ch.codePointAt(0));
		} else {
			out += ch;
		}
	}
	return { text: out, repairedCount };
}

function warnLikelyAstralTruncation(hits, repairs) {
	if (_shownUnicodeCorruptionWarning || (!hits.length && !repairs.length))
		return;
	_shownUnicodeCorruptionWarning = true;
	const repairedCount = repairs.length;
	const unrepairedCount = hits.length;
	const repairedSample = repairs.slice(0, 4);
	const unrepairedSample = hits.slice(0, 4);
	if (repairedCount) {
		console.warn(
			"[Students] Repaired likely astral emoji fallback glyphs in XLSX values.",
			{ repairedCount, sample: repairedSample },
		);
	}
	if (unrepairedCount) {
		console.warn(
			"[Students] Some possible astral emoji truncations could not be auto-repaired.",
			{ unrepairedCount, sample: unrepairedSample },
		);
	}
}

function findCol(headers, re) {
	const idx = headers.findIndex((h) => re.test(h));
	return idx;
}

function parseSimilarityEvents(descText) {
	const events = [];
	const text = String(descText || "");
	const re =
		/([+-])(.+?)(?:\s+\(x(\d+)\)|\s+\((\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\))?(?=,\s+[+-]|$)/g;
	let m;
	while ((m = re.exec(text)) !== null) {
		const kind = m[1] === "-" ? "missing" : "extra";
		const token = m[2];
		if (m[4]) {
			events.push({ kind, token, ts: _hmsToSeconds(m[4]) });
		} else {
			const count = m[3] ? parseInt(m[3]) : 1;
			for (let i = 0; i < count; i++) events.push({ kind, token });
		}
	}
	return events;
}

function parseFollowEvents(descText) {
	const re = /([+-])(.+?)\s+\((\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\)/g;
	const events = [];
	let m;
	while ((m = re.exec(String(descText || ""))) !== null) {
		const rawLabel = m[1] + m[2];
		events.push({
			label: rawLabel,
			ts: _hmsToSeconds(m[3]),
			...parseFollowLabel(rawLabel),
		});
	}
	return events;
}

function _hmsToSeconds(hms) {
	const m = (hms || "").match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
	if (!m) return null;
	const h = parseInt(m[1], 10);
	const mn = parseInt(m[2], 10);
	const s = parseInt(m[3], 10);
	const frac = m[4] ? parseInt(m[4], 10) / Math.pow(10, m[4].length) : 0;
	return h * 3600 + mn * 60 + s + frac;
}

function _maskToBytes(bits) {
	const groups = [];
	for (let i = 0; i < bits.length; i += 8) {
		const chunk = bits.slice(i, i + 8).padEnd(8, "0");
		groups.push(parseInt(chunk, 2));
	}
	return groups.map((b) => String(b).padStart(3, "0")).join("-");
}

function _boldFpGroups(hashStr) {
	return hashStr
		.split("-")
		.map((g) => (g === "000" ? g : `<b>${g}</b>`))
		.join("-");
}

function _computeFingerprintMask(students) {
	for (const s of students) s._fpMask = null;
	const studentTs = students.map(() => new Set());
	const allTs = new Set();
	for (let i = 0; i < students.length; i++) {
		const s = students[i];
		const ts = studentTs[i];
		for (const ev of s.langEvents || []) {
			if (
				ev.ts != null &&
				ev.ts > 0 &&
				(ev.kind === "missing" || ev.kind === "extra-star")
			) {
				ts.add(ev.ts);
				allTs.add(ev.ts);
			}
		}
		for (const ev of s.commentEvents || []) {
			if (ev.ts != null && ev.ts > 0 && ev.kind === "missing") {
				ts.add(ev.ts);
				allTs.add(ev.ts);
			}
		}
	}
	if (allTs.size === 0) return;
	const sortedTs = [...allTs].sort((a, b) => a - b);
	for (let i = 0; i < students.length; i++) {
		const ts = studentTs[i];
		if (ts.size === 0) continue;
		let bits = "";
		for (const t of sortedTs) bits += ts.has(t) ? "1" : "0";
		students[i]._fpMask = bits;
	}
}

function _sortKeyOf(s, sortCol) {
	if (sortCol === "id") return { type: "str", v: s.id || "" };
	if (sortCol === "name") return { type: "str", v: s.name || "" };
	if (sortCol === "num") return { type: "str", v: s.num || "" };
	if (sortCol === "follow") return { type: "num", v: s.followPct };
	if (sortCol === "int") return { type: "str", v: s.interactions || "" };
	if (sortCol === "fingerprint") {
		return { type: "str", v: s._fpMask };
	}
	if (sortCol.startsWith("lang:")) {
		const k = sortCol.slice(5);
		const v = s.langPcts ? s.langPcts[k] : undefined;
		return { type: "num", v: v == null ? NaN : v };
	}
	if (sortCol.startsWith("remark:")) {
		const col = sortCol.slice(7);
		const r = (s.remarks || []).find((x) => x.col === col);
		return { type: "str", v: r ? r.val || "" : "" };
	}
	return { type: "str", v: "" };
}

function _sortStudents(students, sortCol, sortDir) {
	const dir = sortDir === "desc" ? -1 : 1;
	const idCmp = (a, b) =>
		String(a.id || "").localeCompare(String(b.id || ""), undefined, {
			numeric: true,
		});
	return [...students].sort((a, b) => {
		const ka = _sortKeyOf(a, sortCol);
		const kb = _sortKeyOf(b, sortCol);
		let c;
		if (ka.type === "num") {
			const aN = ka.v == null || isNaN(ka.v);
			const bN = kb.v == null || isNaN(kb.v);
			if (aN && bN) c = 0;
			else if (aN) return 1;
			else if (bN) return -1;
			else c = ka.v - kb.v;
		} else {
			const aE = !ka.v;
			const bE = !kb.v;
			if (aE && bE) c = 0;
			else if (aE) return 1;
			else if (bE) return -1;
			else
				c = String(ka.v).localeCompare(String(kb.v), undefined, {
					numeric: true,
				});
		}
		if (c === 0) return idCmp(a, b);
		return c * dir;
	});
}

function _onSortHeaderClick(sortKey) {
	if (_sortCol === sortKey) {
		_sortDir = _sortDir === "asc" ? "desc" : "asc";
	} else {
		_sortCol = sortKey;
		_sortDir = "asc";
	}
	renderTable();
}

function renderTable() {
	const thead = document.getElementById("thead");
	const tbody = document.getElementById("tbody");
	thead.innerHTML = "";
	tbody.innerHTML = "";

	const showId = true;
	const showName = _anonMode !== "id";
	const showNum = _anonMode === "";

	const presentLangs = LANG_COL_DEFS.filter((def) =>
		_students.some((s) => s.langPcts && s.langPcts[def.key] != null),
	);

	const specs = [];
	if (showId) specs.push({ cls: "col-id", label: "ID", sortKey: "id" });
	if (showName)
		specs.push({ cls: "col-name", label: "Name", sortKey: "name" });
	if (showNum) specs.push({ cls: "col-num", label: "#", sortKey: "num" });
	for (const col of _remarkCols)
		specs.push({
			cls: "col-remark",
			label: col,
			title: col,
			sortKey: "remark:" + col,
		});
	if (_hasInteractions)
		specs.push({ cls: "col-int", label: "INT", sortKey: "int" });
	specs.push({ cls: "col-follow", label: _followLabel, sortKey: "follow" });
	for (const def of presentLangs)
		specs.push({
			cls: `col-lang col-lang-${def.key}`,
			label: def.label,
			sortKey: "lang:" + def.key,
		});

	const _hasFpTs = (ev) =>
		ev.kind && ev.kind !== "normal" && ev.ts != null && ev.ts > 0;
	const _isFpEvent = (ev) => ev.kind && ev.kind !== "normal";
	const _isMissingCommentWithTs = (ev) =>
		ev.kind === "missing" && ev.ts != null && ev.ts > 0;
	let fpMinTs = Infinity;
	let fpMaxTs = -Infinity;
	for (const s of _students) {
		for (const ev of s.langEvents || []) {
			if (!_hasFpTs(ev)) continue;
			if (ev.ts < fpMinTs) fpMinTs = ev.ts;
			if (ev.ts > fpMaxTs) fpMaxTs = ev.ts;
		}
		for (const ev of s.commentEvents || []) {
			if (!_isMissingCommentWithTs(ev)) continue;
			if (ev.ts < fpMinTs) fpMinTs = ev.ts;
			if (ev.ts > fpMaxTs) fpMaxTs = ev.ts;
		}
	}
	const fpRange = fpMaxTs - fpMinTs;
	const useFpTs = isFinite(fpMinTs) && isFinite(fpMaxTs) && fpRange > 0;
	const hasAnyFpEvents = _students.some((s) =>
		(s.langEvents || []).some(_isFpEvent),
	);
	const showFingerprint = useFpTs || hasAnyFpEvents;
	for (const s of _students) {
		s._fpPositions = [];
		if (!showFingerprint) continue;
		const langTagged = (s.langEvents || [])
			.filter(useFpTs ? _hasFpTs : _isFpEvent)
			.map((ev) => ({ ev, lang: ev.lang || "unk" }));
		const commentTagged = useFpTs
			? (s.commentEvents || [])
					.filter(_isMissingCommentWithTs)
					.map((ev) => ({ ev, lang: "comment" }))
			: [];
		const mistakes = [...langTagged, ...commentTagged];
		if (!mistakes.length) continue;
		const positions = useFpTs
			? mistakes.map(({ ev }) => (ev.ts - fpMinTs) / fpRange)
			: mistakes.map((_, i) =>
					mistakes.length > 1 ? i / (mistakes.length - 1) : 0.5,
				);
		s._fpPositions = mistakes.map(({ lang }, i) => ({
			pos: positions[i],
			lang,
		}));
	}
	let fp2MaxBytes = 0;
	for (const s of _students) {
		s._fp2Bytes = [];
		s._fp2Hash = "";
		const extras = (s.langEvents || []).filter(
			(ev) => ev.kind === "extra" || ev.kind === "extra-star",
		);
		const bytes = [];
		let cur = 0;
		let count = 0;
		for (const ev of extras) {
			const tok = ev.token || ev.label || "";
			const bit = tok.length % 2;
			cur = (cur << 1) | bit;
			count++;
			if (count === 8) {
				bytes.push(cur);
				cur = 0;
				count = 0;
			}
		}
		if (count > 0) bytes.push(cur);
		s._fp2Bytes = bytes;
		if (bytes.length > fp2MaxBytes) fp2MaxBytes = bytes.length;
	}
	for (const s of _students) {
		while (s._fp2Bytes.length < fp2MaxBytes) s._fp2Bytes.push(0);
		s._fp2Hash = s._fp2Bytes.map((b) => String(b).padStart(3, "0")).join("-");
	}
	const hasAnyFp2 = fp2MaxBytes > 0;
	let fp3MaxBytes = 0;
	for (const s of _students) {
		s._fp3Bytes = [];
		s._fp3Hash = "";
		const evs = (s.commentEvents || []).filter((ev) => ev.kind === "extra");
		const bytes = [];
		let cur = 0;
		let count = 0;
		for (const ev of evs) {
			const tok = ev.token || ev.label || "";
			const bit = tok.length % 2;
			cur = (cur << 1) | bit;
			count++;
			if (count === 8) {
				bytes.push(cur);
				cur = 0;
				count = 0;
			}
		}
		if (count > 0) bytes.push(cur);
		s._fp3Bytes = bytes;
		if (bytes.length > fp3MaxBytes) fp3MaxBytes = bytes.length;
	}
	for (const s of _students) {
		while (s._fp3Bytes.length < fp3MaxBytes) s._fp3Bytes.push(0);
		s._fp3Hash = s._fp3Bytes.map((b) => String(b).padStart(3, "0")).join("-");
	}
	const hasAnyFp3 = fp3MaxBytes > 0;
	_computeFingerprintMask(_students);
	if (showFingerprint || hasAnyFp2 || hasAnyFp3)
		specs.push({
			cls: "col-fingerprint",
			label: "Fingerprint",
			sortKey: "fingerprint",
		});

	const trh = document.createElement("tr");
	for (const spec of specs) {
		const el = document.createElement("th");
		el.className = spec.cls;
		if (spec.title) el.title = spec.title;
		if (spec.sortKey) {
			el.classList.add("sortable");
			el.textContent = spec.label;
			if (_sortCol === spec.sortKey) {
				const arrow = document.createElement("span");
				arrow.className = "sort-arrow";
				arrow.textContent = _sortDir === "asc" ? "▲" : "▼";
				el.appendChild(arrow);
			}
			el.addEventListener("click", () => _onSortHeaderClick(spec.sortKey));
		} else {
			el.textContent = spec.label;
		}
		trh.appendChild(el);
	}
	const thMm = document.createElement("th");
	thMm.textContent = "Mismatches";
	thMm.className = "col-mismatch";
	trh.appendChild(thMm);
	thead.appendChild(trh);

	const sortedStudents = _sortStudents(_students, _sortCol, _sortDir);
	for (const s of sortedStudents) {
		const tr = document.createElement("tr");

		if (showId) {
			const el = document.createElement("td");
			el.textContent = s.id || "–";
			el.className = "col-id";
			tr.appendChild(el);
		}
		if (showName) {
			const el = document.createElement("td");
			el.textContent = s.name;
			el.className = "col-name";
			tr.appendChild(el);
		}
		if (showNum) {
			const el = document.createElement("td");
			el.textContent = s.num || "–";
			el.className = "col-num";
			tr.appendChild(el);
		}
		for (const rk of s.remarks) {
			const el = document.createElement("td");
			el.className = "col-remark";
			const isObs = /^obs$/i.test(rk.col);
			const isExpected = /^expected$/i.test(rk.col);
			if (isObs) {
				const obsVal = rk.val === "_" || !rk.val ? "" : rk.val;
				el.textContent = obsVal;
				if (obsVal) {
					el.style.fontWeight = "bold";
				}
			} else {
				el.textContent = rk.val;
				const tipText = rk.note
					? rk.note
					: isExpected && rk.val
						? rk.val
						: "";
				if (tipText) setupTip(el, tipText, false);
			}
			tr.appendChild(el);
		}
		if (_hasInteractions) {
			const el = document.createElement("td");
			el.className = "col-int";
			el.textContent = s.interactions;
			tr.appendChild(el);
		}
		const followEl = document.createElement("td");
		followEl.className = "col-follow";
		if (!isNaN(s.followPct)) {
			followEl.textContent = s.followPct.toFixed(1) + "%";
			const r = Math.round(
				Math.max(0, Math.min(1, 1 - s.followPct / 100)) * 200,
			);
			followEl.style.color = `rgb(${r}, 0, 0)`;
		} else {
			followEl.textContent = "";
			followEl.style.color = UI_COLORS.faint;
		}
		tr.appendChild(followEl);

		for (const def of presentLangs) {
			const cell = document.createElement("td");
			cell.className = `col-lang col-lang-${def.key}`;
			const pct = s.langPcts ? s.langPcts[def.key] : undefined;
			if (pct != null && !isNaN(pct)) {
				const pctEl = document.createElement("span");
				pctEl.className = "lang-pct";
				pctEl.textContent = pct.toFixed(1) + "%";
				const bar = document.createElement("div");
				bar.className = "lang-bar";
				const fill = document.createElement("div");
				fill.className = "lang-bar-fill";
				fill.style.width = Math.max(0, Math.min(100, pct)) + "%";
				bar.appendChild(fill);
				cell.appendChild(pctEl);
				cell.appendChild(bar);
			}
			tr.appendChild(cell);
		}

		if (showFingerprint || hasAnyFp2 || hasAnyFp3) {
			const fpEl = document.createElement("td");
			fpEl.className = "col-fingerprint";
			const parts = [];
			if (s._fpMask) parts.push(_boldFpGroups(_maskToBytes(s._fpMask)));
			if (s._fp2Hash) parts.push(_boldFpGroups(s._fp2Hash));
			if (s._fp3Hash) parts.push(_boldFpGroups(s._fp3Hash));
			if (parts.length) setupTipHtml(fpEl, parts.join("  |  "));
			const wrap = document.createElement("div");
			wrap.className = "fp-wrap";
			if (showFingerprint) {
				const bar = document.createElement("div");
				bar.className = "fp-bar";
				for (const entry of s._fpPositions || []) {
					const mark = document.createElement("div");
					mark.className = "fp-mark lang-" + (entry.lang || "unk");
					mark.style.left = entry.pos * 100 + "%";
					bar.appendChild(mark);
				}
				wrap.appendChild(bar);
			}
			if (hasAnyFp2) {
				const bar2 = document.createElement("div");
				bar2.className = "fp2-bar";
				for (const b of s._fp2Bytes) {
					const col = document.createElement("div");
					col.className = "fp2-byte";
					for (let k = 7; k >= 0; k--) {
						const bit = (b >> k) & 1;
						const px = document.createElement("div");
						px.className = "fp2-bit" + (bit ? " on" : "");
						col.appendChild(px);
					}
					bar2.appendChild(col);
				}
				wrap.appendChild(bar2);
			}
			if (hasAnyFp3) {
				const bar3 = document.createElement("div");
				bar3.className = "fp3-bar";
				for (const b of s._fp3Bytes) {
					const col = document.createElement("div");
					col.className = "fp3-byte";
					for (let k = 7; k >= 0; k--) {
						const bit = (b >> k) & 1;
						const px = document.createElement("div");
						px.className = "fp3-bit" + (bit ? " on" : "");
						col.appendChild(px);
					}
					bar3.appendChild(col);
				}
				wrap.appendChild(bar3);
			}
			fpEl.appendChild(wrap);
			tr.appendChild(fpEl);
		}

		const mmEl = document.createElement("td");
		mmEl.className = "col-mismatch";
		renderMismatches(mmEl, s.followEvents);
		tr.appendChild(mmEl);

		tr.addEventListener("click", () => {
			document
				.querySelectorAll("#tbody tr.selected")
				.forEach((r) => r.classList.remove("selected"));
			tr.classList.add("selected");
			openDiffForStudent(s);
		});
		tbody.appendChild(tr);
	}
}

function renderMismatches(cell, events) {
	const mismatches = (events || []).filter((ev) => ev.kind !== "normal");
	if (!mismatches.length) return;
	const counts = new Map();
	const order = [];
	for (const ev of mismatches) {
		const key = ev.token + "|" + ev.kind;
		if (!counts.has(key)) {
			counts.set(key, { ev, n: 0 });
			order.push(key);
		}
		counts.get(key).n++;
	}
	const wrap = document.createElement("div");
	wrap.className = "mismatch-cell";
	const tipParts = [];
	for (const key of order) {
		const { ev, n } = counts.get(key);
		const color = MISMATCH_COLORS[ev.kind] || UI_COLORS.muted;
		const span = document.createElement("span");
		span.className = "mismatch-token";
		span.style.color = color;
		span.textContent = ev.token + (n > 1 ? "×" + n : "");
		wrap.appendChild(span);
		if (order.indexOf(key) < order.length - 1) {
			const comma = document.createElement("span");
			comma.textContent = ", ";
			comma.style.color = UI_COLORS.faint;
			wrap.appendChild(comma);
		}
		const esc = ev.token.replace(/&/g, "&amp;").replace(/</g, "&lt;");
		tipParts.push(
			`<span style="color:${color};font-family:Consolas,monospace;font-weight:bold">${esc}${n > 1 ? "&times;" + n : ""}</span>`,
		);
	}
	cell.innerHTML = "";
	cell.appendChild(wrap);
	const tipHtml = tipParts.join(
		`<span style="color:${UI_COLORS.faint}">, </span>`,
	);
	cell.addEventListener("mouseenter", (e) => showTipHtml(e, tipHtml));
	cell.addEventListener("mousemove", (e) => moveTip(e));
	cell.addEventListener("mouseleave", () => hideTip());
}

function onAnonChange(val) {
	_anonMode = val;
	renderTable();
}

const tipEl = document.getElementById("tip");

function setupTip(el, text, noWrap = false) {
	el.addEventListener("mouseenter", (e) => showTip(e, text, noWrap));
	el.addEventListener("mousemove", (e) => moveTip(e));
	el.addEventListener("mouseleave", () => hideTip());
}

function setupTipHtml(el, html) {
	el.addEventListener("mouseenter", (e) => showTipHtml(e, html));
	el.addEventListener("mousemove", (e) => moveTip(e));
	el.addEventListener("mouseleave", () => hideTip());
}

function showTip(e, text, noWrap = false) {
	tipEl.textContent = text;
	tipEl.style.whiteSpace = noWrap ? "pre" : "pre-wrap";
	tipEl.style.display = "block";
	moveTip(e);
}

function showTipHtml(e, html) {
	tipEl.innerHTML = html;
	tipEl.style.whiteSpace = "pre-wrap";
	tipEl.style.display = "block";
	moveTip(e);
}
function moveTip(e) {
	const tw = tipEl.offsetWidth,
		th = tipEl.offsetHeight;
	let tx = e.clientX + 14,
		ty = e.clientY - 8;
	if (tx + tw > window.innerWidth - 8) tx = e.clientX - tw - 14;
	if (ty + th > window.innerHeight - 8) ty = e.clientY - th - 8;
	tipEl.style.left = tx + "px";
	tipEl.style.top = ty + "px";
}

function hideTip() {
	tipEl.style.display = "none";
}

const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|ico|bmp)$/i;

async function _readStudentDiffPayload(student) {
	const followPct =
		student.followPct != null ? student.followPct.toFixed(1) + "%" : "N/A";

	const fileMap = new Map();
	if (_dirHandle) {
		await readDirHandle(_dirHandle, "", fileMap, [], { lowercaseKeys: true });
	} else {
		for (const [k, v] of _allFiles) fileMap.set(k, v);
	}

	const recoEntries = [...fileMap.entries()].filter(
		([p]) => /^reconstructed\//i.test(p) && /\.(html|css|js|py)$/i.test(p),
	);
	const correctEntries = [...fileMap.entries()].filter(
		([p]) => /^correct\//i.test(p) && /\.(html|css|js|py)$/i.test(p),
	);
	const teacherEntries = recoEntries.length ? recoEntries : correctEntries;
	const studentDir = (student.id + "/").toLowerCase();
	const anonBase = "anon_ids/";
	const studentEntries = [...fileMap.entries()].filter(
		([p]) =>
			p.startsWith(anonBase + studentDir) && /\.(html|css|js|py)$/i.test(p),
	);

	const allMarks = {};
	for (const [mode, fname] of Object.entries(DIFF_MARKS_FILES)) {
		const entry = fileMap.get(anonBase + studentDir + fname);
		if (entry) {
			try {
				allMarks[mode] = JSON.parse(await readFileText(entry));
			} catch {}
		}
	}

	const teacherFiles = {};
	for (const [, file] of teacherEntries)
		teacherFiles[file.name] = await readFileText(file);

	const studentFiles = {};
	for (const [, file] of studentEntries)
		studentFiles[file.name] = await readFileText(file);

	const imageUris = {};
	const imageEntries = [...fileMap.entries()].filter(
		([p]) =>
			IMAGE_EXT.test(p) &&
			(/^correct\//i.test(p) || p.startsWith(anonBase + studentDir)),
	);
	for (const [, file] of imageEntries) {
		if (!imageUris[file.name]) {
			imageUris[file.name] = await readFileDataUri(file);
		}
	}

	if (!Object.keys(teacherFiles).length && !Object.keys(studentFiles).length) {
		throw new Error(
			`No files found for student "${student.name}". Make sure the folder contains correct/ and anon_ids/ subdirectories.`,
		);
	}

	return {
		teacherFiles,
		studentFiles,
		allMarks,
		imageUris,
		title: `${student.id ? student.id + ". " : ""}${student.name} (${followPct})`,
	};
}

async function openDiffForStudent(student) {
	if (!_allFiles.size) return;
	try {
		await openDifferentiator(() => _readStudentDiffPayload(student));
	} catch (err) {
		console.error("[Students] openDiffForStudent", err);
		alert("Error opening differentiator: " + err.message);
	}
}
