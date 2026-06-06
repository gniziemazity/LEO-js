"use strict";

let _navState = {
	lesson: null,
	group: null,
	dataSource: null,
	folders: [],
	currentIdx: -1,
	idToFolder: {},
	folderToId: {},
};

function _sortFolders(names) {
	return [...names].sort((a, b) =>
		a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
	);
}

function _extractStudentFolders(files, prefix) {
	const set = new Set();
	const re = new RegExp("^" + prefix + "([^/]+)/", "i");
	for (const path of files.keys()) {
		const m = path.match(re);
		if (m) set.add(m[1]);
	}
	return _sortFolders([...set]);
}

async function _buildIdFolderMaps(ds) {
	const idToFolder = {};
	const folderToId = {};
	const lowerToOriginal = {};
	const csvEntry =
		ds.files.get("name_map.csv") || ds.files.get("students.csv");
	if (!csvEntry) return { idToFolder, folderToId, lowerToOriginal };
	try {
		const text = await readFileText(csvEntry);
		const { header, rows } = parseCsv(text);
		const idIdx = header.findIndex((h) => /student.?id|^id$/i.test(h));
		const alterIdx = header.findIndex((h) => /alter.?ego/i.test(h));
		const nameIdx = header.findIndex((h) => /student.?name|^name$/i.test(h));
		const folderIdx = alterIdx !== -1 ? alterIdx : nameIdx;
		if (idIdx === -1 || folderIdx === -1)
			return { idToFolder, folderToId, lowerToOriginal };
		for (const parts of rows) {
			const id = (parts[idIdx] || "").trim();
			const folder = (parts[folderIdx] || "").trim();
			if (id && folder) {
				idToFolder[id.toLowerCase()] = folder;
				folderToId[folder.toLowerCase()] = id;
				lowerToOriginal[folder.toLowerCase()] = folder;
			}
		}
	} catch {}
	return { idToFolder, folderToId, lowerToOriginal };
}

function _updateStudentNavButtons() {
	const prev = document.getElementById("nav-prev-student");
	const next = document.getElementById("nav-next-student");
	const counter = document.getElementById("nav-counter-student");
	if (!prev || !next) return;
	const n = _navState.folders.length;
	const i = _navState.currentIdx;
	prev.disabled = !(n > 0 && i > 0);
	next.disabled = !(n > 0 && i >= 0 && i < n - 1);
	if (counter) {
		counter.textContent = n > 0 && i >= 0 ? `${i + 1} / ${n}` : "";
	}
	if (n > 0 && i >= 0) {
		prev.title = `Previous student (${i + 1} / ${n})`;
		next.title = `Next student (${i + 1} / ${n})`;
	}
}

async function _loadFromUrlParams({ lesson, group, id, title }) {
	const ds = await loadLessonDataSource({ lesson, group });
	if (!ds) return null;
	await ds.load();

	const { idToFolder } = await _buildIdFolderMaps(ds);
	const prefix = "anon_ids/";
	const folders = _extractStudentFolders(ds.files, "anon_ids/");
	const folder =
		folders.find((f) => f.toLowerCase() === String(id).toLowerCase()) ||
		String(id);

	if (!folder) {
		console.warn(
			`[Differentiator] Could not resolve student "${id}" to a folder under ${prefix}.`,
		);
		return null;
	}

	const studentPrefix = prefix + folder.toLowerCase() + "/";
	const data = await buildDiffPayloadData(ds.files, studentPrefix);
	if (
		!Object.keys(data.teacherFiles).length &&
		!Object.keys(data.studentFiles).length
	) {
		console.warn(
			`[Differentiator] No code files found for ${lesson}/${studentPrefix}.`,
		);
		return null;
	}
	if (!Object.keys(data.allMarks || {}).length) {
		console.warn(
			`[Differentiator] No diff_marks loaded for ${lesson}/${studentPrefix}.`,
		);
	}

	_navState = {
		lesson,
		group: group || null,
		dataSource: ds,
		folders,
		currentIdx: folders.findIndex(
			(f) => f.toLowerCase() === folder.toLowerCase(),
		),
		idToFolder,
		prefix,
	};
	_updateStudentNavButtons();
	data.title = title || _formatStudentTitle(folder, idToFolder);
	return _buildDiffPayload(data);
}

function _formatStudentTitle(folder, idToFolder) {
	const name = idToFolder && idToFolder[folder.toLowerCase()];
	return name ? `${folder}. ${name}` : folder;
}

async function _navToStudent(idx, title) {
	if (!_navState.dataSource) return;
	if (idx < 0 || idx >= _navState.folders.length) return;
	const folder = _navState.folders[idx];
	_showLoading(true);
	try {
		const studentPrefix = _navState.prefix + folder.toLowerCase() + "/";
		const data = await buildDiffPayloadData(
			_navState.dataSource.files,
			studentPrefix,
		);
		if (
			!Object.keys(data.teacherFiles).length &&
			!Object.keys(data.studentFiles).length
		) {
			console.warn(
				`[Differentiator] No code files for ${_navState.lesson}/${studentPrefix}.`,
			);
			return;
		}
		data.title = title || _formatStudentTitle(folder, _navState.idToFolder);
		if (typeof _curatedResetForNewStudent === "function") {
			_curatedResetForNewStudent();
		}
		_applyIncomingData(_buildDiffPayload(data));
		_navState.currentIdx = idx;
		_updateStudentNavButtons();
		_updateTitleScore();
		const url = new URL(location.href);
		url.searchParams.set("id", folder);
		url.searchParams.delete("title");
		history.replaceState(null, "", url);
	} catch (e) {
		console.error("[Differentiator] Navigation failed:", e);
	} finally {
		_showLoading(false);
	}
}

async function _navToStudentId(id, title) {
	if (!_navState.dataSource || !_navState.folders.length) return false;
	const folders = _navState.folders;
	const lower = String(id).toLowerCase();
	let idx = -1;
	for (const cand of [_navState.idToFolder[lower], String(id)]) {
		if (!cand) continue;
		idx = folders.findIndex(
			(f) => f.toLowerCase() === String(cand).toLowerCase(),
		);
		if (idx >= 0) break;
	}
	if (idx < 0) return false;
	if (idx !== _navState.currentIdx) await _navToStudent(idx, title);
	return true;
}

window.diffNavToStudentId = _navToStudentId;
