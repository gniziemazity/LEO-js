"use strict";

let _truthEditMode = false;
let _truthControlsEl = null;
let _truthPending = null;
let _truthFloatWin = null;
let _truthConnectCursorEl = null;
let _truthConnectHoverMarkEl = null;
let _truthConnectTokenHoverEl = null;
const _truthTokenCache = new Map();

let _truthWorking = {};

function _truthEnsureConnectCursor() {
	if (_truthConnectCursorEl) return _truthConnectCursorEl;
	const el = document.createElement("div");
	el.id = "truth-connect-cursor";
	el.textContent = "▾";
	document.body.appendChild(el);
	_truthConnectCursorEl = el;
	return el;
}

function _truthEnsureConnectTokenHover() {
	if (_truthConnectTokenHoverEl) return _truthConnectTokenHoverEl;
	const el = document.createElement("div");
	el.id = "truth-connect-token-hover";
	document.body.appendChild(el);
	_truthConnectTokenHoverEl = el;
	return el;
}

function _truthClearConnectHover() {
	if (_truthConnectCursorEl) _truthConnectCursorEl.style.display = "none";
	if (_truthConnectTokenHoverEl)
		_truthConnectTokenHoverEl.style.display = "none";
	if (_truthConnectHoverMarkEl) {
		_truthConnectHoverMarkEl.classList.remove("truth-connect-target");
		_truthConnectHoverMarkEl = null;
	}
}

function _truthFindMarkEl(side, mark) {
	if (!mark) return null;
	const wrap = document.getElementById(`code-${side}`);
	if (!wrap) return null;
	const sel =
		`.leo-mark[data-leo-side="${side}"]` +
		`[data-leo-pos="${mark.start}"]:not([data-leo-ghost-offset])`;
	for (const el of wrap.querySelectorAll(sel)) {
		if (el.getAttribute("data-leo-token") === mark.token) return el;
	}
	return null;
}

function _truthSrcPosToDomPoint(side, file, srcPos) {
	const wrap = document.getElementById(`code-${side}`);
	if (!wrap) return null;
	let pane = null;
	for (const p of wrap.querySelectorAll(".code-pane.active")) {
		if (p.dataset.paneFile === file) {
			pane = p;
			break;
		}
	}
	if (!pane) return null;
	const lines = pane.querySelectorAll(".diff-line");
	let lineEl = null;
	for (const el of lines) {
		const ls = parseInt(el.dataset.srcStart, 10);
		if (!Number.isFinite(ls)) continue;
		if (ls <= srcPos) lineEl = el;
		else break;
	}
	if (!lineEl) return null;
	const lineStart = parseInt(lineEl.dataset.srcStart, 10);
	const target = srcPos - lineStart;
	let cursor = 0;
	let result = null;
	const walk = (n) => {
		if (result) return;
		if (n.nodeType === 3) {
			const len = n.nodeValue.length;
			if (cursor + len >= target) {
				result = { node: n, offset: target - cursor };
				return;
			}
			cursor += len;
		} else if (n.nodeType === 1) {
			if (
				n.classList &&
				(n.classList.contains("diff-ghost") ||
					n.classList.contains("insert-anchor"))
			)
				return;
			for (const c of n.childNodes) walk(c);
		}
	};
	walk(lineEl);
	return result;
}

function _truthTokenBbox(side, file, tok) {
	const start = _truthSrcPosToDomPoint(side, file, tok.start);
	const end = _truthSrcPosToDomPoint(side, file, tok.end);
	if (!start || !end) return null;
	const range = document.createRange();
	try {
		range.setStart(start.node, start.offset);
		range.setEnd(end.node, end.offset);
	} catch {
		return null;
	}
	const rect = range.getBoundingClientRect();
	if (!rect || (rect.width === 0 && rect.height === 0)) return null;
	return rect;
}

