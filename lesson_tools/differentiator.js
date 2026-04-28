"use strict";

const DIFF_LABEL_COLORS = {
	missing: "#e00",
	comment: "#4a4",
	extra: "#00c",
	extra_star: "#3aa0e0",
	extra_comment: "#080",
};

const DIFF_LINE_BG_COLORS = {
	missing: "rgba(220,0,0,0.13)",
	extra: "rgba(0,0,200,0.10)",
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
let _studentEditMode = false;
let _editedStudentFiles = {};
let _studentModified = new Set();

function _resolveMarksEntry() {
	const modeKey = _diffMode ?? "";
	return _allMarks[modeKey] ?? Object.values(_allMarks)[0] ?? null;
}

function _applyCurrentMarks() {
	_currentMarksEntry = _resolveMarksEntry();
	_teacherMarks = _currentMarksEntry?.teacher_files ?? null;
	_studentMarks = _currentMarksEntry?.student_files ?? null;
}

window.addEventListener("DOMContentLoaded", () => {
	const params = new URLSearchParams(location.search);
	const key = params.get("key") || "diffData";
	const modeParam = params.get("mode") || null;
	_diffMode = modeParam;
	_applyDiffModeLabel();

	const modeSelect = document.getElementById("mode-select");
	if (modeSelect) {
		if (_diffMode) modeSelect.value = _diffMode;
		modeSelect.addEventListener("change", () => {
			_diffMode = modeSelect.value || null;
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
		});
	}

	const raw = localStorage.getItem(key);
	if (raw) {
		localStorage.removeItem(key);
		try {
			const data = JSON.parse(raw);
			_teacherFiles = data.teacherFiles || {};
			_studentFiles = data.studentFiles || {};
			_imageUris = data.imageUris || {};
			if (data.allMarks) {
				_allMarks = data.allMarks;
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
				titleText.replace(/\s*\([^)]*%\)\s*$/, "").trim() || titleText;
			document.getElementById("title-student").textContent = titleText;
			renderPanel("teacher", _teacherFiles, _teacherMarks);
			renderPanel("student", _studentFiles, _studentMarks);
			_updateTitleScore();
		} catch (e) {
			console.error("[Differentiator] Failed to parse diff data", e);
		}
	}

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

	const MODE_SUFFIX = {
		"": "_leo_star",
		leo: "_leo",
		"token-lcs": "_lcs",
		"token-lcs-star": "_lcs_star",
		"token-lev": "_lev",
		"token-lev-star": "_lev_star",
		"line-ro": "_ro",
		"line-ro-star": "_ro_star",
		"line-git": "_git",
		"line-git-star": "_git_star",
	};

	for (const file of files) {
		const reader = new FileReader();
		reader.onload = (e) => {
			const fname = file.name.toLowerCase();
			const modeEntry = Object.entries(MODE_SUFFIX).find(
				([, sfx]) => fname === `diff_marks${sfx}.json`,
			);
			if (modeEntry) {
				try {
					const parsed = JSON.parse(e.target.result);
					if (!_allMarks[modeEntry[0]]) _allMarks[modeEntry[0]] = {};
					Object.assign(_allMarks[modeEntry[0]], parsed);
				} catch {}
			} else {
				texts[file.name] = e.target.result;
			}
			pending--;
			if (pending === 0) {
				_applyCurrentMarks();
				if (side === "teacher") _teacherFiles = texts;
				else _studentFiles = texts;
				renderPanel(
					side,
					side === "teacher" ? _teacherFiles : _studentFiles,
					side === "teacher" ? _teacherMarks : _studentMarks,
				);
				_updateTitleScore();
			}
		};
		reader.readAsText(file);
	}
}

let _syncingScroll = false;

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

	const parts = [];
	for (const pair of alignment) {
		const lineIdx = pair[sideIdx];
		if (lineIdx === null) {
			parts.push('<div class="diff-spacer">​</div>');
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
				.map((g) => ({ ...g, pos: g.pos - lineStart }));
			const bgMark =
				lineFileMarks &&
				lineFileMarks.find(
					(lm) => lm.start >= lineStart && lm.start < lineEnd,
				);
			const bg = bgMark ? DIFF_LINE_BG_COLORS[bgMark.label] || null : null;
			const style = bg ? ` style="background-color:${bg}"` : "";
			parts.push(
				`<div class="diff-line"${style}>${diffColorizePositions(lineText, lineMarks, side, lineGhosts)}</div>`,
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
			.map((g) => ({ ...g, pos: g.pos - lineStart }));
		const bgMark =
			lineFileMarks &&
			lineFileMarks.find(
				(lm) => lm.start >= lineStart && lm.start < lineEnd,
			);
		const bg = bgMark ? DIFF_LINE_BG_COLORS[bgMark.label] || null : null;
		const style = bg ? ` style="background-color:${bg}"` : "";
		parts.push(
			`<div class="diff-line"${style}>${diffColorizePositions(lineText, lineMarks, side, lineGhosts)}</div>`,
		);
	}
	return parts.join("");
}

function _getFileGhosts(fileName) {
	const map = _currentMarksEntry?.teacher_ghosts;
	return (map && map[fileName]) || [];
}

function _setupScrollSync() {
	for (const side of ["teacher", "student"]) {
		const wrap = document.getElementById(`code-${side}`);
		if (!wrap) continue;
		wrap.querySelectorAll(".code-pane").forEach((pane, i) => {
			pane.addEventListener("scroll", () => {
				if (_syncingScroll) return;
				const otherSide = side === "teacher" ? "student" : "teacher";
				const otherWrap = document.getElementById(`code-${otherSide}`);
				if (!otherWrap) return;
				const otherPanes = otherWrap.querySelectorAll(".code-pane");
				if (otherPanes[i]) {
					_syncingScroll = true;
					otherPanes[i].scrollTop = pane.scrollTop;
					_syncingScroll = false;
				}
			});
		});
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
	const allAlignments = modeData?.alignments ?? null;
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

		const text = files[name] || "";

		const fileMarks = marks ? (marks[name] ?? null) : null;
		const lineFileMarks = sideLineMks ? (sideLineMks[name] ?? null) : null;
		const alignment = allAlignments ? (allAlignments[name] ?? null) : null;
		const isStudentEdit = side === "student" && _studentEditMode;
		const isEdited = side === "student" && _studentModified.has(name);

		if (isStudentEdit && _editedStudentFiles[name] === undefined) {
			_editedStudentFiles[name] = text;
		}
		const sourceText =
			isStudentEdit || isEdited ? (_editedStudentFiles[name] ?? text) : text;
		const hasMarks = Array.isArray(fileMarks) || lineFileMarks;

		if (isStudentEdit) {
			pane.innerHTML = `<div class="code-aligned" contenteditable="plaintext-only" spellcheck="false">${
				hasMarks
					? _renderFlat(sourceText, fileMarks, lineFileMarks, side, name)
					: escHtml(sourceText)
			}</div>`;
			const editable = pane.querySelector("[contenteditable]");
			editable.addEventListener("input", () => {
				_editedStudentFiles[name] = _readEditableText(editable);
				_studentModified.add(name);
				_refreshPreviewIfActive();
			});
		} else if (isEdited) {
			pane.innerHTML = `<pre>${escHtml(sourceText)}</pre>`;
		} else if (alignment) {
			pane.innerHTML = `<div class="code-aligned">${_renderAligned(sourceText, alignment, fileMarks, sideIdx, lineFileMarks, name)}</div>`;
		} else if (hasMarks) {
			pane.innerHTML = `<div class="code-aligned">${_renderFlat(sourceText, fileMarks, lineFileMarks, side, name)}</div>`;
		} else {
			pane.innerHTML = `<pre>${escHtml(sourceText)}</pre>`;
		}
		codeWrap.appendChild(pane);
	});

	_setupScrollSync();

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

function escHtml(s) {
	return String(s)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function escAttr(s) {
	return escHtml(s).replace(/"/g, "&quot;");
}

function _synthesizeLeoMarks(side, fileName) {
	const tokens = _currentMarksEntry?.leo_assignments?.tokens;
	if (!tokens || !fileName) return [];
	const out = [];
	for (const [tok, data] of Object.entries(tokens)) {
		const list = side === "teacher" ? data.teacher : data.student;
		for (const inst of list) {
			if (inst.file === fileName) {
				out.push({
					token: tok,
					label: inst.label || null,
					start: inst.pos,
					end: inst.pos + tok.length,
					_synth: true,
				});
			}
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

function diffColorizePositions(text, posMarks, side, ghosts) {
	const ghostList = ghosts || [];
	if ((!posMarks || !posMarks.length) && !ghostList.length)
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
	if (!wrappable.length && !ghostList.length) return escHtml(text);

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
	const ord = { close: 0, ghost: 1, open: 2 };
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
			const leoAttrs =
				tokensTbl && side && m.token && tokensTbl[m.token]
					? ` class="leo-mark" data-leo-token="${escAttr(m.token)}" data-leo-side="${side}" data-leo-pos="${absPos}"`
					: "";
			out += `<span${leoAttrs}${styleAttr}>`;
		} else if (ev.kind === "close") {
			out += "</span>";
		} else {
			out += _renderGhostBlob(ev.ghost, tokensTbl);
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
	const blobPos = ghost.pos;
	let out = '<span class="diff-ghost">';
	let lastEnd = 0;
	_GHOST_TOKEN_RE.lastIndex = 0;
	let m;
	while ((m = _GHOST_TOKEN_RE.exec(text)) !== null) {
		if (m.index > lastEnd) out += escHtml(text.slice(lastEnd, m.index));
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
	if (lastEnd < text.length) out += escHtml(text.slice(lastEnd));
	out += "</span>";
	return out;
}

function _labelColor(label) {
	if (label === "missing") return "#e00";
	if (label === "extra") return "#00c";
	if (label === "extra_star") return "#3aa0e0";
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

function _instContextVector(inst, sideName) {
	const la = _currentMarksEntry?.leo_assignments;
	if (!la) return null;
	const k = la.k ?? 18;
	const decay = typeof la.decay === "number" ? la.decay : 0.85;
	const boost =
		typeof la.neighbor_boost === "number" ? la.neighbor_boost : 3.0;
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
	return _buildContextVector(seq, idx, k, decay, boost);
}

function _buildContextVector(seq, idx, k, decay, neighborBoost) {
	const vec = new Map();
	const lo = Math.max(0, idx - k);
	const hi = Math.min(seq.length, idx + k + 1);
	for (let i = lo; i < hi; i++) {
		if (i === idx) continue;
		const tok = seq[i];
		const w = Math.pow(decay, Math.abs(i - idx));
		vec.set(tok, (vec.get(tok) || 0) + w);
	}
	if (idx > 0) {
		const key = `\x00L1\x00${seq[idx - 1]}`;
		vec.set(key, (vec.get(key) || 0) + neighborBoost);
	}
	if (idx + 1 < seq.length) {
		const key = `\x00R1\x00${seq[idx + 1]}`;
		vec.set(key, (vec.get(key) || 0) + neighborBoost);
	}
	return vec;
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

	const clickedCtx = thisInst ? _instContextVector(thisInst, side) : null;

	const labelClass = (inst) =>
		inst.ghost
			? "leo-row-ghost"
			: inst.label === "missing"
				? "leo-row-missing"
				: inst.label === "extra"
					? "leo-row-extra"
					: inst.label === "extra_star"
						? "leo-row-extra-star"
						: "";

	const renderRow = (inst, sideName, highlight, score) => {
		const ctx = _ctxSlice(inst, sideName);
		const before = ctx ? ctx.before.map(_fmtCtxToken).join(" ") : "";
		const after = ctx ? ctx.after.map(_fmtCtxToken).join(" ") : "";
		const lblColor = inst.ghost ? "#888" : _labelColor(inst.label);
		const cls =
			`leo-row ${labelClass(inst)}${highlight ? " leo-this" : ""}`.trim();
		const scoreCell =
			score == null
				? '<span class="leo-score">—</span>'
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

	const sepRow = '<div class="leo-row leo-sep">⋯</div>';
	const renderSection = (list, sideName, anchorOrigIdxs) => {
		// Compute per-row score (cosine vs clicked-token context).
		const scored = list.map((inst, i) => ({
			inst,
			origIdx: i,
			score: clickedCtx
				? _cosineSim(clickedCtx, _instContextVector(inst, sideName))
				: null,
		}));
		// Sort the OTHER side by score desc; keep the clicked side in source order.
		const sortByScore = sideName !== side && clickedCtx;
		const order = sortByScore
			? scored
					.slice()
					.sort(
						(a, b) =>
							(b.score ?? -1) - (a.score ?? -1) || a.origIdx - b.origIdx,
					)
			: scored;
		// Translate anchor original-indices to positions in the (possibly sorted) order.
		const anchorPositions = anchorOrigIdxs
			.filter((i) => i != null && i >= 0)
			.map((i) => order.findIndex((s) => s.origIdx === i))
			.filter((p) => p >= 0);
		const visible = _selectVisibleRows(order.length, anchorPositions);
		const out = [];
		let prev = -1;
		for (const p of visible) {
			if (prev >= 0 && p > prev + 1) out.push(sepRow);
			const { inst, origIdx, score } = order[p];
			const isThis = sideName === side && origIdx === thisIdx;
			const isMatched = sideName !== side && origIdx === matchedOtherIdx;
			out.push(renderRow(inst, sideName, isThis || isMatched, score));
			prev = p;
		}
		return out.join("");
	};

	const nTeacherSurv = teachers.filter((t) => !t.ghost).length;
	const nTeacherGhost = teachers.length - nTeacherSurv;
	const ghostNote = nTeacherGhost ? ` (+${nTeacherGhost} ghost)` : "";
	let html = `<div class="leo-title">${tEsc} <span class="leo-sub">— ${nTeacherSurv} teacher${ghostNote} / ${students.length} student instances</span></div>`;
	if (teachers.length) {
		const anchors = side === "teacher" ? [thisIdx] : [matchedOtherIdx];
		html += '<div class="leo-section-title">Teacher</div>';
		html += renderSection(teachers, "teacher", anchors);
	}
	if (students.length) {
		const anchors = side === "student" ? [thisIdx] : [matchedOtherIdx];
		html += '<div class="leo-section-title">Student</div>';
		html += renderSection(students, "student", anchors);
	}
	return html;
}

function _selectVisibleRows(n, anchors) {
	if (n <= 10) return Array.from({ length: n }, (_, i) => i);
	const set = new Set();
	for (let i = 0; i < 5; i++) set.add(i);
	for (let i = n - 5; i < n; i++) set.add(i);
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
function _ensureLeoTooltip() {
	if (_leoTip) return _leoTip;
	_leoTip = document.createElement("div");
	_leoTip.id = "leo-tooltip";
	document.body.appendChild(_leoTip);
	return _leoTip;
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
	if (!data) return;
	_clearLeoHighlights();
	_applyLeoHighlights(target, data, side, pos, ghostOffset);
	const tip = _ensureLeoTooltip();
	tip.innerHTML = _renderLeoTooltip(token, data, side, pos, ghostOffset);
	tip.style.display = "block";
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
function _clearLeoHighlights() {
	for (const el of _leoHighlighted)
		el.classList.remove("leo-highlight-active");
	_leoHighlighted = [];
}

function _applyLeoHighlights(target, data, side, pos, ghostOffset) {
	target.classList.add("leo-highlight-active");
	_leoHighlighted.push(target);
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
	const mark = ev.target.closest && ev.target.closest(".leo-mark");
	if (mark) {
		ev.preventDefault();
		_showLeoTooltip(mark);
		return;
	}
	if (_leoTip && _leoTip.style.display === "block") {
		if (ev.target.closest && ev.target.closest("#leo-tooltip")) return;
		_hideLeoTooltip();
	}
});

function _applyDiffModeLabel() {}

function _saveState(side) {
	const tabs = document.getElementById(`tabs-${side}`);
	const btns = tabs ? [...tabs.querySelectorAll(".file-tab")] : [];
	const activeIdx = btns.findIndex((b) =>
		b.classList.contains("file-tab-active"),
	);
	const tabName = activeIdx >= 0 ? btns[activeIdx].textContent : null;
	const wrap = document.getElementById(`code-${side}`);
	const panes = wrap ? [...wrap.querySelectorAll(".code-pane")] : [];
	const pane = panes[activeIdx >= 0 ? activeIdx : 0] || null;
	return {
		tabName,
		scrollTop: pane ? pane.scrollTop : 0,
		scrollLeft: pane ? pane.scrollLeft : 0,
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
	const activeIdx = matchIdx >= 0 ? matchIdx : 0;
	const pane = panes[activeIdx];
	if (pane) {
		pane.scrollTop = saved.scrollTop;
		pane.scrollLeft = saved.scrollLeft;
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

function toggleEditMode() {
	_studentEditMode = !_studentEditMode;
	const btn = document.getElementById("btn-edit");
	if (btn) {
		btn.classList.toggle("active", _studentEditMode);
		btn.textContent = _studentEditMode ? "✏️ Editing" : "✏️ Edit";
	}
	if (_studentFiles) {
		const saved = _saveState("student");
		renderPanel("student", _studentFiles, _studentMarks);
		_restoreState("student", saved);
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
			const baseFiles = side === "teacher" ? _teacherFiles : _studentFiles;
			const files =
				side === "student" && _studentModified.size
					? { ...baseFiles, ..._editedStudentFiles }
					: baseFiles;
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

function _readEditableText(el) {
	return el.innerText.replace(/\r\n/g, "\n");
}

function _refreshPreviewIfActive() {
	if (localStorage.getItem("diff-preview-mode") !== "preview") return;
	for (const side of ["teacher", "student"]) {
		const iframe = document.getElementById(`preview-${side}`);
		if (!iframe || iframe.style.display === "none") continue;
		const baseFiles = side === "teacher" ? _teacherFiles : _studentFiles;
		const files =
			side === "student" && _studentModified.size
				? { ...baseFiles, ..._editedStudentFiles }
				: baseFiles;
		if (files && Object.keys(files).length)
			updatePreview(side, files, iframe);
	}
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
