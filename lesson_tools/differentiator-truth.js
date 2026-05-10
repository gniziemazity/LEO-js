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
	make("btn-summarize-truth", "📑 Summary", _truthSummarize, "truth-only-btn");
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
		const cloned = JSON.parse(JSON.stringify(seed));
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

function _truthSnapshot() {
	const key = _truthWorkingKey();
	const cur = _truthWorking[key];
	if (!cur) return;
	_truthUndoStack.push({ key, state: JSON.parse(JSON.stringify(cur)) });
	if (_truthUndoStack.length > _TRUTH_HISTORY_LIMIT) _truthUndoStack.shift();
	_truthRedoStack = [];
}

function _truthApplyHistoryState(entry) {
	if (!entry) return;
	_truthWorking[entry.key] = JSON.parse(JSON.stringify(entry.state));
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
		_truthRedoStack.push({ key, state: JSON.parse(JSON.stringify(cur)) });
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
		_truthUndoStack.push({ key, state: JSON.parse(JSON.stringify(cur)) });
		if (_truthUndoStack.length > _TRUTH_HISTORY_LIMIT)
			_truthUndoStack.shift();
	}
	_truthApplyHistoryState(entry);
}

function _truthOnKeyDown(ev) {
	if (ev.key === "Escape") {
		_truthCancelPending();
		_truthClearPairHover();
		_truthHideControls();
		return;
	}

	const target = ev.target;
	const inField =
		target &&
		target.matches &&
		target.matches("input, textarea, select, [contenteditable=true]");

	if ((ev.ctrlKey || ev.metaKey) && !inField) {
		const k = ev.key.toLowerCase();
		if (k === "z" && !ev.shiftKey) {
			ev.preventDefault();
			_truthUndo();
			return;
		}
		if (k === "y" || (k === "z" && ev.shiftKey)) {
			ev.preventDefault();
			_truthRedo();
			return;
		}
	}

	if (inField) return;

	if (!_truthCurrentSel) return;
	const sel = _truthCurrentSel;

	if (sel.isGhost) {
		if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
		const k = ev.key.toLowerCase();
		const partner = _truthFindGhostPartner(sel.ghost);
		if ((k === "i" || k === "p") && !partner) {
			ev.preventDefault();
			_truthOnControlAction("set-pair-ghost", sel, [], []);
			return;
		}
		if (k === "r" && partner) {
			ev.preventDefault();
			_truthOnControlAction("unpair-ghost", sel, [], []);
			return;
		}
		return;
	}

	const tokens = _truthCurrentTokens || [];
	const existing = _truthCurrentExisting || [];

	if (
		ev.key === "Delete" ||
		ev.key === "Backspace" ||
		ev.key.toLowerCase() === "d"
	) {
		if (!existing.some((m) => m.label !== "comment")) return;
		ev.preventDefault();
		_truthOnControlAction("del-all", sel, tokens, existing);
		return;
	}

	if (ev.ctrlKey || ev.metaKey || ev.altKey) return;

	const k = ev.key.toLowerCase();
	const nonCommentExisting = existing.filter((m) => m.label !== "comment");
	const allMissing =
		nonCommentExisting.length > 0 &&
		nonCommentExisting.every((m) => m.label === "missing");
	const allExtra =
		nonCommentExisting.length > 0 &&
		nonCommentExisting.every((m) => m.label === "extra");
	const allGhostExtra =
		nonCommentExisting.length > 0 &&
		nonCommentExisting.every((m) => m.label === "ghost_extra");
	const single = nonCommentExisting.length === 1;
	const allUnpaired =
		(allMissing || allExtra || allGhostExtra) &&
		nonCommentExisting.every((m) => !m.paired_with);
	const canPair =
		((allMissing || allGhostExtra) && allUnpaired) ||
		(allExtra && single && allUnpaired);
	const hasAnyPaired = nonCommentExisting.some((m) => m.paired_with);

	const fullyLabeled = (label) =>
		nonCommentExisting.length === tokens.length &&
		nonCommentExisting.length > 0 &&
		nonCommentExisting.every((m) => m.label === label);

	if (k === "m" && sel.side === "teacher" && !fullyLabeled("missing")) {
		ev.preventDefault();
		_truthOnControlAction("set-missing", sel, tokens, existing);
	} else if (k === "e" && sel.side === "student" && !fullyLabeled("extra")) {
		ev.preventDefault();
		_truthOnControlAction("set-extra", sel, tokens, existing);
	} else if (
		k === "g" &&
		sel.side === "student" &&
		!fullyLabeled("ghost_extra")
	) {
		ev.preventDefault();
		_truthOnControlAction("set-ghost", sel, tokens, existing);
	} else if (k === "c" && !fullyLabeled("comment")) {
		ev.preventDefault();
		_truthOnControlAction("set-comment", sel, tokens, existing);
	} else if ((k === "i" || k === "p") && (tokens.length || existing.length)) {
		ev.preventDefault();
		if (sel.side === "teacher") {
			if (allMissing && fullyLabeled("missing")) {
				_truthOnControlAction("set-pair", sel, tokens, existing);
			} else {
				_truthOnControlAction("set-missing", sel, tokens, existing);
			}
		} else if (sel.side === "student") {
			if (allGhostExtra && allUnpaired) {
				_truthOnControlAction("set-pair", sel, tokens, existing);
			} else if (
				allExtra &&
				fullyLabeled("extra") &&
				single &&
				allUnpaired
			) {
				_truthOnControlAction("set-pair", sel, tokens, existing);
			} else if (existing.length === 0 || allExtra) {
				_truthOnControlAction("set-extra", sel, tokens, existing);
				const newMarks = _truthFindMarks(
					sel.side,
					sel.file,
					sel.lo,
					sel.hi,
				).filter((m) => m.label === "extra" && !m.paired_with);
				if (newMarks.length === 1) {
					_truthEnterPairMode(newMarks, sel.side, sel.file);
					_truthRefreshCurrentControls();
				}
			}
		}
	} else if (
		k === "r" &&
		hasAnyPaired &&
		(allMissing || allExtra || allGhostExtra)
	) {
		ev.preventDefault();
		_truthOnControlAction("unpair", sel, tokens, existing);
	}
}

