"use strict";

let _truthEditMode = false;
let _truthControlsEl = null;
let _truthPending = null;
let _truthFloatWin = null;
let _truthPairHoverMarkEls = [];
const _truthTokenCache = new Map();
const _truthCommentRangeCache = new Map();
const _truthFloaters = new Map();

let _truthWorking = {};

let _truthUndoStack = [];
let _truthRedoStack = [];
const _TRUTH_HISTORY_LIMIT = 100;

const _TRUTH_IGNORE_SELECTORS = [
	"#truth-controls",
	"#leo-tooltip",
	".truth-float-win",
	"#bottom-bar",
];

function _deepClone(obj) {
	return JSON.parse(JSON.stringify(obj));
}

function _truthIsBackgroundClick(target) {
	for (const sel of _TRUTH_IGNORE_SELECTORS) {
		if (target.closest && target.closest(sel)) return true;
	}
	return false;
}

function _truthEnsureButtons() {
	const bar = document.getElementById("bottom-bar");
	if (!bar || document.getElementById("btn-save-truth")) return;
	const make = (id, text, onClick, extraClass) => {
		const b = document.createElement("button");
		b.id = id;
		b.className = "btn-edit" + (extraClass ? " " + extraClass : "");
		b.textContent = text;
		b.addEventListener("click", onClick);
		bar.appendChild(b);
	};
	make("btn-save-truth", "💾 Download", _truthDownload, "truth-only-btn");
	make("btn-copy-truth", "📋 Copy", _truthCopyToClipboard, "truth-only-btn");
	make(
		"btn-summarize-truth",
		"📑 Corrections",
		_truthSummarize,
		"truth-only-btn",
	);
	make("btn-preview-truth", "👁 Test", _truthPreview, "truth-only-btn");
}

function _truthRenderPreservingScroll() {
	const tState = _saveState("teacher");
	const sState = _saveState("student");
	if (_teacherFiles) renderPanel("teacher", _teacherFiles, _teacherMarks);
	if (_studentFiles) renderPanel("student", _studentFiles, _studentMarks);
	_restoreState("teacher", tState);
	_restoreState("student", sState);
	requestAnimationFrame(() => {
		_truthRefreshOverlays();
		_truthRefreshPairConnectors();
	});
}

function _truthWorkingKey() {
	return _diffMode == null ? "" : _diffMode;
}

function _truthSwitchToTruthMarks() {
	_currentMarksEntry = _truthWorking[_truthWorkingKey()] ?? null;
	_teacherMarks = _currentMarksEntry?.teacher_files ?? null;
	_studentMarks = _currentMarksEntry?.student_files ?? null;
}

let _truthListenersInstalled = false;

function _truthInstallListeners() {
	if (_truthListenersInstalled) return;
	_truthListenersInstalled = true;
	document.addEventListener("mouseup", _truthOnMouseUp);
	document.addEventListener("keydown", _truthOnKeyDown);
	document.addEventListener("mousemove", _truthOnPairMouseMove);
	document.addEventListener("mousemove", _truthOnGroupHover);
	const scroll = document.getElementById("diff-scroll");
	if (scroll)
		scroll.addEventListener("scroll", _truthOnScroll, { passive: true });
	window.addEventListener("resize", _truthOnResize);
}

function _truthStripExtentFields(filesObj) {
	if (!filesObj) return;
	for (const marks of Object.values(filesObj)) {
		if (!Array.isArray(marks)) continue;
		for (const m of marks) {
			delete m.extent_start;
			delete m.extent_end;
		}
	}
}

function _truthEnable() {
	_truthTokenCache.clear();
	_truthCommentRangeCache.clear();
	_truthCancelPending();
	_truthClearPairHover();
	_truthClearGroupHover();
	_truthHideControls();
	_truthClearPairConnectors();
	_truthActiveGroupRange = null;
	_truthUndoStack = [];
	_truthRedoStack = [];
	const key = _truthWorkingKey();
	if (!_truthWorking[key]) {
		const base = _allMarks[key] ?? null;
		const seed = {
			token_matching: key === "required" ? "required" : "ideal",
			teacher_files: (base && base.teacher_files) || {},
			student_files: (base && base.student_files) || {},
			file_pairs: (base && base.file_pairs) || {},
		};
		if (base) {
			if (base.alignments) seed.alignments = base.alignments;
			if (base.line_marks) seed.line_marks = base.line_marks;
			if (base.leo_assignments) seed.leo_assignments = base.leo_assignments;
		}
		if (!seed.leo_assignments) {
			for (const m of Object.values(_allMarks)) {
				if (m && m.leo_assignments) {
					seed.leo_assignments = m.leo_assignments;
					break;
				}
			}
		}
		const cloned = _deepClone(seed);
		_truthStripExtentFields(cloned.teacher_files);
		_truthStripExtentFields(cloned.student_files);
		_truthWorking[key] = cloned;
	}

	_truthEditMode = true;
	_truthSwitchToTruthMarks();
	_truthRenderPreservingScroll();
	_updateTitleScore();

	document.body.classList.add("truth-edit-mode");
	_truthInstallListeners();
	_persistDiffState();
}

