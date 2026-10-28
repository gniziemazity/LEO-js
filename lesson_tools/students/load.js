"use strict";

async function _loadFromDataSource(ds) {
	showLoading(true);
	const files = await ds.load();
	_dirHandle = ds.rootHandle;
	_allFiles = ds.files;
	_serverWritable = !!ds.serverWritable;
	_lessonName = ds.rootName;
	const name = ds.rootName;
	lessonNameEl.textContent = name;
	lessonNameEl.classList.add("clickable");
	document.title = "Students: " + name;
	const saveBtn = document.getElementById("save-btn");
	if (saveBtn) saveBtn.style.display = _canEditCells() ? "" : "none";
	await loadXlsxFiles(files);
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

async function loadXlsxFiles(files) {
	await waitForXlsxBundle();
	if (typeof XLSX === "undefined") {
		alert(
			"SheetJS not loaded — need an internet connection or xlsx.full.min.js next to this file.",
		);
		showLoading(false);
		return;
	}
	const picked = pickRemarksFiles(files, { lessonName: _lessonName });
	_basisFiles = picked.basisFiles;
	_basisFallbackFile = picked.fallback;
	const _desiredBasis = defaultBasis(
		_basisFiles,
		_setParam || (_paperMode ? "ideal" : null),
	);
	const _desiredBasisFile = _desiredBasis
		? _basisFiles.get(_desiredBasis)
		: null;

	let initialFile = null;
	let overlayFile = null;
	if (_basisFallbackFile) {
		initialFile = _basisFallbackFile;
		if (_desiredBasisFile) {
			overlayFile = _desiredBasisFile;
			_activeBasis = _desiredBasis;
		} else {
			_activeBasis = null;
		}
	} else if (_desiredBasisFile) {
		initialFile = _desiredBasisFile;
		_activeBasis = _desiredBasis;
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
				: result.scoreKind === "similarity"
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

function _renderBasisPicker() {
	const container = document.getElementById("basis-picker");
	if (!container) return;
	const shown = renderBasisSelect(
		container,
		_basisFiles,
		_activeBasis,
		async (key) => {
			_activeBasis = key;
			try {
				const f = _basisFiles.get(key);
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
		},
	);
	if (shown) _activeBasis = shown;
}
