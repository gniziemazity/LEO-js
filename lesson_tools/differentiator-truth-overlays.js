"use strict";

// Truth-mode overlays: bg/active/hover rects, group-rect cache, group hover handler,
// click highlights, and SVG pair connectors.

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
	if (kind === "extra" || kind === "extra-replace") return true;
	if (kind === "ghost_extra") return true;
	return false;
}

function _truthBgRectKindClass(kind) {
	if (!kind) return "";
	if (kind.indexOf("missing") === 0) return "is-missing";
	if (kind === "ghost_extra") return "is-ghost";
	return "is-extra";
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
	let left = Infinity,
		right = -Infinity,
		top = Infinity,
		bottom = -Infinity;
	if (marks && marks.length) {
		const positions = new Set(marks.map((m) => m.start));
		const sel = `.leo-mark[data-leo-side="${side}"]:not([data-leo-ghost-offset])`;
		for (const el of pane.querySelectorAll(sel)) {
			const p = parseInt(el.getAttribute("data-leo-pos"), 10);
			if (!positions.has(p)) continue;
			const r = el.getBoundingClientRect();
			if (r.width === 0 && r.height === 0) continue;
			if (r.left < left) left = r.left;
			if (r.right > right) right = r.right;
			if (r.top < top) top = r.top;
			if (r.bottom > bottom) bottom = r.bottom;
		}
	}
	if (!Number.isFinite(left) && tokens) {
		for (const t of tokens) {
			const bbox = _truthTokenBbox(side, file, t);
			if (!bbox) continue;
			if (bbox.left < left) left = bbox.left;
			if (bbox.right > right) right = bbox.right;
			if (bbox.top < top) top = bbox.top;
			if (bbox.bottom > bottom) bottom = bbox.bottom;
		}
	}
	if (!Number.isFinite(left)) return null;
	const paneRect = pane.getBoundingClientRect();
	return {
		pane,
		left: left - paneRect.left - pad,
		top: top - paneRect.top - pad,
		width: right - left + 2 * pad,
		height: bottom - top + 2 * pad,
	};
}

