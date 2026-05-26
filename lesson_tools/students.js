"use strict";

lessonNameEl.title = "Open timeline for this lesson";
lessonNameEl.addEventListener("click", () => {
	if (!_lessonName) return;
	navigateToTimeline({ lesson: _lessonName });
});

(function () {
	const qs = new URLSearchParams(location.search);
	const anon = qs.get("anon") || "";
	if (anon && ["name", "id"].includes(anon)) {
		_anonMode = anon;
		anonSelectEl.value = anon;
	}
})();

(async function () {
	const qs = new URLSearchParams(location.search);
	const params = parseToolParams();
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
	if (!ok) {
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
