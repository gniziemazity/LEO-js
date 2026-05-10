"use strict";

let _truthCurrentSel = null;
let _truthCurrentTokens = null;
let _truthCurrentExisting = null;

function _truthEnsureControls() {
	if (_truthControlsEl) return _truthControlsEl;
	const el = document.createElement("div");
	el.id = "truth-controls";

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
		if (!_truthCurrentSel) return;
		_truthOnControlAction(
			btn.dataset.action,
			_truthCurrentSel,
			_truthCurrentTokens,
			_truthCurrentExisting,
		);
	});

	_truthControlsEl = el;
	return el;
}

function _truthHideControls(opts) {
	if (_truthControlsEl) _truthControlsEl.style.display = "none";
	_truthCurrentSel = null;
	_truthCurrentTokens = null;
	_truthCurrentExisting = null;
	if (!opts || !opts.keepHighlights) {
		_clearLeoHighlights();
		_truthActiveGroupRange = null;
		_truthActiveGhost = null;
		_truthSelectionRange = null;
		_truthRefreshActiveOverlay();
		_truthRefreshConnectorsForCurrent();
	}
}

function _truthBtnLabel(symbol, word, hotkeys, suffix) {
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

function _truthTokenCountSuffix(n) {
	if (!n || n <= 0) return "";
	return n === 1 ? "1 Token" : `${n} Tokens`;
}

function _truthShowControls(sel, x, y, opts) {
	if (typeof _hideLeoTooltip === "function") _hideLeoTooltip();
	const el = _truthEnsureControls();

	if (sel.isGhost) {
		_truthCurrentSel = sel;
		_truthCurrentTokens = [];
		_truthCurrentExisting = [];
		const partner = _truthFindGhostPartner(sel.ghost);
		const isPaired = !!partner;
		const pairActive =
			_truthPending &&
			_truthPending.kind === "pair" &&
			_truthPending.anchorGhost &&
			_truthPending.anchorGhost.file === sel.ghost.file &&
			_truthPending.anchorGhost.start === sel.ghost.start &&
			_truthPending.anchorGhost.token === sel.ghost.token;
		const activeAttr = pairActive ? " is-toggle-on" : "";
		const buttons = [];
		if (!isPaired) {
			buttons.push(
				`<button type="button" class="tc-btn-pair${activeAttr}" data-action="set-pair-ghost" title="Pair with a student ghost extra (I or P)">${_truthBtnLabel("⇄", "Pair", "p", _truthTokenCountSuffix(1))}</button>`,
			);
		} else {
			buttons.push(
				`<button type="button" class="tc-btn-del" data-action="unpair-ghost" title="Remove pair (R)">${_truthBtnLabel("⊘", "Remove pair", "r")}</button>`,
			);
		}
		el.innerHTML = `<div class="tc-row">${buttons.join("")}</div>`;
		_truthPositionGhostControls(el, sel.ghost);
		return;
	}

	const tokens =
		sel.tokens || _truthTokensInRange(sel.side, sel.file, sel.lo, sel.hi);
	const existing =
		sel.existing || _truthFindMarks(sel.side, sel.file, sel.lo, sel.hi);

	_truthCurrentSel = sel;
	_truthCurrentTokens = tokens;
	_truthCurrentExisting = existing;

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
	const singleHasPair = single && !!nonCommentExisting[0].paired_with;
	const allUnpaired =
		(allMissing || allExtra || allGhostExtra) &&
		nonCommentExisting.every((m) => !m.paired_with);
	const canPair =
		allMissing ||
		(allExtra && single && allUnpaired) ||
		(allGhostExtra && allUnpaired);

	const fullyLabeled = (label) =>
		nonCommentExisting.length === tokens.length &&
		nonCommentExisting.length > 0 &&
		nonCommentExisting.every((m) => m.label === label);

	const pairActive =
		_truthPending &&
		_truthPending.kind === "pair" &&
		_truthPending.anchorMarks &&
		nonCommentExisting.length > 0 &&
		_truthPending.anchorMarks.length === nonCommentExisting.length &&
		_truthPending.anchorMarks.every((m, i) => nonCommentExisting[i] === m);
	const activeAttr = pairActive ? " is-toggle-on" : "";

	const buttons = [];
	const hasContent = tokens.length || existing.length;

	if (sel.side === "teacher") {
		if (hasContent && !fullyLabeled("missing")) {
			buttons.push(
				`<button type="button" class="tc-btn-missing" data-action="set-missing" title="Mark as missing (M)">${_truthBtnLabel("→", "Missing", "m")}</button>`,
			);
		}
	} else {
		if (hasContent && !fullyLabeled("extra")) {
			buttons.push(
				`<button type="button" class="tc-btn-extra" data-action="set-extra" title="Mark as extra (E)">${_truthBtnLabel("→", "Extra", "e")}</button>`,
			);
		}
		if (hasContent && !fullyLabeled("ghost_extra")) {
			buttons.push(
				`<button type="button" class="tc-btn-ghost" data-action="set-ghost" title="Mark as ghost extra (G)">${_truthBtnLabel("→", "Ghost", "g")}</button>`,
			);
		}
	}
	if (canPair) {
		const n = existing.length;
		const suffix = _truthTokenCountSuffix(n);
		if (allMissing && single) {
			buttons.push(
				`<button type="button" class="tc-btn-pair${activeAttr}" data-action="set-pair" title="Insert this token, or pair with an extra (I or P)">${_truthBtnLabel("⇄", "Insert/Pair", ["i", "p"], suffix)}</button>`,
			);
		} else if (allMissing) {
			buttons.push(
				`<button type="button" class="tc-btn-pair${activeAttr}" data-action="set-pair" title="Insert these tokens at a student-side position (I)">${_truthBtnLabel("⇄", "Insert", "i", suffix)}</button>`,
			);
		} else if (allExtra) {
			buttons.push(
				`<button type="button" class="tc-btn-pair${activeAttr}" data-action="set-pair" title="Pair with a missing token (P)">${_truthBtnLabel("⇄", "Pair", "p", suffix)}</button>`,
			);
		} else if (allGhostExtra) {
			const tip =
				n === 1
					? "Pair with a teacher ghost (P)"
					: "Pair with consecutive teacher ghosts (P)";
			buttons.push(
				`<button type="button" class="tc-btn-pair${activeAttr}" data-action="set-pair" title="${tip}">${_truthBtnLabel("⇄", "Pair", "p", suffix)}</button>`,
			);
		}
	}

	if (existing.length) {
		const hasAnyPaired = existing.some((m) => m.paired_with);
		const allRelabelable = allMissing || allExtra || allGhostExtra;
		if (hasAnyPaired && allRelabelable) {
			buttons.push(
				`<button type="button" class="tc-btn-del" data-action="unpair" title="Remove pair (R)">${_truthBtnLabel("⊘", "Remove pair", "r")}</button>`,
			);
		}
		const hasNonComment = existing.some((m) => m.label !== "comment");
		if (hasNonComment) {
			buttons.push(
				`<button type="button" class="tc-btn-del" data-action="del-all" title="Delete mark (D, Delete or Backspace)">${_truthBtnLabel("✖", "Delete", "d")}</button>`,
			);
		}
	}

	if (hasContent) {
		buttons.push(
			`<button type="button" class="tc-btn-comment" data-action="set-comment" title="Mark as comment (C)">${_truthBtnLabel("→", "Comment", "c")}</button>`,
		);
	}

	el.innerHTML = `<div class="tc-row">${buttons.join("")}</div>`;
	_truthPositionControls(el, sel, tokens, existing);
}

function _truthPositionGhostControls(el, ghost) {
	const ghostEl =
		typeof _truthFindGhostElByPos === "function"
			? _truthFindGhostElByPos(ghost.file, ghost.start, ghost.token)
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

function _truthPositionControls(el, sel, tokens, existing) {
	const r = _truthSelectionBoundingRect(sel.side, sel.file, tokens, existing);
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

function _truthSelectGhostAndShow(ghost, x, y) {
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
	_truthActiveGroupRange = null;
	_truthSelectionRange = null;
	_truthActiveGhost = ghost;
	_truthRefreshActiveOverlay();
	_truthRefreshConnectorsForCurrent();
	_truthShowControls(sel, x, y);
}

function _truthOnControlAction(action, sel, tokens, existing) {
	const opts = {};

	if (sel && sel.isGhost) {
		if (action === "set-pair-ghost") {
			const samePending =
				_truthPending &&
				_truthPending.kind === "pair" &&
				_truthPending.anchorGhost &&
				_truthPending.anchorGhost.file === sel.ghost.file &&
				_truthPending.anchorGhost.start === sel.ghost.start &&
				_truthPending.anchorGhost.token === sel.ghost.token;
			if (samePending) {
				_truthCancelPending();
				_truthClearPairHover();
			} else {
				if (_truthPending && _truthPending.kind === "pair") {
					_truthCancelPending();
					_truthClearPairHover();
				}
				_truthEnterPairModeForGhost(sel.ghost);
			}
			_truthSelectGhostAndShow(sel.ghost, 0, 0);
			_clearSelectionPreservingScroll();
			return;
		}
		if (action === "unpair-ghost") {
			const partner = _truthFindGhostPartner(sel.ghost);
			if (partner) {
				_truthSnapshot();
				delete partner.mark.paired_with;
				_truthRerender();
			}
			_truthSelectGhostAndShow(sel.ghost, 0, 0);
			_clearSelectionPreservingScroll();
			return;
		}
		return;
	}

	if (
		action !== "set-pair" &&
		_truthPending &&
		_truthPending.kind === "pair"
	) {
		_truthCancelPending();
		_truthClearPairHover();
	}

	if (action !== "close" && action !== "set-pair") {
		_truthSnapshot();
	}

	switch (action) {
		case "close":
			_truthHideControls();
			_clearSelectionPreservingScroll();
			return;
		case "set-missing":
			if (sel.side !== "teacher") return;
			for (const m of existing.slice()) {
				if (m.label === "comment") continue;
				_truthRemoveMark(sel.side, sel.file, m);
			}
			if (tokens.length) {
				_truthAddMark("teacher", sel.file, "missing", tokens, opts);
			}
			break;
		case "set-extra":
			if (sel.side !== "student") return;
			for (const m of existing.slice()) {
				if (m.label === "comment") continue;
				_truthRemoveMark(sel.side, sel.file, m);
			}
			if (tokens.length) {
				_truthAddMark("student", sel.file, "extra", tokens, opts);
			}
			break;
		case "set-ghost":
			if (sel.side !== "student") return;
			for (const m of existing.slice()) {
				if (m.label === "comment") continue;
				_truthRemoveMark(sel.side, sel.file, m);
			}
			if (tokens.length) {
				_truthAddMark("student", sel.file, "ghost_extra", tokens, opts);
			}
			break;
		case "set-comment": {
			const existingCommentStarts = new Set(
				existing.filter((m) => m.label === "comment").map((m) => m.start),
			);
			for (const m of existing.slice()) {
				if (m.label === "comment") continue;
				_truthRemoveMark(sel.side, sel.file, m);
			}
			const allTokens = _truthTokensForFile(sel.side, sel.file).filter(
				(t) =>
					t.start >= sel.lo &&
					t.end <= sel.hi &&
					!existingCommentStarts.has(t.start),
			);
			if (allTokens.length) {
				_truthAddMark(sel.side, sel.file, "comment", allTokens, opts);
			}
			break;
		}
		case "del-all":
			for (const m of existing.slice()) {
				if (m.label === "comment") continue;
				_truthRemoveMark(sel.side, sel.file, m);
			}
			break;
		case "unpair":
			for (const m of existing) _truthClearPair(m, sel.side);
			break;
		case "set-pair": {
			const anchorMarks = existing.filter((m) => m.label !== "comment");
			const samePending =
				_truthPending &&
				_truthPending.kind === "pair" &&
				_truthPending.anchorMarks &&
				anchorMarks.length === _truthPending.anchorMarks.length &&
				_truthPending.anchorMarks.every((m, i) => anchorMarks[i] === m);
			if (samePending) {
				_truthCancelPending();
				_truthClearPairHover();
			} else if (anchorMarks.length) {
				_truthEnterPairMode(anchorMarks, sel.side, sel.file);
			}
			_truthReselectAfterAction(sel);
			_clearSelectionPreservingScroll();
			return;
		}
		default:
			return;
	}

	_truthRerender();

	const autoPair = {
		"set-missing": { side: "teacher", label: "missing" },
		"set-ghost": { side: "student", label: "ghost_extra" },
	}[action];
	if (autoPair) {
		const newMarks = _truthFindMarks(
			autoPair.side,
			sel.file,
			sel.lo,
			sel.hi,
		).filter(
			(m) => m.label === autoPair.label && !m.paired_with && !m.insert_at,
		);
		if (newMarks.length) {
			_truthApplyClickHighlights(sel.side, sel.file, sel.lo, sel.hi);
			_truthEnterPairMode(newMarks, autoPair.side, sel.file);
			_truthReselectAfterAction(sel);
			_clearSelectionPreservingScroll();
			return;
		}
	}

	_truthReselectAfterAction(sel);
	_clearSelectionPreservingScroll();
}

function _truthReselectAfterAction(prevSel) {
	_truthSelectAndShow(
		prevSel.side,
		prevSel.file,
		prevSel.rawLo,
		prevSel.rawHi,
		0,
		0,
		{ preservePosition: true },
	);
}
