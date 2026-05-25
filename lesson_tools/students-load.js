"use strict";

async function _tryAutoLoad() {
	const handle = await loadSavedDirHandle();
	if (!handle) return false;
	showLoading(true);
	_dirHandle = handle;
	_allFiles.clear();
	const files = [];
	await readDirHandle(handle, "", _allFiles, files, { lowercaseKeys: true });
	lessonNameEl.textContent = handle.name;
	lessonNameEl.classList.add("clickable");
	document.title = "Students: " + handle.name;
	await loadXlsxFiles(files);
	return true;
}

async function openFolderPicker() {
	try {
		const dirHandle = await pickFolderWithMemory();
		showLoading(true);
		_dirHandle = dirHandle;
		_allFiles.clear();
		const files = [];
		await readDirHandle(dirHandle, "", _allFiles, files, {
			lowercaseKeys: true,
		});
		const name = dirHandle.name;
		lessonNameEl.textContent = name;
		lessonNameEl.classList.add("clickable");
		document.title = "Students: " + name;
		await loadXlsxFiles(files);
	} catch (e) {
		if (e.name !== "AbortError") alert("Could not open folder: " + e.message);
		showLoading(false);
	}
}

async function loadXlsxFiles(files) {
	if (typeof XLSX === "undefined") {
		await new Promise((resolve) => {
			const s = document.querySelector('script[src*="xlsx"]');
			if (s) {
				s.addEventListener("load", resolve, { once: true });
				s.addEventListener("error", resolve, { once: true });
			} else {
				resolve();
			}
		});
	}
	if (typeof XLSX === "undefined") {
		alert(
			"SheetJS not loaded — need an internet connection or xlsx.full.min.js next to this file.",
		);
		showLoading(false);
		return;
	}
	const xlsxFiles = files.filter((f) =>
		f.name.toLowerCase().endsWith(".xlsx"),
	);
	const _ts = (f) => {
		const m = f.name.match(/_(\d{8})-(\d{6})\.xlsx$/i);
		if (m) return Number(m[1]) * 1000000 + Number(m[2]);
		const m2 = f.name.match(/_(\d{10,})\.xlsx$/i);
		if (m2) return Number(m2[1]);
		const m3 = f.name.match(/_(\d{8,})/);
		return m3 ? Number(m3[1]) : f.lastModified || 0;
	};

	_basisFiles = new Map();
	const _basisKeysByLength = REMARKS_BASES.map((b) => b.key).sort(
		(a, b) => b.length - a.length,
	);
	const _basisCandidates = new Map();
	for (const f of xlsxFiles) {
		const n = f.name.toLowerCase();
		for (const key of _basisKeysByLength) {
			const re = new RegExp(
				`^remarks_${key}(?:_(\\d{8}-\\d{6}|\\d{10,}))?\\.xlsx$`,
			);
			const m = n.match(re);
			if (!m) continue;
			const stamp = m[1] || "";
			const arr = _basisCandidates.get(key) || [];
			arr.push({ f, stamp });
			_basisCandidates.set(key, arr);
			break;
		}
	}
	for (const [key, arr] of _basisCandidates) {
		arr.sort((a, b) => {
			if (a.stamp && b.stamp && a.stamp.length === b.stamp.length) {
				return a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : 0;
			}
			if (a.stamp !== b.stamp) return a.stamp < b.stamp ? 1 : -1;
			return (b.f.lastModified || 0) - (a.f.lastModified || 0);
		});
		_basisFiles.set(key, arr[0].f);
	}

	const gradesFiles = xlsxFiles
		.filter((f) => /grades/i.test(f.name))
		.sort((a, b) => _ts(b) - _ts(a));
	_basisFallbackFile = gradesFiles[0] || null;

	let legacyRemarksFile = null;
	if (!_basisFallbackFile && _basisFiles.size === 0) {
		const remarksFiles = xlsxFiles
			.filter((f) => /remarks/i.test(f.name))
			.sort((a, b) => _ts(b) - _ts(a));
		legacyRemarksFile = remarksFiles[0] || null;
	}

	let initialFile = null;
	if (_basisFallbackFile) {
		_activeBasis = GRADES_KEY;
		initialFile = _basisFallbackFile;
	} else {
		for (const key of DEFAULT_BASIS_ORDER) {
			if (_basisFiles.has(key)) {
				_activeBasis = key;
				initialFile = _basisFiles.get(key);
				break;
			}
		}
		if (!initialFile) {
			for (const { key } of REMARKS_BASES) {
				if (_basisFiles.has(key)) {
					_activeBasis = key;
					initialFile = _basisFiles.get(key);
					break;
				}
			}
		}
		if (!initialFile && legacyRemarksFile) {
			_activeBasis = null;
			initialFile = legacyRemarksFile;
		}
	}

	if (!initialFile) {
		showLoading(false);
		alert(
			"No grades xlsx file found. Make sure a file with 'grades' or 'remarks' in its name exists.",
		);
		return;
	}

	try {
		await _loadRemarksFile(initialFile);
		_renderBasisPicker();
	} catch (ex) {
		showLoading(false);
		alert("Error loading xlsx files:\n" + ex.message);
	}
}

