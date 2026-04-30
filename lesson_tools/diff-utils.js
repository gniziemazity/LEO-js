"use strict";

const DIFF_MARKS_FILES = {
	"": "diff_marks_leo_star.json",
	leo: "diff_marks_leo.json",
	"token-lcs": "diff_marks_lcs.json",
	"token-lcs-star": "diff_marks_lcs_star.json",
	"token-lev": "diff_marks_lev.json",
	"token-lev-star": "diff_marks_lev_star.json",
	"line-ro": "diff_marks_ro.json",
	"line-ro-star": "diff_marks_ro_star.json",
	"line-git": "diff_marks_git.json",
	"line-git-star": "diff_marks_git_star.json",
	truth: "diff_marks_truth.json",
};

if (!window.__diffDataResolvers) window.__diffDataResolvers = new Map();
if (!window.__getDifferentiatorData) {
	window.__getDifferentiatorData = async function (dataKey) {
		const resolver = window.__diffDataResolvers.get(dataKey);
		if (!resolver) return null;
		return await resolver();
	};
}

function _buildDiffPayload(data) {
	const allMarks = data.allMarks ?? {};
	const defaultMode = Object.prototype.hasOwnProperty.call(allMarks, "")
		? ""
		: Object.prototype.hasOwnProperty.call(allMarks, "leo")
			? "leo"
			: (Object.keys(allMarks)[0] ?? null);
	const defaultMarks = defaultMode != null ? allMarks[defaultMode] : null;
	return {
		teacherFiles: data.teacherFiles ?? {},
		studentFiles: data.studentFiles ?? {},
		imageUris: data.imageUris ?? {},
		dataSource: "fresh",
		allMarks,
		mode: defaultMode,
		teacherMarks: defaultMarks?.teacher_files ?? null,
		studentMarks: defaultMarks?.student_files ?? null,
		caseSensitive: defaultMarks?.case_sensitive === true,
		title: data.title,
	};
}

async function openDifferentiator(loader) {
	const buildPayload = async () => _buildDiffPayload(await loader());
	const payload = await buildPayload();
	const dataKey = "diffData_" + Date.now() + "_" + ((Math.random() * 1e6) | 0);
	localStorage.setItem(dataKey, JSON.stringify(payload));
	window.__diffDataResolvers.set(dataKey, buildPayload);
	window.open(`differentiator.html?key=${dataKey}`, "_blank");
}
