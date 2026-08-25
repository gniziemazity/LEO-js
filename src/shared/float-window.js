(function () {
	const { ipcRenderer } = require("electron");

	const RESIZE_EDGES = [
		["n", "top"],
		["s", "bottom"],
		["w", "left"],
		["e", "right"],
		["nw", "top-left"],
		["ne", "top-right"],
		["sw", "bottom-left"],
		["se", "bottom-right"],
	];

	function addResizeHandles() {
		const frag = document.createDocumentFragment();
		for (const [corner, edge] of RESIZE_EDGES) {
			const el = document.createElement("div");
			el.className = "resize-handle resize-" + corner;
			el.dataset.edge = edge;
			frag.appendChild(el);
		}
		document.body.insertBefore(frag, document.body.firstChild);
	}

	function wireResize() {
		document.querySelectorAll(".resize-handle").forEach((el) => {
			el.addEventListener("mousedown", (e) => {
				e.preventDefault();
				ipcRenderer.send("start-resizing", el.dataset.edge);
			});
		});
		window.addEventListener("mouseup", () =>
			ipcRenderer.send("end-resizing"),
		);
	}

	function wireKeys(closeChannel, devtoolsChannel) {
		document.addEventListener("keydown", (e) => {
			if (e.key === "Escape") ipcRenderer.send(closeChannel);
			if (e.ctrlKey && (e.key === "i" || e.key === "I")) {
				e.preventDefault();
				ipcRenderer.send(devtoolsChannel);
			}
		});
	}

	function wirePin(pinChannel) {
		const pinBtn = document.getElementById("pinBtn");
		if (!pinBtn) return () => {};
		let pinned = false;
		function setPin(value) {
			if (pinned === value) return;
			pinned = value;
			pinBtn.classList.toggle("pinned", pinned);
			ipcRenderer.send(pinChannel, pinned);
		}
		pinBtn.addEventListener("click", () => setPin(!pinned));
		return setPin;
	}

	function initFloatWindow(opts) {
		const o = opts || {};
		addResizeHandles();
		wireResize();
		wireKeys(o.close, o.devtools);
		return { setPin: o.pin ? wirePin(o.pin) : () => {} };
	}

	window.initFloatWindow = initFloatWindow;
})();
