"use strict";

let _students = [];
let _remarkCols = [];
let _hasInteractions = false;
let _followLabel = "FOLLOW";
let _allFiles = new Map();
let _dirHandle = null;
let _isReadOnly = false;
let _lessonName = null;
let _lessonGroup = null;
let _mode = "assignment";
let _modeParam = null;
let _paperMode = false;
let _highlightIds = null;
let _starIds = null;
let _sortCol = "id";
let _sortDir = "asc";
let _shownUnicodeCorruptionWarning = false;

const GRADES_KEY = "_grades";

let _basisFiles = new Map();
let _basisFallbackFile = null;
let _activeBasis = null;
let _baseStudents = null;

let _activeBasisFile = null;
let _activeBasisFileName = "";
let _activeSheetName = "";
let _activeRemarkColIdx = {};
const _dirtyEdits = new Map();
const _origObs = new Map();

let _artefactSchema = [];

const INTERACTION_MAP = { Q: "❓", A: "🙋", H: "🤝" };

const LANG_COL_DEFS = [
	{
		key: "html",
		label: "HTML",
		header: "HTML (E)",
		descHeader: "HTML (E) Desc",
	},
	{ key: "css", label: "CSS", header: "CSS (E)", descHeader: "CSS (E) Desc" },
	{ key: "js", label: "JS", header: "JS (E)", descHeader: "JS (E) Desc" },
	{ key: "py", label: "Py", header: "Py (E)", descHeader: "Py (E) Desc" },
];

const COL_HIDE_KEYS = [
	{ key: "name", label: "Name" },
	{ key: "num", label: "Number" },
	{ key: "remarks", label: "Remarks" },
	{ key: "expected", label: "Expected" },
	{ key: "grade", label: "Grade" },
	{ key: "comments", label: "Comments" },
	{ key: "follow", label: "Follow / SIM" },
	{ key: "languages", label: "Languages (HTML/CSS/JS/Py)" },
	{ key: "fingerprint1", label: "Fingerprint · timeline" },
	{ key: "fingerprint2", label: "Fingerprint · extras" },
	{ key: "fingerprint3", label: "Fingerprint · comments" },
	{ key: "mismatches", label: "Mismatches" },
];

const _hiddenCols = new Set();

function _loadHiddenCols() {
	try {
		const raw = localStorage.getItem("students.hiddenCols");
		if (!raw) return;
		const arr = JSON.parse(raw);
		if (!Array.isArray(arr)) return;
		for (const k of arr) {
			if (k === "fingerprint") {
				_hiddenCols.add("fingerprint1");
				_hiddenCols.add("fingerprint2");
				_hiddenCols.add("fingerprint3");
			} else {
				_hiddenCols.add(k);
			}
		}
	} catch (_e) {}
}

function _saveHiddenCols() {
	try {
		localStorage.setItem(
			"students.hiddenCols",
			JSON.stringify([..._hiddenCols]),
		);
	} catch (_e) {}
}

_loadHiddenCols();

function _mismatchColor(ev) {
	if (ev.kind === "missing" || ev.kind === "extra-star") {
		const c = langColorFor(ev.lang);
		if (c) return c;
	}
	return markColorFor(ev.kind) || THEME.muted;
}

const landingEl = document.getElementById("landing");
const mainEl = document.getElementById("main");
const lessonNameEl = document.getElementById("lesson-name");