function _truthOnConnectMouseMove(ev) {
	if (!_truthPending || _truthPending.kind !== "connect") return;
	const roles = _truthConnectAnchorRoles();
	if (!roles) return;

	const info = _truthClickPosition(ev);
	if (!info || info.side !== roles.wantedSide) {
		_truthClearConnectHover();
		return;
	}

	const candidate = _truthFindConnectCandidate(info, roles);
	if (candidate && candidate.mark) {
		const markEl = _truthFindMarkEl(info.side, candidate.mark);
		if (markEl !== _truthConnectHoverMarkEl) {
			if (_truthConnectHoverMarkEl) {
				_truthConnectHoverMarkEl.classList.remove("truth-connect-target");
			}
			_truthConnectHoverMarkEl = markEl;
			if (markEl) markEl.classList.add("truth-connect-target");
		}
		if (_truthConnectCursorEl) _truthConnectCursorEl.style.display = "none";
		if (_truthConnectTokenHoverEl)
			_truthConnectTokenHoverEl.style.display = "none";
		return;
	}

	if (_truthConnectHoverMarkEl) {
		_truthConnectHoverMarkEl.classList.remove("truth-connect-target");
		_truthConnectHoverMarkEl = null;
	}

	if (candidate && candidate.token) {
		const rect = _truthTokenBbox(info.side, info.file, candidate.token);
		if (rect) {
			const el = _truthEnsureConnectTokenHover();
			el.style.left = `${rect.left}px`;
			el.style.top = `${rect.top}px`;
			el.style.width = `${rect.width}px`;
			el.style.height = `${rect.height}px`;
			el.style.display = "block";
			if (_truthConnectCursorEl)
				_truthConnectCursorEl.style.display = "none";
			return;
		}
	}

	if (_truthConnectTokenHoverEl)
		_truthConnectTokenHoverEl.style.display = "none";

	if (!roles.allMissing) {
		// Extras can't be inserted; gap-hover does nothing.
		if (_truthConnectCursorEl) _truthConnectCursorEl.style.display = "none";
		return;
	}

	const cp = document.caretRangeFromPoint
		? document.caretRangeFromPoint(ev.clientX, ev.clientY)
		: null;
	if (!cp) {
		if (_truthConnectCursorEl) _truthConnectCursorEl.style.display = "none";
		return;
	}
	const rect = cp.getBoundingClientRect();
	if (
		!rect ||
		(rect.width === 0 &&
			rect.height === 0 &&
			rect.left === 0 &&
			rect.top === 0)
	) {
		if (_truthConnectCursorEl) _truthConnectCursorEl.style.display = "none";
		return;
	}
	const cursor = _truthEnsureConnectCursor();
	cursor.style.left = `${rect.left}px`;
	cursor.style.top = `${rect.top - 2}px`;
	cursor.style.display = "block";
}

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

function _truthWorkingKey() {
	return _diffMode == null ? "" : _diffMode;
}

function _truthSwitchToTruthMarks() {
	_currentMarksEntry = _truthWorking[_truthWorkingKey()] ?? null;
	_teacherMarks = _currentMarksEntry?.teacher_files ?? null;
	_studentMarks = _currentMarksEntry?.student_files ?? null;
}

function _truthToggle() {
	if (_truthEditMode) _truthDisable();
	else _truthEnable();
}

function _truthEnable() {
	_truthTokenCache.clear();
	const key = _truthWorkingKey();
	if (!_truthWorking[key]) {
		const base = _allMarks[key] ?? null;
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
		_truthWorking[key] = JSON.parse(JSON.stringify(seed));
	}

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
	document.addEventListener("mousemove", _truthOnConnectMouseMove);
	_persistDiffState();
}

function _truthDisable() {
	_truthEditMode = false;
	_truthPending = null;
	_truthClearConnectHover();
	_truthHideControls();
	document.body.classList.remove(
		"truth-edit-mode",
		"truth-connect-mode",
		"truth-connect-anchor-extra",
	);
	const btn = document.getElementById("btn-generate-truth");
	if (btn) {
		btn.textContent = "✍️ Make Corrections";
		btn.classList.remove("active");
	}
	_truthShowSecondary(false);
	document.removeEventListener("mouseup", _truthOnMouseUp);
	document.removeEventListener("keydown", _truthOnKeyDown);
	document.removeEventListener("mousemove", _truthOnConnectMouseMove);
	_refreshModeSelect();
	_applyCurrentMarks();
	_truthRenderPreservingScroll();
	_updateTitleScore();
	_persistDiffState();
}

function _truthOnKeyDown(ev) {
	if (ev.key === "Escape") {
		_truthCancelPending();
		_truthClearConnectHover();
		_truthHideControls();
	}
}

document.addEventListener(
	"mousedown",
	(ev) => {
		if (!_truthEditMode || ev.button !== 0) return;
		if (_truthIsBackgroundClick(ev.target)) return;
		if (!ev.target.closest(".code-pane")) return;
		if (ev.target.closest(".insert-anchor")) return;
		ev.stopPropagation();
	},
	true,
);

