"use strict";

function _truthIsCommentPos(side, file, pos) {
	for (const m of _truthFileMarks(side, file)) {
		if (m.label === "comment" && m.start <= pos && pos < m.end) return true;
	}
	return false;
}

function _truthTokenAtPos(side, file, pos) {
	const all = _truthTokensForFile(side, file);
	for (const t of all) {
		if (t.start <= pos && pos < t.end) {
			if (_truthIsCommentPos(side, file, t.start)) return null;
			return t;
		}
		if (t.start > pos) break;
	}
	return null;
}

function _truthResolveSrcPos(node, offset) {
	let el = node;
	if (el && el.nodeType === 3) el = el.parentNode;
	if (!el) return null;
	const pane = el.closest(".code-pane");
	if (!pane) return null;
	const side = pane.dataset.paneSide;
	const file = pane.dataset.paneFile;
	if (!side || !file) return null;
	const lineEl = el.closest(".diff-line");
	if (!lineEl) return null;
	const lineStart = parseInt(lineEl.dataset.srcStart, 10);
	if (!Number.isFinite(lineStart)) return null;
	let range;
	try {
		range = document.createRange();
		range.setStart(lineEl, 0);
		range.setEnd(node, offset);
	} catch {
		return null;
	}
	return {
		side,
		file,
		pos: lineStart + _truthCountSourceText(range.cloneContents()),
	};
}

function _truthCountSourceText(root) {
	let total = 0;
	const walk = (n) => {
		if (n.nodeType === 1) {
			if (
				n.classList &&
				(n.classList.contains("diff-ghost") ||
					n.classList.contains("insert-anchor"))
			)
				return;
			for (const c of n.childNodes) walk(c);
		} else if (n.nodeType === 3) {
			total += n.nodeValue.length;
		} else if (n.nodeType === 11) {
			for (const c of n.childNodes) walk(c);
		}
	};
	walk(root);
	return total;
}

function _truthSnapToTokens(side, file, lo, hi) {
	const all = _truthTokensForFile(side, file);
	let first = -1,
		last = -1;
	for (let i = 0; i < all.length; i++) {
		const t = all[i];
		if (t.end <= lo) continue;
		if (t.start >= hi) break;
		if (first === -1) first = i;
		last = i;
	}
	if (first === -1) return { lo, hi };
	return {
		lo: Math.min(lo, all[first].start),
		hi: Math.max(hi, all[last].end),
	};
}

function _truthSrcText(side, file) {
	const text =
		(side === "teacher" ? _teacherFiles : _studentFiles)[file] || "";
	return text.replace(/\r\n/g, "\n");
}

function _truthTokensForFile(side, file) {
	const key = side + ":" + file;
	if (_truthTokenCache.has(key)) return _truthTokenCache.get(key);
	const text = _truthSrcText(side, file);
	const out = [];
	const re = /[a-zA-Z0-9]+|[^\s]/gu;
	let m;
	while ((m = re.exec(text)) !== null) {
		out.push({ start: m.index, end: m.index + m[0].length, token: m[0] });
	}
	_truthTokenCache.set(key, out);
	return out;
}

function _truthCommentRanges(side, file) {
	const key = side + ":" + file;
	if (_truthCommentRangeCache.has(key))
		return _truthCommentRangeCache.get(key);
	const text = _truthSrcText(side, file);
	const ranges = _diffCommentRanges(text, file);
	_truthCommentRangeCache.set(key, ranges);
	return ranges;
}

function _truthSliceExcludingComments(side, file, lo, hi) {
	const text = _truthSrcText(side, file);
	const ranges = _truthCommentRanges(side, file);
	let out = "";
	let cursor = lo;
	for (const [cLo, cHi] of ranges) {
		if (cHi <= lo) continue;
		if (cLo >= hi) break;
		const a = Math.max(cLo, lo);
		if (a > cursor) out += text.slice(cursor, a);
		cursor = Math.min(cHi, hi);
	}
	if (cursor < hi) out += text.slice(cursor, hi);
	return out;
}

function _truthTokensInRange(side, file, lo, hi) {
	return _truthTokensForFile(side, file).filter(
		(t) =>
			t.start >= lo &&
			t.end <= hi &&
			!_truthIsCommentPos(side, file, t.start),
	);
}

function _truthIsAllWhitespace(side, file, lo, hi) {
	if (lo >= hi) return false;
	const text = _truthSrcText(side, file);
	if (hi > text.length) return false;
	return /^\s+$/.test(text.slice(lo, hi));
}

function _truthWhitespaceTokensInRange(side, file, lo, hi) {
	const text = _truthSrcText(side, file);
	if (lo >= hi || hi > text.length) return [];
	const out = [];
	const re = /\s+/g;
	re.lastIndex = lo;
	let m;
	while ((m = re.exec(text)) !== null) {
		if (m.index >= hi) break;
		const s = Math.max(m.index, lo);
		const e = Math.min(m.index + m[0].length, hi);
		if (s < e && !_truthIsCommentPos(side, file, s)) {
			out.push({ start: s, end: e, token: text.slice(s, e) });
		}
		if (re.lastIndex >= hi) break;
	}
	return out;
}

