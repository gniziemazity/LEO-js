"use strict";

let _viewersInit = false;
let _asgnView = "preview";
let _selectedStudent = null;
let _bottomView = "diff";
let _codeFV = null;
let _pendingCodeDoc = null;

let _sideDividerWired = false;
let _panesDividerWired = false;

function _vEl(id) {
	return document.getElementById(id);
}

function _vPersist(key, val) {
	lsSet(key, val);
}

function _vRestore(key, def) {
	return lsGet(key, def);
}

function _msgEditorHtml(text) {
	const esc = typeof escHtml === "function" ? escHtml(text) : text;
	return `<span style="color:var(--clr-muted)">${esc}</span>`;
}

function _msgDocSrcdoc(text) {
	const esc = typeof escHtml === "function" ? escHtml(text) : text;
	return `<!DOCTYPE html><html><body style="margin:16px;font-family:sans-serif;color:#888">${esc}</body></html>`;
}

function _setView(bodyId, mode) {
	const body = _vEl(bodyId);
	if (body) body.dataset.view = mode === "code" ? "code" : "preview";
}

function _findInstructionsFile() {
	for (const [key, f] of _allFiles) {
		if (/(?:^|\/)instructions\.html?$/i.test(key)) return f;
	}
	return null;
}

function _groupFolder() {
	if (_lessonGroup) return _lessonGroup;
	return _mode === "lesson" ? "lessons" : "assignments";
}

function _instructionsServerUrl() {
	return `/${_groupFolder()}/${encodeURIComponent(_lessonName)}/instructions.html`;
}

function _gradesDataLessonBase() {
	return new URL(
		`/grades-data/${_groupFolder()}/${encodeURIComponent(_lessonName)}/`,
		location.href,
	).href;
}

function _fetchInstructionsText() {
	return fetch(_instructionsServerUrl()).then((r) => {
		if (!r.ok) throw new Error("HTTP " + r.status);
		return r.text();
	});
}

async function _instructionsSrcdoc(file) {
	let html;
	let base = "";
	if (file) {
		html = await readFileText(file);
		base = file.url ? new URL(".", file.url).href : _gradesDataLessonBase();
	} else {
		const url = _instructionsServerUrl();
		const r = await fetch(url);
		if (!r.ok) throw new Error("HTTP " + r.status);
		html = await r.text();
		base = new URL(".", new URL(url, location.href).href).href;
	}
	const baseTag = base ? `<base href="${base}">` : "";
	return (
		`<!DOCTYPE html><html><head><meta charset="utf-8">${baseTag}` +
		"<style>body{margin:14px 18px;font-family:sans-serif;font-size:14px;" +
		"line-height:1.6;color:#222;background:#eef8ef}img{max-width:100%;height:auto}</style>" +
		`</head><body>${html}</body></html>`
	);
}

async function _downloadPlan() {
	const fname = "lesson_plan.zip";
	let blob = null;
	if (_allFiles && _allFiles.size) {
		for (const [rel, f] of _allFiles) {
			const lc = rel.toLowerCase();
			if (lc === fname || lc.endsWith("/" + fname)) {
				blob = new Blob([await readFileArray(f)]);
				break;
			}
		}
	}
	if (!blob) {
		try {
			const resp = await fetch(
				`/${_groupFolder()}/${encodeURIComponent(_lessonName)}/${fname}`,
			);
			if (resp.ok) blob = await resp.blob();
		} catch {}
	}
	if (!blob) {
		alert("No lesson_plan.zip found for this lesson.");
		return;
	}
	downloadBlob(blob, fname);
}

async function _renderAssignment() {
	const editor = _vEl("asgn-editor");
	const preview = _vEl("asgn-preview");
	if (!editor || !preview) return;
	const labelEl = document.querySelector("#asgn-pane .sp-label");
	if (labelEl) {
		const dispName = _lessonName
			? _lessonName.charAt(0).toUpperCase() + _lessonName.slice(1)
			: "";
		labelEl.textContent = (
			_mode === "lesson"
				? `${dispName} Lesson (Moodle)`
				: `${dispName} Assignment (Moodle)`
		).trim();
	}
	const tlBtn = _vEl("asgn-timeline");
	if (tlBtn) tlBtn.hidden = _mode !== "lesson";
	const simBtn = _vEl("asgn-simulator");
	if (simBtn) simBtn.hidden = _mode !== "lesson";
	const dlBtn = _vEl("asgn-download-plan");
	if (dlBtn) dlBtn.hidden = _mode !== "lesson";
	const file = _findInstructionsFile();
	try {
		const text = file
			? await readFileText(file)
			: await _fetchInstructionsText();
		try {
			await window.LanguageProfiles?.initProfiles();
		} catch (_e) {}
		editor.innerHTML = fvRenderStaticEditor(
			text,
			"html",
			"instructions.html",
		);
	} catch {
		editor.innerHTML = _msgEditorHtml("No instructions found.");
	}
	try {
		preview.removeAttribute("src");
		preview.srcdoc = previewBaseTarget(await _instructionsSrcdoc(file));
	} catch {
		preview.removeAttribute("src");
		preview.srcdoc = _msgDocSrcdoc("No instructions found.");
	}
}

