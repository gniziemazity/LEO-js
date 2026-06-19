"use strict";

function _renderLeoTooltip(token, data, side, pos, ghostOffset) {
	const tEsc = escHtml(token);

	const teachers = data.teacher;
	const students = data.student;
	const thisList = side === "teacher" ? teachers : students;
	const thisIdx = _findInstanceIdx(thisList, pos, ghostOffset);
	const thisInst = thisIdx >= 0 ? thisList[thisIdx] : null;
	const matchedOtherIdx =
		thisInst && Number.isInteger(thisInst.match_idx)
			? thisInst.match_idx
			: -1;

	const clickedCtx = thisInst ? _instanceContextVectors(thisInst, side) : null;
	const clickedCtxSlice = thisInst ? _contextSlice(thisInst, side) : null;
	const clickedCtxSliceStripped =
		thisInst && _instanceHasGhostNeighbours(thisInst, side)
			? _contextSliceStripped(thisInst)
			: null;
	const clickedWindowSet = clickedCtxSlice
		? new Set([
				...clickedCtxSlice.before.map((t) => (Array.isArray(t) ? t[0] : t)),
				...clickedCtxSlice.after.map((t) => (Array.isArray(t) ? t[0] : t)),
				...(clickedCtxSliceStripped ? clickedCtxSliceStripped.before : []),
				...(clickedCtxSliceStripped ? clickedCtxSliceStripped.after : []),
			])
		: null;

	const _fmtCtxTokenBold = (t) => {
		const tok = Array.isArray(t) ? t[0] : t;
		const isMatch = clickedWindowSet && clickedWindowSet.has(tok);
		if (Array.isArray(t))
			return `<span class="leo-ghost-tok"${isMatch ? ' style="font-weight:bold;text-decoration:underline"' : ""}>${escHtml(t[0])}</span>`;
		return isMatch ? `<b><u>${escHtml(t)}</u></b>` : escHtml(t);
	};

	const labelClass = (inst) =>
		inst.ghost
			? "leo-row-ghost"
			: inst.label === "missing"
				? "leo-row-missing"
				: inst.label === "extra"
					? "leo-row-extra"
					: inst.label === "ghost_extra"
						? "leo-row-extra-star"
						: "";

	const renderSingleRow = (inst, ctx, highlight, score, isSelf) => {
		const fmt = isSelf ? _fmtCtxToken : _fmtCtxTokenBold;
		const before = ctx ? ctx.before.map(fmt).join(" ") : "";
		const after = ctx ? ctx.after.map(fmt).join(" ") : "";
		const lblColor = inst.ghost
			? _cssVar("--clr-muted")
			: _labelColor(inst.label);
		const cls =
			`leo-row ${labelClass(inst)}${highlight ? " leo-this" : ""}`.trim();
		const scoreCell =
			score == null
				? '<span class="leo-score"></span>'
				: `<span class="leo-score">${(score * 100).toFixed(0)}%</span>`;
		return (
			`<div class="${cls}">` +
			scoreCell +
			`<span class="leo-before">${before}</span>` +
			`<span class="leo-center" style="color:${lblColor}">${tEsc}</span>` +
			`<span class="leo-after">${after}</span>` +
			`</div>`
		);
	};

	const renderRow = (
		inst,
		sideName,
		highlight,
		score,
		isSelf = false,
		scoreAlt = null,
	) => {
		const isDual = highlight && _instanceHasGhostNeighbours(inst, sideName);
		if (!isDual) {
			return renderSingleRow(
				inst,
				_contextSlice(inst, sideName),
				highlight,
				score,
				isSelf,
			);
		}
		const ctxWith = _contextSlice(inst, sideName);
		const ctxStripped = _contextSliceStripped(inst);
		const cls = `leo-pair${highlight ? " leo-this" : ""}`;
		return (
			`<div class="${cls}">` +
			renderSingleRow(inst, ctxWith, false, score, isSelf) +
			renderSingleRow(inst, ctxStripped, false, scoreAlt, isSelf) +
			`</div>`
		);
	};

	const sepRow = '<div class="leo-row leo-sep">⋯</div>';
	const renderSection = (list, sideName, anchorOrigIdxs) => {
		if (sideName === side) {
			if (thisIdx < 0 || thisIdx >= list.length) return "";
			return renderRow(list[thisIdx], sideName, true, null, true, null);
		}
		const scored = list.map((inst, i) => {
			const ctxs = clickedCtx
				? _instanceContextVectors(inst, sideName)
				: null;
			let score = null;
			let scoreAlt = null;
			if (clickedCtx && ctxs) {
				score = _combinedScore(clickedCtx.primary, ctxs.primary);
				if (ctxs.alt) {
					scoreAlt = _combinedScore(clickedCtx.primary, ctxs.alt);
				}
				if (clickedCtx.alt) {
					score = Math.max(
						score,
						_combinedScore(clickedCtx.alt, ctxs.primary),
					);
				}
			}
			const sortScore =
				scoreAlt != null ? Math.max(score ?? 0, scoreAlt) : score;
			return { inst, origIdx: i, score, scoreAlt, sortScore };
		});
		const order = clickedCtx
			? scored
					.slice()
					.sort(
						(a, b) =>
							(b.sortScore ?? -1) - (a.sortScore ?? -1) ||
							a.origIdx - b.origIdx,
					)
			: scored;
		const anchorPositions = anchorOrigIdxs
			.filter((i) => i != null && i >= 0)
			.map((i) => order.findIndex((s) => s.origIdx === i))
			.filter((p) => p >= 0);
		const visible = _selectVisibleRows(order.length, anchorPositions);
		const out = [];
		let prev = -1;
		for (const p of visible) {
			if (prev >= 0 && p > prev + 1) out.push(sepRow);
			const { inst, origIdx, score, scoreAlt } = order[p];
			const isMatched = origIdx === matchedOtherIdx;
			out.push(renderRow(inst, sideName, isMatched, score, false, scoreAlt));
			prev = p;
		}
		return out.join("");
	};

	let html = "";
	const ordered =
		side === "student" ? ["student", "teacher"] : ["teacher", "student"];
	for (const sName of ordered) {
		const list = sName === "teacher" ? teachers : students;
		if (!list.length) continue;
		const anchors = sName === side ? [thisIdx] : [matchedOtherIdx];
		const title = sName === "teacher" ? "Teacher" : "Student";
		html += `<div class="leo-section-title">${title}</div>`;
		html += renderSection(list, sName, anchors);
	}
	return html;
}

