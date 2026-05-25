"use strict";

function _truthEnsurePaneOverlays(pane) {
	if (!pane) return null;
	let bg = pane.querySelector(":scope > .truth-bg-layer");
	if (!bg) {
		bg = document.createElement("div");
		bg.className = "truth-bg-layer";
		pane.insertBefore(bg, pane.firstChild);
	}
	let fg = pane.querySelector(":scope > .truth-fg-layer");
	if (!fg) {
		fg = document.createElement("div");
		fg.className = "truth-fg-layer";
		pane.appendChild(fg);
	}
	return { bg, fg };
}

function _truthGroupHasBox(kind) {
	if (!kind) return false;
	if (kind.indexOf("missing") === 0) return true;
	if (kind === "extra" || kind === "extra-replace" || kind === "extra-move")
		return true;
	if (kind === "ghost_extra") return true;
	return false;
}

function _truthBgRectKindClass(kind) {
	if (!kind) return "";
	if (kind.indexOf("missing") === 0) return "is-missing";
	if (kind === "ghost_extra") return "is-ghost";
	return "is-extra";
}

function _truthBounds() {
	return {
		left: Infinity,
		right: -Infinity,
		top: Infinity,
		bottom: -Infinity,
	};
}

function _truthExpand(bounds, r) {
	if (r.left < bounds.left) bounds.left = r.left;
	if (r.right > bounds.right) bounds.right = r.right;
	if (r.top < bounds.top) bounds.top = r.top;
	if (r.bottom > bounds.bottom) bounds.bottom = r.bottom;
}

function _truthScanMarks(pane, side, positions, lineSet) {
	const bounds = _truthBounds();
	const sel = `.leo-mark[data-leo-side="${side}"]:not([data-leo-ghost-offset])`;
	for (const el of pane.querySelectorAll(sel)) {
		const p = parseInt(el.getAttribute("data-leo-pos"), 10);
		if (!positions.has(p)) continue;
		const r = el.getBoundingClientRect();
		if (r.width === 0 && r.height === 0) continue;
		_truthExpand(bounds, r);
		if (lineSet) {
			const lineEl = el.closest(".diff-line");
			if (lineEl) lineSet.add(lineEl);
		}
	}
	return bounds;
}

function _truthPaneRect(bounds, pane, pad) {
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

function _truthSelectionBoundingRect(side, file, tokens, marks, pad = 0) {
	const wrap = document.getElementById(`code-${side}`);
	if (!wrap) return null;
	let pane = null;
	for (const p of wrap.querySelectorAll(".code-pane")) {
		if (p.dataset.paneFile === file) {
			pane = p;
			break;
		}
	}
	if (!pane) return null;
	let bounds = _truthBounds();
	if (marks && marks.length) {
		const positions = new Set(marks.map((m) => m.start));
		bounds = _truthScanMarks(pane, side, positions, null);
	}
	if (!Number.isFinite(bounds.left) && tokens) {
		for (const t of tokens) {
			const bbox = _truthTokenBbox(side, file, t);
			if (!bbox) continue;
			_truthExpand(bounds, bbox);
		}
	}
	return _truthPaneRect(bounds, pane, pad);
}

function _truthCollectGroupRect(group, pad = 6) {
	const wrap = document.getElementById(`code-${group.side}`);
	if (!wrap) return null;
	let pane = null;
	for (const p of wrap.querySelectorAll(".code-pane")) {
		if (p.dataset.paneFile === group.file && p.classList.contains("active")) {
			pane = p;
			break;
		}
	}
	if (!pane) return null;
	const positions = new Set();
	for (const m of group.marks || []) positions.add(m.start);
	if (!positions.size) return null;
	const lineSet = new Set();
	const bounds = _truthScanMarks(pane, group.side, positions, lineSet);
	const rect = _truthPaneRect(bounds, pane, pad);
	if (!rect) return null;
	rect.lineCount = lineSet.size;
	return rect;
}

function _truthRefreshGhostPairs() {
	const wrapTeacher = document.getElementById("code-teacher");
	const wrapStudent = document.getElementById("code-student");
	if (wrapTeacher) {
		for (const el of wrapTeacher.querySelectorAll(".truth-ghost-paired")) {
			el.classList.remove("truth-ghost-paired");
		}
	}
	if (wrapStudent) {
		for (const el of wrapStudent.querySelectorAll(
			".truth-paired-ghost-extra",
		)) {
			el.classList.remove("truth-paired-ghost-extra");
		}
	}
	const t =
		(typeof _truthMarks === "function" ? _truthMarks() : null) ||
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
				const candidates = wrapTeacher.querySelectorAll(
					`.leo-mark[data-leo-side="teacher"][data-leo-ghost-offset]`,
				);
				for (const el of candidates) {
					const pane = el.closest(".code-pane");
					if (!pane || pane.dataset.paneFile !== pw.file) continue;
					const blobPos = parseInt(el.dataset.leoPos, 10);
					const offset = parseInt(el.dataset.leoGhostOffset, 10);
					if (!Number.isFinite(blobPos) || !Number.isFinite(offset))
						continue;
					if (
						blobPos + offset === pw.start &&
						el.dataset.leoToken === pw.token
					) {
						el.classList.add("truth-ghost-paired");
					}
				}
			}
			if (wrapStudent) {
				const studentEl = _truthFindLeoMarkEl("student", m.start, m.token);
				if (studentEl) studentEl.classList.add("truth-paired-ghost-extra");
			}
		}
	}
}

