"use strict";

let _truthEditMode = false;
let _truthControlsEl = null;
let _truthPending = null;
let _truthFloatWin = null;
const _truthTokenCache = new Map();

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
	if (!bar || document.getElementById("btn-generate-truth")) return;
	const make = (id, text, onClick, extraClass) => {
		const b = document.createElement("button");
		b.id = id;
		b.className = "btn-edit" + (extraClass ? " " + extraClass : "");
		b.textContent = text;
		b.addEventListener("click", onClick);
		bar.appendChild(b);
	};
	make("btn-generate-truth", "✍️ Make Corrections", _truthToggle);
	make("btn-save-truth", "💾 Download", _truthDownload, "truth-only-btn");
	make("btn-summarize-truth", "📋 Summary", _truthSummarize, "truth-only-btn");
	make("btn-preview-truth", "👁 Test", _truthPreview, "truth-only-btn");
	_truthShowSecondary(false);
}

function _truthShowSecondary(show) {
	for (const id of [
		"btn-save-truth",
		"btn-summarize-truth",
		"btn-preview-truth",
	]) {
		const el = document.getElementById(id);
		if (el) el.style.display = show ? "" : "none";
	}
}

function _truthRenderPreservingScroll() {
	const tState = _saveState("teacher");
	const sState = _saveState("student");
	if (_teacherFiles) renderPanel("teacher", _teacherFiles, _teacherMarks);
	if (_studentFiles) renderPanel("student", _studentFiles, _studentMarks);
	_restoreState("teacher", tState);
	_restoreState("student", sState);
}

function _truthSwitchToTruthMarks() {
	_currentMarksEntry = _allMarks.truth;
	_teacherMarks = _currentMarksEntry?.teacher_files ?? null;
	_studentMarks = _currentMarksEntry?.student_files ?? null;
}

function _truthToggle() {
	if (_truthEditMode) _truthDisable();
	else _truthEnable();
}

function _truthEnable() {
	_truthTokenCache.clear();
	const baseKey = _diffMode != null && _allMarks[_diffMode] ? _diffMode : null;
	const base = baseKey != null ? _allMarks[baseKey] : null;
	const seed = {
		token_matching: "truth",
		teacher_files: (base && base.teacher_files) || {},
		student_files: (base && base.student_files) || {},
	};
	if (base) {
		if (base.teacher_ghosts) seed.teacher_ghosts = base.teacher_ghosts;
		if (base.alignments) seed.alignments = base.alignments;
		if (base.line_marks) seed.line_marks = base.line_marks;
		if (base.leo_assignments) seed.leo_assignments = base.leo_assignments;
	}
	_allMarks.truth = JSON.parse(JSON.stringify(seed));

	_truthEditMode = true;
	_truthSwitchToTruthMarks();
	_truthRenderPreservingScroll();
	_updateTitleScore();

	const modeSelect = document.getElementById("mode-select");
	if (modeSelect) modeSelect.disabled = true;
	document.body.classList.add("truth-edit-mode");
	const btn = document.getElementById("btn-generate-truth");
	if (btn) {
		btn.textContent = "✍️ Stop Corrections";
		btn.classList.add("active");
	}
	_truthShowSecondary(true);
	document.addEventListener("mouseup", _truthOnMouseUp);
	document.addEventListener("keydown", _truthOnKeyDown);
	_persistDiffState();
}

function _truthDisable() {
	_truthEditMode = false;
	_truthPending = null;
	_truthHideControls();
	document.body.classList.remove(
		"truth-edit-mode",
		"truth-pair-mode",
		"truth-insert-mode",
	);
	const btn = document.getElementById("btn-generate-truth");
	if (btn) {
		btn.textContent = "✍️ Make Corrections";
		btn.classList.remove("active");
	}
	_truthShowSecondary(false);
	document.removeEventListener("mouseup", _truthOnMouseUp);
	document.removeEventListener("keydown", _truthOnKeyDown);
	_refreshModeSelect();
	_applyCurrentMarks();
	_truthRenderPreservingScroll();
	_updateTitleScore();
	_persistDiffState();
}

