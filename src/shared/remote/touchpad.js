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

function toggleTouchpad() {
	touchpadActive = !touchpadActive;
	const overlay = document.getElementById("touchpadOverlay");
	const sideBtn = document.getElementById("touchpadSideBtn");
	const header = document.getElementById("mobile-header");

	overlay.classList.toggle("active", touchpadActive);
	if (sideBtn) sideBtn.classList.toggle("btn-touchpad-active", touchpadActive);
	header.classList.toggle("hidden", touchpadActive);

	if (!touchpadActive && isDragging) {
		isDragging = false;
		sendMessage("mouse-drag-end", {});
		overlay.classList.remove("dragging");
	}
}

function toggleTouchpadMode() {
	const modeBtn = document.getElementById("modeBtn");
	const overlay = document.getElementById("touchpadOverlay");
	if (touchpadMode === "mouse") {
		touchpadMode = "keyboard";
		modeBtn.innerHTML = '<span class="tb-emoji">⌨️</span> Keyboard';
		overlay.classList.add("keyboard-mode");
	} else {
		touchpadMode = "mouse";
		modeBtn.innerHTML = '<span class="tb-emoji">🖱️</span> Mouse';
		overlay.classList.remove("keyboard-mode");
	}
}

function setTouchpadSensitivity(sensitivity) {
	MOUSE_SENSITIVITY = sensitivity;
	SCROLL_SENSITIVITY = sensitivity * 0.67;
}

let threeFingerActive = false;
let accelGranted = false;
let velX = 0;
let velY = 0;
const VEL_DECAY = 0.75; // friction: velocity decays to 0 when phone stops moving

async function requestMotionPermission() {
	if (
		typeof DeviceMotionEvent !== "undefined" &&
		typeof DeviceMotionEvent.requestPermission === "function"
	) {
		try {
			const perm = await DeviceMotionEvent.requestPermission();
			accelGranted = perm === "granted";
		} catch (err) {
			accelGranted = false;
		}
	} else {
		accelGranted = true;
	}
}

function initAccelerometer() {
	const handler = (e) => {
		if (!threeFingerActive) return;
		const a = e.acceleration; // without gravity — pure translation
		if (!a) return;

		const ax = a.x ?? 0;
		const ay = a.y ?? 0;

		// Integrate acceleration into velocity, then apply decay
		// Phone flat in portrait: x = left/right, y = top/bottom of phone
		// Negate ay so sliding phone away from you moves cursor up
		velX = (velX + ax * MOUSE_SENSITIVITY * 0.4) * VEL_DECAY;
		velY = (velY - ay * MOUSE_SENSITIVITY * 0.4) * VEL_DECAY;

		const dx = Math.round(velX);
		const dy = Math.round(velY);

		if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
			sendMessage("mouse-move", { dx, dy });
		}
	};

	window.addEventListener("devicemotion", handler);
}

function initTouchpad() {
	const overlay = document.getElementById("touchpadOverlay");
	const TAP_MAX_MS = 200;
	const DOUBLE_TAP_GAP_MS = 300;
	const MOVE_THRESHOLD = 8;
	let touchDownTime = 0;
	let touchDownX = 0;
	let touchDownY = 0;

	initAccelerometer();

	overlay.addEventListener(
		"touchstart",
		(e) => {
			if (e.target.closest(".touchpad-toolbar")) return;
			e.preventDefault();

			if (touchpadMode === "keyboard") {
				sendMessage("remote-key-press", {});
				return;
			}

			// Three-finger: activate accelerometer steering
			if (e.touches.length === 3) {
				threeFingerActive = true;
				velX = 0;
				velY = 0;
				overlay.classList.add("accel-mode");
				if (!accelGranted) requestMotionPermission();
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
			if (threeFingerActive) return; // accelerometer handles movement
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
				// For right-side (CCW rotation): moving finger up = rightward on screen = +dx → scroll up = -dx
				// For left-side (CW rotation): moving finger up = leftward on screen = -dx → scroll up = +dx
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

			// Release three-finger mode when all fingers lift
			if (threeFingerActive) {
				if (e.touches.length < 3) {
					threeFingerActive = false;
					velX = 0;
					velY = 0;
					overlay.classList.remove("accel-mode");
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
