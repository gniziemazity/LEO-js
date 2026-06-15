"use strict";

async function _loadFromDataSource(ds) {
	showLoading(true);
	const files = await ds.load();
	_dirHandle = ds.rootHandle;
	_allFiles = ds.files;
	_isReadOnly = ds.isReadOnly;
	_lessonName = ds.rootName;
	if (ds.rootHandle) {
		try {
			await _idbSet(IDB_KEY_LESSON_ROOT, ds.rootHandle);
		} catch {}
	}
	const name = ds.rootName;
	lessonNameEl.textContent = name;
	lessonNameEl.classList.add("clickable");
	document.title = "Students: " + name;
	const saveBtn = document.getElementById("save-btn");
	if (saveBtn) saveBtn.style.display = _isReadOnly ? "none" : "";
	await loadXlsxFiles(files);
}

async function _tryAutoLoad() {
	const handle = await loadSavedDirHandle();
	if (!handle) return false;
	const ds = new FsDataSource();
	ds.rootHandle = handle;
	ds.rootName = handle.name;
	await _loadFromDataSource(ds);
	return true;
}

async function _tryLoadFromUrlParams() {
	const { lesson, group } = parseToolParams();
	if (!lesson) return false;
	const ds = await loadLessonDataSource({ lesson, group });
	if (!ds) return false;
	_lessonGroup = group || null;
	await _loadFromDataSource(ds);
	return true;
}

async function openFolderPicker() {
	try {
		const ds = new FsDataSource();
		await ds.open();
		await _loadFromDataSource(ds);
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
	const _recency = (f) => {
		const name = f.name;
		let m = name.match(/(\d{8})[-_](\d{6})(?=\D*$)/);
		if (m) {
			const d = m[1];
			const t = m[2];
			const ms = Date.UTC(
				+d.slice(0, 4),
				+d.slice(4, 6) - 1,
				+d.slice(6, 8),
				+t.slice(0, 2),
				+t.slice(2, 4),
				+t.slice(4, 6),
			);
			if (!Number.isNaN(ms)) return ms;
		}
		m = name.match(/_(\d{13})\b/);
		if (m) return Number(m[1]);
		m = name.match(/_(\d{10})\b/);
		if (m) return Number(m[1]) * 1000;
		m = name.match(/(\d{8})(?=\D*$)/);
		if (m) {
			const d = m[1];
			const ms = Date.UTC(
				+d.slice(0, 4),
				+d.slice(4, 6) - 1,
				+d.slice(6, 8),
			);
			if (!Number.isNaN(ms)) return ms;
		}
		return f.lastModified || 0;
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

	_basisFallbackFile =
		xlsxFiles.find((f) => f.name.toLowerCase() === "remarks.xlsx") || null;

	if (!_basisFallbackFile && _lessonName) {
		const lessonLc = String(_lessonName)
			.toLowerCase()
			.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const canonRe = new RegExp(
			`^remarks_${lessonLc}(?:_(?:\\d{8}-\\d{6}|\\d{10,}))?\\.xlsx$`,
		);
		_basisFallbackFile =
			xlsxFiles
				.filter((f) => canonRe.test(f.name.toLowerCase()))
				.sort((a, b) => _recency(b) - _recency(a))[0] || null;
	}

	let legacyRemarksFile = null;
	if (!_basisFallbackFile && _basisFiles.size === 0) {
		const remarksFiles = xlsxFiles
			.filter((f) => /remarks/i.test(f.name))
			.sort((a, b) => _recency(b) - _recency(a));
		legacyRemarksFile = remarksFiles[0] || null;
	}

	const _basisRank = (key) => {
		if (key === GRADES_KEY) return -1;
		const di = DEFAULT_BASIS_ORDER.indexOf(key);
		if (di !== -1) return di;
		const ri = REMARKS_BASES.findIndex((b) => b.key === key);
		return ri === -1 ? 999 : 100 + ri;
	};
	const defaultCandidates = [];
	if (_basisFallbackFile)
		defaultCandidates.push({ key: GRADES_KEY, f: _basisFallbackFile });
	for (const [key, f] of _basisFiles) defaultCandidates.push({ key, f });
	defaultCandidates.sort((a, b) => {
		const dr = _recency(b.f) - _recency(a.f);
		if (dr !== 0) return dr;
		return _basisRank(a.key) - _basisRank(b.key);
	});

	let _desiredBasis = _setParam;
	if (!_desiredBasis && _paperMode) _desiredBasis = "ideal";
	const _desiredBasisFile =
		_desiredBasis && _basisFiles.has(_desiredBasis)
			? _basisFiles.get(_desiredBasis)
			: null;

	const _topCandidate = defaultCandidates[0] || null;
	let initialFile = null;
	let overlayFile = null;
	if (_basisFallbackFile) {
		initialFile = _basisFallbackFile;
		if (_desiredBasisFile) {
			overlayFile = _desiredBasisFile;
			_activeBasis = _desiredBasis;
		} else if (_topCandidate && _topCandidate.key !== GRADES_KEY) {
			overlayFile = _topCandidate.f;
			_activeBasis = _topCandidate.key;
		} else {
			_activeBasis = GRADES_KEY;
		}
	} else if (_desiredBasisFile) {
		initialFile = _desiredBasisFile;
		_activeBasis = _desiredBasis;
	} else if (_topCandidate) {
		initialFile = _topCandidate.f;
		_activeBasis = _topCandidate.key;
	} else if (legacyRemarksFile) {
		initialFile = legacyRemarksFile;
		_activeBasis = null;
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
		if (overlayFile) await _overlayBasisFollow(overlayFile);
		_renderBasisPicker();
	} catch (ex) {
		showLoading(false);
		alert("Error loading xlsx files:\n" + ex.message);
	}
}

async function _loadArtefactSchema() {
	const f = loadArtefactLabelsFromFileMap(_allFiles);
	if (f) {
		try {
			return parseArtefactLabelsCsv(await readFileText(f));
		} catch (_e) {
			return [];
		}
	}
	if (_dirHandle) {
		return loadArtefactLabelsFromHandle(_dirHandle);
	}
	return [];
}

async function _loadRemarksFile(file) {
	showLoading(true);
	const remarksBuf = await readFileArray(file);
	const result = parseStudentRows(remarksBuf);
	_students = result.students;
	_remarkCols = result.remarkCols;
	_hasInteractions = result.hasInteractions;
	_followLabel = result.followLabel;
	_mode =
		_modeParam ||
		(_lessonGroup === "lessons"
			? "lesson"
			: _lessonGroup === "assignments"
				? "assignment"
				: _followLabel === "SIM"
					? "assignment"
					: "lesson");
	_baseStudents = _students.map((s) => ({ ...s }));
	_snapshotOrigObs(_students);
	_activeBasisFile = file;
	_activeBasisFileName = file.name;
	_activeSheetName = result.sheetName;
	_activeRemarkColIdx = result.remarkColIdx || {};
	_dirtyEdits.clear();
	_updateSaveButton();
	_artefactSchema = await _loadArtefactSchema();
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
	if (_basisFallbackFile) options.push({ key: GRADES_KEY, label: "Remarks" });
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
				_activeBasis === "ideal" || _activeBasis === "minimal",
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
		select.value === "ideal" || select.value === "minimal",
	);
}
