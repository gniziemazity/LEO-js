"use strict";

let _diffMode = null;
let _teacherFiles = null;
let _studentFiles = null;
let _teacherMarks = null;
let _studentMarks = null;
let _allMarks = {};
let _marksLoadGen = 0;
let _currentMarksEntry = null;
let _titleBase = null;
let _imageUris = {};
let _docUris = {};
let _docHtmlCache = {};
let _teacherBaseUrl = null;
let _studentBaseUrl = null;
let _linePaddingEnabled =
	typeof localStorage !== "undefined" &&
	localStorage.getItem("diff-line-padding") === "off"
		? false
		: true;
let _lineNumbersEnabled =
	typeof localStorage !== "undefined" &&
	localStorage.getItem("diff-line-numbers") === "on";
let _smartPaddingEnabled =
	typeof localStorage !== "undefined" &&
	localStorage.getItem("diff-smart-padding") === "on";

const DIFF_MODE_OPTIONS = [
	{ key: "required", label: "Required" },
	{ key: "ideal", label: "Ideal" },
	{ key: "", label: "LEO*" },
	{ key: "leo", label: "LEO" },
	{ key: "token-lcs-star", label: "LCS*" },
	{ key: "token-lcs", label: "LCS" },
	{ key: "token-lev-star", label: "Lev*" },
	{ key: "token-lev", label: "Lev" },
	{ key: "line-ro-star", label: "R/O*" },
	{ key: "line-ro", label: "R/O" },
	{ key: "line-git-star", label: "Git*" },
	{ key: "line-git", label: "Git" },
];

function _refreshModeSelect() {
	const modeSelect = document.getElementById("mode-select");
	if (!modeSelect) return;

	const availableKeys = new Set(Object.keys(_allMarks));
	modeSelect.innerHTML = "";

	for (const optionDef of DIFF_MODE_OPTIONS) {
		if (!availableKeys.has(optionDef.key)) continue;
		const option = document.createElement("option");
		option.value = optionDef.key;
		option.textContent = optionDef.label;
		modeSelect.appendChild(option);
	}

	const nextMode = defaultDiffModeKey(_allMarks, _diffMode);
	_diffMode = nextMode;
	modeSelect.disabled = modeSelect.options.length <= 1;
	modeSelect.value = nextMode ?? "";
	modeSelect.classList.toggle("is-curated", CURATED_MODES.has(nextMode));
}

function _resolveMarksEntry() {
	const modeKey = _diffMode ?? "";
	return _allMarks[modeKey] ?? Object.values(_allMarks)[0] ?? null;
}

function _pairedFileName(fromSide, name) {
	const otherSide = fromSide === "teacher" ? "student" : "teacher";
	const otherFiles = otherSide === "teacher" ? _teacherFiles : _studentFiles;
	if (!otherFiles) return null;
	const otherNames = Object.keys(otherFiles).filter((n) => CODE_EXT.test(n));
	if (!otherNames.length) return null;
	const filePairs = _currentMarksEntry?.file_pairs;
	if (filePairs) {
		if (
			fromSide === "student" &&
			filePairs[name] &&
			otherFiles[filePairs[name]] != null
		) {
			return filePairs[name];
		}
		if (fromSide === "teacher") {
			for (const [s, t] of Object.entries(filePairs)) {
				if (t === name && otherFiles[s] != null) return s;
			}
		}
	}
	const lower = String(name).toLowerCase();
	for (const n of otherNames) {
		if (n.toLowerCase() === lower) return n;
	}
	const marks = _currentMarksEntry;
	if (marks) {
		const fromFiles =
			fromSide === "teacher" ? marks.teacher_files : marks.student_files;
		const fromMarks = (fromFiles && fromFiles[name]) || [];
		for (const m of fromMarks) {
			const ref =
				(m && m.paired_with && m.paired_with.file) ||
				(m && m.insert_at && m.insert_at.file);
			if (ref && otherFiles[ref] != null) return ref;
		}
	}
	const ext = getFileExt(name);
	if (!ext) return null;
	const sameExt = otherNames.filter((n) => getFileExt(n) === ext);
	if (sameExt.length === 1) return sameExt[0];
	return null;
}

function _activateFileTab(side, name) {
	if (!name) return;
	const tabs = document.getElementById(`tabs-${side}`);
	const codeWrap = document.getElementById(`code-${side}`);
	if (!tabs || !codeWrap) return;
	const btns = [...tabs.querySelectorAll(".file-tab")];
	const idx = btns.findIndex((b) => b.dataset.fileName === name);
	if (idx < 0) return;
	btns.forEach((b) => b.classList.remove("file-tab-active"));
	codeWrap
		.querySelectorAll(".code-pane")
		.forEach((p) => p.classList.remove("active"));
	btns[idx].classList.add("file-tab-active");
	if (codeWrap.children[idx]) codeWrap.children[idx].classList.add("active");
	_updateHScrollProxy(side);
}

const _BORROW_ALIGNMENT_ORDER = [
	"line-git",
	"line-git-star",
	"line-ro",
	"line-ro-star",
	"leo",
	"",
	"token-lcs",
	"token-lcs-star",
	"token-lev",
	"token-lev-star",
];

function _borrowedAlignments() {
	for (const mode of _BORROW_ALIGNMENT_ORDER) {
		const m = _allMarks[mode];
		if (m && m.alignments && Object.keys(m.alignments).length) {
			return m.alignments;
		}
	}
	for (const m of Object.values(_allMarks)) {
		if (m && m.alignments && Object.keys(m.alignments).length) {
			return m.alignments;
		}
	}
	return null;
}

const _BORROW_GHOSTS_ORDER = [
	"",
	"token-lcs-star",
	"token-lev-star",
	"line-ro-star",
	"line-git-star",
];

