"use strict";

class LineChart {
	constructor(container, options = {}) {
		this._canvas = document.createElement("canvas");
		this._canvas.style.cssText = "display:block;width:100%;height:100%;";
		container.appendChild(this._canvas);
		this._ctx = this._canvas.getContext("2d");
		this._options = options;
		this._datasets = [];
		this._hitAreas = [];
		this._margin = { top: 18, right: 28, bottom: 20, left: 22 };
		this._dpr = 1;
		this._ro = new ResizeObserver(() => this._resize());
		this._ro.observe(container);
		this._resize();
		this._addEvents();
	}

	setDatasets(datasets) {
		this._datasets = datasets;
		this._draw();
	}

	destroy() {
		this._ro.disconnect();
	}

	_resize() {
		const c = this._canvas;
		const r = c.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;
		const w = r.width || c.offsetWidth || 300;
		const h = r.height || c.offsetHeight || 150;
		c.width = w * dpr;
		c.height = h * dpr;
		this._dpr = dpr;
		this._draw();
	}

	_axisY(v, axisKey) {
		const { top, bottom } = this._margin;
		const dpr = this._dpr || 1;
		const H = this._canvas.height / dpr;
		const plotH = H - top - bottom;
		const ax =
			axisKey === "right" ? this._options.rightAxis : this._options.leftAxis;
		return top + plotH - ((v - ax.min) / (ax.max - ax.min)) * plotH;
	}

	_axisX(i) {
		const { left, right } = this._margin;
		const dpr = this._dpr || 1;
		const W = this._canvas.width / dpr;
		const n = (this._options.xLabels ?? []).length;
		if (n <= 1) return left + (W - left - right) / 2;
		return left + (i / (n - 1)) * (W - left - right);
	}

	_draw() {
		const c = this._canvas,
			ctx = this._ctx;
		const dpr = this._dpr || 1;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		const W = c.width / dpr;
		const H = c.height / dpr;
		const { top, right, bottom, left } = this._margin;
		ctx.clearRect(0, 0, W, H);
		this._hitAreas = [];

		const xLabels = this._options.xLabels ?? [];
		const leftAxis = this._options.leftAxis;
		const rightAxis = this._options.rightAxis;

		if (leftAxis?.ticks) {
			ctx.strokeStyle = "#f0f0f0";
			ctx.lineWidth = 1;
			for (const v of leftAxis.ticks) {
				const py = this._axisY(v, "left");
				ctx.beginPath();
				ctx.moveTo(left, py);
				ctx.lineTo(W - right, py);
				ctx.stroke();
			}
			ctx.fillStyle = leftAxis.color ?? "#999";
			ctx.font = "9px sans-serif";
			ctx.textAlign = "right";
			ctx.textBaseline = "middle";
			for (const v of leftAxis.ticks) {
				ctx.fillText(v, left - 2, this._axisY(v, "left"));
			}
		}

		if (rightAxis?.ticks) {
			ctx.fillStyle = rightAxis.color ?? "#007acc";
			ctx.font = "9px sans-serif";
			ctx.textAlign = "left";
			ctx.textBaseline = "middle";
			for (const v of rightAxis.ticks) {
				ctx.fillText(v, W - right + 2, this._axisY(v, "right"));
			}
		}

		ctx.fillStyle = "#999";
		ctx.font = "9px sans-serif";
		ctx.textAlign = "center";
		ctx.textBaseline = "top";
		for (let i = 0; i < xLabels.length; i++) {
			ctx.fillText(xLabels[i], this._axisX(i), H - bottom + 2);
		}

		for (let di = 0; di < this._datasets.length; di++) {
			const ds = this._datasets[di];
			const axKey = ds.yAxis ?? "left";
			ctx.strokeStyle = ds.color ?? "#333";
			ctx.lineWidth = ds.lineWidth ?? 1.5;
			ctx.setLineDash(ds.lineDash ?? []);
			ctx.beginPath();
			let started = false;
			for (let i = 0; i < ds.data.length; i++) {
				const v = ds.data[i];
				if (v == null) {
					started = false;
					continue;
				}
				const px = this._axisX(i);
				const py = this._axisY(v, axKey);
				if (!started) {
					ctx.moveTo(px, py);
					started = true;
				} else ctx.lineTo(px, py);
			}
			ctx.stroke();
			ctx.setLineDash([]);

			const r = ds.pointRadius ?? 4;
			ctx.fillStyle = ds.pointFillColor ?? ds.color ?? "#333";
			for (let i = 0; i < ds.data.length; i++) {
				const v = ds.data[i];
				if (v == null) continue;
				const px = this._axisX(i);
				const py = this._axisY(v, axKey);
				ctx.beginPath();
				ctx.arc(px, py, r, 0, Math.PI * 2);
				ctx.fill();
				this._hitAreas.push({ px, py, r: r + 4, di, pi: i });
			}
		}

		for (let di = 0; di < this._datasets.length; di++) {
			const ds = this._datasets[di];
			if (!ds.pointLabels) continue;
			const axKey = ds.yAxis ?? "left";
			ctx.textAlign = "center";
			ctx.textBaseline = "bottom";
			ctx.lineJoin = "round";
			for (let i = 0; i < ds.data.length; i++) {
				const v = ds.data[i];
				const lbl = ds.pointLabels[i];
				if (v == null || !lbl) continue;
				const px = this._axisX(i);
				const py = this._axisY(v, axKey);
				const ty = Math.max(py - 8, top + 10);
				ctx.font = 'bold 7.5px "Segoe UI", sans-serif';
				ctx.strokeStyle = "rgba(255,255,255,0.85)";
				ctx.lineWidth = 2.5;
				ctx.strokeText(lbl, px, ty);
				ctx.fillStyle = ds.labelColor ?? ds.color ?? "#333";
				ctx.fillText(lbl, px, ty);
			}
		}

		ctx.strokeStyle = "#ccc";
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(left, top);
		ctx.lineTo(left, H - bottom);
		ctx.lineTo(W - right, H - bottom);
		ctx.stroke();
	}

	_addEvents() {
		const c = this._canvas;
		c.addEventListener("mousemove", (e) => {
			const r = c.getBoundingClientRect();
			const mx = e.clientX - r.left,
				my = e.clientY - r.top;
			const hit = this._hitAreas.find(
				(h) => Math.hypot(mx - h.px, my - h.py) <= h.r,
			);
			c.style.cursor = hit ? "pointer" : "default";
		});
		c.addEventListener("click", (e) => {
			const r = c.getBoundingClientRect();
			const mx = e.clientX - r.left,
				my = e.clientY - r.top;
			const hit = this._hitAreas.find(
				(h) => Math.hypot(mx - h.px, my - h.py) <= h.r,
			);
			if (hit && this._options.onClick)
				this._options.onClick(hit.di, hit.pi);
		});
	}
}