function _truthOnMouseUp(ev) {
	if (!_truthEditMode) return;
	if (_truthPending && _truthHandlePendingClick(ev)) return;
	if (_truthIsBackgroundClick(ev.target)) return;
	if (ev.target.closest && ev.target.closest(".insert-anchor")) return;

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
		if (!tok) {
			_truthHideControls();
			return;
		}
		side = info.side;
		file = info.file;
		rawLo = tok.start;
		rawHi = tok.end;
	}

	const snapped = _truthSnapToTokens(side, file, rawLo, rawHi);
	const tokens = _truthTokensInRange(side, file, snapped.lo, snapped.hi);
	const existing = _truthFindMarks(side, file, snapped.lo, snapped.hi);
	if (!tokens.length && !existing.length) {
		_truthHideControls();
		return;
	}
	_truthApplyClickHighlights(side, snapped.lo, snapped.hi);
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
		ev.clientX,
		ev.clientY,
	);
}

function _truthApplyClickHighlights(side, lo, hi) {
	_clearLeoHighlights();
	const wrap = document.getElementById(`code-${side}`);
	if (!wrap) return;
	const sel = `.leo-mark[data-leo-side="${side}"]:not([data-leo-ghost-offset])`;
	for (const el of wrap.querySelectorAll(sel)) {
		const p = parseInt(el.getAttribute("data-leo-pos"), 10);
		if (Number.isFinite(p) && p >= lo && p < hi) {
			_addMarkPairHighlight(el);
		}
	}
}

