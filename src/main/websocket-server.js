const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const os = require("os");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const QRCode = require("qrcode");
const EventEmitter = require("events");
const plugin = require("./plugin");

function clampNum(v, max) {
	const n = Number(v);
	if (!Number.isFinite(n)) return 0;
	return Math.max(-max, Math.min(max, n));
}

const EDIT_KEYS = ["copy", "cut", "paste", "undo", "enter", "save"];

function clampScale(v) {
	const n = Number(v);
	if (!Number.isFinite(n) || n <= 0) return 1;
	return Math.max(0.1, Math.min(10, n));
}

const BARE_CLIENT_MESSAGES = [
	"toggle-active",
	"move-to-confirmed",
	"code-insert-confirmed",
	"code-insert-paste",
	"move-to-type-name",
	"interaction-overlay-shown",
	"interaction-overlay-closed",
	"mouse-drag-start",
	"mouse-drag-end",
	"timer-start",
	"timer-stop",
	"remote-key-press",
	"dismiss-question",
	"question-randomize",
	"question-show-options",
];

const FORWARDED_CLIENT_FIELDS = {
	interaction: ["interactionType"],
	"student-answered": ["studentName"],
	"student-interaction": [
		"interactionType",
		"studentName",
		"questionText?",
		"openedAt?",
		"closedAt?",
	],
	"show-student-interaction": [
		"interactionType",
		"studentName",
		"questionText?",
		"openedAt?",
	],
	"close-student-interaction": [
		"interactionType",
		"studentName",
		"questionText?",
		"openedAt?",
		"closedAt?",
	],
};

const CLIENT_MESSAGE_SANITIZERS = {
	"jump-to": (d) => [Math.max(0, Math.round(clampNum(d.stepIndex, 1e7)))],
	"show-question": (d) => [!d || d.animate !== false],
	"mouse-move": (d) => [clampNum(d.dx, 5000), clampNum(d.dy, 5000)],
	"mouse-click": (d) => [d.button === "right" ? "right" : "left"],
	"mouse-scroll": (d) => [clampNum(d.dy, 5000)],
	"window-drag": (d) => [clampNum(d.dx, 10000), clampNum(d.dy, 10000)],
	"window-resize": (d) => [
		clampScale(d.scaleX ?? d.scale),
		clampScale(d.scaleY ?? d.scale),
	],
	"window-pinch": (d) => [
		clampScale(d.scale),
		clampNum(d.dx, 10000),
		clampNum(d.dy, 10000),
	],
	"timer-adjust": (d) => [clampNum(d.minutes, 600)],
	"remote-edit-key": (d) => [
		EDIT_KEYS.includes(d && d.action) ? d.action : "copy",
	],
};

const CLIENT_MESSAGE_TYPES = new Set([
	...BARE_CLIENT_MESSAGES,
	...Object.keys(FORWARDED_CLIENT_FIELDS),
	...Object.keys(CLIENT_MESSAGE_SANITIZERS),
]);

function clientMessageArgs(type, data) {
	const sanitize = CLIENT_MESSAGE_SANITIZERS[type];
	if (sanitize) return sanitize(data);
	const fields = FORWARDED_CLIENT_FIELDS[type];
	if (!fields) return [];
	return fields.map((f) =>
		f.endsWith("?") ? data[f.slice(0, -1)] || null : data[f],
	);
}

class LEOBroadcastServer extends EventEmitter {
	constructor(port = 8080) {
		super();
		this.port = port;
		this.token = this._loadOrCreateDailyToken();
		this.app = express();
		this.server = null;
		this.wss = null;
		this.listening = false;
		this.currentState = {
			progress: 0,
			isActive: false,
			totalSteps: 0,
			currentStep: 0,
			lessonData: null,
			settings: null,
			activeQuestion: null,
			activeQuestionBgColor: null,
			activeQuestionOptions: [],
			students: [],
			timeRemaining: null,
			activeMoveTo: null,
			activeCodeInsert: null,
			floatingWindowCount: 0,
		};
	}

	_tokenPath() {
		return path.join(os.homedir(), ".leo-remote-token.json");
	}

	_localDateStr(d = new Date()) {
		const pad = (n) => String(n).padStart(2, "0");
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	}

