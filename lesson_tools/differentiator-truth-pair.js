"use strict";

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

function _truthSetPairHoverEls(els) {
	const next = els ? els.filter(Boolean) : [];
	for (const el of _truthPairHoverMarkEls) {
		if (!next.includes(el)) el.classList.remove("truth-pair-target");
	}
	for (const el of next) el.classList.add("truth-pair-target");
	_truthPairHoverMarkEls = next;
}

function _truthClearPairHover() {
	_truthHidePairTokenHover();
	_truthSetPairHoverEls([]);
	_truthHidePairArrow();
}

function _truthGhostTokensInFile(file) {
	const blobs =
		(_currentMarksEntry?.teacher_ghosts &&
			_currentMarksEntry.teacher_ghosts[file]) ||
		(typeof _borrowedTeacherGhosts === "function"
			? _borrowedTeacherGhosts(file)
			: []);
	if (!blobs || !blobs.length) return [];
	const out = [];
	const re = /[a-zA-Z0-9]+|[^\s]/gu;
	for (const blob of blobs) {
		const text = blob.text || "";
		re.lastIndex = 0;
		let m;
		while ((m = re.exec(text)) !== null) {
			out.push({
				file,
				blobPos: blob.pos,
				offset: m.index,
				token: m[0],
				start: blob.pos + m.index,
				end: blob.pos + m.index + m[0].length,
			});
		}
	}
	out.sort((a, b) => a.start - b.start);
	return out;
}

function _truthFindConsecutiveGhosts(file, startGhost, n) {
	if (n <= 0) return null;
	const list = _truthGhostTokensInFile(file);

	const sameBlob = list.filter((g) => g.blobPos === startGhost.blobPos);
	const sbIdx = sameBlob.findIndex(
		(g) => g.start === startGhost.start && g.token === startGhost.token,
	);
	if (sbIdx >= 0 && sbIdx + n <= sameBlob.length) {
		const sbSlice = sameBlob.slice(sbIdx, sbIdx + n);
		if (!sbSlice.some((g) => _truthGhostIsPaired(g))) return sbSlice;
	}

	const idx = list.findIndex(
		(g) => g.start === startGhost.start && g.token === startGhost.token,
	);
	if (idx < 0) return null;
	if (idx + n > list.length) return null;
	const slice = list.slice(idx, idx + n);
	for (const g of slice) {
		if (_truthGhostIsPaired(g)) return null;
	}
	const realTokens = _truthTokensForFile("teacher", file);
	for (let i = 1; i < slice.length; i++) {
		const prev = slice[i - 1];
		const cur = slice[i];
		if (prev.blobPos === cur.blobPos) continue;
		const lo = Math.min(prev.blobPos, cur.blobPos);
		const hi = Math.max(prev.blobPos, cur.blobPos);
		for (const tok of realTokens) {
			if (tok.start < lo) continue;
			if (tok.start >= hi) break;
			if (_truthIsCommentPos("teacher", file, tok.start)) continue;
			return null;
		}
	}
	return slice;
}

function _truthGhostIsPaired(ghost) {
	const t = _truthMarks();
	if (!t) return false;
	const sFiles = t.student_files || {};
	for (const marks of Object.values(sFiles)) {
		for (const m of marks || []) {
			if (m.label !== "ghost_extra") continue;
			if (_truthGhostMatchesPair(ghost, m.paired_with)) return true;
		}
	}
	return false;
}

function _truthFindGhostElByPos(file, start, token) {
	const wrap = document.getElementById("code-teacher");
	if (!wrap) return null;
	const candidates = wrap.querySelectorAll(
		`.leo-mark[data-leo-side="teacher"][data-leo-ghost-offset]`,
	);
	for (const el of candidates) {
		const pane = el.closest(".code-pane");
		if (!pane || pane.dataset.paneFile !== file) continue;
		const blobPos = parseInt(el.dataset.leoPos, 10);
		const offset = parseInt(el.dataset.leoGhostOffset, 10);
		if (!Number.isFinite(blobPos) || !Number.isFinite(offset)) continue;
		if (blobPos + offset === start && el.dataset.leoToken === token) {
			return el;
		}
	}
	return null;
}

