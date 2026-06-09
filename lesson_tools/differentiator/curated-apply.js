"use strict";

function _curatedBackwardWhitespace(text, pos) {
	if (pos <= 0 || !/\s/.test(text[pos - 1])) return "";
	let i = pos;
	while (i > 0 && /\s/.test(text[i - 1])) i--;
	return text.slice(i, pos);
}

function _curatedForwardWhitespace(text, pos) {
	if (pos >= text.length || !/\s/.test(text[pos])) return "";
	let i = pos;
	while (i < text.length && /\s/.test(text[i])) i++;
	return text.slice(pos, i);
}

function _curatedLineIndentAt(text, pos) {
	let end = pos;
	while (end > 0) {
		const ls = text.lastIndexOf("\n", end - 1) + 1;
		const line = text.slice(ls, end);
		if (line.trim()) return (line.match(/^[ \t]*/) || [""])[0];
		end = ls - 1;
	}
	return "";
}

function _curatedDedentBlock(body) {
	const lines = body.split("\n");
	if (lines.length < 2) return body;
	const startIdx = /^[ \t\n]/.test(body) ? 0 : 1;
	let minIndent = Infinity;
	for (let i = startIdx; i < lines.length; i++) {
		const line = lines[i];
		if (line.length === 0) continue;
		const m = line.match(/^[ \t]*/);
		const indentLen = m[0].length;
		if (indentLen === line.length) continue;
		if (indentLen < minIndent) minIndent = indentLen;
	}
	if (!isFinite(minIndent) || minIndent === 0) return body;
	return lines
		.map((l, i) =>
			i >= startIdx && l.length >= minIndent ? l.slice(minIndent) : l,
		)
		.join("\n");
}

function _curatedAlignWhitespace(
	srcText,
	srcStart,
	srcEnd,
	dstText,
	dstStart,
	dstEnd,
	bodyOverride,
	canExtendLeft,
	canExtendRight,
) {
	const srcLead = _curatedBackwardWhitespace(srcText, srcStart);
	const dstLead = _curatedBackwardWhitespace(dstText, dstStart);
	const srcTrail = _curatedForwardWhitespace(srcText, srcEnd);
	const dstTrail = _curatedForwardWhitespace(dstText, dstEnd);

	let text =
		bodyOverride !== undefined
			? bodyOverride
			: srcText.slice(srcStart, srcEnd);
	let aStart = dstStart;
	let aEnd = dstEnd;

	if (srcLead && !dstLead) text = srcLead + text;
	else if (!srcLead && dstLead && !dstLead.includes("\n")) {
		const newStart = dstStart - dstLead.length;
		if (!canExtendLeft || canExtendLeft(newStart)) aStart = newStart;
	}

	if (srcTrail && !dstTrail) text = text + srcTrail;
	else if (!srcTrail && dstTrail && !dstTrail.includes("\n")) {
		const newEnd = dstEnd + dstTrail.length;
		if (!canExtendRight || canExtendRight(newEnd)) aEnd = newEnd;
	}

	return { text, start: aStart, end: aEnd };
}

function _curatedAbsorbWhitespaceGaps(text, items, get) {
	const ordered = items
		.slice()
		.sort((a, b) => get.start(a) - get.start(b) || get.end(a) - get.end(b));
	for (let i = 0; i + 1 < ordered.length; i++) {
		const a = ordered[i];
		const b = ordered[i + 1];
		if (get.end(a) > get.start(b)) continue;
		const gap = text.slice(get.end(a), get.start(b));
		if (!gap || !/^[ \t]+$/.test(gap)) continue;
		if (get.isDel(a)) get.setEnd(a, get.start(b));
		else if (get.isDel(b)) get.setStart(b, get.end(a));
	}
}

