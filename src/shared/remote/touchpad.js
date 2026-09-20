let touchpadActive = false;
let touchStartX = 0;
let touchStartY = 0;
let lastSendTime = 0;
let MOUSE_SENSITIVITY = 3;
let SCROLL_SENSITIVITY = 3;
const SEND_THROTTLE_MS = 30;
let isDragging = false;
let oneFingerMoved = false;
let tapTime = 0;
let tapTimeout = null;
let twoFingerStartX = 0;
let twoFingerTapStart = 0;
let twoFingerMoved = false;
let wasTwoFinger = false;
let touchpadMode = "mouse";
let touchpadSide = "right";
let scrollAnchorId = null;
let scrollAccum = 0;

const touchpadModeHandlers = {};
let activeModeHandler = null;
let touchpadModeSeq = 0;
let autoPilot = false;
const PAD_OFF = "off";
let padOverride = null;
let lastCursorStep = null;

function registerTouchpadMode(name, handler) {
	touchpadModeHandlers[name] = handler;
}

let scrollVelocity = 0;
let momentumAnimId = null;
const MOMENTUM_FRICTION = 0.9;
const MOMENTUM_MIN_VEL = 0.5;
const VELOCITY_SMOOTHING = 0.4;

function startScrollMomentum() {
	if (momentumAnimId) cancelAnimationFrame(momentumAnimId);
	function step() {
		scrollVelocity *= MOMENTUM_FRICTION;
		if (Math.abs(scrollVelocity) < MOMENTUM_MIN_VEL) {
			scrollVelocity = 0;
			momentumAnimId = null;
			return;
		}
		scrollAccum += scrollVelocity;
		const toSend = Math.trunc(scrollAccum);
		if (toSend !== 0) {
			scrollAccum -= toSend;
			sendMessage("mouse-scroll", { dy: toSend });
		}
		momentumAnimId = requestAnimationFrame(step);
	}
	momentumAnimId = requestAnimationFrame(step);
}

function stopScrollMomentum() {
	if (momentumAnimId) {
		cancelAnimationFrame(momentumAnimId);
		momentumAnimId = null;
	}
	scrollVelocity = 0;
	scrollAccum = 0;
}

function rotateCCW(dx, dy) {
	return { dx: dy, dy: -dx };
}

function rotateCW(dx, dy) {
	return { dx: -dy, dy: dx };
}

function rotateForSide(dx, dy) {
	return touchpadSide === "left" ? rotateCW(dx, dy) : rotateCCW(dx, dy);
}

function setTouchpadSide(side) {
	touchpadSide = side || "right";
}

function updateModeBtns(activeMode) {
	const ids = {
		mouse: "modeBtnMouse",
		keyboard: "modeBtnKeyboard",
	};
	for (const [name, handler] of Object.entries(touchpadModeHandlers)) {
		if (handler.modeBtnId) ids[name] = handler.modeBtnId;
	}
	for (const [m, id] of Object.entries(ids)) {
		const btn = document.getElementById(id);
		if (btn) btn.classList.toggle("mode-active", m === activeMode);
	}
	const container = document.getElementById("modeSideBtns");
	if (container) {
		container.classList.toggle("has-active", !!activeMode);
		container.classList.toggle(
			"has-pad",
			!!activeMode && !touchpadModeHandlers[activeMode],
		);
	}
}

function stopDragIfActive() {
	if (isDragging) {
		isDragging = false;
		sendMessage("mouse-drag-end", {});
		const overlay = document.getElementById("touchpadOverlay");
		if (overlay) overlay.classList.remove("dragging");
	}
}

function deactivateTouchpad() {
	const overlay = document.getElementById("touchpadOverlay");
	const header = document.getElementById("mobile-header");
	touchpadActive = false;
	overlay.classList.remove("active", "keyboard-mode");
	delete document.body.dataset.padTint;
	header.classList.remove("hidden", "above-pad");
	stopDragIfActive();
	if (activeModeHandler) {
		if (activeModeHandler.deactivate)
			activeModeHandler.deactivate({ overlay, header });
		activeModeHandler = null;
	}
	syncTouchpadToolbar();
}