function _truthGroupTitleText(kind, count) {
	let label;
	if (kind === "missing" || kind === "missing-insert") label = "missing";
	else if (kind === "ghost_extra") label = "ghost";
	else label = "extra";
	const noun = count === 1 ? "token" : "tokens";
	return `${count} ${label} ${noun}`;
}

function _truthApplyGroupCountTitles(group, marks) {
	const title = _truthGroupTitleText(group.kind, marks.length);
	for (const mark of marks) {
		const el = _truthFindLeoMarkEl(group.side, mark.start, mark.token);
		if (el) el.setAttribute("title", title);
	}
}

function _truthRefreshOverlays() {
	const wrapTeacher = document.getElementById("code-teacher");
	const wrapStudent = document.getElementById("code-student");
	for (const wrap of [wrapTeacher, wrapStudent]) {
		if (!wrap) continue;
		for (const pane of wrap.querySelectorAll(".code-pane")) {
			const layers = _truthEnsurePaneOverlays(pane);
			if (layers) layers.bg.innerHTML = "";
		}
	}
	const groups = _truthGroupMarks();
	for (const g of groups) {
		if (!_truthGroupHasBox(g.kind)) continue;
		const marks = _truthFindMarks(g.side, g.file, g.lo, g.hi);
		if (marks.length <= 1) continue;
		const r = _truthCollectGroupRect(g);
		if (!r) continue;
		const layers = _truthEnsurePaneOverlays(r.pane);
		if (!layers) continue;
		const div = document.createElement("div");
		div.className = `truth-bg-rect ${_truthBgRectKindClass(g.kind)}`;
		div.dataset.groupKey = `${g.side}|${g.file}|${g.lo}|${g.hi}`;
		div.style.left = `${r.left}px`;
		div.style.top = `${r.top}px`;
		div.style.width = `${r.width}px`;
		div.style.height = `${r.height}px`;
		layers.bg.appendChild(div);
		_truthApplyGroupCountTitles(g, marks);
	}
	_truthRebuildGroupRectCache();
	if (_truthActiveGroupRange) {
		_truthActiveGroupRange.marks = _truthFindMarks(
			_truthActiveGroupRange.side,
			_truthActiveGroupRange.file,
			_truthActiveGroupRange.lo,
			_truthActiveGroupRange.hi,
		);
	}
	_truthRefreshHoverBorder();
	_truthRefreshActiveOverlay();
	_truthRefreshConnectorsForCurrent();
	_truthRefreshGhostPairs();
}