function _selectVisibleRows(n, anchors) {
	if (n <= 20) return Array.from({ length: n }, (_, i) => i);
	const set = new Set();
	for (let i = 0; i < 10; i++) set.add(i);
	for (let i = n - 10; i < n; i++) set.add(i);
	for (const a of anchors) {
		if (Number.isInteger(a) && a >= 0 && a < n) set.add(a);
	}
	return [...set].sort((a, b) => a - b);
}

function _fmtCtxToken(t) {
	if (Array.isArray(t))
		return `<span class="leo-ghost-tok">${escHtml(t[0])}</span>`;
	return escHtml(t);
}

function _makeFloatWin({ id, className, onClose }) {
	const win = document.createElement("div");
	win.className = className;
	if (id) win.id = id;

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
	if (onClose) closeBtn.addEventListener("click", onClose);
	header.appendChild(closeBtn);

	const body = document.createElement("div");
	body.className = "float-win__body";

	win.appendChild(header);
	win.appendChild(body);
	document.body.appendChild(win);

	makeDraggable(header, win);

	return { win, header, titleEl, body };
}

let _leoTip = null;
let _leoTipBody = null;
let _leoTipTitle = null;
function _ensureLeoTooltip() {
	if (_leoTip) return _leoTip;
	const fw = _makeFloatWin({
		id: "leo-tooltip",
		className: "float-win",
		onClose: _hideLeoTooltip,
	});
	_leoTip = fw.win;
	_leoTipTitle = fw.titleEl;
	_leoTipBody = fw.body;
	return _leoTip;
}

function _findMarkAtPos(side, token, pos) {
	const marks = side === "teacher" ? _teacherMarks : _studentMarks;
	if (!marks) return null;
	for (const fileMarks of Object.values(marks)) {
		for (const m of fileMarks) {
			if (m.token === token && m.start === pos) return m;
		}
	}
	return null;
}

function _renderSimpleTooltip(mark) {
	let html = "";
	if (mark.timestamp) {
		html += `<div class="leo-row"><span class="leo-sub">teacher typed: ${escHtml(mark.timestamp)}</span></div>`;
	}
	if (mark.removal_ts) {
		html += `<div class="leo-row"><span class="leo-sub">teacher removed: ${escHtml(mark.removal_ts)}</span></div>`;
	}
	return html;
}

function _positionLeoTipNear(tip, target) {
	tip.style.display = "flex";
	const r = target.getBoundingClientRect();
	const tw = tip.offsetWidth;
	const th = tip.offsetHeight;
	let left = r.left;
	let top = r.bottom + 6;
	if (left + tw > window.innerWidth - 8) left = window.innerWidth - tw - 8;
	if (top + th > window.innerHeight - 8) top = r.top - th - 6;
	tip.style.left = `${Math.max(8, left)}px`;
	tip.style.top = `${Math.max(8, top)}px`;
}

