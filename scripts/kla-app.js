"use strict";

let _pendingXlsx = [];
let _allFiles = new Map();

const landingEl = document.getElementById("landing");
const fileInput = document.getElementById("file-input");

fileInput.addEventListener("change", (e) => {
	if (!e.target.files.length) return;
	_allFiles = new Map();
	handleFiles([...e.target.files]);
});

function _idbOpen() {
	return new Promise((res, rej) => {
		const req = indexedDB.open("kla", 1);
		req.onupgradeneeded = (e) => e.target.result.createObjectStore("state");
		req.onsuccess = (e) => res(e.target.result);
		req.onerror = () => rej(req.error);
	});
}

async function _idbGet(key) {
	try {
		const db = await _idbOpen();
		return await new Promise((res) => {
			const r = db.transaction("state").objectStore("state").get(key);
			r.onsuccess = () => res(r.result ?? null);
			r.onerror = () => res(null);
		});
	} catch {
		return null;
	}
}

async function _idbSet(key, value) {
	try {
		const db = await _idbOpen();
		await new Promise((res, rej) => {
			const tx = db.transaction("state", "readwrite");
			tx.objectStore("state").put(value, key);
			tx.oncomplete = res;
			tx.onerror = rej;
		});
	} catch {}
}

async function openFolderPicker() {
	try {
		const lastDir = await _idbGet("lastDir");
		const opts = { mode: "read" };
		if (lastDir) opts.startIn = lastDir;
		const dirHandle = await window.showDirectoryPicker(opts);
		_idbSet("lastDir", dirHandle);
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

async function readAllDirEntries(reader) {
	const entries = [];
	while (true) {
		const batch = await new Promise((res, rej) =>
			reader.readEntries(res, rej),
		);
		if (!batch.length) break;
		entries.push(...batch);
	}
	return entries;
}

async function readDirEntry(dirEntry, pathPrefix, pathMap, files) {
	const entries = await readAllDirEntries(dirEntry.createReader());
	for (const entry of entries) {
		const entryPath = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;
		if (entry.isDirectory) {
			await readDirEntry(entry, entryPath, pathMap, files);
		} else if (entry.isFile) {
			const file = await new Promise((res, rej) => entry.file(res, rej));
			files.push(file);
			pathMap.set(entryPath, file);
		}
	}
}

async function collectDroppedFiles(dt) {
	const files = [];
	const pathMap = new Map();
	for (const item of [...dt.items]) {
		const entry = item.webkitGetAsEntry?.();
		if (entry?.isDirectory) {
			await readDirEntry(entry, "", pathMap, files);
		} else if (item.kind === "file") {
			const file = item.getAsFile();
			if (file) {
				files.push(file);
				pathMap.set(file.name, file);
			}
		}
	}
	return { files: files.filter(Boolean), pathMap };
}

function handleFiles(files) {
	const jsonFiles = files.filter(
		(f) =>
			f.name.toLowerCase().endsWith(".json") &&
			f.name.toLowerCase() !== "diff_marks.json" &&
			f.name.toLowerCase() !== "tokens_positions.json",
	);
	const xlsxFiles = files.filter((f) =>
		f.name.toLowerCase().endsWith(".xlsx"),
	);
	if (!jsonFiles.length) {
		alert("No JSON log file found.");
		return;
	}
	_pendingXlsx = xlsxFiles;
	loadBestJsonFile(jsonFiles);
}

async function loadBestJsonFile(jsonFiles) {
	const rank = (name) => {
		const n = name.toLowerCase();
		if (n === "log.json") return 0;
		if (n.endsWith("_log.json")) return 1;
		if (n.includes("log")) return 2;
		return 3;
	};
	const candidates = [...jsonFiles].sort(
		(a, b) => rank(a.name) - rank(b.name),
	);

	for (const file of candidates) {
		try {
			const data = JSON.parse(await file.text());
			const events = data?.events || data?.keyPresses || [];
			if (Array.isArray(events) && events.length) {
				loadJsonData(file, data);
				return;
			}
		} catch {}
	}

	alert("No JSON log file with events found.");
	showLoading(false);
}

function loadJsonData(file, data) {
	document.title = "Key Log Analyzer – " + file.name.replace(/\.json$/i, "");
	_zoomMin = _zoomMax = null;
	const p = processData(data);
	if (!p) {
		showLoading(false);
		return;
	}
	_p = p;
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
