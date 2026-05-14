"use strict";

const DIFF_LABEL_COLORS = {
	missing: _cssVar("--clr-mark-missing"),
	comment: _cssVar("--clr-mark-comment"),
	extra: _cssVar("--clr-mark-extra"),
	ghost_extra: _cssVar("--clr-mark-ghost"),
	extra_comment: _cssVar("--clr-mark-extra-comment"),
};

function _lineStartOffsets(text) {
	const starts = [0];
	for (let i = 0; i < text.length; i++) {
		if (text[i] === "\n") starts.push(i + 1);
	}
	return starts;
}

function _renderAligned(
	text,
	alignment,
	fileMarks,
	sideIdx,
	lineFileMarks,
	fileName,
) {
	const side = sideIdx === 0 ? "teacher" : "student";
	const normText = text.replace(/\r\n/g, "\n");
	const lines = normText.split("\n");
	const lineStarts = _lineStartOffsets(normText);
	const synthMarks = _synthesizeLeoMarks(side, fileName);
	const sortedMarks = _mergeMarks(fileMarks, synthMarks);
	const fileGhosts = side === "teacher" ? _getFileGhosts(fileName) : [];
	const fileAnchors = side === "student" ? _getInsertAnchors(fileName) : [];
	const lineNumFor = _lineNumberMap(lines, lineStarts, normText, fileGhosts);

	const parts = [];
	for (const pair of alignment) {
		const lineIdx = pair[sideIdx];
		if (lineIdx === null) {
			parts.push('<div class="diff-spacer" contenteditable="false">​</div>');
		} else {
			const lineStart = lineStarts[lineIdx] ?? normText.length;
			const lineEnd =
				lineIdx + 1 < lineStarts.length
					? lineStarts[lineIdx + 1]
					: normText.length + 1;
			const lineText = lines[lineIdx] ?? "";
			const lineMarks = sortedMarks
				.filter((m) => m.start >= lineStart && m.start < lineEnd)
				.map((m) => ({
					...m,
					_abs_start: m.start,
					start: m.start - lineStart,
					end: Math.min(m.end, lineEnd) - lineStart,
				}));
			const lineGhosts = fileGhosts
				.filter((g) => g.pos >= lineStart && g.pos < lineEnd)
				.map((g) => ({ ...g, _abs_pos: g.pos, pos: g.pos - lineStart }));
			const lineAnchors = fileAnchors
				.filter((a) => a.pos >= lineStart && a.pos < lineEnd)
				.map((a) => ({ ...a, _abs_pos: a.pos, pos: a.pos - lineStart }));
			const bgMark =
				lineFileMarks &&
				lineFileMarks.find(
					(lm) => lm.start >= lineStart && lm.start < lineEnd,
				);
			const bgCls = bgMark ? ` diff-line--${bgMark.label}` : "";
			const ln = lineNumFor.numbers[lineIdx];
			const numAttr = ln != null ? ` data-line-num="${ln}"` : "";
			parts.push(
				`<div class="diff-line${bgCls}" data-src-start="${lineStart}"${numAttr}>${diffColorizePositions(lineText, lineMarks, side, lineGhosts, lineAnchors)}</div>`,
			);
		}
	}
	return parts.join("");
}

function _lineNumberMap(lines, lineStarts, normText, fileGhosts) {
	const numbers = new Array(lines.length);
	const offsets = new Array(lines.length).fill(0);
	let visible = 0;
	for (let i = 0; i < lines.length; i++) {
		const ls = lineStarts[i] ?? normText.length;
		const le =
			i + 1 < lineStarts.length ? lineStarts[i + 1] : normText.length + 1;
		const isEmpty = (lines[i] || "") === "";
		let hasGhost = false;
		if (isEmpty && fileGhosts && fileGhosts.length) {
			for (const g of fileGhosts) {
				if (g.pos >= ls && g.pos < le) {
					hasGhost = true;
					break;
				}
			}
		}
		if (isEmpty && hasGhost) {
			numbers[i] = null;
		} else {
			numbers[i] = ++visible;
		}
	}
	return { numbers, offsets };
}

