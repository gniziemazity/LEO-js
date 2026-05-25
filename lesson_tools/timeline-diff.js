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
		student.id +
		"/"
	).toLowerCase();
	const fileMap = new Map(
		[..._allFiles.entries()].map(([p, f]) => [p.toLowerCase(), f]),
	);
	const { teacherFiles, studentFiles, allMarks, imageUris } =
		await buildDiffPayloadData(fileMap, studentDir);

	return {
		teacherFiles,
		studentFiles,
		imageUris,
		allMarks,
		title: `${student.id ? escHtml(student.id) + ". " : ""}${escHtml(student.name)} (${escHtml(followPct)})`,
	};
}

async function openDifferentiatorWindow(student) {
	try {
		const followPct =
			student.follow_pct != null
				? student.follow_pct.toFixed(1) + "%"
				: "N/A";
		await openDifferentiator(() =>
			_buildDiffWindowPayload(student, followPct),
		);
	} catch (err) {
		console.error("[Timeline diff]", err);
		alert("Error opening differentiator: " + err.message);
	}
}
