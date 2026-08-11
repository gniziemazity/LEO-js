"use strict";

let _curatedCurrentSel = null;
let _curatedCurrentTokens = null;
let _curatedCurrentExisting = null;

function _curatedEnsureControls() {
	if (_curatedControlsEl) return _curatedControlsEl;
	const el = document.createElement("div");
	el.id = "curated-controls";

	el.addEventListener("mousedown", (e) => {
		if (e.target.closest("button")) {
			e.preventDefault();
			e.stopPropagation();
		}
	});
	el.addEventListener("mouseup", (e) => {
		if (e.target.closest("button")) {
			e.stopPropagation();
		}
	});
	el.addEventListener("click", (e) => {
		const btn = e.target.closest("button");
		if (!btn) return;
		e.preventDefault();
		e.stopPropagation();
		if (!_curatedCurrentSel) return;
		_curatedOnControlAction(
			btn.dataset.action,
			_curatedCurrentSel,
			_curatedCurrentTokens,
			_curatedCurrentExisting,
		);
	});

	_curatedControlsEl = el;
	return el;
}

function _curatedHideControls(opts) {
	if (_curatedControlsEl) _curatedControlsEl.style.display = "none";
	_curatedCurrentSel = null;
	_curatedCurrentTokens = null;
	_curatedCurrentExisting = null;
	if (!opts || !opts.keepHighlights) {
		_clearLeoHighlights();
		_curatedActiveGroupRange = null;
		_curatedActiveGhost = null;
		_curatedSelectionRange = null;
		_curatedRefreshActiveOverlay();
		_curatedRefreshConnectorsForCurrent();
	}
}

function _curatedBtnLabel(symbol, word, hotkeys, suffix) {
	const keys = Array.isArray(hotkeys) ? hotkeys : [hotkeys];
	const lower = word.toLowerCase();
	const targets = new Set();
	for (const k of keys) {
		if (!k) continue;
		const idx = lower.indexOf(k.toLowerCase());
		if (idx >= 0) targets.add(idx);
	}
	let label = "";
	for (let i = 0; i < word.length; i++) {
		label += targets.has(i) ? `<u>${word[i]}</u>` : word[i];
	}
	return `${symbol} ${label}${suffix ? " " + suffix : ""}`;
}

function _curatedTokenCountSuffix(n) {
	if (!n || n <= 0) return "";
	return n === 1 ? "1 Token" : `${n} Tokens`;
}

