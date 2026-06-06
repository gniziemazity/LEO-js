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

function _curatedDedentBlock(body) {
	const lines = body.split("\n");
	if (lines.length < 2) return body;
	const startIdx = body.startsWith("\n") ? 0 : 1;
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
	const lines = text.split("\n").map((line) => {
		const indent = (line.match(/^[ \t]*/) || [""])[0];
		return indent + line.slice(indent.length).replace(/ {2,}/g, " ");
	});
	const isBlank = (l) => /^[ \t]*$/.test(l);
	let s = 0;
	let e = lines.length - 1;
	while (s <= e && isBlank(lines[s])) s++;
	while (e >= s && isBlank(lines[e])) e--;
	return lines.slice(s, e + 1).join("\n");
}

function _curatedApplyToStudent() {
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

function _curatedPreview() {
	const out = _curatedApplyToStudent();
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
		pre.textContent = text;
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
		"allow-scripts allow-same-origin allow-modals",
	);
	right.appendChild(iframe);

	body.appendChild(left);
	body.appendChild(right);
	_curatedShowFloatWin("Test Corrections", body);

	if (typeof updatePreview === "function") {
		updatePreview("student", { ...out }, iframe);
	}
}
