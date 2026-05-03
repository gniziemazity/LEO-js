"use strict";

// Truth-mode I/O and previews: timestamp backfill, JSON build/download/copy,
// whitespace-aware apply-to-student, and Test/Summary float windows.

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
	const t = _truthMarks() || {
		token_matching: "truth",
		teacher_files: {},
		student_files: {},
	};
	const teacherFiles = JSON.parse(JSON.stringify(t.teacher_files || {}));
	const studentFiles = JSON.parse(JSON.stringify(t.student_files || {}));
	_truthBackfillTimestamps(teacherFiles, studentFiles);
	const out = {
		token_matching: "truth",
		teacher_files: teacherFiles,
		student_files: studentFiles,
	};
	if (t.teacher_ghosts) out.teacher_ghosts = t.teacher_ghosts;
	return JSON.stringify(out, null, 2) + "\n";
}

function _truthDownload() {
	const json = _truthBuildJson();
	const blob = new Blob([json], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = "diff_marks_truth.json";
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

function _truthAlignWhitespace(
	srcText,
	srcStart,
	srcEnd,
	dstText,
	dstStart,
	dstEnd,
) {
	const srcLead = _truthBackwardWhitespace(srcText, srcStart);
	const dstLead = _truthBackwardWhitespace(dstText, dstStart);
	const srcTrail = _truthForwardWhitespace(srcText, srcEnd);
	const dstTrail = _truthForwardWhitespace(dstText, dstEnd);

	let text = srcText.slice(srcStart, srcEnd);
	let aStart = dstStart;
	let aEnd = dstEnd;

	if (srcLead && !dstLead) text = srcLead + text;
	else if (!srcLead && dstLead && !dstLead.includes("\n"))
		aStart = dstStart - dstLead.length;

	if (srcTrail && !dstTrail) text = text + srcTrail;
	else if (!srcTrail && dstTrail && !dstTrail.includes("\n"))
		aEnd = dstEnd + dstTrail.length;

	return { text, start: aStart, end: aEnd };
}

function _truthApplyToStudent() {
	const out = {};
	const t = _truthMarks();
	if (!t) return out;
	const studentNames = Object.keys(_studentFiles || {});
	const groups = _truthGroupMarks();

	for (const sName of studentNames) {
		let text = _truthSrcText("student", sName);
		const origText = text;
		const ops = [];
		let order = 0;
		const pushOp = (op) => {
			op.order = order++;
			ops.push(op);
		};

		const studentExtras = groups
			.filter(
				(g) =>
					g.side === "student" &&
					g.file === sName &&
					(g.kind === "extra" || g.kind === "ghost_extra"),
			)
			.slice()
			.sort((a, b) => a.lo - b.lo);
		const teacherMissings = groups
			.filter(
				(g) =>
					g.side === "teacher" &&
					g.kind === "missing-insert" &&
					g.insertFile === sName,
			)
			.slice()
			.sort((a, b) => a.lo - b.lo);
		const tFile = teacherMissings[0]?.file ?? null;
		const allTeacherTokens = tFile
			? _truthTokensForFile("teacher", tFile)
			: [];
		const consumedMissings = new Set();
		for (const eg of studentExtras) {
			const candidates = teacherMissings
				.filter(
					(g) =>
						!consumedMissings.has(g) &&
						g.insertPos >= eg.lo &&
						g.insertPos <= eg.hi,
				)
				.slice()
				.sort((a, b) => a.lo - b.lo);
			if (!candidates.length) continue;
			const contig = [candidates[0]];
			for (let i = 1; i < candidates.length; i++) {
				const prevHi = contig[contig.length - 1].hi;
				const nxtLo = candidates[i].lo;
				let hasKept = false;
				for (const tok of allTeacherTokens) {
					if (tok.start < prevHi) continue;
					if (tok.start >= nxtLo) break;
					hasKept = true;
					break;
				}
				if (hasKept) break;
				contig.push(candidates[i]);
			}
			const tLo = contig[0].lo;
			const tHi = contig[contig.length - 1].hi;
			const tSrc = _truthSrcText("teacher", contig[0].file);
			eg._coalesced = { tLo, tHi, body: tSrc.slice(tLo, tHi) };
			for (const mg of contig) consumedMissings.add(mg);
		}
		for (const g of groups) {
			if (
				g.side === "teacher" &&
				g.kind === "missing-insert" &&
				g.insertFile === sName
			) {
				if (consumedMissings.has(g)) continue;
				const tSrc = _truthSrcText("teacher", g.file);
				const a = _truthAlignWhitespace(
					tSrc,
					g.lo,
					g.hi,
					origText,
					g.insertPos,
					g.insertPos,
				);
				pushOp({ start: a.start, end: a.end, text: a.text });
			} else if (
				g.side === "student" &&
				g.kind === "extra-replace" &&
				g.file === sName
			) {
				const tSrc = _truthSrcText("teacher", g.pairFile);
				const a = _truthAlignWhitespace(
					tSrc,
					g.pairLo,
					g.pairHi,
					origText,
					g.lo,
					g.hi,
				);
				pushOp({ start: a.start, end: a.end, text: a.text });
			} else if (
				g.side === "student" &&
				(g.kind === "extra" || g.kind === "ghost_extra") &&
				g.file === sName
			) {
				if (g._coalesced) {
					const c = g._coalesced;
					pushOp({ start: g.lo, end: g.hi, text: c.body });
					delete g._coalesced;
				} else {
					pushOp({ start: g.lo, end: g.hi, text: "" });
				}
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
			}
			text = text.slice(0, op.start) + body + text.slice(op.end);
		}
		out[sName] = text;
	}
	return out;
}

function _truthPreview() {
	const out = _truthApplyToStudent();
	const body = document.createElement("div");
	body.className = "tw-preview-split";

	if (!Object.keys(out).length) {
		body.textContent = "No student files to preview.";
		_truthShowFloatWin("Test", body);
		return;
	}

	const left = document.createElement("div");
	left.className = "tw-preview-code";
	for (const [name, text] of Object.entries(out)) {
		const h = document.createElement("div");
		h.className = "tw-section-title";
		h.textContent = name;
		left.appendChild(h);
		const pre = document.createElement("pre");
		pre.className = "tw-pre";
		pre.textContent = text;
		left.appendChild(pre);
	}

	const right = document.createElement("div");
	right.className = "tw-preview-render";
	const iframe = document.createElement("iframe");
	iframe.className = "tw-preview-iframe";
	iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
	right.appendChild(iframe);

	body.appendChild(left);
	body.appendChild(right);
	_truthShowFloatWin("Test", body);

	if (typeof updatePreview === "function") {
		updatePreview("student", { ...out }, iframe);
	}
}

function _truthSummarize() {
	const groups = _truthGroupMarks();
	const body = document.createElement("div");
	if (!groups.length) {
		body.textContent = "No truth marks defined.";
		_truthShowFloatWin("Summary", body);
		return;
	}

	for (const g of groups) {
		const row = document.createElement("div");
		row.className = "tw-summary-row";
		const codeText = _truthSrcText(g.side, g.file).slice(g.lo, g.hi);

		let pairBlock = "";
		if (g.kind === "extra-replace") {
			const pairText = _truthSrcText("teacher", g.pairFile).slice(
				g.pairLo,
				g.pairHi,
			);
			pairBlock =
				`<div class="tw-summary-pair">` +
				`<span class="tw-summary-arrow">↔ replaced by ${escHtml(g.pairFile)} [${g.pairLo}–${g.pairHi}]:</span>` +
				`<pre class="tw-summary-pre">${escHtml(pairText)}</pre>` +
				`</div>`;
		}

		let suffix = "";
		if (g.kind === "missing-insert")
			suffix = ` → insert at ${g.file}:${g.insertPos}`;
		else if (g.kind === "ghost_extra") suffix = " (extra*, delete)";
		else if (g.kind === "extra") suffix = " (delete)";

		row.innerHTML =
			`<div class="tw-summary-head"><b>${escHtml(g.kind)}</b> ` +
			`${escHtml(g.side)}/${escHtml(g.file)} [${g.lo}–${g.hi}]` +
			`<span class="tw-summary-suffix">${escHtml(suffix)}</span></div>` +
			`<pre class="tw-summary-pre">${escHtml(codeText)}</pre>` +
			pairBlock;
		body.appendChild(row);
	}
	_truthShowFloatWin("Summary", body);
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