function _curatedShowControls(sel, x, y) {
	if (typeof _embedMode !== "undefined" && _embedMode) return;
	if (typeof _hideLeoTooltip === "function") _hideLeoTooltip();
	const el = _curatedEnsureControls();

	if (sel.isGhost) {
		_curatedCurrentSel = sel;
		_curatedCurrentTokens = [];
		_curatedCurrentExisting = [];
		const partner = _curatedFindGhostPartner(sel.ghost);
		const isPaired = !!partner;
		const pairActive =
			_curatedPending &&
			_curatedPending.kind === "pair" &&
			_curatedPending.anchorGhost &&
			_curatedPending.anchorGhost.file === sel.ghost.file &&
			_curatedPending.anchorGhost.start === sel.ghost.start &&
			_curatedPending.anchorGhost.token === sel.ghost.token;
		const activeAttr = pairActive ? " is-toggle-on" : "";
		const buttons = [];
		if (!isPaired) {
			buttons.push(
				`<button type="button" class="tc-btn-pair${activeAttr}" data-action="set-pair-ghost" title="Pair with a student ghost extra (I or P)">${_curatedBtnLabel("⇄", "Pair", "p", _curatedTokenCountSuffix(1))}</button>`,
			);
		} else {
			buttons.push(
				`<button type="button" class="tc-btn-del" data-action="unpair-ghost" title="Remove pair (R)">${_curatedBtnLabel("⊘", "Remove pair", "r")}</button>`,
			);
		}
		el.innerHTML = `<div class="tc-row">${buttons.join("")}</div>`;
		_curatedPositionGhostControls(el, sel.ghost);
		return;
	}

	const tokens =
		sel.tokens || _curatedTokensInRange(sel.side, sel.file, sel.lo, sel.hi);
	const existing =
		sel.existing || _curatedFindMarks(sel.side, sel.file, sel.lo, sel.hi);

	_curatedCurrentSel = sel;
	_curatedCurrentTokens = tokens;
	_curatedCurrentExisting = existing;

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
		allMissing || (allExtra && allUnpaired) || (allGhostExtra && allUnpaired);

	const fullyLabeled = (label) =>
		nonCommentExisting.length === tokens.length &&
		nonCommentExisting.length > 0 &&
		nonCommentExisting.every((m) => m.label === label);

	const pairActive =
		_curatedPending &&
		_curatedPending.kind === "pair" &&
		_curatedPending.anchorMarks &&
		nonCommentExisting.length > 0 &&
		_curatedPending.anchorMarks.length === nonCommentExisting.length &&
		_curatedPending.anchorMarks.every((m, i) => nonCommentExisting[i] === m);
	const activeAttr = pairActive ? " is-toggle-on" : "";

	const buttons = [];
	const hasContent = tokens.length || existing.length;

	if (sel.side === "teacher") {
		if (hasContent && !fullyLabeled("missing")) {
			buttons.push(
				`<button type="button" class="tc-btn-missing" data-action="set-missing" title="Mark as missing (M)">${_curatedBtnLabel("→", "Missing", "m")}</button>`,
			);
		}
	} else {
		if (hasContent && !fullyLabeled("extra")) {
			buttons.push(
				`<button type="button" class="tc-btn-extra" data-action="set-extra" title="Mark as extra (E)">${_curatedBtnLabel("→", "Extra", "e")}</button>`,
			);
		}
		if (hasContent && !fullyLabeled("ghost_extra")) {
			buttons.push(
				`<button type="button" class="tc-btn-ghost" data-action="set-ghost" title="Mark as ghost extra (G)">${_curatedBtnLabel("→", "Ghost", "g")}</button>`,
			);
		}
	}
	if (canPair) {
		const n = existing.length;
		const suffix = _curatedTokenCountSuffix(n);
		if (allMissing && single) {
			buttons.push(
				`<button type="button" class="tc-btn-pair${activeAttr}" data-action="set-pair" title="Insert this token, or pair with an extra (I or P)">${_curatedBtnLabel("⇄", "Insert/Pair", ["i", "p"], suffix)}</button>`,
			);
		} else if (allMissing) {
			buttons.push(
				`<button type="button" class="tc-btn-pair${activeAttr}" data-action="set-pair" title="Insert these tokens (I)">${_curatedBtnLabel("⇄", "Insert", "i", suffix)}</button>`,
			);
		} else if (allExtra) {
			if (single) {
				buttons.push(
					`<button type="button" class="tc-btn-pair${activeAttr}" data-action="set-pair" title="Insert this token at a different student-side position, or pair with a missing (I or P)">${_curatedBtnLabel("⇄", "Insert/Pair", ["i", "p"], suffix)}</button>`,
				);
			} else {
				buttons.push(
					`<button type="button" class="tc-btn-pair${activeAttr}" data-action="set-pair" title="Insert these tokens at a different student-side position (I)">${_curatedBtnLabel("⇄", "Insert", "i", suffix)}</button>`,
				);
			}
		} else if (allGhostExtra) {
			const tip =
				n === 1
					? "Pair with a teacher ghost (P)"
					: "Pair with consecutive teacher ghosts (P)";
			buttons.push(
				`<button type="button" class="tc-btn-pair${activeAttr}" data-action="set-pair" title="${tip}">${_curatedBtnLabel("⇄", "Pair", "p", suffix)}</button>`,
			);
		}
	}

	if (existing.length) {
		const hasAnyPaired = existing.some((m) => m.paired_with);
		const allRelabelable = allMissing || allExtra || allGhostExtra;
		if (hasAnyPaired && allRelabelable) {
			buttons.push(
				`<button type="button" class="tc-btn-del" data-action="unpair" title="Remove pair (R)">${_curatedBtnLabel("⊘", "Remove pair", "r")}</button>`,
			);
		}
		const hasNonComment = existing.some((m) => m.label !== "comment");
		if (hasNonComment) {
			const hasPairedNonComment = existing.some(
				(m) =>
					m.label !== "comment" && m.paired_with && !m.paired_with.ghost,
			);
			const tip = hasPairedNonComment
				? "Delete mark (D, Delete or Backspace). Hold Shift to also delete its pair."
				: "Delete mark (D, Delete or Backspace)";
			buttons.push(
				`<button type="button" class="tc-btn-del" data-action="del-all" title="${tip}">${_curatedBtnLabel("✖", "Delete", "d")}</button>`,
			);
		}
	}

	if (hasContent) {
		buttons.push(
			`<button type="button" class="tc-btn-comment" data-action="set-comment" title="Mark as comment (C)">${_curatedBtnLabel("→", "Comment", "c")}</button>`,
		);
	}

	el.innerHTML = `<div class="tc-row">${buttons.join("")}</div>`;
	_curatedPositionControls(el, sel, tokens, existing);
}

