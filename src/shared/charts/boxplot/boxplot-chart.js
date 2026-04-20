"use strict";

class BoxPlotChart {
	constructor(container, options = {}) {
		this._canvas = document.createElement("canvas");
		this._canvas.style.cssText = "display:block;width:100%;height:100%;";
		container.appendChild(this._canvas);
		this._ctx = this._canvas.getContext("2d");
		this._options = options;
		this._datasets = [];
		this._margin = { top: 6, right: 28, bottom: 20, left: 22 };
		this._dpr = 1;
		this._ro = new ResizeObserver(() => this._resize());
		this._ro.observe(container);
		this._resize();
	}

	setData(datasets) {
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
		const h = r.height || c.offsetHeight || 200;
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

	_draw() {
		const c = this._canvas,
			ctx = this._ctx;
		const dpr = this._dpr || 1;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		const W = c.width / dpr;
		const H = c.height / dpr;
		const { top, right, bottom, left } = this._margin;
		const plotW = W - left - right;
		ctx.clearRect(0, 0, W, H);

		const xLabels = this._options.xLabels ?? [];
		const n = xLabels.length;
		const nSets = this._datasets.length;
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

		if (n > 1) {
			ctx.strokeStyle = "#e8e8e8";
			ctx.lineWidth = 1;
			for (let gi = 1; gi < n; gi++) {
				const x = left + gi * (plotW / n);
				ctx.beginPath();
				ctx.moveTo(x, top);
				ctx.lineTo(x, H - bottom);
				ctx.stroke();
			}
		}

		ctx.fillStyle = "#888";
		ctx.font = "10px sans-serif";
		ctx.textAlign = "center";
		ctx.textBaseline = "top";
		for (let gi = 0; gi < n; gi++) {
			const gx = left + (gi + 0.5) * (plotW / n);
			ctx.fillText(xLabels[gi], gx, H - bottom + 2);
		}

		const groupW = plotW / n;
		const totalBoxSpan = groupW * 0.65;
		const gap = nSets > 1 ? (totalBoxSpan * 0.18) / (nSets - 1) : 0;
		const boxW = (totalBoxSpan - (nSets - 1) * gap) / nSets;

		for (let si = 0; si < nSets; si++) {
			const ds = this._datasets[si];
			const axKey = ds.yAxis ?? "left";
			const coef = ds.coef ?? 1.5;

			for (let gi = 0; gi < n; gi++) {
				const vals = ds.data[gi] ?? [];
				const stats = _boxStats(vals, coef);
				if (!stats) continue;

				const gx = left + gi * groupW + groupW / 2;
				const bx = gx - totalBoxSpan / 2 + si * (boxW + gap);
				const bxMid = bx + boxW / 2;
				const yQ1 = this._axisY(stats.q1, axKey);
				const yMed = this._axisY(stats.median, axKey);
				const yQ3 = this._axisY(stats.q3, axKey);
				const yWlo = this._axisY(stats.whiskerMin, axKey);
				const yWhi = this._axisY(stats.whiskerMax, axKey);

				ctx.fillStyle = ds.color ?? "rgba(100,100,100,0.4)";
				ctx.fillRect(bx, yQ3, boxW, yQ1 - yQ3);
				ctx.strokeStyle = ds.borderColor ?? "#999";
				ctx.lineWidth = 1.5;
				ctx.strokeRect(bx, yQ3, boxW, yQ1 - yQ3);

				ctx.beginPath();
				ctx.moveTo(bx, yMed);
				ctx.lineTo(bx + boxW, yMed);
				ctx.stroke();

				ctx.lineWidth = 1;
				const capW = boxW * 0.4;
				ctx.beginPath();
				ctx.moveTo(bxMid, yQ1);
				ctx.lineTo(bxMid, yWlo);
				ctx.moveTo(bxMid - capW / 2, yWlo);
				ctx.lineTo(bxMid + capW / 2, yWlo);
				ctx.moveTo(bxMid, yQ3);
				ctx.lineTo(bxMid, yWhi);
				ctx.moveTo(bxMid - capW / 2, yWhi);
				ctx.lineTo(bxMid + capW / 2, yWhi);
				ctx.stroke();

				if (stats.outliers.length && ds.outlierColor) {
					ctx.fillStyle = ds.outlierColor;
					for (const ov of stats.outliers) {
						const oy = this._axisY(ov, axKey);
						ctx.beginPath();
						ctx.arc(bxMid, oy, ds.outlierRadius ?? 3, 0, Math.PI * 2);
						ctx.fill();
					}
				}
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
}
