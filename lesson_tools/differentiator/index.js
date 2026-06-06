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