function _borrowedTeacherGhosts(fileName) {
	for (const mode of _BORROW_GHOSTS_ORDER) {
		const m = _allMarks[mode];
		const list = m && m.teacher_ghosts && m.teacher_ghosts[fileName];
		if (list && list.length) return list;
	}
	for (const m of Object.values(_allMarks)) {
		const list = m && m.teacher_ghosts && m.teacher_ghosts[fileName];
		if (list && list.length) return list;
	}
	return [];
}

function _applyCurrentMarks() {
	_currentMarksEntry = _resolveMarksEntry();
	_teacherMarks = _currentMarksEntry?.teacher_files ?? null;
	_studentMarks = _currentMarksEntry?.student_files ?? null;
}

function _posToLine(lineStarts, pos) {
	let lo = 0;
	let hi = lineStarts.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (lineStarts[mid] <= pos) lo = mid;
		else hi = mid - 1;
	}
	return lo;
}

function _pairedTeacherFileFor(sFile, filePairs) {
	if (!sFile) return null;
	if (filePairs && filePairs[sFile]) return filePairs[sFile];
	const lower = sFile.toLowerCase();
	for (const t of Object.keys(_teacherFiles || {})) {
		if (t.toLowerCase() === lower) return t;
	}
	return null;
}

function _smartFilePairs() {
	const filePairs = _currentMarksEntry?.file_pairs || {};
	const pairs = [];
	const seenT = new Set();
	const seenS = new Set();
	const tHas = (n) => _teacherFiles && _teacherFiles[n] != null;
	const sHas = (n) => _studentFiles && _studentFiles[n] != null;
	for (const [sName, tName] of Object.entries(filePairs)) {
		if (tHas(tName) && sHas(sName)) {
			pairs.push([tName, sName]);
			seenT.add(tName);
			seenS.add(sName);
		}
	}
	const tLower = new Map();
	for (const t of Object.keys(_teacherFiles || {}))
		tLower.set(t.toLowerCase(), t);
	for (const s of Object.keys(_studentFiles || {})) {
		if (seenS.has(s)) continue;
		const t = tLower.get(s.toLowerCase());
		if (t && !seenT.has(t)) {
			pairs.push([t, s]);
			seenT.add(t);
			seenS.add(s);
		}
	}
	const inferred = new Map();
	const bump = (t, s) => {
		if (!t || !s || seenT.has(t) || seenS.has(s)) return;
		if (!tHas(t) || !sHas(s)) return;
		if (!inferred.has(t)) inferred.set(t, new Map());
		const sub = inferred.get(t);
		sub.set(s, (sub.get(s) || 0) + 1);
	};
	const teacherMarks = _currentMarksEntry?.teacher_files || {};
	const studentMarks = _currentMarksEntry?.student_files || {};
	for (const [tFile, marks] of Object.entries(teacherMarks)) {
		for (const m of marks || []) {
			if (m?.label === "missing" && m.insert_at?.file) {
				bump(tFile, m.insert_at.file);
			}
		}
	}
	for (const [sFile, marks] of Object.entries(studentMarks)) {
		for (const m of marks || []) {
			if (m?.paired_with?.file) bump(m.paired_with.file, sFile);
		}
	}
	const inferredArr = [];
	for (const [t, sCounts] of inferred) {
		let bestS = null;
		let bestCount = 0;
		for (const [s, c] of sCounts) {
			if (c > bestCount) {
				bestS = s;
				bestCount = c;
			}
		}
		if (bestS) inferredArr.push([t, bestS, bestCount]);
	}
	inferredArr.sort((a, b) => b[2] - a[2]);
	for (const [t, s] of inferredArr) {
		if (seenT.has(t) || seenS.has(s)) continue;
		pairs.push([t, s]);
		seenT.add(t);
		seenS.add(s);
	}
	return pairs;
}