function _curatedCleanupCorrectedText(text) {
	const delRe = new RegExp(
		CURATED_DEL_OPEN + "[^" + CURATED_DEL_CLOSE + "]*" + CURATED_DEL_CLOSE,
		"g",
	);
	const collapse = (s) => {
		let out = "";
		let last = 0;
		let m;
		delRe.lastIndex = 0;
		while ((m = delRe.exec(s)) !== null) {
			out += s.slice(last, m.index).replace(/ {2,}/g, " ") + m[0];
			last = m.index + m[0].length;
		}
		return out + s.slice(last).replace(/ {2,}/g, " ");
	};
	const lines = text.split("\n").map((line) => {
		const indent = (line.match(/^[ \t]*/) || [""])[0];
		return indent + collapse(line.slice(indent.length));
	});
	const isBlank = (l) => /^[ \t]*$/.test(l);
	let s = 0;
	let e = lines.length - 1;
	while (s <= e && isBlank(lines[s])) s++;
	while (e >= s && isBlank(lines[e])) e--;
	return lines.slice(s, e + 1).join("\n");
}

const CURATED_INS_OPEN = String.fromCharCode(0xe000);
const CURATED_INS_CLOSE = String.fromCharCode(0xe001);
const CURATED_DEL_OPEN = String.fromCharCode(0xe002);
const CURATED_DEL_CLOSE = String.fromCharCode(0xe003);
const CURATED_DEL_NL = String.fromCharCode(0xe004);
const CURATED_REINDENT = true;

