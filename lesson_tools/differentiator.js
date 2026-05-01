"use strict";

const DIFF_LABEL_COLORS = {
	missing: "#e00",
	comment: "#4a4",
	extra: "#00c",
	ghost_extra: "#3aa0e0",
	extra_comment: "#080",
};

let _diffMode = null;
let _teacherFiles = null;
let _studentFiles = null;
let _teacherMarks = null;
let _studentMarks = null;
let _allMarks = {};
let _currentMarksEntry = null;
let _titleBase = null;
let _imageUris = {};
let _diffSessionKey = null;
let _linePaddingEnabled =
	typeof localStorage !== "undefined" &&
	localStorage.getItem("diff-line-padding") === "off"
		? false
		: true;

const DIFF_MODE_OPTIONS = [
	{ key: "truth", label: "TRUTH" },
	{ key: "", label: "LEO*" },
	{ key: "leo", label: "LEO" },
	{ key: "token-lcs-star", label: "LCS*" },
	{ key: "token-lcs", label: "LCS" },
	{ key: "token-lev-star", label: "Lev*" },
	{ key: "token-lev", label: "Lev" },
	{ key: "line-ro-star", label: "R/O*" },
	{ key: "line-ro", label: "R/O" },
	{ key: "line-git-star", label: "Git*" },
	{ key: "line-git", label: "Git" },
];

function _refreshModeSelect() {
	const modeSelect = document.getElementById("mode-select");
	if (!modeSelect) return;

	const availableKeys = new Set(Object.keys(_allMarks));
	modeSelect.innerHTML = "";

	for (const optionDef of DIFF_MODE_OPTIONS) {
		if (!availableKeys.has(optionDef.key)) continue;
		const option = document.createElement("option");
		option.value = optionDef.key;
		option.textContent = optionDef.label;
		modeSelect.appendChild(option);
	}

	const nextMode = defaultDiffModeKey(_allMarks, _diffMode);
	_diffMode = nextMode;
	modeSelect.disabled = modeSelect.options.length <= 1;
	modeSelect.value = nextMode ?? "";
}

function _resolveMarksEntry() {
	const modeKey = _diffMode ?? "";
	return _allMarks[modeKey] ?? Object.values(_allMarks)[0] ?? null;
}

const _BORROW_ALIGNMENT_ORDER = [
	"line-git",
	"line-git-star",
	"line-ro",
	"line-ro-star",
	"leo",
	"",
	"token-lcs",
	"token-lcs-star",
	"token-lev",
	"token-lev-star",
];

function _borrowedAlignments() {
	for (const mode of _BORROW_ALIGNMENT_ORDER) {
		const m = _allMarks[mode];
		if (m && m.alignments && Object.keys(m.alignments).length) {
			return m.alignments;
		}
	}
	for (const m of Object.values(_allMarks)) {
		if (m && m.alignments && Object.keys(m.alignments).length) {
			return m.alignments;
		}
	}
	return null;
}

function _applyCurrentMarks() {
	_currentMarksEntry = _resolveMarksEntry();
	_teacherMarks = _currentMarksEntry?.teacher_files ?? null;
	_studentMarks = _currentMarksEntry?.student_files ?? null;
}

function _serializeDiffState() {
	return {
		teacherFiles: _teacherFiles || {},
		studentFiles: _studentFiles || {},
		imageUris: _imageUris || {},
		allMarks: _allMarks || {},
		truthWorking: typeof _truthWorking !== "undefined" ? _truthWorking : {},
		mode: _diffMode,
		teacherMarks: _currentMarksEntry?.teacher_files ?? _teacherMarks ?? null,
		studentMarks: _currentMarksEntry?.student_files ?? _studentMarks ?? null,
		title: document.title || null,
		titleBase: _titleBase,
	};
}

function _persistDiffState() {
	if (!_diffSessionKey) return;
	if (!_teacherFiles && !_studentFiles) return;
	try {
		sessionStorage.setItem(
			_diffSessionKey,
			JSON.stringify(_serializeDiffState()),
		);
	} catch {}
}

function _applyIncomingData(data) {
	_teacherFiles = data.teacherFiles || {};
	_studentFiles = data.studentFiles || {};
	_imageUris = data.imageUris || {};
	if (data.truthWorking && typeof _truthWorking !== "undefined") {
		_truthWorking = data.truthWorking;
	}

	if (data.allMarks) {
		_allMarks = data.allMarks;
		_diffMode = defaultDiffModeKey(_allMarks, data.mode ?? _diffMode);
		_refreshModeSelect();
		_applyCurrentMarks();
	} else {
		_currentMarksEntry =
			data.teacherMarks || data.studentMarks
				? {
						teacher_files: data.teacherMarks || null,
						student_files: data.studentMarks || null,
					}
				: null;
		_teacherMarks = _currentMarksEntry?.teacher_files ?? null;
		_studentMarks = _currentMarksEntry?.student_files ?? null;
	}

	if (data.title) document.title = data.title;
	const titleText = data.title || "Student";
	_titleBase =
		data.titleBase ||
		titleText.replace(/\s*\([^)]*%\)\s*$/, "").trim() ||
		titleText;
	document.getElementById("title-student").textContent = titleText;

	renderPanel("teacher", _teacherFiles, _teacherMarks);
	renderPanel("student", _studentFiles, _studentMarks);
	_updateTitleScore();
}

