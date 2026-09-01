const WAKE_LOCK_RETRY_MS = 1000;
const KEEP_ALIVE_FRAME_MS = 1000;

let ws = null;
let messageHandler = null;
let wakeLock = null;
let wakeLockRetry = null;
let keepAliveVideo = null;
let reconnectTimer = null;

function setMessageHandler(handler) {
	messageHandler = handler;
}

function connect() {
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
	const host = window.location.host;
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	if (ws) {
		try {
			ws.close();
		} catch (e) {}
	}
	ws = new WebSocket(`${protocol}//${host}${window.location.search || ""}`);
	ws.onopen = () => requestWakeLock();
	ws.onmessage = (event) => {
		if (messageHandler) messageHandler(JSON.parse(event.data));
	};
	ws.onclose = () => {
		ws = null;
		reconnectTimer = setTimeout(connect, 2000);
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

document.addEventListener("click", function goFS() {
	const el = document.documentElement;
	const rfs =
		el.requestFullscreen ||
		el.webkitRequestFullscreen ||
		el.msRequestFullscreen;
	if (rfs) rfs.call(el).catch(() => {});
	document.removeEventListener("click", goFS);
});

document.addEventListener("visibilitychange", () => {
	if (document.visibilityState === "visible") {
		requestWakeLock();
		if (!ws || ws.readyState !== WebSocket.OPEN) connect();
	}
});

document.addEventListener("pointerdown", () => requestWakeLock());
document.addEventListener("fullscreenchange", () => requestWakeLock());
document.addEventListener("webkitfullscreenchange", () => requestWakeLock());
