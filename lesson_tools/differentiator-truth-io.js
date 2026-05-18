"use strict";

function _truthBackfillTimestamps(teacherFiles, studentFiles) {
	const leoStar = _allMarks[""];
	if (!leoStar) return;
	const tsByPos = new Map();
	const remTsByPos = new Map();
	for (const [file, entries] of Object.entries(
		leoStar.teacher_token_timestamps || {},
	)) {
		for (const e of entries || []) {
			tsByPos.set(`${file}|${e.start}|${e.end}`, e.ts);
		}
	}
	for (const [file, marks] of Object.entries(leoStar.teacher_files || {})) {
		for (const m of marks || []) {
			if (m.label === "missing" && m.timestamp) {
				const k = `${file}|${m.start}|${m.end}`;
				if (!tsByPos.has(k)) tsByPos.set(k, m.timestamp);
			}
		}
	}
	for (const [file, marks] of Object.entries(leoStar.student_files || {})) {
		for (const m of marks || []) {
			if (m.label === "ghost_extra" && m.removal_ts) {
				remTsByPos.set(
					`${file}|${m.token}|${m.start}|${m.end}`,
					m.removal_ts,
				);
			}
		}
	}
	for (const [file, marks] of Object.entries(teacherFiles || {})) {
		for (const m of marks || []) {
			if (m.label !== "missing" || m.timestamp) continue;
			const ts = tsByPos.get(`${file}|${m.start}|${m.end}`);
			if (ts) m.timestamp = ts;
		}
	}
	for (const [file, marks] of Object.entries(studentFiles || {})) {
		for (const m of marks || []) {
			if (m.label !== "ghost_extra" || m.removal_ts) continue;
			const ts = remTsByPos.get(`${file}|${m.token}|${m.start}|${m.end}`);
			if (ts) m.removal_ts = ts;
		}
	}
}

function _truthBuildJson() {
	const matching = _diffMode === "required" ? "required" : "ideal";
	const t = _truthMarks() || {
		token_matching: matching,
		teacher_files: {},
		student_files: {},
	};
	const teacherFiles = _deepClone(t.teacher_files || {});
	const studentFiles = _deepClone(t.student_files || {});
	_truthBackfillTimestamps(teacherFiles, studentFiles);
	const out = {
		token_matching: matching,
		teacher_files: teacherFiles,
		student_files: studentFiles,
	};
	if (t.file_pairs && Object.keys(t.file_pairs).length) {
		out.file_pairs = { ...t.file_pairs };
	}
	return JSON.stringify(out, null, 2) + "\n";
}

