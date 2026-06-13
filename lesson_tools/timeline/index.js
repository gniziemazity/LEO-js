"use strict";

let _pendingXlsx = [];
let _allFiles = new Map();
let _dirHandle = null;
let _lessonName = null;
let _lessonGroup = "lessons";
let _studentIdMap = {};
let _realToAlterMap = {};
let _studentNameMap = {};

const landingEl = document.getElementById("landing");

async function openFilePicker() {
	try {
		const handles = await pickFilesWithMemory({ multiple: true });
		if (!handles.length) return;
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
		const ds = new FsDataSource();
		await ds.open();
		await _loadTimelineFromDataSource(ds);
	} catch (e) {
		if (e.name !== "AbortError") alert("Could not open folder: " + e.message);
	}
}

function handleFiles(files) {
	const isRootLevel = (f) => {
		const p = _filePathFor(f);
		return !p || !p.includes("/");
	};
	const jsonFiles = files.filter((f) => {
		const n = f.name.toLowerCase();
		return (
			(n.endsWith(".log") ||
				(n.endsWith(".json") && !n.startsWith("diff_marks"))) &&
			isRootLevel(f)
		);
	});
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
	loadStudentMaps(studentsCsvFile, nameMapFile);
	loadBestJsonFile(jsonFiles);
}

