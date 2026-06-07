"use strict";

function _sortStudents(list, key) {
	const sl = [...list];
	if (key === "avg-follow") sl.sort((a, b) => followAvg(b) - followAvg(a));
	else if (key === "total-follow")
		sl.sort((a, b) => followTotal(b) - followTotal(a));
	else if (key === "signals")
		sl.sort((a, b) => signalsTotal(b) - signalsTotal(a));
	else
		sl.sort((a, b) => (parseInt(a.id, 10) || 0) - (parseInt(b.id, 10) || 0));
	return sl;
}

function visibleStudents() {
	return _students.filter(
		(s) => !s.ai_flagged && (!_hideExcluded || !s.excluded),
	);
}

function onHideExcludedChange(checked) {
	_hideExcluded = !!checked;
	try {
		localStorage.setItem("hide_excluded", _hideExcluded ? "1" : "0");
	} catch {}
	if (_students.length) {
		renderTable();
		renderStats();
		renderClusters();
	}
}

(function _initHideExcluded() {
	try {
		const saved = localStorage.getItem("hide_excluded");
		if (saved === "1") {
			_hideExcluded = true;
			const cb = document.getElementById("hide-excluded");
			if (cb) cb.checked = true;
		}
	} catch {}
})();
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
const signalsTotal = (s) => {
	let n = 0;
	for (const a of ASSIGNMENTS) {
		const code = (s.lessons[a.n - 1]?.obs || "").trim();
		if (!isArtefactPattern(code)) continue;
		for (const ch of code) if (ch === "1") n++;
	}
	return n;
};
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
	let served = null;
	try {
		served = await detectServedDataSource();
	} catch (e) {
		console.warn("[overview] served-source detection failed:", e);
	}
	if (served) {
		try {
			await served.load();
			await loadCourse(served);
		} catch (e) {
			console.error("[overview] web-mode load failed:", e);
			alert("Error loading served dataset: " + e.message);
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
