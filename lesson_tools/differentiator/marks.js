"use strict";

function _codePointToUtf16Map(text) {
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		if (c >= 0xd800 && c <= 0xdbff) {
			const map = new Array(text.length + 1);
			let u16 = 0;
			let cp = 0;
			let j = 0;
			while (j < text.length) {
				map[cp++] = u16;
				const code = text.charCodeAt(j);
				if (
					code >= 0xd800 &&
					code <= 0xdbff &&
					j + 1 < text.length &&
					text.charCodeAt(j + 1) >= 0xdc00 &&
					text.charCodeAt(j + 1) <= 0xdfff
				) {
					u16 += 2;
					j += 2;
				} else {
					u16 += 1;
					j += 1;
				}
			}
			map[cp] = u16;
			return map;
		}
	}
	return null;
}

function _synthesizeLeoMarks(side, fileName) {
	const tokens = _currentMarksEntry?.leo_assignments?.tokens;
	if (!tokens || !fileName) return [];
	const isCuratedMode =
		typeof _curatedEditMode !== "undefined" && _curatedEditMode;
	const files = side === "teacher" ? _teacherFiles : _studentFiles;
	const text = (files && files[fileName] ? files[fileName] : "").replace(
		/\r\n/g,
		"\n",
	);
	const u16map = _codePointToUtf16Map(text);
	const toU16 = u16map ? (cp) => (cp < u16map.length ? u16map[cp] : cp) : null;
	const out = [];
	for (const [tok, data] of Object.entries(tokens)) {
		const list = side === "teacher" ? data.teacher : data.student;
		for (const inst of list) {
			if (inst.file !== fileName) continue;
			if (inst.ghost) continue;
			const start = toU16 ? toU16(inst.pos) : inst.pos;
			out.push({
				token: tok,
				label: isCuratedMode ? null : inst.label || null,
				start,
				end: start + tok.length,
				_synth: true,
			});
		}
	}
	return out;
}

function _mergeMarks(realMarks, synthMarks) {
	const byStart = new Map();
	for (const m of synthMarks) byStart.set(m.start, m);
	for (const m of realMarks || []) byStart.set(m.start, m);
	return [...byStart.values()].sort((a, b) => a.start - b.start);
}

