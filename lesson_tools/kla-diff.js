"use strict";

const IMAGE_EXT_DIFF = /\.(png|jpe?g|gif|svg|webp|ico|bmp)$/i;

async function openDiffWindow(student) {
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

		let diffMarks = null;
		const diffMarksKey = studentDir + "diff_marks.json";
		const diffMarksEntry = [..._allFiles.entries()].find(
			([p]) => p.toLowerCase() === diffMarksKey,
		);
		if (diffMarksEntry) {
			try {
				diffMarks = JSON.parse(await _diffReadText(diffMarksEntry[1]));
			} catch {}
		}

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
				IMAGE_EXT_DIFF.test(p) &&
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
				teacherMarks: diffMarks ? diffMarks.teacher_files || {} : null,
				studentMarks: diffMarks ? diffMarks.student_files || {} : null,
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