function _truthMarks() {
	return _truthWorking[_truthWorkingKey()] ?? null;
}

function _truthFileMarks(side, file) {
	const t = _truthMarks();
	const sideKey = side === "teacher" ? "teacher_files" : "student_files";
	if (!t[sideKey]) t[sideKey] = {};
	if (!t[sideKey][file]) t[sideKey][file] = [];
	return t[sideKey][file];
}

function _truthFindMarks(side, file, lo, hi) {
	return _truthFileMarks(side, file).filter(
		(m) =>
			m.start < hi &&
			m.end > lo &&
			(m.label === "missing" ||
				m.label === "extra" ||
				m.label === "ghost_extra" ||
				m.label === "comment"),
	);
}

function _truthAddMark(side, file, label, tokens, opts) {
	const arr = _truthFileMarks(side, file);
	const { insertAtPos } = opts || {};
	const commentSpans =
		label === "comment"
			? null
			: new Set(
					arr
						.filter((m) => m.label === "comment")
						.map((m) => `${m.start}-${m.end}`),
				);
	for (const t of tokens) {
		if (commentSpans && commentSpans.has(`${t.start}-${t.end}`)) continue;
		const m = { token: t.token, label, start: t.start, end: t.end };
		if (insertAtPos != null) m.insert_at = { file, pos: insertAtPos };
		arr.push(m);
	}
	arr.sort((a, b) => a.start - b.start);
}

function _truthRemoveMark(side, file, mark) {
	const arr = _truthFileMarks(side, file);
	const i = arr.indexOf(mark);
	if (i >= 0) arr.splice(i, 1);
	if (!mark.paired_with) return;
	const otherSide = side === "teacher" ? "student" : "teacher";
	for (const m of _truthFileMarks(otherSide, mark.paired_with.file)) {
		if (
			m.paired_with &&
			m.paired_with.start === mark.start &&
			m.paired_with.token === mark.token
		) {
			delete m.paired_with;
		}
	}
}

function _truthClearPair(mark, side) {
	if (!mark || !mark.paired_with) return;
	if (mark.paired_with.ghost) {
		delete mark.paired_with;
		return;
	}
	const otherSide = side === "teacher" ? "student" : "teacher";
	const partner = _truthFileMarks(otherSide, mark.paired_with.file).find(
		(m) =>
			m.start === mark.paired_with.start &&
			m.token === mark.paired_with.token,
	);
	if (partner && partner.paired_with) delete partner.paired_with;
	delete mark.paired_with;
}

function _truthSetSwapPair(missingMark, extraMark, missingFile, extraFile) {
	_truthClearPair(missingMark, "teacher");
	_truthClearPair(extraMark, "student");
	missingMark.paired_with = {
		file: extraFile,
		start: extraMark.start,
		end: extraMark.end,
		token: extraMark.token,
		label: "extra",
	};
	extraMark.paired_with = {
		file: missingFile,
		start: missingMark.start,
		end: missingMark.end,
		token: missingMark.token,
		label: "missing",
	};
	delete missingMark.insert_at;
	delete extraMark.move_to;
}

function _clearSelectionPreservingScroll() {
	const scroll = document.getElementById("diff-scroll");
	const top = scroll ? scroll.scrollTop : 0;
	const left = scroll ? scroll.scrollLeft : 0;
	const sel = window.getSelection();
	if (sel) sel.removeAllRanges();
	requestAnimationFrame(() => {
		if (scroll) {
			scroll.scrollTop = top;
			scroll.scrollLeft = left;
		}
	});
}

function _truthClickPosition(ev) {
	const pane = ev.target.closest(".code-pane");
	if (!pane) return null;
	const side = pane.dataset.paneSide;
	const file = pane.dataset.paneFile;
	const markEl = ev.target.closest(".leo-mark");
	if (markEl) {
		const pos = parseInt(markEl.dataset.leoPos, 10);
		if (Number.isFinite(pos)) return { side, file, pos };
	}
	const cp = document.caretRangeFromPoint
		? document.caretRangeFromPoint(ev.clientX, ev.clientY)
		: null;
	if (cp) {
		const info = _truthResolveSrcPos(cp.startContainer, cp.startOffset);
		if (info && info.side === side && info.file === file) return info;
	}
	const lineEl = ev.target.closest(".diff-line");
	if (lineEl) {
		const ls = parseInt(lineEl.dataset.srcStart, 10);
		if (Number.isFinite(ls)) return { side, file, pos: ls };
	}
	return null;
}

function _truthRerender() {
	if (_truthEditMode) _truthSwitchToTruthMarks();
	else _applyCurrentMarks();
	_truthRenderPreservingScroll();
	_updateTitleScore();
	_persistDiffState();
}

