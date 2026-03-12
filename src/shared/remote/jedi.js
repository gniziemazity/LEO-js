/* For Motion sensors:
chrome://flags/#unsafely-treat-insecure-origin-as-secure */

let jediActive = false;
let jediGranted = false;
let jediInitialized = false;
let jediDragId = null;
let jediFingerCount = 0;
let pinchStartDist = null;
let pinchStartSpanX = null;
let pinchStartSpanY = null;
let jediPinchCenterX = null;
let jediPinchCenterY = null;
let gestureBaseY = null;
const GESTURE_ADAPT_RATE = 0.02;
let prevDeltaX = 0;
let prevDeltaY = 0;
let smoothDeltaX = 0;
let smoothDeltaY = 0;
let velX = 0;
let velY = 0;
let forceX = 0;
let forceY = 0;
let jediRAF = null;
let jediAutoEnabled = false;
let jediActivatedAt = 0;
const JEDI_GRACE_MS = 500;

const IM_TAP_MAX_MS = 200;
const IM_MOVE_THRESHOLD = 8;
let imTouchDownTime = 0;
let imTouchDownX = 0;
let imTouchDownY = 0;
let imOneFingerMoved = false;
let imMaxFingers = 0;

const IM_PINCH_DRAG_SENSITIVITY = 2.5;

const JEDI_DEBUG = false;
let lastDebugTime = 0;

const MOVE_BUFFER_MS = 200;
let moveBuffer = [];
let lastBufferFingerCount = 0;

const FORCE_GAIN = 14.0;
const FRICTION = 0.9;
const FORCE_DEAD_ZONE = 0.03;
const FORCE_CAP = 0.6;
const VEL_CUTOFF = 0.2;
const SMOOTH = 0.3;

const GESTURE_THRESHOLD_DOWN = 6;
const GESTURE_THRESHOLD_UP = 6;

const CAL_DURATION_MS = 3000;

let jediCalibrating = false;
let calStartTime = 0;
let calTimer = null;
let calCountdownInterval = null;

async function requestOrientationPermission() {
	if (
		typeof DeviceMotionEvent !== "undefined" &&
		typeof DeviceMotionEvent.requestPermission === "function"
	) {
		try {
			const perm = await DeviceMotionEvent.requestPermission();
			jediGranted = perm === "granted";
		} catch (err) {
			jediGranted = false;
		}
	} else {
		jediGranted = true;
	}
}

function clampForce(v) {
	if (Math.abs(v) < FORCE_DEAD_ZONE) return 0;
	return Math.sign(v) * Math.min(Math.abs(v), FORCE_CAP);
}

function resetJediState() {
	gestureBaseY = null;
	prevDeltaX = 0;
	prevDeltaY = 0;
	smoothDeltaX = 0;
	smoothDeltaY = 0;
	velX = 0;
	velY = 0;
	forceX = 0;
	forceY = 0;
	pinchStartDist = null;
	pinchStartSpanX = null;
	pinchStartSpanY = null;
	jediPinchCenterX = null;
	jediPinchCenterY = null;
	moveBuffer.length = 0;
	jediFingerCount = 0;
}