async function _loadRemarksFile(file) {
	showLoading(true);
	const remarksBuf = await readFileArray(file);
	const result = parseStudentRows(remarksBuf);
	_students = result.students;
	_remarkCols = result.remarkCols;
	_hasInteractions = result.hasInteractions;
	_followLabel = result.followLabel;
	_baseStudents = _students.map((s) => ({ ...s }));
	_activeBasisFile = file;
	_activeBasisFileName = file.name;
	_activeWorkbook = result.workbook;
	_activeSheetName = result.sheetName;
	_activeHeaderRow = result.headerRow;
	_activeRemarkColIdx = result.remarkColIdx || {};
	_dirtyEdits.clear();
	_updateSaveButton();
	showLoading(false);
	if (!_students.length) {
		alert("No students found in remarks xlsx.");
		return;
	}
	landingEl.style.display = "none";
	mainEl.style.display = "flex";
	renderTable();
}

async function _overlayBasisFollow(file) {
	showLoading(true);
	const buf = await readFileArray(file);
	const result = parseStudentRows(buf);
	showLoading(false);
	if (!_baseStudents) return;
	const byId = new Map();
	const byName = new Map();
	for (const s of result.students) {
		if (s.id) byId.set(s.id, s);
		if (s.name) byName.set(s.name, s);
	}
	_students = _baseStudents.map((s) => {
		const o = (s.id && byId.get(s.id)) || (s.name && byName.get(s.name));
		if (!o) return { ...s };
		return {
			...s,
			followPct: o.followPct,
			followEvents: o.followEvents,
			langPcts: o.langPcts,
			langEvents: o.langEvents,
			commentEvents: o.commentEvents,
		};
	});
	_applyDirtyToStudents();
	renderTable();
}

function _restoreBaseStudents() {
	if (!_baseStudents) return;
	_students = _baseStudents.map((s) => ({ ...s }));
	_applyDirtyToStudents();
	renderTable();
}

function _renderBasisPicker() {
	const container = document.getElementById("basis-picker");
	if (!container) return;

	const options = [];
	if (_basisFallbackFile) options.push({ key: GRADES_KEY, label: "Grades" });
	for (const { key, label } of REMARKS_BASES) {
		if (_basisFiles.has(key)) options.push({ key, label });
	}

	if (options.length === 0) {
		container.innerHTML = "";
		return;
	}

	let select = container.querySelector("select");
	if (!select) {
		container.innerHTML = "";
		const label = document.createElement("label");
		label.appendChild(document.createTextNode("Basis:"));
		select = document.createElement("select");
		select.id = "basis-select";
		label.appendChild(select);
		container.appendChild(label);
		select.addEventListener("change", async () => {
			_activeBasis = select.value;
			select.classList.toggle(
				"is-curated",
				_activeBasis === "ideal" || _activeBasis === "required",
			);
			try {
				if (_activeBasis === GRADES_KEY) {
					_restoreBaseStudents();
					return;
				}
				const f = _basisFiles.get(_activeBasis);
				if (!f) return;
				if (_baseStudents) {
					await _overlayBasisFollow(f);
				} else {
					await _loadRemarksFile(f);
				}
			} catch (ex) {
				showLoading(false);
				alert("Error loading basis xlsx:\n" + ex.message);
			}
		});
	}
	select.innerHTML = "";
	for (const { key, label } of options) {
		const opt = document.createElement("option");
		opt.value = key;
		opt.textContent = label;
		select.appendChild(opt);
	}
	if (_activeBasis && options.some((o) => o.key === _activeBasis)) {
		select.value = _activeBasis;
	} else {
		_activeBasis = select.value;
	}
	select.classList.toggle(
		"is-curated",
		select.value === "ideal" || select.value === "required",
	);
}
