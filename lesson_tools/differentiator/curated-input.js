"use strict";

function _curatedOnKeyDown(ev) {
	if (ev.key === "Escape") {
		_curatedCancelPending();
		_curatedClearPairHover();
		_curatedHideControls();
		return;
	}
	if (typeof _embedMode !== "undefined" && _embedMode) return;

	const target = ev.target;
	const inField =
		target &&
		target.matches &&
		target.matches("input, textarea, select, [contenteditable=true]");

	if ((ev.ctrlKey || ev.metaKey) && !inField) {
		const k = ev.key.toLowerCase();
		if (k === "z" && !ev.shiftKey) {
			ev.preventDefault();
			_curatedUndo();
			return;
		}
		if (k === "y" || (k === "z" && ev.shiftKey)) {
			ev.preventDefault();
			_curatedRedo();
			return;
		}
	}

	if (inField) return;

	if (!_curatedCurrentSel) return;
	const sel = _curatedCurrentSel;

	if (sel.isGhost) {
		if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
		const k = ev.key.toLowerCase();
		const partner = _curatedFindGhostPartner(sel.ghost);
		if ((k === "i" || k === "p") && !partner) {
			ev.preventDefault();
			_curatedOnControlAction("set-pair-ghost", sel, [], []);
			return;
		}
		if (k === "r" && partner) {
			ev.preventDefault();
			_curatedOnControlAction("unpair-ghost", sel, [], []);
			return;
		}
		return;
	}

	const tokens = _curatedCurrentTokens || [];
	const existing = _curatedCurrentExisting || [];

	if (
		ev.key === "Delete" ||
		ev.key === "Backspace" ||
		ev.key.toLowerCase() === "d"
	) {
		const hasNonComment = existing.some((m) => m.label !== "comment");
		const hasComment = existing.some((m) => m.label === "comment");
		if (!hasNonComment && !(ev.shiftKey && hasComment)) return;
		ev.preventDefault();
		const action = ev.shiftKey ? "del-all-with-pairs" : "del-all";
		_curatedOnControlAction(action, sel, tokens, existing);
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
	const allUnpaired =
		(allMissing || allExtra || allGhostExtra) &&
		nonCommentExisting.every((m) => !m.paired_with);
	const hasAnyPaired = nonCommentExisting.some((m) => m.paired_with);

	const fullyLabeled = (label) =>
		nonCommentExisting.length === tokens.length &&
		nonCommentExisting.length > 0 &&
		nonCommentExisting.every((m) => m.label === label);

	if (k === "m" && sel.side === "teacher" && !fullyLabeled("missing")) {
		ev.preventDefault();
		_curatedOnControlAction("set-missing", sel, tokens, existing);
	} else if (k === "e" && sel.side === "student" && !fullyLabeled("extra")) {
		ev.preventDefault();
		_curatedOnControlAction("set-extra", sel, tokens, existing);
	} else if (
		k === "g" &&
		sel.side === "student" &&
		!fullyLabeled("ghost_extra")
	) {
		ev.preventDefault();
		_curatedOnControlAction("set-ghost", sel, tokens, existing);
	} else if (k === "c" && !fullyLabeled("comment")) {
		ev.preventDefault();
		_curatedOnControlAction("set-comment", sel, tokens, existing);
	} else if ((k === "i" || k === "p") && (tokens.length || existing.length)) {
		ev.preventDefault();
		if (sel.side === "teacher") {
			if (allMissing && fullyLabeled("missing")) {
				_curatedOnControlAction("set-pair", sel, tokens, existing);
			} else {
				_curatedOnControlAction("set-missing", sel, tokens, existing);
			}
		} else if (sel.side === "student") {
			if (allGhostExtra && allUnpaired) {
				_curatedOnControlAction("set-pair", sel, tokens, existing);
			} else if (allExtra && fullyLabeled("extra") && allUnpaired) {
				_curatedOnControlAction("set-pair", sel, tokens, existing);
			} else if (existing.length === 0 || allExtra) {
				_curatedOnControlAction("set-extra", sel, tokens, existing);
				const newMarks = _curatedFindMarks(
					sel.side,
					sel.file,
					sel.lo,
					sel.hi,
				).filter((m) => m.label === "extra" && !m.paired_with);
				if (newMarks.length === 1) {
					_curatedEnterPairMode(newMarks, sel.side, sel.file);
					_curatedRefreshCurrentControls();
				}
			}
		}
	} else if (
		k === "r" &&
		hasAnyPaired &&
		(allMissing || allExtra || allGhostExtra)
	) {
		ev.preventDefault();
		_curatedOnControlAction("unpair", sel, tokens, existing);
	}
}

function _curatedRefreshCurrentControls() {
	if (!_curatedCurrentSel) return;
	const sel = _curatedCurrentSel;
	if (sel.isGhost && typeof _curatedSelectGhostAndShow === "function") {
		_curatedSelectGhostAndShow(sel.ghost, 0, 0);
	} else if (!sel.isGhost) {
		_curatedSelectAndShow(sel.side, sel.file, sel.rawLo, sel.rawHi, 0, 0);
	}
}

document.addEventListener(
	"mousedown",
	(ev) => {
		if (!_curatedEditMode) return;
		if (
			ev.button === 2 &&
			_curatedPending &&
			_curatedPending.kind === "pair"
		) {
			ev.preventDefault();
			ev.stopPropagation();
			_curatedCancelPending();
			_curatedClearPairHover();
			_curatedRefreshCurrentControls();
			return;
		}
		if (ev.button !== 0) return;
		if (_curatedIsBackgroundClick(ev.target)) return;
		if (!ev.target.closest(".code-pane")) return;
		if (ev.target.closest(".insert-anchor")) return;
		ev.stopPropagation();
	},
	true,
);

document.addEventListener("contextmenu", (ev) => {
	if (_curatedPending && _curatedPending.kind === "pair") {
		ev.preventDefault();
	}
});

function _curatedOnMouseUp(ev) {
	if (!_curatedEditMode) return;
	if (ev.button !== 0) return;
	if (_curatedPending) {
		if (_curatedHandlePendingClick(ev)) return;
		if (!ev.target.closest || !ev.target.closest("#curated-controls")) {
			_curatedCancelPending();
			_curatedClearPairHover();
		}
	}
	if (_curatedIsBackgroundClick(ev.target)) return;
	const anchorEl = ev.target.closest && ev.target.closest(".insert-anchor");
	if (anchorEl) {
		_curatedSelectInsertAnchor(anchorEl, ev.clientX, ev.clientY);
		return;
	}
	const clickedGhost = _curatedGhostFromTarget(ev.target);
	if (clickedGhost) {
		_curatedSelectGhostAndShow(clickedGhost, ev.clientX, ev.clientY);
		return;
	}

	const sel = window.getSelection();
	const hasRange = sel && !sel.isCollapsed && sel.rangeCount > 0;

	let side, file, rawLo, rawHi;
	if (hasRange) {
		const range = sel.getRangeAt(0);
		const startInfo = _curatedResolveSrcPos(
			range.startContainer,
			range.startOffset,
		);
		const endInfo = _curatedResolveSrcPos(
			range.endContainer,
			range.endOffset,
		);
		if (
			!startInfo ||
			!endInfo ||
			startInfo.side !== endInfo.side ||
			startInfo.file !== endInfo.file
		) {
			_curatedHideControls();
			return;
		}
		side = startInfo.side;
		file = startInfo.file;
		rawLo = Math.min(startInfo.pos, endInfo.pos);
		rawHi = Math.max(startInfo.pos, endInfo.pos);
		if (rawLo === rawHi) {
			_curatedHideControls();
			return;
		}
	} else {
		const info = _curatedClickPosition(ev);
		const tok = info && _curatedTokenAtPos(info.side, info.file, info.pos);
		const groupAtPoint = _curatedGroupAtPoint(ev.clientX, ev.clientY);
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
			!!_curatedExistingMarkAtPos(info.side, info.file, tok.start);
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
			const groupRange = _curatedFindGroupRange(side, file, tok.start);
			if (groupRange) {
				rawLo = groupRange.lo;
				rawHi = groupRange.hi;
			} else {
				rawLo = tok.start;
				rawHi = tok.end;
			}
		} else {
			_curatedHideControls();
			return;
		}
	}

	_curatedSelectAndShow(side, file, rawLo, rawHi, ev.clientX, ev.clientY);
}

