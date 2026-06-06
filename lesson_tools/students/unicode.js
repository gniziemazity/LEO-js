"use strict";

function hasLikelyAstralTruncation(text) {
	if (!text) return false;
	for (const ch of text) {
		if (isLikelyAstralEmojiFallbackChar(ch)) return true;
	}
	return false;
}

function isLikelyAstralEmojiFallbackChar(ch) {
	if (!ch || ch.length === 0) return false;
	const cp = ch.codePointAt(0);
	if (cp < 0xf900 || cp > 0xfaff) return false;
	const candidate = String.fromCodePoint(0x10000 + cp);
	return /\p{Extended_Pictographic}/u.test(candidate);
}

function repairLikelyAstralEmojiFallbacks(text) {
	if (!text) return { text, repairedCount: 0 };
	let repairedCount = 0;
	let out = "";
	for (const ch of text) {
		if (isLikelyAstralEmojiFallbackChar(ch)) {
			repairedCount += 1;
			out += String.fromCodePoint(0x10000 + ch.codePointAt(0));
		} else {
			out += ch;
		}
	}
	return { text: out, repairedCount };
}

function warnLikelyAstralTruncation(hits, repairs) {
	if (_shownUnicodeCorruptionWarning || (!hits.length && !repairs.length))
		return;
	_shownUnicodeCorruptionWarning = true;
	const repairedCount = repairs.length;
	const unrepairedCount = hits.length;
	const repairedSample = repairs.slice(0, 4);
	const unrepairedSample = hits.slice(0, 4);
	if (repairedCount) {
		console.warn(
			"[Students] Repaired likely astral emoji fallback glyphs in XLSX values.",
			{ repairedCount, sample: repairedSample },
		);
	}
	if (unrepairedCount) {
		console.warn(
			"[Students] Some possible astral emoji truncations could not be auto-repaired.",
			{ unrepairedCount, sample: unrepairedSample },
		);
	}
}
