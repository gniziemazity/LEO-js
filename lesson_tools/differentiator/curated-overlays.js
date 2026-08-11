"use strict";

class OverlayLayer {
	constructor(pane, bg, fg) {
		this.pane = pane;
		this.bg = bg;
		this.fg = fg;
	}

	static forPane(pane) {
		if (!pane) return null;
		let bg = pane.querySelector(":scope > .curated-bg-layer");
		if (!bg) {
			bg = document.createElement("div");
			bg.className = "curated-bg-layer";
			pane.insertBefore(bg, pane.firstChild);
		}
		let fg = pane.querySelector(":scope > .curated-fg-layer");
		if (!fg) {
			fg = document.createElement("div");
			fg.className = "curated-fg-layer";
			pane.appendChild(fg);
		}
		return new OverlayLayer(pane, bg, fg);
	}

	static clearAllRects(className) {
		for (const layer of document.querySelectorAll(".curated-bg-layer")) {
			for (const el of layer.querySelectorAll("." + className)) {
				el.remove();
			}
		}
	}

	clearRects(className) {
		for (const el of this.bg.querySelectorAll("." + className)) {
			el.remove();
		}
	}

	clearAll() {
		this.bg.innerHTML = "";
	}

	addRect(className, { left, top, width, height }) {
		const div = document.createElement("div");
		div.className = className;
		div.style.left = `${left}px`;
		div.style.top = `${top}px`;
		div.style.width = `${width}px`;
		div.style.height = `${height}px`;
		this.bg.appendChild(div);
		return div;
	}

	static emptyBounds() {
		return {
			left: Infinity,
			right: -Infinity,
			top: Infinity,
			bottom: -Infinity,
		};
	}

	static expandBounds(bounds, r) {
		if (r.left < bounds.left) bounds.left = r.left;
		if (r.right > bounds.right) bounds.right = r.right;
		if (r.top < bounds.top) bounds.top = r.top;
		if (r.bottom > bounds.bottom) bounds.bottom = r.bottom;
	}

	static scanMarks(pane, side, positions, lineSet) {
		const bounds = OverlayLayer.emptyBounds();
		const sel = `.leo-mark[data-leo-side="${side}"]:not([data-leo-ghost-offset])`;
		for (const el of pane.querySelectorAll(sel)) {
			const p = parseInt(el.getAttribute("data-leo-pos"), 10);
			if (!positions.has(p)) continue;
			const r = el.getBoundingClientRect();
			if (r.width === 0 && r.height === 0) continue;
			OverlayLayer.expandBounds(bounds, r);
			if (lineSet) {
				const lineEl = el.closest(".diff-line");
				if (lineEl) lineSet.add(lineEl);
			}
		}
		return bounds;
	}

	static paneRect(bounds, pane, pad) {
		if (!Number.isFinite(bounds.left)) return null;
		const paneRect = pane.getBoundingClientRect();
		return {
			pane,
			left: bounds.left - paneRect.left - pad,
			top: bounds.top - paneRect.top - pad,
			width: bounds.right - bounds.left + 2 * pad,
			height: bounds.bottom - bounds.top + 2 * pad,
		};
	}
}

function _curatedEnsurePaneOverlays(pane) {
	return OverlayLayer.forPane(pane);
}

function _curatedGroupHasBox(kind) {
	if (!kind) return false;
	if (kind.indexOf("missing") === 0) return true;
	if (kind === "extra" || kind === "extra-replace" || kind === "extra-move")
		return true;
	if (kind === "ghost_extra") return true;
	return false;
}

function _curatedBgRectKindClass(kind) {
	if (!kind) return "";
	if (kind.indexOf("missing") === 0) return "is-missing";
	if (kind === "ghost_extra") return "is-ghost";
	return "is-extra";
}

function _curatedBounds() {
	return OverlayLayer.emptyBounds();
}

function _curatedExpand(bounds, r) {
	OverlayLayer.expandBounds(bounds, r);
}

function _curatedScanMarks(pane, side, positions, lineSet) {
	return OverlayLayer.scanMarks(pane, side, positions, lineSet);
}

function _curatedPaneRect(bounds, pane, pad) {
	return OverlayLayer.paneRect(bounds, pane, pad);
}

