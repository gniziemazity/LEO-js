"use strict";

function _studentDocFiles(student) {
	if (!student || !student.id) return [];
	const sid = String(student.id).toLowerCase();
	const out = [];
	for (const [key, file] of _allFiles) {
		const m = key.match(/(?:^|\/)anon_ids\/([^/]+)\/(.+\.(docx|pdf))$/i);
		if (m && m[1] === sid) {
			out.push({
				name: m[2].split("/").pop(),
				file,
				ext: m[3].toLowerCase(),
			});
		}
	}
	out.sort(
		(a, b) =>
			(a.ext === "pdf") - (b.ext === "pdf") || a.name.localeCompare(b.name),
	);
	return out;
}

function _appendDocLinks(el, student) {
	for (const d of _studentDocFiles(student)) {
		const a = document.createElement("span");
		a.className = "doc-link";
		a.textContent = d.ext === "pdf" ? "📕" : "📒";
		a.title = "Open " + d.name;
		a.addEventListener("click", (e) => {
			e.stopPropagation();
			_openStudentDocInCode(student, d.name);
		});
		el.appendChild(a);
	}
}