function _curatedApplyToStudent(opts) {
	const _mark = !!(opts && opts.mark);
	const out = {};
	const curatedData = _curatedMarks();
	if (!curatedData) return out;
	const studentNames = Object.keys(_studentFiles || {});
	const groups = _curatedGroupMarks();
	const filePairs = (curatedData && curatedData.file_pairs) || {};

	for (const studentName of studentNames) {
		let text = _curatedSrcText("student", studentName);
		const origText = text;
		const ops = [];
		let order = 0;
		const pushOp = (op) => {
			op.order = order++;
			ops.push(op);
		};

		const studentExtras = groups
			.filter(
				(group) =>
					group.side === "student" &&
					group.file === studentName &&
					(group.kind === "extra" || group.kind === "ghost_extra"),
			)
			.slice()
			.sort((a, b) => a.lo - b.lo);
		const teacherMissings = groups
			.filter(
				(group) =>
					group.side === "teacher" &&
					group.kind === "missing-insert" &&
					group.insertFile === studentName,
			)
			.slice()
			.sort((a, b) => a.lo - b.lo);
		const teacherFile = teacherMissings[0]?.file ?? null;
		const allTeacherTokens = teacherFile
			? _curatedTokensForFile("teacher", teacherFile)
			: [];
		const consumedMissings = new Set();
		for (const extraGroup of studentExtras) {
			const candidates = teacherMissings
				.filter(
					(group) =>
						!consumedMissings.has(group) &&
						group.insertPos >= extraGroup.lo &&
						group.insertPos <= extraGroup.hi,
				)
				.slice()
				.sort((a, b) => a.lo - b.lo);
			if (!candidates.length) continue;
			const contiguous = [candidates[0]];
			for (let i = 1; i < candidates.length; i++) {
				const prevHigh = contiguous[contiguous.length - 1].hi;
				const nextLow = candidates[i].lo;
				let hasKeptToken = false;
				for (const tok of allTeacherTokens) {
					if (tok.start < prevHigh) continue;
					if (tok.start >= nextLow) break;
					hasKeptToken = true;
					break;
				}
				if (hasKeptToken) break;
				contiguous.push(candidates[i]);
			}
			const teacherLo = contiguous[0].lo;
			const teacherHi = contiguous[contiguous.length - 1].hi;
			extraGroup._coalesced = {
				tLo: teacherLo,
				tHi: teacherHi,
				body: _curatedSliceExcludingComments(
					"teacher",
					contiguous[0].file,
					teacherLo,
					teacherHi,
				),
			};
			for (const missingGroup of contiguous)
				consumedMissings.add(missingGroup);
		}
		const rawOps = [];
		for (const group of groups) {
			if (
				group.side === "teacher" &&
				group.kind === "missing-insert" &&
				group.insertFile === studentName
			) {
				if (consumedMissings.has(group)) continue;
				const body = _curatedSliceExcludingComments(
					"teacher",
					group.file,
					group.lo,
					group.hi,
				);
				rawOps.push({
					kind: "insert",
					origStart: group.insertPos,
					origEnd: group.insertPos,
					srcFile: group.file,
					srcStart: group.lo,
					srcEnd: group.hi,
					body,
				});
			} else if (
				group.side === "student" &&
				group.kind === "extra-replace" &&
				group.file === studentName
			) {
				const body = _curatedSliceExcludingComments(
					"teacher",
					group.pairFile,
					group.pairLo,
					group.pairHi,
				);
				rawOps.push({
					kind: "swap",
					origStart: group.lo,
					origEnd: group.hi,
					srcFile: group.pairFile,
					srcStart: group.pairLo,
					srcEnd: group.pairHi,
					body,
				});
			} else if (
				group.side === "student" &&
				(group.kind === "extra" || group.kind === "ghost_extra") &&
				group.file === studentName
			) {
				if (group._coalesced) {
					rawOps.push({
						kind: "coal",
						origStart: group.lo,
						origEnd: group.hi,
						body: group._coalesced.body,
					});
					delete group._coalesced;
				} else {
					rawOps.push({
						kind: "del",
						origStart: group.lo,
						origEnd: group.hi,
						body: "",
					});
				}
			} else if (
				group.side === "student" &&
				group.kind === "extra-move" &&
				group.file === studentName
			) {
				const body = origText.slice(group.lo, group.hi);
				rawOps.push({
					kind: "del",
					origStart: group.lo,
					origEnd: group.hi,
					body: "",
				});
				if (group.moveFile === studentName) {
					rawOps.push({
						kind: "move-ins",
						origStart: group.movePos,
						origEnd: group.movePos,
						body,
					});
				}
			}
		}

		_curatedAbsorbWhitespaceGaps(origText, rawOps, {
			start: (o) => o.origStart,
			end: (o) => o.origEnd,
			isDel: (o) => o.kind === "del",
			setStart: (o, v) => (o.origStart = v),
			setEnd: (o, v) => (o.origEnd = v),
		});
		const siblings = rawOps.map((op) => [op.origStart, op.origEnd]);
		for (let i = 0; i < rawOps.length; i++) {
			const op = rawOps[i];
			const canExtendLeft = (newStart) => {
				if (newStart >= op.origStart) return true;
				for (let j = 0; j < siblings.length; j++) {
					if (j === i) continue;
					const [bLo, bHi] = siblings[j];
					if (newStart <= bLo && bLo <= op.origStart) return false;
					if (newStart <= bHi && bHi <= op.origStart) return false;
				}
				return true;
			};
			const canExtendRight = (newEnd) => {
				if (newEnd <= op.origEnd) return true;
				for (let j = 0; j < siblings.length; j++) {
					if (j === i) continue;
					const [bLo, bHi] = siblings[j];
					if (op.origEnd <= bLo && bLo <= newEnd) return false;
					if (op.origEnd <= bHi && bHi <= newEnd) return false;
				}
				return true;
			};
			if (op.kind === "insert" || op.kind === "swap") {
				const teacherSrc = _curatedSrcText("teacher", op.srcFile);
				const aligned = _curatedAlignWhitespace(
					teacherSrc,
					op.srcStart,
					op.srcEnd,
					origText,
					op.origStart,
					op.origEnd,
					op.body,
					canExtendLeft,
					canExtendRight,
				);
				pushOp({
					start: aligned.start,
					end: aligned.end,
					text: aligned.text,
				});
			} else {
				pushOp({ start: op.origStart, end: op.origEnd, text: op.body });
			}
		}
		ops.sort((a, b) => {
			if (a.start !== b.start) return b.start - a.start;
			const aLen = a.end - a.start;
			const bLen = b.end - b.start;
			if (aLen !== bLen) return bLen - aLen;
			return b.order - a.order;
		});
		const _alnum = /[a-zA-Z0-9]/;
		const _nonAlnum = /[^a-zA-Z0-9]/;
		for (const op of ops) {
			let body = op.text;
			if (body) {
				const before = text[op.start - 1];
				const after = text[op.end];
				const first = body[0];
				const last = body[body.length - 1];
				if (before && _alnum.test(before) && _alnum.test(first)) {
					body = " " + body;
				}
				if (after && _alnum.test(after) && _alnum.test(last)) {
					body = body + " ";
				}
			} else {
				const before = text[op.start - 1];
				const after = text[op.end];
				if (before && after && _alnum.test(before) && _alnum.test(after)) {
					const deleted = text.slice(op.start, op.end);
					const isAllWhitespace = /^\s+$/.test(deleted);
					if (!isAllWhitespace && _nonAlnum.test(deleted)) body = " ";
				}
			}
			if (_mark) {
				const removed = text.slice(op.start, op.end);
				const del = removed
					? CURATED_DEL_OPEN +
						removed.replace(/\n/g, CURATED_DEL_NL) +
						CURATED_DEL_CLOSE
					: "";
				const ins = op.text
					? CURATED_INS_OPEN + body + CURATED_INS_CLOSE
					: "";
				if (del || ins) body = del + ins;
			}
			text = text.slice(0, op.start) + body + text.slice(op.end);
		}
		const outName = filePairs[studentName] || studentName;
		out[outName] = _curatedCleanupCorrectedText(text);
	}

	const teacherNames = Object.keys(_teacherFiles || {});
	const studentNamesAll = Object.keys(_studentFiles || {});
	const studentExts = new Set(studentNamesAll.map(getFileExt).filter(Boolean));
	for (const teacherName of teacherNames) {
		if (out[teacherName] != null) continue;
		if (_studentFiles && _studentFiles[teacherName] != null) continue;
		const ext = getFileExt(teacherName);
		if (ext && studentExts.has(ext)) continue;
		out[teacherName] = _teacherFiles[teacherName] || "";
	}
	return out;
}