window.addEventListener("DOMContentLoaded", async () => {
	const params = new URLSearchParams(location.search);
	const keyParam = params.get("key");
	const key = keyParam || "diffData";
	_diffSessionKey = keyParam ? `differentiatorSession:${keyParam}` : null;
	const modeParam = params.get("mode") || null;
	_diffMode = modeParam;
	_refreshLinePaddingButton();

	const modeSelect = document.getElementById("mode-select");
	if (modeSelect) {
		modeSelect.addEventListener("change", () => {
			_diffMode = modeSelect.value;
			_applyDiffModeLabel();
			_applyCurrentMarks();
			const savedTeacher = _saveState("teacher");
			const savedStudent = _saveState("student");
			if (_teacherFiles)
				renderPanel("teacher", _teacherFiles, _teacherMarks);
			if (_studentFiles)
				renderPanel("student", _studentFiles, _studentMarks);
			_restoreState("teacher", savedTeacher);
			_restoreState("student", savedStudent);
			_updateTitleScore();
			_persistDiffState();
		});
	}

	let incoming = null;
	const raw = localStorage.getItem(key);
	if (raw) {
		localStorage.removeItem(key);
		try {
			incoming = JSON.parse(raw);
		} catch (e) {
			console.error("[Differentiator] Failed to parse diff data", e);
		}
	}
	if (
		!incoming &&
		window.opener &&
		typeof window.opener.__getDifferentiatorData === "function"
	) {
		try {
			incoming = await window.opener.__getDifferentiatorData(key);
		} catch (e) {
			console.error("[Differentiator] Failed to fetch from opener", e);
		}
	}
	if (incoming) {
		_applyIncomingData(incoming);
		_persistDiffState();
	} else if (_diffSessionKey) {
		const savedRaw = sessionStorage.getItem(_diffSessionKey);
		if (savedRaw) {
			try {
				_applyIncomingData(JSON.parse(savedRaw));
			} catch (e) {
				console.error("[Differentiator] Failed to restore session data", e);
			}
		}
	}

	window.addEventListener("beforeunload", _persistDiffState);
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") _persistDiffState();
	});

	document.getElementById("input-teacher").addEventListener("change", (e) => {
		loadFilesFromInput(e.target.files, "teacher");
	});
	document.getElementById("input-student").addEventListener("change", (e) => {
		loadFilesFromInput(e.target.files, "student");
	});
});

function loadFilesFromInput(files, side) {
	const texts = {};
	let pending = files.length;
	if (!pending) return;

	for (const file of files) {
		const reader = new FileReader();
		reader.onload = (e) => {
			const mode = diffModeFromFilename(file.name);
			if (mode != null) {
				try {
					const parsed = JSON.parse(e.target.result);
					if (!_allMarks[mode]) _allMarks[mode] = {};
					Object.assign(_allMarks[mode], parsed);
				} catch {}
			} else {
				texts[file.name] = e.target.result;
			}
			pending--;
			if (pending === 0) {
				_refreshModeSelect();
				_applyCurrentMarks();
				if (side === "teacher") _teacherFiles = texts;
				else _studentFiles = texts;
				renderPanel(
					side,
					side === "teacher" ? _teacherFiles : _studentFiles,
					side === "teacher" ? _teacherMarks : _studentMarks,
				);
				_updateTitleScore();
				_persistDiffState();
			}
		};
		reader.readAsText(file);
	}
}

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
			parts.push(
				`<div class="diff-line${bgCls}" data-src-start="${lineStart}">${diffColorizePositions(lineText, lineMarks, side, lineGhosts, lineAnchors)}</div>`,
			);
		}
	}
	return parts.join("");
}

function _renderFlat(text, fileMarks, lineFileMarks, side, fileName) {
	const normText = text.replace(/\r\n/g, "\n");
	const lines = normText.split("\n");
	const lineStarts = _lineStartOffsets(normText);
	const synthMarks = _synthesizeLeoMarks(side, fileName);
	const sortedMarks = _mergeMarks(fileMarks, synthMarks);
	const fileGhosts = side === "teacher" ? _getFileGhosts(fileName) : [];
	const fileAnchors = side === "student" ? _getInsertAnchors(fileName) : [];

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
		parts.push(
			`<div class="diff-line${bgCls}" data-src-start="${lineStart}">${diffColorizePositions(lineText, lineMarks, side, lineGhosts, lineAnchors)}</div>`,
		);
	}
	return parts.join("");
}

function _getFileGhosts(fileName) {
	const map = _currentMarksEntry?.teacher_ghosts;
	return (map && map[fileName]) || [];
}

function _getInsertAnchors(studentFileName) {
	const tFiles = _currentMarksEntry?.teacher_files;
	if (!tFiles || !studentFileName) return [];
	const out = [];
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
}

function renderPanel(side, files, marks) {
	if (!files || !Object.keys(files).length) return;

	const landing = document.getElementById(`landing-${side}`);
	const content = document.getElementById(`content-${side}`);
	const tabs = document.getElementById(`tabs-${side}`);
	const codeWrap = document.getElementById(`code-${side}`);
	const previewBtn = document.getElementById("btn-preview");
	const previewFrame = document.getElementById(`preview-${side}`);

	landing.style.display = "none";
	content.style.display = "flex";
	if (side === "teacher") {
		const bottomBar = document.getElementById("bottom-bar");
		if (bottomBar) bottomBar.style.display = "flex";
	}

	if (previewFrame) {
		previewFrame.style.display = "none";
		if (side === "teacher" && previewBtn) {
			previewBtn.classList.remove("active");
			previewBtn.textContent = "⬜ Preview";
		}
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
		/\.(html|css|js)$/i.test(n),
	);
	const names = sortFileNames(allNames, side === "teacher");

	tabs.innerHTML = "";
	codeWrap.innerHTML = "";

	names.forEach((name, i) => {
		const btn = document.createElement("button");
		btn.className = "file-tab" + (i === 0 ? " file-tab-active" : "");
		btn.textContent = name;
		btn.onclick = () => {
			tabs
				.querySelectorAll(".file-tab")
				.forEach((t) => t.classList.remove("file-tab-active"));
			codeWrap
				.querySelectorAll(".code-pane")
				.forEach((p) => p.classList.remove("active"));
			btn.classList.add("file-tab-active");
			codeWrap.children[i].classList.add("active");
		};
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
		} else if (hasMarks) {
			pane.innerHTML = `<div class="code-aligned">${_renderFlat(sourceText, fileMarks, lineFileMarks, side, name)}</div>`;
		} else {
			pane.innerHTML = `<pre>${escHtml(sourceText)}</pre>`;
		}
		codeWrap.appendChild(pane);
	});

	requestAnimationFrame(_syncAlignedRowHeights);

	if (localStorage.getItem("diff-preview-mode") === "preview") {
		const files = side === "teacher" ? _teacherFiles : _studentFiles;
		const iframe = document.getElementById(`preview-${side}`);
		if (files && Object.keys(files).length && iframe) {
			updatePreview(side, files, iframe);
			iframe.style.display = "block";
			codeWrap.style.display = "none";
		}
		if (side === "teacher" && previewBtn) {
			previewBtn.textContent = "📄 Code";
			previewBtn.classList.add("active");
		}
	}
}