function _reloadStudentDiff(frame, student) {
	const previewParam =
		new URLSearchParams(location.search).get("preview") === "1"
			? "&preview=1"
			: "";
	frame.src =
		buildToolUrl("differentiator.html", {
			lesson: _lessonName,
			group: _groupFolder(),
			id: student.id,
			title: _diffTitleFor(student),
			mode: basisToDiffMode(_activeBasis),
		}) +
		"&embed=1" +
		previewParam;
}

function _loadStudentDiff(student) {
	const frame = _vEl("student-diff-frame");
	const empty = _vEl("student-empty");
	if (!frame) return;
	if (!student || !student.id || !_lessonName) {
		if (empty) empty.style.display = "flex";
		return;
	}
	if (empty) empty.style.display = "none";
	if (frame.dataset.diffId === String(student.id)) return;
	frame.dataset.diffId = String(student.id);
	const targetId = String(student.id);

	let navFn = null;
	try {
		const win = frame.contentWindow;
		if (win && typeof win.diffNavToStudentId === "function") {
			navFn = win.diffNavToStudentId;
		}
	} catch (_e) {
		navFn = null;
	}
	if (!navFn) {
		_reloadStudentDiff(frame, student);
		return;
	}
	Promise.resolve(navFn(student.id, _diffTitleFor(student)))
		.then((ok) => {
			if (!ok && frame.dataset.diffId === targetId) {
				_reloadStudentDiff(frame, student);
			}
		})
		.catch(() => {
			if (frame.dataset.diffId === targetId) {
				_reloadStudentDiff(frame, student);
			}
		});
}

function _syncAsgnButtons() {
	const p = _vEl("asgn-view-preview");
	const c = _vEl("asgn-view-code");
	if (p) p.classList.toggle("active", _asgnView === "preview");
	if (c) c.classList.toggle("active", _asgnView === "code");
}

function _setAsgnView(mode) {
	_asgnView = mode === "code" ? "code" : "preview";
	_vPersist("students.asgnView", _asgnView);
	_setView("asgn-body", _asgnView);
	_syncAsgnButtons();
}

function _setAsgnCollapsed(collapsed) {
	const col = _vEl("side-col");
	if (col) col.classList.toggle("asgn-collapsed", collapsed);
	const btn = _vEl("asgn-collapse");
	if (btn) {
		btn.textContent = collapsed ? "▸" : "▾";
		btn.title = collapsed ? "Expand assignment" : "Collapse assignment";
	}
	_vPersist("students.asgnCollapsed", collapsed ? "1" : "0");
}

function _ensureViewers() {
	if (_viewersInit) return;
	_viewersInit = true;

	_asgnView =
		_vRestore("students.asgnView", "preview") === "code" ? "code" : "preview";

	_vEl("asgn-view-preview").addEventListener("click", () =>
		_setAsgnView("preview"),
	);
	_vEl("asgn-view-code").addEventListener("click", () => _setAsgnView("code"));
	_vEl("asgn-timeline").addEventListener("click", () =>
		navigateToTimeline({
			lesson: _lessonName,
			group: _groupFolder(),
			basis: _activeBasis,
		}),
	);
	_vEl("asgn-simulator").addEventListener("click", () =>
		navigateToSimulator({ lesson: _lessonName, group: _groupFolder() }),
	);
	_vEl("asgn-download-plan").addEventListener("click", _downloadPlan);
	_vEl("asgn-view-diff").addEventListener("click", () =>
		_setBottomView("diff"),
	);
	_vEl("asgn-view-stu-code").addEventListener("click", () =>
		_setBottomView("code"),
	);
	_vEl("asgn-collapse").addEventListener("click", () => {
		const col = _vEl("side-col");
		_setAsgnCollapsed(!(col && col.classList.contains("asgn-collapsed")));
	});

	_setView("asgn-body", _asgnView);
	_syncAsgnButtons();
	_setAsgnCollapsed(_vRestore("students.asgnCollapsed", "0") === "1");
}

function _ensureCodeFV() {
	if (_codeFV) return _codeFV;
	const root = _vEl("student-code-fv");
	if (!root || typeof FileViewer === "undefined") return null;
	_codeFV = new FileViewer({
		rootEl: root,
		persistKey: "students.codeView",
		previewLabel: "Preview",
		onActiveFileChange: (name) => _renderCodeFile(name),
	});
	return _codeFV;
}

