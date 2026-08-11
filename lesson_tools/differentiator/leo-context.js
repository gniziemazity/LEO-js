"use strict";

const _DIFF_CONTEXT_K_FALLBACK = 10;

function _contextSlice(inst, side) {
	const assignments = _currentMarksEntry?.leo_assignments;
	if (!assignments || !inst) return null;
	const useAug =
		side === "teacher" &&
		Array.isArray(assignments.teacher_seq_aug) &&
		Number.isInteger(inst.seq_idx_aug);
	const seq = useAug
		? assignments.teacher_seq_aug
		: side === "teacher"
			? assignments.teacher_seq
			: assignments.student_seq;
	const idx = useAug ? inst.seq_idx_aug : inst.seq_idx;
	const k = assignments.k ?? _DIFF_CONTEXT_K_FALLBACK;
	if (!seq || idx == null) return null;
	const lo = Math.max(0, idx - k);
	const hi = Math.min(seq.length, idx + k + 1);
	return {
		before: seq.slice(lo, idx),
		after: seq.slice(idx + 1, hi),
	};
}

function _instanceHasGhostNeighbours(inst, sideName) {
	if (sideName !== "teacher") return false;
	if (inst.ghost) return false;
	if (!Number.isInteger(inst.seq_idx_aug)) return false;
	const strippedView = _strippedTeacherView();
	if (!strippedView) return false;
	const assignments = _currentMarksEntry?.leo_assignments;
	const k = assignments?.k ?? _DIFF_CONTEXT_K_FALLBACK;
	const idx = inst.seq_idx_aug;
	const lo = Math.max(0, idx - k);
	const hi = Math.min(strippedView.isGhostAt.length, idx + k + 1);
	for (let i = lo; i < hi; i++) {
		if (i !== idx && strippedView.isGhostAt[i]) return true;
	}
	return false;
}

function _contextSliceStripped(inst) {
	const assignments = _currentMarksEntry?.leo_assignments;
	const strippedView = _strippedTeacherView();
	if (!assignments || !strippedView || !Number.isInteger(inst.seq_idx_aug))
		return null;
	const k = assignments.k ?? _DIFF_CONTEXT_K_FALLBACK;
	const anchorIdx = strippedView.augToStripped[inst.seq_idx_aug];
	const anchorIsGhost = strippedView.isGhostAt[inst.seq_idx_aug];
	const seq = strippedView.strippedSeq;
	if (anchorIsGhost) {
		return {
			before: seq.slice(Math.max(0, anchorIdx - k), anchorIdx),
			after: seq.slice(anchorIdx, Math.min(seq.length, anchorIdx + k)),
		};
	}
	return {
		before: seq.slice(Math.max(0, anchorIdx - k), anchorIdx),
		after: seq.slice(anchorIdx + 1, Math.min(seq.length, anchorIdx + k + 1)),
	};
}

function _strippedTeacherView() {
	const assignments = _currentMarksEntry?.leo_assignments;
	if (!assignments) return null;
	if (assignments.__strippedView !== undefined)
		return assignments.__strippedView;
	const aug = assignments.teacher_seq_aug;
	if (!Array.isArray(aug) || !aug.some((t) => Array.isArray(t))) {
		assignments.__strippedView = null;
		return null;
	}
	const strippedSeq = [];
	const augToStripped = [];
	const isGhostAt = [];
	for (const entry of aug) {
		const isGhost = Array.isArray(entry);
		isGhostAt.push(isGhost);
		augToStripped.push(strippedSeq.length);
		if (!isGhost) strippedSeq.push(entry);
	}
	assignments.__strippedView = { strippedSeq, augToStripped, isGhostAt };
	return assignments.__strippedView;
}

