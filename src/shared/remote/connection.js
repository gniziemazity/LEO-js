let ws = null;
let messageHandler = null;
let wakeLock = null;

function setMessageHandler(handler) {
	messageHandler = handler;
}

function connect() {
	const host = window.location.host;
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	if (ws) {
		try {
			ws.close();
		} catch (e) {}
	}
	ws = new WebSocket(`${protocol}//${host}`);
	ws.onopen = () => requestWakeLock();
	ws.onmessage = (event) => {
		if (messageHandler) messageHandler(JSON.parse(event.data));
	};
	ws.onclose = () => {
		ws = null;
		setTimeout(connect, 2000);
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
	} catch (e) {
		/* wake lock not supported or denied */
	}
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
