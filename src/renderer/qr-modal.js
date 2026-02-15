const { ipcRenderer } = require("electron");

class QRModalManager {
	constructor() {
		this.modal = document.getElementById("qrModal");
		this.showQrBtn = document.getElementById("showQrBtn");
		this.closeQrBtn = document.getElementById("closeQrModal");
		this.qrContainer = document.getElementById("qrCodeContainer");

		this.setupEventListeners();
	}

	setupEventListeners() {
		this.showQrBtn.addEventListener("click", () => this.showModal());
		this.closeQrBtn.addEventListener("click", () => this.hideModal());

		this.modal.addEventListener("click", (e) => {
			if (e.target === this.modal) {
				this.hideModal();
			}
		});

		document.addEventListener("keydown", (e) => {
			if (e.key === "Escape" && this.modal.style.display === "flex") {
				this.hideModal();
			}
		});
	}

	async showModal() {
		try {
			const serverInfos = await ipcRenderer.invoke("get-server-info");

			if (!serverInfos || serverInfos.length === 0) {
				this.qrContainer.innerHTML =
					'<p style="color: #e74c3c;">No network interfaces found</p>';
			} else {
				this.qrContainer.innerHTML = "";

				serverInfos.forEach((info) => {
					const infoDiv = document.createElement("div");
					infoDiv.className = "qr-info-item";

					const qrImg = document.createElement("img");
					qrImg.src = info.qrCodeDataUrl;
					qrImg.alt = "QR Code";
					qrImg.className = "qr-code-image";

					const urlDiv = document.createElement("div");
					urlDiv.className = "qr-url";

					const urlText = document.createElement("div");
					urlText.className = "qr-url-text";
					urlText.textContent = info.url;

					urlDiv.appendChild(urlText);

					infoDiv.appendChild(qrImg);
					infoDiv.appendChild(urlDiv);

					this.qrContainer.appendChild(infoDiv);
				});
			}

			this.modal.classList.add("active");
		} catch (error) {
			console.error("Error loading QR codes:", error);
			this.qrContainer.innerHTML =
				'<p style="color: #e74c3c;">Error loading QR codes</p>';
			this.modal.classList.add("active");
		}
	}

	hideModal() {
		this.modal.classList.remove("active");
	}
}

module.exports = QRModalManager;
