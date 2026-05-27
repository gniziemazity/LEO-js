"use strict";

let _topic = null;
let _mode = "lessons";
let _viewMode = "instructions";
let _fileViewer = null;
let _startFiles = [];
let _topics = [];

async function _loadTopics() {
	try {
		const resp = await fetch("/manifest.json");
		if (resp.ok) {
			const m = await resp.json();
			const lessons = Object.keys((m.groups && m.groups.lessons) || {});
			const assignments = Object.keys(
				(m.groups && m.groups.assignments) || {},
			);
			return _mergeTopics(lessons, assignments);
		}
	} catch {}
	const [lessonEntries, assignmentEntries] = await Promise.all([
		_safeListDir("/lessons/"),
		_safeListDir("/assignments/"),
	]);
	const lessons = lessonEntries
		.filter((e) => e.kind === "directory")
		.map((e) => e.name);
	const assignments = assignmentEntries
		.filter((e) => e.kind === "directory")
		.map((e) => e.name);
	return _mergeTopics(lessons, assignments);
}

async function _safeListDir(path) {
	try {
		return await listServerDir(path);
	} catch {
		return [];
	}
}

function _mergeTopics(lessons, assignments) {
	const map = new Map();
	for (const n of lessons) {
		map.set(n.toLowerCase(), {
			name: n,
			hasLesson: true,
			hasAssignment: false,
		});
	}
	for (const n of assignments) {
		const k = n.toLowerCase();
		const prev = map.get(k);
		if (prev) prev.hasAssignment = true;
		else map.set(k, { name: n, hasLesson: false, hasAssignment: true });
	}
	return [...map.values()].sort((a, b) =>
		a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
	);
}

async function _init() {
	try {
		await window.LanguageProfiles?.initProfiles();
	} catch (e) {
		console.warn("Language profiles failed to load:", e);
	}

	_fileViewer = new FileViewer({
		rootEl: document.getElementById("viewer-root"),
		persistKey: "course-fv-pct",
		onActiveFileChange: (name) =>
			AssignmentLoader.showFile(_fileViewer, _startFiles, name),
	});

	_topics = await _loadTopics();
	const selectEl = document.getElementById("topic-select");
	selectEl.innerHTML = "";
	for (const t of _topics) {
		const opt = document.createElement("option");
		opt.value = t.name;
		opt.textContent = t.name;
		selectEl.appendChild(opt);
	}
	if (!_topics.length) {
		document.getElementById("no-selection").textContent =
			"No lessons or assignments found.";
		return;
	}

	const params = new URLSearchParams(location.search);
	const preselect = (params.get("lesson") || "").toLowerCase();
	const preselectMode = params.get("mode") || params.get("group");
	const startTopic =
		_topics.find((t) => t.name.toLowerCase() === preselect) || _topics[0];
	if (preselectMode === "assignments" || preselectMode === "assignment") {
		_mode = "assignments";
	} else if (preselectMode === "lessons" || preselectMode === "lesson") {
		_mode = "lessons";
	}
	selectEl.value = startTopic.name;
	_updateModeButtons();
	_renderModePanels();
	_select(startTopic.name);
}

function _currentTopic() {
	return _topics.find((t) => t.name === _topic);
}

function _updateModeButtons() {
	const btnL = document.getElementById("btn-mode-lesson");
	const btnA = document.getElementById("btn-mode-assignment");
	btnL.classList.toggle("active", _mode === "lessons");
	btnA.classList.toggle("active", _mode === "assignments");
	const t = _currentTopic();
	btnL.disabled = t ? !t.hasLesson : false;
	btnA.disabled = t ? !t.hasAssignment : false;
}

function _renderModePanels() {
	document.getElementById("lesson-controls").style.display =
		_mode === "lessons" ? "flex" : "none";
	document.getElementById("assignment-controls").style.display =
		_mode === "assignments" ? "flex" : "none";
}

