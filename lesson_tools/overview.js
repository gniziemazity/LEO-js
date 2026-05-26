"use strict";

function _sortStudents(list, key) {
	const sl = [...list];
	if (key === "avg-follow") sl.sort((a, b) => followAvg(b) - followAvg(a));
	else if (key === "total-follow")
		sl.sort((a, b) => followTotal(b) - followTotal(a));
	else if (key === "avg-grade")
		sl.sort((a, b) => (b.avg_assignments ?? -1) - (a.avg_assignments ?? -1));
	else if (key === "total-grade")
		sl.sort((a, b) => gradeTotal(b) - gradeTotal(a));
	else if (key === "ai-count") sl.sort((a, b) => aiCount(a) - aiCount(b));
	else sl.sort((a, b) => a.name.localeCompare(b.name));
	return sl;
}

function sortedStudents() {
	return _sortStudents(_students, _curSort);
}
const followAvg = (s) => {
	const vs = s.lessons
		.filter((l) => l.hasFollowCol && l.follow != null)
		.map((l) => l.follow);
	return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : -1;
};
const followTotal = (s) =>
	s.lessons
		.filter((l) => l.hasFollowCol && l.follow != null)
		.reduce((a, l) => a + l.follow, 0);
const gradeTotal = (s) =>
	s.lessons.filter((l) => l.grade != null).reduce((a, l) => a + l.grade, 0);
const aiCount = (s) =>
	s.lessons.reduce(
		(n, l) => n + ((l.obs || "").match(/\bAI\b/gi)?.length || 0),
		0,
	);

document.querySelectorAll(".sort-bar button[data-sort]").forEach((btn) => {
	btn.addEventListener("click", () => {
		_curSort = btn.dataset.sort;
		document
			.querySelectorAll(".sort-bar button[data-sort]")
			.forEach((b) => b.classList.toggle("active", b === btn));
		renderProgress();
	});
});

function mkCard(page, title, size = "sm") {
	const card = el("div", `stat-card ${size}`);
	const h = el("h3");
	h.textContent = title;
	card.appendChild(h);
	page.appendChild(card);
	return card;
}
function el(tag, cls = "") {
	const e = document.createElement(tag);
	if (cls) e.className = cls;
	return e;
}

document.querySelectorAll("#toolbar button[data-page]").forEach((btn) => {
	btn.addEventListener("click", () => {
		document
			.querySelectorAll("#toolbar button[data-page]")
			.forEach((b) => b.classList.toggle("active", b === btn));
		showPage(btn.dataset.page);
	});
});
function showPage(name) {
	document
		.querySelectorAll(".page")
		.forEach((p) => p.classList.remove("active"));
	document.getElementById("page-" + name).classList.add("active");
	if (name === "students") requestAnimationFrame(applyStickyColumns);
}

document.getElementById("open-btn").addEventListener("click", pickFolder);
document
	.getElementById("open-btn-toolbar")
	?.addEventListener("click", pickFolder);

(async function tryAutoLoad() {
	showLoading(true);
	let httpDs = null;
	try {
		httpDs = await detectDataSource();
	} catch (e) {
		console.warn("[overview] manifest detection failed:", e);
	}
	if (httpDs) {
		try {
			await httpDs.open();
			await loadCourse(httpDs);
		} catch (e) {
			console.error("[overview] web-mode load failed:", e);
			alert("Error loading from manifest: " + e.message);
		}
		showLoading(false);
		return;
	}
	const handle = await loadSavedDirHandle("lastCourseDir", "grades-dash");
	if (!handle) {
		showLoading(false);
		return;
	}
	try {
		const ds = new FsDataSource({
			idbKey: "lastCourseDir",
			dbName: "grades-dash",
		});
		ds.rootHandle = handle;
		ds.rootName = handle.name;
		await _idbSet(IDB_KEY_COURSE_ROOT, handle);
		await ds.load();
		await loadCourse(ds);
	} catch (e) {
		if (e.name !== "AbortError") alert("Error: " + e.message);
	}
	showLoading(false);
})();