function _curatedSelectAndShow(side, file, rawLo, rawHi, x, y) {
	const snapped = _curatedSnapToTokens(side, file, rawLo, rawHi);
	let tokens = _curatedTokensInRange(side, file, snapped.lo, snapped.hi);
	let existing = _curatedFindMarks(side, file, snapped.lo, snapped.hi);
	let lo = snapped.lo;
	let hi = snapped.hi;
	if (
		!tokens.length &&
		!existing.length &&
		_curatedIsAllWhitespace(side, file, rawLo, rawHi)
	) {
		const wsTokens = _curatedWhitespaceTokensInRange(
			side,
			file,
			rawLo,
			rawHi,
		);
		if (wsTokens.length) {
			tokens = wsTokens;
			lo = wsTokens[0].start;
			hi = wsTokens[wsTokens.length - 1].end;
			existing = _curatedFindMarks(side, file, lo, hi);
		}
	}
	if (!tokens.length && !existing.length) {
		_curatedHideControls();
		return false;
	}
	_curatedApplyClickHighlights(side, file, lo, hi);
	_curatedShowControls(
		{
			side,
			file,
			lo,
			hi,
			rawLo,
			rawHi,
			tokens,
			existing,
		},
		x,
		y,
	);
	return true;
}

function _curatedSelectInsertAnchor(anchorEl, x, y) {
	const r = _curatedAnchorRange(anchorEl);
	if (!r) return;
	_curatedSelectAndShow(r.side, r.file, r.lo, r.hi, x, y);
}

function _curatedGhostFromTarget(target) {
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

function _curatedGhostMatchesPair(ghost, paired) {
	if (!paired || !paired.ghost) return false;
	return (
		paired.file === ghost.file &&
		paired.start === ghost.start &&
		paired.end === ghost.end &&
		paired.token === ghost.token
	);
}

function _curatedFindGhostPartner(ghost) {
	const t = _curatedMarks();
	if (!t) return null;
	const sFiles = t.student_files || {};
	for (const [file, marks] of Object.entries(sFiles)) {
		for (const m of marks || []) {
			if (m.label !== "ghost_extra") continue;
			if (_curatedGhostMatchesPair(ghost, m.paired_with)) {
				return { mark: m, file };
			}
		}
	}
	return null;
}

function _curatedSetGhostPair(studentMark, ghost) {
	_curatedClearPair(studentMark, "student");
	studentMark.paired_with = {
		file: ghost.file,
		start: ghost.start,
		end: ghost.end,
		token: ghost.token,
		ghost: true,
	};
}