function _computeSmartAlignments() {
	if (!_currentMarksEntry) return null;
	const result = {};
	const teacherMarks = _currentMarksEntry.teacher_files || {};
	const studentMarks = _currentMarksEntry.student_files || {};

	for (const [tFile, sFile] of _smartFilePairs()) {
		const tText = (_teacherFiles[tFile] || "").replace(/\r\n/g, "\n");
		const sText = (_studentFiles[sFile] || "").replace(/\r\n/g, "\n");
		const tStarts = _lineStartOffsets(tText);
		const sStarts = _lineStartOffsets(sText);
		const tLineCount = Math.max(
			1,
			tText.length ? tText.split("\n").length : 1,
		);
		const sLineCount = Math.max(
			1,
			sText.length ? sText.split("\n").length : 1,
		);

		const constraints = [];
		const tPairedLines = new Set();
		const sPairedLines = new Set();
		const tMissingLines = new Set();
		const sExtraLines = new Set();
		const tMatchedLines = new Set();
		const sMatchedLines = new Set();

		for (const m of teacherMarks[tFile] || []) {
			if (!m || m.label !== "missing") continue;
			const tLine = _posToLine(tStarts, m.start ?? 0);
			tMissingLines.add(tLine);
			if (m.insert_at?.file === sFile) {
				constraints.push([
					tLine,
					_posToLine(sStarts, m.insert_at.pos ?? 0),
				]);
				tPairedLines.add(tLine);
			}
		}
		for (const m of studentMarks[sFile] || []) {
			if (!m) continue;
			if (m.label !== "extra" && m.label !== "ghost_extra") continue;
			const sLine = _posToLine(sStarts, m.start ?? 0);
			sExtraLines.add(sLine);
			if (m.paired_with?.file === tFile) {
				constraints.push([
					_posToLine(tStarts, m.paired_with.start ?? 0),
					sLine,
				]);
				sPairedLines.add(sLine);
			}
		}

		const isCurated =
			typeof CURATED_MODES !== "undefined" && CURATED_MODES.has(_diffMode);
		const tokensMap = isCurated
			? null
			: _currentMarksEntry?.leo_assignments?.tokens;
		if (tokensMap) {
			for (const data of Object.values(tokensMap)) {
				const tMatched = (data.teacher || [])
					.filter((x) => x && x.file === tFile && !x.label && !x.ghost)
					.sort((a, b) => (a.seq_idx ?? 0) - (b.seq_idx ?? 0));
				const sMatched = (data.student || [])
					.filter((x) => x && x.file === sFile && !x.label && !x.ghost)
					.sort((a, b) => (a.seq_idx ?? 0) - (b.seq_idx ?? 0));
				const n = Math.min(tMatched.length, sMatched.length);
				for (let i = 0; i < n; i++) {
					const tLine = _posToLine(tStarts, tMatched[i].pos ?? 0);
					const sLine = _posToLine(sStarts, sMatched[i].pos ?? 0);
					constraints.push([tLine, sLine]);
					tMatchedLines.add(tLine);
					sMatchedLines.add(sLine);
				}
			}
		}

		const looseT = new Set();
		for (const t of tMissingLines) {
			if (!tPairedLines.has(t) && !tMatchedLines.has(t)) looseT.add(t);
		}
		const looseS = new Set();
		for (const s of sExtraLines) {
			if (!sPairedLines.has(s) && !sMatchedLines.has(s)) looseS.add(s);
		}

		constraints.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

		const anchors = [];
		let lastT = -1;
		let lastS = -1;
		for (const [t, s] of constraints) {
			if (t > lastT && s > lastS) {
				anchors.push([t, s]);
				lastT = t;
				lastS = s;
			}
		}

		const alignment = [];
		let tCur = 0;
		let sCur = 0;
		const emitFill = (tEnd, sEnd) => {
			while (tCur < tEnd || sCur < sEnd) {
				if (tCur < tEnd && looseT.has(tCur)) {
					alignment.push([tCur, null]);
					tCur++;
				} else if (sCur < sEnd && looseS.has(sCur)) {
					alignment.push([null, sCur]);
					sCur++;
				} else if (tCur < tEnd && sCur < sEnd) {
					alignment.push([tCur, sCur]);
					tCur++;
					sCur++;
				} else if (tCur < tEnd) {
					alignment.push([tCur, null]);
					tCur++;
				} else {
					alignment.push([null, sCur]);
					sCur++;
				}
			}
		};
		for (const [tA, sA] of anchors) {
			emitFill(tA, sA);
			alignment.push([tA, sA]);
			tCur = tA + 1;
			sCur = sA + 1;
		}
		emitFill(tLineCount, sLineCount);

		result[tFile] = alignment;
		if (sFile !== tFile) result[sFile] = alignment;
	}

	return result;
}

function _applyIncomingData(data) {
	const myGen = ++_marksLoadGen;
	_teacherFiles = data.teacherFiles || {};
	_studentFiles = data.studentFiles || {};
	_imageUris = data.imageUris || {};
	_docUris = data.docUris || {};
	_docHtmlCache = {};
	_closeDocxViewer();
	_refreshDocxButton();
	_teacherBaseUrl = data.teacherBaseUrl || null;
	_studentBaseUrl = data.studentBaseUrl || null;

	if (data.allMarks) {
		_allMarks = data.allMarks;
		_diffMode = defaultDiffModeKey(_allMarks, _diffMode);
		_refreshModeSelect();
		_applyCurrentMarks();
		if (data.pendingMarks) {
			data.pendingMarks.then((rest) => {
				if (myGen !== _marksLoadGen) return;
				let added = false;
				for (const [mode, json] of Object.entries(rest || {})) {
					if (json && !_allMarks[mode]) {
						_allMarks[mode] = json;
						added = true;
					}
				}
				if (added) {
					const hadNoMarks = _diffMode == null || !_allMarks[_diffMode];
					_refreshModeSelect();
					if (hadNoMarks) _applyCurrentMarks();
				}
			});
		}
	} else {
		_currentMarksEntry =
			data.teacherMarks || data.studentMarks
				? {
						teacher_files: data.teacherMarks || null,
						student_files: data.studentMarks || null,
					}
				: null;
		_teacherMarks = _currentMarksEntry?.teacher_files ?? null;
		_studentMarks = _currentMarksEntry?.student_files ?? null;
	}

	if (data.title) document.title = `${data.title} : Differentiator`;
	const titleText = data.title || "Student";
	_titleBase =
		data.titleBase ||
		titleText.replace(/\s*\([^)]*%\)\s*$/, "").trim() ||
		titleText;
	document.getElementById("title-student").textContent = titleText;

	renderPanel("teacher", _teacherFiles, _teacherMarks);
	renderPanel("student", _studentFiles, _studentMarks);
	_updateTitleScore();
	if (typeof _curatedEnable === "function") _curatedEnable();
	if (_embedMode) _applyPreviewMode(_isPreviewMode());
}

function _showLoading(on) {
	const el = document.getElementById("loading");
	if (el) el.style.display = on ? "flex" : "none";
	document.body.classList.toggle("diff-loading", on);
}

let _navState = {
	lesson: null,
	group: null,
	dataSource: null,
	folders: [],
	currentIdx: -1,
	idToFolder: {},
	folderToId: {},
};

function _sortFolders(names) {
	return [...names].sort((a, b) =>
		a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
	);
}

function _extractStudentFolders(files, prefix) {
	const set = new Set();
	const re = new RegExp("^" + prefix + "([^/]+)/", "i");
	for (const path of files.keys()) {
		const m = path.match(re);
		if (m) set.add(m[1]);
	}
	return _sortFolders([...set]);
}

