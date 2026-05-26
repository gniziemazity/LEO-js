"use strict";

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
		const hasNonComment = existing.some((m) => m.label !== "comment");
		const hasComment = existing.some((m) => m.label === "comment");
		if (!hasNonComment && !(ev.shiftKey && hasComment)) return;
		ev.preventDefault();
		const action = ev.shiftKey ? "del-all-with-pairs" : "del-all";
		_truthOnControlAction(action, sel, tokens, existing);
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
		(allExtra && allUnpaired);
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
			} else if (allExtra && fullyLabeled("extra") && allUnpaired) {
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
	let tokens = _truthTokensInRange(side, file, snapped.lo, snapped.hi);
	let existing = _truthFindMarks(side, file, snapped.lo, snapped.hi);
	let lo = snapped.lo;
	let hi = snapped.hi;
	if (
		!tokens.length &&
		!existing.length &&
		_truthIsAllWhitespace(side, file, rawLo, rawHi)
	) {
		const wsTokens = _truthWhitespaceTokensInRange(side, file, rawLo, rawHi);
		if (wsTokens.length) {
			tokens = wsTokens;
			lo = wsTokens[0].start;
			hi = wsTokens[wsTokens.length - 1].end;
			existing = _truthFindMarks(side, file, lo, hi);
		}
	}
	if (!tokens.length && !existing.length) {
		_truthHideControls();
		return false;
	}
	_truthApplyClickHighlights(side, file, lo, hi);
	_truthShowControls(
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
		showOpts,
	);
	return true;
}

function _truthSelectInsertAnchor(anchorEl, x, y) {
	const r = _truthAnchorRange(anchorEl);
	if (!r) return;
	_truthSelectAndShow(r.side, r.file, r.lo, r.hi, x, y);
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