function closeTouchpad() {
	deactivateTouchpad();
	updateModeBtns(null);
}

async function setTouchpadMode(mode) {
	if (!touchpadModeHandlers[mode] && mode === "keyboard" && !keyInputAllowed())
		return;
	if (!touchpadModeHandlers[mode] && blockingOverlayOpen()) return;
	if (autoPilot) {
		if (touchpadModeHandlers[mode] || blockingOverlayOpen()) return;
		if (touchpadActive && !activeModeHandler && touchpadMode === mode) {
			padOverride = PAD_OFF;
			closeTouchpad();
			return;
		}
		padOverride = mode;
	}
	await showPad(mode);
}

async function showPad(mode) {
	const handler = touchpadModeHandlers[mode];
	const seq = ++touchpadModeSeq;

	const alreadyActive = handler
		? activeModeHandler === handler
		: touchpadActive && !activeModeHandler && touchpadMode === mode;

	deactivateTouchpad();

	if (alreadyActive) {
		updateModeBtns(null);
		return;
	}

	const overlay = document.getElementById("touchpadOverlay");
	const header = document.getElementById("mobile-header");

	if (handler) {
		activeModeHandler = handler;
		touchpadActive = true;
		overlay.classList.add("active");
		if (handler.padTint) document.body.dataset.padTint = handler.padTint;
		header.classList.add("above-pad");
		if (handler.activate) await handler.activate({ overlay, header });
		if (seq !== touchpadModeSeq) return;
	} else {
		touchpadActive = true;
		touchpadMode = mode;
		overlay.classList.add("active");
		overlay.classList.toggle("keyboard-mode", mode === "keyboard");
		document.body.dataset.padTint =
			mode === "keyboard" ? "keyboard" : "mouse";
		header.classList.add("above-pad");
	}

	updateModeBtns(mode);
	syncTouchpadToolbar();
}

function setTouchpadSensitivity(sensitivity) {
	MOUSE_SENSITIVITY = sensitivity;
	SCROLL_SENSITIVITY = sensitivity * 0.67;
}

let sessionActive = false;

function blockingOverlayOpen() {
	return !!document.querySelector(".overlay.active:not(.overlay-pad-ok)");
}

function keyInputAllowed() {
	return sessionActive && !blockingOverlayOpen();
}

function padOverlay() {
	if (typeof activePadOverlay !== "function") return null;
	return activePadOverlay();
}

function editKeysWanted() {
	if (!touchpadActive) return false;
	if (activeModeHandler)
		return !!(
			activeModeHandler.wantsEditKeys && activeModeHandler.wantsEditKeys()
		);
	return touchpadMode === "mouse";
}

function stepKeysWanted() {
	return touchpadActive && !activeModeHandler && touchpadMode === "keyboard";
}

function padCoversPopup() {
	if (!touchpadActive) return false;
	if (!activeModeHandler) return true;
	if (typeof activeModeHandler.coversScreen === "function")
		return !!activeModeHandler.coversScreen();
	return true;
}

function publishModesExtent() {
	const el = document.getElementById("modeSideBtns");
	if (!el || !document.documentElement) return;
	const h = el.offsetHeight;
	if (h)
		document.documentElement.style.setProperty("--modes-extent", h + "px");
	for (const btn of el.children) {
		if (!btn.offsetWidth) continue;
		const box = btn.getBoundingClientRect();
		const style = document.documentElement.style;
		style.setProperty("--mode-btn-w", box.width + "px");
		style.setProperty("--mode-btn-h", box.height + "px");
		break;
	}
}

function syncTouchpadToolbar() {
	publishModesExtent();
	const keys = document.getElementById("touchpadEditKeys");
	if (keys) keys.classList.toggle("visible", editKeysWanted());
	const stepKeys = document.getElementById("touchpadStepKeys");
	if (stepKeys) stepKeys.classList.toggle("visible", stepKeysWanted());

	const overlay = padOverlay();
	if (overlay && overlay.setPadCovered)
		overlay.setPadCovered(padCoversPopup());
}