async function _buildIdFolderMaps(ds) {
	const idToFolder = {};
	const folderToId = {};
	const lowerToOriginal = {};
	const csvEntry =
		ds.files.get("name_map.csv") || ds.files.get("students.csv");
	if (!csvEntry) return { idToFolder, folderToId, lowerToOriginal };
	try {
		const text = await readFileText(csvEntry);
		const { header, rows } = parseCsv(text);
		const idIdx = header.findIndex((h) => /student.?id|^id$/i.test(h));
		const alterIdx = header.findIndex((h) => /alter.?ego/i.test(h));
		const nameIdx = header.findIndex((h) => /student.?name|^name$/i.test(h));
		const folderIdx = alterIdx !== -1 ? alterIdx : nameIdx;
		if (idIdx === -1 || folderIdx === -1)
			return { idToFolder, folderToId, lowerToOriginal };
		for (const parts of rows) {
			const id = (parts[idIdx] || "").trim();
			const folder = (parts[folderIdx] || "").trim();
			if (id && folder) {
				idToFolder[id.toLowerCase()] = folder;
				folderToId[folder.toLowerCase()] = id;
				lowerToOriginal[folder.toLowerCase()] = folder;
			}
		}
	} catch {}
	return { idToFolder, folderToId, lowerToOriginal };
}

function _updateStudentNavButtons() {
	const prev = document.getElementById("nav-prev-student");
	const next = document.getElementById("nav-next-student");
	const counter = document.getElementById("nav-counter-student");
	if (!prev || !next) return;
	const n = _navState.folders.length;
	const i = _navState.currentIdx;
	prev.disabled = !(n > 0 && i > 0);
	next.disabled = !(n > 0 && i >= 0 && i < n - 1);
	if (counter) {
		counter.textContent = n > 0 && i >= 0 ? `${i + 1} / ${n}` : "";
	}
	if (n > 0 && i >= 0) {
		prev.title = `Previous student (${i + 1} / ${n})`;
		next.title = `Next student (${i + 1} / ${n})`;
	}
}

async function _loadFromUrlParams({ lesson, group, id, title }) {
	const ds = await loadLessonDataSource({ lesson, group });
	if (!ds) return null;
	await ds.load();

	const { idToFolder } = await _buildIdFolderMaps(ds);
	const prefix = "anon_ids/";
	const folders = _extractStudentFolders(ds.files, "anon_ids/");
	const folder =
		folders.find((f) => f.toLowerCase() === String(id).toLowerCase()) ||
		String(id);

	if (!folder) {
		console.warn(
			`[Differentiator] Could not resolve student "${id}" to a folder under ${prefix}.`,
		);
		return null;
	}

	const studentPrefix = prefix + folder.toLowerCase() + "/";
	const data = await buildDiffPayloadData(ds.files, studentPrefix);
	if (
		!Object.keys(data.teacherFiles).length &&
		!Object.keys(data.studentFiles).length
	) {
		console.warn(
			`[Differentiator] No code files found for ${lesson}/${studentPrefix}.`,
		);
		return null;
	}
	if (!Object.keys(data.allMarks || {}).length) {
		console.warn(
			`[Differentiator] No diff_marks loaded for ${lesson}/${studentPrefix}.`,
		);
	}

	_navState = {
		lesson,
		group: group || null,
		dataSource: ds,
		folders,
		currentIdx: folders.findIndex(
			(f) => f.toLowerCase() === folder.toLowerCase(),
		),
		idToFolder,
		prefix,
	};
	_updateStudentNavButtons();
	data.title = title || _formatStudentTitle(folder, idToFolder);
	return _buildDiffPayload(data);
}

function _formatStudentTitle(folder, idToFolder) {
	const name = idToFolder && idToFolder[folder.toLowerCase()];
	return name ? `${folder}. ${name}` : folder;
}

async function _navToStudent(idx, title) {
	if (!_navState.dataSource) return;
	if (idx < 0 || idx >= _navState.folders.length) return;
	const folder = _navState.folders[idx];
	_showLoading(true);
	try {
		const studentPrefix = _navState.prefix + folder.toLowerCase() + "/";
		const data = await buildDiffPayloadData(
			_navState.dataSource.files,
			studentPrefix,
		);
		if (
			!Object.keys(data.teacherFiles).length &&
			!Object.keys(data.studentFiles).length
		) {
			console.warn(
				`[Differentiator] No code files for ${_navState.lesson}/${studentPrefix}.`,
			);
			return;
		}
		data.title = title || _formatStudentTitle(folder, _navState.idToFolder);
		if (typeof _curatedResetForNewStudent === "function") {
			_curatedResetForNewStudent();
		}
		_applyIncomingData(_buildDiffPayload(data));
		_navState.currentIdx = idx;
		_updateStudentNavButtons();
		_updateTitleScore();
		const url = new URL(location.href);
		url.searchParams.set("id", folder);
		url.searchParams.delete("title");
		history.replaceState(null, "", url);
	} catch (e) {
		console.error("[Differentiator] Navigation failed:", e);
	} finally {
		_showLoading(false);
	}
}

async function _navToStudentId(id, title) {
	if (!_navState.dataSource || !_navState.folders.length) return false;
	const folders = _navState.folders;
	const lower = String(id).toLowerCase();
	let idx = -1;
	for (const cand of [_navState.idToFolder[lower], String(id)]) {
		if (!cand) continue;
		idx = folders.findIndex(
			(f) => f.toLowerCase() === String(cand).toLowerCase(),
		);
		if (idx >= 0) break;
	}
	if (idx < 0) return false;
	if (idx !== _navState.currentIdx) await _navToStudent(idx, title);
	return true;
}

window.diffNavToStudentId = _navToStudentId;

let _embedMode = false;
let _previewOverride = null;