function initJedi() {
	if (jediInitialized) return;
	jediInitialized = true;

	window.addEventListener("devicemotion", (e) => {
		if (!jediActive || jediFingerCount >= 2) return;

		const acc = e.accelerationIncludingGravity;
		if (!acc) return;

		const rawX = acc.x ?? 0;
		const rawY = acc.y ?? 0;

		if (gestureBaseY === null) {
			gestureBaseY = rawY;
			prevDeltaX = rawX;
			prevDeltaY = rawY;
			smoothDeltaX = rawX;
			smoothDeltaY = rawY;
			velX = 0;
			velY = 0;
			forceX = 0;
			forceY = 0;
			return;
		}

		gestureBaseY += GESTURE_ADAPT_RATE * (rawY - gestureBaseY);
		const gestDeltaY = rawY - gestureBaseY;

		if (jediCalibrating) {
			if (gestDeltaY > GESTURE_THRESHOLD_DOWN) {
				stopCalibration();
				gestureBaseY = null;
				velX = 0;
				velY = 0;
				forceX = 0;
				forceY = 0;
				moveBuffer.length = 0;
				jediActivatedAt = Date.now();
				if (JEDI_DEBUG) {
					sendMessage("jedi-debug", { gesture: "ENABLE" });
				}
				return;
			}
			if (JEDI_DEBUG) {
				const now = Date.now();
				if (now - lastDebugTime > 200) {
					lastDebugTime = now;
					sendMessage("jedi-debug", {
						cal: true,
						dy: Math.round(gestDeltaY * 100) / 100,
					});
				}
			}
			return;
		}

		if (
			Date.now() - jediActivatedAt >= JEDI_GRACE_MS &&
			gestDeltaY < -GESTURE_THRESHOLD_UP
		) {
			if (JEDI_DEBUG) {
				sendMessage("jedi-debug", { gesture: "DISABLE" });
			}
			moveBuffer.length = 0;
			autoDisableJedi();
			return;
		}

		smoothDeltaX += SMOOTH * (rawX - smoothDeltaX);
		smoothDeltaY += SMOOTH * (rawY - smoothDeltaY);

		const ddx = smoothDeltaX - prevDeltaX;
		const ddy = smoothDeltaY - prevDeltaY;
		prevDeltaX = smoothDeltaX;
		prevDeltaY = smoothDeltaY;

		forceX = clampForce(ddx);
		forceY = clampForce(ddy);

		if (JEDI_DEBUG) {
			const now = Date.now();
			if (now - lastDebugTime > 200) {
				lastDebugTime = now;
				sendMessage("jedi-debug", {
					dx: Math.round(forceX * 100) / 100,
					dy: Math.round(forceY * 100) / 100,
				});
			}
		}
	});

	function physicsTick() {
		jediRAF = requestAnimationFrame(physicsTick);
		if (!jediActive || jediCalibrating) return;
		const now = Date.now();
		const cutoff = now - MOVE_BUFFER_MS;
		const flushType =
			jediFingerCount === 1
				? "mouse-move"
				: jediFingerCount === 0
					? "window-drag"
					: null;
		while (moveBuffer.length > 0 && moveBuffer[0].time <= cutoff) {
			const msg = moveBuffer.shift();
			if (flushType) sendMessage(flushType, { dx: msg.dx, dy: msg.dy });
		}

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

		if (jediFingerCount <= 1) {
			if (now - jediActivatedAt < JEDI_GRACE_MS) return;
			moveBuffer.push({ dx, dy, time: now });
		}
	}

	jediRAF = requestAnimationFrame(physicsTick);
}

function jediTouchStart(e) {
	if (jediCalibrating) return;
	if (e.touches.length !== jediFingerCount) moveBuffer.length = 0;
	jediFingerCount = e.touches.length;
	if (e.touches.length === 2) {
		jediDragId = null;
		pinchStartDist = Math.hypot(
			e.touches[1].clientX - e.touches[0].clientX,
			e.touches[1].clientY - e.touches[0].clientY,
		);
		pinchStartSpanX = Math.abs(e.touches[1].clientX - e.touches[0].clientX);
		pinchStartSpanY = Math.abs(e.touches[1].clientY - e.touches[0].clientY);
		jediPinchCenterX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
		jediPinchCenterY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
	} else {
		pinchStartDist = null;
		pinchStartSpanX = null;
		pinchStartSpanY = null;
		jediPinchCenterX = null;
		jediPinchCenterY = null;
	}

	if (e.touches.length === 1) {
		const t = e.touches[0];
		imTouchDownX = t.clientX;
		imTouchDownY = t.clientY;
		imTouchDownTime = Date.now();
		imOneFingerMoved = false;
		imMaxFingers = 1;
	}
	if (e.touches.length === 2) {
		imMaxFingers = 2;
	}
}

