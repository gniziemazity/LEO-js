"use strict";

lessonNameEl.title = "Open timeline for this lesson";
lessonNameEl.addEventListener("click", async () => {
	if (!_dirHandle) return;
	try {
		const perm = await _dirHandle.requestPermission({ mode: "read" });
		if (perm !== "granted") {
			alert("Permission denied for the lesson folder.");
			return;
		}
		await _idbSet("lastDir", _dirHandle);
		window.open("timeline.html?autoload=1", "_blank");
	} catch (e) {
		alert("Could not open timeline: " + e.message);
	}
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
	if (qs.get("autoload") !== "1") return;
	await waitForXlsxBundle();
	const ok = await _tryAutoLoad();
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
