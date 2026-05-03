"use strict";

// Pair-mode floaters, DOM/bbox helpers, hit-testing, mousemove, and pair-state machine.

function _truthEnsureFloater(id, init) {
	if (_truthFloaters.has(id)) return _truthFloaters.get(id);
	const el = document.createElement("div");
	el.id = id;
	if (init) init(el);
	document.body.appendChild(el);
	_truthFloaters.set(id, el);
	return el;
}

function _truthShowPairLabel(x, y, text) {
	const el = _truthEnsureFloater("truth-pair-label", (e) => {
		e.textContent = "pair";
	});
	if (text != null && el.textContent !== text) el.textContent = text;
	el.style.left = x + 14 + "px";
	el.style.top = y + 16 + "px";
	el.classList.add("is-visible");
}

function _truthHidePairLabel() {
	const el = _truthFloaters.get("truth-pair-label");
	if (el) el.classList.remove("is-visible");
}

function _truthShowPairArrow(x, y) {
	const el = _truthEnsureFloater("truth-pair-arrow", (e) => {
		e.textContent = "▾";
	});
	el.style.left = x + "px";
	el.style.top = y - 2 + "px";
	el.classList.add("is-visible");
}

function _truthHidePairArrow() {
	const el = _truthFloaters.get("truth-pair-arrow");
	if (el) el.classList.remove("is-visible");
}

function _truthEnsurePairTokenHover() {
	return _truthEnsureFloater("truth-pair-token-hover");
}

function _truthHidePairTokenHover() {
	const el = _truthFloaters.get("truth-pair-token-hover");
	if (el) el.style.display = "none";
}

function _truthClearPairHover() {
	_truthHidePairTokenHover();
	if (_truthPairHoverMarkEl) {
		_truthPairHoverMarkEl.classList.remove("truth-pair-target");
		_truthPairHoverMarkEl = null;
	}
	_truthHidePairArrow();
}

function _truthFindLeoMarkEl(side, pos, token) {
	const wrap = document.getElementById(`code-${side}`);
	if (!wrap) return null;
	const sel =
		`.leo-mark[data-leo-side="${side}"]` +
		`[data-leo-pos="${pos}"]:not([data-leo-ghost-offset])`;
	for (const el of wrap.querySelectorAll(sel)) {
		if (el.getAttribute("data-leo-token") === token) return el;
	}
	return null;
}