function _curatedReindent(text, ext, lp) {
	const LP = lp || (typeof window !== "undefined" && window.LanguageProfiles);
	if (!LP || !LP.shouldIncreaseAfter || !LP.getProfile) return text;
	const e = (ext || "").toLowerCase().replace(/^\./, "");
	let mode =
		e === "html" || e === "htm"
			? "html"
			: e === "css"
				? "css"
				: e === "js" || e === "javascript"
					? "js"
					: null;
	if (!mode) return text;
	const profs = {
		html: LP.getProfile("html"),
		css: LP.getProfile("css"),
		js: LP.getProfile("javascript"),
	};
	if (!profs[mode]) return text;
	const isHtml = mode === "html";
	const _delRe = new RegExp(
		CURATED_DEL_OPEN + "[^" + CURATED_DEL_CLOSE + "]*" + CURATED_DEL_CLOSE,
		"g",
	);
	const strip = (s) =>
		s.replace(_delRe, "").replace(new RegExp("[\uE000-\uE003]", "g"), "");
	const out = [];
	let depth = 0;
	for (const raw of text.split("\n")) {
		const lead = (raw.match(/^[ \t]*/) || [""])[0];
		const rest = raw.slice(lead.length);
		const clean = strip(rest).replace(/\s+$/, "");
		if (clean === "") {
			const marksOnly = rest.replace(/[ \t]/g, "");
			if (marksOnly) out.push("\t".repeat(depth) + marksOnly);
			else if (out.length && out[out.length - 1] !== "") out.push("");
			continue;
		}
		let prof = profs[mode] || profs.html;
		if (isHtml && mode !== "html" && /<\/\s*(style|script)\b/i.test(clean)) {
			mode = "html";
			prof = profs.html;
		}
		let d = depth;
		if (LP.shouldDecreaseOnLine(prof, clean)) d = Math.max(0, d - 1);
		out.push("\t".repeat(d) + rest);
		let nd = d;
		if (LP.shouldIncreaseAfter(prof, clean)) nd = d + 1;
		else if (LP.shouldDecreaseAfter(prof, clean)) nd = Math.max(0, d - 1);
		depth = nd;
		if (isHtml && mode === "html") {
			const m = clean.match(/<\s*(style|script)\b[^>]*>/i);
			if (m && !/<\/\s*(style|script)\b/i.test(clean)) {
				mode = m[1].toLowerCase() === "style" ? "css" : "js";
			}
		}
	}
	return out.join("\n");
}

function _curatedMarkedToHtml(text) {
	const delRe = new RegExp(
		CURATED_DEL_OPEN + "([^" + CURATED_DEL_CLOSE + "]*)" + CURATED_DEL_CLOSE,
		"g",
	);
	return escHtml(text)
		.replace(delRe, (_m, content) => {
			const code = content.split(CURATED_DEL_NL).join("\n");
			return `<span class="tw-del">${code}</span>`;
		})
		.split(CURATED_INS_OPEN)
		.join('<span class="tw-ins">')
		.split(CURATED_INS_CLOSE)
		.join("</span>");
}

