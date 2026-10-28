"use strict";

function parseStudentRows(remarksBuf) {
	const {
		wb: wbR,
		sheetName,
		ws: wsR,
		rows: rowsR,
		hdr: hdrR,
	} = readRemarksSheet(remarksBuf, { cellStyles: true });

	const iName = findCol(hdrR, /^(student|name|student.?name)$/i);
	const iId = findCol(hdrR, /^(student.?id|id)$/i);
	const iNum = findCol(hdrR, /^(number|no\.?|phone|tel|student.?no\.?)$/i);
	const {
		pct: iFollowPct,
		desc: iFollowDesc,
		isSimilarity,
	} = remarksScoreCols(hdrR);
	let iCommentDesc = hdrR.indexOf("Follow (C) Desc");
	if (iCommentDesc === -1) iCommentDesc = hdrR.indexOf("Sim (C) Desc");
	const iRemarksDesc = findCol(hdrR, /^remarks?\s*desc/i);

	const iInteractions = findCol(hdrR, /^interactions?$/i);
	const iExcluded = hdrR.indexOf("Category");
	const langCols = remarksLangCols(hdrR);
	const specialSet = new Set(
		[
			iName,
			iId,
			iNum,
			iFollowPct,
			iFollowDesc,
			iRemarksDesc,
			iInteractions,
			...langCols.flatMap((c) => [c.pct, c.desc]),
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
			: isSimilarity
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
		let _ia = 0,
			_iq = 0,
			_ih = 0;
		if (iInteractions !== -1) {
			for (const ch of String(row[iInteractions] ?? "").toUpperCase()) {
				if (ch === "A") _ia++;
				else if (ch === "Q") _iq++;
				else if (ch === "H") _ih++;
			}
		}
		const langPcts = {};
		const langEvents = [];
		const langParser = isSimilarity
			? parseSimilarityEvents
			: parseFollowEvents;
		for (const col of langCols) {
			if (col.pct !== -1) {
				const v = parseFloat(row[col.pct]);
				if (!isNaN(v)) langPcts[col.key] = v;
			}
			if (col.desc !== -1) {
				const descText = String(row[col.desc] ?? "");
				for (const ev of langParser(descText)) {
					ev.lang = col.key;
					langEvents.push(ev);
				}
			}
		}
		tagEventLangs(followEvents, langEvents);
		const commentDescText =
			iCommentDesc !== -1 ? String(row[iCommentDesc] ?? "") : "";
		const commentParser =
			hdrR[iCommentDesc] === "Sim (C) Desc"
				? parseSimilarityEvents
				: parseFollowEvents;
		const commentEvents = commentDescText
			? commentParser(commentDescText)
			: [];
		students.push({
			name,
			id: iId !== -1 ? String(row[iId] ?? "").trim() : "",
			num: iNum !== -1 ? String(row[iNum] ?? "").trim() : "",
			ai_flagged,
			followPct,
			followEvents,
			remarksDesc,
			remarks,
			total_a: _ia,
			total_q: _iq,
			total_h: _ih,
			langPcts,
			langEvents,
			commentEvents,
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
		scoreKind: isSimilarity ? "similarity" : "follow",
		followLabel: isSimilarity ? "SIM" : "FOLLOW",
		workbook: wbR,
		sheetName,
		headerRow: hdrR,
	};
}

function findCol(headers, re) {
	const idx = headers.findIndex((h) => re.test(h));
	return idx;
}