function diffColorizePositions(
	text,
	posMarks,
	side,
	ghosts,
	anchors,
	fileName,
	fullText,
) {
	const ghostList = ghosts || [];
	const anchorList = anchors || [];
	if (
		(!posMarks || !posMarks.length) &&
		!ghostList.length &&
		!anchorList.length
	)
		return escHtml(text);
	const hasAssignments = !!_currentMarksEntry?.leo_assignments?.tokens;
	const tokensTbl = hasAssignments
		? _currentMarksEntry.leo_assignments.tokens
		: null;

	const wrappable = (posMarks || []).filter((m) => {
		if (m.label && MARK_COLORS[m.label]) return true;
		if (tokensTbl && side && m.token && tokensTbl[m.token]) return true;
		return false;
	});
	if (!wrappable.length && !ghostList.length && !anchorList.length)
		return escHtml(text);

	const normText = text.replace(/\r\n/g, "\n");

	wrappable.sort((a, b) => a.start - b.start || b.end - a.end);
	const kept = [];
	let lastEnd = 0;
	for (const m of wrappable) {
		if (m.start >= lastEnd) {
			kept.push(m);
			lastEnd = m.end;
		}
	}

	const events = [];
	for (const m of kept) {
		events.push({ pos: m.start, kind: "open", mark: m });
		events.push({ pos: m.end, kind: "close" });
	}
	for (const g of ghostList) {
		events.push({ pos: g.pos, kind: "ghost", ghost: g });
	}
	for (const a of anchorList) {
		events.push({ pos: a.pos, kind: "anchor", anchor: a });
	}
	const ord = { close: 0, anchor: 1, ghost: 2, open: 3 };
	events.sort((a, b) => a.pos - b.pos || ord[a.kind] - ord[b.kind]);

	let out = "",
		pos = 0;
	for (const ev of events) {
		if (ev.pos > pos) {
			out += escHtml(normText.slice(pos, ev.pos));
			pos = ev.pos;
		}
		if (ev.kind === "open") {
			const m = ev.mark;
			let color =
				m.label && MARK_COLORS[m.label] ? MARK_COLORS[m.label] : null;
			if (m.label === "missing" && fileName) {
				const absStart = m._abs_start ?? m.start;
				color = _diffMissingColorAt(fileName, fullText || text, absStart);
			}
			const absPos = m._abs_start ?? m.start;
			const otherSide = side === "teacher" ? "student" : "teacher";
			const isGhostPair = !!(m.paired_with && m.paired_with.ghost);
			let teacherPairColor = null;
			if (side === "student" && m.paired_with && !isGhostPair) {
				const tFile = m.paired_with.file;
				const tPos = m.paired_with.start;
				const tText =
					typeof _teacherFiles !== "undefined" && tFile
						? (_teacherFiles[tFile] || "").replace(/\r\n/g, "\n")
						: "";
				teacherPairColor = _diffMissingColorAt(tFile, tText, tPos);
			}
			const decorAttr = teacherPairColor
				? `text-decoration-color:${teacherPairColor};`
				: "";
			const styleAttr =
				color || decorAttr
					? ` style="${color ? `color:${color};font-weight:bold;` : ""}${decorAttr}"`
					: "";
			const pairedAttrs =
				m.paired_with && !isGhostPair
					? ` data-swap-side="${otherSide}"` +
						` data-swap-file="${escAttr(m.paired_with.file)}"` +
						` data-swap-pos="${m.paired_with.start}"` +
						` data-swap-token="${escAttr(m.paired_with.token)}"`
					: "";
			const insertAttrs = m.insert_at
				? ` data-insert-side="${otherSide}"` +
					` data-insert-file="${escAttr(m.insert_at.file)}"` +
					` data-insert-pos="${m.insert_at.pos}"`
				: "";
			const isWhitespace = !!(m.token && /^\s+$/.test(m.token));
			let leoClass =
				m.paired_with && !isGhostPair
					? "leo-mark swap-paired"
					: m.insert_at
						? "leo-mark insert-source"
						: "leo-mark";
			if (isWhitespace) leoClass += " is-whitespace";
			const leoAttrs =
				m.token &&
				m.label !== "comment" &&
				(color || (tokensTbl && tokensTbl[m.token]))
					? ` class="${leoClass}" data-leo-token="${escAttr(m.token)}" data-leo-side="${side}" data-leo-pos="${absPos}"${pairedAttrs}${insertAttrs}`
					: "";
			out += `<span${leoAttrs}${styleAttr}>`;
		} else if (ev.kind === "close") {
			out += "</span>";
		} else if (ev.kind === "ghost") {
			out += _renderGhostBlob(ev.ghost, tokensTbl);
		} else {
			const a = ev.anchor;
			const absPos = a._abs_pos ?? a.pos;
			const isMove = a.move_source_pos != null;
			const cls = isMove
				? "insert-anchor insert-anchor--move"
				: "insert-anchor";
			const sourceAttrs = isMove
				? ` data-insert-anchor-move-source-file="${escAttr(a.move_source_file)}"` +
					` data-insert-anchor-move-source-pos="${a.move_source_pos}"`
				: ` data-insert-anchor-teacher-file="${escAttr(a.teacher_file)}"` +
					` data-insert-anchor-teacher-pos="${a.teacher_pos}"`;
			let anchorStyle = "";
			if (!isMove && a.teacher_file != null) {
				const tFile = a.teacher_file;
				const tText =
					typeof _teacherFiles !== "undefined" && tFile
						? (_teacherFiles[tFile] || "").replace(/\r\n/g, "\n")
						: "";
				const c = _diffMissingColorAt(tFile, tText, a.teacher_pos);
				anchorStyle = ` style="--insert-anchor-color:${c}"`;
			}
			out +=
				`<span class="${cls}"${anchorStyle}` +
				` data-insert-anchor-pos="${absPos}"` +
				` data-insert-anchor-token="${escAttr(a.token)}"` +
				`${sourceAttrs}>▾</span>`;
		}
	}
	if (pos < normText.length) {
		out += escHtml(normText.slice(pos));
	}
	return out;
}