window.addEventListener("DOMContentLoaded", async () => {
	await window.LanguageProfiles.initProfiles();
	const params = new URLSearchParams(location.search);
	const modeParam = params.get("mode") || null;
	_diffMode = modeParam;
	const toolParams = parseToolParams();
	if (params.get("preview") === "1") _previewOverride = true;
	_refreshLinePaddingButton();
	_refreshSmartPaddingButton();
	_refreshLineNumbersButton();
	_refreshPreviewButton();
	_applyLineNumbersClass();

	_embedMode = params.get("embed") === "1";
	if (_embedMode) {
		document.body.classList.add("embed");
		const tt = document.getElementById("title-teacher");
		if (tt) tt.textContent = "Starter Code";
	}

	const expectAutoLoad = !!toolParams.lesson && !!toolParams.id;
	if (expectAutoLoad) _showLoading(true);

	const modeSelect = document.getElementById("mode-select");
	if (modeSelect) {
		modeSelect.addEventListener("change", () => {
			_diffMode = modeSelect.value;
			modeSelect.classList.toggle(
				"is-curated",
				CURATED_MODES.has(_diffMode),
			);
			_applyCurrentMarks();
			if (typeof _curatedEnable === "function") {
				_curatedEnable();
			} else {
				const savedTeacher = _saveState("teacher");
				const savedStudent = _saveState("student");
				if (_teacherFiles)
					renderPanel("teacher", _teacherFiles, _teacherMarks);
				if (_studentFiles)
					renderPanel("student", _studentFiles, _studentMarks);
				_restoreState("teacher", savedTeacher);
				_restoreState("student", savedStudent);
			}
			_updateTitleScore();
		});

		document.addEventListener("keydown", (ev) => {
			if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey) return;
			if (typeof _curatedCurrentSel !== "undefined" && _curatedCurrentSel)
				return;
			const t = ev.target;
			if (
				t &&
				t.matches &&
				t.matches("input, textarea, select, [contenteditable=true]")
			)
				return;
			const SHORTCUTS = { r: "required", i: "ideal", l: "" };
			const mode = SHORTCUTS[ev.key.toLowerCase()];
			if (mode === undefined) return;
			const hasOption = Array.from(modeSelect.options).some(
				(o) => o.value === mode,
			);
			if (!hasOption) return;
			ev.preventDefault();
			modeSelect.value = mode;
			modeSelect.dispatchEvent(new Event("change"));
		});
	}

	let incoming = null;
	if (toolParams.lesson && toolParams.id) {
		try {
			incoming = await _loadFromUrlParams(toolParams);
		} catch (e) {
			console.error("[Differentiator] URL-param load failed", e);
		}
	}
	if (incoming) {
		_applyIncomingData(incoming);
	}
	_showLoading(false);

	document.getElementById("input-teacher").addEventListener("change", (e) => {
		loadFilesFromInput(e.target.files, "teacher");
	});
	document.getElementById("input-student").addEventListener("change", (e) => {
		loadFilesFromInput(e.target.files, "student");
	});

	document
		.getElementById("nav-prev-student")
		.addEventListener("click", () => _navToStudent(_navState.currentIdx - 1));
	document
		.getElementById("nav-next-student")
		.addEventListener("click", () => _navToStudent(_navState.currentIdx + 1));

	let _hscrollResizeRaf = 0;
	window.addEventListener("resize", () => {
		if (_hscrollResizeRaf) return;
		_hscrollResizeRaf = requestAnimationFrame(() => {
			_hscrollResizeRaf = 0;
			_updateHScrollProxies();
			_updateTabHScrolls();
		});
	});
});

function loadFilesFromInput(files, side) {
	const texts = {};
	let pending = files.length;
	if (!pending) return;

	for (const file of files) {
		if (DOC_EXT.test(file.name) && !/^~\$/.test(file.name)) {
			_docUris[file.name] = fileToUrl(file);
			delete _docHtmlCache[_docUris[file.name]];
			pending--;
			if (pending === 0) _refreshDocxButton();
			continue;
		}
		readFileText(file).then((text) => {
			const mode = diffModeFromFilename(file.name);
			if (mode != null) {
				try {
					const parsed = JSON.parse(text);
					if (!_allMarks[mode]) _allMarks[mode] = {};
					Object.assign(_allMarks[mode], parsed);
				} catch {}
			} else {
				texts[file.name] = text;
			}
			pending--;
			if (pending === 0) {
				_refreshModeSelect();
				_applyCurrentMarks();
				if (side === "teacher") _teacherFiles = texts;
				else _studentFiles = texts;
				renderPanel(
					side,
					side === "teacher" ? _teacherFiles : _studentFiles,
					side === "teacher" ? _teacherMarks : _studentMarks,
				);
				_updateTitleScore();
				if (typeof _curatedEnable === "function") _curatedEnable();
				_refreshDocxButton();
			}
		});
	}
}

function _saveState(side) {
	const tabs = document.getElementById(`tabs-${side}`);
	const btns = tabs ? [...tabs.querySelectorAll(".file-tab")] : [];
	const activeIdx = btns.findIndex((b) =>
		b.classList.contains("file-tab-active"),
	);
	const tabName = activeIdx >= 0 ? btns[activeIdx].dataset.fileName : null;
	const scroll = document.getElementById("diff-scroll");
	return {
		tabName,
		scrollTop: scroll ? scroll.scrollTop : 0,
		scrollLeft: scroll ? scroll.scrollLeft : 0,
	};
}

