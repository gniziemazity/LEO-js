"use strict";

function parseStudentRows(remarksBuf) {
	const wbR = XLSX.read(remarksBuf, { type: "array", cellStyles: true });
	const sheetName = wbR.Sheets["Grades"]
		? "Grades"
		: wbR.Sheets["Remarks"]
			? "Remarks"
			: wbR.SheetNames[0];
	const wsR = wbR.Sheets[sheetName];
	const rowsR = XLSX.utils.sheet_to_json(wsR, {
		header: 1,
		defval: "",
	});
	const hdrR = (rowsR[0] || []).map((h) => String(h || "").trim());

	const iName = findCol(hdrR, /^(student|name|student.?name)$/i);
	const iId = findCol(hdrR, /^(student.?id|id)$/i);
	const iNum = findCol(hdrR, /^(number|no\.?|phone|tel|student.?no\.?)$/i);
	let iFollowPct = hdrR.indexOf("Follow (E)");
	let iFollowDesc = hdrR.indexOf("Follow (E) Desc");
	const iSimilarity = iFollowPct === -1 ? hdrR.indexOf("Similarity") : -1;
	if (iSimilarity !== -1) {
		iFollowPct = iSimilarity;
		iFollowDesc = hdrR.indexOf("Similarity Desc");
	}
	let iCommentDesc = hdrR.indexOf("Follow (C) Desc");
	if (iCommentDesc === -1) iCommentDesc = hdrR.indexOf("Sim (C) Desc");
	const iRemarksDesc = findCol(hdrR, /^remarks?\s*desc/i);

	const iInteractions = findCol(hdrR, /^interactions?$/i);
	let iExcluded = hdrR.indexOf("Category");
	if (iExcluded === -1) iExcluded = hdrR.indexOf("Excluded");
	const iDiverge = hdrR.indexOf("Diverge");
	const iChange = hdrR.indexOf("Change");
	const langDivIdx = {};
	const langChgIdx = {};
	for (const def of LANG_COL_DEFS) {
		const full = def.header || "";
		const stem = full.replace(/\s+\(E\)$/i, "").trim();
		const tryHeaders = [`${full} Div`, `${stem} Div`];
		for (const h of tryHeaders) {
			if (!h) continue;
			const i = hdrR.indexOf(h);
			if (i !== -1) {
				langDivIdx[def.key] = i;
				break;
			}
		}
		const tryHeadersChg = [`${full} Chg`, `${stem} Chg`];
		for (const h of tryHeadersChg) {
			if (!h) continue;
			const i = hdrR.indexOf(h);
			if (i !== -1) {
				langChgIdx[def.key] = i;
				break;
			}
		}
	}
	const langIdx = {};
	const langDescIdx = {};
	for (const def of LANG_COL_DEFS) {
		const i = hdrR.indexOf(def.header);
		if (i !== -1) langIdx[def.key] = i;
		const di = hdrR.indexOf(def.descHeader);
		if (di !== -1) langDescIdx[def.key] = di;
	}
	const specialSet = new Set(
		[
			iName,
			iId,
			iNum,
			iFollowPct,
			iFollowDesc,
			iRemarksDesc,
			iInteractions,
			iDiverge,
			iChange,
			...Object.values(langIdx),
			...Object.values(langDescIdx),
			...Object.values(langDivIdx),
			...Object.values(langChgIdx),
		].filter((i) => i !== -1),
	);

	const REMARK_WHITELIST =
		/^(remarks?|expected|obs\.?|interactions?|grade|comments?)$/i;
	const remarkCols = hdrR
		.map((name, idx) => ({ name, idx }))
		.filter(
			({ name, idx }) => !specialSet.has(idx) && REMARK_WHITELIST.test(name),
		);
	if (iName === -1) throw new Error('Remarks xlsx: missing "Student" column');

	const students = [];
	const unicodeCorruptionHits = [];
	const unicodeRepairHits = [];
	for (let i = 1; i < rowsR.length; i++) {
		const row = rowsR[i];
		const name = String(row[iName] || "").trim();
		if (!name || name === "undefined") continue;
		const _excVal =
			iExcluded !== -1
				? String(row[iExcluded] || "")
						.trim()
						.toUpperCase()
				: "";
		if (_excVal === "EXCLUDED") continue;
		const ai_flagged = _excVal === "LLM" || _excVal === "AI";
		const followPct = iFollowPct !== -1 ? parseFloat(row[iFollowPct]) : NaN;
		const followDesc =
			iFollowDesc !== -1 ? String(row[iFollowDesc] || "") : "";
		const followEvents = isNaN(followPct)
			? []
			: iSimilarity !== -1
				? parseSimilarityEvents(followDesc)
				: parseFollowEvents(followDesc);
		const remarksDesc =
			iRemarksDesc !== -1 ? String(row[iRemarksDesc] ?? "").trim() : "";
		const remarks = remarkCols.map(({ name: colName, idx }) => {
			const addr = XLSX.utils.encode_cell({ r: i, c: idx });
			const cell = wsR[addr];
			const note =
				cell && cell.c
					? cell.c
							.map((c) => c.t || "")
							.filter(Boolean)
							.join("\n")
							.trim()
					: "";
			const rawVal = String(row[idx] ?? "").trim();
			const repaired = repairLikelyAstralEmojiFallbacks(rawVal);
			if (repaired.repairedCount) {
				unicodeRepairHits.push({
					rowIndex: i + 1,
					name,
					column: colName,
					before: rawVal,
					after: repaired.text,
				});
			}
			const val = repaired.text;
			if (hasLikelyAstralTruncation(val)) {
				unicodeCorruptionHits.push({
					rowIndex: i + 1,
					name,
					column: colName,
					value: val,
				});
			}
			return {
				col: colName,
				val,
				note,
			};
		});
		const obsEmpty = (r) => /^obs$/i.test(r.col) && (r.val === "_" || !r.val);
		if (remarks.every((r) => !r.val || obsEmpty(r))) continue;
		const interactions =
			iInteractions !== -1
				? String(row[iInteractions] ?? "")
						.trim()
						.split(/[\s,;]+/)
						.filter(Boolean)
						.map((t) => INTERACTION_MAP[t.toUpperCase()] || t)
						.join("")
				: "";
		const langPcts = {};
		const langEvents = [];
		const langParser =
			iSimilarity !== -1 ? parseSimilarityEvents : parseFollowEvents;
		for (const def of LANG_COL_DEFS) {
			if (langIdx[def.key] != null) {
				const v = parseFloat(row[langIdx[def.key]]);
				if (!isNaN(v)) langPcts[def.key] = v;
			}
			if (langDescIdx[def.key] != null) {
				const descText = String(row[langDescIdx[def.key]] ?? "");
				for (const ev of langParser(descText)) {
					ev.lang = def.key;
					langEvents.push(ev);
				}
			}
		}
		const _evLangOf = new Map();
		for (const ev of langEvents) {
			_evLangOf.set(`${ev.kind}|${ev.token}|${ev.ts}`, ev.lang);
		}
		for (const ev of followEvents) {
			const _lang = _evLangOf.get(`${ev.kind}|${ev.token}|${ev.ts}`);
			if (_lang) ev.lang = _lang;
		}
		const commentDescText =
			iCommentDesc !== -1 ? String(row[iCommentDesc] ?? "") : "";
		const commentParser =
			hdrR[iCommentDesc] === "Sim (C) Desc"
				? parseSimilarityEvents
				: parseFollowEvents;
		const commentEvents = commentDescText
			? commentParser(commentDescText)
			: [];
		const divergeVal = iDiverge !== -1 ? parseFloat(row[iDiverge]) : NaN;
		const changeVal = iChange !== -1 ? parseFloat(row[iChange]) : NaN;
		const langDiv = {};
		const langChg = {};
		for (const def of LANG_COL_DEFS) {
			if (langDivIdx[def.key] != null) {
				const v = parseFloat(row[langDivIdx[def.key]]);
				if (!isNaN(v)) langDiv[def.key] = v;
			}
			if (langChgIdx[def.key] != null) {
				const v = parseFloat(row[langChgIdx[def.key]]);
				if (!isNaN(v)) langChg[def.key] = v;
			}
		}
		students.push({
			name,
			id: iId !== -1 ? String(row[iId] ?? "").trim() : "",
			num: iNum !== -1 ? String(row[iNum] ?? "").trim() : "",
			ai_flagged,
			followPct,
			followEvents,
			remarksDesc,
			remarks,
			interactions,
			langPcts,
			langEvents,
			commentEvents,
			divergence: isNaN(divergeVal) ? null : divergeVal,
			change: isNaN(changeVal) ? null : changeVal,
			langDiv,
			langChg,
			_rowIndex: i,
		});
	}
	students.sort((a, b) =>
		a.id.localeCompare(b.id, undefined, { numeric: true }),
	);
	warnLikelyAstralTruncation(unicodeCorruptionHits, unicodeRepairHits);
	const remarkColIdx = {};
	for (const { name, idx } of remarkCols) remarkColIdx[name] = idx;
	return {
		students,
		remarkCols: remarkCols.map((c) => c.name),
		remarkColIdx,
		hasInteractions: iInteractions !== -1,
		followLabel: iSimilarity !== -1 ? "SIM" : "FOLLOW",
		workbook: wbR,
		sheetName,
		headerRow: hdrR,
	};
}

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