	_loadOrCreateDailyToken() {
		const today = this._localDateStr();
		try {
			const data = JSON.parse(fs.readFileSync(this._tokenPath(), "utf8"));
			if (
				data &&
				data.date === today &&
				typeof data.token === "string" &&
				data.token
			) {
				return data.token;
			}
		} catch (e) {}
		const token = crypto.randomBytes(16).toString("hex");
		try {
			fs.writeFileSync(
				this._tokenPath(),
				JSON.stringify({ date: today, token }),
				"utf8",
			);
		} catch (e) {}
		return token;
	}

	async start() {
		this.app.get("/", (req, res) => {
			res.sendFile(path.join(__dirname, "../remote.html"));
		});
		this.app.use(express.static(__dirname + "/../shared/"));

		const custom = plugin.createServer
			? await plugin.createServer(this.app)
			: null;
		if (custom) {
			this.server = custom.server;
			this.protocol = custom.protocol || "https";
		} else {
			this.server = http.createServer(this.app);
			this.protocol = "http";
		}

		this.wss = new WebSocket.Server({
			server: this.server,
			verifyClient: (info) => this._verifyClient(info),
		});
		this.wss.on("error", (err) => {
			console.error(`[LEO] socket error: ${err.message}`);
		});
		this.wss.on("connection", (ws) => {
			console.log(`Client connected: ${ws._socket.remoteAddress}`);
			ws.send(JSON.stringify({ type: "state", data: this.currentState }));
			this.emit("client-connected");
			ws.on("message", (message) => {
				try {
					const data = JSON.parse(message);
					this.handleClientMessage(data);
				} catch (err) {
					console.error("[LEO] bad client message:", err);
				}
			});
			ws.on("close", () => {
				this.emit("client-disconnected");
			});
		});

		await this._listen();
	}

	_listen() {
		const MAX_PORT_ATTEMPTS = 10;
		let attempts = 0;
		return new Promise((resolve) => {
			const onError = (err) => {
				if (err.code === "EADDRINUSE" && ++attempts < MAX_PORT_ATTEMPTS) {
					console.log(`[LEO] port ${this.port} in use, trying next`);
					this.port++;
					this.server.listen(this.port);
					return;
				}
				this.server.removeListener("error", onError);
				this.server.removeListener("listening", onListening);
				this.listening = false;
				console.error(`[LEO] remote disabled: ${err.message}`);
				resolve();
			};
			const onListening = () => {
				this.server.removeListener("error", onError);
				this.listening = true;
				console.log("LEO ready");
				this.printLocalIPs();
				resolve();
			};
			this.server.on("error", onError);
			this.server.once("listening", onListening);
			this.server.listen(this.port);
		});
	}

	_verifyClient(info) {
		try {
			const reqUrl = new URL(info.req.url, "http://localhost");
			if (reqUrl.searchParams.get("t") !== this.token) return false;
			const origin = info.origin || info.req.headers.origin;
			if (origin && new URL(origin).host !== info.req.headers.host) {
				return false;
			}
			return true;
		} catch (e) {
			return false;
		}
	}

	remoteUrl(address) {
		const proto = this.protocol || "http";
		return `${proto}://${address}:${this.port}/?t=${this.token}`;
	}

	printLocalIPs() {
		const interfaces = os.networkInterfaces();
		Object.keys(interfaces).forEach((ifname) => {
			interfaces[ifname].forEach((iface) => {
				if (iface.family === "IPv4" && !iface.internal) {
					const url = this.remoteUrl(iface.address);
					console.log(`Remote: ${url}`);
				}
			});
		});
	}

	broadcast(data) {
		if (!this.wss) return;
		const message = JSON.stringify(data);
		this.wss.clients.forEach((client) => {
			if (client.readyState === WebSocket.OPEN) client.send(message);
		});
	}

	updateLessonData(lessonData) {
		this.currentState.lessonData = lessonData;
		this.broadcast({ type: "lesson-data", data: lessonData });
	}

	updateCursor(currentStep) {
		this.currentState.currentStep = currentStep;
		this.broadcast({ type: "cursor", data: { currentStep } });
	}

