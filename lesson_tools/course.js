"use strict";

let _topic = null;
let _mode = "lessons";
let _viewMode = "instructions";
let _fileViewer = null;
let _startFiles = [];
let _topics = [];
let _overlay = null;

async function _loadTopics() {
	const served = await detectServedDataSource();
	const groups = served && served.manifest && served.manifest.groups;
	if (groups) {
		const lessons = Object.keys(groups.lessons || {});
		const assignments = Object.keys(groups.assignments || {});
		return _mergeTopics(lessons, assignments);
	}
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
	_overlay = new StateOverlay({
		emptyEl: document.getElementById("no-selection"),
		contentEls: {
			lesson: {
				el: document.getElementById("lesson-frame"),
				display: "block",
			},
			viewer: {
				el: document.getElementById("viewer-root"),
				display: "flex",
			},
		},
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
		_overlay.showMessage("No lessons or assignments found.");
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
	const { ts, step, autoplay, speed } = parseToolParams();
	const seek =
		startTopic.name.toLowerCase() === preselect
			? { ts, step, autoplay, speed }
			: null;
	_select(startTopic.name, seek);
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

async function _select(name, seek) {
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
		await _showLesson(name, seek);
	} else {
		await _showAssignment(name);
	}
}

async function _showLesson(name, seek) {
	const frame = document.getElementById("lesson-frame");
	frame.src = buildToolUrl("simulator.html", {
		lesson: name,
		group: "lessons",
		...(seek || {}),
	});
	_overlay.showContent("lesson");
	document.getElementById("timeline-btn").disabled = false;
	document.getElementById("students-btn-lesson").disabled = false;
}

async function _showAssignment(name) {
	const frame = document.getElementById("lesson-frame");
	frame.removeAttribute("src");
	document.getElementById("submissions-btn").disabled = false;
	_overlay.showLoading();
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
				_overlay.showError("No code files found in start folder.");
				return;
			}
		}
		_overlay.showContent("viewer");
	} catch (e) {
		_overlay.showError(`Could not load: ${e.message}`);
	}
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
		_overlay.showLoading();
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