function _truthFindMarkEl(side, mark) {
	if (!mark) return null;
	return _truthFindLeoMarkEl(side, mark.start, mark.token);
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

const _TRUTH_EDGE_PX = 4;

function _truthEdgeFor(bbox) {
	return Math.min(_TRUTH_EDGE_PX, bbox.width / 4);
}

function _truthExistingMarkAtPos(side, file, pos) {
	for (const m of _truthFileMarks(side, file)) {
		if (m.start <= pos && pos < m.end) return m;
	}
	return null;
}

function _truthFindMultiGroupRange(side, file, pos) {
	const groups = _truthGroupMarks();
	for (const g of groups) {
		if (g.side !== side || g.file !== file) continue;
		if (g.lo <= pos && pos < g.hi) {
			const marks = _truthFindMarks(side, file, g.lo, g.hi);
			if (marks.length > 1) return { lo: g.lo, hi: g.hi };
		}
	}
	return null;
}

function _truthPairHitTest(info, ev, roles) {
	const multiAnchor = roles.anchorMarks.length > 1;
	const groupRange = _truthFindMultiGroupRange(info.side, info.file, info.pos);

	if (!multiAnchor) {
		const winSel = window.getSelection();
		if (winSel && winSel.rangeCount && !winSel.isCollapsed) {
			const range = winSel.getRangeAt(0);
			const a = _truthResolveSrcPos(range.startContainer, range.startOffset);
			const b = _truthResolveSrcPos(range.endContainer, range.endOffset);
			if (
				a &&
				b &&
				a.side === info.side &&
				b.side === info.side &&
				a.file === info.file &&
				b.file === info.file
			) {
				const inSelection = _truthFindMarks(
					info.side,
					info.file,
					Math.min(a.pos, b.pos),
					Math.max(a.pos, b.pos),
				).filter((m) => roles.wantedTargetLabels.has(m.label));
				if (inSelection.length)
					return { kind: "mark", mark: inSelection[0] };
			}
		}

		const existingHere = _truthExistingMarkAtPos(
			info.side,
			info.file,
			info.pos,
		);
		if (existingHere) {
			if (!roles.wantedTargetLabels.has(existingHere.label)) {
				return { kind: "block" };
			}
			if (groupRange) return { kind: "block" };
			return { kind: "mark", mark: existingHere };
		}
	}

	if (groupRange && info.pos > groupRange.lo && info.pos < groupRange.hi) {
		return { kind: "block" };
	}

	const allowInsert = roles.allMissing;
	const tok = _truthTokenAtPos(info.side, info.file, info.pos);
	if (!tok) {
		return allowInsert
			? { kind: "insert", pos: info.pos }
			: { kind: "block" };
	}

	const bbox = ev ? _truthTokenBbox(info.side, info.file, tok) : null;

	if (multiAnchor) {
		if (!allowInsert) return { kind: "block" };
		if (bbox && ev) {
			const useStart = ev.clientX <= (bbox.left + bbox.right) / 2;
			return {
				kind: "insert",
				pos: useStart ? tok.start : tok.end,
				edge: {
					x: useStart ? bbox.left : bbox.right,
					y: bbox.top,
					h: bbox.height,
				},
			};
		}
		return { kind: "insert", pos: tok.start };
	}

	if (allowInsert && bbox && ev) {
		const edgePx = _truthEdgeFor(bbox);
		if (ev.clientX <= bbox.left + edgePx) {
			return {
				kind: "insert",
				pos: tok.start,
				edge: { x: bbox.left, y: bbox.top, h: bbox.height },
			};
		}
		if (ev.clientX >= bbox.right - edgePx) {
			return {
				kind: "insert",
				pos: tok.end,
				edge: { x: bbox.right, y: bbox.top, h: bbox.height },
			};
		}
	}
	return { kind: "swap", token: tok, bbox: bbox || null };
}

function _truthOnPairMouseMove(ev) {
	if (!_truthPending || _truthPending.kind !== "pair") {
		_truthHidePairLabel();
		_truthHidePairArrow();
		return;
	}

	const roles = _truthPairAnchorRoles();
	if (!roles) {
		_truthHidePairLabel();
		_truthClearPairHover();
		return;
	}

	const info = _truthClickPosition(ev);
	if (!info || info.side !== roles.wantedSide) {
		_truthHidePairLabel();
		_truthClearPairHover();
		return;
	}

	const intent = _truthPairHitTest(info, ev, roles);

	if (intent.kind === "block") {
		_truthHidePairLabel();
		if (_truthPairHoverMarkEl) {
			_truthPairHoverMarkEl.classList.remove("truth-pair-target");
			_truthPairHoverMarkEl = null;
		}
		_truthHidePairTokenHover();
		_truthHidePairArrow();
		return;
	}

	const labelText = intent.kind === "insert" ? "insert" : "pair";
	_truthShowPairLabel(ev.clientX, ev.clientY, labelText);

	if (intent.kind === "mark") {
		const markEl = _truthFindMarkEl(info.side, intent.mark);
		const alreadyPaired = !!intent.mark.paired_with;
		if (markEl !== _truthPairHoverMarkEl) {
			if (_truthPairHoverMarkEl) {
				_truthPairHoverMarkEl.classList.remove("truth-pair-target");
			}
			_truthPairHoverMarkEl = markEl;
		}
		if (markEl) {
			markEl.classList.toggle("truth-pair-target", !alreadyPaired);
		}
		if (alreadyPaired && markEl) {
			const r = markEl.getBoundingClientRect();
			const el = _truthEnsurePairTokenHover();
			el.classList.add("no-underline");
			el.style.left = `${r.left}px`;
			el.style.top = `${r.top}px`;
			el.style.width = `${r.width}px`;
			el.style.height = `${r.height + 1}px`;
			el.style.display = "block";
		} else {
			_truthHidePairTokenHover();
		}
		_truthHidePairArrow();
		return;
	}

	if (_truthPairHoverMarkEl) {
		_truthPairHoverMarkEl.classList.remove("truth-pair-target");
		_truthPairHoverMarkEl = null;
	}

	if (intent.kind === "swap") {
		if (intent.bbox) {
			const el = _truthEnsurePairTokenHover();
			el.classList.remove("no-underline");
			el.style.left = `${intent.bbox.left}px`;
			el.style.top = `${intent.bbox.top}px`;
			el.style.width = `${intent.bbox.width}px`;
			el.style.height = `${intent.bbox.height + 1}px`;
			el.style.display = "block";
		} else {
			_truthHidePairTokenHover();
		}
		_truthHidePairArrow();
		return;
	}

	_truthHidePairTokenHover();

	if (!roles.allMissing) {
		_truthHidePairArrow();
		return;
	}

	if (intent.edge) {
		_truthShowPairArrow(intent.edge.x, intent.edge.y);
		return;
	}

	const cp = document.caretRangeFromPoint
		? document.caretRangeFromPoint(ev.clientX, ev.clientY)
		: null;
	if (!cp) {
		_truthHidePairArrow();
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
		_truthHidePairArrow();
		return;
	}
	_truthShowPairArrow(rect.left, rect.top);
}

function _truthEnterPairMode(anchorMarks, anchorSide, anchorFile) {
	_truthPending = {
		kind: "pair",
		anchorMarks,
		anchorSide,
		anchorFile,
	};
	document.body.classList.add("truth-pair-mode");
	if (anchorSide !== "teacher") {
		document.body.classList.add("truth-pair-anchor-extra");
	} else {
		document.body.classList.remove("truth-pair-anchor-extra");
	}
}

function _truthHandlePendingClick(ev) {
	if (!_truthPending || _truthPending.kind !== "pair") return false;
	const info = _truthClickPosition(ev);
	if (!info) return false;
	return _truthApplyPendingPair(info, ev);
}

function _truthPairAnchorRoles() {
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

function _truthApplyPendingPair(info, ev) {
	const roles = _truthPairAnchorRoles();
	if (!roles) {
		_truthCancelPending();
		return true;
	}
	if (info.side !== roles.wantedSide) return false;

	const intent = _truthPairHitTest(info, ev, roles);

	if (intent.kind === "block") return false;

	const anchorSide = _truthPending.anchorSide;
	const anchorFile = _truthPending.anchorFile;
	const anchorLo = Math.min(...roles.anchorMarks.map((m) => m.start));
	const anchorHi = Math.max(...roles.anchorMarks.map((m) => m.end));

	_truthSnapshot();

	if (intent.kind === "mark" || intent.kind === "swap") {
		let target;
		if (intent.kind === "mark") {
			target = intent.mark;
		} else {
			const wantedLabel = roles.allMissing ? "extra" : "missing";
			target = {
				token: intent.token.token,
				label: wantedLabel,
				start: intent.token.start,
				end: intent.token.end,
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
	} else if (intent.kind === "insert" && roles.allMissing) {
		for (const m of roles.anchorMarks) {
			_truthClearPair(m, "teacher");
			m.insert_at = { file: info.file, pos: intent.pos };
		}
	} else {
		_truthCancelPending();
		_truthClearPairHover();
		return true;
	}

	_truthCancelPending();
	_truthClearPairHover();
	_truthRerender();
	_truthSelectAndShow(anchorSide, anchorFile, anchorLo, anchorHi, 0, 0, {
		preservePosition: true,
	});
	return true;
}

function _truthCancelPending() {
	_truthPending = null;
	document.body.classList.remove("truth-pair-mode", "truth-pair-anchor-extra");
	_truthHidePairLabel();
	_truthHidePairArrow();
	_clearLeoHighlights();
}
