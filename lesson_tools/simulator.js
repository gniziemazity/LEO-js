"use strict";

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

async function _simReadStudentNameMap(pathMap) {
	const entry = [...pathMap.entries()].find(
		([p]) => /students\.csv$/i.test(p) || /name_map\.csv$/i.test(p),
	);
	if (!entry) return {};
	try {
		const text = await readFileText(entry[1]);
		return _simParseStudentNameMap(text);
	} catch {
		return {};
	}
}

function _simParseStudentNameMap(text) {
	const map = {};
	const { header, rows } = parseCsv(text);
	const idIdx = header.findIndex((h) => /student.?id|^id$/i.test(h));
	const nameIdx = header.findIndex((h) => /student.?name|^name$/i.test(h));
	if (idIdx === -1 || nameIdx === -1) return map;
	for (const parts of rows) {
		const id = parts[idIdx];
		const name = parts[nameIdx];
		if (id && name) map[id] = name;
	}
	return map;
}

document.addEventListener("DOMContentLoaded", async () => {
	try {
		await window.LanguageProfiles.initProfiles();
	} catch (e) {
		console.warn(
			"Language profiles failed to load; syntax highlighting disabled.",
			e,
		);
	}
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
				const { filePath, events, lessonFile, lessonName, studentNameMap } =
					parsed;
				let imageUris = {};
				try {
					const raw = localStorage.getItem("dashboard_sim_images");
					if (raw) imageUris = JSON.parse(raw);
				} catch {}
				const micro = expandEvents(events || []);
				const interactions = (events || []).filter((e) => e.interaction);
				loadFromData({
					filePath,
					micro,
					error: null,
					imageUris,
					lessonFile,
					lessonName,
					interactions,
					studentNameMap: studentNameMap || {},
				});
			} else if (logData) {
				loadFromData(logData);
			}
		} catch {}
	}

	btnFolder.addEventListener("click", async () => {
		try {
			const dirHandle = await pickFolderWithMemory();
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
						const studentNameMap = await _simReadStudentNameMap(pathMap);
						const micro = expandEvents(events);
						loadFromData({
							filePath: file.name,
							micro,
							error: null,
							imageUris,
							lessonFile: data?.lessonFile || null,
							lessonName: dirHandle.name,
							interactions: events.filter((e) => e.interaction),
							studentNameMap,
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
			const [fh] = await pickFilesWithMemory({
				types: [
					{
						description: "Log files",
						accept: { "application/json": [".json"] },
					},
				],
			});
			if (!fh) return;
			const file = await fh.getFile();
			const json = JSON.parse(await file.text());
			const events = json.events || [];
			const micro = expandEvents(events);
			loadFromData({
				filePath: file.name,
				micro,
				error: null,
				lessonFile: json?.lessonFile || null,
				interactions: events.filter((e) => e.interaction),
			});
		} catch (e) {
			if (e.name !== "AbortError") alert("Failed to load log: " + e.message);
		}
	});
});
