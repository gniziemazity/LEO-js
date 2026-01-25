const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const os = require("os");
const path = require("path");
const qrcode = require("qrcode-terminal");
const EventEmitter = require('events');

class LEOBroadcastServer extends EventEmitter {
   constructor(port = 8080) {
      super();
      this.port = port;
      this.app = express();
      this.server = http.createServer(this.app);
      this.wss = null;
      this.currentState = {
         progress: 0,
         timeRemaining: null,
         isActive: false,
         totalSteps: 0,
         currentStep: 0,
         lessonName: "No lesson loaded",
         lessonData: null,
         settings: null,
      };
   }

   start() {
      this.app.get("/", (req, res) => {
         res.sendFile(path.join(__dirname, "../client-viewer.html"));
      });

      // serve other static files (like styles.css)
      this.app.use(express.static(__dirname + "/../shared/"));

      // setup WebSocket on the same server
      this.wss = new WebSocket.Server({ server: this.server });

      this.wss.on("connection", (ws) => {
         console.log("Client connected: " + ws._socket.remoteAddress);
         ws.send(JSON.stringify({ type: "state", data: this.currentState }));
         
         ws.on('message', (message) => {
            try {
               const data = JSON.parse(message);
               this.handleClientMessage(data);
            } catch (err) {
               console.error('Error parsing client message:', err);
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
         if (client.readyState === WebSocket.OPEN) {
            client.send(message);
         }
      });
   }

   updateLessonData(lessonData) {
      this.currentState.lessonData = lessonData;

      this.broadcast({
         type: "lesson-data",
         data: lessonData,
      });
   }

   updateCursor(currentStep) {
      this.currentState.currentStep = currentStep;

      this.broadcast({
         type: "cursor",
         data: { currentStep },
      });
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

   updateTimer(timeRemaining) {
      this.currentState.timeRemaining = timeRemaining;

      this.broadcast({
         type: "timer",
         data: { timeRemaining },
      });
   }

   updateActiveState(isActive) {
      this.currentState.isActive = isActive;

      this.broadcast({
         type: "active",
         data: { isActive },
      });
   }

   updateLessonName(lessonName) {
      this.currentState.lessonName = lessonName;

      this.broadcast({
         type: "lesson",
         data: { lessonName },
      });
   }

   updateSettings(settings) {
      this.currentState.settings = settings;

      this.broadcast({
         type: "settings",
         data: settings,
      });
   }

   handleClientMessage(message) {
      const { type, data } = message;
      
      if (type === 'toggle-active') {
         this.emit('client-toggle-active');
      } else if (type === 'jump-to') {
         this.emit('client-jump-to', data.stepIndex);
      }
   }
}

module.exports = LEOBroadcastServer;
