const { app, BrowserWindow, screen } = require("electron");
const path = require("path");
const { broadcastServer } = require("./context");
const state = require("./state");
const FloatingWindow = require("./floating-window");
const { closeToolWindows } = require("./lesson-tools");

const floatState = {
	questionWindowIsLesson: false,
	questionWindowStudentAnswered: null,
	questionWindowBgColor: null,
	questionOptions: [],
};

const QUESTION_WIN_OFFSCREEN_MARGIN = 40;
const QUESTION_WIN_SQUARE_SIDE = 700;
let _activeFloat = null;

function _activeFloatInstance() {
	if (_activeFloat && _activeFloat.isAlive()) return _activeFloat;
	for (const f of [
		_questionFloat,
		_imageFloat,
		_webFloat,
		_randomizerFloat,
		_optionsFloat,
	]) {
		if (f && f.isAlive()) return f;
	}
	return null;
}

function _onFloatShown(f) {
	if (_activeFloat !== f) stopFloatLerp();
	_activeFloat = f;
}

const ANIMATION_FRAME_INTERVAL_MS = 16;
const FLOATING_WINDOW_LERP_FACTOR = 0.5;
const FLOATING_WINDOW_MIN_WIDTH = 200;
const FLOATING_WINDOW_MIN_HEIGHT = 150;

let floatAnim = {
	target: { x: null, y: null, w: null, h: null },
	prevRounded: { x: -1, y: -1, w: -1, h: -1 },
	timer: null,
};

function startFloatLerp() {
	if (floatAnim.timer) return;
	floatAnim.timer = setInterval(() => {
		const f = _activeFloatInstance();
		if (!f) {
			stopFloatLerp();
			return;
		}
		const win = f.win;
		const rect = f.rect;
		if (!rect || floatAnim.target.x === null) {
			stopFloatLerp();
			return;
		}
		const target = floatAnim.target;
		const prev = floatAnim.prevRounded;
		rect.x += (target.x - rect.x) * FLOATING_WINDOW_LERP_FACTOR;
		rect.y += (target.y - rect.y) * FLOATING_WINDOW_LERP_FACTOR;
		rect.w += (target.w - rect.w) * FLOATING_WINDOW_LERP_FACTOR;
		rect.h += (target.h - rect.h) * FLOATING_WINDOW_LERP_FACTOR;
		const bx = Math.round(rect.x);
		const by = Math.round(rect.y);
		const bw = Math.max(FLOATING_WINDOW_MIN_WIDTH, Math.round(rect.w));
		const bh = Math.max(FLOATING_WINDOW_MIN_HEIGHT, Math.round(rect.h));
		if (bx !== prev.x || by !== prev.y || bw !== prev.w || bh !== prev.h) {
			prev.x = bx;
			prev.y = by;
			prev.w = bw;
			prev.h = bh;
			win.setBounds({ x: bx, y: by, width: bw, height: bh });
		}
		if (
			Math.abs(rect.x - target.x) < 1 &&
			Math.abs(rect.y - target.y) < 1 &&
			Math.abs(rect.w - target.w) < 1 &&
			Math.abs(rect.h - target.h) < 1
		) {
			rect.x = target.x;
			rect.y = target.y;
			rect.w = target.w;
			rect.h = target.h;
			stopFloatLerp();
		}
	}, ANIMATION_FRAME_INTERVAL_MS);
}

function stopFloatLerp() {
	if (floatAnim.timer) {
		clearInterval(floatAnim.timer);
		floatAnim.timer = null;
	}
	floatAnim.target = { x: null, y: null, w: null, h: null };
	floatAnim.prevRounded = { x: -1, y: -1, w: -1, h: -1 };
}

function getFloatRect() {
	const f = _activeFloatInstance();
	return f ? f.rect : null;
}

function ensureFloatTargets(rect) {
	if (floatAnim.target.x === null) {
		floatAnim.target.x = rect.x;
		floatAnim.target.y = rect.y;
		floatAnim.target.w = rect.w;
		floatAnim.target.h = rect.h;
	}
}

function _readyTarget() {
	const rect = getFloatRect();
	if (!rect) return null;
	ensureFloatTargets(rect);
	return floatAnim.target;
}

function _setFloatTargetSize(t, newW, newH) {
	newW = Math.max(FLOATING_WINDOW_MIN_WIDTH, newW);
	newH = Math.max(FLOATING_WINDOW_MIN_HEIGHT, newH);
	t.x -= (newW - t.w) / 2;
	t.y -= (newH - t.h) / 2;
	t.w = newW;
	t.h = newH;
}