function _truthCollectGroupRect(group, pad = 6) {
	const wrap = document.getElementById(`code-${group.side}`);
	if (!wrap) return null;
	const panes = wrap.querySelectorAll(".code-pane");
	let pane = null;
	for (const p of panes) {
		if (p.dataset.paneFile === group.file && p.classList.contains("active")) {
			pane = p;
			break;
		}
	}
	if (!pane) return null;
	const positions = new Set();
	for (const m of group.marks || []) positions.add(m.start);
	if (!positions.size) return null;
	const sel = `.leo-mark[data-leo-side="${group.side}"]:not([data-leo-ghost-offset])`;
	let left = Infinity,
		right = -Infinity,
		top = Infinity,
		bottom = -Infinity;
	const lineSet = new Set();
	for (const el of pane.querySelectorAll(sel)) {
		const p = parseInt(el.getAttribute("data-leo-pos"), 10);
		if (!positions.has(p)) continue;
		const r = el.getBoundingClientRect();
		if (r.width === 0 && r.height === 0) continue;
		if (r.left < left) left = r.left;
		if (r.right > right) right = r.right;
		if (r.top < top) top = r.top;
		if (r.bottom > bottom) bottom = r.bottom;
		const lineEl = el.closest(".diff-line");
		if (lineEl) lineSet.add(lineEl);
	}
	if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
	const paneRect = pane.getBoundingClientRect();
	return {
		pane,
		left: left - paneRect.left - pad,
		top: top - paneRect.top - pad,
		width: right - left + 2 * pad,
		height: bottom - top + 2 * pad,
		lineCount: lineSet.size,
	};
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
		if (g.side !== "teacher") continue;
		if (g.kind !== "missing") continue;
		const key = `${g.side}|${g.file}|${g.lo}|${g.hi}`;
		if (seenGroups.has(key)) continue;
		seenGroups.add(key);
		items.push({ kind: "groupInsert", group: g });
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
	const color = _truthSelectionColor(range.marks);
	if (color === "red") div.classList.add("is-red");
	else if (color === "blue") div.classList.add("is-blue");
	else if (!range.marks || !range.marks.length) div.classList.add("is-gray");
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

function _truthFindGroupRange(side, file, pos) {
	const groups = _truthGroupMarks();
	for (const g of groups) {
		if (g.side !== side || g.file !== file) continue;
		if (g.lo <= pos && pos < g.hi) return { lo: g.lo, hi: g.hi };
	}
	if (side === "teacher") {
		for (const m of _truthFileMarks(side, file)) {
			if (
				m.label === "missing" &&
				m.paired_with &&
				m.start <= pos &&
				pos < m.end
			) {
				return { lo: m.start, hi: m.end };
			}
		}
	}
	return null;
}

function _truthHoverableEntries() {
	const out = [];
	for (const g of _truthGroupMarks()) {
		if (_truthGroupHasBox(g.kind)) out.push(g);
	}
	const t = _truthMarks();
	if (t) {
		const tFiles = t.teacher_files || {};
		for (const [file, marks] of Object.entries(tFiles)) {
			for (const mark of marks || []) {
				if (mark.label !== "missing" || !mark.paired_with) continue;
				out.push({
					side: "teacher",
					file,
					lo: mark.start,
					hi: mark.end,
					kind: "missing-paired",
					marks: [mark],
				});
			}
		}
	}
	return out;
}

const _truthGroupRectCache = [];

function _truthRebuildGroupRectCache() {
	_truthGroupRectCache.length = 0;
	for (const entry of _truthHoverableEntries()) {
		const r = _truthCollectGroupRect(entry);
		if (r) _truthGroupRectCache.push({ entry, r });
	}
}

function _truthGroupAtPoint(x, y) {
	const paneRectByEl = new Map();
	for (const { entry, r } of _truthGroupRectCache) {
		let paneRect = paneRectByEl.get(r.pane);
		if (!paneRect) {
			paneRect = r.pane.getBoundingClientRect();
			paneRectByEl.set(r.pane, paneRect);
		}
		const left = paneRect.left + r.left;
		const top = paneRect.top + r.top;
		if (x >= left && x < left + r.width && y >= top && y < top + r.height) {
			return entry;
		}
	}
	return null;
}

function _truthInsertAnchorAtPoint(x, y) {
	const el = document.elementFromPoint(x, y);
	if (!el || !el.closest) return null;
	const anchor = el.closest(".insert-anchor");
	if (!anchor) return null;
	const teacherPos = parseInt(
		anchor.getAttribute("data-insert-anchor-teacher-pos"),
		10,
	);
	const teacherFile = anchor.getAttribute("data-insert-anchor-teacher-file");
	if (!Number.isFinite(teacherPos) || !teacherFile) return null;
	for (const g of _truthGroupMarks()) {
		if (g.side !== "teacher" || g.file !== teacherFile) continue;
		if (g.lo <= teacherPos && teacherPos < g.hi) {
			return {
				side: "teacher",
				file: teacherFile,
				lo: g.lo,
				hi: g.hi,
				marks: g.marks,
				kind: g.kind,
			};
		}
	}
	const mark = _truthFileMarks("teacher", teacherFile).find(
		(m) => m.start === teacherPos && m.label === "missing",
	);
	if (!mark) return null;
	return {
		side: "teacher",
		file: teacherFile,
		lo: mark.start,
		hi: mark.end,
		marks: [mark],
		kind: "missing-insert",
	};
}

function _truthOnGroupHover(ev) {
	if (!_truthEditMode) return;
	if (_truthPending) return;
	if (_truthIsBackgroundClick(ev.target)) {
		if (_truthHoverGroupKey) _truthClearGroupHover();
		_truthClearTokenHover();
		return;
	}
	const ghostInfo = _truthGhostFromTarget(ev.target);
	if (ghostInfo) {
		const partner = _truthFindGhostPartner(ghostInfo);
		if (partner) {
			const key = `ghost|${ghostInfo.file}|${ghostInfo.start}|${ghostInfo.token}`;
			document.body.classList.add("truth-group-hover-active");
			if (_truthHoverGroupKey !== key) {
				_truthHoverGroupKey = key;
				_truthHoverGroupRange = {
					side: "student",
					file: partner.file,
					lo: partner.mark.start,
					hi: partner.mark.end,
					marks: [partner.mark],
				};
				_truthClearTokenHover();
				_truthRefreshHoverBorder();
				_truthRefreshConnectorsForCurrent();
			}
			return;
		}
		if (_truthHoverGroupKey) _truthClearGroupHover();
		const ghostKey = `ghost|${ghostInfo.file}|${ghostInfo.start}|${ghostInfo.token}`;
		const oldKey = _truthHoverGhost
			? `ghost|${_truthHoverGhost.file}|${_truthHoverGhost.start}|${_truthHoverGhost.token}`
			: null;
		if (oldKey !== ghostKey) {
			_truthClearTokenHover();
			_truthHoverGhost = ghostInfo;
			_truthRefreshGhostHoverOverlay();
		}
		return;
	}
	if (_truthHoverGhost) _truthClearGhostHover();
	const g =
		_truthGroupAtPoint(ev.clientX, ev.clientY) ||
		_truthInsertAnchorAtPoint(ev.clientX, ev.clientY);
	if (g) {
		const key = `${g.side}|${g.file}|${g.lo}|${g.hi}`;
		document.body.classList.add("truth-group-hover-active");
		if (_truthHoverGroupKey === key) {
			_truthClearTokenHover();
			return;
		}
		_truthHoverGroupKey = key;
		_truthHoverGroupRange = {
			side: g.side,
			file: g.file,
			lo: g.lo,
			hi: g.hi,
			marks: g.marks,
		};
		_truthClearTokenHover();
		_truthRefreshHoverBorder();
		_truthRefreshConnectorsForCurrent();
		return;
	}
	if (_truthHoverGroupKey) _truthClearGroupHover();

	const info = _truthClickPosition(ev);
	if (info) {
		const tok = _truthTokenAtPos(info.side, info.file, info.pos);
		if (tok && !_truthExistingMarkAtPos(info.side, info.file, tok.start)) {
			const newKey = `${info.side}|${info.file}|${tok.start}`;
			const oldKey = _truthHoverToken
				? `${_truthHoverToken.side}|${_truthHoverToken.file}|${_truthHoverToken.tok.start}`
				: null;
			if (oldKey !== newKey) {
				_truthHoverToken = { side: info.side, file: info.file, tok };
				_truthRefreshTokenHoverOverlay();
			}
			return;
		}
	}
	_truthClearTokenHover();
}

let _truthHoverToken = null;
let _truthHoverGhost = null;

function _truthRefreshGhostHoverOverlay() {
	for (const layer of document.querySelectorAll(".truth-bg-layer")) {
		for (const el of layer.querySelectorAll(".truth-ghost-hover-rect")) {
			el.remove();
		}
	}
	if (!_truthHoverGhost) {
		if (!_truthHoverToken)
			document.body.classList.remove("truth-token-hover-active");
		return;
	}
	document.body.classList.add("truth-token-hover-active");
	const el =
		_truthHoverGhost.el ||
		_truthFindGhostElByPos(
			_truthHoverGhost.file,
			_truthHoverGhost.start,
			_truthHoverGhost.token,
		);
	if (!el) return;
	const r = el.getBoundingClientRect();
	const pane = el.closest(".code-pane");
	if (!pane) return;
	const paneRect = pane.getBoundingClientRect();
	const layers = _truthEnsurePaneOverlays(pane);
	if (!layers) return;
	const div = document.createElement("div");
	div.className = "truth-hover-rect truth-ghost-hover-rect";
	div.style.left = `${r.left - paneRect.left}px`;
	div.style.top = `${r.top - paneRect.top}px`;
	div.style.width = `${r.width}px`;
	div.style.height = `${r.height}px`;
	layers.bg.appendChild(div);
}

function _truthClearGhostHover() {
	if (!_truthHoverGhost) return;
	_truthHoverGhost = null;
	_truthRefreshGhostHoverOverlay();
}

function _truthRefreshTokenHoverOverlay() {
	for (const layer of document.querySelectorAll(".truth-bg-layer")) {
		for (const el of layer.querySelectorAll(".truth-token-hover-rect")) {
			el.remove();
		}
	}
	if (!_truthHoverToken) {
		if (!_truthHoverGhost)
			document.body.classList.remove("truth-token-hover-active");
		return;
	}
	document.body.classList.add("truth-token-hover-active");
	const { side, file, tok } = _truthHoverToken;
	const r = _truthSelectionBoundingRect(side, file, [tok], null, 0);
	if (!r) return;
	const layers = _truthEnsurePaneOverlays(r.pane);
	if (!layers) return;
	const div = document.createElement("div");
	div.className = "truth-hover-rect truth-token-hover-rect";
	div.style.left = `${r.left}px`;
	div.style.top = `${r.top}px`;
	div.style.width = `${r.width}px`;
	div.style.height = `${r.height}px`;
	layers.bg.appendChild(div);
}

function _truthClearTokenHover() {
	if (!_truthHoverToken) return;
	_truthHoverToken = null;
	_truthRefreshTokenHoverOverlay();
}

let _truthRefreshScheduled = false;
function _truthScheduleOverlayRefresh() {
	if (_truthRefreshScheduled) return;
	_truthRefreshScheduled = true;
	requestAnimationFrame(() => {
		_truthRefreshScheduled = false;
		if (!_truthEditMode) return;
		_truthRefreshOverlays();
		_truthRefreshPairConnectors();
	});
}

function _truthOnScroll() {
	_truthRefreshPairConnectors();
}

function _truthOnResize() {
	_truthScheduleOverlayRefresh();
}

function _truthApplyPartnerAndAnchorHighlights(el) {
	if (el.hasAttribute("data-swap-pos")) _applySwapPartnerHighlight(el);
	if (el.hasAttribute("data-insert-pos")) _applyInsertAnchorHighlight(el);
}

function _truthApplyClickHighlights(side, file, lo, hi) {
	_clearLeoHighlights();
	_truthActiveGroupRange = null;
	_truthActiveGhost = null;
	_truthSelectionRange = { side, file, lo, hi };
	const wrap = document.getElementById(`code-${side}`);
	if (!wrap) {
		_truthRefreshActiveOverlay();
		return;
	}
	const sel = `.leo-mark[data-leo-side="${side}"]:not([data-leo-ghost-offset])`;
	const els = [];
	for (const el of wrap.querySelectorAll(sel)) {
		const p = parseInt(el.getAttribute("data-leo-pos"), 10);
		if (Number.isFinite(p) && p >= lo && p < hi) els.push(el);
	}
	const marks = _truthFindMarks(side, file, lo, hi);
	_truthActiveGroupRange = { side, file, lo, hi, marks };
	for (const el of els) _truthApplyPartnerAndAnchorHighlights(el);
	if (side === "teacher") {
		const studentWrap = document.getElementById("code-student");
		if (studentWrap) {
			for (const m of marks) {
				if (m.label !== "missing" || !m.insert_at || m.paired_with)
					continue;
				const aSel = `.insert-anchor[data-insert-anchor-teacher-pos="${m.start}"]`;
				for (const a of studentWrap.querySelectorAll(aSel)) {
					a.classList.add("insert-active");
					_insertHighlighted.push(a);
				}
			}
		}
	}
	_truthRefreshActiveOverlay();
	_truthRebuildPairConnectorsForSelection(side, file, lo, hi);
	_truthRefreshPairConnectors();
}

let _truthPairConnectorSvg = null;
let _truthPairConnectorItems = [];

function _truthEnsurePairConnectorSvg() {
	if (_truthPairConnectorSvg) return _truthPairConnectorSvg;
	const svgNS = "http://www.w3.org/2000/svg";
	const svg = document.createElementNS(svgNS, "svg");
	svg.id = "truth-pair-connector-svg";
	svg.setAttribute("width", "100%");
	svg.setAttribute("height", "100%");
	document.body.appendChild(svg);
	_truthPairConnectorSvg = svg;
	return svg;
}

function _truthClearPairConnectors() {
	_truthPairConnectorItems = [];
	if (_truthPairConnectorSvg) _truthPairConnectorSvg.innerHTML = "";
}

function _truthFindPartnerEl(side, mark) {
	if (!mark || !mark.paired_with) return null;
	const partnerSide = side === "teacher" ? "student" : "teacher";
	return _truthFindLeoMarkEl(
		partnerSide,
		mark.paired_with.start,
		mark.paired_with.token,
		mark.paired_with.file,
	);
}

function _truthFindGhostElement(ghostRef) {
	const wrap = document.getElementById("code-teacher");
	if (!wrap || !ghostRef) return null;
	const candidates = wrap.querySelectorAll(
		`.code-pane.active .leo-mark[data-leo-side="teacher"][data-leo-ghost-offset]`,
	);
	for (const el of candidates) {
		const pane = el.closest(".code-pane");
		if (!pane || pane.dataset.paneFile !== ghostRef.file) continue;
		const blobPos = parseInt(el.dataset.leoPos, 10);
		const offset = parseInt(el.dataset.leoGhostOffset, 10);
		if (!Number.isFinite(blobPos) || !Number.isFinite(offset)) continue;
		if (
			blobPos + offset === ghostRef.start &&
			el.dataset.leoToken === ghostRef.token
		) {
			return el;
		}
	}
	return null;
}

function _truthFindInsertAnchorEl(teacherMark) {
	if (!teacherMark.insert_at) return null;
	const wrap = document.getElementById(`code-student`);
	if (!wrap) return null;
	const file = teacherMark.insert_at.file;
	const paneSel = file
		? `.code-pane[data-pane-file="${CSS.escape(file)}"].active`
		: `.code-pane.active`;
	const sel = `${paneSel} .insert-anchor[data-insert-anchor-teacher-pos="${teacherMark.start}"]`;
	return wrap.querySelector(sel);
}

function _truthCollectConnectorsForRange(range, items, seenPairs, seenGroups) {
	const marks = _truthFindMarks(range.side, range.file, range.lo, range.hi);
	const ghostPairsHere = [];
	for (const mark of marks) {
		if (!mark.paired_with) continue;
		if (mark.paired_with.ghost && mark.label === "ghost_extra") {
			ghostPairsHere.push({
				studentMark: mark,
				studentFile: range.file,
				ghost: mark.paired_with,
			});
			continue;
		}
		let teacherFile, teacherStart, teacherToken;
		if (mark.label === "missing") {
			teacherFile = range.file;
			teacherStart = mark.start;
			teacherToken = mark.token;
		} else {
			teacherFile = mark.paired_with.file;
			teacherStart = mark.paired_with.start;
			teacherToken = mark.paired_with.token;
		}
		const key = `${teacherFile}|${teacherStart}|${teacherToken}`;
		if (seenPairs.has(key)) continue;
		seenPairs.add(key);
		const teacherMark = _truthFileMarks("teacher", teacherFile).find(
			(m) =>
				m.start === teacherStart &&
				m.token === teacherToken &&
				m.label === "missing",
		);
		if (teacherMark) {
			items.push({
				kind: "pair",
				side: "teacher",
				file: teacherFile,
				mark: teacherMark,
			});
		}
	}

	if (range.side === "teacher") {
		const groups = _truthGroupMarks();
		for (const g of groups) {
			if (g.side !== "teacher" || g.file !== range.file) continue;
			if (g.kind !== "missing-insert" && g.kind !== "missing") continue;
			if (!g.marks.some((m) => m.start < range.hi && m.end > range.lo))
				continue;
			const key = `${g.side}|${g.file}|${g.lo}|${g.hi}`;
			if (seenGroups.has(key)) continue;
			seenGroups.add(key);
			items.push({ kind: "groupInsert", group: g });
		}
	}

	if (ghostPairsHere.length === 1) {
		const p = ghostPairsHere[0];
		const key = `ghost|${p.ghost.file}|${p.ghost.start}|${p.ghost.token}|${p.studentFile}|${p.studentMark.start}`;
		if (!seenPairs.has(key)) {
			seenPairs.add(key);
			items.push({ kind: "ghost-pair", ...p });
		}
	} else if (ghostPairsHere.length > 1) {
		const sortedByGhost = ghostPairsHere
			.slice()
			.sort((a, b) => b.ghost.start - a.ghost.start);
		const sortedByStudent = ghostPairsHere
			.slice()
			.sort((a, b) => a.studentMark.start - b.studentMark.start);
		const rightmostGhost = sortedByGhost[0].ghost;
		const leftmostStudent = sortedByStudent[0];
		const key = `ghost-group|${rightmostGhost.file}|${rightmostGhost.start}|${leftmostStudent.studentFile}|${leftmostStudent.studentMark.start}`;
		if (!seenPairs.has(key)) {
			seenPairs.add(key);
			items.push({
				kind: "ghost-pair-group",
				ghost: rightmostGhost,
				studentMark: leftmostStudent.studentMark,
				studentFile: leftmostStudent.studentFile,
			});
		}
		for (const p of ghostPairsHere) {
			const k = `ghost|${p.ghost.file}|${p.ghost.start}|${p.ghost.token}|${p.studentFile}|${p.studentMark.start}`;
			seenPairs.add(k);
		}
	}
}

function _truthRebuildPairConnectorsForSelection(side, file, lo, hi) {
	_truthPairConnectorItems = [];
	const seenPairs = new Set();
	const seenGroups = new Set();
	_truthCollectAlwaysOnConnectors(_truthPairConnectorItems, seenGroups);
	_truthCollectConnectorsForRange(
		{ side, file, lo, hi },
		_truthPairConnectorItems,
		seenPairs,
		seenGroups,
	);
}

const _SVG_NS = "http://www.w3.org/2000/svg";
const _TRUTH_LINE_GAP = 0.5;

function _truthSvgLine(svg, x1, y1, x2, y2, color) {
	const ln = document.createElementNS(_SVG_NS, "line");
	ln.setAttribute("x1", x1);
	ln.setAttribute("y1", y1);
	ln.setAttribute("x2", x2);
	ln.setAttribute("y2", y2);
	ln.setAttribute("stroke", color);
	ln.setAttribute("stroke-width", "1");
	ln.setAttribute("stroke-linecap", "round");
	svg.appendChild(ln);
}

function _truthSvgX(svg, cx, cy, size, color) {
	const half = size / 2;
	for (const [x1, y1, x2, y2] of [
		[cx - half, cy - half, cx + half, cy + half],
		[cx + half, cy - half, cx - half, cy + half],
	]) {
		const ln = document.createElementNS(_SVG_NS, "line");
		ln.setAttribute("x1", x1);
		ln.setAttribute("y1", y1);
		ln.setAttribute("x2", x2);
		ln.setAttribute("y2", y2);
		ln.setAttribute("stroke", color);
		ln.setAttribute("stroke-width", "1.5");
		ln.setAttribute("stroke-linecap", "round");
		svg.appendChild(ln);
	}
}

const _TRUTH_INSERT_ANCHOR_LIFT = 2.25;

function _truthElBelowLineY(el) {
	if (el && el.classList && el.classList.contains("insert-anchor")) {
		const line = el.closest(".diff-line");
		if (line) {
			const r = el.getBoundingClientRect();
			const lr = line.getBoundingClientRect();
			const lh = parseFloat(getComputedStyle(line).lineHeight);
			if (Number.isFinite(lh) && lh > 0) {
				const center = r.top + r.height / 2;
				const lineIdx = Math.max(0, Math.floor((center - lr.top) / lh));
				return (
					lr.top +
					(lineIdx + 1) * lh +
					_TRUTH_LINE_GAP -
					_TRUTH_INSERT_ANCHOR_LIFT
				);
			}
		}
	}
	return el.getBoundingClientRect().bottom + _TRUTH_LINE_GAP;
}

function _truthRefreshPairConnectors() {
	const svg = _truthEnsurePairConnectorSvg();
	svg.innerHTML = "";
	if (!_truthPairConnectorItems.length) return;

	const teacherPanel = document.getElementById("panel-teacher");
	const studentPanel = document.getElementById("panel-student");
	if (!teacherPanel || !studentPanel) return;
	const tpRect = teacherPanel.getBoundingClientRect();
	const spRect = studentPanel.getBoundingClientRect();
	const midX = (tpRect.right + spRect.left) / 2;

	const missingColor = _cssVar("--clr-mark-missing");
	const extraColor = _cssVar("--clr-mark-extra");
	const blackColor = _cssVar("--clr-black");
	const paleRedColor = _cssVar("--clr-pale-red");
	const paleBlueColor = _cssVar("--clr-mark-ghost");

	for (const item of _truthPairConnectorItems) {
		if (item.kind === "ghost-pair" || item.kind === "ghost-pair-group") {
			const teacherEl = _truthFindGhostElement(item.ghost);
			const studentEl = _truthFindLeoMarkEl(
				"student",
				item.studentMark.start,
				item.studentMark.token,
				item.studentFile,
			);
			if (!teacherEl || !studentEl) continue;
			const tRect = teacherEl.getBoundingClientRect();
			const sRect = studentEl.getBoundingClientRect();
			const tY = _truthElBelowLineY(teacherEl);
			const sY = _truthElBelowLineY(studentEl);
			_truthSvgLine(svg, tRect.right, tY, midX, tY, paleBlueColor);
			_truthSvgLine(svg, midX, tY, midX, sY, blackColor);
			_truthSvgLine(svg, midX, sY, sRect.left, sY, paleRedColor);
		} else if (item.kind === "pair") {
			const srcEl = _truthFindMarkEl(item.side, item.mark, item.file);
			const partnerEl = _truthFindPartnerEl(item.side, item.mark);
			if (!srcEl || !partnerEl) continue;

			let teacherEl, studentEl;
			if (item.side === "teacher") {
				teacherEl = srcEl;
				studentEl = partnerEl;
			} else {
				teacherEl = partnerEl;
				studentEl = srcEl;
			}
			const tRect = teacherEl.getBoundingClientRect();
			const sRect = studentEl.getBoundingClientRect();
			const tY = _truthElBelowLineY(teacherEl);
			const sY = _truthElBelowLineY(studentEl);

			_truthSvgLine(svg, tRect.right, tY, midX, tY, extraColor);
			_truthSvgLine(svg, midX, tY, midX, sY, blackColor);
			_truthSvgLine(svg, midX, sY, sRect.left, sY, missingColor);
		} else if (item.kind === "groupInsert") {
			const g = item.group;

			let anchorEl = null;
			if (g.kind === "missing-insert") {
				const firstMark = g.marks[0];
				if (firstMark) anchorEl = _truthFindInsertAnchorEl(firstMark);
			}

			if (g.marks.length === 1) {
				const teacherEl = _truthFindMarkEl("teacher", g.marks[0], g.file);
				if (!teacherEl) continue;
				const tRect = teacherEl.getBoundingClientRect();
				const startX = tRect.right;
				const startY = _truthElBelowLineY(teacherEl);
				if (anchorEl) {
					const aRect = anchorEl.getBoundingClientRect();
					const aY = _truthElBelowLineY(anchorEl);
					const aX = aRect.left + aRect.width / 2;
					_truthSvgLine(svg, startX, startY, midX, startY, missingColor);
					_truthSvgLine(svg, midX, startY, midX, aY, blackColor);
					_truthSvgLine(svg, midX, aY, aX, aY, missingColor);
				} else {
					_truthSvgLine(svg, startX, startY, midX, startY, missingColor);
					_truthSvgX(svg, midX, startY, 10, missingColor);
				}
				continue;
			}

			const r = _truthCollectGroupRect(g);
			if (!r) continue;
			const paneRect = r.pane.getBoundingClientRect();
			const startX = paneRect.left + r.left + r.width;
			const boxTop = paneRect.top + r.top;
			const boxBottom = boxTop + r.height;

			if (anchorEl) {
				const aRect = anchorEl.getBoundingClientRect();
				const aY = _truthElBelowLineY(anchorEl);
				const aX = aRect.left + aRect.width / 2;
				const startY = Math.max(boxTop, Math.min(boxBottom, aY));
				_truthSvgLine(svg, startX, startY, midX, startY, missingColor);
				_truthSvgLine(svg, midX, startY, midX, aY, blackColor);
				_truthSvgLine(svg, midX, aY, aX, aY, missingColor);
			} else {
				const startY = (boxTop + boxBottom) / 2;
				_truthSvgLine(svg, startX, startY, midX, startY, missingColor);
				_truthSvgX(svg, midX, startY, 10, missingColor);
			}
		}
	}
}
