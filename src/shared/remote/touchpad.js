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
let touchpadMode = "mouse"; // "mouse" or "keyboard"
let touchpadSide = "right"; // "right" or "left"
let scrollAnchorId = null;
let scrollAccum = 0;

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
	for (const [m, id] of Object.entries(ids)) {
		const btn = document.getElementById(id);
		if (btn) btn.classList.toggle("mode-active", m === activeMode);
	}
	const container = document.getElementById("modeSideBtns");
	if (container) container.classList.toggle("has-active", !!activeMode);
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
	header.classList.remove("hidden");
	stopDragIfActive();
}

function closeTouchpad() {
	deactivateTouchpad();
	updateModeBtns(null);
}

function setTouchpadMode(mode) {
	if (mode === "keyboard" && !autoTypingActive) return;

	const alreadyActive = touchpadActive && touchpadMode === mode;

	deactivateTouchpad();

	if (alreadyActive) {
		updateModeBtns(null);
		return;
	}

	const overlay = document.getElementById("touchpadOverlay");
	const header = document.getElementById("mobile-header");

	touchpadActive = true;
	touchpadMode = mode;
	overlay.classList.add("active");
	overlay.classList.toggle("keyboard-mode", mode === "keyboard");
	header.classList.add("hidden");

	updateModeBtns(mode);
}

function setTouchpadSensitivity(sensitivity) {
	MOUSE_SENSITIVITY = sensitivity;
	SCROLL_SENSITIVITY = sensitivity * 0.67;
}

let autoTypingActive = false;

function setAutoTypingActive(active) {
	autoTypingActive = !!active;
	const btn = document.getElementById("modeBtnKeyboard");
	if (btn) btn.classList.toggle("kb-disabled", !autoTypingActive);
}

function initTouchpad() {
	const overlay = document.getElementById("touchpadOverlay");
	const TAP_MAX_MS = 200;
	const DOUBLE_TAP_GAP_MS = 300;
	const MOVE_THRESHOLD = 8;
	let touchDownTime = 0;
	let touchDownX = 0;
	let touchDownY = 0;

	overlay.addEventListener(
		"touchstart",
		(e) => {
			if (e.target.closest(".touchpad-toolbar")) return;
			e.preventDefault();

			if (touchpadMode === "keyboard") {
				sendMessage("remote-key-press", {});
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
		},
		{ passive: false },
	);

	overlay.addEventListener(
		"touchmove",
		(e) => {
			e.preventDefault();
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
		},
		{ passive: false },
	);

	overlay.addEventListener(
		"touchend",
		(e) => {
			if (e.target.closest(".touchpad-toolbar")) return;
			e.preventDefault();

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

			if (e.touches.length > 0 && wasTwoFinger) return;
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
		},
		{ passive: false },
	);
}
