"use strict";

function _buildByteFingerprint(events, { trackLangs = false } = {}) {
	const bytes = [];
	const langs = trackLangs ? [] : null;
	let cur = 0;
	let count = 0;
	for (const ev of events) {
		const tok = ev.token || ev.label || "";
		const bit = tok.length % 2;
		cur = (cur << 1) | bit;
		if (langs) langs.push(ev.lang || null);
		count++;
		if (count === 8) {
			bytes.push(cur);
			cur = 0;
			count = 0;
		}
	}
	if (count > 0) {
		cur = cur << (8 - count);
		bytes.push(cur);
	}
	return { bytes, langs };
}

function _renderByteFingerprint(
	wrap,
	bytes,
	{ langs, classPrefix, bytesPerCol = 2 } = {},
) {
	const bar = document.createElement("div");
	bar.className = `${classPrefix}-bar`;
	for (let i = 0; i < bytes.length; i += bytesPerCol) {
		const col = document.createElement("div");
		col.className = `${classPrefix}-byte`;
		for (let j = 0; j < bytesPerCol; j++) {
			const byteIdx = i + j;
			const b = byteIdx < bytes.length ? bytes[byteIdx] : 0;
			for (let k = 7; k >= 0; k--) {
				const bit = (b >> k) & 1;
				const px = document.createElement("div");
				px.className = `${classPrefix}-bit` + (bit ? " on" : "");
				if (bit && langs) {
					const lang = langs[byteIdx * 8 + (7 - k)];
					const lc = lang ? langColorFor(lang) : null;
					if (lc) px.style.background = lc;
				}
				col.appendChild(px);
			}
		}
		bar.appendChild(col);
	}
	wrap.appendChild(bar);
}

function _maskToBytes(bits) {
	const groups = [];
	for (let i = 0; i < bits.length; i += 8) {
		const chunk = bits.slice(i, i + 8).padEnd(8, "0");
		groups.push(parseInt(chunk, 2));
	}
	return groups.map((b) => String(b).padStart(3, "0")).join("-");
}

function _dominantLang(langs) {
	const counts = {};
	let best = null;
	let bestN = 0;
	for (const l of langs) {
		if (!l) continue;
		counts[l] = (counts[l] || 0) + 1;
		if (counts[l] > bestN) {
			best = l;
			bestN = counts[l];
		}
	}
	return best;
}

function _bytesLangs(langs) {
	const out = [];
	for (let i = 0; i < langs.length; i += 8) {
		out.push(_dominantLang(langs.slice(i, i + 8)));
	}
	return out;
}

function _boldFpGroups(hashStr, byteLangs) {
	const langs = byteLangs || [];
	return hashStr
		.split("-")
		.map((g, i) => {
			if (g === "000") return g;
			const color = langs[i] ? langColorFor(langs[i]) : null;
			return color ? `<b style="color:${color}">${g}</b>` : `<b>${g}</b>`;
		})
		.join("-");
}

function _computeFingerprintMask(students) {
	for (const s of students) {
		s._fpMask = null;
		s._fpMaskLangs = null;
	}
	const studentTsLang = students.map(() => new Map());
	const allTs = new Set();
	for (let i = 0; i < students.length; i++) {
		const s = students[i];
		const tsLang = studentTsLang[i];
		for (const ev of s.langEvents || []) {
			if (
				ev.ts != null &&
				ev.ts > 0 &&
				(ev.kind === "missing" || ev.kind === "extra-star")
			) {
				tsLang.set(ev.ts, ev.lang || null);
				allTs.add(ev.ts);
			}
		}
	}
	if (allTs.size === 0) return;
	const sortedTs = [...allTs].sort((a, b) => a - b);
	for (let i = 0; i < students.length; i++) {
		const tsLang = studentTsLang[i];
		if (tsLang.size === 0) continue;
		let bits = "";
		const langs = [];
		for (const t of sortedTs) {
			if (tsLang.has(t)) {
				bits += "1";
				langs.push(tsLang.get(t));
			} else {
				bits += "0";
				langs.push(null);
			}
		}
		students[i]._fpMask = bits;
		students[i]._fpMaskLangs = langs;
	}
}

function computeFingerprints(students) {
	const _hasFpTs = (ev) =>
		ev.kind && ev.kind !== "normal" && ev.ts != null && ev.ts > 0;
	const _isFpEvent = (ev) => ev.kind && ev.kind !== "normal";
	let fpMinTs = Infinity;
	let fpMaxTs = -Infinity;
	for (const s of students) {
		for (const ev of s.langEvents || []) {
			if (!_hasFpTs(ev)) continue;
			if (ev.ts < fpMinTs) fpMinTs = ev.ts;
			if (ev.ts > fpMaxTs) fpMaxTs = ev.ts;
		}
	}
	const fpRange = fpMaxTs - fpMinTs;
	const useFpTs = isFinite(fpMinTs) && isFinite(fpMaxTs) && fpRange > 0;
	const hasAnyFpEvents = students.some((s) =>
		(s.langEvents || []).some(_isFpEvent),
	);
	const showFingerprint = useFpTs || hasAnyFpEvents;
	for (const s of students) {
		s._fpPositions = [];
		if (!showFingerprint) continue;
		const mistakes = (s.langEvents || [])
			.filter(useFpTs ? _hasFpTs : _isFpEvent)
			.map((ev) => ({ ev, lang: ev.lang || "unk" }));
		if (!mistakes.length) continue;
		const positions = useFpTs
			? mistakes.map(({ ev }) => (ev.ts - fpMinTs) / fpRange)
			: mistakes.map((_, i) =>
					mistakes.length > 1 ? i / (mistakes.length - 1) : 0.5,
				);
		s._fpPositions = mistakes.map(({ lang }, i) => ({
			pos: positions[i],
			lang,
		}));
	}
	let fp2MaxBytes = 0;
	for (const s of students) {
		const extras = (s.langEvents || []).filter(
			(ev) => ev.kind === "extra" || ev.kind === "extra-star",
		);
		const { bytes, langs } = _buildByteFingerprint(extras, {
			trackLangs: true,
		});
		s._fp2Bytes = bytes;
		s._fp2Langs = langs;
		s._fp2Hash = "";
		s._fp2Count = extras.length;
		if (bytes.length > fp2MaxBytes) fp2MaxBytes = bytes.length;
	}
	if (fp2MaxBytes % 2) fp2MaxBytes++;
	for (const s of students) {
		while (s._fp2Bytes.length < fp2MaxBytes) s._fp2Bytes.push(0);
		s._fp2Hash = s._fp2Bytes.map((b) => String(b).padStart(3, "0")).join("-");
	}
	const hasAnyFp2 = fp2MaxBytes > 0;
	let fp3MaxBytes = 0;
	for (const s of students) {
		const evs = (s.commentEvents || []).filter((ev) => ev.kind === "extra");
		const { bytes } = _buildByteFingerprint(evs);
		s._fp3Bytes = bytes;
		s._fp3Hash = "";
		s._fp3Count = evs.length;
		if (bytes.length > fp3MaxBytes) fp3MaxBytes = bytes.length;
	}
	if (fp3MaxBytes % 2) fp3MaxBytes++;
	for (const s of students) {
		while (s._fp3Bytes.length < fp3MaxBytes) s._fp3Bytes.push(0);
		s._fp3Hash = s._fp3Bytes.map((b) => String(b).padStart(3, "0")).join("-");
	}
	const hasAnyFp3 = fp3MaxBytes > 0;
	_computeFingerprintMask(students);

	return { showFingerprint, hasAnyFp2, hasAnyFp3 };
}