function sortFileNames(names, preferReconstructed) {
	const html = names.filter((n) => /\.html$/i.test(n));
	const css = names.filter((n) => /\.css$/i.test(n));
	const js = names.filter((n) => /\.js$/i.test(n));
	if (preferReconstructed) {
		const ri = html.findIndex(
			(n) => n.toLowerCase() === "reconstructed.html",
		);
		if (ri > 0) {
			return [
				[html[ri], ...html.filter((_, i) => i !== ri)],
				css,
				js,
			].flat();
		}
	}
	return [...html, ...css, ...js];
}

function _synthesizeLeoMarks(side, fileName) {
	const tokens = _currentMarksEntry?.leo_assignments?.tokens;
	if (!tokens || !fileName) return [];
	const out = [];
	for (const [tok, data] of Object.entries(tokens)) {
		const list = side === "teacher" ? data.teacher : data.student;
		for (const inst of list) {
			if (inst.file !== fileName) continue;
			if (inst.ghost) continue;
			out.push({
				token: tok,
				label: inst.label || null,
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
			const pairedAttrs = m.paired_with
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
			const leoClass = m.paired_with
				? "leo-mark swap-paired"
				: m.insert_at
					? "leo-mark insert-source"
					: "leo-mark";
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
			out +=
				`<span class="insert-anchor"` +
				` data-insert-anchor-pos="${absPos}"` +
				` data-insert-anchor-token="${escAttr(a.token)}"` +
				` data-insert-anchor-teacher-file="${escAttr(a.teacher_file)}"` +
				` data-insert-anchor-teacher-pos="${a.teacher_pos}">▾</span>`;
		}
	}
	if (pos < normText.length) {
		out += escHtml(normText.slice(pos));
	}
	return out;
}

const _GHOST_TOKEN_RE = /[a-zA-Z0-9]+|[^\s]/g;

function _renderGhostBlob(ghost, tokensTbl) {
	const text = ghost.text;
	const blobPos = ghost._abs_pos ?? ghost.pos;
	let out = '<span class="diff-ghost">';
	let lastEnd = 0;
	_GHOST_TOKEN_RE.lastIndex = 0;
	let m;
	while ((m = _GHOST_TOKEN_RE.exec(text)) !== null) {
		if (m.index > lastEnd)
			out += _ghostWhitespaceHtml(text.slice(lastEnd, m.index));
		const tok = m[0];
		const offset = m.index;
		if (tokensTbl && tokensTbl[tok]) {
			out +=
				`<span class="leo-mark" data-leo-token="${escAttr(tok)}"` +
				` data-leo-side="teacher" data-leo-pos="${blobPos}"` +
				` data-leo-ghost-offset="${offset}">${escHtml(tok)}</span>`;
		} else {
			out += escHtml(tok);
		}
		lastEnd = m.index + tok.length;
	}
	if (lastEnd < text.length) out += _ghostWhitespaceHtml(text.slice(lastEnd));
	out += "</span>";
	return out;
}

function _ghostWhitespaceHtml(s) {
	return escHtml(s);
}

function _labelColor(label) {
	if (label === "missing") return "#e00";
	if (label === "extra") return "#00c";
	if (label === "ghost_extra") return "#3aa0e0";
	return "#666";
}

function _ctxSlice(inst, side) {
	const la = _currentMarksEntry?.leo_assignments;
	if (!la || !inst) return null;
	const useAug =
		side === "teacher" &&
		Array.isArray(la.teacher_seq_aug) &&
		Number.isInteger(inst.seq_idx_aug);
	const seq = useAug
		? la.teacher_seq_aug
		: side === "teacher"
			? la.teacher_seq
			: la.student_seq;
	const idx = useAug ? inst.seq_idx_aug : inst.seq_idx;
	const k = la.k ?? 40;
	if (!seq || idx == null) return null;
	const lo = Math.max(0, idx - k);
	const hi = Math.min(seq.length, idx + k + 1);
	return {
		before: seq.slice(lo, idx),
		after: seq.slice(idx + 1, hi),
	};
}

function _instHasGhostNeighbours(inst, sideName) {
	if (sideName !== "teacher") return false;
	if (inst.ghost) return false;
	if (!Number.isInteger(inst.seq_idx_aug)) return false;
	const sv = _strippedTeacherView();
	if (!sv) return false;
	const la = _currentMarksEntry?.leo_assignments;
	const k = la?.k ?? 18;
	const idx = inst.seq_idx_aug;
	const lo = Math.max(0, idx - k);
	const hi = Math.min(sv.isGhostAt.length, idx + k + 1);
	for (let i = lo; i < hi; i++) {
		if (i !== idx && sv.isGhostAt[i]) return true;
	}
	return false;
}

function _ctxSliceStripped(inst) {
	const la = _currentMarksEntry?.leo_assignments;
	const sv = _strippedTeacherView();
	if (!la || !sv || !Number.isInteger(inst.seq_idx_aug)) return null;
	const k = la.k ?? 40;
	const anchorIdx = sv.augToStripped[inst.seq_idx_aug];
	const anchorIsGhost = sv.isGhostAt[inst.seq_idx_aug];
	const seq = sv.strippedSeq;
	if (anchorIsGhost) {
		return {
			before: seq.slice(Math.max(0, anchorIdx - k), anchorIdx),
			after: seq.slice(anchorIdx, Math.min(seq.length, anchorIdx + k)),
		};
	}
	return {
		before: seq.slice(Math.max(0, anchorIdx - k), anchorIdx),
		after: seq.slice(anchorIdx + 1, Math.min(seq.length, anchorIdx + k + 1)),
	};
}

function _strippedTeacherView() {
	const la = _currentMarksEntry?.leo_assignments;
	if (!la) return null;
	if (la.__strippedView !== undefined) return la.__strippedView;
	const aug = la.teacher_seq_aug;
	if (!Array.isArray(aug) || !aug.some((t) => Array.isArray(t))) {
		la.__strippedView = null;
		return null;
	}
	const strippedSeq = [];
	const augToStripped = [];
	const isGhostAt = [];
	for (const t of aug) {
		const gho = Array.isArray(t);
		isGhostAt.push(gho);
		augToStripped.push(strippedSeq.length);
		if (!gho) strippedSeq.push(t);
	}
	la.__strippedView = { strippedSeq, augToStripped, isGhostAt };
	return la.__strippedView;
}

function _instContextVectors(inst, sideName) {
	const la = _currentMarksEntry?.leo_assignments;
	if (!la) return null;
	const k = la.k ?? 10;
	const idf = la.idf || {};
	let seq, idx;
	if (sideName === "teacher") {
		const aug = Array.isArray(la.teacher_seq_aug) ? la.teacher_seq_aug : null;
		if (aug && Number.isInteger(inst.seq_idx_aug)) {
			seq = aug.map((t) => (Array.isArray(t) ? t[0] : t));
			idx = inst.seq_idx_aug;
		} else {
			seq = la.teacher_seq;
			idx = inst.seq_idx;
		}
	} else {
		seq = la.student_seq;
		idx = inst.seq_idx;
	}
	if (!seq || !Number.isInteger(idx)) return null;
	const primary = _buildContextSplit(seq, idx, k, idf);
	let alt = null;
	if (
		sideName === "teacher" &&
		!inst.ghost &&
		Number.isInteger(inst.seq_idx_aug)
	) {
		const sv = _strippedTeacherView();
		if (sv) {
			alt = _buildStrippedContextSplit(
				sv.strippedSeq,
				sv.augToStripped[inst.seq_idx_aug],
				sv.isGhostAt[inst.seq_idx_aug],
				k,
				idf,
			);
		}
	}
	return { primary, alt };
}

// A "context pack": { left, right } — two Maps weighted by IDF (no decay).
function _buildContextSplit(seq, idx, k, idf) {
	const left = new Map();
	const right = new Map();
	for (let i = Math.max(0, idx - k); i < idx; i++) {
		const tok = seq[i];
		const w = idf[tok] || 0;
		if (w > 0) left.set(tok, (left.get(tok) || 0) + w);
	}
	for (let i = idx + 1; i < Math.min(seq.length, idx + k + 1); i++) {
		const tok = seq[i];
		const w = idf[tok] || 0;
		if (w > 0) right.set(tok, (right.get(tok) || 0) + w);
	}
	return { left, right };
}

function _buildStrippedContextSplit(
	strippedSeq,
	anchorIdx,
	anchorIsGhost,
	k,
	idf,
) {
	const left = new Map();
	const right = new Map();
	const n = strippedSeq.length;
	if (anchorIsGhost) {
		for (let off = 1; off <= k; off++) {
			const i = anchorIdx - off;
			if (i < 0) break;
			const tok = strippedSeq[i];
			const w = idf[tok] || 0;
			if (w > 0) left.set(tok, (left.get(tok) || 0) + w);
		}
		for (let off = 1; off <= k; off++) {
			const i = anchorIdx - 1 + off;
			if (i >= n) break;
			const tok = strippedSeq[i];
			const w = idf[tok] || 0;
			if (w > 0) right.set(tok, (right.get(tok) || 0) + w);
		}
	} else {
		for (let i = Math.max(0, anchorIdx - k); i < anchorIdx; i++) {
			const tok = strippedSeq[i];
			const w = idf[tok] || 0;
			if (w > 0) left.set(tok, (left.get(tok) || 0) + w);
		}
		for (let i = anchorIdx + 1; i < Math.min(n, anchorIdx + k + 1); i++) {
			const tok = strippedSeq[i];
			const w = idf[tok] || 0;
			if (w > 0) right.set(tok, (right.get(tok) || 0) + w);
		}
	}
	return { left, right };
}

// Combined matching score: 0.3 * min(cos_L, cos_R) + 0.7 * max(cos_L, cos_R).
// Mirrors _combined_context_score in token_log.py. Vectors built with
// IDF weights from la.idf.
function _combinedScore(packA, packB) {
	if (!packA || !packB) return 0;
	const cLeft = _cosineSim(packA.left, packB.left);
	const cRight = _cosineSim(packA.right, packB.right);
	return 0.3 * Math.min(cLeft, cRight) + 0.7 * Math.max(cLeft, cRight);
}

function _scorePair(ctxA, ctxB) {
	if (!ctxA || !ctxB) return 0;
	let best = _combinedScore(ctxA.primary, ctxB.primary);
	if (ctxA.alt) best = Math.max(best, _combinedScore(ctxA.alt, ctxB.primary));
	if (ctxB.alt) best = Math.max(best, _combinedScore(ctxA.primary, ctxB.alt));
	return best;
}

function _cosineSim(v1, v2) {
	if (!v1 || !v2 || v1.size === 0 || v2.size === 0) return 0;
	let dot = 0,
		n1 = 0,
		n2 = 0;
	for (const [k, val] of v1) {
		n1 += val * val;
		const o = v2.get(k);
		if (o) dot += val * o;
	}
	for (const val of v2.values()) n2 += val * val;
	if (!dot || !n1 || !n2) return 0;
	return dot / (Math.sqrt(n1) * Math.sqrt(n2));
}

function _findInstIdx(list, pos, ghostOffset) {
	if (!list) return -1;
	if (ghostOffset != null) {
		return list.findIndex(
			(x) => x.ghost && x.pos === pos && x.blob_offset === ghostOffset,
		);
	}
	return list.findIndex((x) => !x.ghost && x.pos === pos);
}

function _renderLeoTooltip(token, data, side, pos, ghostOffset) {
	const tEsc = escHtml(token);

	const teachers = data.teacher;
	const students = data.student;
	const thisList = side === "teacher" ? teachers : students;
	const thisIdx = _findInstIdx(thisList, pos, ghostOffset);
	const thisInst = thisIdx >= 0 ? thisList[thisIdx] : null;
	const matchedOtherIdx =
		thisInst && Number.isInteger(thisInst.match_idx)
			? thisInst.match_idx
			: -1;

	const clickedCtx = thisInst ? _instContextVectors(thisInst, side) : null;
	const clickedCtxSlice = thisInst ? _ctxSlice(thisInst, side) : null;
	const clickedCtxSliceStripped =
		thisInst && _instHasGhostNeighbours(thisInst, side)
			? _ctxSliceStripped(thisInst)
			: null;
	const clickedWindowSet = clickedCtxSlice
		? new Set([
				...clickedCtxSlice.before.map((t) => (Array.isArray(t) ? t[0] : t)),
				...clickedCtxSlice.after.map((t) => (Array.isArray(t) ? t[0] : t)),
				...(clickedCtxSliceStripped ? clickedCtxSliceStripped.before : []),
				...(clickedCtxSliceStripped ? clickedCtxSliceStripped.after : []),
			])
		: null;

	const _fmtCtxTokenBold = (t) => {
		const tok = Array.isArray(t) ? t[0] : t;
		const isMatch = clickedWindowSet && clickedWindowSet.has(tok);
		if (Array.isArray(t))
			return `<span class="leo-ghost-tok"${isMatch ? ' style="font-weight:bold;text-decoration:underline"' : ""}>${escHtml(t[0])}</span>`;
		return isMatch ? `<b><u>${escHtml(t)}</u></b>` : escHtml(t);
	};

	const labelClass = (inst) =>
		inst.ghost
			? "leo-row-ghost"
			: inst.label === "missing"
				? "leo-row-missing"
				: inst.label === "extra"
					? "leo-row-extra"
					: inst.label === "ghost_extra"
						? "leo-row-extra-star"
						: "";

	const renderSingleRow = (inst, sideName, ctx, highlight, score, isSelf) => {
		const fmt = isSelf ? _fmtCtxToken : _fmtCtxTokenBold;
		const before = ctx ? ctx.before.map(fmt).join(" ") : "";
		const after = ctx ? ctx.after.map(fmt).join(" ") : "";
		const lblColor = inst.ghost ? "#888" : _labelColor(inst.label);
		const cls =
			`leo-row ${labelClass(inst)}${highlight ? " leo-this" : ""}`.trim();
		const scoreCell =
			score == null
				? '<span class="leo-score"></span>'
				: `<span class="leo-score">${(score * 100).toFixed(0)}%</span>`;
		return (
			`<div class="${cls}">` +
			scoreCell +
			`<span class="leo-before">${before}</span>` +
			`<span class="leo-center" style="color:${lblColor}">${tEsc}</span>` +
			`<span class="leo-after">${after}</span>` +
			`</div>`
		);
	};

	const renderRow = (
		inst,
		sideName,
		highlight,
		score,
		isSelf = false,
		scoreAlt = null,
	) => {
		const isDual = highlight && _instHasGhostNeighbours(inst, sideName);
		if (!isDual) {
			return renderSingleRow(
				inst,
				sideName,
				_ctxSlice(inst, sideName),
				highlight,
				score,
				isSelf,
			);
		}
		const ctxWith = _ctxSlice(inst, sideName);
		const ctxStripped = _ctxSliceStripped(inst);
		const cls = `leo-pair${highlight ? " leo-this" : ""}`;
		return (
			`<div class="${cls}">` +
			renderSingleRow(inst, sideName, ctxWith, false, score, isSelf) +
			renderSingleRow(inst, sideName, ctxStripped, false, scoreAlt, isSelf) +
			`</div>`
		);
	};

	const sepRow = '<div class="leo-row leo-sep">⋯</div>';
	const renderSection = (list, sideName, anchorOrigIdxs) => {
		if (sideName === side) {
			if (thisIdx < 0 || thisIdx >= list.length) return "";
			return renderRow(list[thisIdx], sideName, true, null, true, null);
		}
		const scored = list.map((inst, i) => {
			const ctxs = clickedCtx ? _instContextVectors(inst, sideName) : null;
			let score = null;
			let scoreAlt = null;
			if (clickedCtx && ctxs) {
				score = _combinedScore(clickedCtx.primary, ctxs.primary);
				if (ctxs.alt) {
					scoreAlt = _combinedScore(clickedCtx.primary, ctxs.alt);
				}
				if (clickedCtx.alt) {
					score = Math.max(
						score,
						_combinedScore(clickedCtx.alt, ctxs.primary),
					);
				}
			}
			const sortScore =
				scoreAlt != null ? Math.max(score ?? 0, scoreAlt) : score;
			return { inst, origIdx: i, score, scoreAlt, sortScore };
		});
		const order = clickedCtx
			? scored
					.slice()
					.sort(
						(a, b) =>
							(b.sortScore ?? -1) - (a.sortScore ?? -1) ||
							a.origIdx - b.origIdx,
					)
			: scored;
		const anchorPositions = anchorOrigIdxs
			.filter((i) => i != null && i >= 0)
			.map((i) => order.findIndex((s) => s.origIdx === i))
			.filter((p) => p >= 0);
		const visible = _selectVisibleRows(order.length, anchorPositions);
		const out = [];
		let prev = -1;
		for (const p of visible) {
			if (prev >= 0 && p > prev + 1) out.push(sepRow);
			const { inst, origIdx, score, scoreAlt } = order[p];
			const isMatched = origIdx === matchedOtherIdx;
			out.push(renderRow(inst, sideName, isMatched, score, false, scoreAlt));
			prev = p;
		}
		return out.join("");
	};

	const nTeacherSurv = teachers.filter((t) => !t.ghost).length;
	const nTeacherGhost = teachers.length - nTeacherSurv;
	const ghostNote = nTeacherGhost ? ` (+${nTeacherGhost} ghost)` : "";
	let html = "";
	const ordered =
		side === "student" ? ["student", "teacher"] : ["teacher", "student"];
	for (const sName of ordered) {
		const list = sName === "teacher" ? teachers : students;
		if (!list.length) continue;
		const anchors = sName === side ? [thisIdx] : [matchedOtherIdx];
		const title = sName === "teacher" ? "Teacher" : "Student";
		html += `<div class="leo-section-title">${title}</div>`;
		html += renderSection(list, sName, anchors);
	}
	return html;
}

function _selectVisibleRows(n, anchors) {
	if (n <= 20) return Array.from({ length: n }, (_, i) => i);
	const set = new Set();
	for (let i = 0; i < 10; i++) set.add(i);
	for (let i = n - 10; i < n; i++) set.add(i);
	for (const a of anchors) {
		if (Number.isInteger(a) && a >= 0 && a < n) set.add(a);
	}
	return [...set].sort((a, b) => a - b);
}

function _fmtCtxToken(t) {
	if (Array.isArray(t))
		return `<span class="leo-ghost-tok">${escHtml(t[0])}</span>`;
	return escHtml(t);
}

let _leoTip = null;
let _leoTipBody = null;
let _leoTipTitle = null;
function _ensureLeoTooltip() {
	if (_leoTip) return _leoTip;
	_leoTip = document.createElement("div");
	_leoTip.id = "leo-tooltip";
	_leoTip.className = "float-win";

	const header = document.createElement("div");
	header.className = "float-win__header";
	const dragHint = document.createElement("span");
	dragHint.className = "float-win__drag";
	dragHint.textContent = "⠿";
	header.appendChild(dragHint);
	_leoTipTitle = document.createElement("span");
	_leoTipTitle.className = "float-win__title";
	header.appendChild(_leoTipTitle);
	const closeBtn = document.createElement("button");
	closeBtn.className = "float-win__close";
	closeBtn.textContent = "×";
	closeBtn.addEventListener("click", _hideLeoTooltip);
	header.appendChild(closeBtn);

	_leoTipBody = document.createElement("div");
	_leoTipBody.className = "float-win__body";

	_leoTip.appendChild(header);
	_leoTip.appendChild(_leoTipBody);
	document.body.appendChild(_leoTip);

	makeDraggable(header, _leoTip);

	return _leoTip;
}

function _findMarkAtPos(side, token, pos) {
	const marks = side === "teacher" ? _teacherMarks : _studentMarks;
	if (!marks) return null;
	for (const fileMarks of Object.values(marks)) {
		for (const m of fileMarks) {
			if (m.token === token && m.start === pos) return m;
		}
	}
	return null;
}

function _renderSimpleTooltip(token, mark) {
	const tEsc = escHtml(token);
	const label = mark.label || "matched";
	const color = DIFF_LABEL_COLORS[label] || "#666";
	let html = "";
	if (mark.timestamp) {
		html += `<div class="leo-row"><span class="leo-sub">teacher typed: ${escHtml(mark.timestamp)}</span></div>`;
	}
	if (mark.removal_ts) {
		html += `<div class="leo-row"><span class="leo-sub">teacher removed: ${escHtml(mark.removal_ts)}</span></div>`;
	}
	return html;
}

function _showLeoTooltip(target) {
	const token = target.getAttribute("data-leo-token");
	const side = target.getAttribute("data-leo-side");
	const pos = parseInt(target.getAttribute("data-leo-pos"), 10);
	const ghostOffsetAttr = target.getAttribute("data-leo-ghost-offset");
	const ghostOffset =
		ghostOffsetAttr != null ? parseInt(ghostOffsetAttr, 10) : null;
	if (!token || !side || Number.isNaN(pos)) return;
	const tokens = _currentMarksEntry?.leo_assignments?.tokens;
	const data = tokens && tokens[token];
	const tip = _ensureLeoTooltip();
	if (!data) {
		const mark = _findMarkAtPos(side, token, pos);
		if (!mark) return;
		_applyMarkPairHighlight(target);
		const label = mark.label || "matched";
		const color = DIFF_LABEL_COLORS[label] || "#666";
		_leoTipTitle.innerHTML = `<span style="color:${color};font-weight:bold">${escHtml(token)}</span> <span class="leo-sub">— ${escHtml(label)}</span>`;
		_leoTipBody.innerHTML = _renderSimpleTooltip(token, mark);
		tip.style.display = "flex";
		const r = target.getBoundingClientRect();
		const tw = tip.offsetWidth;
		const th = tip.offsetHeight;
		let left = r.left;
		let top = r.bottom + 6;
		if (left + tw > window.innerWidth - 8) left = window.innerWidth - tw - 8;
		if (top + th > window.innerHeight - 8) top = r.top - th - 6;
		tip.style.left = `${Math.max(8, left)}px`;
		tip.style.top = `${Math.max(8, top)}px`;
		return;
	}
	_clearLeoHighlights();
	_applyLeoHighlights(target, data, side, pos, ghostOffset);
	const nTeacherSurv = data.teacher.filter((t) => !t.ghost).length;
	const nTeacherGhost = data.teacher.length - nTeacherSurv;
	const ghostNote = nTeacherGhost ? ` (+${nTeacherGhost} ghost)` : "";
	_leoTipTitle.innerHTML = `${escHtml(token)} <span class="leo-sub"> &nbsp; ${nTeacherSurv} teacher${ghostNote} / ${data.student.length} student</span>`;
	_leoTipBody.innerHTML = _renderLeoTooltip(
		token,
		data,
		side,
		pos,
		ghostOffset,
	);
	tip.style.display = "flex";
	const r = target.getBoundingClientRect();
	const tw = tip.offsetWidth;
	const th = tip.offsetHeight;
	let left = r.left;
	let top = r.bottom + 6;
	if (left + tw > window.innerWidth - 8) left = window.innerWidth - tw - 8;
	if (top + th > window.innerHeight - 8) top = r.top - th - 6;
	tip.style.left = `${Math.max(8, left)}px`;
	tip.style.top = `${Math.max(8, top)}px`;
}

function _hideLeoTooltip() {
	if (_leoTip) _leoTip.style.display = "none";
	_clearLeoHighlights();
}

let _leoHighlighted = [];
let _swapHighlighted = [];
let _insertHighlighted = [];
function _clearLeoHighlights() {
	for (const el of _leoHighlighted) {
		el.classList.remove(
			"leo-highlight-active",
			"leo-highlight-pair-extra",
			"leo-highlight-pair-missing",
		);
	}
	_leoHighlighted = [];
	for (const el of _swapHighlighted)
		el.classList.remove("swap-partner-active");
	_swapHighlighted = [];
	for (const el of _insertHighlighted) el.classList.remove("insert-active");
	_insertHighlighted = [];
}

function _applySwapPartnerHighlight(target) {
	const otherSide = target.getAttribute("data-swap-side");
	const partnerPos = target.getAttribute("data-swap-pos");
	const partnerToken = target.getAttribute("data-swap-token");
	if (!otherSide || partnerPos == null) return;
	const wrap = document.getElementById(`code-${otherSide}`);
	if (!wrap) return;
	const partnerPairClass =
		otherSide === "student"
			? "leo-highlight-pair-missing"
			: "leo-highlight-pair-extra";
	const sel =
		`.leo-mark[data-leo-side="${otherSide}"]` +
		`[data-leo-pos="${partnerPos}"]:not([data-leo-ghost-offset])`;
	for (const el of wrap.querySelectorAll(sel)) {
		if (partnerToken && el.getAttribute("data-leo-token") !== partnerToken)
			continue;
		el.classList.add("leo-highlight-active", partnerPairClass);
		_leoHighlighted.push(el);
	}
}

function _applyInsertAnchorHighlight(target) {
	const otherSide = target.getAttribute("data-insert-side");
	const teacherPos = target.getAttribute("data-leo-pos");
	if (!otherSide || teacherPos == null) return;
	const wrap = document.getElementById(`code-${otherSide}`);
	if (!wrap) return;
	const sel = `.insert-anchor[data-insert-anchor-teacher-pos="${teacherPos}"]`;
	for (const el of wrap.querySelectorAll(sel)) {
		el.classList.add("insert-active");
		_insertHighlighted.push(el);
	}
}

function _addMarkPairHighlight(target) {
	if (!target) return;
	target.classList.add("leo-highlight-active");
	if (target.hasAttribute("data-swap-pos")) {
		const partnerSide = target.getAttribute("data-swap-side");
		target.classList.add(
			partnerSide === "student"
				? "leo-highlight-pair-extra"
				: "leo-highlight-pair-missing",
		);
	}
	_leoHighlighted.push(target);
	if (target.hasAttribute("data-swap-pos")) {
		_applySwapPartnerHighlight(target);
	}
	if (target.hasAttribute("data-insert-pos")) {
		_applyInsertAnchorHighlight(target);
	}
}

function _applyMarkPairHighlight(target) {
	_clearLeoHighlights();
	_addMarkPairHighlight(target);
}

function _applyLeoHighlights(target, data, side, pos, ghostOffset) {
	target.classList.add("leo-highlight-active");
	if (target.hasAttribute("data-swap-pos")) {
		const partnerSide = target.getAttribute("data-swap-side");
		target.classList.add(
			partnerSide === "student"
				? "leo-highlight-pair-extra"
				: "leo-highlight-pair-missing",
		);
	}
	_leoHighlighted.push(target);
	if (target.hasAttribute("data-swap-pos")) {
		_applySwapPartnerHighlight(target);
	}
	if (target.hasAttribute("data-insert-pos")) {
		_applyInsertAnchorHighlight(target);
	}
	const list = side === "teacher" ? data.teacher : data.student;
	const idx = _findInstIdx(list, pos, ghostOffset);
	const inst = idx >= 0 ? list[idx] : null;
	if (!inst || !Number.isInteger(inst.match_idx)) return;
	const otherSide = side === "teacher" ? "student" : "teacher";
	const otherList = otherSide === "teacher" ? data.teacher : data.student;
	const matched = otherList && otherList[inst.match_idx];
	if (!matched) return;
	const token = target.getAttribute("data-leo-token");
	const wrap = document.getElementById(`code-${otherSide}`);
	if (!wrap) return;
	let sel;
	if (matched.ghost) {
		sel =
			`.leo-mark[data-leo-side="${otherSide}"]` +
			`[data-leo-pos="${matched.pos}"]` +
			`[data-leo-ghost-offset="${matched.blob_offset}"]`;
	} else {
		sel =
			`.leo-mark[data-leo-side="${otherSide}"]` +
			`[data-leo-pos="${matched.pos}"]:not([data-leo-ghost-offset])`;
	}
	for (const el of wrap.querySelectorAll(sel)) {
		if (el.getAttribute("data-leo-token") !== token) continue;
		el.classList.add("leo-highlight-active");
		_leoHighlighted.push(el);
	}
}

document.addEventListener("mousedown", (ev) => {
	if (ev.button !== 0) return;
	if (ev.target.closest && ev.target.closest(".code-aligned[contenteditable]"))
		return;
	const mark = ev.target.closest && ev.target.closest(".leo-mark");
	if (mark) {
		ev.preventDefault();
		_showLeoTooltip(mark);
		return;
	}
	const anchor = ev.target.closest && ev.target.closest(".insert-anchor");
	if (anchor) {
		ev.preventDefault();
		_showInsertAnchorOrigin(anchor);
		return;
	}
	if (_leoTip && _leoTip.style.display === "flex") {
		if (ev.target.closest && ev.target.closest("#leo-tooltip")) return;
		_hideLeoTooltip();
	}
});

function _showInsertAnchorOrigin(anchor) {
	const tPos = anchor.getAttribute("data-insert-anchor-teacher-pos");
	if (tPos == null) return;
	const wrap = document.getElementById("code-teacher");
	if (!wrap) return;
	const sel =
		`.leo-mark[data-leo-side="teacher"]` +
		`[data-leo-pos="${tPos}"]` +
		`[data-insert-pos]:not([data-leo-ghost-offset])`;
	const markEl = wrap.querySelector(sel);
	if (markEl) {
		_showLeoTooltip(markEl);
	} else {
		_clearLeoHighlights();
		anchor.classList.add("insert-active");
		_insertHighlighted.push(anchor);
	}
}

function _applyDiffModeLabel() {}

function _saveState(side) {
	const tabs = document.getElementById(`tabs-${side}`);
	const btns = tabs ? [...tabs.querySelectorAll(".file-tab")] : [];
	const activeIdx = btns.findIndex((b) =>
		b.classList.contains("file-tab-active"),
	);
	const tabName = activeIdx >= 0 ? btns[activeIdx].textContent : null;
	const scroll = document.getElementById("diff-scroll");
	return {
		tabName,
		scrollTop: scroll ? scroll.scrollTop : 0,
		scrollLeft: scroll ? scroll.scrollLeft : 0,
	};
}

function _restoreState(side, saved) {
	if (!saved || !saved.tabName) return;
	const tabs = document.getElementById(`tabs-${side}`);
	if (!tabs) return;
	const btns = [...tabs.querySelectorAll(".file-tab")];
	const wrap = document.getElementById(`code-${side}`);
	const panes = wrap ? [...wrap.querySelectorAll(".code-pane")] : [];
	const matchIdx = btns.findIndex((b) => b.textContent === saved.tabName);
	if (matchIdx > 0) {
		btns.forEach((b) => b.classList.remove("file-tab-active"));
		panes.forEach((p) => p.classList.remove("active"));
		btns[matchIdx].classList.add("file-tab-active");
		if (panes[matchIdx]) panes[matchIdx].classList.add("active");
	}
	const scroll = document.getElementById("diff-scroll");
	if (scroll) {
		scroll.scrollTop = saved.scrollTop;
		scroll.scrollLeft = saved.scrollLeft;
	}
}

function _updateTitleScore() {
	if (!_titleBase) return;
	const score = _currentMarksEntry?.score;
	const suffix = score != null ? ` (${Number(score).toFixed(1)}%)` : "";
	const newTitle = _titleBase + suffix;
	const el = document.getElementById("title-student");
	if (el) el.textContent = newTitle;
	document.title = newTitle;
}

function _refreshLinePaddingButton() {
	const btn = document.getElementById("btn-line-padding");
	if (!btn) return;
	if (_linePaddingEnabled) {
		btn.classList.add("active");
		btn.textContent = "⇲ Padding";
	} else {
		btn.classList.remove("active");
		btn.textContent = "⇱ Padding";
	}
}

function toggleLinePadding() {
	_linePaddingEnabled = !_linePaddingEnabled;
	try {
		localStorage.setItem(
			"diff-line-padding",
			_linePaddingEnabled ? "on" : "off",
		);
	} catch {}
	_refreshLinePaddingButton();
	if (_teacherFiles && Object.keys(_teacherFiles).length) {
		const savedT = _saveState("teacher");
		const savedS = _saveState("student");
		renderPanel("teacher", _teacherFiles, _teacherMarks);
		renderPanel("student", _studentFiles, _studentMarks);
		_restoreState("teacher", savedT);
		_restoreState("student", savedS);
	}
}

function togglePreview() {
	const btn = document.getElementById("btn-preview");
	const isPreview = btn && btn.classList.contains("active");

	for (const side of ["teacher", "student"]) {
		const codeWrap = document.getElementById(`code-${side}`);
		const tabs = document.getElementById(`tabs-${side}`);
		const iframe = document.getElementById(`preview-${side}`);
		const content = document.getElementById(`content-${side}`);
		if (!codeWrap || content.style.display === "none") continue;

		if (isPreview) {
			if (iframe) iframe.style.display = "none";
			codeWrap.style.display = "";
		} else {
			const files = side === "teacher" ? _teacherFiles : _studentFiles;
			if (!files || !Object.keys(files).length) continue;
			if (iframe) {
				updatePreview(side, files, iframe);
				iframe.style.display = "block";
			}
			codeWrap.style.display = "none";
		}
	}

	if (btn) {
		if (isPreview) {
			btn.textContent = "\u2b1c Preview";
			btn.classList.remove("active");
		} else {
			btn.textContent = "\ud83d\udcc4 Code";
			btn.classList.add("active");
		}
	}
	localStorage.setItem("diff-preview-mode", isPreview ? "code" : "preview");
}

function updatePreview(side, files, iframe) {
	const htmlEntry = Object.entries(files).find(([name]) =>
		/\.html$/i.test(name),
	);
	if (!htmlEntry) {
		iframe.srcdoc =
			"<p style='font-family:sans-serif;padding:20px;color:#888'>No HTML file found.</p>";
		return;
	}
	const html = htmlEntry[1];
	const filesMap = { ..._imageUris };
	for (const [name, content] of Object.entries(files)) {
		if (!/\.html$/i.test(name)) filesMap[name] = content;
	}
	iframe.srcdoc = inlineFilesInHtml(html, filesMap) || "";
}