function applyWindowPinch(scale, dx, dy) {
	const t = _readyTarget();
	if (!t) return;
	_setFloatTargetSize(t, t.w * scale, t.h * scale);
	t.x += dx;
	t.y += dy;
	startFloatLerp();
}

function applyWindowDrag(dx, dy) {
	const t = _readyTarget();
	if (!t) return;
	t.x += dx;
	t.y += dy;
	startFloatLerp();
}

function applyWindowResize(scaleX, scaleY) {
	const t = _readyTarget();
	if (!t) return;
	_setFloatTargetSize(t, t.w * scaleX, t.h * scaleY);
	startFloatLerp();
}

function _centeredPos(w, h) {
	const wa = screen.getPrimaryDisplay().workArea;
	return {
		x: Math.floor(wa.x + (wa.width - w) / 2),
		y: Math.floor(wa.y + (wa.height - h) / 2),
	};
}

function _makeFloatingWindow({
	width,
	height,
	x,
	y,
	title,
	html,
	extraWebPrefs,
}) {
	const win = new BrowserWindow({
		width,
		height,
		...(x != null ? { x } : {}),
		...(y != null ? { y } : {}),
		frame: false,
		transparent: true,
		resizable: true,
		autoHideMenuBar: true,
		alwaysOnTop: true,
		title,
		icon: path.join(__dirname, "../shared/icon.ico"),
		webPreferences: {
			nodeIntegration: true,
			contextIsolation: false,
			...(extraWebPrefs || {}),
		},
	});
	broadcastServer.broadcastFloatingWindowOpened();
	win.setMenu(null);
	win.loadFile(path.join(__dirname, html));
	return win;
}

function _floatRect(win) {
	const b = win.getBounds();
	return { x: b.x, y: b.y, w: b.width, h: b.height };
}

function _trackWindowRect(win, getRect) {
	win.on("move", () => {
		const r = getRect();
		if (!win.isDestroyed() && r) {
			const b = win.getBounds();
			r.x = b.x;
			r.y = b.y;
		}
	});
	win.on("resize", () => {
		const r = getRect();
		if (!win.isDestroyed() && r) {
			const b = win.getBounds();
			r.w = b.width;
			r.h = b.height;
		}
	});
}

function makeFloat(opts) {
	return new FloatingWindow({
		broadcastServer,
		floatRect: _floatRect,
		trackWindowRect: _trackWindowRect,
		onShow: _onFloatShown,
		...opts,
	});
}

const _questionFloat = makeFloat({
	channel: "set-question",
	make: () => {
		const display = screen.getPrimaryDisplay();
		const workArea = display.workArea;
		const winW = 900;
		const winH = 480;
		const offX = Math.floor(workArea.x + (workArea.width - winW) / 2);
		const offY = floatState.questionWindowIsLesson
			? workArea.y + workArea.height + QUESTION_WIN_OFFSCREEN_MARGIN
			: Math.floor(workArea.y + (workArea.height - winH) / 2);
		return _makeFloatingWindow({
			width: winW,
			height: winH,
			x: offX,
			y: offY,
			title: "Question",
			html: "../question-window.html",
		});
	},
	onClosed: () => {
		_randomizerFloat.close({ force: true });
		_optionsFloat.close({ force: true });
		if (app.isQuitting) {
			floatState.questionWindowStudentAnswered = null;
			return;
		}
		if (floatState.questionWindowIsLesson) {
			broadcastServer.broadcastQuestionEnded();
			if (floatState.questionWindowStudentAnswered === null) {
				state.send("question-answered", { studentName: null });
			}
			state.send("question-window-closed");
		}
		floatState.questionWindowStudentAnswered = null;
	},
});

const _imageFloat = makeFloat({
	channel: "set-image",
	make: () =>
		_makeFloatingWindow({
			width: 900,
			height: 650,
			title: "Image",
			html: "../image-window.html",
		}),
});

const _webFloat = makeFloat({
	channel: "set-url",
	make: () => {
		const win = _makeFloatingWindow({
			width: 1100,
			height: 800,
			title: "Web",
			html: "../web-window.html",
			extraWebPrefs: { webviewTag: true },
		});
		win.webContents.on("did-attach-webview", (event, guest) => {
			guest.on("before-input-event", (e, input) => {
				if (
					input.type === "keyDown" &&
					input.control &&
					(input.key === "i" || input.key === "I")
				) {
					if (!win.isDestroyed()) {
						win.webContents.openDevTools({ mode: "detach" });
					}
				}
			});
		});
		return win;
	},
});

