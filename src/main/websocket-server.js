const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const os = require("os");
const path = require("path");
const qrcode = require("qrcode-terminal");
const QRCode = require("qrcode");
const EventEmitter = require("events");

class LEOBroadcastServer extends EventEmitter {
	constructor(port = 8080) {
		super();
		this.port = port;
		this.app = express();
		this.server = http.createServer(this.app);
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
		};
	}

	start() {
		this.app.get("/", (req, res) => {
			res.sendFile(path.join(__dirname, "../remote.html"));
		});
		this.app.use(express.static(__dirname + "/../shared/"));

		this.wss = new WebSocket.Server({ server: this.server });
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
		});

		this.server.listen(this.port, () => {
			console.log("LEO Server Started");
			this.printLocalIPs();
		});
	}

	printLocalIPs() {
		const interfaces = os.networkInterfaces();
		Object.keys(interfaces).forEach((ifname) => {
			interfaces[ifname].forEach((iface) => {
				if (iface.family === "IPv4" && !iface.internal) {
					const url = `http://${iface.address}:${this.port}`;
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

	broadcastQuestionStarted(question, students, bgColor) {
		this.currentState.activeQuestion = question;
		if (students && students.length) this.currentState.students = students;
		this.broadcast({
			type: "question-started",
			data: { question, students: this.currentState.students, bgColor },
		});
	}

	broadcastQuestionEnded() {
		this.currentState.activeQuestion = null;
		this.broadcast({ type: "question-ended", data: {} });
	}

	handleClientMessage(message) {
		const { type, data } = message;
		if (type === "toggle-active") {
			this.emit("client-toggle-active");
		} else if (type === "jump-to") {
			this.emit("client-jump-to", data.stepIndex);
		} else if (type === "interaction") {
			this.emit("client-interaction", data.interactionType);
		} else if (type === "student-answered") {
			this.emit("client-student-answered", data.studentName);
		} else if (type === "student-interaction") {
			this.emit(
				"client-student-interaction",
				data.interactionType,
				data.studentName,
				data.questionText || null,
				data.openedAt || null,
				data.closedAt || null,
			);
		}
	}

	async getServerInfo() {
		const interfaces = os.networkInterfaces();
		const serverInfos = [];
		for (const ifname of Object.keys(interfaces)) {
			for (const iface of interfaces[ifname]) {
				if (iface.family === "IPv4" && !iface.internal) {
					const url = `http://${iface.address}:${this.port}`;
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
