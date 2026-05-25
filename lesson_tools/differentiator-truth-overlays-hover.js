"use strict";

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

function _truthAnchorRange(anchorEl) {
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
		for (const g of _truthGroupMarks()) {
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
		const mark = _truthFileMarks("student", sFile).find(
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

function _truthInsertAnchorAtPoint(x, y) {
	const el = document.elementFromPoint(x, y);
	if (!el || !el.closest) return null;
	return _truthAnchorRange(el.closest(".insert-anchor"));
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
	_truthRefreshActiveOverlay();
	_truthRebuildPairConnectorsForSelection(side, file, lo, hi);
	_truthRefreshPairConnectors();
}