async function _studentPreviewSrcdoc(htmlName) {
	if (!_selectedStudent || !_allFiles) return "";
	const dir = `anon_ids/${_selectedStudent.id}/`;
	let html = "";
	let baseUrl = "";
	const filesMap = {};
	const mediaUris = {};
	for (const [p, f] of _allFiles) {
		const base = f.name;
		const inStudent = p.startsWith(dir);
		try {
			if (inStudent && base === htmlName) {
				html = await readFileText(f);
				if (typeof f.url === "string") {
					baseUrl = f.url.replace(/[^/]*$/, "");
				}
			} else if (inStudent && /\.(css|js)$/i.test(base)) {
				filesMap[base] = await readFileText(f);
			} else if (
				typeof MEDIA_EXT !== "undefined" &&
				MEDIA_EXT.test(p) &&
				!(base in mediaUris) &&
				(inStudent || /^correct\//i.test(p) || /^start\//i.test(p))
			) {
				mediaUris[base] = fileToUrl(f);
			}
		} catch {}
	}
	return typeof buildPreviewSrcdoc === "function"
		? buildPreviewSrcdoc(html, filesMap, mediaUris, baseUrl)
		: html;
}

function _fileLangRank(name) {
	const ext = (String(name).match(/\.([^.]+)$/) || ["", ""])[1].toLowerCase();
	const order = { html: 0, htm: 0, css: 1, js: 2, py: 3 };
	return ext in order ? order[ext] : 4;
}

function _studentCodeFiles() {
	if (!_selectedStudent || !_allFiles) return [];
	const dir = `anon_ids/${_selectedStudent.id}/`;
	const out = [];
	for (const [p, f] of _allFiles) {
		if (p.startsWith(dir) && CODE_EXT.test(f.name)) out.push([f.name, f]);
	}
	out.sort(
		(a, b) =>
			_fileLangRank(a[0]) - _fileLangRank(b[0]) || a[0].localeCompare(b[0]),
	);
	return out;
}

async function _renderCodeFile(name) {
	if (!_codeFV) return;
	_codeFV.showEditorLoading();
	const doc = _studentDocFiles(_selectedStudent).find((d) => d.name === name);
	if (doc) {
		await _renderDocInFv(doc);
		return;
	}
	const shot = _studentScreenshotFiles(_selectedStudent).find(
		(d) => d.name === name,
	);
	if (shot) {
		await _renderImageInFv(shot);
		return;
	}
	_codeFV.editorEl.classList.remove("fv-doc-mode");
	const entry = _studentCodeFiles().find(([n]) => n === name);
	if (!entry) {
		_codeFV.setEditorHtml("");
		return;
	}
	try {
		const text = await readFileText(entry[1]);
		try {
			await window.LanguageProfiles?.initProfiles();
		} catch (_e) {}
		_codeFV.setEditorHtml(fvRenderStaticEditor(text, null, name));
	} catch {
		_codeFV.setEditorHtml("");
	}
	if (/\.html?$/i.test(name) && _selectedStudent) {
		_codeFV.showPreview();
		_codeFV.showPreviewLoading();
		_codeFV.setPreviewSrcdoc(await _studentPreviewSrcdoc(name));
	} else if (_studentCodeFiles().some(([n]) => /\.html?$/i.test(n))) {
		_codeFV.showPreview();
	}
}

async function _renderDocInFv(doc) {
	const ed = _codeFV.editorEl;
	_codeFV.hidePreview();
	ed.classList.add("fv-doc-mode");
	if (doc.ext === "pdf") {
		let url = doc.file.url;
		if (!url) {
			const buf = await readFileArray(doc.file);
			url = URL.createObjectURL(
				new Blob([buf], { type: "application/pdf" }),
			);
		}
		_codeFV.setEditorHtml(
			`<iframe class="fv-doc-frame" src="${escAttr(url)}"></iframe>`,
		);
		return;
	}
	if (typeof window.mammoth === "undefined") {
		_codeFV.setEditorHtml(
			`<div class="fv-doc">Word viewer (mammoth.js) failed to load.</div>`,
		);
		return;
	}
	try {
		const buf = await readFileArray(doc.file);
		const res = await window.mammoth.convertToHtml({ arrayBuffer: buf });
		_codeFV.setEditorHtml(
			`<div class="fv-doc">${res.value || "(empty document)"}</div>`,
		);
	} catch (e) {
		_codeFV.setEditorHtml(
			`<div class="fv-doc">Failed to open document: ${escHtml(
				(e && e.message) || String(e),
			)}</div>`,
		);
	}
}

async function _renderImageInFv(img) {
	_codeFV.hidePreview();
	_codeFV.editorEl.classList.add("fv-doc-mode");
	let url = img.file.url;
	if (typeof url !== "string" || !url) {
		url = await readFileDataUri(img.file);
	}
	_codeFV.setEditorHtml(
		`<img class="fv-doc-img" src="${escAttr(url)}" alt="${escAttr(
			img.name,
		)}" />`,
	);
}

async function _populateCodeView() {
	const fv = _ensureCodeFV();
	if (!fv || !_selectedStudent) return;
	fv.showPreviewLoading();
	const s = _selectedStudent;
	fv.setLeftLabel(s.name || "");
	const codeNames = _studentCodeFiles().map(([n]) => n);
	const docNames = _studentDocFiles(s).map((d) => d.name);
	const shotNames = _studentScreenshotFiles(s).map((d) => d.name);
	const names = [...codeNames, ...docNames, ...shotNames];
	const want =
		_pendingCodeDoc && names.includes(_pendingCodeDoc)
			? _pendingCodeDoc
			: null;
	_pendingCodeDoc = null;
	fv.setTabs(names, want || names[0] || null);
	if (want) {
		await _renderCodeFile(want);
		return;
	}
	if (names[0]) await _renderCodeFile(names[0]);
	const htmlName = codeNames.find((n) => /\.html?$/i.test(n));
	if (htmlName) {
		fv.showPreview();
		fv.setPreviewSrcdoc(await _studentPreviewSrcdoc(htmlName));
	} else {
		fv.hidePreview();
	}
}

function _openStudentDocInCode(student, docName) {
	_pendingCodeDoc = docName;
	_bottomView = "code";
	selectStudentInline(student);
}

function _setBottomView(view) {
	_bottomView = view;
	const diff = _vEl("student-diff-frame");
	const code = _vEl("student-code-view");
	const segDiff = _vEl("asgn-view-diff");
	const segCode = _vEl("asgn-view-stu-code");
	if (segDiff) segDiff.classList.toggle("active", view !== "code");
	if (segCode) segCode.classList.toggle("active", view === "code");
	if (view === "code") {
		if (diff) diff.style.display = "none";
		if (code) code.hidden = false;
		_populateCodeView();
	} else {
		if (code) code.hidden = true;
		if (diff) diff.style.display = "";
	}
}

function selectStudentInline(student) {
	_ensureViewers();
	_selectedStudent = student;
	if (_pendingCodeDoc == null) {
		const shots = _studentScreenshotFiles(student);
		if (shots.length) {
			_bottomView = "code";
			_pendingCodeDoc = shots[0].name;
		}
	}
	const tb = _vEl("asgn-view-toggle");
	if (tb) tb.hidden = _paperMode;
	const col = _vEl("side-col");
	if (col && col.hidden) {
		_setSideCol(true);
	} else {
		_loadStudentDiff(student);
	}
	_setBottomView(_bottomView);
}

function _installSideDivider() {
	if (_sideDividerWired || typeof installDragDivider !== "function") return;
	_sideDividerWired = true;
	installDragDivider({
		dividerEl: _vEl("assignment-divider"),
		targetEl: _vEl("side-col"),
		containerEl: _vEl("content-row"),
		axis: "x",
		persistKey: "students.asgnSplit",
		minPct: 20,
		maxPct: 70,
	});
}

function _installPanesDivider() {
	if (_panesDividerWired || typeof installDragDivider !== "function") return;
	_panesDividerWired = true;
	installDragDivider({
		dividerEl: _vEl("panes-divider"),
		targetEl: _vEl("student-pane"),
		containerEl: _vEl("side-col"),
		axis: "y",
		persistKey: "students.panesSplit",
		minPct: 15,
		maxPct: 85,
	});
}

function _setSideCol(show) {
	_ensureViewers();
	const col = _vEl("side-col");
	const divider = _vEl("assignment-divider");
	const btn = _vEl("assignment-toggle");
	if (!col || !divider) return;
	col.hidden = !show;
	divider.hidden = !show;
	if (btn) btn.classList.toggle("active", show);
	_vPersist("students.asgnOpen", show ? "1" : "0");
	if (show) {
		_installSideDivider();
		_installPanesDivider();
		_renderAssignment();
		_loadStudentDiff(_selectedStudent);
	}
}

function _toggleSidePanel() {
	const col = _vEl("side-col");
	_setSideCol(col ? col.hidden : true);
}

let _sideRestored = false;
function _restoreSidePanel() {
	if (_sideRestored) return;
	_sideRestored = true;
	let open = false;
	try {
		open = localStorage.getItem("students.asgnOpen") === "1";
	} catch (_e) {}
	if (_paperMode) open = true;
	if (open) _setSideCol(true);
}