function _truthGroupKey(m) {
	if (m.label === "missing") {
		if (m.insert_at) return `mi|${m.insert_at.file}|${m.insert_at.pos}`;
		return `m|free`;
	}
	if (m.label === "extra") {
		if (m.paired_with) {
			return `er|${m.paired_with.file}|${m.paired_with.start}`;
		}
		if (m.move_to) return `em|${m.move_to.file}|${m.move_to.pos}`;
		return `e`;
	}
	if (m.label === "ghost_extra") return `ge`;
	return `?|${m.label}`;
}

function _truthMakeGroup(side, file, m) {
	const g = { side, file, marks: [], lo: Infinity, hi: -Infinity };
	if (m.label === "missing") {
		g.kind = m.insert_at ? "missing-insert" : "missing";
		if (m.insert_at) {
			g.insertFile = m.insert_at.file;
			g.insertPos = m.insert_at.pos;
		}
	} else if (m.label === "ghost_extra") {
		g.kind = "ghost_extra";
	} else {
		if (m.paired_with) {
			g.kind = "extra-replace";
			g.pairFile = m.paired_with.file;
			g.pairLo = m.paired_with.start;
			g.pairHi = m.paired_with.end;
		} else if (m.move_to) {
			g.kind = "extra-move";
			g.moveFile = m.move_to.file;
			g.movePos = m.move_to.pos;
		} else {
			g.kind = "extra";
		}
	}
	return g;
}

function _truthGroupMarks() {
	const t = _truthMarks();
	if (!t) return [];
	const groups = [];

	for (const [side, sideKey] of [
		["teacher", "teacher_files"],
		["student", "student_files"],
	]) {
		const filesObj = t[sideKey] || {};
		for (const [file, marks] of Object.entries(filesObj)) {
			const sorted = [...marks].sort((a, b) => a.start - b.start);
			const allTokens = _truthTokensForFile(side, file);
			const commentPositions = new Set();
			for (const m of sorted) {
				if (m.label === "comment") commentPositions.add(m.start);
			}
			const insertPositions = new Set();
			if (side === "student") {
				const tFiles = t.teacher_files || {};
				for (const tMarks of Object.values(tFiles)) {
					for (const tm of tMarks || []) {
						if (tm.label !== "missing") continue;
						if (tm.paired_with) continue;
						const ia = tm.insert_at;
						if (ia && ia.file === file) insertPositions.add(ia.pos);
					}
				}
				const sFiles = t.student_files || {};
				for (const sMarks of Object.values(sFiles)) {
					for (const sm of sMarks || []) {
						if (sm.label !== "extra") continue;
						if (sm.paired_with) continue;
						const mt = sm.move_to;
						if (mt && mt.file === file) insertPositions.add(mt.pos);
					}
				}
			}
			const hasObstacleInGap = (lo, hi) => {
				if (lo > hi) return false;
				for (const tok of allTokens) {
					if (tok.start < lo) continue;
					if (tok.start >= hi) break;
					if (!commentPositions.has(tok.start)) return true;
				}
				for (const pos of insertPositions) {
					if (pos >= lo && pos <= hi) return true;
				}
				return false;
			};

			let cur = null,
				curKey = null;
			const flush = () => {
				if (cur) groups.push(cur);
				cur = null;
				curKey = null;
			};

			for (const m of sorted) {
				if (
					m.label !== "missing" &&
					m.label !== "extra" &&
					m.label !== "ghost_extra"
				)
					continue;
				if (side === "teacher" && m.label === "missing" && m.paired_with)
					continue;

				const key = _truthGroupKey(m);
				const merge =
					cur && curKey === key && !hasObstacleInGap(cur.hi, m.start);

				if (!merge) {
					flush();
					cur = _truthMakeGroup(side, file, m);
					curKey = key;
				}

				if (m.paired_with && cur.kind && cur.kind.endsWith("replace")) {
					const partnerSide = side === "teacher" ? "student" : "teacher";
					const partnerKey =
						partnerSide === "teacher" ? "teacher_files" : "student_files";
					const partner = (t[partnerKey]?.[m.paired_with.file] || []).find(
						(p) =>
							p.start === m.paired_with.start &&
							p.token === m.paired_with.token,
					);
					const pLo = partner ? partner.start : m.paired_with.start;
					const pHi = partner ? partner.end : m.paired_with.end;
					cur.pairLo = Math.min(cur.pairLo, pLo);
					cur.pairHi = Math.max(cur.pairHi, pHi);
				}

				cur.marks.push(m);
				cur.lo = Math.min(cur.lo, m.start);
				cur.hi = Math.max(cur.hi, m.end);
			}
			flush();
		}
	}

	groups.sort((a, b) => {
		if (a.side !== b.side) return a.side > b.side ? 1 : -1;
		return a.lo - b.lo;
	});
	return groups;
}

window.addEventListener("DOMContentLoaded", _truthEnsureButtons);
