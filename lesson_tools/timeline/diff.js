"use strict";

function openDifferentiatorWindow(student) {
	if (!_lessonName || !student.id) return;
	const title = diffStudentTitle(student.id, student.name, student.follow_pct);
	navigateToDifferentiator({
		lesson: _lessonName,
		id: student.id,
		title,
	});
}
