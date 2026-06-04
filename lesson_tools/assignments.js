"use strict";

let _current = null;
let _viewMode = "instructions";
let _startFiles = [];
let _fileViewer = null;
let _overlay = null;

async function _init() {
	try {
		await window.LanguageProfiles?.initProfiles();
	} catch (e) {
		console.warn("Language profiles failed to load:", e);
	}

	_fileViewer = new FileViewer({
		rootEl: document.getElementById("viewer-root"),
		persistKey: "assignments-fv-pct",
		onActiveFileChange: (name) =>
			AssignmentLoader.showFile(_fileViewer, _startFiles, name),
	});
	_overlay = new StateOverlay({
		emptyEl: document.getElementById("no-assignment"),
		contentEls: {
			viewer: document.getElementById("viewer-root"),
		},
	});

	let names;
	try {
		const served = await detectServedDataSource();
		const asgnGroup =
			served && served.manifest && served.manifest.groups
				? served.manifest.groups.assignments
				: null;
		if (asgnGroup) {
			names = Object.keys(asgnGroup);
		} else {
			const entries = await listServerDir("/assignments/");
			names = entries
				.filter((e) => e.kind === "directory")
				.map((e) => e.name);
		}
	} catch (e) {
		_overlay.showError("Failed to load assignments: " + e.message);
		return;
	}

	const tabsEl = document.getElementById("assignment-tabs");
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

async function _select(name) {
	_current = name;
	_startFiles = [];

	document.querySelectorAll("#assignment-tabs button").forEach((btn) => {
		btn.classList.toggle("active", btn.dataset.name === name);
	});
	document.getElementById("submissions-btn").disabled = false;
	document.getElementById("lesson-btn").disabled = false;

	_overlay.showLoading();
	await _renderForCurrentView();
}

async function _renderForCurrentView() {
	try {
		if (_viewMode === "instructions") {
			_startFiles = await AssignmentLoader.renderInstructions(
				_current,
				_fileViewer,
			);
		} else {
			_startFiles = await AssignmentLoader.renderStart(
				_current,
				_fileViewer,
			);
			if (!_startFiles.length) {
				_overlay.showError("No code files found in start folder.");
				return;
			}
		}
		_overlay.showContent("viewer");
	} catch (e) {
		_overlay.showError(`Could not load: ${e.message}`);
	}
}

function _setViewMode(mode) {
	_viewMode = mode;
	document
		.getElementById("btn-instructions")
		.classList.toggle("active", mode === "instructions");
	document
		.getElementById("btn-start")
		.classList.toggle("active", mode === "start");
	if (_current) {
		_overlay.showLoading();
		_renderForCurrentView();
	}
}

document.getElementById("btn-instructions").addEventListener("click", () => {
	if (_viewMode !== "instructions") _setViewMode("instructions");
});
document.getElementById("btn-start").addEventListener("click", () => {
	if (_viewMode !== "start") _setViewMode("start");
});

document.getElementById("submissions-btn").addEventListener("click", () => {
	if (_current) navigateToStudents({ lesson: _current, group: "assignments" });
});
document.getElementById("lesson-btn").addEventListener("click", () => {
	if (_current) navigateToLessons({ lesson: _current });
});

_init();