function _curatedChangedGroups(lines) {
	const markRe = new RegExp(
		"[" +
			CURATED_INS_OPEN +
			CURATED_INS_CLOSE +
			CURATED_DEL_OPEN +
			CURATED_DEL_CLOSE +
			"]",
	);
	const groups = [];
	let insideIns = 0;
	for (let i = 0; i < lines.length; i++) {
		const changed = insideIns > 0 || markRe.test(lines[i]);
		for (const ch of lines[i]) {
			if (ch === CURATED_INS_OPEN) insideIns++;
			else if (ch === CURATED_INS_CLOSE) insideIns--;
		}
		if (insideIns < 0) insideIns = 0;
		if (!changed) continue;
		const last = groups[groups.length - 1];
		if (last && i - last[1] <= 2) last[1] = i;
		else groups.push([i, i]);
	}
	return groups;
}

function _curatedDedentSnippet(text) {
	const lines = text.split("\n");
	let min = Infinity;
	for (const l of lines) {
		if (!l.trim()) continue;
		const n = (l.match(/^[ \t]*/) || [""])[0].length;
		if (n < min) min = n;
	}
	if (!isFinite(min) || min === 0) return text;
	return lines.map((l) => l.slice(min)).join("\n");
}

function _curatedStudentLineMap(marked) {
	const lines = marked.split("\n");
	const map = [];
	let line = 1;
	let inIns = 0;
	for (let li = 0; li < lines.length; li++) {
		map.push(line);
		for (const ch of lines[li]) {
			if (ch === CURATED_INS_OPEN) inIns++;
			else if (ch === CURATED_INS_CLOSE) {
				inIns--;
				if (inIns < 0) inIns = 0;
			} else if (inIns === 0 && ch === CURATED_DEL_NL) line++;
		}
		if (inIns === 0) line++;
	}
	return map;
}

function _curatedCorrectionsData() {
	const out = _curatedApplyToStudent({ mark: true });
	const rank = (n) => {
		const r = { html: 0, htm: 0, js: 1, css: 2 };
		const e = getFileExt(n);
		return r[e] != null ? r[e] : 3;
	};
	const names = Object.keys(out).sort(
		(a, b) => rank(a) - rank(b) || a.localeCompare(b),
	);
	const showHeaders = names.length > 1;
	const blocks = [];
	for (const name of names) {
		const marked = out[name];
		const lines = marked.split("\n");
		const stuMap = _curatedStudentLineMap(marked);
		const groups = _curatedChangedGroups(lines);
		if (!groups.length) continue;
		if (showHeaders) blocks.push({ type: "file", text: name });
		for (const [s, e] of groups.slice().reverse()) {
			const snippetLines = [];
			for (const l of lines.slice(s, e + 1)) {
				const blank = l.trim() === "";
				if (
					blank &&
					snippetLines.length &&
					snippetLines[snippetLines.length - 1].trim() === ""
				)
					continue;
				snippetLines.push(l);
			}
			const snippetText = snippetLines.join("\n");
			const formatted = CURATED_REINDENT
				? _curatedReindent(snippetText, getFileExt(name))
				: _curatedDedentSnippet(snippetText);
			blocks.push({
				type: "snippet",
				label: "line " + stuMap[s],
				marked: formatted,
				file: name,
			});
		}
	}
	return blocks;
}

function _curatedMarkedToSegLines(marked) {
	const out = [[]];
	let style = "normal";
	let cur = "";
	const flush = () => {
		if (cur) out[out.length - 1].push({ text: cur, style });
		cur = "";
	};
	for (const ch of String(marked)) {
		if (ch === CURATED_INS_OPEN) {
			flush();
			style = "ins";
		} else if (ch === CURATED_INS_CLOSE) {
			flush();
			style = "normal";
		} else if (ch === CURATED_DEL_OPEN) {
			flush();
			style = "del";
		} else if (ch === CURATED_DEL_CLOSE) {
			flush();
			style = "normal";
		} else if (ch === CURATED_DEL_NL || ch === "\n") {
			flush();
			out.push([]);
		} else {
			cur += ch;
		}
	}
	flush();
	return out;
}