function _truthOnKeyDown(ev) {
	if (ev.key === "Escape") {
		_truthCancelPending();
		_truthHideControls();
	}
}

document.addEventListener(
	"mousedown",
	(ev) => {
		if (!_truthEditMode || ev.button !== 0) return;
		if (_truthIsBackgroundClick(ev.target)) return;
		if (!ev.target.closest(".code-pane")) return;
		ev.stopPropagation();
	},
	true,
);

function _truthOnMouseUp(ev) {
	if (!_truthEditMode) return;
	if (_truthPending && _truthHandlePendingClick(ev)) return;
	if (_truthIsBackgroundClick(ev.target)) return;

	const sel = window.getSelection();
	if (!sel || sel.isCollapsed) {
		_truthHideControls();
		return;
	}

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

	const rawLo = Math.min(startInfo.pos, endInfo.pos);
	const rawHi = Math.max(startInfo.pos, endInfo.pos);
	if (rawLo === rawHi) {
		_truthHideControls();
		return;
	}

	const snapped = _truthSnapToTokens(
		startInfo.side,
		startInfo.file,
		rawLo,
		rawHi,
	);
	_truthShowControls(
		{
			side: startInfo.side,
			file: startInfo.file,
			lo: snapped.lo,
			hi: snapped.hi,
			rawLo,
			rawHi,
		},
		ev.clientX,
		ev.clientY,
	);
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

function _truthTokensInRange(side, file, lo, hi) {
	return _truthTokensForFile(side, file).filter(
		(t) => t.start >= lo && t.end <= hi,
	);
}

function _truthMarks() {
	return _allMarks.truth;
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
				m.label === "ghost_extra"),
	);
}

