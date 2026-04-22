"use strict";

const CFG = {
	BURST_GAP: 30,
	MIN_BURST: 2,
	PADDING: 120,
	BAR_MIN_SECS: 8,
	M: { top: 22, right: 24, bottom: 44, left: 68 },
	DOT_R: 3.5,
	DIA_R: 8,
	STUDENT_SUBDIR: "anon_names",
};

const DELETE_CHARS = new Set([
	"\u21a2",
	"\u21a3",
	"\u26d4",
	"\u232b",
	"\u2326",
]);
const DELETE_LABELS = {
	"\u21a2": "backspace",
	"\u21a3": "delete fwd",
	"\u26d4": "delete line",
	"\u232b": "backspace",
	"\u2326": "delete fwd",
};

let _p = null;
let _students = null;
let _zoomMin = null,
	_zoomMax = null;
let _renderScheduled = false;
let _hoveredStudent = null;
let _lastL = null;

const PAN_STATE = { active: false, startX: 0, startMin: 0, startMax: 0 };
const _abortCtrls = new Map();
const _hoverAborts = new Map();

let _shake = false;
const _jitterMap = new Map();

const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|ico|bmp)$/i;

function _hexToRgba(hex, a) {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	return `rgba(${r},${g},${b},${a})`;
}

const THEME = {
	blue: _cssVar("--clr-accent"),
	orange: _cssVar("--clr-orange"),
	green: _cssVar("--clr-green"),
	red: _cssVar("--clr-red"),
	gray: _cssVar("--clr-gray"),
	paleRed: _cssVar("--clr-pale-red"),
	muted: _cssVar("--clr-muted"),
	label: _cssVar("--clr-label"),
	bg: _cssVar("--clr-bg"),
};

const INTERACTION_COLORS = {
	"teacher-question": {
		hex: THEME.blue,
		spanRgba: _hexToRgba(THEME.blue, 0.6),
		spanRgbaUnanswered: _hexToRgba(THEME.blue, 0.15),
		tipBg: "#E3F2FD",
	},
	"student-question": {
		hex: THEME.orange,
		spanRgba: _hexToRgba(THEME.orange, 0.6),
		tipBg: "#FFF3E0",
	},
	"providing-help": {
		hex: THEME.green,
		spanRgba: _hexToRgba(THEME.green, 0.6),
		tipBg: "#E8F5E9",
	},
};

function toggleShake() {
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
	if (btn) btn.classList.toggle("active", _shake);
	redrawChart3();
}
