"use strict";

let _pendingXlsx = [];
let _allFiles = new Map();
let _dirHandle = null;
let _studentIdMap = {};
let _realToAlterMap = {};

const landingEl = document.getElementById("landing");

async function openFilePicker() {
	try {
		const lastDir = await _idbGet("lastDir");
		const opts = { multiple: true };
		if (lastDir) opts.startIn = lastDir;
		const handles = await window.showOpenFilePicker(opts);
		if (!handles.length) return;
		_idbSet("lastDir", handles[0]);
		_allFiles = new Map();
		showLoading(true);
		const files = await Promise.all(handles.map((h) => h.getFile()));
		handleFiles(files);
	} catch (e) {
		if (e.name !== "AbortError") alert("Could not open files: " + e.message);
	}
}

async function openFolderPicker() {
	try {
		const lastDir = await _idbGet("lastDir");
		const opts = { mode: "read" };
		if (lastDir) opts.startIn = lastDir;
		const dirHandle = await window.showDirectoryPicker(opts);
		_idbSet("lastDir", dirHandle);
		_dirHandle = dirHandle;
		showLoading(true);
		const files = [];
		const pathMap = new Map();
		await readDirHandle(dirHandle, "", pathMap, files);
		_allFiles = pathMap;
		handleFiles(files);
	} catch (e) {
		if (e.name !== "AbortError") alert("Could not open folder: " + e.message);
	}
}

async function readDirHandle(handle, prefix, pathMap, files) {
	for await (const [name, entry] of handle) {
		const path = prefix ? `${prefix}/${name}` : name;
		if (entry.kind === "directory") {
			await readDirHandle(entry, path, pathMap, files);
		} else {
			const file = await entry.getFile();
			files.push(file);
			pathMap.set(path, file);
		}
	}
}

function handleFiles(files) {
	const isRootLevel = (f) => {
		const p = _filePathFor(f);
		return !p || !p.includes("/");
	};
	const jsonFiles = files.filter(
		(f) =>
			f.name.toLowerCase().endsWith(".json") &&
			!f.name.toLowerCase().startsWith("diff_marks") &&
			isRootLevel(f),
	);
	const xlsxFiles = files.filter((f) =>
		f.name.toLowerCase().endsWith(".xlsx"),
	);
	const studentsCsvFile = files.find(
		(f) => f.name.toLowerCase() === "students.csv",
	);
	const nameMapFile = files.find(
		(f) => f.name.toLowerCase() === "name_map.csv",
	);
	if (!jsonFiles.length) {
		alert("No JSON log file found.");
		return;
	}
	_pendingXlsx = xlsxFiles;
	_realToAlterMap = {};
	if (nameMapFile) loadStudentsCsv(nameMapFile);
	else if (studentsCsvFile) loadStudentsCsv(studentsCsvFile);
	loadBestJsonFile(jsonFiles);
}

async function loadStudentsCsv(file) {
	try {
		const text = await file.text();
		_realToAlterMap = parseStudentsCsvForAlterEgo(text);
		if (_p) scheduleRender();
	} catch {
		_realToAlterMap = {};
	}
}

function parseStudentsCsvForAlterEgo(text) {
	const map = {};
	const lines = text.split(/\r?\n/).filter(Boolean);
	if (lines.length < 2) return map;
	const delim = lines[0].includes(";") ? ";" : ",";
	const cells = (line) =>
		line.split(delim).map((s) => s.trim().replace(/^"|"$/g, ""));
	const header = cells(lines[0]);
	const nameIdx = header.findIndex((h) => /student.?name/i.test(h));
	const alterIdx = header.findIndex((h) => /alter.?ego/i.test(h));
	if (nameIdx === -1 || alterIdx === -1) return map;
	for (let i = 1; i < lines.length; i++) {
		const parts = cells(lines[i]);
		const realName = parts[nameIdx];
		const alterEgo = parts[alterIdx];
		if (realName && alterEgo) map[realName] = alterEgo;
	}
	return map;
}

async function loadBestJsonFile(jsonFiles) {
	if (jsonFiles.length === 0) {
		alert("No JSON log file found in the selected folder.");
		showLoading(false);
		return;
	}
	if (jsonFiles.length > 1) {
		const paths = jsonFiles
			.map((f) => _filePathFor(f) || f.name)
			.join("\n  ");
		console.warn(
			`[Dashboard] Expected exactly one .json log file, found ${jsonFiles.length}:\n  ${paths}`,
		);
		alert(
			`Expected exactly one .json log file in the folder, found ${jsonFiles.length}:\n${paths}`,
		);
		showLoading(false);
		return;
	}
	const file = jsonFiles[0];
	const path = _filePathFor(file) || file.name;
	try {
		const data = JSON.parse(await file.text());
		const events = data?.events || data?.keyPresses || [];
		if (!Array.isArray(events) || events.length === 0) {
			console.error(`[Dashboard] ${path} has no events`);
			alert(`${path} has no events.`);
			showLoading(false);
			return;
		}
		console.log(
			`[Dashboard] Loading log from ${path} ` +
				`(${events.length} events, sessionStart=${
					events[0]?.timestamp
						? new Date(events[0].timestamp).toISOString()
						: "?"
				})`,
		);
		await loadJsonData(file, data);
	} catch (e) {
		console.error(`[Dashboard] failed to load ${path}: ${e.message}`);
		alert(`Failed to load ${path}: ${e.message}`);
		showLoading(false);
	}
}

function _filePathFor(file) {
	for (const [path, f] of _allFiles.entries()) {
		if (f === file) return path;
	}
	return null;
}

async function _readImageUris(fileMap) {
	const imageUris = {};
	await Promise.all(
		[...fileMap.entries()]
			.filter(([p]) => IMAGE_EXT.test(p))
			.map(
				([, f]) =>
					new Promise((res) => {
						const r = new FileReader();
						r.onload = (e) => {
							imageUris[f.name] = e.target.result;
							res();
						};
						r.onerror = res;
						r.readAsDataURL(f);
					}),
			),
	);
	return imageUris;
}

async function loadJsonData(file, data) {
	document.title = "Dashboard";
	_zoomMin = _zoomMax = null;
	_studentIdMap = {};
	const p = processData(data);
	if (!p) {
		showLoading(false);
		return;
	}
	_p = p;
	try {
		localStorage.setItem(
			"dashboard_sim_data",
			JSON.stringify({
				filePath: file.name,
				events: data.events || data.keyPresses || [],
				loadedAt: Date.now(),
			}),
		);
	} catch {}
	if (_allFiles.size) {
		try {
			const imageUris = await _readImageUris(_allFiles);
			if (Object.keys(imageUris).length)
				localStorage.setItem(
					"dashboard_sim_images",
					JSON.stringify(imageUris),
				);
			else localStorage.removeItem("dashboard_sim_images");
		} catch {}
	} else {
		localStorage.removeItem("dashboard_sim_images");
	}
	landingEl.style.display = "none";
	document.getElementById("main").style.display = "flex";

	scheduleRender();
	if (_pendingXlsx.length) {
		loadXlsxFiles(_pendingXlsx);
		_pendingXlsx = [];
	}
}

window.addEventListener("resize", () => {
	clearTimeout(window._rt);
	window._rt = setTimeout(() => {
		if (_p) scheduleRender();
	}, 120);
});