function _curatedPaneFor(side, file, activeOnly) {
	const wrap = document.getElementById(`code-${side}`);
	if (!wrap) return null;
	for (const p of wrap.querySelectorAll(".code-pane")) {
		if (
			p.dataset.paneFile === file &&
			(!activeOnly || p.classList.contains("active"))
		) {
			return p;
		}
	}
	return null;
}

function _curatedSelectionBoundingRect(side, file, tokens, marks, pad = 0) {
	const pane = _curatedPaneFor(side, file, false);
	if (!pane) return null;
	let bounds = _curatedBounds();
	if (marks && marks.length) {
		const positions = new Set(marks.map((m) => m.start));
		bounds = _curatedScanMarks(pane, side, positions, null);
	}
	if (!Number.isFinite(bounds.left) && tokens) {
		for (const t of tokens) {
			const bbox = _curatedTokenBbox(side, file, t);
			if (!bbox) continue;
			_curatedExpand(bounds, bbox);
		}
	}
	return _curatedPaneRect(bounds, pane, pad);
}

function _curatedCollectGroupRect(group, pad = 6) {
	const pane = _curatedPaneFor(group.side, group.file, true);
	if (!pane) return null;
	const positions = new Set();
	for (const m of group.marks || []) positions.add(m.start);
	if (!positions.size) return null;
	const lineSet = new Set();
	const bounds = _curatedScanMarks(pane, group.side, positions, lineSet);
	const rect = _curatedPaneRect(bounds, pane, pad);
	if (!rect) return null;
	rect.lineCount = lineSet.size;
	return rect;
}

function _curatedRefreshGhostPairs() {
	const wrapTeacher = document.getElementById("code-teacher");
	const wrapStudent = document.getElementById("code-student");
	if (wrapTeacher) {
		for (const el of wrapTeacher.querySelectorAll(".curated-ghost-paired")) {
			el.classList.remove("curated-ghost-paired");
		}
	}
	if (wrapStudent) {
		for (const el of wrapStudent.querySelectorAll(
			".curated-paired-ghost-extra",
		)) {
			el.classList.remove("curated-paired-ghost-extra");
		}
	}
	const t =
		(typeof _curatedMarks === "function" ? _curatedMarks() : null) ||
		_currentMarksEntry ||
		null;
	if (!t) return;
	const sFiles = t.student_files || {};
	for (const [studentFile, marks] of Object.entries(sFiles)) {
		for (const m of marks || []) {
			if (m.label !== "ghost_extra") continue;
			const pw = m.paired_with;
			if (!pw || !pw.ghost) continue;
			if (wrapTeacher) {
				const el = _curatedFindGhostEl(pw);
				if (el) el.classList.add("curated-ghost-paired");
			}
			if (wrapStudent) {
				const studentEl = _curatedFindLeoMarkEl(
					"student",
					m.start,
					m.token,
				);
				if (studentEl)
					studentEl.classList.add("curated-paired-ghost-extra");
			}
		}
	}
}

function _curatedGroupTitleText(kind, count) {
	let label;
	if (kind === "missing" || kind === "missing-insert") label = "missing";
	else if (kind === "ghost_extra") label = "ghost";
	else label = "extra";
	const noun = count === 1 ? "token" : "tokens";
	return `${count} ${label} ${noun}`;
}

function _curatedApplyGroupCountTitles(group, marks) {
	const title = _curatedGroupTitleText(group.kind, marks.length);
	for (const mark of marks) {
		const el = _curatedFindLeoMarkEl(group.side, mark.start, mark.token);
		if (el) el.setAttribute("title", title);
	}
}