function _curatedPositionGhostControls(el, ghost) {
	const ghostEl =
		typeof _curatedFindGhostEl === "function"
			? _curatedFindGhostEl(ghost)
			: ghost.el || null;
	if (!ghostEl) {
		el.style.display = "none";
		return;
	}
	const pane = ghostEl.closest(".code-pane");
	if (!pane) {
		el.style.display = "none";
		return;
	}
	if (el.parentNode !== pane) pane.appendChild(el);
	el.style.left = "0px";
	el.style.top = "0px";
	el.style.display = "flex";
	const ew = el.offsetWidth;
	const eh = el.offsetHeight;
	const paneW = pane.clientWidth;
	const paneRect = pane.getBoundingClientRect();
	const r = ghostEl.getBoundingClientRect();
	const left0 = r.left - paneRect.left;
	const top0 = r.top - paneRect.top;
	const width0 = r.width;
	const height0 = r.height;
	let left = left0 + width0 + 4;
	if (left + ew > paneW - 4) left = Math.max(4, paneW - ew - 4);
	let top = top0 - eh;
	if (top < 0) top = top0 + height0;
	el.style.left = `${left}px`;
	el.style.top = `${top}px`;
}

function _curatedPositionControls(el, sel, tokens, existing) {
	const r = _curatedSelectionBoundingRect(
		sel.side,
		sel.file,
		tokens,
		existing,
	);
	if (!r) {
		el.style.display = "none";
		return;
	}
	if (el.parentNode !== r.pane) r.pane.appendChild(el);
	el.style.left = "0px";
	el.style.top = "0px";
	el.style.display = "flex";
	const ew = el.offsetWidth;
	const eh = el.offsetHeight;
	const paneW = r.pane.clientWidth;
	let left = r.left + r.width + 4;
	if (left + ew > paneW - 4) left = Math.max(4, paneW - ew - 4);
	let top = r.top - eh;
	if (top < 0) top = r.top + r.height;
	el.style.left = `${left}px`;
	el.style.top = `${top}px`;
}

function _curatedSelectGhostAndShow(ghost, x, y) {
	const sel = {
		side: "teacher",
		file: ghost.file,
		lo: ghost.start,
		hi: ghost.end,
		rawLo: ghost.start,
		rawHi: ghost.end,
		ghost,
		isGhost: true,
		tokens: [],
		existing: [],
	};
	_clearLeoHighlights();
	_curatedActiveGroupRange = null;
	_curatedSelectionRange = null;
	_curatedActiveGhost = ghost;
	_curatedRefreshActiveOverlay();
	_curatedRefreshConnectorsForCurrent();
	_curatedShowControls(sel, x, y);
}