function _truthRefreshCurrentControls() {
	if (!_truthCurrentSel) return;
	const sel = _truthCurrentSel;
	if (sel.isGhost && typeof _truthSelectGhostAndShow === "function") {
		_truthSelectGhostAndShow(sel.ghost, 0, 0);
	} else if (!sel.isGhost) {
		_truthSelectAndShow(sel.side, sel.file, sel.rawLo, sel.rawHi, 0, 0, {
			preservePosition: true,
		});
	}
}

document.addEventListener(
	"mousedown",
	(ev) => {
		if (!_truthEditMode) return;
		if (ev.button === 2 && _truthPending && _truthPending.kind === "pair") {
			ev.preventDefault();
			ev.stopPropagation();
			_truthCancelPending();
			_truthClearPairHover();
			_truthRefreshCurrentControls();
			return;
		}
		if (ev.button !== 0) return;
		if (_truthIsBackgroundClick(ev.target)) return;
		if (!ev.target.closest(".code-pane")) return;
		if (ev.target.closest(".insert-anchor")) return;
		ev.stopPropagation();
	},
	true,
);

document.addEventListener("contextmenu", (ev) => {
	if (_truthPending && _truthPending.kind === "pair") {
		ev.preventDefault();
	}
});

function _truthOnMouseUp(ev) {
	if (!_truthEditMode) return;
	if (ev.button !== 0) return;
	if (_truthPending) {
		if (_truthHandlePendingClick(ev)) return;
		if (!ev.target.closest || !ev.target.closest("#truth-controls")) {
			_truthCancelPending();
			_truthClearPairHover();
		}
	}
	if (_truthIsBackgroundClick(ev.target)) return;
	const anchorEl = ev.target.closest && ev.target.closest(".insert-anchor");
	if (anchorEl) {
		_truthSelectInsertAnchor(anchorEl, ev.clientX, ev.clientY);
		return;
	}
	const clickedGhost = _truthGhostFromTarget(ev.target);
	if (clickedGhost) {
		_truthSelectGhostAndShow(clickedGhost, ev.clientX, ev.clientY);
		return;
	}

	const sel = window.getSelection();
	const hasRange = sel && !sel.isCollapsed && sel.rangeCount > 0;

	let side, file, rawLo, rawHi;
	if (hasRange) {
		const range = sel.getRangeAt(0);
		const startInfo = _truthResolveSrcPos(
			range.startContainer,
			range.startOffset,
		);
		const endInfo = _truthResolveSrcPos(range.endContainer, range.endOffset);
		if (
			!startInfo ||
			!endInfo ||
			startInfo.side !== endInfo.side ||
			startInfo.file !== endInfo.file
		) {
			_truthHideControls();
			return;
		}
		side = startInfo.side;
		file = startInfo.file;
		rawLo = Math.min(startInfo.pos, endInfo.pos);
		rawHi = Math.max(startInfo.pos, endInfo.pos);
		if (rawLo === rawHi) {
			_truthHideControls();
			return;
		}
	} else {
		const info = _truthClickPosition(ev);
		const tok = info && _truthTokenAtPos(info.side, info.file, info.pos);
		const groupAtPoint = _truthGroupAtPoint(ev.clientX, ev.clientY);
		const tokInGroup =
			tok &&
			groupAtPoint &&
			info.side === groupAtPoint.side &&
			info.file === groupAtPoint.file &&
			tok.start >= groupAtPoint.lo &&
			tok.end <= groupAtPoint.hi;
		const tokIsMarked =
			tok &&
			info &&
			!!_truthExistingMarkAtPos(info.side, info.file, tok.start);
		if (tok && !tokInGroup && !tokIsMarked) {
			side = info.side;
			file = info.file;
			rawLo = tok.start;
			rawHi = tok.end;
		} else if (groupAtPoint) {
			side = groupAtPoint.side;
			file = groupAtPoint.file;
			rawLo = groupAtPoint.lo;
			rawHi = groupAtPoint.hi;
		} else if (tok) {
			side = info.side;
			file = info.file;
			const groupRange = _truthFindGroupRange(side, file, tok.start);
			if (groupRange) {
				rawLo = groupRange.lo;
				rawHi = groupRange.hi;
			} else {
				rawLo = tok.start;
				rawHi = tok.end;
			}
		} else {
			_truthHideControls();
			return;
		}
	}

	_truthSelectAndShow(side, file, rawLo, rawHi, ev.clientX, ev.clientY);
}

