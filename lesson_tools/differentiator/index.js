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
let _diffMissingLangColor =
	typeof localStorage === "undefined" ||
	localStorage.getItem("diff-missing-lang-color") !== "off";

const DIFF_MODE_OPTIONS = [
	{ key: "minimal", label: "Minimal" },
	{ key: "ideal", label: "Ideal" },
	{ key: "", label: "LEO*" },
	{ key: "leo", label: "LEO" },
	{ key: "token-lcs-star", label: "LCS*" },
	{ key: "token-lcs", label: "LCS" },
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
	"leo",
	"",
	"token-lcs",
	"token-lcs-star",
];

let _borrowedAlignmentKey = null;

function _borrowedAlignments() {
	if (_borrowedAlignmentKey != null) {
		const cached = _allMarks[_borrowedAlignmentKey];
		if (
			cached &&
			cached.alignments &&
			Object.keys(cached.alignments).length
		) {
			return cached.alignments;
		}
		_borrowedAlignmentKey = null;
	}
	for (const mode of _BORROW_ALIGNMENT_ORDER) {
		const m = _allMarks[mode];
		if (m && m.alignments && Object.keys(m.alignments).length) {
			_borrowedAlignmentKey = mode;
			return m.alignments;
		}
	}
	return null;
}

const _BORROW_GHOSTS_ORDER = ["", "token-lcs-star", "line-git-star"];

function _borrowedTeacherGhosts(fileName) {
	for (const mode of _BORROW_GHOSTS_ORDER) {
		const m = _allMarks[mode];
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
		_borrowedAlignmentKey = null;
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
					if (
						_linePaddingEnabled &&
						!(_currentMarksEntry && _currentMarksEntry.alignments) &&
						_borrowedAlignments() &&
						_teacherFiles &&
						Object.keys(_teacherFiles).length
					) {
						const savedT = _saveState("teacher");
						const savedS = _saveState("student");
						renderPanel("teacher", _teacherFiles, _teacherMarks);
						renderPanel("student", _studentFiles, _studentMarks);
						_restoreState("teacher", savedT);
						_restoreState("student", savedS);
						if (
							typeof _curatedEditMode !== "undefined" &&
							_curatedEditMode
						) {
							requestAnimationFrame(() => _curatedRefreshOverlays());
						}
					}
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
	_refreshLineNumbersButton();
	_refreshMissingColorButton();
	_refreshPreviewButton();
	_applyLineNumbersClass();

	_embedMode = params.get("embed") === "1";
	if (_embedMode) {
		document.body.classList.add("embed");
		_linePaddingEnabled = true;
		const tt = document.getElementById("title-teacher");
		if (tt) tt.textContent = "Starter Code";
	}
	if (toolParams.group === "assignments") {
		document.body.classList.add("assignment");
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
			const SHORTCUTS = { m: "minimal", i: "ideal", l: "" };
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
	btn.textContent = "↕️ Padding";
}

function _refreshLineNumbersButton() {
	const btn = document.getElementById("btn-line-numbers");
	if (!btn) return;
	btn.classList.toggle("is-toggle-on", _lineNumbersEnabled);
	btn.textContent = "🔢 Line №";
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

function _refreshMissingColorButton() {
	const btn = document.getElementById("btn-missing-color");
	if (!btn) return;
	btn.classList.toggle("is-toggle-on", _diffMissingLangColor);
	btn.textContent = "🎨 Lang color";
}

function toggleMissingLangColor() {
	_diffMissingLangColor = !_diffMissingLangColor;
	try {
		localStorage.setItem(
			"diff-missing-lang-color",
			_diffMissingLangColor ? "on" : "off",
		);
	} catch {}
	_refreshMissingColorButton();
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