function _curatedDownloadCorrectionsImage() {
	const blocks = _curatedCorrectionsData();
	if (!blocks.length) return;
	const fontSize = 12;
	const lineH = Math.round(fontSize * 1.5);
	const pad = 14;
	const boxPad = 6;
	const gap = Math.round(lineH * 0.5);
	const font = fontSize + "px Consolas, 'Courier New', monospace";
	const cv = (n, fb) => _cssVar(n) || fb;
	const textCol = cv("--clr-text", "#1a1a1a");
	const colors = {
		bg: cv("--clr-bg", "#ffffff"),
		text: textCol,
		ins: cv("--clr-mark-missing", "#cc2222"),
		del: cv("--clr-mark-extra", "#000000"),
		label: cv("--clr-muted", "#888888"),
		file: cv("--clr-label", "#555555"),
		border: cv("--clr-border-mid", "#cccccc"),
	};
	const meas = document.createElement("canvas").getContext("2d");
	meas.font = font;
	const segW = (seg) => {
		meas.font = seg.style === "del" ? "bold " + font : font;
		return meas.measureText(seg.text).width;
	};
	let height = pad * 2;
	let width = 0;
	const items = [];
	for (const b of blocks) {
		if (b.type === "file") {
			items.push({ kind: "file", text: b.text });
			width = Math.max(width, meas.measureText(b.text).width);
			height += lineH;
			continue;
		}
		items.push({ kind: "label", text: b.label });
		width = Math.max(width, meas.measureText(b.label).width);
		height += lineH;
		const segLines = _curatedMarkedToSegLines(b.marked);
		let boxW = 0;
		for (const sl of segLines) {
			const w = sl.reduce((a, s) => a + segW(s), 0);
			boxW = Math.max(boxW, w);
		}
		boxW += boxPad * 2;
		width = Math.max(width, boxW);
		items.push({ kind: "code", segLines, boxW });
		height += segLines.length * lineH + boxPad * 2 + gap;
	}
	const dpr = 2;
	const W = Math.ceil(width + pad * 2);
	const H = Math.ceil(height);
	const canvas = document.createElement("canvas");
	canvas.width = W * dpr;
	canvas.height = H * dpr;
	const ctx = canvas.getContext("2d");
	ctx.scale(dpr, dpr);
	ctx.fillStyle = colors.bg;
	ctx.fillRect(0, 0, W, H);
	ctx.textBaseline = "top";
	let y = pad;
	for (const it of items) {
		if (it.kind === "file") {
			ctx.font = "bold " + font;
			ctx.fillStyle = colors.file;
			ctx.fillText(it.text, pad, y);
			y += lineH;
			continue;
		}
		if (it.kind === "label") {
			ctx.font = font;
			ctx.fillStyle = colors.label;
			ctx.fillText(it.text, pad, y);
			y += lineH;
			continue;
		}
		const boxH = it.segLines.length * lineH + boxPad * 2;
		ctx.strokeStyle = colors.border;
		ctx.lineWidth = 1;
		ctx.strokeRect(pad + 0.5, y + 0.5, it.boxW - 1, boxH - 1);
		ctx.font = font;
		let ly = y + boxPad;
		for (const sl of it.segLines) {
			let x = pad + boxPad;
			for (const seg of sl) {
				const w = segW(seg);
				ctx.font = seg.style === "del" ? "bold " + font : font;
				ctx.fillStyle =
					seg.style === "ins"
						? colors.ins
						: seg.style === "del"
							? colors.del
							: colors.text;
				ctx.fillText(seg.text, x, ly);
				if (seg.style === "del") {
					ctx.strokeStyle = colors.del;
					ctx.lineWidth = 1;
					ctx.beginPath();
					ctx.moveTo(x, ly + lineH / 2);
					ctx.lineTo(x + w, ly + lineH / 2);
					ctx.stroke();
				}
				x += w;
			}
			ly += lineH;
		}
		y += boxH + gap;
	}
	canvas.toBlob((blob) => {
		if (!blob) return;
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "corrections.png";
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	}, "image/png");
}