function _showLeoTooltip(target) {
	if (typeof _curatedHideControls === "function") _curatedHideControls();
	const token = target.getAttribute("data-leo-token");
	const side = target.getAttribute("data-leo-side");
	const pos = parseInt(target.getAttribute("data-leo-pos"), 10);
	const ghostOffsetAttr = target.getAttribute("data-leo-ghost-offset");
	const ghostOffset =
		ghostOffsetAttr != null ? parseInt(ghostOffsetAttr, 10) : null;
	if (!token || !side || Number.isNaN(pos)) return;
	_jumpToSwapPartnerTab(target);
	const tokens = _currentMarksEntry?.leo_assignments?.tokens;
	const data = tokens && tokens[token];
	const tip = _ensureLeoTooltip();
	if (!data) {
		const mark = _findMarkAtPos(side, token, pos);
		if (!mark) return;
		_applyMarkPairHighlight(target);
		if (_embedMode) return;
		const label = mark.label || "matched";
		const color = _labelColor(label);
		_leoTipTitle.innerHTML = `<span style="color:${color};font-weight:bold">${escHtml(token)}</span> <span class="leo-sub">— ${escHtml(label)}</span>`;
		_leoTipBody.innerHTML = _renderSimpleTooltip(mark);
		_positionLeoTipNear(tip, target);
		return;
	}
	_clearLeoHighlights();
	_applyLeoHighlights(target, data, side, pos, ghostOffset);
	if (_embedMode) return;
	const nTeacherSurv = data.teacher.filter((t) => !t.ghost).length;
	const nTeacherGhost = data.teacher.length - nTeacherSurv;
	const ghostNote = nTeacherGhost ? ` (+${nTeacherGhost} ghost)` : "";
	_leoTipTitle.innerHTML = `${escHtml(token)} <span class="leo-sub"> &nbsp; ${nTeacherSurv} teacher${ghostNote} / ${data.student.length} student</span>`;
	_leoTipBody.innerHTML = _renderLeoTooltip(
		token,
		data,
		side,
		pos,
		ghostOffset,
	);
	_positionLeoTipNear(tip, target);
}

function _hideLeoTooltip() {
	if (_leoTip) _leoTip.style.display = "none";
	_clearLeoHighlights();
}

let _leoHighlighted = [];
let _insertHighlighted = [];
function _clearLeoHighlights() {
	for (const el of _leoHighlighted) {
		el.classList.remove(
			"leo-highlight-active",
			"leo-highlight-pair-extra",
			"leo-highlight-pair-missing",
			"curated-sel-red",
			"curated-sel-blue",
		);
	}
	_leoHighlighted = [];
	for (const el of _insertHighlighted) el.classList.remove("insert-active");
	_insertHighlighted = [];
}

function _jumpToSwapPartnerTab(target) {
	const otherSide = target.getAttribute("data-swap-side");
	const partnerFile = target.getAttribute("data-swap-file");
	const partnerPos = target.getAttribute("data-swap-pos");
	const partnerToken = target.getAttribute("data-swap-token");
	if (!otherSide || !partnerFile) return;
	const wrap = document.getElementById(`code-${otherSide}`);
	if (!wrap) return;
	const active = wrap.querySelector(".code-pane.active");
	if (active && active.dataset.paneFile === partnerFile) return;
	if (typeof _activateFileTab !== "function") return;
	_activateFileTab(otherSide, partnerFile);
	const pane = wrap.querySelector(
		`.code-pane[data-pane-file="${CSS.escape(partnerFile)}"]`,
	);
	if (!pane) return;
	const sel =
		`.leo-mark[data-leo-side="${otherSide}"]` +
		`[data-leo-pos="${partnerPos}"]:not([data-leo-ghost-offset])`;
	for (const el of pane.querySelectorAll(sel)) {
		if (partnerToken && el.getAttribute("data-leo-token") !== partnerToken)
			continue;
		el.scrollIntoView({ block: "nearest", inline: "nearest" });
		break;
	}
}

function _applySwapPartnerHighlight(target) {
	const otherSide = target.getAttribute("data-swap-side");
	const partnerPos = target.getAttribute("data-swap-pos");
	const partnerToken = target.getAttribute("data-swap-token");
	if (!otherSide || partnerPos == null) return;
	const wrap = document.getElementById(`code-${otherSide}`);
	if (!wrap) return;
	const partnerPairClass =
		otherSide === "student"
			? "leo-highlight-pair-missing"
			: "leo-highlight-pair-extra";
	const sel =
		`.leo-mark[data-leo-side="${otherSide}"]` +
		`[data-leo-pos="${partnerPos}"]:not([data-leo-ghost-offset])`;
	for (const el of wrap.querySelectorAll(sel)) {
		if (partnerToken && el.getAttribute("data-leo-token") !== partnerToken)
			continue;
		el.classList.add("leo-highlight-active", partnerPairClass);
		_leoHighlighted.push(el);
	}
}