function _curatedRefreshOverlays() {
	const wrapTeacher = document.getElementById("code-teacher");
	const wrapStudent = document.getElementById("code-student");
	for (const wrap of [wrapTeacher, wrapStudent]) {
		if (!wrap) continue;
		for (const pane of wrap.querySelectorAll(".code-pane")) {
			const layers = _curatedEnsurePaneOverlays(pane);
			if (layers) layers.clearAll();
		}
	}
	const groups = _curatedGroupMarks();
	for (const g of groups) {
		if (!_curatedGroupHasBox(g.kind)) continue;
		const marks = _curatedFindMarks(g.side, g.file, g.lo, g.hi);
		if (marks.length <= 1) continue;
		const r = _curatedCollectGroupRect(g);
		if (!r) continue;
		const layers = _curatedEnsurePaneOverlays(r.pane);
		if (!layers) continue;
		const div = layers.addRect(
			`curated-bg-rect ${_curatedBgRectKindClass(g.kind)}`,
			r,
		);
		div.dataset.groupKey = `${g.side}|${g.file}|${g.lo}|${g.hi}`;
		_curatedApplyGroupCountTitles(g, marks);
	}
	_curatedRebuildGroupRectCache();
	if (_curatedActiveGroupRange) {
		_curatedActiveGroupRange.marks = _curatedFindMarks(
			_curatedActiveGroupRange.side,
			_curatedActiveGroupRange.file,
			_curatedActiveGroupRange.lo,
			_curatedActiveGroupRange.hi,
		);
	}
	_curatedRefreshHoverBorder();
	_curatedRefreshActiveOverlay();
	_curatedRefreshConnectorsForCurrent();
	_curatedRefreshGhostPairs();
}

function _curatedRefreshConnectorsForCurrent() {
	_curatedPairConnectorItems = [];
	const seenPairs = new Set();
	const seenGroups = new Set();
	_curatedCollectAlwaysOnConnectors(_curatedPairConnectorItems, seenGroups);
	if (_curatedSelectionRange) {
		_curatedCollectConnectorsForRange(
			_curatedSelectionRange,
			_curatedPairConnectorItems,
			seenPairs,
			seenGroups,
		);
	}
	if (_curatedHoverGroupRange) {
		_curatedCollectConnectorsForRange(
			_curatedHoverGroupRange,
			_curatedPairConnectorItems,
			seenPairs,
			seenGroups,
		);
	}
	if (_curatedActiveGhost) {
		const partner = _curatedFindGhostPartner(_curatedActiveGhost);
		if (partner) {
			const key = `ghost|${_curatedActiveGhost.file}|${_curatedActiveGhost.start}|${_curatedActiveGhost.token}|${partner.file}|${partner.mark.start}`;
			if (!seenPairs.has(key)) {
				seenPairs.add(key);
				_curatedPairConnectorItems.push({
					kind: "ghost-pair",
					studentMark: partner.mark,
					studentFile: partner.file,
					ghost: {
						file: _curatedActiveGhost.file,
						start: _curatedActiveGhost.start,
						end: _curatedActiveGhost.end,
						token: _curatedActiveGhost.token,
					},
				});
			}
		}
	}
	_curatedRefreshPairConnectors();
}

function _curatedCollectAlwaysOnConnectors(items, seenGroups) {
	for (const g of _curatedGroupMarks()) {
		if (g.side === "teacher" && g.kind === "missing") {
			const key = `${g.side}|${g.file}|${g.lo}|${g.hi}`;
			if (seenGroups.has(key)) continue;
			seenGroups.add(key);
			items.push({ kind: "groupInsert", group: g });
		}
	}
}

let _curatedHoverGroupKey = null;
let _curatedHoverGroupRange = null;

function _curatedClearGroupHover() {
	_curatedHoverGroupKey = null;
	_curatedHoverGroupRange = null;
	document.body.classList.remove("curated-group-hover-active");
	_curatedRefreshHoverBorder();
	_curatedRefreshConnectorsForCurrent();
	if (typeof _curatedClearGhostHover === "function") _curatedClearGhostHover();
}

function _curatedRefreshHoverBorder() {
	for (const el of document.querySelectorAll(
		".leo-mark.is-hover-transparent",
	)) {
		el.classList.remove("is-hover-transparent");
	}
	if (!_curatedHoverGroupRange) return;
	const { side, file, lo, hi } = _curatedHoverGroupRange;
	const pane = _curatedPaneFor(side, file, false);
	if (!pane) return;
	const sel = `.leo-mark[data-leo-side="${side}"]:not([data-leo-ghost-offset])`;
	for (const el of pane.querySelectorAll(sel)) {
		const p = parseInt(el.getAttribute("data-leo-pos"), 10);
		if (!Number.isFinite(p) || p < lo || p >= hi) continue;
		el.classList.add("is-hover-transparent");
	}
}

let _curatedActiveGroupRange = null;
let _curatedActiveGhost = null;
let _curatedSelectionRange = null;

