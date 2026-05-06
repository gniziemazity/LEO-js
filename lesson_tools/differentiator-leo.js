"use strict";

// LEO context-vector math, tooltip rendering, mark/insert-anchor highlighting,
// and the document-level mousedown / contextmenu listeners that drive the tooltip.

function _ctxSlice(inst, side) {
	const la = _currentMarksEntry?.leo_assignments;
	if (!la || !inst) return null;
	const useAug =
		side === "teacher" &&
		Array.isArray(la.teacher_seq_aug) &&
		Number.isInteger(inst.seq_idx_aug);
	const seq = useAug
		? la.teacher_seq_aug
		: side === "teacher"
			? la.teacher_seq
			: la.student_seq;
	const idx = useAug ? inst.seq_idx_aug : inst.seq_idx;
	const k = la.k ?? 40;
	if (!seq || idx == null) return null;
	const lo = Math.max(0, idx - k);
	const hi = Math.min(seq.length, idx + k + 1);
	return {
		before: seq.slice(lo, idx),
		after: seq.slice(idx + 1, hi),
	};
}

function _instHasGhostNeighbours(inst, sideName) {
	if (sideName !== "teacher") return false;
	if (inst.ghost) return false;
	if (!Number.isInteger(inst.seq_idx_aug)) return false;
	const sv = _strippedTeacherView();
	if (!sv) return false;
	const la = _currentMarksEntry?.leo_assignments;
	const k = la?.k ?? 18;
	const idx = inst.seq_idx_aug;
	const lo = Math.max(0, idx - k);
	const hi = Math.min(sv.isGhostAt.length, idx + k + 1);
	for (let i = lo; i < hi; i++) {
		if (i !== idx && sv.isGhostAt[i]) return true;
	}
	return false;
}

function _ctxSliceStripped(inst) {
	const la = _currentMarksEntry?.leo_assignments;
	const sv = _strippedTeacherView();
	if (!la || !sv || !Number.isInteger(inst.seq_idx_aug)) return null;
	const k = la.k ?? 40;
	const anchorIdx = sv.augToStripped[inst.seq_idx_aug];
	const anchorIsGhost = sv.isGhostAt[inst.seq_idx_aug];
	const seq = sv.strippedSeq;
	if (anchorIsGhost) {
		return {
			before: seq.slice(Math.max(0, anchorIdx - k), anchorIdx),
			after: seq.slice(anchorIdx, Math.min(seq.length, anchorIdx + k)),
		};
	}
	return {
		before: seq.slice(Math.max(0, anchorIdx - k), anchorIdx),
		after: seq.slice(anchorIdx + 1, Math.min(seq.length, anchorIdx + k + 1)),
	};
}

function _strippedTeacherView() {
	const la = _currentMarksEntry?.leo_assignments;
	if (!la) return null;
	if (la.__strippedView !== undefined) return la.__strippedView;
	const aug = la.teacher_seq_aug;
	if (!Array.isArray(aug) || !aug.some((t) => Array.isArray(t))) {
		la.__strippedView = null;
		return null;
	}
	const strippedSeq = [];
	const augToStripped = [];
	const isGhostAt = [];
	for (const t of aug) {
		const gho = Array.isArray(t);
		isGhostAt.push(gho);
		augToStripped.push(strippedSeq.length);
		if (!gho) strippedSeq.push(t);
	}
	la.__strippedView = { strippedSeq, augToStripped, isGhostAt };
	return la.__strippedView;
}

function _instContextVectors(inst, sideName) {
	const la = _currentMarksEntry?.leo_assignments;
	if (!la) return null;
	const k = la.k ?? 10;
	const idf = la.idf || {};
	let seq, idx;
	if (sideName === "teacher") {
		const aug = Array.isArray(la.teacher_seq_aug) ? la.teacher_seq_aug : null;
		if (aug && Number.isInteger(inst.seq_idx_aug)) {
			seq = aug.map((t) => (Array.isArray(t) ? t[0] : t));
			idx = inst.seq_idx_aug;
		} else {
			seq = la.teacher_seq;
			idx = inst.seq_idx;
		}
	} else {
		seq = la.student_seq;
		idx = inst.seq_idx;
	}
	if (!seq || !Number.isInteger(idx)) return null;
	const primary = _buildContextSplit(seq, idx, k, idf);
	let alt = null;
	if (
		sideName === "teacher" &&
		!inst.ghost &&
		Number.isInteger(inst.seq_idx_aug)
	) {
		const sv = _strippedTeacherView();
		if (sv) {
			alt = _buildStrippedContextSplit(
				sv.strippedSeq,
				sv.augToStripped[inst.seq_idx_aug],
				sv.isGhostAt[inst.seq_idx_aug],
				k,
				idf,
			);
		}
	}
	return { primary, alt };
}