async function _select(name) {
	_topic = name;
	_startFiles = [];
	const t = _currentTopic();
	if (!t) return;

	if (_mode === "lessons" && !t.hasLesson && t.hasAssignment) {
		_mode = "assignments";
		_renderModePanels();
	} else if (_mode === "assignments" && !t.hasAssignment && t.hasLesson) {
		_mode = "lessons";
		_renderModePanels();
	}
	_updateModeButtons();

	if (_mode === "lessons") {
		await _showLesson(name);
	} else {
		await _showAssignment(name);
	}
}

async function _showLesson(name) {
	document.getElementById("viewer-root").style.display = "none";
	document.getElementById("no-selection").style.display = "none";
	const frame = document.getElementById("lesson-frame");
	frame.style.display = "block";
	frame.src = buildToolUrl("simulator.html", {
		lesson: name,
		group: "lessons",
	});
	document.getElementById("timeline-btn").disabled = false;
	document.getElementById("students-btn-lesson").disabled = false;
}

async function _showAssignment(name) {
	const frame = document.getElementById("lesson-frame");
	frame.style.display = "none";
	frame.removeAttribute("src");
	document.getElementById("submissions-btn").disabled = false;
	_showAssignmentLoading();
	await _renderAssignmentView(name);
}

async function _renderAssignmentView(name) {
	try {
		if (_viewMode === "instructions") {
			_startFiles = await AssignmentLoader.renderInstructions(
				name,
				_fileViewer,
			);
		} else {
			_startFiles = await AssignmentLoader.renderStart(name, _fileViewer);
			if (!_startFiles.length) {
				_showError("No code files found in start folder.");
				return;
			}
		}
		document.getElementById("viewer-root").style.display = "flex";
		document.getElementById("no-selection").style.display = "none";
	} catch (e) {
		_showError(`Could not load: ${e.message}`);
	}
}

function _showAssignmentLoading() {
	document.getElementById("viewer-root").style.display = "none";
	const noMsg = document.getElementById("no-selection");
	noMsg.style.display = "flex";
	noMsg.textContent = "Loading…";
}

function _showError(msg) {
	document.getElementById("viewer-root").style.display = "none";
	document.getElementById("lesson-frame").style.display = "none";
	const noMsg = document.getElementById("no-selection");
	noMsg.textContent = msg;
	noMsg.style.display = "flex";
}

function _setMode(mode) {
	if (_mode === mode) return;
	_mode = mode;
	_renderModePanels();
	_updateModeButtons();
	if (_topic) _select(_topic);
}

function _setViewMode(view) {
	if (_viewMode === view) return;
	_viewMode = view;
	document
		.getElementById("btn-instructions")
		.classList.toggle("active", view === "instructions");
	document
		.getElementById("btn-start")
		.classList.toggle("active", view === "start");
	if (_topic && _mode === "assignments") {
		_showAssignmentLoading();
		_renderAssignmentView(_topic);
	}
}

document.getElementById("topic-select").addEventListener("change", (e) => {
	_select(e.target.value);
});

document.getElementById("btn-mode-lesson").addEventListener("click", () => {
	_setMode("lessons");
});
document.getElementById("btn-mode-assignment").addEventListener("click", () => {
	_setMode("assignments");
});

document.getElementById("btn-instructions").addEventListener("click", () => {
	_setViewMode("instructions");
});
document.getElementById("btn-start").addEventListener("click", () => {
	_setViewMode("start");
});

document.getElementById("timeline-btn").addEventListener("click", () => {
	if (_topic) navigateToTimeline({ lesson: _topic, group: "lessons" });
});
document.getElementById("students-btn-lesson").addEventListener("click", () => {
	if (_topic) navigateToStudents({ lesson: _topic, group: "lessons" });
});
document.getElementById("download-plans-btn").addEventListener("click", () => {
	const a = document.createElement("a");
	a.href = "/plans.zip";
	a.download = "plans.zip";
	document.body.appendChild(a);
	a.click();
	a.remove();
});
document.getElementById("submissions-btn").addEventListener("click", () => {
	if (_topic) navigateToStudents({ lesson: _topic, group: "assignments" });
});

_init();
