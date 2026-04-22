"use strict";

const DIFF_MARKS_FILES = {
	"": "diff_marks.json",
	contextual: "diff_marks_contextual.json",
	"token-lcs": "diff_marks_lcs.json",
	"token-lcs-star": "diff_marks_lcs_star.json",
	"line-myers": "diff_marks_myers.json",
};

function openDifferentiator(
	teacherFiles,
	studentFiles,
	allMarks,
	imageUris,
	title,
) {
	const defaultMarks = allMarks[""] ?? Object.values(allMarks)[0] ?? null;
	const dataKey = "diffData_" + Date.now() + "_" + ((Math.random() * 1e6) | 0);
	localStorage.setItem(
		dataKey,
		JSON.stringify({
			teacherFiles,
			studentFiles,
			imageUris: imageUris ?? {},
			allMarks,
			teacherMarks: defaultMarks?.teacher_files ?? null,
			studentMarks: defaultMarks?.student_files ?? null,
			caseSensitive: defaultMarks?.case_sensitive === true,
			title,
		}),
	);
	window.open(`differentiator.html?key=${dataKey}`, "_blank");
}