function _truthRefreshConnectorsForCurrent() {
	_truthPairConnectorItems = [];
	const seenPairs = new Set();
	const seenGroups = new Set();
	_truthCollectAlwaysOnConnectors(_truthPairConnectorItems, seenGroups);
	if (_truthSelectionRange) {
		_truthCollectConnectorsForRange(
			_truthSelectionRange,
			_truthPairConnectorItems,
			seenPairs,
			seenGroups,
		);
	}
	if (_truthHoverGroupRange) {
		_truthCollectConnectorsForRange(
			_truthHoverGroupRange,
			_truthPairConnectorItems,
			seenPairs,
			seenGroups,
		);
	}
	if (_truthActiveGhost) {
		const partner = _truthFindGhostPartner(_truthActiveGhost);
		if (partner) {
			const key = `ghost|${_truthActiveGhost.file}|${_truthActiveGhost.start}|${_truthActiveGhost.token}|${partner.file}|${partner.mark.start}`;
			if (!seenPairs.has(key)) {
				seenPairs.add(key);
				_truthPairConnectorItems.push({
					kind: "ghost-pair",
					studentMark: partner.mark,
					studentFile: partner.file,
					ghost: {
						file: _truthActiveGhost.file,
						start: _truthActiveGhost.start,
						end: _truthActiveGhost.end,
						token: _truthActiveGhost.token,
					},
				});
			}
		}
	}
	_truthRefreshPairConnectors();
}

function _truthCollectAlwaysOnConnectors(items, seenGroups) {
	for (const g of _truthGroupMarks()) {
		if (g.side === "teacher" && g.kind === "missing") {
			const key = `${g.side}|${g.file}|${g.lo}|${g.hi}`;
			if (seenGroups.has(key)) continue;
			seenGroups.add(key);
			items.push({ kind: "groupInsert", group: g });
		}
	}
}

let _truthHoverGroupKey = null;
let _truthHoverGroupRange = null;

function _truthClearGroupHover() {
	_truthHoverGroupKey = null;
	_truthHoverGroupRange = null;
	document.body.classList.remove("truth-group-hover-active");
	_truthRefreshHoverBorder();
	_truthRefreshConnectorsForCurrent();
	if (typeof _truthClearGhostHover === "function") _truthClearGhostHover();
}

function _truthRefreshHoverBorder() {
	for (const el of document.querySelectorAll(
		".leo-mark.is-hover-transparent",
	)) {
		el.classList.remove("is-hover-transparent");
	}
	if (!_truthHoverGroupRange) return;
	const { side, file, lo, hi } = _truthHoverGroupRange;
	const wrap = document.getElementById(`code-${side}`);
	if (!wrap) return;
	let pane = null;
	for (const p of wrap.querySelectorAll(".code-pane")) {
		if (p.dataset.paneFile === file) {
			pane = p;
			break;
		}
	}
	if (!pane) return;
	const sel = `.leo-mark[data-leo-side="${side}"]:not([data-leo-ghost-offset])`;
	for (const el of pane.querySelectorAll(sel)) {
		const p = parseInt(el.getAttribute("data-leo-pos"), 10);
		if (!Number.isFinite(p) || p < lo || p >= hi) continue;
		el.classList.add("is-hover-transparent");
	}
}

let _truthActiveGroupRange = null;
let _truthActiveGhost = null;
let _truthSelectionRange = null;