function _instanceContextVectors(inst, sideName) {
	const assignments = _currentMarksEntry?.leo_assignments;
	if (!assignments) return null;
	const k = assignments.k ?? _DIFF_CONTEXT_K_FALLBACK;
	let seq, idx;
	if (sideName === "teacher") {
		const aug = Array.isArray(assignments.teacher_seq_aug)
			? assignments.teacher_seq_aug
			: null;
		if (aug && Number.isInteger(inst.seq_idx_aug)) {
			seq = aug.map((t) => (Array.isArray(t) ? t[0] : t));
			idx = inst.seq_idx_aug;
		} else {
			seq = assignments.teacher_seq;
			idx = inst.seq_idx;
		}
	} else {
		seq = assignments.student_seq;
		idx = inst.seq_idx;
	}
	if (!seq || !Number.isInteger(idx)) return null;
	const primary = _buildContextSplit(seq, idx, k);
	let alt = null;
	if (
		sideName === "teacher" &&
		!inst.ghost &&
		Number.isInteger(inst.seq_idx_aug)
	) {
		const strippedView = _strippedTeacherView();
		if (strippedView) {
			alt = _buildStrippedContextSplit(
				strippedView.strippedSeq,
				strippedView.augToStripped[inst.seq_idx_aug],
				strippedView.isGhostAt[inst.seq_idx_aug],
				k,
			);
		}
	}
	return { primary, alt };
}

// A "context pack": { left, right } — two Maps with uniform per-token counts
// (no IDF, no distance decay).
function _buildContextSplit(seq, idx, k) {
	const left = new Map();
	const right = new Map();
	for (let i = Math.max(0, idx - k); i < idx; i++) {
		const tok = seq[i];
		left.set(tok, (left.get(tok) || 0) + 1);
	}
	for (let i = idx + 1; i < Math.min(seq.length, idx + k + 1); i++) {
		const tok = seq[i];
		right.set(tok, (right.get(tok) || 0) + 1);
	}
	return { left, right };
}

function _buildStrippedContextSplit(strippedSeq, anchorIdx, anchorIsGhost, k) {
	const left = new Map();
	const right = new Map();
	const n = strippedSeq.length;
	if (anchorIsGhost) {
		for (let off = 1; off <= k; off++) {
			const i = anchorIdx - off;
			if (i < 0) break;
			const tok = strippedSeq[i];
			left.set(tok, (left.get(tok) || 0) + 1);
		}
		for (let off = 1; off <= k; off++) {
			const i = anchorIdx - 1 + off;
			if (i >= n) break;
			const tok = strippedSeq[i];
			right.set(tok, (right.get(tok) || 0) + 1);
		}
	} else {
		for (let i = Math.max(0, anchorIdx - k); i < anchorIdx; i++) {
			const tok = strippedSeq[i];
			left.set(tok, (left.get(tok) || 0) + 1);
		}
		for (let i = anchorIdx + 1; i < Math.min(n, anchorIdx + k + 1); i++) {
			const tok = strippedSeq[i];
			right.set(tok, (right.get(tok) || 0) + 1);
		}
	}
	return { left, right };
}

function _combinedScore(packA, packB) {
	if (!packA || !packB) return 0;
	const cLeft = _cosineSim(packA.left, packB.left);
	const cRight = _cosineSim(packA.right, packB.right);
	return 0.3 * Math.min(cLeft, cRight) + 0.7 * Math.max(cLeft, cRight);
}

function _cosineSim(v1, v2) {
	if (!v1 || !v2 || v1.size === 0 || v2.size === 0) return 0;
	let dot = 0,
		n1 = 0,
		n2 = 0;
	for (const [k, val] of v1) {
		n1 += val * val;
		const o = v2.get(k);
		if (o) dot += val * o;
	}
	for (const val of v2.values()) n2 += val * val;
	if (!dot || !n1 || !n2) return 0;
	return dot / (Math.sqrt(n1) * Math.sqrt(n2));
}

function _findInstanceIdx(list, pos, ghostOffset) {
	if (!list) return -1;
	if (ghostOffset != null) {
		return list.findIndex(
			(x) => x.ghost && x.pos === pos && x.blob_offset === ghostOffset,
		);
	}
	return list.findIndex((x) => !x.ghost && x.pos === pos);
}