async function loadStudentMaps(studentsCsvFile, nameMapFile) {
	_realToAlterMap = {};
	_studentNameMap = {};
	try {
		if (nameMapFile) {
			const text = await nameMapFile.text();
			_studentNameMap = parseStudentIdNameMap(text);
			_realToAlterMap = parseAlterEgoMap(text);
		}
		if (studentsCsvFile) {
			const text = await studentsCsvFile.text();
			const nameMap = parseStudentIdNameMap(text);
			if (Object.keys(nameMap).length) _studentNameMap = nameMap;
			const realToAlter = parseAlterEgoMap(text);
			if (Object.keys(realToAlter).length) _realToAlterMap = realToAlter;
		}
		if (_p) scheduleRender();
	} catch {
		_realToAlterMap = {};
		_studentNameMap = {};
	}
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
			`[Timeline] Expected exactly one log file, found ${jsonFiles.length}:\n  ${paths}`,
		);
		alert(
			`Expected exactly one log file in the folder, found ${jsonFiles.length}:\n${paths}`,
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
			console.error(`[Timeline] ${path} has no events`);
			alert(`${path} has no events.`);
			showLoading(false);
			return;
		}
		console.log(
			`[Timeline] Loading log from ${path} ` +
				`(${events.length} events, sessionStart=${
					events[0]?.timestamp
						? new Date(events[0].timestamp).toISOString()
						: "?"
				})`,
		);
		await loadJsonData(file, data);
	} catch (e) {
		console.error(`[Timeline] failed to load ${path}: ${e.message}`);
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
	document.title = _lessonName ? `Timeline: ${_lessonName}` : "Timeline";
	_zoomMin = _zoomMax = null;
	_studentIdMap = {};
	if (window.LanguageProfiles) {
		try {
			await window.LanguageProfiles.initProfiles();
		} catch (e) {
			console.warn("[Timeline] LanguageProfiles.initProfiles failed:", e);
		}
	}
	const p = processData(data);
	if (!p) {
		showLoading(false);
		return;
	}
	_p = p;
	await _loadTeacherTokens();
	try {
		localStorage.setItem(
			"timeline_sim_data",
			JSON.stringify({
				filePath: file.name,
				lessonFile: data.lessonFile || null,
				lessonName: _lessonName || null,
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
					"timeline_sim_images",
					JSON.stringify(imageUris),
				);
			else localStorage.removeItem("timeline_sim_images");
		} catch {}
	} else {
		localStorage.removeItem("timeline_sim_images");
	}
	landingEl.style.display = "none";
	document.getElementById("main").style.display = "flex";

	if (_pendingXlsx.length) {
		await loadXlsxFiles(_pendingXlsx);
		_pendingXlsx = [];
	}
	scheduleRender();
	saveLessonStatsCsv();
}

const _TOKEN_RE = newTokenRegex();

function _findHtmlEmbeddedRanges(text) {
	const result = { script: [], style: [] };
	for (const tag of ["script", "style"]) {
		const openRe = new RegExp(`<\\s*${tag}\\b[^>]*>`, "gi");
		let om;
		while ((om = openRe.exec(text)) !== null) {
			const innerStart = om.index + om[0].length;
			const closeRe = new RegExp(`<\\/\\s*${tag}\\s*>`, "i");
			const sub = text.slice(innerStart);
			const cm = sub.match(closeRe);
			let innerEnd, nextPos;
			if (cm) {
				innerEnd = innerStart + cm.index;
				nextPos = innerEnd + cm[0].length;
			} else {
				innerEnd = text.length;
				nextPos = text.length;
			}
			result[tag].push([innerStart, innerEnd]);
			openRe.lastIndex = nextPos;
		}
	}
	return result;
}

function _bucketForPos(pos, ranges, defaultBucket) {
	for (const [lo, hi] of ranges.script) {
		if (pos >= lo && pos < hi) return "js";
	}
	for (const [lo, hi] of ranges.style) {
		if (pos >= lo && pos < hi) return "css";
	}
	return defaultBucket;
}

async function loadTeacherCodeTokens() {
	const empty = { total: 0, html: 0, css: 0, js: 0, py: 0 };
	if (!_allFiles || !_allFiles.size) return empty;

	let codeFiles = [];
	for (const dir of ["reconstructed/", "start/", "correct/"]) {
		for (const [path, file] of _allFiles) {
			const pl = path.toLowerCase();
			if (!pl.startsWith(dir)) continue;
			const bucket = langShortId(path, null);
			if (bucket) codeFiles.push({ path, file, bucket });
		}
		if (codeFiles.length) break;
	}
	if (!codeFiles.length) {
		console.warn(
			"[Timeline] no code files in reconstructed/, start/ or correct/; token counts will be 0",
		);
		return empty;
	}

	const out = { total: 0, html: 0, css: 0, js: 0, py: 0 };
	for (const { file, bucket } of codeFiles) {
		try {
			const text = await file.text();
			if (bucket === "html") {
				const ranges = _findHtmlEmbeddedRanges(text);
				for (const m of text.matchAll(_TOKEN_RE)) {
					const b = _bucketForPos(m.index, ranges, "html");
					out[b]++;
					out.total++;
				}
			} else {
				const matches = text.match(_TOKEN_RE) || [];
				out[bucket] += matches.length;
				out.total += matches.length;
			}
		} catch {}
	}
	return out;
}

async function saveLessonStatsCsv() {
	if (!_p) return;
	if (!_dirHandle) {
		console.warn(
			"[Timeline] saveLessonStatsCsv: _dirHandle is null (file picker was used, not folder); CSV not written",
		);
		return;
	}
	try {
		const perm = await _dirHandle.queryPermission({ mode: "readwrite" });
		let granted = perm === "granted";
		if (!granted) {
			const req = await _dirHandle.requestPermission({ mode: "readwrite" });
			granted = req === "granted";
		}
		if (!granted) {
			console.warn(
				"[Timeline] readwrite permission not granted; skipping lesson_stats.csv save",
			);
			return;
		}
		const tokens = await loadTeacherCodeTokens();
		const csv = buildLessonStatsCsv(_p, tokens);
		const fileHandle = await _dirHandle.getFileHandle("lesson_stats.csv", {
			create: true,
		});
		const writable = await fileHandle.createWritable();
		await writable.write(csv);
		await writable.close();
		console.log(`[Timeline] wrote lesson_stats.csv (${csv.length} bytes)`);
	} catch (e) {
		console.warn(
			"[Timeline] could not save lesson_stats.csv:",
			e?.message || e,
		);
	}
}

async function _loadTimelineFromDataSource(ds) {
	_dirHandle = ds.rootHandle;
	_lessonName = ds.rootName;
	if (ds.rootHandle) {
		try {
			await _idbSet(IDB_KEY_LESSON_ROOT, ds.rootHandle);
		} catch {}
	}
	showLoading(true);
	const files = await ds.load();
	_allFiles = ds.files;
	handleFiles(files);
}

async function _tryAutoLoadTimeline() {
	const handle = await loadSavedDirHandle();
	if (!handle) return false;
	const ds = new FsDataSource();
	ds.rootHandle = handle;
	ds.rootName = handle.name;
	await _loadTimelineFromDataSource(ds);
	return true;
}

async function _tryLoadTimelineFromUrlParams() {
	const { lesson, group } = parseToolParams();
	if (!lesson) return false;
	if (group) _lessonGroup = group;
	const ds = await loadLessonDataSource({ lesson, group });
	if (!ds) return false;
	await _loadTimelineFromDataSource(ds);
	return true;
}

(async function () {
	const qs = new URLSearchParams(location.search);
	const bm = qs.get("barmode");
	if (bm === "0" || bm === "1") _bottomChartVisible.barMode = bm === "1";
	_emphasisStartHms = qs.get("start");
	_emphasisEndHms = qs.get("end");
	if (qs.get("interactions") === "1") {
		_topChartVisible.interactions = true;
		const ic = document.getElementById("leg-interactions");
		if (ic) ic.checked = true;
	}
	if (qs.get("midchart") === "0") {
		_midChartHidden = true;
		const sec = document.getElementById("chart-middle-section");
		if (sec) sec.style.display = "none";
	}
	const params = parseToolParams();
	const wantsAutoload = qs.get("autoload") === "1" || params.lesson != null;
	if (!wantsAutoload) {
		document.documentElement.classList.remove("autoload");
		return;
	}
	document.documentElement.classList.add("autoload");
	await waitForXlsxBundle();
	let ok = false;
	if (params.lesson) {
		try {
			ok = await _tryLoadTimelineFromUrlParams();
		} catch (e) {
			console.warn("[Timeline] URL-param load failed:", e);
		}
	}
	if (!ok) ok = await _tryAutoLoadTimeline();
	if (!ok) {
		showLoading(false);
		document.documentElement.classList.remove("autoload");
		const btn = document.createElement("button");
		btn.className = "landing-btn";
		btn.textContent = "🔄 Load Lesson";
		btn.onclick = async () => {
			btn.disabled = true;
			await _tryAutoLoadTimeline();
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

(function _wireStudentsButton() {
	const btn = document.getElementById("btn-students");
	if (!btn) return;
	btn.addEventListener("click", () => {
		if (_lessonName) {
			navigateToStudents({ lesson: _lessonName, group: _lessonGroup });
		} else {
			window.open("students.html?autoload=1", "_blank");
		}
	});
})();

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
		console.warn("[Timeline] tokens.txt not found in project");
		return;
	}
	candidates.sort((a, b) => a.rank - b.rank);
	const entry = candidates[0].file;
	try {
		const text = await entry.text();
		const sessionDate = new Date(_p.sessionStart * 1000);
		_teacherTokens = _parseTeacherTokensTxt(text, sessionDate);
		console.log(
			`[Timeline] loaded ${_teacherTokens.length} teacher tokens from ${candidates[0].path}`,
		);
	} catch (e) {
		console.warn("[Timeline] failed to load tokens.txt:", e?.message);
	}
}