function _truthHideFilePairMenu() {
	const menu = document.getElementById("file-pair-menu");
	if (!menu) return;
	if (menu._cleanup) menu._cleanup();
	menu.remove();
}

function _truthShowFilePairMenu(anchor, studentFile) {
	_truthHideFilePairMenu();
	const teacherCodeFiles = sortFileNames(
		Object.keys(_teacherFiles || {}).filter((n) => CODE_EXT.test(n)),
		true,
	);
	const filePairs = _currentMarksEntry?.file_pairs || {};
	const current = filePairs[studentFile] || "";
	const menu = document.createElement("div");
	menu.id = "file-pair-menu";
	menu.className = "file-pair-menu";

	const addItem = (label, value) => {
		const item = document.createElement("button");
		item.className = "file-pair-menu-item";
		item.textContent = label;
		if (value === current) item.classList.add("is-current");
		item.addEventListener("click", (ev) => {
			ev.stopPropagation();
			_truthHideFilePairMenu();
			_truthSetFilePair(studentFile, value);
		});
		menu.appendChild(item);
	};
	addItem(studentFile, "");
	for (const tName of teacherCodeFiles) {
		if (tName === studentFile) continue;
		addItem(tName, tName);
	}

	document.body.appendChild(menu);
	const r = anchor.getBoundingClientRect();
	menu.style.position = "fixed";
	menu.style.top = r.bottom + 2 + "px";
	menu.style.left = r.left + "px";

	const onOutside = (ev) => {
		if (!menu.contains(ev.target) && ev.target !== anchor) {
			_truthHideFilePairMenu();
		}
	};
	const onEsc = (ev) => {
		if (ev.key === "Escape") _truthHideFilePairMenu();
	};
	setTimeout(() => {
		document.addEventListener("click", onOutside);
		document.addEventListener("keydown", onEsc);
	}, 0);
	menu._cleanup = () => {
		document.removeEventListener("click", onOutside);
		document.removeEventListener("keydown", onEsc);
	};
}

function _truthSetFilePair(studentFile, teacherFile) {
	const t = _truthMarks();
	if (!t) return;
	if (!t.file_pairs) t.file_pairs = {};
	const prev = t.file_pairs[studentFile] || "";
	const next = teacherFile || "";
	if (prev === next) return;
	_truthSnapshot();
	if (next) t.file_pairs[studentFile] = next;
	else delete t.file_pairs[studentFile];
	_truthRerender();
}

function _truthSnapshot() {
	const key = _truthWorkingKey();
	const cur = _truthWorking[key];
	if (!cur) return;
	_truthUndoStack.push({ key, state: _deepClone(cur) });
	if (_truthUndoStack.length > _TRUTH_HISTORY_LIMIT) _truthUndoStack.shift();
	_truthRedoStack = [];
}

function _truthApplyHistoryState(entry) {
	if (!entry) return;
	_truthWorking[entry.key] = _deepClone(entry.state);
	_truthCancelPending();
	_truthClearPairHover();
	_truthClearGroupHover();
	_truthHideControls();
	_truthClearPairConnectors();
	_truthSwitchToTruthMarks();
	_truthRenderPreservingScroll();
	_updateTitleScore();
	_persistDiffState();
}

function _truthUndo() {
	if (!_truthUndoStack.length) return;
	const key = _truthWorkingKey();
	const cur = _truthWorking[key];
	const entry = _truthUndoStack.pop();
	if (cur) {
		_truthRedoStack.push({ key, state: _deepClone(cur) });
		if (_truthRedoStack.length > _TRUTH_HISTORY_LIMIT)
			_truthRedoStack.shift();
	}
	_truthApplyHistoryState(entry);
}

function _truthRedo() {
	if (!_truthRedoStack.length) return;
	const key = _truthWorkingKey();
	const cur = _truthWorking[key];
	const entry = _truthRedoStack.pop();
	if (cur) {
		_truthUndoStack.push({ key, state: _deepClone(cur) });
		if (_truthUndoStack.length > _TRUTH_HISTORY_LIMIT)
			_truthUndoStack.shift();
	}
	_truthApplyHistoryState(entry);
}