function _restoreState(side, saved) {
	if (!saved || !saved.tabName) return;
	const tabs = document.getElementById(`tabs-${side}`);
	if (!tabs) return;
	const btns = [...tabs.querySelectorAll(".file-tab")];
	const wrap = document.getElementById(`code-${side}`);
	const panes = wrap ? [...wrap.querySelectorAll(".code-pane")] : [];
	const matchIdx = btns.findIndex((b) => b.dataset.fileName === saved.tabName);
	if (matchIdx > 0) {
		btns.forEach((b) => b.classList.remove("file-tab-active"));
		panes.forEach((p) => p.classList.remove("active"));
		btns[matchIdx].classList.add("file-tab-active");
		if (panes[matchIdx]) panes[matchIdx].classList.add("active");
	}
	const scroll = document.getElementById("diff-scroll");
	if (scroll) {
		scroll.scrollTop = saved.scrollTop;
		scroll.scrollLeft = saved.scrollLeft;
	}
}

const _DIFF_TOKEN_RE = newTokenRegex();
const _DIFF_FALLBACK_DETECT_RE =
	/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|(?<!:)\/\/[^\n]*/g;

function _diffCommentRanges(text, fileName) {
	const ext = String(fileName || "")
		.toLowerCase()
		.match(/\.[a-z]+$/);
	const e = ext ? ext[0] : "";
	const profile = e ? window.LanguageProfiles.getProfile(e) : null;
	if (profile) return window.LanguageProfiles.commentRangesOf(profile, text);

	const ranges = [];
	_DIFF_FALLBACK_DETECT_RE.lastIndex = 0;
	let m;
	while ((m = _DIFF_FALLBACK_DETECT_RE.exec(text)) !== null) {
		ranges.push([m.index, m.index + m[0].length]);
	}
	return ranges;
}

let _teacherTokenTotalCache = null;
let _teacherTokenTotalCacheKey = null;

function _countNonCommentTokens(text, fileName) {
	if (!text) return 0;
	const ranges = _diffCommentRanges(text, fileName);
	let count = 0;
	_DIFF_TOKEN_RE.lastIndex = 0;
	let m;
	while ((m = _DIFF_TOKEN_RE.exec(text)) !== null) {
		const pos = m.index;
		let inComment = false;
		for (const [lo, hi] of ranges) {
			if (lo <= pos && pos < hi) {
				inComment = true;
				break;
			}
			if (pos < lo) break;
		}
		if (!inComment) count++;
	}
	return count;
}

function _getTeacherNonCommentTokenTotal() {
	if (!_teacherFiles) return 0;
	const names = Object.keys(_teacherFiles).sort();
	const key =
		names.join("|") +
		"::" +
		names.map((n) => (_teacherFiles[n] || "").length).join(",");
	if (key === _teacherTokenTotalCacheKey) return _teacherTokenTotalCache;
	let total = 0;
	for (const name of names)
		total += _countNonCommentTokens(_teacherFiles[name] || "", name);
	_teacherTokenTotalCache = total;
	_teacherTokenTotalCacheKey = key;
	return total;
}

function _computeFollowScore(marksEntry) {
	if (!marksEntry) return null;
	if (typeof marksEntry.score === "number") {
		return round1(marksEntry.score);
	}
	const total = _getTeacherNonCommentTokenTotal();
	if (total === 0) return null;
	let nMissing = 0;
	let nPhantomMissing = 0;
	for (const marks of Object.values(marksEntry.teacher_files || {})) {
		for (const m of marks || []) {
			if (m.label === "missing") {
				nMissing++;
				if (m.token && /^\s+$/.test(m.token)) nPhantomMissing++;
			}
		}
	}
	let nGhostExtra = 0;
	let nExtraUnpaired = 0;
	for (const marks of Object.values(marksEntry.student_files || {})) {
		for (const m of marks || []) {
			if (m.label === "ghost_extra") nGhostExtra++;
			else if (m.label === "extra" && !m.paired_with) nExtraUnpaired++;
		}
	}
	const teacherTotal = total + nPhantomMissing;
	const nFound = total - (nMissing - nPhantomMissing);
	const raw =
		Math.max(0, (nFound - nGhostExtra - nExtraUnpaired) / teacherTotal) * 100;
	return round1(raw);
}

function _updateTitleScore() {
	if (!_titleBase) return;
	const score = _computeFollowScore(_currentMarksEntry);
	const suffix = score != null ? ` (${score.toFixed(1)}%)` : "";
	const newTitle = _titleBase + suffix;
	const el = document.getElementById("title-student");
	if (el) el.textContent = newTitle;
	document.title = `${newTitle} : Differentiator`;
}

function _refreshLinePaddingButton() {
	const btn = document.getElementById("btn-line-padding");
	if (!btn) return;
	btn.classList.toggle("is-toggle-on", _linePaddingEnabled);
	btn.textContent = _linePaddingEnabled ? "⇲ Padding" : "⇱ Padding";
}

function _refreshSmartPaddingButton() {
	const btn = document.getElementById("btn-smart-padding");
	if (!btn) return;
	btn.classList.toggle("is-toggle-on", _smartPaddingEnabled);
	btn.textContent = _smartPaddingEnabled ? "🪜 Smart" : "🪜 Smart";
}

function _refreshLineNumbersButton() {
	const btn = document.getElementById("btn-line-numbers");
	if (!btn) return;
	btn.classList.toggle("is-toggle-on", _lineNumbersEnabled);
	btn.textContent = _lineNumbersEnabled ? "Line №" : "Line №";
}

function _applyLineNumbersClass() {
	if (typeof document === "undefined") return;
	document.body.classList.toggle("show-line-numbers", _lineNumbersEnabled);
}

function toggleLineNumbers() {
	_lineNumbersEnabled = !_lineNumbersEnabled;
	try {
		localStorage.setItem(
			"diff-line-numbers",
			_lineNumbersEnabled ? "on" : "off",
		);
	} catch {}
	_refreshLineNumbersButton();
	_applyLineNumbersClass();
	requestAnimationFrame(_updateHScrollProxies);
}