	updateProgress(currentStep, totalSteps) {
		this.currentState.currentStep = currentStep;
		this.currentState.totalSteps = totalSteps;
		this.currentState.progress =
			totalSteps > 0 ? (currentStep / totalSteps) * 100 : 0;
		this.broadcast({
			type: "progress",
			data: {
				progress: this.currentState.progress,
				currentStep,
				totalSteps,
			},
		});
	}

	updateActiveState(isActive) {
		this.currentState.isActive = isActive;
		this.broadcast({ type: "active", data: { isActive } });
	}

	updateSettings(settings) {
		this.currentState.settings = settings;
		this.broadcast({ type: "settings", data: settings });
	}

	updateStudents(students) {
		this.currentState.students = students || [];
		this.broadcast({
			type: "students",
			data: { students: this.currentState.students },
		});
	}

	broadcastQuestionStarted(question, students, bgColor, options) {
		this.currentState.activeQuestion = question;
		this.currentState.activeQuestionBgColor = bgColor || null;
		this.currentState.activeQuestionOptions = options || [];
		if (students && students.length) this.currentState.students = students;
		this.broadcast({
			type: "question-started",
			data: {
				question,
				students: this.currentState.students,
				bgColor,
				options: options || [],
			},
		});
	}

	broadcastQuestionEnded() {
		this.currentState.activeQuestion = null;
		this.currentState.activeQuestionBgColor = null;
		this.currentState.activeQuestionOptions = [];
		this.broadcast({ type: "question-ended", data: {} });
	}

	broadcastMoveToStarted(payload) {
		this.currentState.activeMoveTo = payload;
		this.broadcast({ type: "move-to-started", data: payload });
	}

	broadcastMoveToTyping(data) {
		this.broadcast({ type: "move-to-typing", data });
	}

	broadcastMoveToEnded() {
		this.currentState.activeMoveTo = null;
		this.broadcast({ type: "move-to-ended", data: {} });
	}

	broadcastCodeInsertStarted(payload) {
		this.currentState.activeCodeInsert = payload;
		this.broadcast({ type: "code-insert-started", data: payload });
	}

	broadcastCodeInsertEnded() {
		this.currentState.activeCodeInsert = null;
		this.broadcast({ type: "code-insert-ended", data: {} });
	}

	updateTimer(timeRemaining) {
		this.currentState.timeRemaining = timeRemaining;
		this.broadcast({ type: "timer-tick", data: { timeRemaining } });
	}

	clearTimer() {
		this.currentState.timeRemaining = null;
		this.broadcast({ type: "timer-stopped", data: {} });
	}

	broadcastFloatingWindowOpened() {
		this.currentState.floatingWindowCount =
			(this.currentState.floatingWindowCount || 0) + 1;
		this.broadcast({ type: "floating-window-opened", data: {} });
	}

	broadcastFloatingWindowReshown() {
		this.broadcast({ type: "floating-window-opened", data: {} });
	}

	broadcastFloatingWindowClosed() {
		this.currentState.floatingWindowCount = Math.max(
			0,
			(this.currentState.floatingWindowCount || 0) - 1,
		);
		if (this.currentState.floatingWindowCount === 0) {
			this.broadcast({ type: "floating-window-closed", data: {} });
		}
	}

	handleClientMessage(message) {
		const { type, data } = message;
		if (CLIENT_MESSAGE_TYPES.has(type)) {
			this.emit("client-" + type, ...clientMessageArgs(type, data || {}));
		} else if (plugin.onClientMessage) {
			plugin.onClientMessage(type, data, this);
		}
	}

	async getServerInfo() {
		if (!this.listening) return [];
		const interfaces = os.networkInterfaces();
		const serverInfos = [];
		for (const ifname of Object.keys(interfaces)) {
			for (const iface of interfaces[ifname]) {
				if (iface.family === "IPv4" && !iface.internal) {
					const url = this.remoteUrl(iface.address);
					try {
						const qrCodeDataUrl = await QRCode.toDataURL(url, {
							width: 300,
							margin: 2,
							color: { dark: "#000000", light: "#ffffff" },
						});
						serverInfos.push({ url, qrCodeDataUrl });
					} catch (err) {
						console.error("[LEO] QR failed:", err);
					}
				}
			}
		}
		return serverInfos;
	}
}

module.exports = LEOBroadcastServer;
module.exports.CLIENT_MESSAGE_TYPES = CLIENT_MESSAGE_TYPES;
