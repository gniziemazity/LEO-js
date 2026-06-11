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

function _studentObsVal(student) {
	const r = (student?.remarks || []).find((x) => OBS_COL_RE.test(x.col));
	return r && r.val != null ? String(r.val) : "";
}

function _studentIsScreenshot(student) {
	return /scr/i.test(_studentObsVal(student));
}

function _studentImageFiles(student) {
	if (!student || !student.id) return [];
	const sid = String(student.id).toLowerCase();
	const out = [];
	for (const [key, file] of _allFiles) {
		const m = key.match(/(?:^|\/)anon_ids\/([^/]+)\/(.+)$/i);
		if (m && m[1] === sid && IMAGE_EXT.test(file.name)) {
			out.push({ name: m[2].split("/").pop(), file });
		}
	}
	out.sort((a, b) => a.name.localeCompare(b.name));
	return out;
}

function _studentScreenshotFiles(student) {
	return _studentIsScreenshot(student) ? _studentImageFiles(student) : [];
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
