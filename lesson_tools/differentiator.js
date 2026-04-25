"use strict";

const DIFF_LABEL_COLORS = {
	missing: "#e00",
	comment: "#4a4",
	extra: "#00c",
	extra_star: "#a000c0",
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

function _renderAligned(text, alignment, fileMarks, sideIdx, lineFileMarks) {
	const normText = text.replace(/\r\n/g, "\n");
	const lines = normText.split("\n");
	const lineStarts = _lineStartOffsets(normText);
	const sortedMarks = (fileMarks || [])
		.slice()
		.sort((a, b) => a.start - b.start);

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
					: normText.length;
			const lineText = lines[lineIdx] ?? "";
			const lineMarks = sortedMarks
				.filter((m) => m.start >= lineStart && m.start < lineEnd)
				.map((m) => ({
					...m,
					start: m.start - lineStart,
					end: Math.min(m.end, lineEnd) - lineStart,
				}));
			const bgMark =
				lineFileMarks &&
				lineFileMarks.find(
					(lm) => lm.start >= lineStart && lm.start < lineEnd,
				);
			const bg = bgMark ? DIFF_LINE_BG_COLORS[bgMark.label] || null : null;
			const style = bg ? ` style="background-color:${bg}"` : "";
			parts.push(
				`<div class="diff-line"${style}>${diffColorizePositions(lineText, lineMarks)}</div>`,
			);
		}
	}
	return parts.join("");
}

function _renderFlat(text, fileMarks, lineFileMarks) {
	const normText = text.replace(/\r\n/g, "\n");
	const lines = normText.split("\n");
	const lineStarts = _lineStartOffsets(normText);
	const sortedMarks = (fileMarks || [])
		.slice()
		.sort((a, b) => a.start - b.start);

	const parts = [];
	for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
		const lineStart = lineStarts[lineIdx] ?? normText.length;
		const lineEnd =
			lineIdx + 1 < lineStarts.length
				? lineStarts[lineIdx + 1]
				: normText.length;
		const lineText = lines[lineIdx] ?? "";
		const lineMarks = sortedMarks
			.filter((m) => m.start >= lineStart && m.start < lineEnd)
			.map((m) => ({
				...m,
				start: m.start - lineStart,
				end: Math.min(m.end, lineEnd) - lineStart,
			}));
		const bgMark =
			lineFileMarks &&
			lineFileMarks.find(
				(lm) => lm.start >= lineStart && lm.start < lineEnd,
			);
		const bg = bgMark ? DIFF_LINE_BG_COLORS[bgMark.label] || null : null;
		const style = bg ? ` style="background-color:${bg}"` : "";
		parts.push(
			`<div class="diff-line"${style}>${diffColorizePositions(lineText, lineMarks)}</div>`,
		);
	}
	return parts.join("");
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
					? _renderFlat(sourceText, fileMarks, lineFileMarks)
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
			pane.innerHTML = `<div class="code-aligned">${_renderAligned(sourceText, alignment, fileMarks, sideIdx, lineFileMarks)}</div>`;
		} else if (hasMarks) {
			pane.innerHTML = `<div class="code-aligned">${_renderFlat(sourceText, fileMarks, lineFileMarks)}</div>`;
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

function diffColorizePositions(text, posMarks) {
	if (!posMarks || !posMarks.length) return escHtml(text);
	const colored = posMarks.filter(
		(m) => m.label && DIFF_LABEL_COLORS[m.label],
	);
	if (!colored.length) return escHtml(text);

	const normText = text.replace(/\r\n/g, "\n");

	colored.sort((a, b) => a.start - b.start || b.end - a.end);
	const kept = [];
	let lastEnd = 0;
	for (const m of colored) {
		if (m.start >= lastEnd) {
			kept.push(m);
			lastEnd = m.end;
		}
	}

	let out = "",
		pos = 0;
	for (const m of kept) {
		out += escHtml(normText.slice(pos, m.start));
		const color = DIFF_LABEL_COLORS[m.label];
		out += `<span style="color:${color};font-weight:bold">${escHtml(normText.slice(m.start, m.end))}</span>`;
		pos = m.end;
	}
	out += escHtml(normText.slice(pos));
	return out;
}

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
