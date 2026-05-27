"use strict";

let _current = null;
let _viewMode = "instructions";
let _startFiles = [];
let _fileViewer = null;

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

	let names;
	try {
		const entries = await listServerDir("/assignments/");
		names = entries.filter((e) => e.kind === "directory").map((e) => e.name);
	} catch (e) {
		document.getElementById("no-assignment").textContent =
			"Failed to load assignments: " + e.message;
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

	_showLoading();
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
				_showError("No code files found in start folder.");
				return;
			}
		}
		_showContent();
	} catch (e) {
		_showError(`Could not load: ${e.message}`);
	}
}

function _showLoading() {
	document.getElementById("viewer-root").style.display = "none";
	const noMsg = document.getElementById("no-assignment");
	noMsg.style.display = "flex";
	noMsg.textContent = "Loading…";
}

function _showContent() {
	document.getElementById("viewer-root").style.display = "flex";
	document.getElementById("no-assignment").style.display = "none";
}

function _showError(msg) {
	document.getElementById("no-assignment").textContent = msg;
	document.getElementById("no-assignment").style.display = "flex";
	document.getElementById("viewer-root").style.display = "none";
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
		_showLoading();
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
