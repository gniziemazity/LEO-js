"use strict";

let _pendingXlsx = [];
let _allFiles = new Map();

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

function handleFiles(files) {
	const jsonFiles = files.filter(
		(f) =>
			f.name.toLowerCase().endsWith(".json") &&
			f.name.toLowerCase() !== "diff_marks.json",
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
				await loadJsonData(file, data);
				return;
			}
		} catch {}
	}

	alert("No JSON log file with events found.");
	showLoading(false);
}

const IMAGE_EXT_KLA = /\.(png|jpe?g|gif|svg|webp|ico|bmp)$/i;

async function _readImageUris(fileMap) {
	const imageUris = {};
	await Promise.all(
		[...fileMap.entries()]
			.filter(([p]) => IMAGE_EXT_KLA.test(p))
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
	document.title = "Dashboard: " + file.name.replace(/\.json$/i, "");
	_zoomMin = _zoomMax = null;
	const p = processData(data);
	if (!p) {
		showLoading(false);
		return;
	}
	_p = p;
	try {
		localStorage.setItem(
			"kla_sim_data",
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
				localStorage.setItem("kla_sim_images", JSON.stringify(imageUris));
			else localStorage.removeItem("kla_sim_images");
		} catch {}
	} else {
		localStorage.removeItem("kla_sim_images");
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