function remoteEditKey(action) {
	sendMessage("remote-edit-key", { action });
}

function remoteStep(direction) {
	sendMessage(direction === "back" ? "step-backward" : "step-forward", {});
}

function autoPilotMode() {
	if (!sessionActive) return "mouse";
	const overlay = padOverlay();
	const wanted = overlay && overlay.autoPilotPad && overlay.autoPilotPad();
	return wanted || "keyboard";
}

function noteLessonAdvanced(step) {
	if (step === lastCursorStep) return;
	lastCursorStep = step;
	if (!autoPilot || !padOverride) return;
	padOverride = null;
	followAutoPilot();
}

async function followAutoPilot() {
	if (blockingOverlayOpen()) {
		if (touchpadActive) closeTouchpad();
		return;
	}
	if (padOverride === PAD_OFF) {
		if (touchpadActive) closeTouchpad();
		return;
	}
	const want = padOverride || autoPilotMode();
	if (touchpadActive && !activeModeHandler && touchpadMode === want) {
		updateModeBtns(want);
		return;
	}
	await showPad(want);
}

function setAutoPilot(on) {
	const next = !!on;
	if (next === autoPilot) return;
	autoPilot = next;
	padOverride = null;
	const btn = document.getElementById("autoPilotBtn");
	if (btn) btn.classList.toggle("auto-on", next);
	if (next) followAutoPilot();
	else if (touchpadActive) closeTouchpad();
}

function syncAutoPilotBtn() {
	const btn = document.getElementById("autoPilotBtn");
	if (btn) btn.disabled = !sessionActive;
}

function requestAutoPilot() {
	if (!sessionActive) return;
	sendMessage("set-auto-pilot", { autoPilot: !autoPilot });
}

function syncKeyInputGate() {
	const allowed = keyInputAllowed();
	const btn = document.getElementById("modeBtnKeyboard");
	if (btn) btn.classList.toggle("kb-disabled", !allowed);
	if (autoPilot) {
		padOverride = null;
		followAutoPilot();
	} else if (
		touchpadActive &&
		!activeModeHandler &&
		(blockingOverlayOpen() || (!allowed && touchpadMode === "keyboard"))
	) {
		closeTouchpad();
	}
	syncTouchpadToolbar();
}

function setSessionActive(active) {
	sessionActive = !!active;
	syncAutoPilotBtn();
	syncKeyInputGate();
}

