"use strict";

function _curatedFindGroupRange(side, file, pos) {
	const groups = _curatedGroupMarks();
	for (const g of groups) {
		if (g.side !== side || g.file !== file) continue;
		if (g.lo <= pos && pos < g.hi) return { lo: g.lo, hi: g.hi };
	}
	if (side === "teacher") {
		for (const m of _curatedFileMarks(side, file)) {
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

function _curatedHoverableEntries() {
	const out = [];
	for (const g of _curatedGroupMarks()) {
		if (_curatedGroupHasBox(g.kind)) out.push(g);
	}
	const t = _curatedMarks();
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

const _curatedGroupRectCache = [];

function _curatedRebuildGroupRectCache() {
	_curatedGroupRectCache.length = 0;
	for (const entry of _curatedHoverableEntries()) {
		const r = _curatedCollectGroupRect(entry);
		if (r) _curatedGroupRectCache.push({ entry, r });
	}
}

function _curatedGroupAtPoint(x, y) {
	const paneRectByEl = new Map();
	for (const { entry, r } of _curatedGroupRectCache) {
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

function _curatedAnchorRange(anchorEl) {
	if (!anchorEl) return null;
	const moveSourcePosStr = anchorEl.getAttribute(
		"data-insert-anchor-move-source-pos",
	);
	if (moveSourcePosStr != null) {
		const sFile = anchorEl.getAttribute(
			"data-insert-anchor-move-source-file",
		);
		const sPos = parseInt(moveSourcePosStr, 10);
		if (!sFile || !Number.isFinite(sPos)) return null;
		for (const g of _curatedGroupMarks()) {
			if (g.side !== "student" || g.file !== sFile) continue;
			if (g.kind !== "extra-move") continue;
			if (g.lo <= sPos && sPos < g.hi) {
				return {
					side: "student",
					file: sFile,
					lo: g.lo,
					hi: g.hi,
					marks: g.marks,
					kind: g.kind,
				};
			}
		}
		const mark = _curatedFileMarks("student", sFile).find(
			(m) => m.label === "extra" && m.start === sPos && m.move_to,
		);
		if (!mark) return null;
		return {
			side: "student",
			file: sFile,
			lo: mark.start,
			hi: mark.end,
			marks: [mark],
			kind: "extra-move",
		};
	}
	const teacherPos = parseInt(
		anchorEl.getAttribute("data-insert-anchor-teacher-pos"),
		10,
	);
	const teacherFile = anchorEl.getAttribute("data-insert-anchor-teacher-file");
	if (!Number.isFinite(teacherPos) || !teacherFile) return null;
	for (const g of _curatedGroupMarks()) {
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
	const mark = _curatedFileMarks("teacher", teacherFile).find(
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

function _curatedInsertAnchorAtPoint(x, y) {
	const el = document.elementFromPoint(x, y);
	if (!el || !el.closest) return null;
	return _curatedAnchorRange(el.closest(".insert-anchor"));
}

function _curatedOnGroupHover(ev) {
	if (!_curatedEditMode) return;
	if (_curatedPending) return;
	if (_curatedIsBackgroundClick(ev.target)) {
		if (_curatedHoverGroupKey) _curatedClearGroupHover();
		_curatedClearTokenHover();
		return;
	}
	const ghostInfo = _curatedGhostFromTarget(ev.target);
	if (ghostInfo) {
		const partner = _curatedFindGhostPartner(ghostInfo);
		if (partner) {
			const key = `ghost|${ghostInfo.file}|${ghostInfo.start}|${ghostInfo.token}`;
			document.body.classList.add("curated-group-hover-active");
			if (_curatedHoverGroupKey !== key) {
				_curatedHoverGroupKey = key;
				_curatedHoverGroupRange = {
					side: "student",
					file: partner.file,
					lo: partner.mark.start,
					hi: partner.mark.end,
					marks: [partner.mark],
				};
				_curatedClearTokenHover();
				_curatedRefreshHoverBorder();
				_curatedRefreshConnectorsForCurrent();
			}
			return;
		}
		if (_curatedHoverGroupKey) _curatedClearGroupHover();
		const ghostKey = `ghost|${ghostInfo.file}|${ghostInfo.start}|${ghostInfo.token}`;
		const oldKey = _curatedHoverGhost
			? `ghost|${_curatedHoverGhost.file}|${_curatedHoverGhost.start}|${_curatedHoverGhost.token}`
			: null;
		if (oldKey !== ghostKey) {
			_curatedClearTokenHover();
			_curatedHoverGhost = ghostInfo;
			_curatedRefreshGhostHoverOverlay();
		}
		return;
	}
	if (_curatedHoverGhost) _curatedClearGhostHover();
	const g =
		_curatedGroupAtPoint(ev.clientX, ev.clientY) ||
		_curatedInsertAnchorAtPoint(ev.clientX, ev.clientY);
	if (g) {
		const key = `${g.side}|${g.file}|${g.lo}|${g.hi}`;
		document.body.classList.add("curated-group-hover-active");
		if (_curatedHoverGroupKey === key) {
			_curatedClearTokenHover();
			return;
		}
		_curatedHoverGroupKey = key;
		_curatedHoverGroupRange = {
			side: g.side,
			file: g.file,
			lo: g.lo,
			hi: g.hi,
			marks: g.marks,
		};
		_curatedClearTokenHover();
		_curatedRefreshHoverBorder();
		_curatedRefreshConnectorsForCurrent();
		return;
	}
	if (_curatedHoverGroupKey) _curatedClearGroupHover();

	const info = _curatedClickPosition(ev);
	if (info) {
		const tok = _curatedTokenAtPos(info.side, info.file, info.pos);
		if (tok && !_curatedExistingMarkAtPos(info.side, info.file, tok.start)) {
			const newKey = `${info.side}|${info.file}|${tok.start}`;
			const oldKey = _curatedHoverToken
				? `${_curatedHoverToken.side}|${_curatedHoverToken.file}|${_curatedHoverToken.tok.start}`
				: null;
			if (oldKey !== newKey) {
				_curatedHoverToken = { side: info.side, file: info.file, tok };
				_curatedRefreshTokenHoverOverlay();
			}
			return;
		}
	}
	_curatedClearTokenHover();
}

let _curatedHoverToken = null;
let _curatedHoverGhost = null;

function _curatedRefreshGhostHoverOverlay() {
	for (const layer of document.querySelectorAll(".curated-bg-layer")) {
		for (const el of layer.querySelectorAll(".curated-ghost-hover-rect")) {
			el.remove();
		}
	}
	if (!_curatedHoverGhost) {
		if (!_curatedHoverToken)
			document.body.classList.remove("curated-token-hover-active");
		return;
	}
	document.body.classList.add("curated-token-hover-active");
	const el =
		_curatedHoverGhost.el ||
		_curatedFindGhostEl(_curatedHoverGhost);
	if (!el) return;
	const r = el.getBoundingClientRect();
	const pane = el.closest(".code-pane");
	if (!pane) return;
	const paneRect = pane.getBoundingClientRect();
	const layers = _curatedEnsurePaneOverlays(pane);
	if (!layers) return;
	const div = document.createElement("div");
	div.className = "curated-hover-rect curated-ghost-hover-rect";
	div.style.left = `${r.left - paneRect.left}px`;
	div.style.top = `${r.top - paneRect.top}px`;
	div.style.width = `${r.width}px`;
	div.style.height = `${r.height}px`;
	layers.bg.appendChild(div);
}

function _curatedClearGhostHover() {
	if (!_curatedHoverGhost) return;
	_curatedHoverGhost = null;
	_curatedRefreshGhostHoverOverlay();
}

function _curatedRefreshTokenHoverOverlay() {
	for (const layer of document.querySelectorAll(".curated-bg-layer")) {
		for (const el of layer.querySelectorAll(".curated-token-hover-rect")) {
			el.remove();
		}
	}
	if (!_curatedHoverToken) {
		if (!_curatedHoverGhost)
			document.body.classList.remove("curated-token-hover-active");
		return;
	}
	document.body.classList.add("curated-token-hover-active");
	const { side, file, tok } = _curatedHoverToken;
	const r = _curatedSelectionBoundingRect(side, file, [tok], null, 0);
	if (!r) return;
	const layers = _curatedEnsurePaneOverlays(r.pane);
	if (!layers) return;
	const div = document.createElement("div");
	div.className = "curated-hover-rect curated-token-hover-rect";
	div.style.left = `${r.left}px`;
	div.style.top = `${r.top}px`;
	div.style.width = `${r.width}px`;
	div.style.height = `${r.height}px`;
	layers.bg.appendChild(div);
}

function _curatedClearTokenHover() {
	if (!_curatedHoverToken) return;
	_curatedHoverToken = null;
	_curatedRefreshTokenHoverOverlay();
}

let _curatedRefreshScheduled = false;
function _curatedScheduleOverlayRefresh() {
	if (_curatedRefreshScheduled) return;
	_curatedRefreshScheduled = true;
	requestAnimationFrame(() => {
		_curatedRefreshScheduled = false;
		if (!_curatedEditMode) return;
		_curatedRefreshOverlays();
		_curatedRefreshPairConnectors();
	});
}

function _curatedOnScroll() {
	_curatedRefreshPairConnectors();
}

function _curatedOnResize() {
	_curatedScheduleOverlayRefresh();
}

function _curatedApplyPartnerAndAnchorHighlights(el) {
	if (el.hasAttribute("data-swap-pos")) _applySwapPartnerHighlight(el);
	if (el.hasAttribute("data-insert-pos")) _applyInsertAnchorHighlight(el);
}

function _curatedApplyClickHighlights(side, file, lo, hi) {
	_clearLeoHighlights();
	_curatedActiveGroupRange = null;
	_curatedActiveGhost = null;
	_curatedSelectionRange = { side, file, lo, hi };
	const wrap = document.getElementById(`code-${side}`);
	if (!wrap) {
		_curatedRefreshActiveOverlay();
		return;
	}
	const sel = `.leo-mark[data-leo-side="${side}"]:not([data-leo-ghost-offset])`;
	const els = [];
	for (const el of wrap.querySelectorAll(sel)) {
		const p = parseInt(el.getAttribute("data-leo-pos"), 10);
		if (Number.isFinite(p) && p >= lo && p < hi) els.push(el);
	}
	const marks = _curatedFindMarks(side, file, lo, hi);
	_curatedActiveGroupRange = { side, file, lo, hi, marks };
	for (const el of els) _curatedApplyPartnerAndAnchorHighlights(el);
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
	} else if (side === "student") {
		const studentWrap = document.getElementById("code-student");
		if (studentWrap) {
			for (const m of marks) {
				if (m.label !== "extra" || !m.move_to || m.paired_with) continue;
				const aSel =
					`.insert-anchor--move` +
					`[data-insert-anchor-move-source-file="${CSS.escape(file)}"]` +
					`[data-insert-anchor-move-source-pos="${m.start}"]`;
				for (const a of studentWrap.querySelectorAll(aSel)) {
					a.classList.add("insert-active");
					_insertHighlighted.push(a);
				}
			}
		}
	}
	_curatedRefreshActiveOverlay();
	_curatedRebuildPairConnectorsForSelection(side, file, lo, hi);
	_curatedRefreshPairConnectors();
}