// A "context pack": { left, right } — two Maps weighted by IDF (no decay).
function _buildContextSplit(seq, idx, k, idf) {
	const left = new Map();
	const right = new Map();
	for (let i = Math.max(0, idx - k); i < idx; i++) {
		const tok = seq[i];
		const w = idf[tok] || 0;
		if (w > 0) left.set(tok, (left.get(tok) || 0) + w);
	}
	for (let i = idx + 1; i < Math.min(seq.length, idx + k + 1); i++) {
		const tok = seq[i];
		const w = idf[tok] || 0;
		if (w > 0) right.set(tok, (right.get(tok) || 0) + w);
	}
	return { left, right };
}

function _buildStrippedContextSplit(
	strippedSeq,
	anchorIdx,
	anchorIsGhost,
	k,
	idf,
) {
	const left = new Map();
	const right = new Map();
	const n = strippedSeq.length;
	if (anchorIsGhost) {
		for (let off = 1; off <= k; off++) {
			const i = anchorIdx - off;
			if (i < 0) break;
			const tok = strippedSeq[i];
			const w = idf[tok] || 0;
			if (w > 0) left.set(tok, (left.get(tok) || 0) + w);
		}
		for (let off = 1; off <= k; off++) {
			const i = anchorIdx - 1 + off;
			if (i >= n) break;
			const tok = strippedSeq[i];
			const w = idf[tok] || 0;
			if (w > 0) right.set(tok, (right.get(tok) || 0) + w);
		}
	} else {
		for (let i = Math.max(0, anchorIdx - k); i < anchorIdx; i++) {
			const tok = strippedSeq[i];
			const w = idf[tok] || 0;
			if (w > 0) left.set(tok, (left.get(tok) || 0) + w);
		}
		for (let i = anchorIdx + 1; i < Math.min(n, anchorIdx + k + 1); i++) {
			const tok = strippedSeq[i];
			const w = idf[tok] || 0;
			if (w > 0) right.set(tok, (right.get(tok) || 0) + w);
		}
	}
	return { left, right };
}

function _combinedScore(packA, packB) {
	if (!packA || !packB) return 0;
	const cLeft = _cosineSim(packA.left, packB.left);
	const cRight = _cosineSim(packA.right, packB.right);
	return 0.3 * Math.min(cLeft, cRight) + 0.7 * Math.max(cLeft, cRight);
}

function _scorePair(ctxA, ctxB) {
	if (!ctxA || !ctxB) return 0;
	let best = _combinedScore(ctxA.primary, ctxB.primary);
	if (ctxA.alt) best = Math.max(best, _combinedScore(ctxA.alt, ctxB.primary));
	if (ctxB.alt) best = Math.max(best, _combinedScore(ctxA.primary, ctxB.alt));
	return best;
}

function _cosineSim(v1, v2) {
	if (!v1 || !v2 || v1.size === 0 || v2.size === 0) return 0;
	let dot = 0,
		n1 = 0,
		n2 = 0;
	for (const [k, val] of v1) {
		n1 += val * val;
		const o = v2.get(k);
		if (o) dot += val * o;
	}
	for (const val of v2.values()) n2 += val * val;
	if (!dot || !n1 || !n2) return 0;
	return dot / (Math.sqrt(n1) * Math.sqrt(n2));
}

function _findInstIdx(list, pos, ghostOffset) {
	if (!list) return -1;
	if (ghostOffset != null) {
		return list.findIndex(
			(x) => x.ghost && x.pos === pos && x.blob_offset === ghostOffset,
		);
	}
	return list.findIndex((x) => !x.ghost && x.pos === pos);
}

