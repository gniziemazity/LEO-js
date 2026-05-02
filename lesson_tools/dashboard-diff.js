"use strict";

async function _refreshAllFilesFromHandleIfPossible() {
	if (!_dirHandle || typeof readDirHandle !== "function") return;
	const files = [];
	const pathMap = new Map();
	await readDirHandle(_dirHandle, "", pathMap, files);
	_allFiles = pathMap;
}

async function _buildDiffWindowPayload(student, followPct) {
	await _refreshAllFilesFromHandleIfPossible();

	const studentDir = (
		CFG.STUDENT_SUBDIR +
		"/" +
		student.name +
		"/"
	).toLowerCase();

	const recoEntries = [..._allFiles.entries()].filter(
		([p]) => /^reconstructed\//i.test(p) && /\.(html|css|js)$/i.test(p),
	);
	const correctEntries = [..._allFiles.entries()].filter(
		([p]) => /^correct\//i.test(p) && /\.(html|css|js)$/i.test(p),
	);
	const teacherEntries = recoEntries.length ? recoEntries : correctEntries;
	const studentEntries = [..._allFiles.entries()].filter(
		([p]) =>
			p.toLowerCase().startsWith(studentDir) && /\.(html|css|js)$/i.test(p),
	);

	const loadDiffMarks = async (filename) => {
		const key = studentDir + filename;
		const entry = [..._allFiles.entries()].find(
			([p]) => p.toLowerCase() === key,
		);
		let fileObj = entry ? entry[1] : null;
		if (!fileObj && _dirHandle) {
			try {
				const sub = await _dirHandle.getDirectoryHandle(CFG.STUDENT_SUBDIR);
				const sdir = await sub.getDirectoryHandle(student.name);
				const fh = await sdir.getFileHandle(filename);
				fileObj = await fh.getFile();
			} catch {}
		}
		if (!fileObj) return null;
		try {
			return JSON.parse(await readFileText(fileObj));
		} catch {
			return null;
		}
	};

	const allMarks = {};
	for (const [m, fname] of Object.entries(DIFF_MARKS_FILES)) {
		const marks = await loadDiffMarks(fname);
		if (marks) allMarks[m] = marks;
	}
	const defaultMode = defaultDiffModeKey(allMarks);
	const defaultMarks = defaultMode != null ? allMarks[defaultMode] : null;

	const teacherFiles = {};
	for (const [, file] of teacherEntries) {
		teacherFiles[file.name] = await readFileText(file);
	}

	const studentFiles = {};
	for (const [, file] of studentEntries) {
		studentFiles[file.name] = await readFileText(file);
	}

	const imageUris = {};
	const imageEntries = [..._allFiles.entries()].filter(
		([p]) =>
			IMAGE_EXT.test(p) &&
			(/^correct\//i.test(p) || p.toLowerCase().startsWith(studentDir)),
	);
	for (const [, file] of imageEntries) {
		if (!imageUris[file.name])
			imageUris[file.name] = await readFileDataUri(file);
	}

	return {
		teacherFiles,
		studentFiles,
		imageUris,
		mode: defaultMode,
		teacherMarks: defaultMarks ? defaultMarks.teacher_files || {} : null,
		studentMarks: defaultMarks ? defaultMarks.student_files || {} : null,
		allMarks,
		title: `${escHtml(student.name)} (${escHtml(followPct)})`,
	};
}

async function openDiffWindow(student, mode = null) {
	try {
		const followPct =
			student.follow_pct != null
				? student.follow_pct.toFixed(1) + "%"
				: "N/A";
		const payloadBuilder = async () =>
			await _buildDiffWindowPayload(student, followPct);
		const payload = await payloadBuilder();
		const dataKey = "diffData_" + Date.now();
		window.__diffDataResolvers.set(dataKey, payloadBuilder);
		try {
			localStorage.setItem(dataKey, JSON.stringify(payload));
		} catch (e) {
			console.warn("[KLA diff] localStorage handoff skipped:", e);
		}
		window.open(`differentiator.html?key=${dataKey}`, "_blank");
	} catch (err) {
		console.error("[KLA diff]", err);
		alert("Error opening differentiator: " + err.message);
	}
}
