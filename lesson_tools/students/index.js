"use strict";

(async function () {
	try {
		await window.LanguageProfiles?.initProfiles();
	} catch (_e) {}
})();

lessonNameEl.title = "Open timeline for this lesson";
lessonNameEl.addEventListener("click", () => {
	if (!_lessonName) return;
	navigateToTimeline({ lesson: _lessonName });
});

(function () {
	const qs = new URLSearchParams(location.search);
	const params = parseToolParams();
	_paperMode =
		qs.get("paper") === "1" ||
		(params.ids && params.ids.length > 0) ||
		(params.star && params.star.length > 0);
	const m = qs.get("mode") || "";
	_modeParam = m === "lesson" || m === "assignment" ? m : null;
	if (_paperMode) {
		document.body.classList.add("paper-mode");
		for (const id of [
			"basis-picker",
			"columns-picker",
			"assignment-toggle",
		]) {
			const el = document.getElementById(id);
			if (el) el.style.display = "none";
		}
		return;
	}
	let hasSaved = false;
	try {
		hasSaved = localStorage.getItem("students.hiddenCols") != null;
	} catch (_e) {}
	if (hasSaved) return;
	const anon = qs.get("anon") || "";
	if (anon === "name") {
		_hiddenCols.add("num");
	} else if (anon === "id") {
		_hiddenCols.add("num");
		_hiddenCols.add("name");
	}
})();

(async function () {
	const qs = new URLSearchParams(location.search);
	const params = parseToolParams();
	if (params.ids && params.ids.length) _highlightIds = new Set(params.ids);
	if (params.star && params.star.length) _starIds = new Set(params.star);
	const wantsAutoload = qs.get("autoload") === "1" || params.lesson != null;
	if (!wantsAutoload) return;
	await waitForXlsxBundle();
	let ok = false;
	if (params.lesson) {
		try {
			ok = await _tryLoadFromUrlParams();
		} catch (e) {
			console.warn("[Students] URL-param load failed:", e);
		}
	}
	if (!ok) ok = await _tryAutoLoad();
	const _autoSid =
		params.star && params.star.length === 1
			? String(params.star[0])
			: params.ids && params.ids.length === 1
				? String(params.ids[0])
				: null;
	if (ok && _autoSid) {
		const sid = _autoSid;
		const stu = (_students || []).find((s) => String(s.id) === sid);
		if (stu) {
			const rows = document.querySelectorAll("#tbody tr");
			rows.forEach((r) => r.classList.remove("selected"));
			for (const r of rows) {
				if (r._student && String(r._student.id) === sid) {
					r.classList.add("selected");
					break;
				}
			}
			selectStudentInline(stu);
		}
	}
	if (!ok) {
		showLoading(false);
		landingEl.style.display = "";
		const btn = document.createElement("button");
		btn.className = "landing-btn";
		btn.textContent = "🔄 Load Students";
		btn.onclick = async () => {
			btn.disabled = true;
			await _tryAutoLoad();
			btn.disabled = false;
		};
		document.getElementById("landing-buttons").prepend(btn);
	}
})();