function jediTouchMove(e) {
	if (jediCalibrating) return;
	if (e.touches.length !== jediFingerCount) moveBuffer.length = 0;
	jediFingerCount = e.touches.length;

	if (e.touches.length === 1 && !imOneFingerMoved) {
		const t = e.touches[0];
		const totalDx = Math.abs(t.clientX - imTouchDownX);
		const totalDy = Math.abs(t.clientY - imTouchDownY);
		if (totalDx > IM_MOVE_THRESHOLD || totalDy > IM_MOVE_THRESHOLD) {
			imOneFingerMoved = true;
		}
	}

	if (e.touches.length >= 2 && pinchStartSpanX !== null) {
		const spanX = Math.abs(e.touches[1].clientX - e.touches[0].clientX);
		const spanY = Math.abs(e.touches[1].clientY - e.touches[0].clientY);
		const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
		const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
		const now = Date.now();
		if (now - lastSendTime >= SEND_THROTTLE_MS) {
			lastSendTime = now;
			const MIN_SPAN = 20;
			const span = Math.sqrt(spanX * spanX + spanY * spanY);
			const pinchStartSpan = Math.sqrt(
				pinchStartSpanX * pinchStartSpanX +
					pinchStartSpanY * pinchStartSpanY,
			);
			const scale = pinchStartSpan >= MIN_SPAN ? span / pinchStartSpan : 1;
			let dx = 0,
				dy = 0;
			if (jediPinchCenterX !== null && jediPinchCenterY !== null) {
				const dragDx =
					(cx - jediPinchCenterX) *
					MOUSE_SENSITIVITY *
					IM_PINCH_DRAG_SENSITIVITY;
				const dragDy =
					(cy - jediPinchCenterY) *
					MOUSE_SENSITIVITY *
					IM_PINCH_DRAG_SENSITIVITY;
				const rotated = rotateForSide(dragDx, dragDy);
				dx = Math.round(rotated.dx);
				dy = Math.round(rotated.dy);
			}
			const hasResize = Math.abs(scale - 1) > 0.005;
			const hasDrag = Math.abs(dx) > 0 || Math.abs(dy) > 0;
			if (hasResize || hasDrag) {
				sendMessage("window-pinch", {
					scale: hasResize ? scale : 1,
					dx,
					dy,
				});
			}
			// Update references only after sending to avoid micro-drift between frames
			pinchStartSpanX = spanX;
			pinchStartSpanY = spanY;
			jediPinchCenterX = cx;
			jediPinchCenterY = cy;
		}
	}
}

function jediTouchEnd(e) {
	if (jediCalibrating) return;
	if (e.touches.length !== jediFingerCount) moveBuffer.length = 0;
	jediFingerCount = e.touches.length;
	if (e.touches.length < 2) {
		pinchStartDist = null;
		pinchStartSpanX = null;
		pinchStartSpanY = null;
		jediPinchCenterX = null;
		jediPinchCenterY = null;
	}
	if (e.touches.length === 2) {
		pinchStartDist = Math.hypot(
			e.touches[1].clientX - e.touches[0].clientX,
			e.touches[1].clientY - e.touches[0].clientY,
		);
	}

	if (e.touches.length === 0 && imTouchDownTime > 0) {
		const elapsed = Date.now() - imTouchDownTime;
		if (elapsed < IM_TAP_MAX_MS) {
			if (imMaxFingers >= 2) {
				sendMessage("mouse-click", { button: "right" });
			} else if (!imOneFingerMoved) {
				sendMessage("mouse-click", { button: "left" });
			}
		}
		imTouchDownTime = 0;
		imMaxFingers = 0;
	}
}

async function autoEnableJedi() {
	if (jediActive) return;
	jediAutoEnabled = true;
	await setTouchpadMode("jedi");
}

function autoDisableJedi() {
	if (!jediActive) return;
	jediAutoEnabled = false;
	stopCalibration();
	deactivateTouchpad();
	updateModeBtns(null);
}

function startCalibration() {
	jediCalibrating = true;
	calStartTime = Date.now();

	showCalibrationCountdown(3);

	calCountdownInterval = setInterval(() => {
		const elapsed = Date.now() - calStartTime;
		const remaining = Math.ceil((CAL_DURATION_MS - elapsed) / 1000);
		if (remaining > 0) {
			showCalibrationCountdown(remaining);
		}
	}, 1000);

	calTimer = setTimeout(() => {
		endCalibration();
	}, CAL_DURATION_MS);
}

function stopCalibration() {
	jediCalibrating = false;
	if (calTimer) {
		clearTimeout(calTimer);
		calTimer = null;
	}
	if (calCountdownInterval) {
		clearInterval(calCountdownInterval);
		calCountdownInterval = null;
	}
	hideCalibrationCountdown();
}

function endCalibration() {
	stopCalibration();

	if (JEDI_DEBUG) {
		sendMessage("jedi-debug", { calResult: "TIMEOUT" });
	}

	autoDisableJedi();
}

function showCalibrationCountdown(seconds) {
	const el = document.getElementById("jediCountdown");
	if (!el) return;
	el.textContent = seconds;
	el.style.display = "flex";
}

function hideCalibrationCountdown() {
	const el = document.getElementById("jediCountdown");
	if (!el) return;
	el.style.display = "none";
	el.textContent = "";
}
