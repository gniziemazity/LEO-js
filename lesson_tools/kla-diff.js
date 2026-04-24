"use strict";

async function openDiffWindow(student, mode = null) {
	try {
		const followPct =
			student.follow_pct != null
				? student.follow_pct.toFixed(1) + "%"
				: "N/A";

		const studentDir = (
			CFG.STUDENT_SUBDIR +
			"/" +
			student.name +
			"/"
		).toLowerCase();

		const teacherEntries = [..._allFiles.entries()].filter(
			([p]) => /^correct\//i.test(p) && /\.(html|css|js)$/i.test(p),
		);
		const studentEntries = [..._allFiles.entries()].filter(
			([p]) =>
				p.toLowerCase().startsWith(studentDir) &&
				/\.(html|css|js)$/i.test(p),
		);

		const MODE_SUFFIX = {
			"": "",
			leo: "_leo",
			"token-lcs": "_lcs",
			"token-lcs-star": "_lcs_star",
			"line-ro": "_ro",
			"line-ro-star": "_ro_star",
			"line-vscode": "_vscode",
			"line-vscode-star": "_vscode_star",
			"context-first": "_context_first",
		};

		const loadDiffMarks = async (filename) => {
			const key = studentDir + filename;
			const entry = [..._allFiles.entries()].find(
				([p]) => p.toLowerCase() === key,
			);
			let fileObj = entry ? entry[1] : null;
			if (!fileObj && _dirHandle) {
				try {
					const sub = await _dirHandle.getDirectoryHandle(
						CFG.STUDENT_SUBDIR,
					);
					const sdir = await sub.getDirectoryHandle(student.name);
					const fh = await sdir.getFileHandle(filename);
					fileObj = await fh.getFile();
				} catch {}
			}
			if (!fileObj) return null;
			try {
				return JSON.parse(await _diffReadText(fileObj));
			} catch {
				return null;
			}
		};

		const allMarks = {};
		for (const [m, sfx] of Object.entries(MODE_SUFFIX)) {
			const marks = await loadDiffMarks(`diff_marks${sfx}.json`);
			if (marks) allMarks[m] = marks;
		}
		const defaultMarks = allMarks[""] ?? Object.values(allMarks)[0] ?? null;

		const teacherFiles = {};
		for (const [, file] of teacherEntries)
			teacherFiles[file.name] = await _diffReadText(file);

		const studentFiles = {};
		for (const [, file] of studentEntries)
			studentFiles[file.name] = await _diffReadText(file);

		// Collect image data URIs from correct/ and the student dir
		const imageUris = {};
		const imageEntries = [..._allFiles.entries()].filter(
			([p]) =>
				IMAGE_EXT.test(p) &&
				(/^correct\//i.test(p) || p.toLowerCase().startsWith(studentDir)),
		);
		for (const [, file] of imageEntries) {
			if (!imageUris[file.name])
				imageUris[file.name] = await _diffReadDataUri(file);
		}

		const dataKey = "diffData_" + Date.now();
		localStorage.setItem(
			dataKey,
			JSON.stringify({
				teacherFiles,
				studentFiles,
				imageUris,
				teacherMarks: defaultMarks
					? defaultMarks.teacher_files || {}
					: null,
				studentMarks: defaultMarks
					? defaultMarks.student_files || {}
					: null,
				allMarks,
				title: `${escHtml(student.name)} (${escHtml(followPct)})`,
			}),
		);
		window.open(`differentiator.html?key=${dataKey}`, "_blank");
	} catch (err) {
		console.error("[KLA diff]", err);
		alert("Error opening differentiator: " + err.message);
	}
}

function _diffReadText(file) {
	return new Promise((res, rej) => {
		const r = new FileReader();
		r.onload = (e) => res(e.target.result);
		r.onerror = () => rej(new Error("Could not read: " + file.name));
		r.readAsText(file);
	});
}

function _diffReadDataUri(file) {
	return new Promise((res, rej) => {
		const r = new FileReader();
		r.onload = (e) => res(e.target.result);
		r.onerror = () => rej(new Error("Could not read: " + file.name));
		r.readAsDataURL(file);
	});
}
