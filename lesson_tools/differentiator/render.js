"use strict";
const _GHOST_TOKEN_RE = newTokenRegex();
const _diffEmbedCache = new Map();
const _DIFF_EMBED_TAG_LANG = { script: "js", style: "css" };

function _diffMissingColorFor(fileName) {
	if (typeof _diffMissingLangColor !== "undefined" && !_diffMissingLangColor)
		return MARK_COLORS.missing;
	return langColorFor(getFileExt(fileName)) || MARK_COLORS.missing;
}

function _diffEmbeddedRangesFor(text) {
	if (!text) return [];
	const cached = _diffEmbedCache.get(text);
	if (cached !== undefined) return cached;
	const ranges = [];
	const LP = window.LanguageProfiles;
	const htmlProfile = LP && LP.getProfile ? LP.getProfile("html") : null;
	if (htmlProfile && LP.embeddedTagRanges) {
		const byTag = LP.embeddedTagRanges(htmlProfile, text);
		for (const [tag, spans] of Object.entries(byTag)) {
			const lang = _DIFF_EMBED_TAG_LANG[tag];
			if (!lang) continue;
			for (const [lo, hi] of spans) ranges.push([lo, hi, lang]);
		}
		ranges.sort((a, b) => a[0] - b[0]);
	}
	_diffEmbedCache.set(text, ranges);
	return ranges;
}

function _diffEffectiveExt(fileName, text, pos) {
	const ext = getFileExt(fileName);
	if ((ext === "html" || ext === "htm") && text && typeof pos === "number") {
		for (const [lo, hi, lang] of _diffEmbeddedRangesFor(text)) {
			if (lo <= pos && pos < hi) return lang;
			if (pos < lo) break;
		}
	}
	return ext;
}

function _diffMissingColorAt(fileName, text, pos) {
	if (typeof _diffMissingLangColor !== "undefined" && !_diffMissingLangColor)
		return MARK_COLORS.missing;
	const ext = _diffEffectiveExt(fileName, text, pos);
	return langColorFor(ext) || MARK_COLORS.missing;
}

function _lineStartOffsets(text) {
	const starts = [0];
	for (let i = 0; i < text.length; i++) {
		if (text[i] === "\n") starts.push(i + 1);
	}
	return starts;
}

function _renderDiffLine(lineIdx, ctx) {
	const {
		lines,
		lineStarts,
		normText,
		sortedMarks,
		fileGhosts,
		fileAnchors,
		lineFileMarks,
		side,
		fileName,
		lineNumFor,
		anchorEndInclusive,
	} = ctx;
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
	const _isLastLine = lineIdx + 1 >= lineStarts.length;
	const lineAnchors = fileAnchors
		.filter(
			(a) =>
				a.pos >= lineStart &&
				(anchorEndInclusive && _isLastLine
					? a.pos <= lineEnd
					: a.pos < lineEnd),
		)
		.map((a) => ({ ...a, _abs_pos: a.pos, pos: a.pos - lineStart }));
	const bgMark =
		lineFileMarks &&
		lineFileMarks.find((lm) => lm.start >= lineStart && lm.start < lineEnd);
	const bgCls = bgMark ? ` diff-line--${bgMark.label}` : "";
	const ln = lineNumFor.numbers[lineIdx];
	const numAttr = ln != null ? ` data-line-num="${ln}"` : "";
	return `<div class="diff-line${bgCls}" data-src-start="${lineStart}"${numAttr}>${diffColorizePositions(lineText, lineMarks, side, lineGhosts, lineAnchors, fileName, normText)}</div>`;
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

	const ctx = {
		lines,
		lineStarts,
		normText,
		sortedMarks,
		fileGhosts,
		fileAnchors,
		lineFileMarks,
		side,
		fileName,
		lineNumFor,
		anchorEndInclusive: false,
	};
	const parts = [];
	for (const pair of alignment) {
		const lineIdx = pair[sideIdx];
		if (lineIdx === null) {
			parts.push('<div class="diff-spacer" contenteditable="false">​</div>');
		} else {
			parts.push(_renderDiffLine(lineIdx, ctx));
		}
	}
	return parts.join("");
}