function _curatedActiveRectBg(marks) {
	if (!marks || !marks.length) return "var(--clr-mark-active-bg)";
	const allMissing = marks.every((m) => m.label === "missing");
	const allExtra = marks.every((m) => m.label === "extra");
	const allGhost = marks.every((m) => m.label === "ghost_extra");
	if (allMissing) return "var(--clr-mark-active-bg)";
	if (allGhost) return "var(--clr-mark-active-bg)";
	if (allExtra) {
		const pairedAll = marks.every((m) => m.paired_with);
		if (!pairedAll) return "var(--clr-mark-active-bg)";
		const pw = marks[0].paired_with;
		const tFile = pw && pw.file;
		const tPos = pw && typeof pw.start === "number" ? pw.start : 0;
		const tText =
			tFile && typeof _teacherFiles !== "undefined" && _teacherFiles[tFile]
				? _teacherFiles[tFile].replace(/\r\n/g, "\n")
				: "";
		const c = _diffMissingColorAt(tFile, tText, tPos);
		if (c && typeof _hexToRgba === "function") return _hexToRgba(c, 0.22);
		return c || "var(--clr-mark-active-bg)";
	}
	return null;
}

function _curatedDrawActiveRect(range) {
	const tokens =
		!range.marks || !range.marks.length
			? _curatedTokensInRange(range.side, range.file, range.lo, range.hi)
			: null;
	const r =
		range.marks && range.marks.length
			? _curatedCollectGroupRect(range, 0)
			: _curatedSelectionBoundingRect(
					range.side,
					range.file,
					tokens,
					null,
					0,
				);
	if (!r) return;
	const layers = _curatedEnsurePaneOverlays(r.pane);
	if (!layers) return;
	const div = layers.addRect("curated-active-rect", r);
	const bg = _curatedActiveRectBg(range.marks);
	if (bg) div.style.backgroundColor = bg;
}

function _curatedRefreshActiveOverlay() {
	OverlayLayer.clearAllRects("curated-active-rect");
	if (_curatedActiveGhost) {
		_curatedDrawGhostActiveRect(_curatedActiveGhost);
		const partner = _curatedFindGhostPartner(_curatedActiveGhost);
		if (partner) {
			_curatedDrawActiveRect({
				side: "student",
				file: partner.file,
				lo: partner.mark.start,
				hi: partner.mark.end,
				marks: [partner.mark],
			});
		}
		return;
	}
	if (!_curatedActiveGroupRange) return;
	_curatedDrawActiveRect(_curatedActiveGroupRange);

	const otherSide =
		_curatedActiveGroupRange.side === "teacher" ? "student" : "teacher";
	const partnerRanges = new Map();
	const ghostPartners = [];
	for (const m of _curatedActiveGroupRange.marks || []) {
		if (!m.paired_with) continue;
		if (m.paired_with.ghost) {
			ghostPartners.push(m.paired_with);
			continue;
		}
		const pFile = m.paired_with.file;
		const pStart = m.paired_with.start;
		const pEnd = pStart + (m.paired_with.token?.length ?? 0);
		const key = `${pFile}`;
		const existing = partnerRanges.get(key);
		if (!existing) {
			partnerRanges.set(key, { file: pFile, lo: pStart, hi: pEnd });
		} else {
			existing.lo = Math.min(existing.lo, pStart);
			existing.hi = Math.max(existing.hi, pEnd);
		}
	}
	for (const range of partnerRanges.values()) {
		const marks = _curatedFindMarks(
			otherSide,
			range.file,
			range.lo,
			range.hi,
		);
		_curatedDrawActiveRect({
			side: otherSide,
			file: range.file,
			lo: range.lo,
			hi: range.hi,
			marks,
		});
	}
	for (const ghost of ghostPartners) {
		_curatedDrawGhostActiveRect(ghost);
	}
}

function _curatedDrawGhostActiveRect(ghost) {
	const el = _curatedFindGhostEl(ghost, { activeOnly: true });
	if (!el) return;
	const pane = el.closest(".code-pane");
	if (!pane) return;
	const layers = _curatedEnsurePaneOverlays(pane);
	if (!layers) return;
	const r = el.getBoundingClientRect();
	const paneRect = pane.getBoundingClientRect();
	layers.addRect("curated-active-rect is-dark-gray", {
		left: r.left - paneRect.left,
		top: r.top - paneRect.top,
		width: r.width,
		height: r.height,
	});
}