const _randomizerFloat = makeFloat({
	channel: "set-randomizer",
	make: () => {
		const { x, y } = _centeredPos(600, 600);
		return _makeFloatingWindow({
			width: 600,
			height: 600,
			x,
			y,
			title: "Randomizer",
			html: "../randomizer-window.html",
		});
	},
});

const _optionsFloat = makeFloat({
	channel: "set-options",
	make: () => {
		const { x, y } = _centeredPos(700, 600);
		return _makeFloatingWindow({
			width: 700,
			height: 600,
			x,
			y,
			title: "Options",
			html: "../options-window.html",
		});
	},
});

function closeAllChildWindows() {
	_questionFloat.close({ force: true });
	_imageFloat.close({ force: true });
	_webFloat.close({ force: true });
	_randomizerFloat.close({ force: true });
	_optionsFloat.close({ force: true });
	closeToolWindows();
}

function openQuestionWindow(question, bgColor, emoji, studentName) {
	_randomizerFloat.close({ force: true });
	_optionsFloat.close({ force: true });
	const payload = { question, bgColor, emoji, studentName };
	floatState.questionWindowIsLesson = !studentName;
	floatState.questionWindowBgColor = bgColor || null;
	floatState.questionOptions = [];
	floatState.questionWindowStudentAnswered = null;
	_questionFloat.showOrReuse(payload, {});
}

function setQuestionWindowSquare() {
	const qw = _questionFloat.activeWin;
	if (!qw) return;
	const workArea = screen.getPrimaryDisplay().workArea;
	const side = QUESTION_WIN_SQUARE_SIDE;
	const x = Math.floor(workArea.x + (workArea.width - side) / 2);
	const y = floatState.questionWindowIsLesson
		? workArea.y + workArea.height + QUESTION_WIN_OFFSCREEN_MARGIN
		: Math.floor(workArea.y + (workArea.height - side) / 2);
	qw.setBounds({ x, y, width: side, height: side });
	if (_questionFloat.rect) {
		_questionFloat.rect.x = x;
		_questionFloat.rect.y = y;
		_questionFloat.rect.w = side;
		_questionFloat.rect.h = side;
	}
}

let questionWindowSlideTimer = null;
function _animateQuestionWindowTo(target, duration, onDone) {
	const qw = _questionFloat.activeWin;
	if (!qw) return;
	if (questionWindowSlideTimer) {
		clearInterval(questionWindowSlideTimer);
		questionWindowSlideTimer = null;
	}
	const start = qw.getBounds();
	const startTime = Date.now();
	questionWindowSlideTimer = setInterval(() => {
		if (!qw || qw.isDestroyed()) {
			clearInterval(questionWindowSlideTimer);
			questionWindowSlideTimer = null;
			return;
		}
		const t = Math.min(1, (Date.now() - startTime) / duration);
		const eased = 1 - Math.pow(1 - t, 3);
		const lerp = (a, z) => Math.round(a + (z - a) * eased);
		const nb = {
			x: lerp(start.x, target.x),
			y: lerp(start.y, target.y),
			width: lerp(start.width, target.width),
			height: lerp(start.height, target.height),
		};
		qw.setBounds(nb);
		if (_questionFloat.rect) {
			_questionFloat.rect.x = nb.x;
			_questionFloat.rect.y = nb.y;
			_questionFloat.rect.w = nb.width;
			_questionFloat.rect.h = nb.height;
		}
		if (t >= 1) {
			clearInterval(questionWindowSlideTimer);
			questionWindowSlideTimer = null;
			if (onDone) onDone();
		}
	}, 16);
}

function animateQuestionWindowOnScreen() {
	const qw = _questionFloat.activeWin;
	if (!qw) return;
	_onFloatShown(_questionFloat);
	const workArea = screen.getPrimaryDisplay().workArea;
	const b = qw.getBounds();
	const targetY = Math.floor(workArea.y + (workArea.height - b.height) / 2);
	if (b.y === targetY) return;
	_animateQuestionWindowTo(
		{ x: b.x, y: targetY, width: b.width, height: b.height },
		600,
	);
}

module.exports = {
	floatState,
	openQuestionWindow,
	closeAllChildWindows,
	setQuestionWindowSquare,
	animateQuestionWindowOnScreen,
	stopFloatLerp,
	applyWindowPinch,
	applyWindowDrag,
	applyWindowResize,
	_questionFloat,
	_imageFloat,
	_webFloat,
	_randomizerFloat,
	_optionsFloat,
};