function initTouchpad() {
	const overlay = document.getElementById("touchpadOverlay");
	const TAP_MAX_MS = 200;
	const DOUBLE_TAP_GAP_MS = 300;
	const MOVE_THRESHOLD = 8;
	let touchDownTime = 0;
	let touchDownX = 0;
	let touchDownY = 0;

	for (const handler of Object.values(touchpadModeHandlers)) {
		if (handler.init) handler.init();
	}

	function padListener(type, handlerKey, run) {
		overlay.addEventListener(
			type,
			(e) => {
				if (e.target.closest(".touchpad-toolbar")) return;
				e.preventDefault();

				if (activeModeHandler) {
					if (activeModeHandler[handlerKey])
						activeModeHandler[handlerKey](e);
					return;
				}

				run(e);
			},
			{ passive: false },
		);
	}

	padListener("touchstart", "onTouchStart", (e) => {
		if (touchpadMode === "keyboard") {
			if (keyInputAllowed()) sendMessage("remote-key-press", {});
			return;
		}

		if (e.touches.length === 2) {
			const anchor = e.touches[0];
			scrollAnchorId = anchor.identifier;
			twoFingerStartX = anchor.clientX;
			twoFingerTapStart = Date.now();
			twoFingerMoved = false;
			wasTwoFinger = true;
			stopScrollMomentum();
			return;
		}

		const t = e.touches[0];
		touchStartX = t.clientX;
		touchStartY = t.clientY;
		touchDownX = t.clientX;
		touchDownY = t.clientY;
		touchDownTime = Date.now();
		oneFingerMoved = false;

		const gap = touchDownTime - tapTime;
		if (tapTime > 0 && gap < DOUBLE_TAP_GAP_MS) {
			if (tapTimeout) {
				clearTimeout(tapTimeout);
				tapTimeout = null;
			}
			isDragging = true;
			sendMessage("mouse-drag-start", {});
			overlay.classList.add("dragging");
			tapTime = 0;
		}
	});

	padListener("touchmove", "onTouchMove", (e) => {
		if (touchpadMode === "keyboard") return;

		const now = Date.now();
		if (now - lastSendTime < SEND_THROTTLE_MS) return;
		lastSendTime = now;

		if (e.touches.length === 2) {
			let anchor = null;
			for (let i = 0; i < e.touches.length; i++) {
				if (e.touches[i].identifier === scrollAnchorId) {
					anchor = e.touches[i];
					break;
				}
			}
			if (!anchor) return;
			const dx = (anchor.clientX - twoFingerStartX) * SCROLL_SENSITIVITY;
			twoFingerStartX = anchor.clientX;
			const scrollDy = touchpadSide === "left" ? dx : -dx;
			scrollAccum += scrollDy;
			scrollVelocity =
				scrollVelocity * (1 - VELOCITY_SMOOTHING) +
				scrollDy * VELOCITY_SMOOTHING;
			const toSend = Math.trunc(scrollAccum);
			if (toSend !== 0) {
				twoFingerMoved = true;
				scrollAccum -= toSend;
				sendMessage("mouse-scroll", { dy: toSend });
			}
		} else if (e.touches.length === 1) {
			if (wasTwoFinger) return;

			const t = e.touches[0];
			const totalDx = Math.abs(t.clientX - touchDownX);
			const totalDy = Math.abs(t.clientY - touchDownY);
			if (totalDx > MOVE_THRESHOLD || totalDy > MOVE_THRESHOLD) {
				oneFingerMoved = true;
			}
			const screenDx = (t.clientX - touchStartX) * MOUSE_SENSITIVITY;
			const screenDy = (t.clientY - touchStartY) * MOUSE_SENSITIVITY;
			touchStartX = t.clientX;
			touchStartY = t.clientY;
			const rotated = rotateForSide(screenDx, screenDy);
			if (Math.abs(rotated.dx) > 0.5 || Math.abs(rotated.dy) > 0.5) {
				sendMessage("mouse-move", {
					dx: Math.round(rotated.dx),
					dy: Math.round(rotated.dy),
				});
			}
		}
	});

	padListener("touchend", "onTouchEnd", (e) => {
		if (touchpadMode === "keyboard") return;

		if (e.touches.length === 0 && twoFingerTapStart > 0) {
			const elapsed = Date.now() - twoFingerTapStart;
			if (!twoFingerMoved && elapsed < 300) {
				sendMessage("mouse-click", { button: "right" });
			} else if (
				twoFingerMoved &&
				Math.abs(scrollVelocity) > MOMENTUM_MIN_VEL
			) {
				startScrollMomentum();
			}
			twoFingerTapStart = 0;
			wasTwoFinger = false;
			return;
		}

		if (e.touches.length > 0) return;

		if (wasTwoFinger) {
			wasTwoFinger = false;
			return;
		}

		if (isDragging) {
			isDragging = false;
			sendMessage("mouse-drag-end", {});
			overlay.classList.remove("dragging");
			return;
		}

		const elapsed = Date.now() - touchDownTime;
		if (!oneFingerMoved && elapsed < TAP_MAX_MS) {
			tapTime = Date.now();
			tapTimeout = setTimeout(() => {
				sendMessage("mouse-click", { button: "left" });
				tapTime = 0;
				tapTimeout = null;
			}, DOUBLE_TAP_GAP_MS);
		}
	});
}
