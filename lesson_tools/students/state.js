"use strict";

let _students = [];
let _remarkCols = [];
let _hasInteractions = false;
let _followLabel = "FOLLOW";
let _allFiles = new Map();
let _dirHandle = null;
let _serverWritable = false;
let _lessonName = null;

function _canEditCells() {
	return !!(_dirHandle || _serverWritable);
}
let _lessonGroup = null;
let _mode = "assignment";
let _modeParam = null;
let _paperMode = false;
let _fingerprintParam = false;
let _simParam = false;
let _setParam = null;
let _highlightIds = null;
let _starIds = null;
let _artefactHighlights = null;
let _sortCol = "id";
let _sortDir = "asc";
let _shownUnicodeCorruptionWarning = false;

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
	{ key: "interactions", label: "Interactions" },
	{ key: "follow", label: "Follow / Sim" },
	{ key: "languages", label: "Languages" },
	{ key: "fingerprint", label: "Fingerprint" },
	{ key: "mismatches", label: "Mismatches" },
];

const _hiddenCols = new Set();

const _hiddenColsStore = makeHiddenColsStore(
	"students.hiddenCols",
	_hiddenCols,
	{
		migrate: (k) => (/^fingerprint[123]$/.test(k) ? "fingerprint" : null),
	},
);
const _loadHiddenCols = () => _hiddenColsStore.load();
const _saveHiddenCols = () => _hiddenColsStore.save();

_loadHiddenCols();

const landingEl = document.getElementById("landing");
const mainEl = document.getElementById("main");
const lessonNameEl = document.getElementById("lesson-name");
