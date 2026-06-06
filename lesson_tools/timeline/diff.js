"use strict";

function openDifferentiatorWindow(student) {
	if (!_lessonName || !student.id) return;
	const followPct =
		student.follow_pct != null ? student.follow_pct.toFixed(1) + "%" : "N/A";
	const title = `${student.id ? student.id + ". " : ""}${student.name} (${followPct})`;
	navigateToDifferentiator({
		lesson: _lessonName,
		id: student.id,
		title,
	});
}