function toggleLinePadding() {
	_linePaddingEnabled = !_linePaddingEnabled;
	try {
		localStorage.setItem(
			"diff-line-padding",
			_linePaddingEnabled ? "on" : "off",
		);
	} catch {}
	_refreshLinePaddingButton();
	if (_teacherFiles && Object.keys(_teacherFiles).length) {
		const savedT = _saveState("teacher");
		const savedS = _saveState("student");
		renderPanel("teacher", _teacherFiles, _teacherMarks);
		renderPanel("student", _studentFiles, _studentMarks);
		_restoreState("teacher", savedT);
		_restoreState("student", savedS);
		if (typeof _curatedEditMode !== "undefined" && _curatedEditMode) {
			requestAnimationFrame(() => {
				_curatedRefreshOverlays();
			});
		}
	}
}

function toggleSmartPadding() {
	_smartPaddingEnabled = !_smartPaddingEnabled;
	try {
		localStorage.setItem(
			"diff-smart-padding",
			_smartPaddingEnabled ? "on" : "off",
		);
	} catch {}
	_refreshSmartPaddingButton();
	if (_teacherFiles && Object.keys(_teacherFiles).length) {
		const savedT = _saveState("teacher");
		const savedS = _saveState("student");
		renderPanel("teacher", _teacherFiles, _teacherMarks);
		renderPanel("student", _studentFiles, _studentMarks);
		_restoreState("teacher", savedT);
		_restoreState("student", savedS);
		if (typeof _curatedEditMode !== "undefined" && _curatedEditMode) {
			requestAnimationFrame(() => {
				_curatedRefreshOverlays();
			});
		}
	}
}

function _isPreviewMode() {
	if (_previewOverride !== null) return _previewOverride;
	return localStorage.getItem("diff-preview-mode") === "preview";
}

function _refreshPreviewButton() {
	const btn = document.getElementById("btn-preview");
	if (!btn) return;
	const on = _isPreviewMode();
	btn.classList.toggle("is-toggle-on", on);
	btn.textContent = on ? "\u2b1b Preview" : "\u2b1c Preview";
}

function _applyPreviewMode(isPreview) {
	for (const side of ["teacher", "student"]) {
		const codeWrap = document.getElementById(`code-${side}`);
		const iframe = document.getElementById(`preview-${side}`);
		const content = document.getElementById(`content-${side}`);
		if (!codeWrap || !content || content.style.display === "none") continue;

		if (isPreview) {
			const files = side === "teacher" ? _teacherFiles : _studentFiles;
			if (!files || !Object.keys(files).length) continue;
			if (iframe) {
				updatePreview(side, files, iframe);
				iframe.style.display = "block";
			}
			codeWrap.style.display = "none";
		} else {
			if (iframe) iframe.style.display = "none";
			codeWrap.style.display = "";
		}
		_updateHScrollProxy(side);
	}
}

function _hscrollProxyFor(side) {
	const codeWrap = document.getElementById(`code-${side}`);
	const proxy = document.getElementById(`hscroll-${side}`);
	if (!codeWrap || !proxy) return null;
	if (!proxy.dataset.wired) {
		proxy.dataset.wired = "1";
		let syncing = false;
		proxy.addEventListener(
			"scroll",
			() => {
				if (syncing) return;
				syncing = true;
				codeWrap.scrollLeft = proxy.scrollLeft;
				syncing = false;
			},
			{ passive: true },
		);
		codeWrap.addEventListener(
			"scroll",
			() => {
				if (syncing) return;
				syncing = true;
				proxy.scrollLeft = codeWrap.scrollLeft;
				syncing = false;
			},
			{ passive: true },
		);
	}
	return { codeWrap, proxy };
}

function _updateHScrollProxy(side) {
	const refs = _hscrollProxyFor(side);
	if (!refs) return;
	const { codeWrap, proxy } = refs;
	const hidden =
		codeWrap.style.display === "none" || codeWrap.clientWidth === 0;
	const overflow = codeWrap.scrollWidth - codeWrap.clientWidth;
	if (!hidden && overflow > 1) {
		proxy.firstElementChild.style.width = `${codeWrap.scrollWidth}px`;
		proxy.classList.add("is-active");
		proxy.scrollLeft = codeWrap.scrollLeft;
	} else {
		proxy.classList.remove("is-active");
	}
}

function _updateHScrollProxies() {
	_updateHScrollProxy("teacher");
	_updateHScrollProxy("student");
}

function _updateTabHScroll(side) {
	const tabs = document.getElementById(`tabs-${side}`);
	const proxy = document.getElementById(`tab-hscroll-${side}`);
	if (!tabs || !proxy) return;
	const inner = proxy.firstElementChild;
	const overflow = tabs.scrollWidth - tabs.clientWidth;
	if (overflow > 1) {
		inner.style.width = `${tabs.scrollWidth}px`;
		proxy.classList.add("is-active");
		proxy.scrollLeft = tabs.scrollLeft;
		if (!proxy.dataset.wired) {
			proxy.dataset.wired = "1";
			let syncing = false;
			proxy.addEventListener(
				"scroll",
				() => {
					if (syncing) return;
					syncing = true;
					tabs.scrollLeft = proxy.scrollLeft;
					syncing = false;
				},
				{ passive: true },
			);
			tabs.addEventListener(
				"scroll",
				() => {
					if (syncing) return;
					syncing = true;
					proxy.scrollLeft = tabs.scrollLeft;
					syncing = false;
				},
				{ passive: true },
			);
		}
	} else {
		proxy.classList.remove("is-active");
	}
}

function _updateTabHScrolls() {
	_updateTabHScroll("teacher");
	_updateTabHScroll("student");
}