function _truthActiveRectBg(marks) {
	if (!marks || !marks.length) return "rgba(0, 0, 0, 0.1)";
	const allMissing = marks.every((m) => m.label === "missing");
	const allExtra = marks.every((m) => m.label === "extra");
	const allGhost = marks.every((m) => m.label === "ghost_extra");
	if (allMissing) return "rgba(0, 0, 0, 0.1)";
	if (allGhost) return "rgba(0, 0, 0, 0.1)";
	if (allExtra) {
		const pairedAll = marks.every((m) => m.paired_with);
		if (!pairedAll) return "rgba(0, 0, 0, 0.1)";
		const pw = marks[0].paired_with;
		const tFile = pw && pw.file;
		const tPos = pw && typeof pw.start === "number" ? pw.start : 0;
		const tText =
			tFile && typeof _teacherFiles !== "undefined" && _teacherFiles[tFile]
				? _teacherFiles[tFile].replace(/\r\n/g, "\n")
				: "";
		const c =
			typeof _diffMissingColorAt === "function"
				? _diffMissingColorAt(tFile, tText, tPos)
				: typeof _diffMissingColorFor === "function"
					? _diffMissingColorFor(tFile)
					: null;
		if (c && typeof _hexToRgba === "function") return _hexToRgba(c, 0.22);
		return c || "rgba(0, 0, 0, 0.1)";
	}
	return null;
}

function _truthDrawActiveRect(range) {
	const tokens =
		!range.marks || !range.marks.length
			? _truthTokensInRange(range.side, range.file, range.lo, range.hi)
			: null;
	const r =
		range.marks && range.marks.length
			? _truthCollectGroupRect(range, 0)
			: _truthSelectionBoundingRect(range.side, range.file, tokens, null, 0);
	if (!r) return;
	const layers = _truthEnsurePaneOverlays(r.pane);
	if (!layers) return;
	const div = document.createElement("div");
	div.className = "truth-active-rect";
	const bg = _truthActiveRectBg(range.marks);
	if (bg) div.style.backgroundColor = bg;
	div.style.left = `${r.left}px`;
	div.style.top = `${r.top}px`;
	div.style.width = `${r.width}px`;
	div.style.height = `${r.height}px`;
	layers.bg.appendChild(div);
}

function _truthRefreshActiveOverlay() {
	for (const layer of document.querySelectorAll(".truth-bg-layer")) {
		for (const el of layer.querySelectorAll(".truth-active-rect")) {
			el.remove();
		}
	}
	if (_truthActiveGhost) {
		_truthDrawGhostActiveRect(_truthActiveGhost);
		const partner = _truthFindGhostPartner(_truthActiveGhost);
		if (partner) {
			_truthDrawActiveRect({
				side: "student",
				file: partner.file,
				lo: partner.mark.start,
				hi: partner.mark.end,
				marks: [partner.mark],
			});
		}
		return;
	}
	if (!_truthActiveGroupRange) return;
	_truthDrawActiveRect(_truthActiveGroupRange);

	const otherSide =
		_truthActiveGroupRange.side === "teacher" ? "student" : "teacher";
	const partnerRanges = new Map();
	const ghostPartners = [];
	for (const m of _truthActiveGroupRange.marks || []) {
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
		const marks = _truthFindMarks(otherSide, range.file, range.lo, range.hi);
		_truthDrawActiveRect({
			side: otherSide,
			file: range.file,
			lo: range.lo,
			hi: range.hi,
			marks,
		});
	}
	for (const ghost of ghostPartners) {
		_truthDrawGhostActiveRect(ghost);
	}
}

function _truthDrawGhostActiveRect(ghost) {
	const el = _truthFindGhostElement(ghost);
	if (!el) return;
	const pane = el.closest(".code-pane");
	if (!pane) return;
	const layers = _truthEnsurePaneOverlays(pane);
	if (!layers) return;
	const r = el.getBoundingClientRect();
	const paneRect = pane.getBoundingClientRect();
	const div = document.createElement("div");
	div.className = "truth-active-rect is-dark-gray";
	div.style.left = `${r.left - paneRect.left}px`;
	div.style.top = `${r.top - paneRect.top}px`;
	div.style.width = `${r.width}px`;
	div.style.height = `${r.height}px`;
	layers.bg.appendChild(div);
}