function _truthMarkSelColor(mark) {
	if (!mark) return null;
	if (mark.label === "missing") {
		return mark.paired_with ? "blue" : "red";
	}
	if (mark.label === "extra") return mark.paired_with ? "red" : "blue";
	if (mark.label === "ghost_extra") return "blue";
	return null;
}

function _truthSelectionColor(marks) {
	if (!marks || !marks.length) return null;
	let color = null;
	for (const m of marks) {
		const c = _truthMarkSelColor(m);
		if (!c) return "yellow";
		if (color == null) color = c;
		else if (color !== c) return "yellow";
	}
	return color;
}

function _truthSelectAndShow(side, file, rawLo, rawHi, x, y, showOpts) {
	const snapped = _truthSnapToTokens(side, file, rawLo, rawHi);
	const tokens = _truthTokensInRange(side, file, snapped.lo, snapped.hi);
	const existing = _truthFindMarks(side, file, snapped.lo, snapped.hi);
	if (!tokens.length && !existing.length) {
		_truthHideControls();
		return false;
	}
	_truthApplyClickHighlights(side, file, snapped.lo, snapped.hi);
	_truthShowControls(
		{
			side,
			file,
			lo: snapped.lo,
			hi: snapped.hi,
			rawLo,
			rawHi,
			tokens,
			existing,
		},
		x,
		y,
		showOpts,
	);
	return true;
}

