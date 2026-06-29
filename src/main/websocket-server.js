const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const os = require("os");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const QRCode = require("qrcode");
const qrcode = require("qrcode-terminal");
const EventEmitter = require("events");
const plugin = require("./plugin");

function clampNum(v, max) {
	const n = Number(v);
	if (!Number.isFinite(n)) return 0;
	return Math.max(-max, Math.min(max, n));
}

function clampScale(v) {
	const n = Number(v);
	if (!Number.isFinite(n) || n <= 0) return 1;
	return Math.max(0.1, Math.min(10, n));
}

class LEOBroadcastServer extends EventEmitter {
	constructor(port = 8080) {
		super();
		this.port = port;
		this.token = this._loadOrCreateDailyToken();
		this.app = express();
		this.server = null;
		this.wss = null;
		this.currentState = {
			progress: 0,
			isActive: false,
			totalSteps: 0,
			currentStep: 0,
			lessonName: "No lesson loaded",
			lessonData: null,
			settings: null,
			activeQuestion: null,
			students: [],
			timeRemaining: null,
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
		this.wss.on("connection", (ws) => {
			console.log("Client connected: " + ws._socket.remoteAddress);
			ws.send(JSON.stringify({ type: "state", data: this.currentState }));
			ws.on("message", (message) => {
				try {
					const data = JSON.parse(message);
					this.handleClientMessage(data);
				} catch (err) {
					console.error("Error parsing client message:", err);
				}
			});
			ws.on("close", () => {
				this.emit("client-disconnected");
			});
		});

		this.server.listen(this.port, () => {
			console.log("LEO Server Started");
			this.printLocalIPs();
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
					console.log(`Client Viewer URL: ${url}`);
					qrcode.generate(url);
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

	updateLessonName(lessonName) {
		this.currentState.lessonName = lessonName;
		this.broadcast({ type: "lesson", data: { lessonName } });
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
		this.broadcast({ type: "question-ended", data: {} });
	}

	broadcastMoveToStarted(payload) {
		this.currentState.activeMoveTo = payload;
		this.broadcast({ type: "move-to-started", data: payload });
	}

	broadcastMoveToEnded() {
		this.currentState.activeMoveTo = null;
		this.broadcast({ type: "move-to-ended", data: {} });
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

	signalFloatingWindowOpen() {
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
		const handlers = {
			"toggle-active": () => this.emit("client-toggle-active"),
			"jump-to": (data) =>
				this.emit(
					"client-jump-to",
					Math.max(0, Math.round(clampNum(data.stepIndex, 1e7))),
				),
			interaction: (data) =>
				this.emit("client-interaction", data.interactionType),
			"student-answered": (data) =>
				this.emit("client-student-answered", data.studentName),
			"student-interaction": (data) =>
				this.emit(
					"client-student-interaction",
					data.interactionType,
					data.studentName,
					data.questionText || null,
					data.openedAt || null,
					data.closedAt || null,
				),
			"show-student-interaction": (data) =>
				this.emit(
					"client-show-student-interaction",
					data.interactionType,
					data.studentName,
					data.questionText || null,
					data.openedAt || null,
				),
			"move-to-confirmed": () => this.emit("client-move-to-confirmed"),
			"show-question": () => this.emit("client-show-question"),
			"interaction-overlay-shown": () =>
				this.emit("client-interaction-overlay-shown"),
			"interaction-overlay-closed": () =>
				this.emit("client-interaction-overlay-closed"),
			"close-student-interaction": (data) =>
				this.emit(
					"client-close-student-interaction",
					data.interactionType,
					data.studentName,
					data.questionText || null,
					data.openedAt || null,
					data.closedAt || null,
				),
			"mouse-move": (data) =>
				this.emit(
					"client-mouse-move",
					clampNum(data.dx, 5000),
					clampNum(data.dy, 5000),
				),
			"window-drag": (data) =>
				this.emit(
					"client-window-drag",
					clampNum(data.dx, 10000),
					clampNum(data.dy, 10000),
				),
			"window-resize": (data) =>
				this.emit(
					"client-window-resize",
					clampScale(data.scaleX ?? data.scale),
					clampScale(data.scaleY ?? data.scale),
				),
			"window-pinch": (data) =>
				this.emit(
					"client-window-pinch",
					clampScale(data.scale),
					clampNum(data.dx, 10000),
					clampNum(data.dy, 10000),
				),
			"mouse-click": (data) =>
				this.emit(
					"client-mouse-click",
					data.button === "right" ? "right" : "left",
				),
			"mouse-scroll": (data) =>
				this.emit("client-mouse-scroll", clampNum(data.dy, 5000)),
			"mouse-drag-start": () => this.emit("client-mouse-drag-start"),
			"mouse-drag-end": () => this.emit("client-mouse-drag-end"),
			"timer-start": () => this.emit("client-timer-start"),
			"timer-stop": () => this.emit("client-timer-stop"),
			"timer-adjust": (data) =>
				this.emit("client-timer-adjust", clampNum(data.minutes, 600)),
			"remote-key-press": () => this.emit("client-remote-key-press"),
			"dismiss-question": () => this.emit("client-dismiss-question"),
			"question-randomize": () => this.emit("client-question-randomize"),
			"question-show-options": () =>
				this.emit("client-question-show-options"),
		};
		const h = handlers[type];
		if (h) h(data);
		else if (plugin.onClientMessage) plugin.onClientMessage(type, data, this);
	}

	async getServerInfo() {
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
						console.error("Error generating QR code:", err);
					}
				}
			}
		}
		return serverInfos;
	}
}

module.exports = LEOBroadcastServer;
