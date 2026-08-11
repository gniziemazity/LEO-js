let ws = null;
let messageHandler = null;
let wakeLock = null;
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
	try {
		if ("wakeLock" in navigator) {
			wakeLock = await navigator.wakeLock.request("screen");
			wakeLock.addEventListener("release", () => {
				wakeLock = null;
			});
		}
	} catch (e) {}
}

const IS_CONTROL_PANEL =
	new URLSearchParams(location.search).get("panel") === "1";
if (IS_CONTROL_PANEL) document.body.classList.add("panel-mode");

if (!IS_CONTROL_PANEL) {
	document.addEventListener("click", function goFS() {
		const el = document.documentElement;
		const rfs =
			el.requestFullscreen ||
			el.webkitRequestFullscreen ||
			el.msRequestFullscreen;
		if (rfs) rfs.call(el).catch(() => {});
		document.removeEventListener("click", goFS);
	});
}

document.addEventListener("visibilitychange", () => {
	if (document.visibilityState === "visible") {
		requestWakeLock();
		if (!ws || ws.readyState !== WebSocket.OPEN) connect();
	}
});
