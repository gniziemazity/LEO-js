"use strict";

let _curatedEditMode = false;
let _curatedControlsEl = null;
let _curatedPending = null;
let _curatedFloatWin = null;
let _curatedPairHoverMarkEls = [];
const _curatedFloaters = new Map();

const _CURATED_IGNORE_SELECTORS = [
	"#curated-controls",
	"#leo-tooltip",
	".curated-float-win",
	"#bottom-bar",
];

function _deepClone(obj) {
	return JSON.parse(JSON.stringify(obj));
}

function _curatedIsBackgroundClick(target) {
	for (const sel of _CURATED_IGNORE_SELECTORS) {
		if (target.closest && target.closest(sel)) return true;
	}
	return false;
}

function _curatedEnsureButtons() {
	const bar = document.getElementById("bottom-bar");
	if (!bar || document.getElementById("btn-preview-curated")) return;
	const make = (id, text, onClick) => {
		const b = document.createElement("button");
		b.id = id;
		b.className = "btn-edit";
		b.textContent = text;
		b.addEventListener("click", onClick);
		bar.appendChild(b);
	};
	make("btn-savefolder-curated", "💾 Save", _curatedOpenSaveDialog);
	make("btn-preview-curated", "🪄 Corrections", _curatedPreview);

	const parity = document.createElement("div");
	parity.id = "curated-parity-line";
	parity.style.cssText =
		"display:none;font-size:11px;font-weight:600;text-align:center;" +
		"padding:3px 8px;border-radius:6px;border:1px solid;white-space:nowrap;";
	bar.appendChild(parity);
}

function _curatedRenderPreservingScroll() {
	const tState = _saveState("teacher");
	const sState = _saveState("student");
	if (_teacherFiles) renderPanel("teacher", _teacherFiles, _teacherMarks);
	if (_studentFiles) renderPanel("student", _studentFiles, _studentMarks);
	_restoreState("teacher", tState);
	_restoreState("student", sState);
	requestAnimationFrame(() => {
		_curatedRefreshOverlays();
		_curatedRefreshPairConnectors();
	});
	if (typeof _curatedUpdateParityIndicator === "function")
		_curatedUpdateParityIndicator();
}

function _curatedWorkingKey() {
	return _curatedSel.workingKey();
}

function _curatedSwitchToCuratedMarks() {
	_curatedSel.switchToCuratedMarks();
}

function _curatedResetForNewStudent() {
	_curatedSel.reset();
}

let _curatedListenersInstalled = false;

function _curatedInstallListeners() {
	if (_curatedListenersInstalled) return;
	_curatedListenersInstalled = true;
	document.addEventListener("mouseup", _curatedOnMouseUp);
	document.addEventListener("keydown", _curatedOnKeyDown);
	document.addEventListener("mousemove", _curatedOnPairMouseMove);
	document.addEventListener("mousemove", _curatedOnGroupHover);
	const scroll = document.getElementById("diff-scroll");
	if (scroll)
		scroll.addEventListener("scroll", _curatedOnScroll, { passive: true });
	window.addEventListener("resize", _curatedOnResize);
}

function _curatedStripExtentFields(filesObj) {
	if (!filesObj) return;
	for (const marks of Object.values(filesObj)) {
		if (!Array.isArray(marks)) continue;
		for (const m of marks) {
			delete m.extent_start;
			delete m.extent_end;
		}
	}
}

function _curatedEnable() {
	_curatedSel.tokenCache.clear();
	_curatedSel.commentRangeCache.clear();
	_curatedCancelPending();
	_curatedClearPairHover();
	_curatedClearGroupHover();
	_curatedHideControls();
	_curatedClearPairConnectors();
	_curatedActiveGroupRange = null;
	_curatedSel.undoStack = [];
	_curatedSel.redoStack = [];
	const key = _curatedWorkingKey();
	if (!_curatedSel.working[key]) {
		const base = _allMarks[key] ?? null;
		const seed = {
			token_matching: key === "minimal" ? "minimal" : "ideal",
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
		_curatedStripExtentFields(cloned.teacher_files);
		_curatedStripExtentFields(cloned.student_files);
		_curatedSel.working[key] = cloned;
	}

	_curatedEditMode = true;
	_curatedSwitchToCuratedMarks();
	_curatedRenderPreservingScroll();
	_updateTitleScore();

	document.body.classList.add("curated-edit-mode");
	_curatedInstallListeners();
}

function _curatedHideFilePairMenu() {
	const menu = document.getElementById("file-pair-menu");
	if (!menu) return;
	if (menu._cleanup) menu._cleanup();
	menu.remove();
}

function _curatedShowFilePairMenu(anchor, studentFile) {
	_curatedHideFilePairMenu();
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
			_curatedHideFilePairMenu();
			_curatedSetFilePair(studentFile, value);
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
			_curatedHideFilePairMenu();
		}
	};
	const onEsc = (ev) => {
		if (ev.key === "Escape") _curatedHideFilePairMenu();
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

function _curatedSetFilePair(studentFile, teacherFile) {
	const t = _curatedMarks();
	if (!t) return;
	if (!t.file_pairs) t.file_pairs = {};
	const prev = t.file_pairs[studentFile] || "";
	const next = teacherFile || "";
	if (prev === next) return;
	_curatedSnapshot();
	if (next) t.file_pairs[studentFile] = next;
	else delete t.file_pairs[studentFile];
	_curatedRerender();
}

function _curatedSnapshot() {
	_curatedSel.snapshot();
}

function _curatedUndo() {
	_curatedSel.undo();
}

function _curatedRedo() {
	_curatedSel.redo();
}