function _truthSelectInsertAnchor(anchorEl, x, y) {
	const tFile = anchorEl.getAttribute("data-insert-anchor-teacher-file");
	const tPosStr = anchorEl.getAttribute("data-insert-anchor-teacher-pos");
	const tPos = tPosStr != null ? parseInt(tPosStr, 10) : NaN;
	if (!tFile || !Number.isFinite(tPos)) return;
	const teacherMark = _truthFileMarks("teacher", tFile).find(
		(m) => m.label === "missing" && m.start === tPos,
	);
	if (!teacherMark) return;
	const range = _truthFindGroupRange("teacher", tFile, tPos);
	const rawLo = range ? range.lo : teacherMark.start;
	const rawHi = range ? range.hi : teacherMark.end;
	_truthSelectAndShow("teacher", tFile, rawLo, rawHi, x, y);
}

function _truthGhostFromTarget(target) {
	if (!target || !target.closest) return null;
	const markEl = target.closest(".leo-mark[data-leo-ghost-offset]");
	if (!markEl) return null;
	const pane = markEl.closest(".code-pane");
	if (!pane) return null;
	const side = pane.dataset.paneSide;
	if (side !== "teacher") return null;
	const file = pane.dataset.paneFile;
	const blobPos = parseInt(markEl.dataset.leoPos, 10);
	const offset = parseInt(markEl.dataset.leoGhostOffset, 10);
	const token = markEl.dataset.leoToken || "";
	if (!Number.isFinite(blobPos) || !Number.isFinite(offset) || !token)
		return null;
	return {
		side,
		file,
		token,
		blobPos,
		offset,
		start: blobPos + offset,
		end: blobPos + offset + token.length,
		el: markEl,
	};
}

function _truthGhostMatchesPair(ghost, paired) {
	if (!paired || !paired.ghost) return false;
	return (
		paired.file === ghost.file &&
		paired.start === ghost.start &&
		paired.end === ghost.end &&
		paired.token === ghost.token
	);
}

function _truthFindGhostPartner(ghost) {
	const t = _truthMarks();
	if (!t) return null;
	const sFiles = t.student_files || {};
	for (const [file, marks] of Object.entries(sFiles)) {
		for (const m of marks || []) {
			if (m.label !== "ghost_extra") continue;
			if (_truthGhostMatchesPair(ghost, m.paired_with)) {
				return { mark: m, file };
			}
		}
	}
	return null;
}

function _truthSetGhostPair(studentMark, ghost) {
	_truthClearPair(studentMark, "student");
	studentMark.paired_with = {
		file: ghost.file,
		start: ghost.start,
		end: ghost.end,
		token: ghost.token,
		ghost: true,
	};
}

function _truthIsCommentPos(side, file, pos) {
	for (const m of _truthFileMarks(side, file)) {
		if (m.label === "comment" && m.start <= pos && pos < m.end) return true;
	}
	return false;
}

function _truthTokenAtPos(side, file, pos) {
	const all = _truthTokensForFile(side, file);
	for (const t of all) {
		if (t.start <= pos && pos < t.end) {
			if (_truthIsCommentPos(side, file, t.start)) return null;
			return t;
		}
		if (t.start > pos) break;
	}
	return null;
}

function _truthResolveSrcPos(node, offset) {
	let el = node;
	if (el && el.nodeType === 3) el = el.parentNode;
	if (!el) return null;
	const pane = el.closest(".code-pane");
	if (!pane) return null;
	const side = pane.dataset.paneSide;
	const file = pane.dataset.paneFile;
	if (!side || !file) return null;
	const lineEl = el.closest(".diff-line");
	if (!lineEl) return null;
	const lineStart = parseInt(lineEl.dataset.srcStart, 10);
	if (!Number.isFinite(lineStart)) return null;
	let range;
	try {
		range = document.createRange();
		range.setStart(lineEl, 0);
		range.setEnd(node, offset);
	} catch {
		return null;
	}
	return {
		side,
		file,
		pos: lineStart + _truthCountSourceText(range.cloneContents()),
	};
}

