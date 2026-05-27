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

function _applyIncomingData(data) {
	_teacherFiles = data.teacherFiles || {};
	_studentFiles = data.studentFiles || {};
	_imageUris = data.imageUris || {};
	_teacherBaseUrl = data.teacherBaseUrl || null;
	_studentBaseUrl = data.studentBaseUrl || null;

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
	if (typeof _curatedEnable === "function") _curatedEnable();
}

function _showLoading(on) {
	const el = document.getElementById("loading");
	if (el) el.style.display = on ? "flex" : "none";
}

let _navState = {
	lesson: null,
	group: null,
	dataSource: null,
	ids: [],
	currentIdx: -1,
};

function _sortStudentIds(ids) {
	return [...ids].sort((a, b) => {
		const na = Number(a);
		const nb = Number(b);
		if (
			Number.isFinite(na) &&
			Number.isFinite(nb) &&
			String(na) === a &&
			String(nb) === b
		)
			return na - nb;
		return a.localeCompare(b, undefined, { numeric: true });
	});
}

function _extractStudentIds(files) {
	const idSet = new Set();
	for (const path of files.keys()) {
		const m = path.match(/^anon_ids\/([^/]+)\//i);
		if (m) idSet.add(m[1]);
	}
	return _sortStudentIds([...idSet]);
}

function _updateStudentNavButtons() {
	const prev = document.getElementById("nav-prev-student");
	const next = document.getElementById("nav-next-student");
	if (!prev || !next) return;
	const n = _navState.ids.length;
	const i = _navState.currentIdx;
	prev.disabled = !(n > 0 && i > 0);
	next.disabled = !(n > 0 && i >= 0 && i < n - 1);
	if (n > 0 && i >= 0) {
		prev.title = `Previous student (${i}/${n - 1} done)`;
		next.title = `Next student (${i + 1}/${n - 1} remaining)`;
	}
}

async function _loadFromUrlParams({ lesson, group, id, title }) {
	const ds = await loadLessonDataSource({ lesson, group });
	if (!ds) return null;
	await ds.load();
	const studentPrefix = "anon_ids/" + String(id).toLowerCase() + "/";
	const data = await buildDiffPayloadData(ds.files, studentPrefix);
	if (
		!Object.keys(data.teacherFiles).length &&
		!Object.keys(data.studentFiles).length
	) {
		console.warn(
			`[Differentiator] No code files found for ${lesson}/anon_ids/${id}/.`,
		);
		return null;
	}
	const ids = _extractStudentIds(ds.files);
	_navState = {
		lesson,
		group: group || null,
		dataSource: ds,
		ids,
		currentIdx: ids.findIndex(
			(x) => x.toLowerCase() === String(id).toLowerCase(),
		),
	};
	_updateStudentNavButtons();
	data.title = title || `${id}. Student`;
	return _buildDiffPayload(data);
}

async function _navToStudent(idx) {
	if (!_navState.dataSource) return;
	if (idx < 0 || idx >= _navState.ids.length) return;
	const id = _navState.ids[idx];
	_showLoading(true);
	try {
		const data = await buildDiffPayloadData(
			_navState.dataSource.files,
			"anon_ids/" + id.toLowerCase() + "/",
		);
		if (
			!Object.keys(data.teacherFiles).length &&
			!Object.keys(data.studentFiles).length
		) {
			console.warn(
				`[Differentiator] No code files for ${_navState.lesson}/anon_ids/${id}/.`,
			);
			return;
		}
		data.title = `${id}. Student`;
		_applyIncomingData(_buildDiffPayload(data));
		_navState.currentIdx = idx;
		_updateStudentNavButtons();
		const url = new URL(location.href);
		url.searchParams.set("id", id);
		url.searchParams.delete("title");
		history.replaceState(null, "", url);
	} catch (e) {
		console.error("[Differentiator] Navigation failed:", e);
	} finally {
		_showLoading(false);
	}
}

window.addEventListener("DOMContentLoaded", async () => {
	await window.LanguageProfiles.initProfiles();
	const params = new URLSearchParams(location.search);
	const modeParam = params.get("mode") || null;
	_diffMode = modeParam;
	const toolParams = parseToolParams();
	_refreshLinePaddingButton();
	_refreshLineNumbersButton();
	_refreshPreviewButton();
	_applyLineNumbersClass();

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
				if (typeof _curatedEnable === "function") _curatedEnable();
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
		if (typeof _curatedEditMode !== "undefined" && _curatedEditMode) {
			requestAnimationFrame(() => {
				_curatedRefreshOverlays();
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
		iframe.srcdoc = `<p style='font-family:sans-serif;padding:20px;color:${THEME.muted}'>No HTML file found.</p>`;
		return;
	}
	let html = htmlEntry[1];
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