function _renderFlat(text, fileMarks, lineFileMarks, side, fileName) {
	const normText = text.replace(/\r\n/g, "\n");
	const lines = normText.split("\n");
	const lineStarts = _lineStartOffsets(normText);
	const synthMarks = _synthesizeLeoMarks(side, fileName);
	const sortedMarks = _mergeMarks(fileMarks, synthMarks);
	const fileGhosts = side === "teacher" ? _getFileGhosts(fileName) : [];
	const fileAnchors = side === "student" ? _getInsertAnchors(fileName) : [];
	const lineNumFor = _lineNumberMap(lines, lineStarts, normText, fileGhosts);

	const parts = [];
	for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
		const lineStart = lineStarts[lineIdx] ?? normText.length;
		const lineEnd =
			lineIdx + 1 < lineStarts.length
				? lineStarts[lineIdx + 1]
				: normText.length + 1;
		const lineText = lines[lineIdx] ?? "";
		const lineMarks = sortedMarks
			.filter((m) => m.start >= lineStart && m.start < lineEnd)
			.map((m) => ({
				...m,
				_abs_start: m.start,
				start: m.start - lineStart,
				end: Math.min(m.end, lineEnd) - lineStart,
			}));
		const lineGhosts = fileGhosts
			.filter((g) => g.pos >= lineStart && g.pos < lineEnd)
			.map((g) => ({ ...g, _abs_pos: g.pos, pos: g.pos - lineStart }));
		const lineAnchors = fileAnchors
			.filter((a) => a.pos >= lineStart && a.pos <= lineEnd)
			.map((a) => ({ ...a, _abs_pos: a.pos, pos: a.pos - lineStart }));
		const bgMark =
			lineFileMarks &&
			lineFileMarks.find(
				(lm) => lm.start >= lineStart && lm.start < lineEnd,
			);
		const bgCls = bgMark ? ` diff-line--${bgMark.label}` : "";
		const ln = lineNumFor.numbers[lineIdx];
		const offset = lineNumFor.offsets[lineIdx] || 0;
		const numAttr = ln != null ? ` data-line-num="${ln}"` : "";
		const styleAttr =
			ln != null && offset > 0
				? ` style="--ghost-lines-before:${offset}"`
				: "";
		parts.push(
			`<div class="diff-line${bgCls}" data-src-start="${lineStart}"${numAttr}${styleAttr}>${diffColorizePositions(lineText, lineMarks, side, lineGhosts, lineAnchors)}</div>`,
		);
	}
	return parts.join("");
}

function _getFileGhosts(fileName) {
	const map = _currentMarksEntry?.teacher_ghosts;
	const own = map && map[fileName];
	if (own && own.length) return own;
	return _borrowedTeacherGhosts(fileName);
}

function _getInsertAnchors(studentFileName) {
	if (!studentFileName) return [];
	const out = [];
	const tFiles = _currentMarksEntry?.teacher_files;
	if (tFiles) {
		for (const [tFile, marks] of Object.entries(tFiles)) {
			for (const m of marks || []) {
				if (m.label !== "missing") continue;
				if (m.paired_with) continue;
				const ia = m.insert_at;
				if (!ia || ia.file !== studentFileName) continue;
				out.push({
					pos: ia.pos,
					token: m.token,
					teacher_file: tFile,
					teacher_pos: m.start,
				});
			}
		}
	}
	const sFiles = _currentMarksEntry?.student_files;
	if (sFiles) {
		for (const [sFile, marks] of Object.entries(sFiles)) {
			for (const m of marks || []) {
				if (m.label !== "extra") continue;
				if (m.paired_with) continue;
				const mt = m.move_to;
				if (!mt || mt.file !== studentFileName) continue;
				out.push({
					pos: mt.pos,
					token: m.token,
					move_source_file: sFile,
					move_source_pos: m.start,
				});
			}
		}
	}
	return out;
}

function _syncAlignedRowHeights() {
	const teacherWrap = document.getElementById("code-teacher");
	const studentWrap = document.getElementById("code-student");
	if (!teacherWrap || !studentWrap) return;
	const tPane = teacherWrap.querySelector(".code-pane.active");
	const sPane = studentWrap.querySelector(".code-pane.active");
	if (!tPane || !sPane) return;
	const tRows = tPane.querySelectorAll(".diff-line, .diff-spacer");
	const sRows = sPane.querySelectorAll(".diff-line, .diff-spacer");
	const n = Math.min(tRows.length, sRows.length);
	for (let i = 0; i < n; i++) {
		tRows[i].style.minHeight = "";
		sRows[i].style.minHeight = "";
	}
	void tPane.offsetHeight;
	for (let i = 0; i < n; i++) {
		const th = tRows[i].getBoundingClientRect().height;
		const sh = sRows[i].getBoundingClientRect().height;
		const mx = Math.max(th, sh);
		if (mx > 0) {
			tRows[i].style.minHeight = `${mx}px`;
			sRows[i].style.minHeight = `${mx}px`;
		}
	}
	_syncDividerHeight();
}

