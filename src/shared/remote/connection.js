const WAKE_LOCK_RETRY_MS = 1000;
const KEEP_ALIVE_FRAME_MS = 1000;
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 15000;

let ws = null;
let messageHandler = null;
let wakeLock = null;
let wakeLockRetry = null;
let keepAliveVideo = null;
let reconnectTimer = null;
let reconnectDelay = RECONNECT_BASE_MS;
let connectionHandler = null;

function setMessageHandler(handler) {
	messageHandler = handler;
}

function setConnectionHandler(handler) {
	connectionHandler = handler;
}

function reportConnection(connected) {
	if (connectionHandler) connectionHandler(connected);
}

function discard(sock) {
	if (!sock) return;
	sock.onopen = null;
	sock.onmessage = null;
	sock.onclose = null;
	sock.onerror = null;
	try {
		sock.close();
	} catch (e) {}
}

function scheduleReconnect() {
	if (reconnectTimer) return;
	const delay = reconnectDelay;
	reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
	reconnectTimer = setTimeout(() => {
		reconnectTimer = null;
		connect();
	}, delay);
}

function connect() {
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
	const host = window.location.host;
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";

	discard(ws);
	ws = null;

	const sock = new WebSocket(
		`${protocol}//${host}${window.location.search || ""}`,
	);
	ws = sock;

	sock.onopen = () => {
		if (ws !== sock) return;
		reconnectDelay = RECONNECT_BASE_MS;
		reportConnection(true);
		requestWakeLock();
	};
	sock.onmessage = (event) => {
		if (ws !== sock) return;
		if (messageHandler) messageHandler(JSON.parse(event.data));
	};
	sock.onerror = () => {
		if (ws !== sock) return;
		reportConnection(false);
	};
	sock.onclose = () => {
		if (ws !== sock) return;
		ws = null;
		reportConnection(false);
		scheduleReconnect();
	};
}

function sendMessage(type, data) {
	if (ws && ws.readyState === WebSocket.OPEN)
		ws.send(JSON.stringify({ type, data }));
}

async function requestWakeLock() {
	if (!("wakeLock" in navigator)) {
		startScreenKeepAlive();
		return;
	}
	if (wakeLock || document.visibilityState !== "visible") return;
	try {
		wakeLock = await navigator.wakeLock.request("screen");
		wakeLock.addEventListener("release", () => {
			wakeLock = null;
			scheduleWakeLockRetry();
		});
	} catch (e) {
		wakeLock = null;
	}
}

function scheduleWakeLockRetry() {
	if (wakeLockRetry || document.visibilityState !== "visible") return;
	wakeLockRetry = setTimeout(() => {
		wakeLockRetry = null;
		requestWakeLock();
	}, WAKE_LOCK_RETRY_MS);
}

function startScreenKeepAlive() {
	if (keepAliveVideo) {
		const resumed = keepAliveVideo.play();
		if (resumed && resumed.catch) resumed.catch(() => {});
		return;
	}
	const canvas = document.createElement("canvas");
	canvas.width = 2;
	canvas.height = 2;
	const ctx = canvas.getContext && canvas.getContext("2d");
	if (!ctx || !canvas.captureStream) return;
	let shade = 0;
	setInterval(() => {
		shade ^= 1;
		ctx.fillStyle = shade ? "#000000" : "#010101";
		ctx.fillRect(0, 0, 2, 2);
	}, KEEP_ALIVE_FRAME_MS);
	const video = document.createElement("video");
	video.muted = true;
	video.defaultMuted = true;
	video.loop = true;
	video.setAttribute("muted", "");
	video.setAttribute("playsinline", "");
	video.setAttribute("aria-hidden", "true");
	video.style.cssText =
		"position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
	video.srcObject = canvas.captureStream(1);
	document.body.appendChild(video);
	keepAliveVideo = video;
	const started = video.play();
	if (started && started.catch) started.catch(() => {});
}

function lockPortrait() {
	const orientation = window.screen && window.screen.orientation;
	if (!orientation || typeof orientation.lock !== "function") return;
	const locking = orientation.lock("portrait");
	if (locking && locking.catch) locking.catch(() => {});
}

function goFullscreen() {
	if (document.fullscreenElement || document.webkitFullscreenElement) {
		lockPortrait();
		return;
	}
	const el = document.documentElement;
	const rfs =
		el.requestFullscreen ||
		el.webkitRequestFullscreen ||
		el.msRequestFullscreen;
	if (!rfs) return;
	const entering = rfs.call(el);
	if (entering && entering.then) entering.then(lockPortrait, () => {});
	else lockPortrait();
}

for (const gesture of ["pointerdown", "touchend", "click"]) {
	document.addEventListener(gesture, goFullscreen, { capture: true });
}

function socketIsLive() {
	return (
		ws &&
		(ws.readyState === WebSocket.OPEN ||
			ws.readyState === WebSocket.CONNECTING)
	);
}

document.addEventListener("visibilitychange", () => {
	if (document.visibilityState === "visible") {
		requestWakeLock();
		if (!socketIsLive()) connect();
	}
});

document.addEventListener("pointerdown", () => requestWakeLock());
document.addEventListener("fullscreenchange", () => {
	requestWakeLock();
	lockPortrait();
});
document.addEventListener("webkitfullscreenchange", () => requestWakeLock());