function _renderLeoTooltip(token, data, side, pos, ghostOffset) {
	const tEsc = escHtml(token);

	const teachers = data.teacher;
	const students = data.student;
	const thisList = side === "teacher" ? teachers : students;
	const thisIdx = _findInstIdx(thisList, pos, ghostOffset);
	const thisInst = thisIdx >= 0 ? thisList[thisIdx] : null;
	const matchedOtherIdx =
		thisInst && Number.isInteger(thisInst.match_idx)
			? thisInst.match_idx
			: -1;

	const clickedCtx = thisInst ? _instContextVectors(thisInst, side) : null;
	const clickedCtxSlice = thisInst ? _ctxSlice(thisInst, side) : null;
	const clickedCtxSliceStripped =
		thisInst && _instHasGhostNeighbours(thisInst, side)
			? _ctxSliceStripped(thisInst)
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

	const renderSingleRow = (inst, sideName, ctx, highlight, score, isSelf) => {
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
		const isDual = highlight && _instHasGhostNeighbours(inst, sideName);
		if (!isDual) {
			return renderSingleRow(
				inst,
				sideName,
				_ctxSlice(inst, sideName),
				highlight,
				score,
				isSelf,
			);
		}
		const ctxWith = _ctxSlice(inst, sideName);
		const ctxStripped = _ctxSliceStripped(inst);
		const cls = `leo-pair${highlight ? " leo-this" : ""}`;
		return (
			`<div class="${cls}">` +
			renderSingleRow(inst, sideName, ctxWith, false, score, isSelf) +
			renderSingleRow(inst, sideName, ctxStripped, false, scoreAlt, isSelf) +
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
			const ctxs = clickedCtx ? _instContextVectors(inst, sideName) : null;
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

	const nTeacherSurv = teachers.filter((t) => !t.ghost).length;
	const nTeacherGhost = teachers.length - nTeacherSurv;
	const ghostNote = nTeacherGhost ? ` (+${nTeacherGhost} ghost)` : "";
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

let _leoTip = null;
let _leoTipBody = null;
let _leoTipTitle = null;
function _ensureLeoTooltip() {
	if (_leoTip) return _leoTip;
	_leoTip = document.createElement("div");
	_leoTip.id = "leo-tooltip";
	_leoTip.className = "float-win";

	const header = document.createElement("div");
	header.className = "float-win__header";
	const dragHint = document.createElement("span");
	dragHint.className = "float-win__drag";
	dragHint.textContent = "⠿";
	header.appendChild(dragHint);
	_leoTipTitle = document.createElement("span");
	_leoTipTitle.className = "float-win__title";
	header.appendChild(_leoTipTitle);
	const closeBtn = document.createElement("button");
	closeBtn.className = "float-win__close";
	closeBtn.textContent = "×";
	closeBtn.addEventListener("click", _hideLeoTooltip);
	header.appendChild(closeBtn);

	_leoTipBody = document.createElement("div");
	_leoTipBody.className = "float-win__body";

	_leoTip.appendChild(header);
	_leoTip.appendChild(_leoTipBody);
	document.body.appendChild(_leoTip);

	makeDraggable(header, _leoTip);

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

function _renderSimpleTooltip(token, mark) {
	let html = "";
	if (mark.timestamp) {
		html += `<div class="leo-row"><span class="leo-sub">teacher typed: ${escHtml(mark.timestamp)}</span></div>`;
	}
	if (mark.removal_ts) {
		html += `<div class="leo-row"><span class="leo-sub">teacher removed: ${escHtml(mark.removal_ts)}</span></div>`;
	}
	return html;
}

function _showLeoTooltip(target) {
	if (typeof _truthHideControls === "function") _truthHideControls();
	const token = target.getAttribute("data-leo-token");
	const side = target.getAttribute("data-leo-side");
	const pos = parseInt(target.getAttribute("data-leo-pos"), 10);
	const ghostOffsetAttr = target.getAttribute("data-leo-ghost-offset");
	const ghostOffset =
		ghostOffsetAttr != null ? parseInt(ghostOffsetAttr, 10) : null;
	if (!token || !side || Number.isNaN(pos)) return;
	const tokens = _currentMarksEntry?.leo_assignments?.tokens;
	const data = tokens && tokens[token];
	const tip = _ensureLeoTooltip();
	if (!data) {
		const mark = _findMarkAtPos(side, token, pos);
		if (!mark) return;
		_applyMarkPairHighlight(target);
		const label = mark.label || "matched";
		const color = _labelColor(label);
		_leoTipTitle.innerHTML = `<span style="color:${color};font-weight:bold">${escHtml(token)}</span> <span class="leo-sub">— ${escHtml(label)}</span>`;
		_leoTipBody.innerHTML = _renderSimpleTooltip(token, mark);
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
		return;
	}
	_clearLeoHighlights();
	_applyLeoHighlights(target, data, side, pos, ghostOffset);
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
			"truth-sel-red",
			"truth-sel-blue",
		);
	}
	_leoHighlighted = [];
	for (const el of _insertHighlighted) el.classList.remove("insert-active");
	_insertHighlighted = [];
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
	const list = side === "teacher" ? data.teacher : data.student;
	const idx = _findInstIdx(list, pos, ghostOffset);
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
