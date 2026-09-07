"use strict";

function _posInRanges(pos, ranges) {
	if (!ranges) return false;
	for (const r of ranges) {
		const lo = r.length !== undefined ? r[0] : r.lo;
		const hi = r.length !== undefined ? r[1] : r.hi;
		if (pos >= lo && pos < hi) return true;
	}
	return false;
}

function _isInsertableChar(ch) {
	if (ch == null) return false;
	if (DELETE_CHARS.has(ch)) return false;
	if (
		typeof CURSOR_MOVES !== "undefined" &&
		Object.prototype.hasOwnProperty.call(CURSOR_MOVES, ch)
	)
		return false;
	if (
		typeof SHIFT_CURSOR_MOVES !== "undefined" &&
		Object.prototype.hasOwnProperty.call(SHIFT_CURSOR_MOVES, ch)
	)
		return false;
	if (typeof IGNORED_CHARS !== "undefined" && IGNORED_CHARS.has(ch))
		return false;
	if (typeof PAUSE_CHAR !== "undefined" && ch === PAUSE_CHAR) return false;
	return true;
}

function _computeBurstDecorations(parts, evs, replay) {
	const ghostChars = new Set();
	const ghostInserts = new Map();
	const commentChars = new Set();
	const commentInserts = new Map();
	if (!replay || !evs) {
		return { ghostChars, ghostInserts, commentChars, commentInserts };
	}

	const claimed = new Map();
	const claim = (file, pos) => {
		let s = claimed.get(file);
		if (!s) {
			s = new Set();
			claimed.set(file, s);
		}
		if (s.has(pos)) return false;
		s.add(pos);
		return true;
	};

	for (let i = 0; i < parts.length; i++) {
		const p = parts[i];
		const ev = evs[i];
		if (!ev || ev.timestamp == null) continue;
		const hitsAll = replay.tsToPos.get(ev.timestamp) || [];

		if (p.type === "char") {
			if (ev._editor === "dev") continue;
			let didClaim = false;
			for (const { file, pos } of hitsAll) {
				if (!claim(file, pos)) continue;
				didClaim = true;
				const ranges = replay.commentRangesByFile.get(file);
				if (_posInRanges(pos, ranges)) commentChars.add(i);
				break;
			}
			if (!didClaim && _isInsertableChar(p.t)) ghostChars.add(i);
		} else if (p.type === "code_insert") {
			const text = _displayCodeInsert(p.t || "");
			const claimedItems = [];
			for (const { file, pos } of hitsAll) {
				if (!claim(file, pos)) continue;
				const fileState = replay.files?.get(file);
				const ch = fileState ? fileState.text[pos] : null;
				claimedItems.push({ file, pos, ch });
			}
			const dispChars = [];
			const dispOff = [];
			for (let k = 0; k < text.length; k++) {
				if (!_isInsertableChar(text[k])) continue;
				dispChars.push(text[k]);
				dispOff.push(k);
			}
			const nD = dispChars.length;
			const nS = claimedItems.length;
			const dp = new Array(nD + 1);
			for (let a = 0; a <= nD; a++) dp[a] = new Uint16Array(nS + 1);
			for (let a = 1; a <= nD; a++) {
				const ca = dispChars[a - 1];
				for (let b = 1; b <= nS; b++) {
					if (ca === claimedItems[b - 1].ch) {
						dp[a][b] = dp[a - 1][b - 1] + 1;
					} else {
						dp[a][b] =
							dp[a - 1][b] >= dp[a][b - 1] ? dp[a - 1][b] : dp[a][b - 1];
					}
				}
			}
			const matchedItemForOff = new Map();
			{
				let a = nD;
				let b = nS;
				while (a > 0 && b > 0) {
					if (dispChars[a - 1] === claimedItems[b - 1].ch) {
						matchedItemForOff.set(dispOff[a - 1], b - 1);
						a--;
						b--;
					} else if (dp[a - 1][b] >= dp[a][b - 1]) {
						a--;
					} else {
						b--;
					}
				}
			}
			const ghostSet = new Set();
			for (let k = 0; k < text.length; k++) {
				if (!_isInsertableChar(text[k])) continue;
				if (!matchedItemForOff.has(k)) ghostSet.add(k);
			}
			if (ghostSet.size > 0) {
				let m = ghostInserts.get(i);
				if (!m) {
					m = new Set();
					ghostInserts.set(i, m);
				}
				for (const k of ghostSet) m.add(k);
			}
			let cm = null;
			for (const [off, itemIdx] of matchedItemForOff) {
				const item = claimedItems[itemIdx];
				const ranges = replay.commentRangesByFile.get(item.file);
				if (_posInRanges(item.pos, ranges)) {
					if (!cm) {
						cm = commentInserts.get(i);
						if (!cm) {
							cm = new Set();
							commentInserts.set(i, cm);
						}
					}
					cm.add(off);
				}
			}
		}
	}

	return { ghostChars, ghostInserts, commentChars, commentInserts };
}

function _decoForChar(deco, partIdx) {
	if (deco.ghostChars.has(partIdx)) return "ghost";
	if (deco.commentChars.has(partIdx)) return "comment";
	return null;
}

function _decoForInsertOffset(deco, partIdx, offset) {
	const g = deco.ghostInserts.get(partIdx);
	if (g && g.has(offset)) return "ghost";
	const c = deco.commentInserts.get(partIdx);
	if (c && c.has(offset)) return "comment";
	return null;
}

function _decoSpanOpen(decoKind) {
	if (decoKind === "ghost") return '<span class="tt-mark-ghost">';
	if (decoKind === "comment") return '<span class="tt-mark-comment">';
	return null;
}