function _syncDividerHeight() {
	const divider = document.getElementById("diff-divider");
	const scrollEl = document.getElementById("diff-scroll");
	if (!divider || !scrollEl) return;
	divider.style.height = "";
	const scrollH = scrollEl.scrollHeight;
	const clientH = scrollEl.clientHeight;
	divider.style.height = `${Math.max(scrollH, clientH)}px`;
}

function renderPanel(side, files, marks) {
	if (!files || !Object.keys(files).length) return;

	const landing = document.getElementById(`landing-${side}`);
	const content = document.getElementById(`content-${side}`);
	const tabs = document.getElementById(`tabs-${side}`);
	const codeWrap = document.getElementById(`code-${side}`);
	const previewFrame = document.getElementById(`preview-${side}`);

	landing.style.display = "none";
	content.style.display = "flex";
	if (side === "teacher") {
		const bottomBar = document.getElementById("bottom-bar");
		if (bottomBar) bottomBar.style.display = "flex";
	}

	if (previewFrame) {
		previewFrame.style.display = "none";
	}
	codeWrap.style.display = "";

	const modeData = _currentMarksEntry;
	const allAlignments = _linePaddingEnabled
		? (modeData?.alignments ?? _borrowedAlignments())
		: null;
	const sideIdx = side === "teacher" ? 0 : 1;
	const allLineMks = modeData?.line_marks ?? null;
	const sideLineMks =
		side === "teacher"
			? (allLineMks?.teacher_files ?? null)
			: (allLineMks?.student_files ?? null);

	const allNames = Object.keys(files).filter((n) =>
		/\.(html|css|js|py)$/i.test(n),
	);
	const names = sortFileNames(allNames, side === "teacher");

	tabs.innerHTML = "";
	codeWrap.innerHTML = "";

	const inTruthMode = typeof _truthEditMode !== "undefined" && _truthEditMode;

	const filePairsAll = _currentMarksEntry?.file_pairs || {};

	names.forEach((name, i) => {
		const btn = document.createElement("button");
		const pairedAs = side === "student" ? filePairsAll[name] || "" : "";
		btn.className =
			"file-tab" +
			(i === 0 ? " file-tab-active" : "") +
			(pairedAs ? " file-tab-paired" : "");
		btn.dataset.fileName = name;
		btn.textContent = pairedAs || name;
		btn.onclick = () => {
			tabs
				.querySelectorAll(".file-tab")
				.forEach((t) => t.classList.remove("file-tab-active"));
			codeWrap
				.querySelectorAll(".code-pane")
				.forEach((p) => p.classList.remove("active"));
			btn.classList.add("file-tab-active");
			codeWrap.children[i].classList.add("active");
			const otherSide = side === "teacher" ? "student" : "teacher";
			const otherName = _pairedFileName(side, name);
			if (otherName) _activateFileTab(otherSide, otherName);
			if (typeof _truthRefreshOverlays === "function") {
				_truthRefreshOverlays();
			} else if (typeof _truthRefreshGhostPairs === "function") {
				_truthRefreshGhostPairs();
			}
		};
		if (side === "student" && inTruthMode) {
			const caret = document.createElement("span");
			caret.className = "file-pair-caret";
			caret.textContent = "▾";
			if (pairedAs) caret.classList.add("is-paired");
			caret.title = pairedAs
				? `Showing as ${pairedAs} (original: ${name})`
				: "Pair with a teacher file";
			caret.addEventListener("click", (ev) => {
				ev.stopPropagation();
				if (typeof _truthShowFilePairMenu === "function") {
					_truthShowFilePairMenu(caret, name);
				}
			});
			caret.addEventListener("mousedown", (ev) => ev.stopPropagation());
			btn.appendChild(caret);
		}

		tabs.appendChild(btn);

		const pane = document.createElement("div");
		pane.className = "code-pane" + (i === 0 ? " active" : "");
		pane.dataset.paneSide = side;
		pane.dataset.paneFile = name;

		const text = files[name] || "";

		const fileMarks = marks ? (marks[name] ?? null) : null;
		const lineFileMarks = sideLineMks ? (sideLineMks[name] ?? null) : null;
		const alignment = allAlignments ? (allAlignments[name] ?? null) : null;
		const sourceText = text;
		const hasMarks = Array.isArray(fileMarks) || lineFileMarks;

		if (alignment) {
			pane.innerHTML = `<div class="code-aligned">${_renderAligned(sourceText, alignment, fileMarks, sideIdx, lineFileMarks, name)}</div>`;
		} else if (hasMarks || inTruthMode) {
			pane.innerHTML = `<div class="code-aligned">${_renderFlat(sourceText, fileMarks, lineFileMarks, side, name)}</div>`;
		} else {
			pane.innerHTML = `<pre>${escHtml(sourceText)}</pre>`;
		}
		codeWrap.appendChild(pane);
	});

	requestAnimationFrame(() => {
		_syncAlignedRowHeights();
		if (typeof _truthRefreshGhostPairs === "function") {
			_truthRefreshGhostPairs();
		}
	});

	if (localStorage.getItem("diff-preview-mode") === "preview") {
		const files = side === "teacher" ? _teacherFiles : _studentFiles;
		const iframe = document.getElementById(`preview-${side}`);
		if (files && Object.keys(files).length && iframe) {
			updatePreview(side, files, iframe);
			iframe.style.display = "block";
			codeWrap.style.display = "none";
		}
		if (side === "teacher" && typeof _refreshPreviewButton === "function") {
			_refreshPreviewButton();
		}
	}
}