function _truthCountSourceText(root) {
	let total = 0;
	const walk = (n) => {
		if (n.nodeType === 1) {
			if (
				n.classList &&
				(n.classList.contains("diff-ghost") ||
					n.classList.contains("insert-anchor"))
			)
				return;
			for (const c of n.childNodes) walk(c);
		} else if (n.nodeType === 3) {
			total += n.nodeValue.length;
		} else if (n.nodeType === 11) {
			for (const c of n.childNodes) walk(c);
		}
	};
	walk(root);
	return total;
}

function _truthSnapToTokens(side, file, lo, hi) {
	const all = _truthTokensForFile(side, file);
	let first = -1,
		last = -1;
	for (let i = 0; i < all.length; i++) {
		const t = all[i];
		if (t.end <= lo) continue;
		if (t.start >= hi) break;
		if (first === -1) first = i;
		last = i;
	}
	if (first === -1) return { lo, hi };
	return {
		lo: Math.min(lo, all[first].start),
		hi: Math.max(hi, all[last].end),
	};
}

function _truthSrcText(side, file) {
	const text =
		(side === "teacher" ? _teacherFiles : _studentFiles)[file] || "";
	return text.replace(/\r\n/g, "\n");
}

function _truthTokensForFile(side, file) {
	const key = side + ":" + file;
	if (_truthTokenCache.has(key)) return _truthTokenCache.get(key);
	const text = _truthSrcText(side, file);
	const out = [];
	const re = /[a-zA-Z0-9]+|[^\s]/g;
	let m;
	while ((m = re.exec(text)) !== null) {
		out.push({ start: m.index, end: m.index + m[0].length, token: m[0] });
	}
	_truthTokenCache.set(key, out);
	return out;
}

function _truthCommentRanges(side, file) {
	const key = side + ":" + file;
	if (_truthCommentRangeCache.has(key))
		return _truthCommentRangeCache.get(key);
	const text = _truthSrcText(side, file);
	const ranges = _diffCommentRanges(text, file);
	_truthCommentRangeCache.set(key, ranges);
	return ranges;
}

function _truthSliceExcludingComments(side, file, lo, hi) {
	const text = _truthSrcText(side, file);
	const ranges = _truthCommentRanges(side, file);
	let out = "";
	let cursor = lo;
	for (const [cLo, cHi] of ranges) {
		if (cHi <= lo) continue;
		if (cLo >= hi) break;
		const a = Math.max(cLo, lo);
		if (a > cursor) out += text.slice(cursor, a);
		cursor = Math.min(cHi, hi);
	}
	if (cursor < hi) out += text.slice(cursor, hi);
	return out;
}

function _truthTokensInRange(side, file, lo, hi) {
	return _truthTokensForFile(side, file).filter(
		(t) =>
			t.start >= lo &&
			t.end <= hi &&
			!_truthIsCommentPos(side, file, t.start),
	);
}

function _truthMarks() {
	return _truthWorking[_truthWorkingKey()] ?? null;
}

function _truthFileMarks(side, file) {
	const t = _truthMarks();
	const sideKey = side === "teacher" ? "teacher_files" : "student_files";
	if (!t[sideKey]) t[sideKey] = {};
	if (!t[sideKey][file]) t[sideKey][file] = [];
	return t[sideKey][file];
}

function _truthFindMarks(side, file, lo, hi) {
	return _truthFileMarks(side, file).filter(
		(m) =>
			m.start < hi &&
			m.end > lo &&
			(m.label === "missing" ||
				m.label === "extra" ||
				m.label === "ghost_extra" ||
				m.label === "comment"),
	);
}