function findCol(headers, re) {
	const idx = headers.findIndex((h) => re.test(h));
	return idx;
}

function parseSimilarityEvents(descText) {
	const events = [];
	const text = String(descText || "");
	const re =
		/([+-])(.+?)(?:\s+\(x(\d+)\)|\s+\((\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\))?(?=,\s+[+-]|$)/g;
	let m;
	while ((m = re.exec(text)) !== null) {
		const kind = m[1] === "-" ? "missing" : "extra";
		const token = m[2];
		if (m[4]) {
			events.push({ kind, token, ts: _hmsToSeconds(m[4]) });
		} else {
			const count = m[3] ? parseInt(m[3]) : 1;
			for (let i = 0; i < count; i++) events.push({ kind, token });
		}
	}
	return events;
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

function _sortKeyOf(s, sortCol) {
	if (sortCol === "id") return { type: "str", v: s.id || "" };
	if (sortCol === "name") return { type: "str", v: s.name || "" };
	if (sortCol === "num") return { type: "str", v: s.num || "" };
	if (sortCol === "follow") return { type: "num", v: s.followPct };
	if (sortCol === "diverge")
		return { type: "num", v: s.divergence == null ? NaN : s.divergence };
	if (sortCol === "change")
		return { type: "num", v: s.change == null ? NaN : s.change };
	if (sortCol === "int") return { type: "str", v: s.interactions || "" };
	if (sortCol === "fingerprint1") return { type: "str", v: s._fpMask };
	if (sortCol === "fingerprint2") return { type: "num", v: s._fp2Count };
	if (sortCol === "fingerprint3") return { type: "num", v: s._fp3Count };
	if (sortCol.startsWith("lang:")) {
		const k = sortCol.slice(5);
		const v = s.langPcts ? s.langPcts[k] : undefined;
		return { type: "num", v: v == null ? NaN : v };
	}
	if (sortCol.startsWith("artefact:")) {
		const idx = parseInt(sortCol.slice("artefact:".length), 10);
		const r = (s.remarks || []).find((x) => /^obs\.?$/i.test(x.col));
		const code = r && r.val ? String(r.val).trim() : "";
		const fired = /^[01]+$/.test(code) && code[idx] === "1" ? 1 : 0;
		return { type: "num", v: fired };
	}
	if (sortCol.startsWith("remark:")) {
		const col = sortCol.slice(7);
		const r = (s.remarks || []).find((x) => x.col === col);
		return { type: "str", v: r ? r.val || "" : "" };
	}
	return { type: "str", v: "" };
}

function _sortStudents(students, sortCol, sortDir) {
	const dir = sortDir === "desc" ? -1 : 1;
	const idCmp = (a, b) =>
		String(a.id || "").localeCompare(String(b.id || ""), undefined, {
			numeric: true,
		});
	return [...students].sort((a, b) => {
		const ka = _sortKeyOf(a, sortCol);
		const kb = _sortKeyOf(b, sortCol);
		let c;
		if (ka.type === "num") {
			const aN = ka.v == null || isNaN(ka.v);
			const bN = kb.v == null || isNaN(kb.v);
			if (aN && bN) c = 0;
			else if (aN) return 1;
			else if (bN) return -1;
			else c = ka.v - kb.v;
		} else {
			const aE = !ka.v;
			const bE = !kb.v;
			if (aE && bE) c = 0;
			else if (aE) return 1;
			else if (bE) return -1;
			else
				c = String(ka.v).localeCompare(String(kb.v), undefined, {
					numeric: true,
				});
		}
		if (c === 0) return idCmp(a, b);
		return c * dir;
	});
}

function _onSortHeaderClick(sortKey) {
	if (_sortCol === sortKey) {
		_sortDir = _sortDir === "asc" ? "desc" : "asc";
	} else {
		_sortCol = sortKey;
		_sortDir = "asc";
	}
	renderTable();
}
