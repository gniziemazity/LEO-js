"use strict";

function _curatedSummarize() {
	const groups = _curatedGroupMarks();
	const body = document.createElement("div");
	if (!groups.length) {
		body.textContent = "Empty";
		_curatedShowFloatWin("Corrections Summary", body);
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
		const text = _curatedSrcText("student", file);
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
			const studentText = _curatedSrcText("student", g.file);
			const dstText = _curatedSrcText("student", g.moveFile);
			_addEdit(g.file, {
				start: g.lo,
				end: g.hi,
				insertText: "",
			});
			let moveBody = _curatedDedentBlock(studentText.slice(g.lo, g.hi));
			const srcLead = _curatedBackwardWhitespace(studentText, g.lo);
			if (
				srcLead &&
				g.movePos > 0 &&
				!_curatedBackwardWhitespace(dstText, g.movePos)
			) {
				const nl = srcLead.lastIndexOf("\n");
				moveBody =
					(nl >= 0
						? srcLead.slice(0, nl + 1) +
							_curatedLineIndentAt(dstText, g.movePos)
						: srcLead) + moveBody;
			}
			_addEdit(g.moveFile, {
				start: g.movePos,
				end: g.movePos,
				insertText: moveBody,
			});
		} else if (g.kind === "missing-insert") {
			const teacherText = _curatedSrcText("teacher", g.file);
			const studentText = _curatedSrcText("student", g.insertFile);
			let body = teacherText.slice(g.lo, g.hi).replace(/[ \t\r\n]+$/, "");
			let edgeLead = "";
			let lineStart = g.lo;
			while (
				lineStart > 0 &&
				teacherText[lineStart - 1] !== "\n" &&
				/[ \t]/.test(teacherText[lineStart - 1])
			) {
				lineStart--;
			}
			body = _curatedDedentBlock(body);
			let sIns = g.insertPos;
			while (
				sIns > 0 &&
				studentText[sIns - 1] !== "\n" &&
				/[ \t]/.test(studentText[sIns - 1])
			) {
				sIns--;
			}
			const studentAtLineStart =
				sIns === 0 || studentText[sIns - 1] === "\n";
			if (
				studentAtLineStart &&
				lineStart < g.lo &&
				(lineStart === 0 || teacherText[lineStart - 1] === "\n")
			) {
				body = "\n" + body;
			} else {
				edgeLead = _curatedBackwardWhitespace(teacherText, g.lo);
			}
			_addEdit(g.insertFile, {
				start: g.insertPos,
				end: g.insertPos,
				insertText: body,
				_edgeLead: edgeLead,
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
			_curatedAbsorbWhitespaceGaps(
				_curatedSrcText("student", b.file),
				b.edits,
				{
					start: (e) => e.start,
					end: (e) => e.end,
					isDel: (e) => e.insertText === "" && e.end > e.start,
					setStart: (e, v) => (e.start = v),
					setEnd: (e, v) => (e.end = v),
				},
			);
			const stext = _curatedSrcText("student", b.file);
			const dels = b.edits.filter(
				(e) => e.end > e.start && e.insertText === "",
			);
			for (const e of b.edits) {
				if (e.start !== e.end || !e._edgeLead) continue;
				if (e.start <= 0 || _curatedBackwardWhitespace(stext, e.start))
					continue;
				const removed = dels.some(
					(d) => d.start <= e.start - 1 && e.start - 1 < d.end,
				);
				if (removed) continue;
				let lead = e._edgeLead;
				const nlIdx = lead.lastIndexOf("\n");
				if (nlIdx >= 0) {
					lead = lead.slice(0, nlIdx + 1).replace(/[ \t]/g, "");
				}
				e.insertText = lead + e.insertText;
			}
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

		for (const b of (bucketsByFile.get(file) || []).slice().reverse()) {
			const text = _curatedSrcText("student", b.file);
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
			const text = _curatedSrcText(g.side, g.file);
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
	_curatedShowFloatWin("Corrections Summary", body);
}
