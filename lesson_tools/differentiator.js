"use strict";

let _diffMode = null;
let _teacherFiles = null;
let _studentFiles = null;
let _teacherMarks = null;
let _studentMarks = null;
let _allMarks = {};
let _currentMarksEntry = null;
let _titleBase = null;
let _imageUris = {};
let _diffSessionKey = null;
let _linePaddingEnabled =
	typeof localStorage !== "undefined" &&
	localStorage.getItem("diff-line-padding") === "off"
		? false
		: true;
let _lineNumbersEnabled =
	typeof localStorage !== "undefined" &&
	localStorage.getItem("diff-line-numbers") === "on";

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

const _CODE_FILE_RE = /\.(html|css|js|py)$/i;

function _pairedFileName(fromSide, name) {
	const otherSide = fromSide === "teacher" ? "student" : "teacher";
	const otherFiles = otherSide === "teacher" ? _teacherFiles : _studentFiles;
	if (!otherFiles) return null;
	const otherNames = Object.keys(otherFiles).filter((n) =>
		_CODE_FILE_RE.test(n),
	);
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

function _serializeDiffState() {
	return {
		teacherFiles: _teacherFiles || {},
		studentFiles: _studentFiles || {},
		imageUris: _imageUris || {},
		allMarks: _allMarks || {},
		truthWorking: typeof _truthWorking !== "undefined" ? _truthWorking : {},
		mode: _diffMode,
		teacherMarks: _currentMarksEntry?.teacher_files ?? _teacherMarks ?? null,
		studentMarks: _currentMarksEntry?.student_files ?? _studentMarks ?? null,
		title: document.title || null,
		titleBase: _titleBase,
	};
}

function _persistDiffState() {
	if (!_diffSessionKey) return;
	if (!_teacherFiles && !_studentFiles) return;
	try {
		sessionStorage.setItem(
			_diffSessionKey,
			JSON.stringify(_serializeDiffState()),
		);
	} catch {}
}

function _applyIncomingData(data) {
	_teacherFiles = data.teacherFiles || {};
	_studentFiles = data.studentFiles || {};
	_imageUris = data.imageUris || {};
	if (data.truthWorking && typeof _truthWorking !== "undefined") {
		_truthWorking = data.truthWorking;
	}

	if (data.allMarks) {
		_allMarks = data.allMarks;
		_diffMode = defaultDiffModeKey(_allMarks, _diffMode);
		_refreshModeSelect();
		_applyCurrentMarks();
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
	if (typeof _truthEnable === "function") _truthEnable();
}

function _showLoading(on) {
	const el = document.getElementById("loading");
	if (el) el.style.display = on ? "flex" : "none";
}

window.addEventListener("DOMContentLoaded", async () => {
	await window.LanguageProfiles.initProfiles();
	const params = new URLSearchParams(location.search);
	const keyParam = params.get("key");
	const key = keyParam || "diffData";
	_diffSessionKey = keyParam ? `differentiatorSession:${keyParam}` : null;
	const modeParam = params.get("mode") || null;
	_diffMode = modeParam;
	_refreshLinePaddingButton();
	_refreshLineNumbersButton();
	_refreshPreviewButton();
	_applyLineNumbersClass();

	const expectAutoLoad =
		!!keyParam ||
		!!localStorage.getItem(key) ||
		(_diffSessionKey && !!sessionStorage.getItem(_diffSessionKey)) ||
		(window.opener &&
			typeof window.opener.__getDifferentiatorData === "function");
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
			if (typeof _truthEnable === "function") {
				_truthEnable();
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
			_persistDiffState();
		});

		document.addEventListener("keydown", (ev) => {
			if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey) return;
			if (typeof _truthCurrentSel !== "undefined" && _truthCurrentSel)
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
	const raw = localStorage.getItem(key);
	if (raw) {
		localStorage.removeItem(key);
		try {
			incoming = JSON.parse(raw);
		} catch (e) {
			console.error("[Differentiator] Failed to parse diff data", e);
		}
	}
	if (
		!incoming &&
		window.opener &&
		typeof window.opener.__getDifferentiatorData === "function"
	) {
		try {
			incoming = await window.opener.__getDifferentiatorData(key);
		} catch (e) {
			console.error("[Differentiator] Failed to fetch from opener", e);
		}
	}
	if (incoming) {
		_applyIncomingData(incoming);
		_persistDiffState();
	} else if (_diffSessionKey) {
		const savedRaw = sessionStorage.getItem(_diffSessionKey);
		if (savedRaw) {
			try {
				_applyIncomingData(JSON.parse(savedRaw));
			} catch (e) {
				console.error("[Differentiator] Failed to restore session data", e);
			}
		}
	}
	_showLoading(false);

	window.addEventListener("beforeunload", _persistDiffState);
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") _persistDiffState();
	});

	document.getElementById("input-teacher").addEventListener("change", (e) => {
		loadFilesFromInput(e.target.files, "teacher");
	});
	document.getElementById("input-student").addEventListener("change", (e) => {
		loadFilesFromInput(e.target.files, "student");
	});
});

function loadFilesFromInput(files, side) {
	const texts = {};
	let pending = files.length;
	if (!pending) return;

	for (const file of files) {
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
				if (typeof _truthEnable === "function") _truthEnable();
				_persistDiffState();
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
		return Math.round(marksEntry.score * 10) / 10;
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
	return Math.round(raw * 10) / 10;
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
		if (typeof _truthEditMode !== "undefined" && _truthEditMode) {
			requestAnimationFrame(() => {
				_truthRefreshOverlays();
			});
		}
	}
}

function _isPreviewMode() {
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
	}
}

function togglePreview() {
	const next = !_isPreviewMode();
	localStorage.setItem("diff-preview-mode", next ? "preview" : "code");
	_applyPreviewMode(next);
	_refreshPreviewButton();
}

function updatePreview(side, files, iframe) {
	const htmlEntry = Object.entries(files).find(([name]) =>
		/\.html$/i.test(name),
	);
	if (!htmlEntry) {
		iframe.srcdoc =
			"<p style='font-family:sans-serif;padding:20px;color:#888'>No HTML file found.</p>";
		return;
	}
	const html = htmlEntry[1];
	const filesMap = { ..._imageUris };
	for (const [name, content] of Object.entries(files)) {
		if (!/\.html$/i.test(name)) filesMap[name] = content;
	}
	iframe.srcdoc = inlineFilesInHtml(html, filesMap) || "";
}
