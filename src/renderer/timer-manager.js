const { TIMER_CONFIG } = require("../shared/constants");

class TimerManager {
   constructor() {
      this.interval = null;
      this.seconds = 0;
      this.isRunning = false;
      this.onTickCallback = null;
      this.onCompleteCallback = null;
   }

   stop() {
      if (this.interval) {
         clearInterval(this.interval);
         this.interval = null;
      }
      this.seconds = 0;
      this.isRunning = false;
   }

   complete() {
      this.stop();

      if (typeof require !== "undefined") {
         const { ipcRenderer } = require("electron");
         ipcRenderer.send("broadcast-timer", null);
      }

      if (this.onCompleteCallback) {
         this.onCompleteCallback();
      }
   }

   start(minutes = TIMER_CONFIG.DEFAULT_MINUTES) {
      if (this.isRunning) {
         this.stop();
      }

      this.seconds = minutes * 60;
      this.isRunning = true;

      this.interval = setInterval(() => {
         this.seconds--;
         
         const timeString = this.getFormattedTime();

         if (this.onTickCallback) {
            this.onTickCallback(timeString);
         }

         if (typeof require !== "undefined") {
            const { ipcRenderer } = require("electron");
            ipcRenderer.send("broadcast-timer", timeString);
         }

         if (this.seconds <= 0) {
            this.complete();
         }
      }, 1000);

      const initialTime = this.getFormattedTime();
      if (this.onTickCallback) this.onTickCallback(initialTime);
      if (typeof require !== "undefined") {
         require("electron").ipcRenderer.send("broadcast-timer", initialTime);
      }
   }

   adjust(minutes) {
      this.seconds += minutes * 60;

      if (this.seconds <= 0) {
         this.complete();
      } else {
         const timeString = this.getFormattedTime();
         if (this.onTickCallback) {
            this.onTickCallback(timeString);
         }
         // so the phone updates when you click +/-
         if (typeof require !== "undefined") {
            require("electron").ipcRenderer.send("broadcast-timer", timeString);
         }
      }
   }

   getFormattedTime() {
      const hours = Math.floor(this.seconds / 3600);
      const minutes = Math.floor((this.seconds % 3600) / 60);
      const seconds = this.seconds % 60;

      if (hours > 0) {
         return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
      } else {
         return `${minutes}:${seconds.toString().padStart(2, "0")}`;
      }
   }

   getRemainingSeconds() {
      return this.seconds;
   }

   onTick(callback) {
      this.onTickCallback = callback;
   }

   onComplete(callback) {
      this.onCompleteCallback = callback;
   }

   reset() {
      this.stop();
   }
}

module.exports = TimerManager;