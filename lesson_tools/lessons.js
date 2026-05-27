"use strict";

let _current = null;

async function _init() {
	let names;
	try {
		const entries = await listServerDir("/lessons/");
		names = entries.filter((e) => e.kind === "directory").map((e) => e.name);
	} catch (e) {
		document.getElementById("no-lesson").textContent =
			"Failed to load lessons: " + e.message;
		return;
	}

	const tabsEl = document.getElementById("lesson-tabs");
	for (const name of names) {
		const btn = document.createElement("button");
		btn.textContent = name;
		btn.dataset.name = name;
		btn.addEventListener("click", () => _select(name));
		tabsEl.appendChild(btn);
	}

	const params = new URLSearchParams(location.search);
	const preselect = params.get("lesson");
	const toSelect =
		names.find((n) => n.toLowerCase() === (preselect || "").toLowerCase()) ||
		names[0];
	if (toSelect) _select(toSelect);
}

function _select(name) {
	_current = name;

	document.querySelectorAll("#lesson-tabs button").forEach((btn) => {
		btn.classList.toggle("active", btn.dataset.name === name);
	});
	document.getElementById("timeline-btn").disabled = false;
	document.getElementById("students-btn").disabled = false;
	document.getElementById("assignment-btn").disabled = false;

	const iframe = document.getElementById("preview-frame");
	iframe.src = buildToolUrl("simulator.html", {
		lesson: name,
		group: "lessons",
	});
	iframe.style.display = "";
	document.getElementById("no-lesson").style.display = "none";
}

document.getElementById("timeline-btn").addEventListener("click", () => {
	if (_current) navigateToTimeline({ lesson: _current, group: "lessons" });
});
document.getElementById("students-btn").addEventListener("click", () => {
	if (_current) navigateToStudents({ lesson: _current, group: "lessons" });
});
document.getElementById("assignment-btn").addEventListener("click", () => {
	if (_current) navigateToAssignments({ lesson: _current });
});
document.getElementById("download-plans-btn").addEventListener("click", () => {
	const a = document.createElement("a");
	a.href = "/plans.zip";
	a.download = "plans.zip";
	document.body.appendChild(a);
	a.click();
	a.remove();
});

_init();