function _applyInsertAnchorHighlight(target) {
	const otherSide = target.getAttribute("data-insert-side");
	const teacherPos = target.getAttribute("data-leo-pos");
	if (!otherSide || teacherPos == null) return;
	const wrap = document.getElementById(`code-${otherSide}`);
	if (!wrap) return;
	const sel = `.insert-anchor[data-insert-anchor-teacher-pos="${teacherPos}"]`;
	for (const el of wrap.querySelectorAll(sel)) {
		el.classList.add("insert-active");
		_insertHighlighted.push(el);
	}
}

function _addMarkPairHighlight(target) {
	if (!target) return;
	target.classList.add("leo-highlight-active");
	if (target.hasAttribute("data-swap-pos")) {
		const partnerSide = target.getAttribute("data-swap-side");
		target.classList.add(
			partnerSide === "student"
				? "leo-highlight-pair-extra"
				: "leo-highlight-pair-missing",
		);
	}
	_leoHighlighted.push(target);
	if (target.hasAttribute("data-swap-pos")) {
		_applySwapPartnerHighlight(target);
	}
	if (target.hasAttribute("data-insert-pos")) {
		_applyInsertAnchorHighlight(target);
	}
}

function _applyMarkPairHighlight(target) {
	_clearLeoHighlights();
	_addMarkPairHighlight(target);
}

function _applyLeoHighlights(target, data, side, pos, ghostOffset) {
	_addMarkPairHighlight(target);
	const list = side === "teacher" ? data.teacher : data.student;
	const idx = _findInstanceIdx(list, pos, ghostOffset);
	const inst = idx >= 0 ? list[idx] : null;
	if (!inst || !Number.isInteger(inst.match_idx)) return;
	const otherSide = side === "teacher" ? "student" : "teacher";
	const otherList = otherSide === "teacher" ? data.teacher : data.student;
	const matched = otherList && otherList[inst.match_idx];
	if (!matched) return;
	const token = target.getAttribute("data-leo-token");
	const wrap = document.getElementById(`code-${otherSide}`);
	if (!wrap) return;
	let sel;
	if (matched.ghost) {
		sel =
			`.leo-mark[data-leo-side="${otherSide}"]` +
			`[data-leo-pos="${matched.pos}"]` +
			`[data-leo-ghost-offset="${matched.blob_offset}"]`;
	} else {
		sel =
			`.leo-mark[data-leo-side="${otherSide}"]` +
			`[data-leo-pos="${matched.pos}"]:not([data-leo-ghost-offset])`;
	}
	for (const el of wrap.querySelectorAll(sel)) {
		if (el.getAttribute("data-leo-token") !== token) continue;
		el.classList.add("leo-highlight-active");
		_leoHighlighted.push(el);
	}
}

document.addEventListener("mousedown", (ev) => {
	if (ev.target.closest && ev.target.closest(".code-aligned[contenteditable]"))
		return;
	if (ev.button === 2) {
		const mark = ev.target.closest && ev.target.closest(".leo-mark");
		if (mark) {
			ev.preventDefault();
			_showLeoTooltip(mark);
			return;
		}
		const anchor = ev.target.closest && ev.target.closest(".insert-anchor");
		if (anchor) {
			ev.preventDefault();
			_showInsertAnchorOrigin(anchor);
			return;
		}
		return;
	}
	if (ev.button !== 0) return;
	if (_leoTip && _leoTip.style.display === "flex") {
		if (ev.target.closest && ev.target.closest("#leo-tooltip")) return;
		_hideLeoTooltip();
	}
});

document.addEventListener("contextmenu", (ev) => {
	const t = ev.target;
	if (!t || !t.closest) return;
	if (
		t.closest("#leo-tooltip") ||
		t.closest(".leo-mark") ||
		t.closest(".insert-anchor") ||
		t.closest(".code-pane")
	) {
		ev.preventDefault();
	}
});

document.addEventListener(
	"keydown",
	(ev) => {
		if (ev.key !== "Escape") return;
		if (_leoTip && _leoTip.style.display === "flex") {
			ev.preventDefault();
			ev.stopPropagation();
			_hideLeoTooltip();
		}
	},
	true,
);

function _showInsertAnchorOrigin(anchor) {
	const tPos = anchor.getAttribute("data-insert-anchor-teacher-pos");
	if (tPos == null) return;
	const wrap = document.getElementById("code-teacher");
	if (!wrap) return;
	const sel =
		`.leo-mark[data-leo-side="teacher"]` +
		`[data-leo-pos="${tPos}"]` +
		`[data-insert-pos]:not([data-leo-ghost-offset])`;
	const markEl = wrap.querySelector(sel);
	if (markEl) {
		_showLeoTooltip(markEl);
	} else {
		_clearLeoHighlights();
		anchor.classList.add("insert-active");
		_insertHighlighted.push(anchor);
	}
}