function _curatedOnControlAction(action, sel, tokens, existing) {
	if (sel && sel.isGhost) {
		if (action === "set-pair-ghost") {
			const samePending =
				_curatedPending &&
				_curatedPending.kind === "pair" &&
				_curatedPending.anchorGhost &&
				_curatedPending.anchorGhost.file === sel.ghost.file &&
				_curatedPending.anchorGhost.start === sel.ghost.start &&
				_curatedPending.anchorGhost.token === sel.ghost.token;
			if (samePending) {
				_curatedCancelPending();
				_curatedClearPairHover();
			} else {
				if (_curatedPending && _curatedPending.kind === "pair") {
					_curatedCancelPending();
					_curatedClearPairHover();
				}
				_curatedEnterPairModeForGhost(sel.ghost);
			}
			_curatedSelectGhostAndShow(sel.ghost, 0, 0);
			_clearSelectionPreservingScroll();
			return;
		}
		if (action === "unpair-ghost") {
			const partner = _curatedFindGhostPartner(sel.ghost);
			if (partner) {
				_curatedSnapshot();
				delete partner.mark.paired_with;
				_curatedRerender();
			}
			_curatedSelectGhostAndShow(sel.ghost, 0, 0);
			_clearSelectionPreservingScroll();
			return;
		}
		return;
	}

	if (
		action !== "set-pair" &&
		_curatedPending &&
		_curatedPending.kind === "pair"
	) {
		_curatedCancelPending();
		_curatedClearPairHover();
	}

	if (action !== "close" && action !== "set-pair") {
		_curatedSnapshot();
	}

	switch (action) {
		case "close":
			_curatedHideControls();
			_clearSelectionPreservingScroll();
			return;
		case "set-missing":
			if (sel.side !== "teacher") return;
			for (const m of existing.slice()) {
				if (m.label === "comment") continue;
				_curatedRemoveMark(sel.side, sel.file, m);
			}
			if (tokens.length) {
				_curatedAddMark("teacher", sel.file, "missing", tokens);
			}
			break;
		case "set-extra":
			if (sel.side !== "student") return;
			for (const m of existing.slice()) {
				if (m.label === "comment") continue;
				_curatedRemoveMark(sel.side, sel.file, m);
			}
			if (tokens.length) {
				_curatedAddMark("student", sel.file, "extra", tokens);
			}
			break;
		case "set-ghost":
			if (sel.side !== "student") return;
			for (const m of existing.slice()) {
				if (m.label === "comment") continue;
				_curatedRemoveMark(sel.side, sel.file, m);
			}
			if (tokens.length) {
				_curatedAddMark("student", sel.file, "ghost_extra", tokens);
			}
			break;
		case "set-comment": {
			const existingCommentStarts = new Set(
				existing.filter((m) => m.label === "comment").map((m) => m.start),
			);
			for (const m of existing.slice()) {
				if (m.label === "comment") continue;
				_curatedRemoveMark(sel.side, sel.file, m);
			}
			const allTokens = _curatedTokensForFile(sel.side, sel.file).filter(
				(t) =>
					t.start >= sel.lo &&
					t.end <= sel.hi &&
					!existingCommentStarts.has(t.start),
			);
			if (allTokens.length) {
				_curatedAddMark(sel.side, sel.file, "comment", allTokens);
			}
			break;
		}
		case "del-all":
			for (const m of existing.slice()) {
				if (m.label === "comment") continue;
				_curatedRemoveMark(sel.side, sel.file, m);
			}
			break;
		case "del-all-with-pairs":
			for (const m of existing.slice()) {
				const pw = m.paired_with;
				if (pw && !pw.ghost) {
					const otherSide = sel.side === "teacher" ? "student" : "teacher";
					const partnerArr = _curatedFileMarks(otherSide, pw.file);
					const partner = partnerArr.find(
						(p) => p.start === pw.start && p.token === pw.token,
					);
					if (partner) {
						_curatedRemoveMark(otherSide, pw.file, partner);
					}
				}
				_curatedRemoveMark(sel.side, sel.file, m);
			}
			break;
		case "unpair":
			for (const m of existing) _curatedClearPair(m, sel.side);
			break;
		case "set-pair": {
			const anchorMarks = existing.filter((m) => m.label !== "comment");
			const samePending =
				_curatedPending &&
				_curatedPending.kind === "pair" &&
				_curatedPending.anchorMarks &&
				anchorMarks.length === _curatedPending.anchorMarks.length &&
				_curatedPending.anchorMarks.every((m, i) => anchorMarks[i] === m);
			if (samePending) {
				_curatedCancelPending();
				_curatedClearPairHover();
			} else if (anchorMarks.length) {
				_curatedEnterPairMode(anchorMarks, sel.side, sel.file);
			}
			_curatedReselectAfterAction(sel);
			_clearSelectionPreservingScroll();
			return;
		}
		default:
			return;
	}

	_curatedRerender();

	const autoPair = {
		"set-missing": { side: "teacher", label: "missing" },
		"set-ghost": { side: "student", label: "ghost_extra" },
	}[action];
	if (autoPair) {
		const newMarks = _curatedFindMarks(
			autoPair.side,
			sel.file,
			sel.lo,
			sel.hi,
		).filter(
			(m) => m.label === autoPair.label && !m.paired_with && !m.insert_at,
		);
		if (newMarks.length) {
			_curatedApplyClickHighlights(sel.side, sel.file, sel.lo, sel.hi);
			_curatedEnterPairMode(newMarks, autoPair.side, sel.file);
			_curatedReselectAfterAction(sel);
			_clearSelectionPreservingScroll();
			return;
		}
	}

	_curatedReselectAfterAction(sel);
	_clearSelectionPreservingScroll();
}

function _curatedReselectAfterAction(prevSel) {
	_curatedSelectAndShow(
		prevSel.side,
		prevSel.file,
		prevSel.rawLo,
		prevSel.rawHi,
		0,
		0,
	);
}
