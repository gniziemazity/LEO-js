"use strict";

const CFG = {
	BURST_GAP: 30,
	MIN_BURST: 2,
	PADDING: 120,
	BAR_MIN_SECS: 8,
	M: { top: 22, right: 24, bottom: 44, left: 68 },
	DOT_R: 3.5,
	DIA_R: 5,
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

function toggleShake() {
  _shake = !_shake;
  if (_shake && _students) {
    for (const s of _students) {
      _jitterMap.set(s.name, { dx: (Math.random() - 0.5) * 28, dy: (Math.random() - 0.5) * 28 });
    }
  }
  const btn = document.getElementById('btn-shake');
  if (btn) btn.classList.toggle('active', _shake);
  redrawChart3();
}