function _curatedCorrectionsList() {
	const blocks = _curatedCorrectionsData();
	const body = document.createElement("div");
	body.className = "tw-corr-list";
	if (!blocks.length) {
		body.textContent = "No corrections.";
		_curatedShowFloatWin("Corrections+", body);
		return;
	}
	const toolbar = document.createElement("div");
	toolbar.className = "tw-corr-toolbar";
	const dlBtn = document.createElement("button");
	dlBtn.className = "btn-edit";
	dlBtn.textContent = "🖼 Download image";
	dlBtn.addEventListener("click", _curatedDownloadCorrectionsImage);
	toolbar.appendChild(dlBtn);
	body.appendChild(toolbar);
	for (const b of blocks) {
		if (b.type === "file") {
			const h = document.createElement("div");
			h.className = "tw-corr-file";
			h.textContent = b.text;
			body.appendChild(h);
			continue;
		}
		const row = document.createElement("div");
		row.className = "tw-corr-snippet";
		const label = document.createElement("div");
		label.className = "tw-corr-label";
		label.textContent = b.label;
		const pre = document.createElement("pre");
		pre.className = "tw-pre tw-corr-pre";
		if (typeof _diffMissingColorFor === "function")
			pre.style.setProperty("--tw-ins-color", _diffMissingColorFor(b.file));
		pre.innerHTML = _curatedMarkedToHtml(b.marked);
		row.appendChild(label);
		row.appendChild(pre);
		body.appendChild(row);
	}
	_curatedShowFloatWin("Corrections+", body);
}

function _curatedPreview() {
	const out = _curatedApplyToStudent();
	const marked = _curatedApplyToStudent({ mark: true });
	const body = document.createElement("div");
	body.className = "tw-preview-split";

	if (!Object.keys(out).length) {
		body.textContent = "No student files to preview.";
		_curatedShowFloatWin("Test Corrections", body);
		return;
	}

	const left = document.createElement("div");
	left.className = "tw-preview-code";

	const tabBar = document.createElement("div");
	tabBar.className = "tw-preview-tabs";
	const panes = document.createElement("div");
	panes.className = "tw-preview-panes";

	const _previewExtRank = (n) => {
		const m = n.toLowerCase().match(/\.([^.]+)$/);
		const ext = m ? m[1] : "";
		if (ext === "html" || ext === "htm") return 0;
		if (ext === "js") return 1;
		if (ext === "css") return 2;
		return 3;
	};
	const sortedEntries = Object.entries(out).sort(([a], [b]) => {
		const ra = _previewExtRank(a);
		const rb = _previewExtRank(b);
		if (ra !== rb) return ra - rb;
		return a.localeCompare(b);
	});

	sortedEntries.forEach(([name, text], i) => {
		const btn = document.createElement("button");
		btn.className = "file-tab" + (i === 0 ? " file-tab-active" : "");
		btn.textContent = name;
		btn.onclick = () => {
			tabBar
				.querySelectorAll(".file-tab")
				.forEach((t) => t.classList.remove("file-tab-active"));
			panes
				.querySelectorAll(".tw-pre")
				.forEach((p) => p.classList.remove("active"));
			btn.classList.add("file-tab-active");
			panes.children[i].classList.add("active");
		};
		tabBar.appendChild(btn);

		const pre = document.createElement("pre");
		pre.className = "tw-pre" + (i === 0 ? " active" : "");
		if (typeof _diffMissingColorFor === "function")
			pre.style.setProperty("--tw-ins-color", _diffMissingColorFor(name));
		const base = marked[name] != null ? marked[name] : text;
		const mtext = CURATED_REINDENT
			? _curatedReindent(base, getFileExt(name))
			: base;
		pre.innerHTML = _curatedMarkedToHtml(mtext);
		panes.appendChild(pre);
	});

	left.appendChild(tabBar);
	left.appendChild(panes);

	const right = document.createElement("div");
	right.className = "tw-preview-render";
	const iframe = document.createElement("iframe");
	iframe.className = "tw-preview-iframe";
	iframe.setAttribute(
		"sandbox",
		"allow-scripts allow-same-origin allow-modals allow-popups allow-popups-to-escape-sandbox",
	);
	right.appendChild(iframe);

	body.appendChild(left);
	body.appendChild(right);
	_curatedShowFloatWin("Test Corrections", body);

	if (typeof updatePreview === "function") {
		updatePreview("student", { ...out }, iframe);
	}
}