function _truthAddMark(side, file, label, tokens, opts) {
	const arr = _truthFileMarks(side, file);
	const { insertAtPos, extentLo, extentHi } = opts || {};
	for (const t of tokens) {
		const m = { token: t.token, label, start: t.start, end: t.end };
		if (insertAtPos != null) m.insert_at = { file, pos: insertAtPos };
		if (extentLo != null) m.extent_start = extentLo;
		if (extentHi != null) m.extent_end = extentHi;
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

function _truthMarkLo(m) {
	return m.extent_start != null ? m.extent_start : m.start;
}
function _truthMarkHi(m) {
	return m.extent_end != null ? m.extent_end : m.end;
}

function _truthClearPair(mark, side) {
	if (!mark || !mark.paired_with) return;
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

function _truthEnsureControls() {
	if (_truthControlsEl) return _truthControlsEl;
	const el = document.createElement("div");
	el.id = "truth-controls";
	el.className = "truth-float-win";
	document.body.appendChild(el);
	_truthControlsEl = el;
	return el;
}

function _truthHideControls() {
	if (_truthControlsEl) _truthControlsEl.style.display = "none";
}

function _truthShowControls(sel, x, y) {
	const el = _truthEnsureControls();
	const tokens = _truthTokensInRange(sel.side, sel.file, sel.lo, sel.hi);
	const existing = _truthFindMarks(sel.side, sel.file, sel.lo, sel.hi);

	const tokenPreview = tokens.map((t) => t.token).join(" ");
	const tokenLine = tokens.length
		? `<div class="tc-tokens"><b>${tokens.length}</b> token${tokens.length === 1 ? "" : "s"}: <code>${escHtml(tokenPreview).slice(0, 200)}</code></div>`
		: `<div class="tc-tokens">(no tokens in selection — pure whitespace)</div>`;

	const rangeNote =
		sel.rawLo !== sel.lo || sel.rawHi !== sel.hi
			? ` <span class="tc-snap">(snapped from ${sel.rawLo}–${sel.rawHi})</span>`
			: "";

	const parts = [];
	parts.push(
		`<div class="tc-title">${escHtml(sel.side[0].toUpperCase() + sel.side.slice(1))} · ${escHtml(sel.file)} · [${sel.lo}–${sel.hi}]${rangeNote}</div>`,
	);
	parts.push(tokenLine);

	if (!existing.length) {
		const addRow =
			sel.side === "teacher"
				? `<button type="button" class="tc-btn-missing" data-action="add-missing">Missing</button>`
				: `<button type="button" class="tc-btn-extra" data-action="add-extra">Extra</button><button type="button" class="tc-btn-ghost" data-action="add-ghost">Ghost</button>`;
		parts.push(`<div class="tc-row tc-add-row">${addRow}</div>`);
	} else {
		const byLabel = { missing: 0, extra: 0, ghost_extra: 0 };
		for (const m of existing) byLabel[m.label] = (byLabel[m.label] || 0) + 1;
		const summary = Object.entries(byLabel)
			.filter(([, n]) => n)
			.map(([k, n]) => `${n} ${k}`)
			.join(", ");
		parts.push(
			`<div class="tc-row tc-existing"><span class="tc-existing-info">In selection: ${escHtml(summary)}</span>` +
				`<button type="button" class="tc-btn-del" data-action="del-all">✖ Delete</button></div>`,
		);

		const allMissing = existing.every((m) => m.label === "missing");
		const allExtraLike = existing.every(
			(m) => m.label === "extra" || m.label === "ghost_extra",
		);
		const single = existing.length === 1;
		const singleHasPair = single && !!existing[0].paired_with;
		const buttons = [];
		if (allMissing) {
			if (single)
				buttons.push(
					`<button type="button" data-action="set-pair">⇄ Pair with extra…</button>`,
				);
			buttons.push(
				`<button type="button" data-action="set-insert">↳ Set insert position…</button>`,
			);
		} else if (allExtraLike) {
			if (single)
				buttons.push(
					`<button type="button" data-action="set-pair">⇄ Pair with missing…</button>`,
				);
			if (existing.every((m) => m.label === "extra")) {
				buttons.push(
					`<button type="button" class="tc-btn-ghost" data-action="promote-all">★ → Ghost</button>`,
				);
			} else if (existing.every((m) => m.label === "ghost_extra")) {
				buttons.push(
					`<button type="button" class="tc-btn-extra" data-action="demote-all">☆ → Extra</button>`,
				);
			}
		}
		if (singleHasPair)
			buttons.push(
				`<button type="button" class="tc-btn-del" data-action="unpair">⊘ Remove pair</button>`,
			);
		if (buttons.length)
			parts.push(`<div class="tc-row">${buttons.join("")}</div>`);
	}

	parts.push(
		`<div class="tc-row tc-close"><button type="button" data-action="close">Close</button></div>`,
	);
	el.innerHTML = parts.join("");

	const W = 380,
		H = 220;
	el.style.left =
		Math.max(8, Math.min(window.innerWidth - W - 8, x + 12)) + "px";
	el.style.top =
		Math.max(8, Math.min(window.innerHeight - H - 8, y + 12)) + "px";
	el.style.display = "block";

	el.onmousedown = (e) => {
		const btn = e.target.closest("button");
		if (!btn) return;
		e.preventDefault();
		e.stopPropagation();
		_truthOnControlAction(btn.dataset.action, sel, tokens, existing);
	};
}

function _truthOnControlAction(action, sel, tokens, existing) {
	const opts = { extentLo: sel.rawLo, extentHi: sel.rawHi };
	switch (action) {
		case "close":
			_truthHideControls();
			_clearSelectionPreservingScroll();
			return;
		case "add-missing":
			_truthAddMark("teacher", sel.file, "missing", tokens, opts);
			break;
		case "add-extra":
			_truthAddMark("student", sel.file, "extra", tokens, opts);
			break;
		case "add-ghost":
			_truthAddMark("student", sel.file, "ghost_extra", tokens, opts);
			break;
		case "del-all":
			for (const m of existing.slice())
				_truthRemoveMark(sel.side, sel.file, m);
			break;
		case "unpair":
			for (const m of existing) _truthClearPair(m, sel.side);
			break;
		case "promote-all":
			for (const m of existing) {
				m.label = "ghost_extra";
				delete m.paired_with;
			}
			break;
		case "demote-all":
			for (const m of existing) m.label = "extra";
			break;
		case "set-pair":
			_truthPending = {
				kind: "pair",
				anchorMarks: existing.slice(),
				anchorSide: sel.side,
				anchorFile: sel.file,
			};
			document.body.classList.add("truth-pair-mode");
			_truthHideControls();
			_clearSelectionPreservingScroll();
			return;
		case "set-insert":
			_truthPending = {
				kind: "insert",
				anchorMarks: existing.slice(),
				anchorFile: sel.file,
			};
			document.body.classList.add("truth-insert-mode");
			_truthHideControls();
			_clearSelectionPreservingScroll();
			return;
		default:
			return;
	}
	_truthRerender();
	_truthHideControls();
	_clearSelectionPreservingScroll();
}

function _clearSelectionPreservingScroll() {
	const panes = document.querySelectorAll(".code-pane.active");
	const saved = [...panes].map((p) => ({
		p,
		top: p.scrollTop,
		left: p.scrollLeft,
	}));
	const sel = window.getSelection();
	if (sel) sel.removeAllRanges();
	requestAnimationFrame(() => {
		for (const s of saved) {
			s.p.scrollTop = s.top;
			s.p.scrollLeft = s.left;
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

function _truthHandlePendingClick(ev) {
	const info = _truthClickPosition(ev);
	if (!info) return false;
	if (_truthPending.kind === "pair") return _truthApplyPendingPair(info);
	if (_truthPending.kind === "insert") return _truthApplyPendingInsert(info);
	return false;
}

function _truthApplyPendingPair(info) {
	const { side, file, pos } = info;
	const anchorMarks = _truthPending.anchorMarks || [];
	if (!anchorMarks.length) {
		_truthCancelPending();
		return true;
	}
	const wantedSide =
		anchorMarks[0].label === "missing" ? "student" : "teacher";
	if (side !== wantedSide) return false;

	let targetMarks = [];
	const win = window.getSelection();
	if (win && win.rangeCount && !win.isCollapsed) {
		const range = win.getRangeAt(0);
		const a = _truthResolveSrcPos(range.startContainer, range.startOffset);
		const b = _truthResolveSrcPos(range.endContainer, range.endOffset);
		if (
			a &&
			b &&
			a.side === wantedSide &&
			b.side === wantedSide &&
			a.file === file &&
			b.file === file
		) {
			targetMarks = _truthFindMarks(
				side,
				file,
				Math.min(a.pos, b.pos),
				Math.max(a.pos, b.pos),
			);
		}
	}
	if (!targetMarks.length) {
		const at = _truthFileMarks(side, file).find(
			(m) => m.start <= pos && pos < m.end,
		);
		if (at) targetMarks = [at];
	}
	if (!targetMarks.length) {
		_truthCancelPending();
		_truthRerender();
		return true;
	}

	anchorMarks.sort((a, b) => a.start - b.start);
	targetMarks.sort((a, b) => a.start - b.start);
	const n = Math.min(anchorMarks.length, targetMarks.length);
	for (let i = 0; i < n; i++) {
		const a = anchorMarks[i],
			t = targetMarks[i];
		if (
			a.label === "missing" &&
			(t.label === "extra" || t.label === "ghost_extra")
		) {
			_truthSetSwapPair(a, t, _truthPending.anchorFile, file);
		} else if (
			(a.label === "extra" || a.label === "ghost_extra") &&
			t.label === "missing"
		) {
			_truthSetSwapPair(t, a, file, _truthPending.anchorFile);
		}
	}
	_truthCancelPending();
	_truthRerender();
	return true;
}

function _truthApplyPendingInsert(info) {
	const { side, file, pos } = info;
	if (side !== "student") return false;
	for (const m of _truthPending.anchorMarks || []) {
		_truthClearPair(m, "teacher");
		m.insert_at = { file, pos };
	}
	_truthCancelPending();
	_truthRerender();
	return true;
}

function _truthCancelPending() {
	_truthPending = null;
	document.body.classList.remove("truth-pair-mode", "truth-insert-mode");
}

function _truthRerender() {
	if (_truthEditMode) _truthSwitchToTruthMarks();
	else _applyCurrentMarks();
	_truthRenderPreservingScroll();
	_persistDiffState();
}

function _truthDownload() {
	const t = _truthMarks() || {
		token_matching: "truth",
		teacher_files: {},
		student_files: {},
	};
	const out = {
		token_matching: "truth",
		_note: t._note || "Generated via differentiator Make Corrections.",
		teacher_files: t.teacher_files || {},
		student_files: t.student_files || {},
	};
	if (t.teacher_ghosts) out.teacher_ghosts = t.teacher_ghosts;
	const json = JSON.stringify(out, null, 2) + "\n";
	const blob = new Blob([json], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = "diff_marks_truth.json";
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}

function _truthBackwardWhitespace(text, pos) {
	if (pos <= 0 || !/\s/.test(text[pos - 1])) return "";
	let i = pos;
	while (i > 0 && /\s/.test(text[i - 1])) i--;
	return text.slice(i, pos);
}

function _truthForwardWhitespace(text, pos) {
	if (pos >= text.length || !/\s/.test(text[pos])) return "";
	let i = pos;
	while (i < text.length && /\s/.test(text[i])) i++;
	return text.slice(pos, i);
}

function _truthAlignWhitespace(
	srcText,
	srcStart,
	srcEnd,
	dstText,
	dstStart,
	dstEnd,
) {
	const srcLead = _truthBackwardWhitespace(srcText, srcStart);
	const dstLead = _truthBackwardWhitespace(dstText, dstStart);
	const srcTrail = _truthForwardWhitespace(srcText, srcEnd);
	const dstTrail = _truthForwardWhitespace(dstText, dstEnd);

	let text = srcText.slice(srcStart, srcEnd);
	let aStart = dstStart;
	let aEnd = dstEnd;

	if (srcLead && !dstLead) text = srcLead + text;
	else if (!srcLead && dstLead) aStart = dstStart - dstLead.length;

	if (srcTrail && !dstTrail) text = text + srcTrail;
	else if (!srcTrail && dstTrail) aEnd = dstEnd + dstTrail.length;

	return { text, start: aStart, end: aEnd };
}

function _truthApplyToStudent() {
	const out = {};
	const t = _truthMarks();
	if (!t) return out;
	const studentNames = Object.keys(_studentFiles || {});
	const groups = _truthGroupMarks();

	for (const sName of studentNames) {
		let text = _truthSrcText("student", sName);
		const origText = text;
		const ops = [];
		for (const g of groups) {
			if (
				g.side === "teacher" &&
				g.kind === "missing-insert" &&
				g.insertFile === sName
			) {
				const tSrc = _truthSrcText("teacher", g.file);
				const a = _truthAlignWhitespace(
					tSrc,
					g.lo,
					g.hi,
					origText,
					g.insertPos,
					g.insertPos,
				);
				ops.push({
					kind: "replace",
					start: a.start,
					end: a.end,
					text: a.text,
				});
			} else if (
				g.side === "student" &&
				g.kind === "extra-replace" &&
				g.file === sName
			) {
				const tSrc = _truthSrcText("teacher", g.pairFile);
				const a = _truthAlignWhitespace(
					tSrc,
					g.pairLo,
					g.pairHi,
					origText,
					g.lo,
					g.hi,
				);
				ops.push({
					kind: "replace",
					start: a.start,
					end: a.end,
					text: a.text,
				});
			} else if (
				g.side === "student" &&
				(g.kind === "extra" || g.kind === "ghost_extra") &&
				g.file === sName
			) {
				ops.push({ kind: "delete", start: g.lo, end: g.hi });
			}
		}
		ops.sort((a, b) => {
			const pa = a.kind === "insert" ? a.pos : a.start;
			const pb = b.kind === "insert" ? b.pos : b.start;
			return pb - pa;
		});
		for (const op of ops) {
			if (op.kind === "delete") {
				text = text.slice(0, op.start) + text.slice(op.end);
			} else if (op.kind === "replace") {
				text = text.slice(0, op.start) + op.text + text.slice(op.end);
			} else if (op.kind === "insert") {
				text = text.slice(0, op.pos) + op.text + text.slice(op.pos);
			}
		}
		out[sName] = text;
	}
	return out;
}

function _truthPreview() {
	const out = _truthApplyToStudent();
	const body = document.createElement("div");
	body.className = "tw-preview-split";

	if (!Object.keys(out).length) {
		body.textContent = "No student files to preview.";
		_truthShowFloatWin("Test", body);
		return;
	}

	const left = document.createElement("div");
	left.className = "tw-preview-code";
	for (const [name, text] of Object.entries(out)) {
		const h = document.createElement("div");
		h.className = "tw-section-title";
		h.textContent = name;
		left.appendChild(h);
		const pre = document.createElement("pre");
		pre.className = "tw-pre";
		pre.textContent = text;
		left.appendChild(pre);
	}

	const right = document.createElement("div");
	right.className = "tw-preview-render";
	const iframe = document.createElement("iframe");
	iframe.className = "tw-preview-iframe";
	iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
	right.appendChild(iframe);

	body.appendChild(left);
	body.appendChild(right);
	_truthShowFloatWin("Test", body);

	if (typeof updatePreview === "function") {
		updatePreview("student", { ...out }, iframe);
	}
}

function _truthSummarize() {
	const groups = _truthGroupMarks();
	const body = document.createElement("div");
	if (!groups.length) {
		body.textContent = "No truth marks defined.";
		_truthShowFloatWin("Summary", body);
		return;
	}

	for (const g of groups) {
		const row = document.createElement("div");
		row.className = "tw-summary-row";
		const codeText = _truthSrcText(g.side, g.file).slice(g.lo, g.hi);

		let pairBlock = "";
		if (g.kind === "extra-replace") {
			const pairText = _truthSrcText("teacher", g.pairFile).slice(
				g.pairLo,
				g.pairHi,
			);
			pairBlock =
				`<div class="tw-summary-pair">` +
				`<span class="tw-summary-arrow">↔ replaced by ${escHtml(g.pairFile)} [${g.pairLo}–${g.pairHi}]:</span>` +
				`<pre class="tw-summary-pre">${escHtml(pairText)}</pre>` +
				`</div>`;
		}

		let suffix = "";
		if (g.kind === "missing-insert")
			suffix = ` → insert at ${g.file}:${g.insertPos}`;
		else if (g.kind === "ghost_extra") suffix = " (extra*, delete)";
		else if (g.kind === "extra") suffix = " (delete)";

		row.innerHTML =
			`<div class="tw-summary-head"><b>${escHtml(g.kind)}</b> ` +
			`${escHtml(g.side)}/${escHtml(g.file)} [${g.lo}–${g.hi}]` +
			`<span class="tw-summary-suffix">${escHtml(suffix)}</span></div>` +
			`<pre class="tw-summary-pre">${escHtml(codeText)}</pre>` +
			pairBlock;
		body.appendChild(row);
	}
	_truthShowFloatWin("Summary", body);
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
			const hasObstacleInGap = (lo, hi) => {
				if (lo >= hi) return false;
				for (const tok of allTokens) {
					if (tok.start < lo) continue;
					if (tok.start >= hi) return false;
					if (!commentPositions.has(tok.start)) return true;
				}
				return false;
			};

			let cur = null,
				curKey = null,
				curExtent = null;
			const flush = () => {
				if (cur) groups.push(cur);
				cur = null;
				curKey = null;
				curExtent = null;
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
				const mLo = _truthMarkLo(m),
					mHi = _truthMarkHi(m);

				let merge = false;
				if (cur && curKey === key) {
					if (m.extent_start != null && curExtent != null) {
						merge =
							m.extent_start === curExtent.start &&
							m.extent_end === curExtent.end;
					} else if (m.extent_start == null && curExtent == null) {
						merge = !hasObstacleInGap(cur.hi, mLo);
					}
				}

				if (!merge) {
					flush();
					cur = _truthMakeGroup(side, file, m);
					curKey = key;
					curExtent =
						m.extent_start != null
							? { start: m.extent_start, end: m.extent_end }
							: null;
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
					const pLo = partner
						? _truthMarkLo(partner)
						: m.paired_with.start;
					const pHi = partner ? _truthMarkHi(partner) : m.paired_with.end;
					cur.pairLo = Math.min(cur.pairLo, pLo);
					cur.pairHi = Math.max(cur.pairHi, pHi);
				}

				cur.marks.push(m);
				cur.lo = Math.min(cur.lo, mLo);
				cur.hi = Math.max(cur.hi, mHi);
			}
			flush();
		}
	}

	groups.sort((a, b) => (a.side > b.side ? 1 : -1) || a.lo - b.lo);
	return groups;
}

function _truthShowFloatWin(title, bodyEl) {
	if (!_truthFloatWin) {
		const win = document.createElement("div");
		win.className = "truth-float-win";
		win.id = "truth-float-win";

		const header = document.createElement("div");
		header.className = "tw-header";
		const dragHint = document.createElement("span");
		dragHint.className = "tw-drag";
		dragHint.textContent = "⠿";
		header.appendChild(dragHint);
		const titleEl = document.createElement("span");
		titleEl.className = "tw-title";
		header.appendChild(titleEl);
		const closeBtn = document.createElement("button");
		closeBtn.className = "tw-close";
		closeBtn.textContent = "×";
		closeBtn.addEventListener("click", () => {
			win.style.display = "none";
		});
		header.appendChild(closeBtn);

		const body = document.createElement("div");
		body.className = "tw-body";

		win.appendChild(header);
		win.appendChild(body);
		document.body.appendChild(win);

		header.addEventListener("mousedown", (e) => {
			if (e.button !== 0) return;
			e.preventDefault();
			const sx = e.clientX,
				sy = e.clientY;
			const ol = parseInt(win.style.left) || 100;
			const ot = parseInt(win.style.top) || 100;
			const onMove = (me) => {
				win.style.left = ol + me.clientX - sx + "px";
				win.style.top = ot + me.clientY - sy + "px";
			};
			const onUp = () => {
				document.removeEventListener("mousemove", onMove);
				document.removeEventListener("mouseup", onUp);
			};
			document.addEventListener("mousemove", onMove);
			document.addEventListener("mouseup", onUp);
		});

		_truthFloatWin = { win, titleEl, body };
	}
	_truthFloatWin.titleEl.textContent = title;
	_truthFloatWin.body.innerHTML = "";
	_truthFloatWin.body.appendChild(bodyEl);
	_truthFloatWin.win.style.display = "flex";
	if (!_truthFloatWin.win.style.left) {
		_truthFloatWin.win.style.left = "100px";
		_truthFloatWin.win.style.top = "100px";
	}
}

window.addEventListener("DOMContentLoaded", _truthEnsureButtons);
