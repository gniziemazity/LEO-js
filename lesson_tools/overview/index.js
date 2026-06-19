"use strict";

function _sortStudents(list, key) {
	const sl = [...list];
	if (key === "total-follow")
		sl.sort((a, b) => followTotal(b) - followTotal(a));
	else if (key === "artefacts")
		sl.sort((a, b) => artefactsTotal(b) - artefactsTotal(a));
	else
		sl.sort((a, b) => (parseInt(a.id, 10) || 0) - (parseInt(b.id, 10) || 0));
	return sl;
}

function visibleStudents() {
	return _students.filter((s) => !s.ai_flagged && !s.excluded);
}

function onShowCopiersChange(checked) {
	_hideCopiers = !checked;
	try {
		localStorage.setItem("hide_copiers", _hideCopiers ? "1" : "0");
	} catch {}
	if (_students.length) renderStats();
}

(function _initShowCopiers() {
	try {
		const saved = localStorage.getItem("hide_copiers");
		_hideCopiers = saved === null ? true : saved === "1";
		const cb = document.getElementById("show-copiers");
		if (cb) cb.checked = !_hideCopiers;
	} catch {}
})();

function _updateArtefactSortVisibility() {
	const opt = document.getElementById("cluster-sort-artefacts-opt");
	if (opt) opt.hidden = _hideArtefacts;
	if (_hideArtefacts && _clusterSort === "artefacts") {
		_clusterSort = "total-follow";
		const sel = document.getElementById("cluster-sort-select");
		if (sel) sel.value = "total-follow";
	}
}

function onShowArtefactsChange(checked) {
	_hideArtefacts = !checked;
	try {
		localStorage.setItem("hide_artefacts", _hideArtefacts ? "1" : "0");
	} catch {}
	_updateArtefactSortVisibility();
	if (_students.length) renderClusters();
}

(function _initShowArtefacts() {
	try {
		const saved = localStorage.getItem("hide_artefacts");
		_hideArtefacts = saved === null ? true : saved === "1";
		const cb = document.getElementById("show-artefacts");
		if (cb) cb.checked = !_hideArtefacts;
	} catch {}
	_updateArtefactSortVisibility();
})();
const _tookCode = (entry) => (entry?.lesson_obs || "").includes("<");
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
const artefactsTotal = (s) => {
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
	document
		.querySelectorAll("#toolbar .tab-controls")
		.forEach((el) => el.toggleAttribute("hidden", el.dataset.tab !== name));
	if (name === "students") requestAnimationFrame(applyStickyColumns);
	_refreshChartDownloadBtns();
}

function _applyInitialTab() {
	const tab = new URLSearchParams(location.search).get("tab");
	if (!tab) return;
	const want = tab.trim().toLowerCase();
	const btn = [
		...document.querySelectorAll("#toolbar button[data-page]"),
	].find(
		(b) =>
			b.dataset.page === want || b.textContent.trim().toLowerCase() === want,
	);
	if (btn) btn.click();
}

async function _runChartDownload(btn, bodyId, zipName) {
	if (btn.disabled) return;
	btn.disabled = true;
	try {
		await _downloadTabChartsZip(document.getElementById(bodyId), zipName);
	} finally {
		btn.disabled = false;
	}
}
document
	.getElementById("stats-download-btn")
	?.addEventListener("click", (e) =>
		_runChartDownload(e.currentTarget, "stats-body", "statistics-charts.zip"),
	);
document
	.getElementById("progress-download-btn")
	?.addEventListener("click", (e) =>
		_runChartDownload(
			e.currentTarget,
			"clusters-body",
			"progress-charts.zip",
		),
	);

(async function tryAutoLoad() {
	showLoading(true);
	try {
		let served = null;
		try {
			served = await detectServedDataSource();
		} catch (e) {
			console.warn("[overview] served-source detection failed:", e);
		}
		if (served) {
			await served.load();
			await loadCourse(served);
		} else {
			alert(
				"No course data found. Open the overview via `npm run overview` or the app Tools menu.",
			);
		}
	} catch (e) {
		console.error("[overview] load failed:", e);
		alert("Error loading dataset: " + e.message);
	} finally {
		showLoading(false);
		document.documentElement.classList.remove("autoload");
		_applyInitialTab();
	}
})();