function _lineNumberMap(lines, lineStarts, normText, fileGhosts) {
	const numbers = new Array(lines.length);
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
	return { numbers };
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

	const ctx = {
		lines,
		lineStarts,
		normText,
		sortedMarks,
		fileGhosts,
		fileAnchors,
		lineFileMarks,
		side,
		fileName,
		lineNumFor,
		anchorEndInclusive: true,
	};
	const parts = [];
	for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
		parts.push(_renderDiffLine(lineIdx, ctx));
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
		const groups = new Map();
		for (const [tFile, marks] of Object.entries(tFiles)) {
			for (const m of marks || []) {
				if (m.label !== "missing") continue;
				if (m.paired_with) continue;
				const ia = m.insert_at;
				if (!ia || ia.file !== studentFileName) continue;
				const key = tFile + "|" + ia.pos;
				let g = groups.get(key);
				if (!g) {
					g = { tFile, pos: ia.pos, marks: [] };
					groups.set(key, g);
				}
				g.marks.push(m);
			}
		}
		for (const g of groups.values()) {
			g.marks.sort((a, b) => a.start - b.start);
			const first = g.marks[0];
			out.push({
				pos: g.pos,
				token: first.token,
				teacher_file: g.tFile,
				teacher_pos: first.start,
			});
		}
	}
	const sFiles = _currentMarksEntry?.student_files;
	if (sFiles) {
		const moveGroups = new Map();
		for (const [sFile, marks] of Object.entries(sFiles)) {
			for (const m of marks || []) {
				if (m.label !== "extra") continue;
				if (m.paired_with) continue;
				const mt = m.move_to;
				if (!mt || mt.file !== studentFileName) continue;
				const key = sFile + "|" + mt.pos;
				let g = moveGroups.get(key);
				if (!g) {
					g = { sFile, pos: mt.pos, marks: [] };
					moveGroups.set(key, g);
				}
				g.marks.push(m);
			}
		}
		for (const g of moveGroups.values()) {
			g.marks.sort((a, b) => a.start - b.start);
			const first = g.marks[0];
			out.push({
				pos: g.pos,
				token: first.token,
				move_source_file: g.sFile,
				move_source_pos: first.start,
			});
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
		const mx = Math.max(Math.ceil(th), Math.ceil(sh));
		if (mx > 0) {
			tRows[i].style.minHeight = `${mx}px`;
			sRows[i].style.minHeight = `${mx}px`;
		}
	}
	_syncDividerHeight();
}

let _syncPending = false;
function _scheduleAlignedSync() {
	if (_syncPending) return;
	_syncPending = true;
	const run = () =>
		requestAnimationFrame(() =>
			requestAnimationFrame(() => {
				_syncPending = false;
				_syncAlignedRowHeights();
				if (typeof _curatedRefreshOverlays === "function") {
					_curatedRefreshOverlays();
				} else if (typeof _curatedRefreshGhostPairs === "function") {
					_curatedRefreshGhostPairs();
				}
			}),
		);
	if (
		typeof document !== "undefined" &&
		document.fonts &&
		document.fonts.status !== "loaded"
	) {
		document.fonts.ready.then(run);
	} else {
		run();
	}
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
	let allAlignments = null;
	if (_linePaddingEnabled) {
		allAlignments = modeData?.alignments ?? _borrowedAlignments();
	}
	const sideIdx = side === "teacher" ? 0 : 1;
	const _lineBasedMode =
		typeof _diffMode === "string" && _diffMode.startsWith("line-");
	const allLineMks = _lineBasedMode ? null : (modeData?.line_marks ?? null);
	const sideLineMks =
		side === "teacher"
			? (allLineMks?.teacher_files ?? null)
			: (allLineMks?.student_files ?? null);

	const allNames = Object.keys(files).filter((n) => CODE_EXT.test(n));
	const names = sortFileNames(allNames, side === "teacher");

	tabs.innerHTML = "";
	tabs.style.display =
		typeof _embedMode !== "undefined" && _embedMode && names.length <= 1
			? "none"
			: "";
	codeWrap.innerHTML = "";

	const inCuratedMode =
		typeof _curatedEditMode !== "undefined" && _curatedEditMode;

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
			_updateHScrollProxy(side);
			const otherSide = side === "teacher" ? "student" : "teacher";
			const otherName = _pairedFileName(side, name);
			if (otherName) _activateFileTab(otherSide, otherName);
			if (typeof _curatedRefreshOverlays === "function") {
				_curatedRefreshOverlays();
			} else if (typeof _curatedRefreshGhostPairs === "function") {
				_curatedRefreshGhostPairs();
			}
			if (
				typeof _refreshPreviewIfActive === "function" &&
				/\.html$/i.test(name)
			) {
				_refreshPreviewIfActive(side);
				if (otherName && /\.html$/i.test(otherName)) {
					_refreshPreviewIfActive(otherSide);
				}
			}
		};
		if (
			side === "student" &&
			inCuratedMode &&
			!(typeof _embedMode !== "undefined" && _embedMode)
		) {
			const caret = document.createElement("span");
			caret.className = "file-pair-caret";
			caret.textContent = "▾";
			if (pairedAs) caret.classList.add("is-paired");
			caret.title = pairedAs
				? `Showing as ${pairedAs} (original: ${name})`
				: "Pair with a teacher file";
			caret.addEventListener("click", (ev) => {
				ev.stopPropagation();
				if (typeof _curatedShowFilePairMenu === "function") {
					_curatedShowFilePairMenu(caret, name);
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
		} else if (hasMarks || inCuratedMode) {
			pane.innerHTML = `<div class="code-aligned">${_renderFlat(sourceText, fileMarks, lineFileMarks, side, name)}</div>`;
		} else {
			pane.innerHTML = `<pre>${escHtml(sourceText)}</pre>`;
		}
		codeWrap.appendChild(pane);
	});

	requestAnimationFrame(() => {
		_updateHScrollProxy(side);
		if (typeof _updateTabHScroll === "function") _updateTabHScroll(side);
	});
	_scheduleAlignedSync();

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

function _renderGhostBlob(ghost, tokensTbl) {
	const text = ghost.text;
	const blobPos = ghost._abs_pos ?? ghost.pos;
	const wrapAll =
		typeof _curatedEditMode !== "undefined" && _curatedEditMode === true;
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
	return MARK_COLORS[label] || _cssVar("--clr-btn-hover-dark");
}
