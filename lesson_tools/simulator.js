"use strict";

// Simulator entry: top-level vis instance, IDB persistence, log/folder pickers,
// and DOMContentLoaded boot.

let vis;

const _SIM_IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|ico|bmp)$/i;
const _SIM_LOG_SKIP = new Set(["diff_marks.json"]);
const _SIM_LOG_RANK = (name) => {
	const n = name.toLowerCase();
	if (n === "log.json") return 0;
	if (n.endsWith("_log.json")) return 1;
	if (n.includes("log")) return 2;
	return 3;
};

async function _simReadImageUris(pathMap) {
	const imageUris = {};
	await Promise.all(
		[...pathMap.entries()]
			.filter(([p]) => _SIM_IMAGE_EXT.test(p))
			.map(async ([, f]) => {
				try {
					imageUris[f.name] = await readFileDataUri(f);
				} catch {}
			}),
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
			const lastDir = await _idbGet("lastDir");
			const opts = { mode: "read" };
			if (lastDir) opts.startIn = lastDir;
			const dirHandle = await window.showDirectoryPicker(opts);
			_idbSet("lastDir", dirHandle);
			const files = [];
			const pathMap = new Map();
			await readDirHandle(dirHandle, "", pathMap, files);

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
			const lastDir = await _idbGet("lastDir");
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
			_idbSet("lastDir", fh);
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