function _truthFindLeoMarkEl(side, pos, token, file) {
	const wrap = document.getElementById(`code-${side}`);
	if (!wrap) return null;
	const paneSel = file
		? `.code-pane[data-pane-file="${CSS.escape(file)}"].active`
		: `.code-pane.active`;
	const sel =
		`${paneSel} .leo-mark[data-leo-side="${side}"]` +
		`[data-leo-pos="${pos}"]:not([data-leo-ghost-offset])`;
	for (const el of wrap.querySelectorAll(sel)) {
		if (el.getAttribute("data-leo-token") === token) return el;
	}
	return null;
}

function _truthFindMarkEl(side, mark, file) {
	if (!mark) return null;
	return _truthFindLeoMarkEl(side, mark.start, mark.token, file);
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
	let lastBoundary = null;
	const walk = (n) => {
		if (result) return;
		if (n.nodeType === 3) {
			const len = n.nodeValue.length;
			if (cursor + len > target) {
				result = { node: n, offset: target - cursor };
				return;
			}
			cursor += len;
			lastBoundary = { node: n, offset: len };
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
	return result || lastBoundary;
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
	const isExtraMoveContext = !!(roles.allExtra && info.side === "student");
	const allowInsert = roles.allMissing || isExtraMoveContext;
	const effectiveTargetLabels = isExtraMoveContext
		? new Set()
		: roles.wantedTargetLabels;

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
				).filter((m) => effectiveTargetLabels.has(m.label));
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
			if (!effectiveTargetLabels.has(existingHere.label)) {
				return { kind: "block" };
			}
			if (groupRange) return { kind: "block" };
			if (allowInsert && ev) {
				const markEl = _truthFindMarkEl(info.side, existingHere, info.file);
				if (markEl) {
					const r = markEl.getBoundingClientRect();
					const edgePx = Math.min(_TRUTH_EDGE_PX, r.width / 4);
					if (ev.clientX <= r.left + edgePx) {
						return {
							kind: "insert",
							pos: existingHere.start,
							edge: { x: r.left, y: r.top, h: r.height },
						};
					}
					if (ev.clientX >= r.right - edgePx) {
						return {
							kind: "insert",
							pos: existingHere.end,
							edge: { x: r.right, y: r.top, h: r.height },
						};
					}
				}
			}
			return { kind: "mark", mark: existingHere };
		}
	}

	if (groupRange && info.pos > groupRange.lo && info.pos < groupRange.hi) {
		return { kind: "block" };
	}

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
	if (isExtraMoveContext) {
		return { kind: "block" };
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

	if (roles.wantsGhost) {
		const ghost = _truthGhostFromTarget(ev.target);
		if (!ghost || ghost.side !== "teacher") {
			_truthHidePairLabel();
			_truthClearPairHover();
			return;
		}
		const n = roles.anchorMarks.length;
		if (n > 1) {
			const consecutive = _truthFindConsecutiveGhosts(ghost.file, ghost, n);
			if (!consecutive) {
				_truthHidePairLabel();
				_truthClearPairHover();
				return;
			}
			_truthShowPairLabel(ev.clientX, ev.clientY, "pair");
			_truthHidePairTokenHover();
			_truthHidePairArrow();
			const els = consecutive
				.map((g) => _truthFindGhostElByPos(g.file, g.start, g.token))
				.filter(Boolean);
			_truthSetPairHoverEls(els);
			return;
		}
		if (_truthGhostIsPaired(ghost)) {
			_truthHidePairLabel();
			_truthClearPairHover();
			return;
		}
		_truthShowPairLabel(ev.clientX, ev.clientY, "pair");
		const r = ghost.el.getBoundingClientRect();
		const el = _truthEnsurePairTokenHover();
		el.classList.remove("no-underline");
		el.style.left = `${r.left}px`;
		el.style.top = `${r.top}px`;
		el.style.width = `${r.width}px`;
		el.style.height = `${r.height + 1}px`;
		el.style.display = "block";
		_truthHidePairArrow();
		_truthSetPairHoverEls([ghost.el]);
		return;
	}

	if (roles.wantsStudentGhostExtra) {
		const info = _truthClickPosition(ev);
		const tok = info && _truthTokenAtPos(info.side, info.file, info.pos);
		const studentMark =
			info && tok
				? _truthExistingMarkAtPos("student", info.file, tok.start)
				: null;
		if (
			!info ||
			info.side !== "student" ||
			!studentMark ||
			studentMark.label !== "ghost_extra" ||
			studentMark.paired_with
		) {
			_truthHidePairLabel();
			_truthClearPairHover();
			return;
		}
		_truthShowPairLabel(ev.clientX, ev.clientY, "pair");
		_truthHidePairTokenHover();
		_truthHidePairArrow();
		const markEl = _truthFindLeoMarkEl(
			"student",
			studentMark.start,
			studentMark.token,
		);
		_truthSetPairHoverEls(markEl ? [markEl] : []);
		return;
	}

	const info = _truthClickPosition(ev);
	if (!info || !roles.wantedSides.has(info.side)) {
		_truthHidePairLabel();
		_truthClearPairHover();
		return;
	}

	const intent = _truthPairHitTest(info, ev, roles);

	if (intent.kind === "block") {
		_truthHidePairLabel();
		_truthSetPairHoverEls([]);
		_truthHidePairTokenHover();
		_truthHidePairArrow();
		return;
	}

	const labelText = intent.kind === "insert" ? "insert" : "pair";
	_truthShowPairLabel(ev.clientX, ev.clientY, labelText);

	if (intent.kind === "mark") {
		const markEl = _truthFindMarkEl(info.side, intent.mark, info.file);
		const alreadyPaired = !!intent.mark.paired_with;
		_truthSetPairHoverEls(markEl && !alreadyPaired ? [markEl] : []);
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

	_truthSetPairHoverEls([]);

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

	const showInsertArrow =
		roles.allMissing || (roles.allExtra && info.side === "student");
	if (!showInsertArrow) {
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

function _truthEnterPairModeForGhost(ghost) {
	_truthPending = {
		kind: "pair",
		anchorMarks: [],
		anchorGhost: ghost,
		anchorSide: "teacher",
		anchorFile: ghost.file,
	};
	document.body.classList.add("truth-pair-mode");
	document.body.classList.add("truth-pair-anchor-extra");
}

function _truthHandlePendingClick(ev) {
	if (!_truthPending || _truthPending.kind !== "pair") return false;
	const roles = _truthPairAnchorRoles();
	if (roles && roles.wantsGhost) {
		const ghost = _truthGhostFromTarget(ev.target);
		if (!ghost) return false;
		return _truthApplyGhostPairFromExtraStar(ghost);
	}
	if (roles && roles.wantsStudentGhostExtra) {
		const info = _truthClickPosition(ev);
		if (!info || info.side !== "student") return false;
		const tok = _truthTokenAtPos(info.side, info.file, info.pos);
		const studentMark = tok
			? _truthExistingMarkAtPos("student", info.file, tok.start)
			: null;
		if (
			!studentMark ||
			studentMark.label !== "ghost_extra" ||
			studentMark.paired_with
		) {
			return false;
		}
		return _truthApplyGhostPairFromGhostAnchor(studentMark);
	}
	const info = _truthClickPosition(ev);
	if (!info) return false;
	return _truthApplyPendingPair(info, ev);
}

function _truthApplyGhostPairFromExtraStar(ghost) {
	const anchorMarks = _truthPending.anchorMarks || [];
	if (
		!anchorMarks.length ||
		!anchorMarks.every((m) => m.label === "ghost_extra")
	) {
		_truthCancelPending();
		_truthClearPairHover();
		return true;
	}
	const anchorSide = _truthPending.anchorSide;
	const anchorFile = _truthPending.anchorFile;
	if (anchorMarks.length === 1) {
		const anchorMark = anchorMarks[0];
		if (_truthGhostIsPaired(ghost)) return false;
		_truthSnapshot();
		_truthSetGhostPair(anchorMark, ghost);
		const anchorLo = anchorMark.start;
		const anchorHi = anchorMark.end;
		_truthCancelPending();
		_truthClearPairHover();
		_truthRerender();
		_truthSelectAndShow(anchorSide, anchorFile, anchorLo, anchorHi, 0, 0, {
			preservePosition: true,
		});
		return true;
	}
	const sortedAnchors = anchorMarks.slice().sort((a, b) => a.start - b.start);
	const consecutive = _truthFindConsecutiveGhosts(
		ghost.file,
		ghost,
		sortedAnchors.length,
	);
	if (!consecutive) return false;
	_truthSnapshot();
	for (let i = 0; i < sortedAnchors.length; i++) {
		_truthSetGhostPair(sortedAnchors[i], consecutive[i]);
	}
	const anchorLo = Math.min(...sortedAnchors.map((m) => m.start));
	const anchorHi = Math.max(...sortedAnchors.map((m) => m.end));
	_truthCancelPending();
	_truthClearPairHover();
	_truthRerender();
	_truthSelectAndShow(anchorSide, anchorFile, anchorLo, anchorHi, 0, 0, {
		preservePosition: true,
	});
	return true;
}

function _truthApplyGhostPairFromGhostAnchor(studentMark) {
	const ghost = _truthPending.anchorGhost;
	if (!ghost) {
		_truthCancelPending();
		_truthClearPairHover();
		return true;
	}
	_truthSnapshot();
	_truthSetGhostPair(studentMark, ghost);
	_truthCancelPending();
	_truthClearPairHover();
	_truthRerender();
	if (typeof _truthSelectGhostAndShow === "function") {
		_truthSelectGhostAndShow(ghost, 0, 0, { preservePosition: true });
	}
	return true;
}

function _truthPairAnchorRoles() {
	if (_truthPending.anchorGhost) {
		return {
			anchorMarks: [],
			anchorGhost: _truthPending.anchorGhost,
			allMissing: false,
			allExtra: false,
			allGhostExtra: false,
			wantedSide: "student",
			wantedSides: new Set(["student"]),
			wantedTargetLabels: new Set(["ghost_extra"]),
			wantsStudentGhostExtra: true,
		};
	}
	const anchorMarks = _truthPending.anchorMarks || [];
	if (!anchorMarks.length) return null;
	const allMissing = anchorMarks.every((m) => m.label === "missing");
	const allExtra = anchorMarks.every((m) => m.label === "extra");
	const allGhostExtra = anchorMarks.every((m) => m.label === "ghost_extra");
	if (!allMissing && !allExtra && !allGhostExtra) return null;
	if (allGhostExtra) {
		return {
			anchorMarks,
			allMissing: false,
			allExtra: false,
			allGhostExtra: true,
			wantedSide: "teacher",
			wantedSides: new Set(["teacher"]),
			wantedTargetLabels: new Set(),
			wantsGhost: true,
		};
	}
	const primarySide = allMissing ? "student" : "teacher";
	return {
		anchorMarks,
		allMissing,
		allExtra,
		wantedSide: primarySide,
		wantedSides: allExtra
			? new Set(["teacher", "student"])
			: new Set([primarySide]),
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
	if (!roles.wantedSides.has(info.side)) return false;

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
	} else if (
		intent.kind === "insert" &&
		roles.allExtra &&
		info.side === "student"
	) {
		for (const m of roles.anchorMarks) {
			_truthClearPair(m, "student");
			m.move_to = { file: info.file, pos: intent.pos };
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
