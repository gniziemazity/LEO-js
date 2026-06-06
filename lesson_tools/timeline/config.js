"use strict";

const CFG = {
	BURST_GAP: 30,
	MIN_BURST: 2,
	PADDING: 120,
	BAR_MIN_SECS: 8,
	CODE_INSERT_MS_PER_CHAR: 10,
	M: { top: 22, right: 24, bottom: 44, left: 68 },
	DOT_R: 3.5,
	DIA_R: 8,
};

const DELETE_CHARS = new Set([
	"\u21a2",
	"\u21a3",
	"\u26d4",
	"\u232b",
	"\u2326",
]);
const BACKSPACE_CHARS_SET = new Set(["\u21a2", "\u232b"]);
const DELETE_FWRD_CHARS_SET = new Set(["\u21a3", "\u2326"]);
const CURSOR_LEFT_CHARS = new Set(["\u2190"]);
const CURSOR_RIGHT_CHARS = new Set(["\u2192"]);
const CURSOR_UP_CHARS = new Set(["\u2191", "\u21d1"]);
const CURSOR_DOWN_CHARS = new Set(["\u2193", "\u21d3"]);
const CURSOR_HOME_CHARS = new Set(["\u25c4", "\u21d0"]);
const CURSOR_END_CHARS = new Set(["\u25ba", "\u21d2"]);

let _p = null;
let _students = null;
let _teacherTokens = [];
let _zoomMin = null,
	_zoomMax = null;
let _renderScheduled = false;
let _hoveredStudent = null;
let _hoveredCluster = null;
let _lockedStudent = null;
let _lastL = null;

const PAN_STATE = { active: false, startX: 0, startMin: 0, startMax: 0 };
const _abortCtrls = new Map();
const _hoverAborts = new Map();

let _shake = false;
const _jitterMap = new Map();

const INTERACTION_COLORS = {
	"teacher-question": {
		hex: THEME.blue,
		spanRgba: _hexToRgba(THEME.blue, 0.6),
		tipBg: _cssVar("--clr-tip-bg-blue"),
	},
	"student-question": {
		hex: THEME.orange,
		spanRgba: _hexToRgba(THEME.orange, 0.6),
		tipBg: _cssVar("--clr-tip-bg-orange"),
	},
	"providing-help": {
		hex: THEME.green,
		spanRgba: _hexToRgba(THEME.green, 0.6),
		tipBg: _cssVar("--clr-tip-bg-green"),
	},
};

function toggleStudentJitter() {
	_shake = !_shake;
	if (_shake && _students) {
		for (const s of _students) {
			_jitterMap.set(s.name, {
				dx: (Math.random() - 0.5) * 28,
				dy: (Math.random() - 0.5) * 28,
			});
		}
	}
	const btn = document.getElementById("btn-shake");
	if (btn) btn.classList.toggle("is-toggle-on", _shake);
	redrawBottomChart();
}