function sortFileNames(names, preferReconstructed) {
	const html = names.filter((n) => /\.html$/i.test(n));
	const css = names.filter((n) => /\.css$/i.test(n));
	const js = names.filter((n) => /\.js$/i.test(n));
	const py = names.filter((n) => /\.py$/i.test(n));
	const grouped = new Set([...html, ...css, ...js, ...py]);
	const other = names.filter((n) => !grouped.has(n));
	if (preferReconstructed) {
		const ri = html.findIndex(
			(n) => n.toLowerCase() === "reconstructed.html",
		);
		if (ri > 0) {
			return [
				[html[ri], ...html.filter((_, i) => i !== ri)],
				css,
				js,
				py,
				other,
			].flat();
		}
	}
	return [...html, ...css, ...js, ...py, ...other];
}

function _synthesizeLeoMarks(side, fileName) {
	const tokens = _currentMarksEntry?.leo_assignments?.tokens;
	if (!tokens || !fileName) return [];
	const isTruthMode = typeof _truthEditMode !== "undefined" && _truthEditMode;
	const out = [];
	for (const [tok, data] of Object.entries(tokens)) {
		const list = side === "teacher" ? data.teacher : data.student;
		for (const inst of list) {
			if (inst.file !== fileName) continue;
			if (inst.ghost) continue;
			out.push({
				token: tok,
				label: isTruthMode ? null : inst.label || null,
				start: inst.pos,
				end: inst.pos + tok.length,
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

function diffColorizePositions(text, posMarks, side, ghosts, anchors) {
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
		if (m.label && DIFF_LABEL_COLORS[m.label]) return true;
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
			const color =
				m.label && DIFF_LABEL_COLORS[m.label]
					? DIFF_LABEL_COLORS[m.label]
					: null;
			const styleAttr = color
				? ` style="color:${color};font-weight:bold"`
				: "";
			const absPos = m._abs_start ?? m.start;
			const otherSide = side === "teacher" ? "student" : "teacher";
			const isGhostPair = !!(m.paired_with && m.paired_with.ghost);
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
			out +=
				`<span class="${cls}"` +
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

const _GHOST_TOKEN_RE = newTokenRegex();

function _renderGhostBlob(ghost, tokensTbl) {
	const text = ghost.text;
	const blobPos = ghost._abs_pos ?? ghost.pos;
	const wrapAll =
		typeof _truthEditMode !== "undefined" && _truthEditMode === true;
	let out = '<span class="diff-ghost">';
	let lastEnd = 0;
	_GHOST_TOKEN_RE.lastIndex = 0;
	let m;
	while ((m = _GHOST_TOKEN_RE.exec(text)) !== null) {
		if (m.index > lastEnd) out += escHtml(text.slice(lastEnd, m.index));
		const tok = m[0];
		const offset = m.index;
		if (wrapAll || (tokensTbl && tokensTbl[tok])) {
			out +=
				`<span class="leo-mark" data-leo-token="${escAttr(tok)}"` +
				` data-leo-side="teacher" data-leo-pos="${blobPos}"` +
				` data-leo-ghost-offset="${offset}">${escHtml(tok)}</span>`;
		} else {
			out += escHtml(tok);
		}
		lastEnd = m.index + tok.length;
	}
	if (lastEnd < text.length) out += escHtml(text.slice(lastEnd));
	out += "</span>";
	return out;
}

function _labelColor(label) {
	return DIFF_LABEL_COLORS[label] || _cssVar("--clr-btn-hover-dark");
}
