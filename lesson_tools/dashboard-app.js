"use strict";

let _pendingXlsx = [];
let _allFiles = new Map();
let _dirHandle = null;
let _studentIdMap = {};
let _realToAlterMap = {};
let _studentNameMap = {};

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
		_studentNameMap = parseStudentsCsvForIdName(text);
		if (_p) scheduleRender();
	} catch {
		_realToAlterMap = {};
		_studentNameMap = {};
	}
}

function parseStudentsCsvForIdName(text) {
	const map = {};
	const lines = text.split(/\r?\n/).filter(Boolean);
	if (lines.length < 2) return map;
	const delim = lines[0].includes(";") ? ";" : ",";
	const cells = (line) =>
		line.split(delim).map((s) => s.trim().replace(/^"|"$/g, ""));
	const header = cells(lines[0]);
	const idIdx = header.findIndex((h) => /student.?id|^id$/i.test(h));
	const nameIdx = header.findIndex((h) => /student.?name|^name$/i.test(h));
	if (idIdx === -1 || nameIdx === -1) return map;
	for (let i = 1; i < lines.length; i++) {
		const parts = cells(lines[i]);
		const id = parts[idIdx];
		const name = parts[nameIdx];
		if (id && name) map[id] = name;
	}
	return map;
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
			.map(async ([, f]) => {
				try {
					imageUris[f.name] = await readFileDataUri(f);
				} catch {}
			}),
	);
	return imageUris;
}

async function loadJsonData(file, data) {
	document.title = _dirHandle?.name
		? `Dashboard: ${_dirHandle.name}`
		: "Dashboard";
	_zoomMin = _zoomMax = null;
	_studentIdMap = {};
	const p = processData(data);
	if (!p) {
		showLoading(false);
		return;
	}
	_p = p;
	await _loadTeacherTokens();
	try {
		localStorage.setItem(
			"dashboard_sim_data",
			JSON.stringify({
				filePath: file.name,
				lessonFile: data.lessonFile || null,
				lessonName: _dirHandle?.name || null,
				studentNameMap: _studentNameMap,
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

async function _tryAutoLoadDashboard() {
	const handle = await _idbGet("lastDir");
	if (!handle || handle.kind !== "directory") return false;
	try {
		const perm = await handle.requestPermission({ mode: "read" });
		if (perm !== "granted") return false;
	} catch {
		return false;
	}
	_dirHandle = handle;
	showLoading(true);
	const files = [];
	const pathMap = new Map();
	await readDirHandle(handle, "", pathMap, files);
	_allFiles = pathMap;
	handleFiles(files);
	return true;
}

(async function () {
	const qs = new URLSearchParams(location.search);
	if (qs.get("autoload") !== "1") return;
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
	const ok = await _tryAutoLoadDashboard();
	if (!ok) {
		const btn = document.createElement("button");
		btn.className = "landing-btn";
		btn.textContent = "🔄 Load Lesson";
		btn.onclick = async () => {
			btn.disabled = true;
			await _tryAutoLoadDashboard();
			btn.disabled = false;
		};
		const landingButtons = document.getElementById("landing-buttons");
		if (landingButtons) landingButtons.prepend(btn);
	}
})();

window.addEventListener("resize", () => {
	clearTimeout(window._rt);
	window._rt = setTimeout(() => {
		if (_p) scheduleRender();
	}, 120);
});

function _parseTeacherTokensTxt(text, sessionDate) {
	const lines = text.split(/\r?\n/);
	const tokens = [];
	for (const line of lines) {
		if (!line || line.startsWith("#")) continue;
		const parts = line.replace(/\r$/, "").split("\t");
		if (parts.length < 2) continue;
		const ts = _hmsToSeconds(parts[1], sessionDate);
		if (ts == null) continue;
		const rest = parts.slice(2);
		const isComment = rest.includes("COMMENT");
		const isRemoved = rest.includes("REMOVED");
		let delTs = null;
		if (isRemoved) {
			const idx = rest.indexOf("REMOVED");
			if (idx + 1 < rest.length) {
				delTs = _hmsToSeconds(rest[idx + 1], sessionDate);
			}
		}
		tokens.push({
			ts,
			delTs,
			token: parts[0],
			isComment,
			isRemoved,
		});
	}
	tokens.sort((a, b) => a.ts - b.ts);
	return tokens;
}

async function _loadTeacherTokens() {
	_teacherTokens = [];
	if (!_allFiles || !_allFiles.size || !_p) return;
	const candidates = [];
	for (const [path, file] of _allFiles) {
		const pl = path.toLowerCase();
		if (pl === "tokens.txt" || pl.endsWith("/tokens.txt")) {
			let rank = 9;
			if (pl.startsWith("correct/")) rank = 0;
			else if (pl.startsWith("reconstructed/")) rank = 1;
			else if (pl.startsWith("reference/")) rank = 2;
			candidates.push({ rank, path, file });
		}
	}
	if (!candidates.length) {
		console.warn("[Dashboard] tokens.txt not found in project");
		return;
	}
	candidates.sort((a, b) => a.rank - b.rank);
	const entry = candidates[0].file;
	try {
		const text = await entry.text();
		const sessionDate = new Date(_p.sessionStart * 1000);
		_teacherTokens = _parseTeacherTokensTxt(text, sessionDate);
		console.log(
			`[Dashboard] loaded ${_teacherTokens.length} teacher tokens from ${candidates[0].path}`,
		);
	} catch (e) {
		console.warn("[Dashboard] failed to load tokens.txt:", e?.message);
	}
}