function _truthDownload() {
	const json = _truthBuildJson();
	const blob = new Blob([json], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download =
		_diffMode === "required"
			? "diff_marks_required.json"
			: "diff_marks_ideal.json";
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}

function _truthFlashButton(id, label) {
	const btn = document.getElementById(id);
	if (!btn) return;
	const orig = btn.textContent;
	btn.textContent = label;
	btn.classList.add("active");
	setTimeout(() => {
		btn.textContent = orig;
		btn.classList.remove("active");
	}, 900);
}

function _truthCopyToClipboard() {
	const json = _truthBuildJson();
	const done = () => _truthFlashButton("btn-copy-truth", "✓ Copied");
	const fail = () => _truthFlashButton("btn-copy-truth", "✖ Failed");
	if (navigator.clipboard && navigator.clipboard.writeText) {
		navigator.clipboard.writeText(json).then(done).catch(fail);
		return;
	}
	const ta = document.createElement("textarea");
	ta.value = json;
	ta.style.position = "fixed";
	ta.style.left = "-9999px";
	document.body.appendChild(ta);
	ta.focus();
	ta.select();
	let ok = false;
	try {
		ok = document.execCommand("copy");
	} catch {}
	ta.remove();
	if (ok) done();
	else fail();
}

function _truthBackwardWhitespace(text, pos) {
	if (pos <= 0 || !/\s/.test(text[pos - 1])) return "";
	let i = pos;
	while (i > 0 && /\s/.test(text[i - 1])) i--;
	return text.slice(i, pos);
}

function _truthForwardWhitespace(text, pos) {
	if (pos >= text.length || !/\s/.test(text[pos])) return "";
	let i = pos;
	while (i < text.length && /\s/.test(text[i])) i++;
	return text.slice(pos, i);
}

function _truthDedentBlock(body) {
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

function _truthAlignWhitespace(
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
	const srcLead = _truthBackwardWhitespace(srcText, srcStart);
	const dstLead = _truthBackwardWhitespace(dstText, dstStart);
	const srcTrail = _truthForwardWhitespace(srcText, srcEnd);
	const dstTrail = _truthForwardWhitespace(dstText, dstEnd);

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

function _truthApplyToStudent() {
	const out = {};
	const truthData = _truthMarks();
	if (!truthData) return out;
	const studentNames = Object.keys(_studentFiles || {});
	const groups = _truthGroupMarks();
	const filePairs = (truthData && truthData.file_pairs) || {};

	for (const studentName of studentNames) {
		let text = _truthSrcText("student", studentName);
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
			? _truthTokensForFile("teacher", teacherFile)
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
				body: _truthSliceExcludingComments(
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
				const body = _truthSliceExcludingComments(
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
				const body = _truthSliceExcludingComments(
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
				const teacherSrc = _truthSrcText("teacher", op.srcFile);
				const aligned = _truthAlignWhitespace(
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
		out[outName] = text;
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

function _truthPreview() {
	const out = _truthApplyToStudent();
	const body = document.createElement("div");
	body.className = "tw-preview-split";

	if (!Object.keys(out).length) {
		body.textContent = "No student files to preview.";
		_truthShowFloatWin("Test Corrections", body);
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
	iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
	right.appendChild(iframe);

	body.appendChild(left);
	body.appendChild(right);
	_truthShowFloatWin("Test Corrections", body);

	if (typeof updatePreview === "function") {
		updatePreview("student", { ...out }, iframe);
	}
}

function _truthSummarize() {
	const groups = _truthGroupMarks();
	const body = document.createElement("div");
	if (!groups.length) {
		body.textContent = "Empty";
		_truthShowFloatWin("Corrections Summary", body);
		return;
	}

	const _posLine = (text, pos) => {
		let n = 1;
		const limit = Math.min(pos, text.length);
		for (let i = 0; i < limit; i++) if (text[i] === "\n") n++;
		return n;
	};
	const _lineRange = (text, lo, hi) => {
		const a = _posLine(text, lo);
		const b = _posLine(text, Math.max(lo, hi - 1));
		return a === b ? `line ${a}` : `lines ${a}–${b}`;
	};
	const _expandToLines = (text, lo, hi) => {
		const start = text.lastIndexOf("\n", Math.max(0, lo - 1)) + 1;
		const fromIdx = Math.max(lo, hi - 1);
		const nextNl = text.indexOf("\n", fromIdx);
		const end = nextNl < 0 ? text.length : nextNl;
		return [start, end];
	};
	const _walkPerLine = (text, fullLo, fullHi, edits, mode) => {
		const sortedEdits = (edits || [])
			.slice()
			.sort((a, b) => a.start - b.start || a.end - b.end);

		const lines = [];
		{
			let lo = fullLo;
			while (lo <= fullHi) {
				const nl = text.indexOf("\n", lo);
				const end = nl < 0 || nl >= fullHi ? fullHi : nl;
				lines.push({ start: lo, end });
				if (nl < 0 || nl >= fullHi) break;
				lo = nl + 1;
			}
		}
		let indent = Infinity;
		for (const { start, end } of lines) {
			if (start === end) continue;
			let p = start;
			while (p < end && (text[p] === " " || text[p] === "\t")) p++;
			if (p === end) continue;
			indent = Math.min(indent, p - start);
		}
		if (!isFinite(indent)) indent = 0;

		let html = "";
		for (let li = 0; li < lines.length; li++) {
			const { start: ls, end: le } = lines[li];
			const skipUntil = Math.min(ls + indent, le);
			let cursor = skipUntil;

			for (const e of sortedEdits) {
				if (e.end <= cursor && !(e.start === e.end && e.start === cursor))
					continue;
				if (e.start > le) break;
				if (e.start === le && !(e.start === e.end)) break;

				const eStart = Math.max(e.start, cursor);
				const eEnd = Math.min(e.end, le);

				if (eStart > cursor) html += escHtml(text.slice(cursor, eStart));

				if (mode === "before") {
					if (eEnd > eStart) {
						const deleted = text.slice(eStart, eEnd);
						const cls = /^\s+$/.test(deleted)
							? "tw-del tw-del-ws"
							: "tw-del";
						html +=
							`<span class="${cls}">` + escHtml(deleted) + `</span>`;
					}
				} else {
					if (
						e.start >= ls &&
						e.start < le + 1 &&
						e.start <= eStart &&
						e.insertText
					) {
						html +=
							`<span class="tw-ins">` +
							escHtml(e.insertText) +
							`</span>`;
					}
				}

				cursor = Math.max(cursor, eEnd);
			}

			if (cursor < le) html += escHtml(text.slice(cursor, le));
			if (li < lines.length - 1) html += "\n";
		}
		return html;
	};
	const _renderBefore = (text, lo, hi, edits) =>
		_walkPerLine(text, lo, hi, edits, "before");
	const _renderAfter = (text, lo, hi, edits) =>
		_walkPerLine(text, lo, hi, edits, "after");
	const _trimBlankLines = (html) => {
		const lines = html.split("\n");
		const isBlank = (l) => !l.replace(/<[^>]*>/g, "").trim();
		let s = 0;
		let e = lines.length - 1;
		while (s <= e && isBlank(lines[s])) s++;
		while (e >= s && isBlank(lines[e])) e--;
		return lines.slice(s, e + 1).join("\n");
	};

	const bucketOrder = [];
	const bucketMap = new Map();
	const _addEdit = (file, edit) => {
		const text = _truthSrcText("student", file);
		const probeHi = Math.max(edit.start + 1, edit.end);
		const [fLo, fHi] = _expandToLines(text, edit.start, probeHi);
		const key = `${file}|${fLo}|${fHi}`;
		let b = bucketMap.get(key);
		if (!b) {
			b = { file, fullLo: fLo, fullHi: fHi, edits: [] };
			bucketMap.set(key, b);
			bucketOrder.push(b);
		}
		b.edits.push(edit);
	};

	const _orphans = [];

	for (const g of groups) {
		if (g.kind === "extra" || g.kind === "ghost_extra") {
			for (const m of g.marks || []) {
				if (m.move_to) {
					_addEdit(g.file, {
						start: m.start,
						end: m.end,
						insertText: "",
					});
					_addEdit(m.move_to.file, {
						start: m.move_to.pos,
						end: m.move_to.pos,
						insertText: m.token,
					});
				} else {
					_addEdit(g.file, {
						start: m.start,
						end: m.end,
						insertText: "",
					});
				}
			}
		} else if (g.kind === "extra-replace") {
			for (const m of g.marks || []) {
				const pw = m.paired_with;
				if (!pw || pw.ghost) {
					_addEdit(g.file, {
						start: m.start,
						end: m.end,
						insertText: "",
					});
					continue;
				}
				_addEdit(g.file, {
					start: m.start,
					end: m.end,
					insertText: pw.token,
				});
			}
		} else if (g.kind === "extra-move") {
			const studentText = _truthSrcText("student", g.file);
			_addEdit(g.file, {
				start: g.lo,
				end: g.hi,
				insertText: "",
			});
			_addEdit(g.moveFile, {
				start: g.movePos,
				end: g.movePos,
				insertText: _truthDedentBlock(studentText.slice(g.lo, g.hi)),
			});
		} else if (g.kind === "missing-insert") {
			const teacherText = _truthSrcText("teacher", g.file);
			let body = teacherText.slice(g.lo, g.hi).replace(/[ \t\r\n]+$/, "");
			let lineStart = g.lo;
			while (
				lineStart > 0 &&
				teacherText[lineStart - 1] !== "\n" &&
				/[ \t]/.test(teacherText[lineStart - 1])
			) {
				lineStart--;
			}
			if (
				lineStart < g.lo &&
				(lineStart === 0 || teacherText[lineStart - 1] === "\n")
			) {
				body = "\n" + teacherText.slice(lineStart, g.lo) + body;
			}
			body = _truthDedentBlock(body);
			_addEdit(g.insertFile, {
				start: g.insertPos,
				end: g.insertPos,
				insertText: body,
			});
		} else {
			_orphans.push(g);
		}
	}

	for (const b of bucketOrder) {
		b.edits.sort((a, b) => a.start - b.start || a.end - b.end);
	}

	const mergedOrder = [];
	{
		const byFile = new Map();
		for (const b of bucketOrder) {
			if (!byFile.has(b.file)) byFile.set(b.file, []);
			byFile.get(b.file).push(b);
		}
		for (const [, list] of byFile) {
			list.sort((a, b) => a.fullLo - b.fullLo);
			let cur = null;
			for (const b of list) {
				if (cur && b.fullLo === cur.fullHi + 1) {
					cur.fullHi = b.fullHi;
					cur.edits.push(...b.edits);
				} else {
					if (cur) mergedOrder.push(cur);
					cur = {
						file: b.file,
						fullLo: b.fullLo,
						fullHi: b.fullHi,
						edits: b.edits.slice(),
					};
				}
			}
			if (cur) mergedOrder.push(cur);
		}
		for (const b of mergedOrder) {
			b.edits.sort((a, b) => a.start - b.start || a.end - b.end);
		}
	}

	const grid = document.createElement("div");
	grid.className = "tw-summary-grid";

	const _isBlankHtml = (html) =>
		!String(html || "")
			.replace(/<[^>]*>/g, "")
			.trim();

	const fileOrder = [];
	const bucketsByFile = new Map();
	const orphansByFile = new Map();
	const _enrolFile = (f) => {
		if (!fileOrder.includes(f)) fileOrder.push(f);
	};
	for (const b of mergedOrder) {
		_enrolFile(b.file);
		if (!bucketsByFile.has(b.file)) bucketsByFile.set(b.file, []);
		bucketsByFile.get(b.file).push(b);
	}
	for (const g of _orphans) {
		_enrolFile(g.file);
		if (!orphansByFile.has(g.file)) orphansByFile.set(g.file, []);
		orphansByFile.get(g.file).push(g);
	}
	const _extPriority = (f) => {
		const ext = (f.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";
		const order = { html: 0, htm: 0, css: 1, js: 2 };
		return ext in order ? order[ext] : 3;
	};
	fileOrder.sort((a, b) => _extPriority(a) - _extPriority(b));
	const showHeaders = fileOrder.length > 1;

	for (const file of fileOrder) {
		if (showHeaders) {
			grid.insertAdjacentHTML(
				"beforeend",
				`<div class="tw-summary-file-header">${escHtml(file)}</div>`,
			);
		}

		for (const b of bucketsByFile.get(file) || []) {
			const text = _truthSrcText("student", b.file);
			const beforeHtml = _renderBefore(text, b.fullLo, b.fullHi, b.edits);
			const afterHtml = _renderAfter(text, b.fullLo, b.fullHi, b.edits);

			const lo = Math.min(...b.edits.map((e) => e.start));
			const hi = Math.max(...b.edits.map((e) => Math.max(e.end, e.start)));
			const lineLabel = `line ${_posLine(text, lo)}`;
			const titleAttr = `[${lo}–${hi}]`;

			const lineCell =
				`<div class="tw-line">` +
				`<span class="tw-loc" title="${escAttr(titleAttr)}">` +
				`${escHtml(lineLabel)}</span>` +
				`</div>`;
			const midCell = `<div class="tw-mid"><span class="tw-arrow">→</span></div>`;
			const rightHtml = _isBlankHtml(afterHtml)
				? `<span></span>`
				: `<pre class="tw-summary-pre">${afterHtml}</pre>`;

			grid.insertAdjacentHTML(
				"beforeend",
				lineCell +
					`<pre class="tw-summary-pre">${beforeHtml}</pre>` +
					midCell +
					rightHtml,
			);
		}

		for (const g of orphansByFile.get(file) || []) {
			const text = _truthSrcText(g.side, g.file);
			const [fLo, fHi] = _expandToLines(text, g.lo, g.hi);
			const sorted = (g.marks || [])
				.slice()
				.sort((a, b) => a.start - b.start);
			let html = "";
			let cursor = fLo;
			for (const m of sorted) {
				const ms = Math.max(m.start, cursor);
				const me = Math.min(m.end, fHi);
				if (me <= ms) continue;
				if (ms > cursor) html += escHtml(text.slice(cursor, ms));
				html +=
					`<span class="tw-ins">` +
					escHtml(text.slice(ms, me)) +
					`</span>`;
				cursor = me;
			}
			if (cursor < fHi) html += escHtml(text.slice(cursor, fHi));
			const lineLabel = _lineRange(text, g.lo, g.hi);
			const titleAttr = `[${g.lo}–${g.hi}]`;
			const lineCell =
				`<div class="tw-line">` +
				`<span class="tw-loc" title="${escAttr(titleAttr)}">${escHtml(lineLabel)}</span>` +
				`</div>`;
			const rightHtml = `<span></span>`;
			grid.insertAdjacentHTML(
				"beforeend",
				lineCell +
					`<pre class="tw-summary-pre">${html}</pre>` +
					`<div class="tw-mid"><span class="tw-arrow">→</span></div>` +
					rightHtml,
			);
		}
	}

	body.appendChild(grid);
	_truthShowFloatWin("Corrections Summary", body);
}

function _truthShowFloatWin(title, bodyEl) {
	if (!_truthFloatWin) {
		const win = document.createElement("div");
		win.className = "truth-float-win float-win";
		win.id = "truth-float-win";

		const header = document.createElement("div");
		header.className = "float-win__header";
		const dragHint = document.createElement("span");
		dragHint.className = "float-win__drag";
		dragHint.textContent = "⠿";
		header.appendChild(dragHint);
		const titleEl = document.createElement("span");
		titleEl.className = "float-win__title";
		header.appendChild(titleEl);
		const closeBtn = document.createElement("button");
		closeBtn.className = "float-win__close";
		closeBtn.textContent = "×";
		closeBtn.addEventListener("click", () => {
			win.style.display = "none";
		});
		header.appendChild(closeBtn);

		const body = document.createElement("div");
		body.className = "float-win__body";

		win.appendChild(header);
		win.appendChild(body);
		document.body.appendChild(win);

		makeDraggable(header, win);

		_truthFloatWin = { win, titleEl, body };
	}
	_truthFloatWin.titleEl.textContent = title;
	_truthFloatWin.body.innerHTML = "";
	_truthFloatWin.body.appendChild(bodyEl);
	_truthFloatWin.win.style.display = "flex";
	if (!_truthFloatWin.win.style.left) {
		_truthFloatWin.win.style.left = "100px";
		_truthFloatWin.win.style.top = "100px";
	}
}