function _truthTokenAtPos(side, file, pos) {
	const all = _truthTokensForFile(side, file);
	for (const t of all) {
		if (t.start <= pos && pos < t.end) return t;
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

function _truthTokensInRange(side, file, lo, hi) {
	return _truthTokensForFile(side, file).filter(
		(t) => t.start >= lo && t.end <= hi,
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

let _truthControlsTitleEl = null;
let _truthControlsBodyEl = null;

function _truthEnsureControls() {
	if (_truthControlsEl) return _truthControlsEl;
	const el = document.createElement("div");
	el.id = "truth-controls";
	el.className = "float-win";

	const header = document.createElement("div");
	header.className = "float-win__header";
	const drag = document.createElement("span");
	drag.className = "float-win__drag";
	drag.textContent = "⠿";
	header.appendChild(drag);
	const title = document.createElement("span");
	title.className = "float-win__title";
	header.appendChild(title);
	const close = document.createElement("button");
	close.type = "button";
	close.className = "float-win__close";
	close.dataset.action = "close";
	close.textContent = "×";
	header.appendChild(close);

	const body = document.createElement("div");
	body.className = "float-win__body";

	el.appendChild(header);
	el.appendChild(body);
	document.body.appendChild(el);
	makeDraggable(header, el);

	_truthControlsEl = el;
	_truthControlsTitleEl = title;
	_truthControlsBodyEl = body;
	return el;
}

function _truthHideControls() {
	if (_truthControlsEl) _truthControlsEl.style.display = "none";
	_clearLeoHighlights();
}

function _truthShowControls(sel, x, y) {
	const el = _truthEnsureControls();
	const tokens =
		sel.tokens || _truthTokensInRange(sel.side, sel.file, sel.lo, sel.hi);
	const existing =
		sel.existing || _truthFindMarks(sel.side, sel.file, sel.lo, sel.hi);

	const rangeNote =
		sel.rawLo !== sel.lo || sel.rawHi !== sel.hi
			? ` (snapped from ${sel.rawLo}–${sel.rawHi})`
			: "";
	const titleText = `${sel.side[0].toUpperCase() + sel.side.slice(1)} · ${sel.file} · [${sel.lo}–${sel.hi}]${rangeNote}`;

	const tokenPreview = tokens.map((t) => t.token).join(" ");
	const tokenLine = tokens.length
		? `<div class="tc-tokens"><b>${tokens.length}</b> token${tokens.length === 1 ? "" : "s"}: <code>${escHtml(tokenPreview).slice(0, 200)}</code></div>`
		: "";

	const buttons = [];
	if (!existing.length) {
		if (sel.side === "teacher") {
			buttons.push(
				`<button type="button" class="tc-btn-missing" data-action="add-missing">Missing</button>`,
			);
		} else {
			buttons.push(
				`<button type="button" class="tc-btn-extra" data-action="add-extra">Extra</button>`,
				`<button type="button" class="tc-btn-ghost" data-action="add-ghost">Ghost</button>`,
			);
		}
	} else {
		const allMissing = existing.every((m) => m.label === "missing");
		const allExtra = existing.every((m) => m.label === "extra");
		const allGhost = existing.every((m) => m.label === "ghost_extra");
		const single = existing.length === 1;
		const singleHasPair = single && !!existing[0].paired_with;
		if (allMissing || (allExtra && single)) {
			buttons.push(
				`<button type="button" data-action="set-connect">⇄ Connect…</button>`,
			);
		}
		if (allExtra) {
			buttons.push(
				`<button type="button" class="tc-btn-ghost" data-action="promote-all">★ → Ghost</button>`,
			);
		} else if (allGhost) {
			buttons.push(
				`<button type="button" class="tc-btn-extra" data-action="demote-all">☆ → Extra</button>`,
			);
		}
		if (singleHasPair) {
			buttons.push(
				`<button type="button" class="tc-btn-del" data-action="unpair">⊘ Remove pair</button>`,
			);
		}
		buttons.push(
			`<button type="button" class="tc-btn-del" data-action="del-all">✖ Delete</button>`,
		);
	}

	_truthControlsTitleEl.textContent = titleText;
	_truthControlsBodyEl.innerHTML =
		tokenLine +
		(buttons.length ? `<div class="tc-row">${buttons.join("")}</div>` : "");

	const W = 380,
		H = 220;
	el.style.left =
		Math.max(8, Math.min(window.innerWidth - W - 8, x + 12)) + "px";
	el.style.top =
		Math.max(8, Math.min(window.innerHeight - H - 8, y + 12)) + "px";
	el.style.display = "flex";

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
				_truthClearPair(m, sel.side);
				m.label = "ghost_extra";
			}
			break;
		case "demote-all":
			for (const m of existing) m.label = "extra";
			break;
		case "set-connect":
			_truthPending = {
				kind: "connect",
				anchorMarks: existing.slice(),
				anchorSide: sel.side,
				anchorFile: sel.file,
			};
			document.body.classList.add("truth-connect-mode");
			if (sel.side !== "teacher") {
				document.body.classList.add("truth-connect-anchor-extra");
			} else {
				document.body.classList.remove("truth-connect-anchor-extra");
			}
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

function _truthHandlePendingClick(ev) {
	if (!_truthPending || _truthPending.kind !== "connect") return false;
	const info = _truthClickPosition(ev);
	if (!info) return false;
	return _truthApplyPendingConnect(info);
}

function _truthConnectAnchorRoles() {
	const anchorMarks = _truthPending.anchorMarks || [];
	if (!anchorMarks.length) return null;
	const allMissing = anchorMarks.every((m) => m.label === "missing");

	const allExtra = anchorMarks.every((m) => m.label === "extra");
	if (!allMissing && !allExtra) return null;
	return {
		anchorMarks,
		allMissing,
		wantedSide: allMissing ? "student" : "teacher",
		wantedTargetLabels: allMissing
			? new Set(["extra"])
			: new Set(["missing"]),
	};
}

function _truthFindConnectCandidate(info, roles) {
	const { side, file, pos } = info;
	if (roles.anchorMarks.length !== 1) return null;
	const winSel = window.getSelection();
	if (winSel && winSel.rangeCount && !winSel.isCollapsed) {
		const range = winSel.getRangeAt(0);
		const a = _truthResolveSrcPos(range.startContainer, range.startOffset);
		const b = _truthResolveSrcPos(range.endContainer, range.endOffset);
		if (
			a &&
			b &&
			a.side === side &&
			b.side === side &&
			a.file === file &&
			b.file === file
		) {
			const inSelection = _truthFindMarks(
				side,
				file,
				Math.min(a.pos, b.pos),
				Math.max(a.pos, b.pos),
			).filter((m) => roles.wantedTargetLabels.has(m.label));
			if (inSelection.length) return { mark: inSelection[0] };
		}
	}
	const tok = _truthTokenAtPos(side, file, pos);
	if (!tok) return null;
	const existing = _truthFileMarks(side, file).find(
		(m) => m.start === tok.start && m.token === tok.token,
	);
	if (existing) {
		if (roles.wantedTargetLabels.has(existing.label)) {
			return { mark: existing };
		}
		return null;
	}
	return { token: tok };
}

function _truthApplyPendingConnect(info) {
	const roles = _truthConnectAnchorRoles();
	if (!roles) {
		_truthCancelPending();
		return true;
	}
	if (info.side !== roles.wantedSide) return false;

	const candidate = _truthFindConnectCandidate(info, roles);
	if (candidate) {
		let target = candidate.mark;
		if (!target && candidate.token) {
			const wantedLabel = roles.allMissing ? "extra" : "missing";
			target = {
				token: candidate.token.token,
				label: wantedLabel,
				start: candidate.token.start,
				end: candidate.token.end,
			};
			const arr = _truthFileMarks(info.side, info.file);
			arr.push(target);
			arr.sort((a, b) => a.start - b.start);
		}
		const a = roles.anchorMarks[0];
		if (roles.allMissing) {
			_truthSetSwapPair(a, target, _truthPending.anchorFile, info.file);
		} else {
			_truthSetSwapPair(target, a, info.file, _truthPending.anchorFile);
		}
	} else if (roles.allMissing) {
		for (const m of roles.anchorMarks) {
			_truthClearPair(m, "teacher");
			m.insert_at = { file: info.file, pos: info.pos };
		}
	} else {
		_truthCancelPending();
		_truthClearConnectHover();
		return true;
	}

	_truthCancelPending();
	_truthClearConnectHover();
	_truthRerender();
	return true;
}

function _truthCancelPending() {
	_truthPending = null;
	document.body.classList.remove(
		"truth-connect-mode",
		"truth-connect-anchor-extra",
	);
}

function _truthRerender() {
	if (_truthEditMode) _truthSwitchToTruthMarks();
	else _applyCurrentMarks();
	_truthRenderPreservingScroll();
	_persistDiffState();
}

function _truthBackfillTimestamps(teacherFiles, studentFiles) {
	const leoStar = _allMarks[""];
	if (!leoStar) return;
	const tsByPos = new Map();
	const remTsByPos = new Map();
	for (const [file, entries] of Object.entries(
		leoStar.teacher_token_timestamps || {},
	)) {
		for (const e of entries || []) {
			tsByPos.set(`${file}|${e.start}|${e.end}`, e.ts);
		}
	}
	for (const [file, marks] of Object.entries(leoStar.teacher_files || {})) {
		for (const m of marks || []) {
			if (m.label === "missing" && m.timestamp) {
				const k = `${file}|${m.start}|${m.end}`;
				if (!tsByPos.has(k)) tsByPos.set(k, m.timestamp);
			}
		}
	}
	for (const [file, marks] of Object.entries(leoStar.student_files || {})) {
		for (const m of marks || []) {
			if (m.label === "ghost_extra" && m.removal_ts) {
				remTsByPos.set(
					`${file}|${m.token}|${m.start}|${m.end}`,
					m.removal_ts,
				);
			}
		}
	}
	for (const [file, marks] of Object.entries(teacherFiles || {})) {
		for (const m of marks || []) {
			if (m.label !== "missing" || m.timestamp) continue;
			const ts = tsByPos.get(`${file}|${m.start}|${m.end}`);
			if (ts) m.timestamp = ts;
		}
	}
	for (const [file, marks] of Object.entries(studentFiles || {})) {
		for (const m of marks || []) {
			if (m.label !== "ghost_extra" || m.removal_ts) continue;
			const ts = remTsByPos.get(`${file}|${m.token}|${m.start}|${m.end}`);
			if (ts) m.removal_ts = ts;
		}
	}
}

function _truthDownload() {
	const t = _truthMarks() || {
		token_matching: "truth",
		teacher_files: {},
		student_files: {},
	};
	const teacherFiles = JSON.parse(JSON.stringify(t.teacher_files || {}));
	const studentFiles = JSON.parse(JSON.stringify(t.student_files || {}));
	_truthBackfillTimestamps(teacherFiles, studentFiles);
	const out = {
		token_matching: "truth",
		teacher_files: teacherFiles,
		student_files: studentFiles,
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
	else if (!srcLead && dstLead && !dstLead.includes("\n"))
		aStart = dstStart - dstLead.length;

	if (srcTrail && !dstTrail) text = text + srcTrail;
	else if (!srcTrail && dstTrail && !dstTrail.includes("\n"))
		aEnd = dstEnd + dstTrail.length;

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
		let order = 0;
		const pushOp = (op) => {
			op.order = order++;
			ops.push(op);
		};

		const studentExtras = groups
			.filter(
				(g) =>
					g.side === "student" &&
					g.file === sName &&
					(g.kind === "extra" || g.kind === "ghost_extra"),
			)
			.slice()
			.sort((a, b) => a.lo - b.lo);
		const teacherMissings = groups
			.filter(
				(g) =>
					g.side === "teacher" &&
					g.kind === "missing-insert" &&
					g.insertFile === sName,
			)
			.slice()
			.sort((a, b) => a.lo - b.lo);
		const tFile = teacherMissings[0]?.file ?? null;
		const allTeacherTokens = tFile
			? _truthTokensForFile("teacher", tFile)
			: [];
		const consumedMissings = new Set();
		for (const eg of studentExtras) {
			const candidates = teacherMissings
				.filter(
					(g) =>
						!consumedMissings.has(g) &&
						g.insertPos >= eg.lo &&
						g.insertPos <= eg.hi,
				)
				.slice()
				.sort((a, b) => a.lo - b.lo);
			if (!candidates.length) continue;
			const contig = [candidates[0]];
			for (let i = 1; i < candidates.length; i++) {
				const prevHi = contig[contig.length - 1].hi;
				const nxtLo = candidates[i].lo;
				let hasKept = false;
				for (const tok of allTeacherTokens) {
					if (tok.start < prevHi) continue;
					if (tok.start >= nxtLo) break;
					hasKept = true;
					break;
				}
				if (hasKept) break;
				contig.push(candidates[i]);
			}
			const tLo = contig[0].lo;
			const tHi = contig[contig.length - 1].hi;
			const tSrc = _truthSrcText("teacher", contig[0].file);
			eg._coalesced = { tLo, tHi, body: tSrc.slice(tLo, tHi) };
			for (const mg of contig) consumedMissings.add(mg);
		}
		for (const g of groups) {
			if (
				g.side === "teacher" &&
				g.kind === "missing-insert" &&
				g.insertFile === sName
			) {
				if (consumedMissings.has(g)) continue;
				const tSrc = _truthSrcText("teacher", g.file);
				const a = _truthAlignWhitespace(
					tSrc,
					g.lo,
					g.hi,
					origText,
					g.insertPos,
					g.insertPos,
				);
				pushOp({ start: a.start, end: a.end, text: a.text });
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
				pushOp({ start: a.start, end: a.end, text: a.text });
			} else if (
				g.side === "student" &&
				(g.kind === "extra" || g.kind === "ghost_extra") &&
				g.file === sName
			) {
				if (g._coalesced) {
					const c = g._coalesced;
					pushOp({ start: g.lo, end: g.hi, text: c.body });
					delete g._coalesced;
				} else {
					pushOp({ start: g.lo, end: g.hi, text: "" });
				}
			}
		}
		ops.sort((a, b) => {
			if (a.start !== b.start) return b.start - a.start;
			const aLen = a.end - a.start;
			const bLen = b.end - b.start;
			if (aLen !== bLen) return bLen - aLen;
			return b.order - a.order;
		});
		const _alnum = /[a-zA-Z0-9]/;
		for (const op of ops) {
			let body = op.text;
			if (body) {
				const before = text[op.start - 1];
				const after = text[op.end];
				const first = body[0];
				const last = body[body.length - 1];
				if (before && _alnum.test(before) && _alnum.test(first)) {
					body = " " + body;
				}
				if (after && _alnum.test(after) && _alnum.test(last)) {
					body = body + " ";
				}
			}
			text = text.slice(0, op.start) + body + text.slice(op.end);
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
		win.className = "truth-float-win float-win";
		win.id = "truth-float-win";

		const header = document.createElement("div");
		header.className = "float-win__header";
		const dragHint = document.createElement("span");
		dragHint.className = "float-win__drag";
		dragHint.textContent = "⠿";
		header.appendChild(dragHint);
		const titleEl = document.createElement("span");
		titleEl.className = "float-win__title";
		header.appendChild(titleEl);
		const closeBtn = document.createElement("button");
		closeBtn.className = "float-win__close";
		closeBtn.textContent = "×";
		closeBtn.addEventListener("click", () => {
			win.style.display = "none";
		});
		header.appendChild(closeBtn);

		const body = document.createElement("div");
		body.className = "float-win__body";

		win.appendChild(header);
		win.appendChild(body);
		document.body.appendChild(win);

		makeDraggable(header, win);

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
