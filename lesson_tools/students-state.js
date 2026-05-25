"use strict";

let _students = [];
let _remarkCols = [];
let _hasInteractions = false;
let _followLabel = "FOLLOW";
let _allFiles = new Map();
let _dirHandle = null;
let _anonMode = "";
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
let _activeWorkbook = null;
let _activeSheetName = "";
let _activeHeaderRow = null;
let _activeRemarkColIdx = {};
const _dirtyEdits = new Map();
const EDITABLE_COL_RE = /^(obs\.?|grade|comments?)$/i;

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
const anonSelectEl = document.getElementById("anon-select");
