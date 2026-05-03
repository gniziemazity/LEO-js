"use strict";

// Truth-mode controls panel: action buttons (Missing/Extra/Ghost/Pair/Delete)
// docked to the top-right of the active token / multi-token bounding box,
// and the action dispatcher that mutates the working truth doc.

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
		_truthSelectionRange = null;
		_truthRefreshActiveOverlay();
		_truthRefreshConnectorsForCurrent();
	}
}

function _truthShowControls(sel, x, y, opts) {
	if (typeof _hideLeoTooltip === "function") _hideLeoTooltip();
	const el = _truthEnsureControls();
	const tokens =
		sel.tokens || _truthTokensInRange(sel.side, sel.file, sel.lo, sel.hi);
	const existing =
		sel.existing || _truthFindMarks(sel.side, sel.file, sel.lo, sel.hi);

	_truthCurrentSel = sel;
	_truthCurrentTokens = tokens;
	_truthCurrentExisting = existing;

	const allMissing =
		existing.length > 0 && existing.every((m) => m.label === "missing");
	const allExtra =
		existing.length > 0 && existing.every((m) => m.label === "extra");
	const allGhost =
		existing.length > 0 && existing.every((m) => m.label === "ghost_extra");
	const single = existing.length === 1;
	const singleHasPair = single && !!existing[0].paired_with;

	const fullyLabeled = (label) =>
		existing.length === tokens.length &&
		existing.length > 0 &&
		existing.every((m) => m.label === label);

	const pairActive =
		_truthPending &&
		_truthPending.kind === "pair" &&
		_truthPending.anchorMarks &&
		existing.length > 0 &&
		_truthPending.anchorMarks.length === existing.length &&
		_truthPending.anchorMarks.every((m, i) => existing[i] === m);
	const activeAttr = pairActive ? " is-toggle-on" : "";

	const buttons = [];
	const hasContent = tokens.length || existing.length;

	if (sel.side === "teacher") {
		if (hasContent && !fullyLabeled("missing")) {
			buttons.push(
				`<button type="button" class="tc-btn-missing" data-action="set-missing" title="Mark as missing (M)">→ Missing</button>`,
			);
		}
	} else {
		if (hasContent && !fullyLabeled("extra")) {
			buttons.push(
				`<button type="button" class="tc-btn-extra" data-action="set-extra" title="Mark as extra (E)">→ Extra</button>`,
			);
		}
		if (hasContent && !fullyLabeled("ghost_extra")) {
			buttons.push(
				`<button type="button" class="tc-btn-ghost" data-action="set-ghost" title="Mark as ghost extra (G)">→ Ghost</button>`,
			);
		}
	}

	if (existing.length) {
		if (allMissing) {
			const pairLabel = single ? "⇄ Insert / Pair" : "⇄ Insert";
			const pairTip = single
				? "Insert this token, or pair with an extra (I or P)"
				: "Insert these tokens at a student-side position (I or P)";
			buttons.push(
				`<button type="button" class="tc-btn-pair${activeAttr}" data-action="set-pair" title="${pairTip}">${pairLabel}</button>`,
			);
		} else if (allExtra && single) {
			buttons.push(
				`<button type="button" class="tc-btn-pair${activeAttr}" data-action="set-pair" title="Pair with a missing token (I or P)">⇄ Pair</button>`,
			);
		}
		if (singleHasPair && existing[0].label === "extra") {
			buttons.push(
				`<button type="button" class="tc-btn-del" data-action="unpair" title="Remove pair (R)">⊘ Remove pair</button>`,
			);
		}
		buttons.push(
			`<button type="button" class="tc-btn-del" data-action="del-all" title="Delete mark (Delete or Backspace)">✖ Delete</button>`,
		);
	}

	el.innerHTML = `<div class="tc-row">${buttons.join("")}</div>`;
	_truthPositionControls(el, sel, tokens, existing);
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

function _truthOnControlAction(action, sel, tokens, existing) {
	const opts = {};

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
			for (const m of existing.slice())
				_truthRemoveMark(sel.side, sel.file, m);
			if (tokens.length) {
				_truthAddMark("teacher", sel.file, "missing", tokens, opts);
			}
			break;
		case "set-extra":
			if (sel.side !== "student") return;
			for (const m of existing.slice())
				_truthRemoveMark(sel.side, sel.file, m);
			if (tokens.length) {
				_truthAddMark("student", sel.file, "extra", tokens, opts);
			}
			break;
		case "set-ghost":
			if (sel.side !== "student") return;
			for (const m of existing.slice())
				_truthRemoveMark(sel.side, sel.file, m);
			if (tokens.length) {
				_truthAddMark("student", sel.file, "ghost_extra", tokens, opts);
			}
			break;
		case "del-all":
			for (const m of existing.slice())
				_truthRemoveMark(sel.side, sel.file, m);
			break;
		case "unpair":
			for (const m of existing) _truthClearPair(m, sel.side);
			break;
		case "set-pair": {
			const samePending =
				_truthPending &&
				_truthPending.kind === "pair" &&
				_truthPending.anchorMarks &&
				existing.length === _truthPending.anchorMarks.length &&
				_truthPending.anchorMarks.every((m, i) => existing[i] === m);
			if (samePending) {
				_truthCancelPending();
				_truthClearPairHover();
			} else {
				_truthEnterPairMode(existing.slice(), sel.side, sel.file);
			}
			_truthReselectAfterAction(sel);
			_clearSelectionPreservingScroll();
			return;
		}
		default:
			return;
	}

	_truthRerender();

	if (action === "set-missing") {
		const newMarks = _truthFindMarks(
			"teacher",
			sel.file,
			sel.lo,
			sel.hi,
		).filter((m) => m.label === "missing" && !m.paired_with && !m.insert_at);
		if (newMarks.length) {
			_truthApplyClickHighlights(sel.side, sel.file, sel.lo, sel.hi);
			_truthEnterPairMode(newMarks, "teacher", sel.file);
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
