"use strict";

let vis;

let _visReady = null;
let _pendingVisData = null;

window.__leoApplyVisData = (data) => {
	if (!data) return;
	if (_visReady) _visReady(data);
	else _pendingVisData = data;
};

const _SIM_LOG_SKIP = new Set(["diff_marks.json"]);
const _SIM_LOG_RANK = (name) => {
	const n = name.toLowerCase();
	if (n.endsWith(".log")) return 0;
	if (n === "log.json") return 1;
	if (n.endsWith("_log.json")) return 2;
	if (n.includes("log")) return 3;
	return 4;
};

async function _simReadImageUris(pathMap) {
	const imageUris = {};
	await Promise.all(
		[...pathMap.entries()]
			.filter(([p]) => IMAGE_EXT.test(p))
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
		return parseStudentIdNameMap(text);
	} catch {
		return {};
	}
}

async function _simLoadFromFileMap(
	pathMap,
	lessonName,
	loadFromData,
	seekStep,
	seekTs,
) {
	const isLogCandidate = (f) => {
		const n = f.name.toLowerCase();
		return (
			n.endsWith(".log") || (n.endsWith(".json") && !_SIM_LOG_SKIP.has(n))
		);
	};
	const candidates = [...pathMap.entries()]
		.filter(([p, f]) => {
			if (!isLogCandidate(f)) return false;
			if (!p.includes("/")) return true;
			return /^anon_(ids|names)\/log\.(json|log)$/i.test(p);
		})
		.map(([, f]) => f)
		.sort((a, b) => _SIM_LOG_RANK(a.name) - _SIM_LOG_RANK(b.name));
	if (!candidates.length) return false;
	for (const file of candidates) {
		try {
			const text =
				typeof file.text === "function"
					? await file.text()
					: await readFileText(file);
			const data = JSON.parse(text);
			const events = data?.events || data?.keyPresses || [];
			if (!Array.isArray(events) || !events.length) continue;
			const imageUris = await _simReadImageUris(pathMap);
			const studentNameMap = await _simReadStudentNameMap(pathMap);
			const micro = expandEvents(events);
			loadFromData({
				filePath: file.name,
				micro,
				events,
				error: null,
				imageUris,
				lessonFile: data?.lessonFile || null,
				lessonName,
				interactions: events.filter((e) => e.interaction),
				studentNameMap,
				seekStep,
				seekTs,
			});
			return true;
		} catch {}
	}
	return false;
}

async function _trySimAutoloadFromUrlParams(loadFromData, seekStep, seekTs) {
	const { lesson, group } = parseToolParams();
	if (!lesson) return false;
	const ds = await loadLessonDataSource({ lesson, group });
	if (!ds) return false;
	await ds.load();
	return _simLoadFromFileMap(
		ds.files,
		ds.rootName || lesson,
		loadFromData,
		seekStep,
		seekTs,
	);
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

	// The engine is ready: apply any log already pushed by the Electron
	// visualizer, and route future pushes straight through.
	_visReady = loadFromData;
	if (_pendingVisData) {
		loadFromData(_pendingVisData);
		_pendingVisData = null;
	}

	const params = parseToolParams();

	let urlAutoloaded = false;
	if (params.lesson) {
		showLoading(true);
		try {
			urlAutoloaded = await _trySimAutoloadFromUrlParams(
				loadFromData,
				params.step,
				params.ts,
			);
		} catch (e) {
			console.warn("[Simulator] URL-param autoload failed:", e);
		}
		showLoading(false);
		if (!urlAutoloaded) landing.style.display = "";
	}

	try {
		if (params.speed != null) vis.setSpeed(params.speed);
		if (!urlAutoloaded && vis.micro.length) {
			if (params.ts != null) vis.seekToTimestamp(params.ts);
			else if (params.step != null) vis.seekToStep(params.step);
		}
		if (params.autoplay && vis.micro.length && !vis.playing) vis.togglePlay();
	} catch (e) {
		console.warn("[Simulator] seek/autoplay failed:", e);
	}

	btnFolder.addEventListener("click", async () => {
		try {
			const dirHandle = await pickFolder();
			const files = [];
			const pathMap = new Map();
			await readDirHandle(dirHandle, "", pathMap, files);
			const loaded = await _simLoadFromFileMap(
				pathMap,
				dirHandle.name,
				loadFromData,
			);
			if (!loaded) alert("No JSON log file with events found.");
		} catch (e) {
			if (e.name !== "AbortError")
				alert("Could not open folder: " + e.message);
		}
	});

	btnOpen.addEventListener("click", async () => {
		try {
			const [fh] = await pickFiles({
				types: [
					{
						description: "Log files",
						accept: { "application/json": [".json", ".log"] },
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
				events,
				error: null,
				lessonFile: json?.lessonFile || null,
				interactions: events.filter((e) => e.interaction),
			});
		} catch (e) {
			if (e.name !== "AbortError") alert("Failed to load log: " + e.message);
		}
	});
});