function _truthAddMark(side, file, label, tokens, opts) {
	const arr = _truthFileMarks(side, file);
	const { insertAtPos } = opts || {};
	for (const t of tokens) {
		const m = { token: t.token, label, start: t.start, end: t.end };
		if (insertAtPos != null) m.insert_at = { file, pos: insertAtPos };
		arr.push(m);
	}
	arr.sort((a, b) => a.start - b.start);
}

function _truthRemoveMark(side, file, mark) {
	const arr = _truthFileMarks(side, file);
	const i = arr.indexOf(mark);
	if (i >= 0) arr.splice(i, 1);
	if (!mark.paired_with) return;
	const otherSide = side === "teacher" ? "student" : "teacher";
	for (const m of _truthFileMarks(otherSide, mark.paired_with.file)) {
		if (
			m.paired_with &&
			m.paired_with.start === mark.start &&
			m.paired_with.token === mark.token
		) {
			delete m.paired_with;
		}
	}
}

function _truthClearPair(mark, side) {
	if (!mark || !mark.paired_with) return;
	if (mark.paired_with.ghost) {
		delete mark.paired_with;
		return;
	}
	const otherSide = side === "teacher" ? "student" : "teacher";
	const partner = _truthFileMarks(otherSide, mark.paired_with.file).find(
		(m) =>
			m.start === mark.paired_with.start &&
			m.token === mark.paired_with.token,
	);
	if (partner && partner.paired_with) delete partner.paired_with;
	delete mark.paired_with;
}

function _truthSetSwapPair(missingMark, extraMark, missingFile, extraFile) {
	_truthClearPair(missingMark, "teacher");
	_truthClearPair(extraMark, "student");
	missingMark.paired_with = {
		file: extraFile,
		start: extraMark.start,
		end: extraMark.end,
		token: extraMark.token,
		label: "extra",
	};
	extraMark.paired_with = {
		file: missingFile,
		start: missingMark.start,
		end: missingMark.end,
		token: missingMark.token,
		label: "missing",
	};
	delete missingMark.insert_at;
}

function _clearSelectionPreservingScroll() {
	const scroll = document.getElementById("diff-scroll");
	const top = scroll ? scroll.scrollTop : 0;
	const left = scroll ? scroll.scrollLeft : 0;
	const sel = window.getSelection();
	if (sel) sel.removeAllRanges();
	requestAnimationFrame(() => {
		if (scroll) {
			scroll.scrollTop = top;
			scroll.scrollLeft = left;
		}
	});
}

function _truthClickPosition(ev) {
	const pane = ev.target.closest(".code-pane");
	if (!pane) return null;
	const side = pane.dataset.paneSide;
	const file = pane.dataset.paneFile;
	const markEl = ev.target.closest(".leo-mark");
	if (markEl) {
		const pos = parseInt(markEl.dataset.leoPos, 10);
		if (Number.isFinite(pos)) return { side, file, pos };
	}
	const cp = document.caretRangeFromPoint
		? document.caretRangeFromPoint(ev.clientX, ev.clientY)
		: null;
	if (cp) {
		const info = _truthResolveSrcPos(cp.startContainer, cp.startOffset);
		if (info && info.side === side && info.file === file) return info;
	}
	const lineEl = ev.target.closest(".diff-line");
	if (lineEl) {
		const ls = parseInt(lineEl.dataset.srcStart, 10);
		if (Number.isFinite(ls)) return { side, file, pos: ls };
	}
	return null;
}

function _truthRerender() {
	if (_truthEditMode) _truthSwitchToTruthMarks();
	else _applyCurrentMarks();
	_truthRenderPreservingScroll();
	_updateTitleScore();
	_persistDiffState();
}

function _truthGroupKey(m) {
	if (m.label === "missing") {
		if (m.insert_at) return `mi|${m.insert_at.file}|${m.insert_at.pos}`;
		return `m|free`;
	}
	if (m.label === "extra") {
		return m.paired_with
			? `er|${m.paired_with.file}|${m.paired_with.start}`
			: `e`;
	}
	if (m.label === "ghost_extra") return `ge`;
	return `?|${m.label}`;
}

