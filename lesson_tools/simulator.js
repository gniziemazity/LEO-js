"use strict";

// Simulator entry: top-level vis instance, IDB persistence, log/folder pickers,
// and DOMContentLoaded boot.

let vis;

function _simIdbOpen() {
	return new Promise((res, rej) => {
		const req = indexedDB.open("lesson_tools", 1);
		req.onupgradeneeded = (e) => e.target.result.createObjectStore("state");
		req.onsuccess = (e) => res(e.target.result);
		req.onerror = () => rej(req.error);
	});
}
async function _simIdbGet(key) {
	try {
		const db = await _simIdbOpen();
		return await new Promise((res) => {
			const r = db.transaction("state").objectStore("state").get(key);
			r.onsuccess = () => res(r.result ?? null);
			r.onerror = () => res(null);
		});
	} catch {
		return null;
	}
}
async function _simIdbSet(key, value) {
	try {
		const db = await _simIdbOpen();
		await new Promise((res, rej) => {
			const tx = db.transaction("state", "readwrite");
			tx.objectStore("state").put(value, key);
			tx.oncomplete = res;
			tx.onerror = rej;
		});
	} catch {}
}

const _SIM_IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|ico|bmp)$/i;
const _SIM_LOG_SKIP = new Set(["diff_marks.json"]);
const _SIM_LOG_RANK = (name) => {
	const n = name.toLowerCase();
	if (n === "log.json") return 0;
	if (n.endsWith("_log.json")) return 1;
	if (n.includes("log")) return 2;
	return 3;
};

async function _simReadDir(handle, prefix, pathMap, files) {
	for await (const [name, entry] of handle) {
		const path = prefix ? `${prefix}/${name}` : name;
		if (entry.kind === "directory") {
			await _simReadDir(entry, path, pathMap, files);
		} else {
			const file = await entry.getFile();
			files.push(file);
			pathMap.set(path, file);
		}
	}
}

async function _simReadImageUris(pathMap) {
	const imageUris = {};
	await Promise.all(
		[...pathMap.entries()]
			.filter(([p]) => _SIM_IMAGE_EXT.test(p))
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

document.addEventListener("DOMContentLoaded", () => {
	vis = new LogVisualizer();

	const landing = document.getElementById("lv-landing");
	const btnOpen = document.getElementById("btn-open-log");
	const btnFolder = document.getElementById("btn-open-folder");

	function loadFromData(data) {
		landing.style.display = "none";
		vis.loadFile(data);
	}

	const isReload =
		performance.getEntriesByType("navigation")[0]?.type === "reload";
	if (!isReload) {
		try {
			const logData = window.__LOG_DATA__;
			const logTs = logData?.loadedAt || 0;
			let parsed = null;
			try {
				const stored = localStorage.getItem("dashboard_sim_data");
				if (stored) parsed = JSON.parse(stored);
			} catch {}
			const storedTs = parsed?.loadedAt || 0;

			if (logData && logTs >= storedTs) {
				loadFromData(logData);
			} else if (parsed) {
				const { filePath, events } = parsed;
				let imageUris = {};
				try {
					const raw = localStorage.getItem("dashboard_sim_images");
					if (raw) imageUris = JSON.parse(raw);
				} catch {}
				const micro = expandEvents(events || []);
				loadFromData({ filePath, micro, error: null, imageUris });
			} else if (logData) {
				loadFromData(logData);
			}
		} catch {}
	}

	btnFolder.addEventListener("click", async () => {
		try {
			const lastDir = await _simIdbGet("lastDir");
			const opts = { mode: "read" };
			if (lastDir) opts.startIn = lastDir;
			const dirHandle = await window.showDirectoryPicker(opts);
			_simIdbSet("lastDir", dirHandle);
			const files = [];
			const pathMap = new Map();
			await _simReadDir(dirHandle, "", pathMap, files);

			const isRootLevel = (f) => {
				for (const [p, fp] of pathMap.entries()) {
					if (fp === f) return !p.includes("/");
				}
				return true;
			};
			const jsonFiles = files.filter(
				(f) =>
					f.name.toLowerCase().endsWith(".json") &&
					!_SIM_LOG_SKIP.has(f.name.toLowerCase()) &&
					isRootLevel(f),
			);
			if (!jsonFiles.length) {
				alert("No JSON log file found in this folder.");
				return;
			}

			const candidates = [...jsonFiles].sort(
				(a, b) => _SIM_LOG_RANK(a.name) - _SIM_LOG_RANK(b.name),
			);
			let loaded = false;
			for (const file of candidates) {
				try {
					const data = JSON.parse(await file.text());
					const events = data?.events || data?.keyPresses || [];
					if (Array.isArray(events) && events.length) {
						const imageUris = await _simReadImageUris(pathMap);
						const micro = expandEvents(events);
						loadFromData({
							filePath: file.name,
							micro,
							error: null,
							imageUris,
						});
						loaded = true;
						break;
					}
				} catch {}
			}
			if (!loaded) alert("No JSON log file with events found.");
		} catch (e) {
			if (e.name !== "AbortError")
				alert("Could not open folder: " + e.message);
		}
	});

	btnOpen.addEventListener("click", async () => {
		try {
			const lastDir = await _simIdbGet("lastDir");
			const opts = {
				types: [
					{
						description: "Log files",
						accept: { "application/json": [".json"] },
					},
				],
			};
			if (lastDir) opts.startIn = lastDir;
			const [fh] = await window.showOpenFilePicker(opts);
			_simIdbSet("lastDir", fh);
			const file = await fh.getFile();
			const json = JSON.parse(await file.text());
			const events = json.events || [];
			const micro = expandEvents(events);
			loadFromData({ filePath: file.name, micro, error: null });
		} catch (e) {
			if (e.name !== "AbortError") alert("Failed to load log: " + e.message);
		}
	});
});
