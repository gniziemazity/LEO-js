"use strict";

function _diffCommentRanges(text, fileName) {
	const ext = String(fileName || "")
		.toLowerCase()
		.match(/\.[a-z]+$/);
	const e = ext ? ext[0] : "";
	const profile = e ? window.LanguageProfiles.getProfile(e) : null;
	if (profile) return window.LanguageProfiles.commentRangesOf(profile, text);

	const ranges = [];
	_DIFF_FALLBACK_DETECT_RE.lastIndex = 0;
	let m;
	while ((m = _DIFF_FALLBACK_DETECT_RE.exec(text)) !== null) {
		ranges.push([m.index, m.index + m[0].length]);
	}
	return ranges;
}

let _teacherTokenTotalCache = null;
let _teacherTokenTotalCacheKey = null;

function _countNonCommentTokens(text, fileName) {
	if (!text) return 0;
	const ranges = _diffCommentRanges(text, fileName);
	let count = 0;
	_DIFF_TOKEN_RE.lastIndex = 0;
	let m;
	while ((m = _DIFF_TOKEN_RE.exec(text)) !== null) {
		const pos = m.index;
		let inComment = false;
		for (const [lo, hi] of ranges) {
			if (lo <= pos && pos < hi) {
				inComment = true;
				break;
			}
			if (pos < lo) break;
		}
		if (!inComment) count++;
	}
	return count;
}

function _getTeacherNonCommentTokenTotal() {
	if (!_teacherFiles) return 0;
	const names = Object.keys(_teacherFiles).sort();
	const key =
		names.join("|") +
		"::" +
		names.map((n) => (_teacherFiles[n] || "").length).join(",");
	if (key === _teacherTokenTotalCacheKey) return _teacherTokenTotalCache;
	let total = 0;
	for (const name of names)
		total += _countNonCommentTokens(_teacherFiles[name] || "", name);
	_teacherTokenTotalCache = total;
	_teacherTokenTotalCacheKey = key;
	return total;
}

function _computeFollowScore(marksEntry) {
	if (!marksEntry) return null;
	if (typeof marksEntry.score === "number") {
		return round1(marksEntry.score);
	}
	const total = _getTeacherNonCommentTokenTotal();
	if (total === 0) return null;
	let nMissing = 0;
	let nPhantomMissing = 0;
	for (const marks of Object.values(marksEntry.teacher_files || {})) {
		for (const m of marks || []) {
			if (m.label === "missing") {
				nMissing++;
				if (m.token && /^\s+$/.test(m.token)) nPhantomMissing++;
			}
		}
	}
	let nGhostExtra = 0;
	let nExtraUnpaired = 0;
	for (const marks of Object.values(marksEntry.student_files || {})) {
		for (const m of marks || []) {
			if (m.label === "ghost_extra") nGhostExtra++;
			else if (m.label === "extra" && !m.paired_with) nExtraUnpaired++;
		}
	}
	const teacherTotal = total + nPhantomMissing;
	const nFound = total - (nMissing - nPhantomMissing);
	const raw =
		Math.max(0, (nFound - nGhostExtra - nExtraUnpaired) / teacherTotal) * 100;
	return round1(raw);
}

function _updateTitleScore() {
	if (!_titleBase) return;
	const score = _computeFollowScore(_currentMarksEntry);
	const suffix = score != null ? ` (${score.toFixed(1)}%)` : "";
	const newTitle = _titleBase + suffix;
	const el = document.getElementById("title-student");
	if (el) el.textContent = newTitle;
	document.title = `${newTitle} : Differentiator`;
}
