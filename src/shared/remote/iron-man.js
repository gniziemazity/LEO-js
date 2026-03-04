let ironManActive = false;
let ironManGranted = false;
let ironManInitialized = false;
let ironManDragId = null;
let ironManFingerCount = 0;
let pinchStartDist = null;
let ironManPinchCenterX = null;
let ironManPinchCenterY = null;
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
let ironManRAF = null;
let ironManAutoEnabled = false;
let ironManActivatedAt = 0;
const IRON_MAN_GRACE_MS = 500;

const IM_TAP_MAX_MS = 200;
const IM_MOVE_THRESHOLD = 8;
let imTouchDownTime = 0;
let imTouchDownX = 0;
let imTouchDownY = 0;
let imOneFingerMoved = false;
let imMaxFingers = 0;

const IM_PINCH_DRAG_SENSITIVITY = 2.5;

const IRON_MAN_DEBUG = false;
let lastDebugTime = 0;

const MOVE_BUFFER_MS = 200;
let moveBuffer = [];
let lastBufferFingerCount = 0;

const FORCE_GAIN = 14.0;
const FRICTION = 0.9;
const FORCE_DEAD_ZONE = 0.12;
const FORCE_CAP = 0.6;
const VEL_CUTOFF = 0.2;
const SMOOTH = 0.3;

const GESTURE_THRESHOLD_DOWN = 6;
const GESTURE_THRESHOLD_UP = 6;

const CAL_DURATION_MS = 3000;

let ironManCalibrating = false;
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
			ironManGranted = perm === "granted";
		} catch (err) {
			ironManGranted = false;
		}
	} else {
		ironManGranted = true;
	}
}

function clampForce(v) {
	if (Math.abs(v) < FORCE_DEAD_ZONE) return 0;
	return Math.sign(v) * Math.min(Math.abs(v), FORCE_CAP);
}

function resetIronManState() {
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
	ironManPinchCenterX = null;
	ironManPinchCenterY = null;
	moveBuffer.length = 0;
}

function initIronMan() {
	if (ironManInitialized) return;
	ironManInitialized = true;

	window.addEventListener("devicemotion", (e) => {
		if (!ironManActive || ironManFingerCount >= 2) return;

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

		if (ironManCalibrating) {
			if (gestDeltaY > GESTURE_THRESHOLD_DOWN) {
				stopCalibration();
				gestureBaseY = null;
				velX = 0;
				velY = 0;
				forceX = 0;
				forceY = 0;
				moveBuffer.length = 0;
				ironManActivatedAt = Date.now();
				if (IRON_MAN_DEBUG) {
					sendMessage("iron-man-debug", { gesture: "ENABLE" });
				}
				return;
			}
			if (IRON_MAN_DEBUG) {
				const now = Date.now();
				if (now - lastDebugTime > 200) {
					lastDebugTime = now;
					sendMessage("iron-man-debug", {
						cal: true,
						dy: Math.round(gestDeltaY * 100) / 100,
					});
				}
			}
			return;
		}

		if (
			Date.now() - ironManActivatedAt >= IRON_MAN_GRACE_MS &&
			gestDeltaY < -GESTURE_THRESHOLD_UP
		) {
			if (IRON_MAN_DEBUG) {
				sendMessage("iron-man-debug", { gesture: "DISABLE" });
			}
			moveBuffer.length = 0;
			autoDisableIronMan();
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

		if (IRON_MAN_DEBUG) {
			const now = Date.now();
			if (now - lastDebugTime > 200) {
				lastDebugTime = now;
				sendMessage("iron-man-debug", {
					dx: Math.round(forceX * 100) / 100,
					dy: Math.round(forceY * 100) / 100,
				});
			}
		}
	});

	function physicsTick() {
		ironManRAF = requestAnimationFrame(physicsTick);
		if (!ironManActive) return;

		const now = Date.now();
		const cutoff = now - MOVE_BUFFER_MS;
		const flushType =
			ironManFingerCount === 1
				? "mouse-move"
				: ironManFingerCount === 0
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

		if (ironManFingerCount <= 1) {
			if (now - ironManActivatedAt < IRON_MAN_GRACE_MS) return;
			moveBuffer.push({ dx, dy, time: now });
		}
	}

	ironManRAF = requestAnimationFrame(physicsTick);
}

function ironManTouchStart(e) {
	if (e.touches.length !== ironManFingerCount) moveBuffer.length = 0;
	ironManFingerCount = e.touches.length;
	if (e.touches.length === 2) {
		ironManDragId = null;
		pinchStartDist = Math.hypot(
			e.touches[1].clientX - e.touches[0].clientX,
			e.touches[1].clientY - e.touches[0].clientY,
		);
		ironManPinchCenterX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
		ironManPinchCenterY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
	} else {
		pinchStartDist = null;
		ironManPinchCenterX = null;
		ironManPinchCenterY = null;
	}

	// Tap detection
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

function ironManTouchMove(e) {
	if (e.touches.length !== ironManFingerCount) moveBuffer.length = 0;
	ironManFingerCount = e.touches.length;

	if (e.touches.length === 1 && !imOneFingerMoved) {
		const t = e.touches[0];
		const totalDx = Math.abs(t.clientX - imTouchDownX);
		const totalDy = Math.abs(t.clientY - imTouchDownY);
		if (totalDx > IM_MOVE_THRESHOLD || totalDy > IM_MOVE_THRESHOLD) {
			imOneFingerMoved = true;
		}
	}

	if (e.touches.length >= 2 && pinchStartDist !== null && pinchStartDist > 0) {
		const dist = Math.hypot(
			e.touches[1].clientX - e.touches[0].clientX,
			e.touches[1].clientY - e.touches[0].clientY,
		);
		const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
		const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
		const now = Date.now();
		if (now - lastSendTime >= SEND_THROTTLE_MS) {
			lastSendTime = now;
			sendMessage("window-resize", { scale: dist / pinchStartDist });
			if (ironManPinchCenterX !== null && ironManPinchCenterY !== null) {
				const dragDx =
					(cx - ironManPinchCenterX) *
					MOUSE_SENSITIVITY *
					IM_PINCH_DRAG_SENSITIVITY;
				const dragDy =
					(cy - ironManPinchCenterY) *
					MOUSE_SENSITIVITY *
					IM_PINCH_DRAG_SENSITIVITY;
				const rotated = rotateForSide(dragDx, dragDy);
				if (Math.abs(rotated.dx) > 0.5 || Math.abs(rotated.dy) > 0.5) {
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
}

function ironManTouchEnd(e) {
	if (e.touches.length !== ironManFingerCount) moveBuffer.length = 0;
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

async function autoEnableIronMan() {
	if (ironManActive) return;
	ironManAutoEnabled = true;
	await setTouchpadMode("iron-man");
}

function autoDisableIronMan() {
	if (!ironManActive) return;
	ironManAutoEnabled = false;
	stopCalibration();
	deactivateTouchpad();
	updateModeBtns(null);
}

function startCalibration() {
	ironManCalibrating = true;
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
	ironManCalibrating = false;
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

	if (IRON_MAN_DEBUG) {
		sendMessage("iron-man-debug", { calResult: "TIMEOUT" });
	}

	autoDisableIronMan();
}

function showCalibrationCountdown(seconds) {
	const el = document.getElementById("ironManCountdown");
	if (!el) return;
	el.textContent = seconds;
	el.style.display = "flex";
}

function hideCalibrationCountdown() {
	const el = document.getElementById("ironManCountdown");
	if (!el) return;
	el.style.display = "none";
	el.textContent = "";
}