function togglePreview() {
	const next = !_isPreviewMode();
	_previewOverride = null;
	localStorage.setItem("diff-preview-mode", next ? "preview" : "code");
	_applyPreviewMode(next);
	_refreshPreviewButton();
}

function _refreshPreviewIfActive(side) {
	if (!_isPreviewMode()) return;
	const iframe = document.getElementById(`preview-${side}`);
	if (!iframe || iframe.style.display === "none") return;
	const files = side === "teacher" ? _teacherFiles : _studentFiles;
	if (!files || !Object.keys(files).length) return;
	updatePreview(side, files, iframe);
}

function _activeHtmlFileFor(side, files) {
	const activeBtn = document.querySelector(`#tabs-${side} .file-tab-active`);
	const activeName = activeBtn?.dataset.fileName;
	if (activeName && /\.html$/i.test(activeName) && files[activeName] != null) {
		return activeName;
	}
	for (const name of Object.keys(files)) {
		if (/\.html$/i.test(name)) return name;
	}
	return null;
}

function updatePreview(side, files, iframe) {
	const activeHtml = _activeHtmlFileFor(side, files);
	if (!activeHtml) {
		iframe.srcdoc = `<p style='font-family:sans-serif;padding:20px;color:${THEME.muted}'>No HTML file found.</p>`;
		return;
	}
	let html = files[activeHtml];
	const baseUrl = side === "teacher" ? _teacherBaseUrl : _studentBaseUrl;
	const headInjects = [];
	if (baseUrl) headInjects.push(`<base href="${baseUrl}">`);
	const mediaMap = {};
	for (const [name, url] of Object.entries(_imageUris)) {
		if (/^(?:blob|https?):/i.test(url)) mediaMap[name] = url;
	}
	if (Object.keys(mediaMap).length) {
		headInjects.push(_buildMediaShimScript(mediaMap));
	}
	if (headInjects.length) html = _injectIntoHead(html, headInjects.join("\n"));
	const filesMap = { ..._imageUris };
	for (const [name, content] of Object.entries(files)) {
		if (!/\.html$/i.test(name)) filesMap[name] = content;
	}
	iframe.srcdoc = inlineFilesInHtml(html, filesMap) || "";
}

function _injectIntoHead(html, snippet) {
	if (/<head\b[^>]*>/i.test(html)) {
		return html.replace(/(<head\b[^>]*>)/i, `$1\n${snippet}`);
	}
	if (/<html\b[^>]*>/i.test(html)) {
		return html.replace(/(<html\b[^>]*>)/i, `$1\n<head>${snippet}</head>`);
	}
	return `<head>${snippet}</head>${html}`;
}

function _buildMediaShimScript(mediaMap) {
	const json = JSON.stringify(mediaMap).replace(/<\/script/gi, "<\\/script");
	return (
		"<script>(function(){const __M=" +
		json +
		";function _b(s){return String(s).split(/[/\\\\]/).pop();}" +
		"const _OA=window.Audio;" +
		"window.Audio=function(src){const m=typeof src==='string'?__M[_b(src)]:null;return new _OA(m||src);};" +
		"window.Audio.prototype=_OA.prototype;" +
		"})();</script>"
	);
}

function _refreshDocxButton() {
	const btn = document.getElementById("btn-docx");
	if (!btn) return;
	const names = Object.keys(_docUris);
	btn.style.display = names.length ? "" : "none";
	btn.textContent = names.length === 1 ? `📄 ${names[0]}` : "📄 Answer";
}

function _ensureDocxViewer() {
	let win = document.getElementById("docx-viewer");
	if (win) return win;
	win = document.createElement("div");
	win.id = "docx-viewer";
	win.innerHTML = `
		<div id="docx-viewer-head">
			<span id="docx-viewer-title">Answer</span>
			<button id="docx-viewer-close" title="Close">✕</button>
		</div>
		<div id="docx-viewer-body"></div>`;
	document.body.appendChild(win);
	makeDraggable(win.querySelector("#docx-viewer-head"), win);
	win.querySelector("#docx-viewer-close").onclick = _closeDocxViewer;
	return win;
}

function _closeDocxViewer() {
	const win = document.getElementById("docx-viewer");
	if (win) win.classList.remove("is-open");
}

async function _docxHtml(url) {
	if (_docHtmlCache[url] != null) return _docHtmlCache[url];
	const resp = await fetch(url);
	const buf = await resp.arrayBuffer();
	const result = await window.mammoth.convertToHtml({ arrayBuffer: buf });
	_docHtmlCache[url] = result.value || "";
	return _docHtmlCache[url];
}

async function toggleDocxViewer() {
	const win = _ensureDocxViewer();
	if (win.classList.contains("is-open")) {
		win.classList.remove("is-open");
		return;
	}
	const names = Object.keys(_docUris);
	if (!names.length) return;
	if (typeof window.mammoth === "undefined") {
		alert("Word viewer library (mammoth.js) failed to load.");
		return;
	}
	if (!win.style.left) {
		win.style.left = `${Math.round(window.innerWidth * 0.18)}px`;
		win.style.top = `${Math.round(window.innerHeight * 0.1)}px`;
	}
	win.querySelector("#docx-viewer-title").textContent =
		names.length === 1 ? names[0] : "Answer";
	const body = win.querySelector("#docx-viewer-body");
	body.textContent = "Converting…";
	win.classList.add("is-open");
	try {
		const sections = [];
		for (const name of names) {
			const html = await _docxHtml(_docUris[name]);
			const heading =
				names.length > 1
					? `<div class="docx-file-name">${escHtml(name)}</div>`
					: "";
			sections.push(heading + html);
		}
		body.innerHTML = sections.join("");
	} catch (e) {
		body.textContent = `Failed to render document: ${(e && e.message) || e}`;
	}
}