function _truthMakeGroup(side, file, m) {
	const g = { side, file, marks: [], lo: Infinity, hi: -Infinity };
	if (m.label === "missing") {
		g.kind = m.insert_at ? "missing-insert" : "missing";
		if (m.insert_at) {
			g.insertFile = m.insert_at.file;
			g.insertPos = m.insert_at.pos;
		}
	} else if (m.label === "ghost_extra") {
		g.kind = "ghost_extra";
	} else {
		g.kind = m.paired_with ? "extra-replace" : "extra";
		if (m.paired_with) {
			g.pairFile = m.paired_with.file;
			g.pairLo = m.paired_with.start;
			g.pairHi = m.paired_with.end;
		}
	}
	return g;
}

function _truthGroupMarks() {
	const t = _truthMarks();
	if (!t) return [];
	const groups = [];

	for (const [side, sideKey] of [
		["teacher", "teacher_files"],
		["student", "student_files"],
	]) {
		const filesObj = t[sideKey] || {};
		for (const [file, marks] of Object.entries(filesObj)) {
			const sorted = [...marks].sort((a, b) => a.start - b.start);
			const allTokens = _truthTokensForFile(side, file);
			const commentPositions = new Set();
			for (const m of sorted) {
				if (m.label === "comment") commentPositions.add(m.start);
			}
			const insertPositions = new Set();
			if (side === "student") {
				const tFiles = t.teacher_files || {};
				for (const tMarks of Object.values(tFiles)) {
					for (const tm of tMarks || []) {
						if (tm.label !== "missing") continue;
						if (tm.paired_with) continue;
						const ia = tm.insert_at;
						if (ia && ia.file === file) insertPositions.add(ia.pos);
					}
				}
			}
			const hasObstacleInGap = (lo, hi) => {
				if (lo > hi) return false;
				for (const tok of allTokens) {
					if (tok.start < lo) continue;
					if (tok.start >= hi) break;
					if (!commentPositions.has(tok.start)) return true;
				}
				for (const pos of insertPositions) {
					if (pos >= lo && pos <= hi) return true;
				}
				return false;
			};

			let cur = null,
				curKey = null;
			const flush = () => {
				if (cur) groups.push(cur);
				cur = null;
				curKey = null;
			};

			for (const m of sorted) {
				if (
					m.label !== "missing" &&
					m.label !== "extra" &&
					m.label !== "ghost_extra"
				)
					continue;
				if (side === "teacher" && m.label === "missing" && m.paired_with)
					continue;

				const key = _truthGroupKey(m);
				const merge =
					cur && curKey === key && !hasObstacleInGap(cur.hi, m.start);

				if (!merge) {
					flush();
					cur = _truthMakeGroup(side, file, m);
					curKey = key;
				}

				if (m.paired_with && cur.kind && cur.kind.endsWith("replace")) {
					const partnerSide = side === "teacher" ? "student" : "teacher";
					const partnerKey =
						partnerSide === "teacher" ? "teacher_files" : "student_files";
					const partner = (t[partnerKey]?.[m.paired_with.file] || []).find(
						(p) =>
							p.start === m.paired_with.start &&
							p.token === m.paired_with.token,
					);
					const pLo = partner ? partner.start : m.paired_with.start;
					const pHi = partner ? partner.end : m.paired_with.end;
					cur.pairLo = Math.min(cur.pairLo, pLo);
					cur.pairHi = Math.max(cur.pairHi, pHi);
				}

				cur.marks.push(m);
				cur.lo = Math.min(cur.lo, m.start);
				cur.hi = Math.max(cur.hi, m.end);
			}
			flush();
		}
	}

	groups.sort((a, b) => (a.side > b.side ? 1 : -1) || a.lo - b.lo);
	return groups;
}

window.addEventListener("DOMContentLoaded", _truthEnsureButtons);
