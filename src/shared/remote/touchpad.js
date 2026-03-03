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
		"iron-man": "modeBtnIronMan",
	};
	for (const [m, id] of Object.entries(ids)) {
		const btn = document.getElementById(id);
		if (btn) btn.classList.toggle("mode-active", m === activeMode);
	}
	const container = document.getElementById("modeSideBtns");
	if (container) container.classList.toggle("has-active", !!activeMode);
}

function closeTouchpad() {
	const overlay = document.getElementById("touchpadOverlay");
	const header = document.getElementById("mobile-header");
	touchpadActive = false;
	overlay.classList.remove("active", "keyboard-mode", "iron-man-mode");
	header.classList.remove("hidden");
	if (isDragging) {
		isDragging = false;
		sendMessage("mouse-drag-end", {});
		overlay.classList.remove("dragging");
	}
	if (ironManActive) ironManActive = false;
	updateModeBtns(null);
}

async function setTouchpadMode(mode) {
	if (mode === "keyboard" && !autoTypingActive) return;
	const overlay = document.getElementById("touchpadOverlay");
	const header = document.getElementById("mobile-header");

	const alreadyActive =
		(mode === "iron-man" && ironManActive) ||
		(mode !== "iron-man" && touchpadActive && touchpadMode === mode);

	if (touchpadActive) {
		touchpadActive = false;
		overlay.classList.remove("active", "keyboard-mode");
		header.classList.remove("hidden");
		if (isDragging) {
			isDragging = false;
			sendMessage("mouse-drag-end", {});
			overlay.classList.remove("dragging");
		}
	}
	if (ironManActive) ironManActive = false;

	if (alreadyActive) {
		updateModeBtns(null);
		return;
	}

	if (mode === "iron-man") {
		if (!ironManGranted) await requestOrientationPermission();
		ironManActive = true;
		baseAccelX = null;
		baseAccelY = null;
		touchpadActive = true;
		overlay.classList.add("active", "iron-man-mode");
		header.classList.add("hidden");
		initIronMan();
	} else {
		touchpadActive = true;
		touchpadMode = mode;
		overlay.classList.add("active");
		overlay.classList.toggle("keyboard-mode", mode === "keyboard");
		header.classList.add("hidden");
	}

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

let ironManActive = false;
let ironManGranted = false;
let ironManInitialized = false;
let ironManDragId = null;
let ironManFingerCount = 0;
let pinchStartDist = null;
let ironManPinchCenterX = null;
let ironManPinchCenterY = null;
let lastDebugTime = 0;
let baseAccelX = null;
let baseAccelY = null;
let prevDeltaX = 0;
let prevDeltaY = 0;
let smoothDeltaX = 0;
let smoothDeltaY = 0;
let velX = 0;
let velY = 0;
let forceX = 0;
let forceY = 0;
let ironManRAF = null;
const FORCE_GAIN = 14.0; // how strongly change-in-tilt accelerates cursor
const FRICTION = 0.9; // velocity decay per frame (higher = glides longer)
const FORCE_DEAD_ZONE = 0.12; // ignore jitter in tilt-change below this
const FORCE_CAP = 0.6; // clamp force so big jolts don't overshoot
const VEL_CUTOFF = 0.2; // snap velocity to zero when this low
const SMOOTH = 0.4; // low-pass filter for accel input (lower = smoother)

async function requestOrientationPermission() {
	if (
		typeof DeviceMotionEvent !== "undefined" &&
		typeof DeviceMotionEvent.requestPermission === "function"
	) {
		try {
			const perm = await DeviceMotionEvent.requestPermission();
			ironManGranted = perm === "granted";
		} catch (err) {
			ironManGranted = false;
		}
	} else {
		ironManGranted = true;
	}
}

function initIronMan() {
	if (ironManInitialized) return;
	ironManInitialized = true;

	const handler = (e) => {
		if (!ironManActive) return;
		if (ironManFingerCount >= 2) return; // 2-finger touch handles movement

		const acc = e.accelerationIncludingGravity;
		if (!acc) return;

		const rawX = acc.x ?? 0;
		const rawY = acc.y ?? 0;

		if (baseAccelX === null) {
			baseAccelX = rawX;
			baseAccelY = rawY;
			prevDeltaX = 0;
			prevDeltaY = 0;
			smoothDeltaX = 0;
			smoothDeltaY = 0;
			velX = 0;
			velY = 0;
			forceX = 0;
			forceY = 0;
			return;
		}

		const deltaX = rawX - baseAccelX;
		const deltaY = rawY - baseAccelY;

		smoothDeltaX += SMOOTH * (deltaX - smoothDeltaX);
		smoothDeltaY += SMOOTH * (deltaY - smoothDeltaY);

		const ddx = smoothDeltaX - prevDeltaX;
		const ddy = smoothDeltaY - prevDeltaY;
		prevDeltaX = smoothDeltaX;
		prevDeltaY = smoothDeltaY;

		const clamp = (v) =>
			Math.abs(v) < FORCE_DEAD_ZONE
				? 0
				: Math.sign(v) * Math.min(Math.abs(v), FORCE_CAP);
		forceX = clamp(ddx);
		forceY = clamp(ddy);

		const now = Date.now();
		if (now - lastDebugTime > 200) {
			lastDebugTime = now;
			sendMessage("iron-man-debug", {
				dx: Math.round(forceX * 100) / 100,
				dy: Math.round(forceY * 100) / 100,
			});
		}
	};

	function physicsTick() {
		ironManRAF = requestAnimationFrame(physicsTick);
		if (!ironManActive) return;

		velX += forceX * FORCE_GAIN;
		velY += -forceY * FORCE_GAIN;

		forceX = 0;
		forceY = 0;

		velX *= FRICTION;
		velY *= FRICTION;

		if (Math.abs(velX) < VEL_CUTOFF && Math.abs(velY) < VEL_CUTOFF) {
			velX = 0;
			velY = 0;
			return;
		}

		const dx = Math.round(velX);
		const dy = Math.round(velY);
		if (dx === 0 && dy === 0) return;

		if (ironManFingerCount === 1) {
			sendMessage("mouse-move", { dx, dy });
		} else if (ironManFingerCount === 0) {
			sendMessage("window-drag", { dx, dy });
		}
	}

	ironManRAF = requestAnimationFrame(physicsTick);
	window.addEventListener("devicemotion", handler);
}

async function toggleIronMan() {
	setTouchpadMode("iron-man");
}

function initTouchpad() {
	const overlay = document.getElementById("touchpadOverlay");
	const TAP_MAX_MS = 200;
	const DOUBLE_TAP_GAP_MS = 300;
	const MOVE_THRESHOLD = 8;
	let touchDownTime = 0;
	let touchDownX = 0;
	let touchDownY = 0;

	initIronMan();

	overlay.addEventListener(
		"touchstart",
		(e) => {
			if (e.target.closest(".touchpad-toolbar")) return;
			e.preventDefault();

			if (touchpadMode === "keyboard") {
				sendMessage("remote-key-press", {});
				return;
			}

			if (ironManActive) {
				ironManFingerCount = e.touches.length;
				if (e.touches.length === 2) {
					ironManDragId = null;
					pinchStartDist = Math.hypot(
						e.touches[1].clientX - e.touches[0].clientX,
						e.touches[1].clientY - e.touches[0].clientY,
					);
					ironManPinchCenterX =
						(e.touches[0].clientX + e.touches[1].clientX) / 2;
					ironManPinchCenterY =
						(e.touches[0].clientY + e.touches[1].clientY) / 2;
				} else {
					pinchStartDist = null;
					ironManPinchCenterX = null;
					ironManPinchCenterY = null;
				}
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

			if (ironManActive) {
				ironManFingerCount = e.touches.length;
				if (
					e.touches.length >= 2 &&
					pinchStartDist !== null &&
					pinchStartDist > 0
				) {
					const dist = Math.hypot(
						e.touches[1].clientX - e.touches[0].clientX,
						e.touches[1].clientY - e.touches[0].clientY,
					);
					const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
					const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
					const now = Date.now();
					if (now - lastSendTime >= SEND_THROTTLE_MS) {
						lastSendTime = now;
						sendMessage("window-resize", {
							scale: dist / pinchStartDist,
						});
						if (
							ironManPinchCenterX !== null &&
							ironManPinchCenterY !== null
						) {
							const dragDx =
								(cx - ironManPinchCenterX) * MOUSE_SENSITIVITY;
							const dragDy =
								(cy - ironManPinchCenterY) * MOUSE_SENSITIVITY;
							const rotated = rotateForSide(dragDx, dragDy);
							if (
								Math.abs(rotated.dx) > 0.5 ||
								Math.abs(rotated.dy) > 0.5
							) {
								sendMessage("window-drag", {
									dx: Math.round(rotated.dx),
									dy: Math.round(rotated.dy),
								});
							}
						}
					}
					pinchStartDist = dist;
					ironManPinchCenterX = cx;
					ironManPinchCenterY = cy;
				}
				return;
			}

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

			if (ironManActive) {
				ironManFingerCount = e.touches.length;
				if (e.touches.length < 2) {
					pinchStartDist = null;
					ironManPinchCenterX = null;
					ironManPinchCenterY = null;
				}
				if (e.touches.length === 2) {
					pinchStartDist = Math.hypot(
						e.touches[1].clientX - e.touches[0].clientX,
						e.touches[1].clientY - e.touches[0].clientY,
					);
				}
				return;
			}

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
