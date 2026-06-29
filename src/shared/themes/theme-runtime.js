const LEO_THEMES = {};

function registerTheme(name, theme) {
	LEO_THEMES[name] = theme;
}

function listThemes() {
	return Object.keys(LEO_THEMES);
}

let _canvas = null;
let _ctx = null;
let _raf = null;
let _mode = null;
let _activeTheme = null;
let _start = 0;
let _palette = null;
let _solidColor = null;

function _resolveBackground(setting) {
	if (!setting || setting === "solid") return "solid";
	return LEO_THEMES[setting] ? setting : "solid";
}

function _roundRectPath(ctx, x, y, w, h, r) {
	const rr = Math.min(r, w / 2, h / 2);
	ctx.beginPath();
	ctx.moveTo(x + rr, y);
	ctx.arcTo(x + w, y, x + w, y + h, rr);
	ctx.arcTo(x + w, y + h, x, y + h, rr);
	ctx.arcTo(x, y + h, x, y, rr);
	ctx.arcTo(x, y, x + w, y, rr);
	ctx.closePath();
}

const EDGE_FADE = 32;

function _applyMask(ctx, shape, w, h) {
	if (shape === "none") return;
	ctx.save();
	ctx.globalCompositeOperation = "destination-in";
	ctx.fillStyle = "#ffffff";
	ctx.shadowColor = "#ffffff";
	if (shape === "circle") {
		ctx.shadowBlur = 44;
		ctx.beginPath();
		ctx.arc(w / 2, h / 2, Math.max(1, Math.min(w, h) / 2), 0, Math.PI * 2);
		ctx.fill();
	} else {
		ctx.shadowBlur = EDGE_FADE;
		_roundRectPath(ctx, 0, 0, w, h, 10);
		ctx.fill();
	}
	ctx.restore();
}

function _drawSolid() {
	if (!_ctx) return;
	const w = window.innerWidth;
	const h = window.innerHeight;
	_ctx.clearRect(0, 0, w, h);
	_ctx.fillStyle = _solidColor || "#f0f0f0";
	_ctx.fillRect(0, 0, w, h);
	_applyMask(_ctx, "rect", w, h);
}

function _frame(now) {
	if (!_activeTheme || !_ctx) return;
	const w = window.innerWidth;
	const h = window.innerHeight;
	_ctx.clearRect(0, 0, w, h);
	_activeTheme.draw(_ctx, now - _start, w, h);
	_applyMask(_ctx, _activeTheme.shape || "rect", w, h);
	_raf = requestAnimationFrame(_frame);
}

function _sizeCanvas() {
	if (!_canvas) return;
	const dpr = window.devicePixelRatio || 1;
	const w = window.innerWidth;
	const h = window.innerHeight;
	_canvas.width = Math.max(1, Math.round(w * dpr));
	_canvas.height = Math.max(1, Math.round(h * dpr));
	_ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	if (_mode === "solid") {
		_drawSolid();
	} else if (_activeTheme && _activeTheme.init) {
		_activeTheme.init(w, h);
	}
}

function _onVisibility() {
	if (_mode === "solid" || !_activeTheme) return;
	if (document.hidden) {
		if (_raf) {
			cancelAnimationFrame(_raf);
			_raf = null;
		}
	} else if (!_raf) {
		_start = performance.now() - 1;
		_raf = requestAnimationFrame(_frame);
	}
}

function _ensureCanvas() {
	if (_canvas) return;
	_canvas = document.createElement("canvas");
	_canvas.className = "leo-theme-canvas";
	_canvas.style.cssText =
		"position:fixed;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;display:block;";
	document.body.insertBefore(_canvas, document.body.firstChild);
	_ctx = _canvas.getContext("2d");
	window.addEventListener("resize", _sizeCanvas);
	document.addEventListener("visibilitychange", _onVisibility);
	_sizeCanvas();
}

function stopBackground() {
	if (_raf) {
		cancelAnimationFrame(_raf);
		_raf = null;
	}
	window.removeEventListener("resize", _sizeCanvas);
	document.removeEventListener("visibilitychange", _onVisibility);
	document.body.classList.remove("leo-themed");
	document.body.classList.remove("bg-circle");
	if (_palette) {
		for (const k of Object.keys(_palette)) {
			document.documentElement.style.removeProperty(k);
		}
		_palette = null;
	}
	if (_canvas && _canvas.parentNode) {
		_canvas.parentNode.removeChild(_canvas);
	}
	_canvas = null;
	_ctx = null;
	_activeTheme = null;
	_mode = null;
}

function initBackground(setting, color) {
	stopBackground();
	if (color) _solidColor = color;
	const resolved = _resolveBackground(setting);
	if (resolved === "solid") {
		_mode = "solid";
		_activeTheme = null;
		_ensureCanvas();
		return;
	}
	const theme = LEO_THEMES[resolved];
	_mode = resolved;
	_activeTheme = theme;
	_start = performance.now();
	document.body.classList.add("leo-themed");
	document.body.classList.toggle("bg-circle", theme.shape === "circle");
	if (theme.palette) {
		_palette = theme.palette;
		for (const k of Object.keys(_palette)) {
			document.documentElement.style.setProperty(k, _palette[k]);
		}
	}
	_ensureCanvas();
	_raf = requestAnimationFrame(_frame);
}

function setBackgroundColor(color) {
	if (color) _solidColor = color;
	if (_mode === "solid") {
		_drawSolid();
	} else if (_activeTheme && _activeTheme.setColor) {
		_activeTheme.setColor(color);
	}
}

function getActiveShape() {
	if (_mode === "solid" || !_activeTheme) return "rect";
	return _activeTheme.shape || "rect";
}
