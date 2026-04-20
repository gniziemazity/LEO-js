"use strict";

class ScatterChart {
	constructor(container, options = {}) {
		this._onClick = options.onClick ?? null;
		this._xLabel = options.xLabel ?? "";
		this._yLabel = options.yLabel ?? "";
		this._xMin = options.xMin ?? null;
		this._xMax = options.xMax ?? null;
		this._yMin = options.yMin ?? null;
		this._yMax = options.yMax ?? null;

		this._canvas = document.createElement("canvas");
		this._canvas.style.cssText = "display:block;width:100%;height:100%;";
		container.appendChild(this._canvas);
		this._ctx = this._canvas.getContext("2d");

		this._datasets = [];
		this._margin = 38;

		this._pan = { x: 0, y: 0 };
		this._zoom = 1;
		this._drag = { active: false, startPx: null, startPan: null };
		this._hovered = null;

		this._ro = new ResizeObserver(() => this._resize());
		this._ro.observe(container);
		this._resize();
		this._addEvents();
	}

	setDatasets(datasets) {
		this._datasets = datasets;
		this._resetView();
		this._draw();
	}

	_resetView() {
		this._pan = { x: 0, y: 0 };
		this._zoom = 1;
	}

	resetZoom() {
		this._resetView();
		this._draw();
	}

	destroy() {
		this._ro.disconnect();
		document.removeEventListener("mousemove", this._docMouseMove);
		document.removeEventListener("mouseup", this._docMouseUp);
	}

	_resize() {
		const c = this._canvas;
		const r = c.getBoundingClientRect();
		c.width = r.width || c.offsetWidth || 300;
		c.height = r.height || c.offsetHeight || 200;
		this._draw();
	}

	_dataBounds() {
		const m = this._margin;
		const W = this._canvas.width,
			H = this._canvas.height;
		const allX = [],
			allY = [];
		for (const ds of this._datasets)
			for (const p of ds.data) {
				allX.push(p.x);
				allY.push(p.y);
			}
		let xMin = this._xMin ?? (allX.length ? Math.min(...allX) : 0);
		let xMax = this._xMax ?? (allX.length ? Math.max(...allX) : 1);
		let yMin = this._yMin ?? (allY.length ? Math.min(...allY) : 0);
		let yMax = this._yMax ?? (allY.length ? Math.max(...allY) : 1);
		if (xMin === xMax) {
			xMin -= 1;
			xMax += 1;
		}
		if (yMin === yMax) {
			yMin -= 0.5;
			yMax += 0.5;
		}

		const cx = (xMin + xMax) / 2 + this._pan.x;
		const cy = (yMin + yMax) / 2 + this._pan.y;
		const hw = ((xMax - xMin) / 2) * this._zoom;
		const hh = ((yMax - yMin) / 2) * this._zoom;
		return {
			xMin: cx - hw,
			xMax: cx + hw,
			yMin: cy - hh,
			yMax: cy + hh,
			W,
			H,
			m,
		};
	}

	_toPixel(x, y, b) {
		const px = b.m + ((x - b.xMin) / (b.xMax - b.xMin)) * (b.W - 2 * b.m);
		const py =
			b.H - b.m - ((y - b.yMin) / (b.yMax - b.yMin)) * (b.H - 2 * b.m);
		return [px, py];
	}

	_fromPixel(px, py, b) {
		const x = b.xMin + ((px - b.m) / (b.W - 2 * b.m)) * (b.xMax - b.xMin);
		const y =
			b.yMin + ((b.H - b.m - py) / (b.H - 2 * b.m)) * (b.yMax - b.yMin);
		return [x, y];
	}

	_draw() {
		const c = this._canvas,
			ctx = this._ctx;
		const b = this._dataBounds();
		ctx.clearRect(0, 0, c.width, c.height);

		ctx.fillStyle = "#fff";
		ctx.fillRect(b.m, b.m, c.width - 2 * b.m, c.height - 2 * b.m);

		ctx.strokeStyle = "#ddd";
		ctx.lineWidth = 1;
		ctx.strokeRect(b.m, b.m, c.width - 2 * b.m, c.height - 2 * b.m);

		this._drawAxesLabels(ctx, b);

		for (const ds of this._datasets) {
			if (ds.type === "line") {
				this._drawLine(ctx, ds, b);
			} else {
				this._drawPoints(ctx, ds, b);
			}
		}

		if (this._hovered) {
			const { point, ds } = this._hovered;
			const [px, py] = this._toPixel(point.x, point.y, b);
			ctx.beginPath();
			ctx.arc(px, py, 7, 0, Math.PI * 2);
			ctx.fillStyle = "rgba(255,255,255,0.7)";
			ctx.fill();
			ctx.beginPath();
			ctx.arc(px, py, 6, 0, Math.PI * 2);
			ctx.strokeStyle = ds.color ?? "#333";
			ctx.lineWidth = 2;
			ctx.stroke();
			if (this._hoveredTooltip)
				this._drawTooltip(ctx, b, px, py, this._hoveredTooltip);
		}
	}

	_drawAxesLabels(ctx, b) {
		ctx.fillStyle = "#999";
		ctx.font = "9px sans-serif";
		ctx.textAlign = "center";
		ctx.textBaseline = "top";
		ctx.fillText(b.xMin.toFixed(0), b.m, b.H - b.m + 2);
		ctx.fillText(b.xMax.toFixed(0), b.W - b.m, b.H - b.m + 2);
		ctx.textAlign = "right";
		ctx.textBaseline = "middle";
		ctx.fillText(b.yMin.toFixed(1), b.m - 2, b.H - b.m);
		ctx.fillText(b.yMax.toFixed(1), b.m - 2, b.m);

		ctx.fillStyle = "#888";
		ctx.font = "10px sans-serif";
		ctx.textAlign = "center";
		ctx.textBaseline = "bottom";
		ctx.fillText(this._xLabel, b.W / 2, b.H - 2);

		ctx.save();
		ctx.translate(10, b.H / 2);
		ctx.rotate(-Math.PI / 2);
		ctx.textBaseline = "top";
		ctx.fillText(this._yLabel, 0, 0);
		ctx.restore();
	}

	_drawPoints(ctx, ds, b) {
		const r = ds.pointRadius ?? 4;
		const color = ds.color ?? "#555";
		ctx.fillStyle = color;
		for (const p of ds.data) {
			const [px, py] = this._toPixel(p.x, p.y, b);
			if (px < b.m - r || px > b.W - b.m + r) continue;
			if (py < b.m - r || py > b.H - b.m + r) continue;
			ctx.beginPath();
			ctx.arc(px, py, r, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	_drawLine(ctx, ds, b) {
		if (ds.data.length < 2) return;
		const sorted = [...ds.data].sort((a, z) => a.x - z.x);
		ctx.beginPath();
		ctx.strokeStyle = ds.color ?? "#888";
		ctx.lineWidth = ds.lineWidth ?? 1.5;
		ctx.setLineDash(ds.lineDash ?? []);
		let first = true;
		for (const p of sorted) {
			const [px, py] = this._toPixel(p.x, p.y, b);
			if (first) {
				ctx.moveTo(px, py);
				first = false;
			} else ctx.lineTo(px, py);
		}
		ctx.stroke();
		ctx.setLineDash([]);
	}

	_drawTooltip(ctx, b, px, py, lines) {
		const pad = 6,
			lh = 14;
		ctx.font = "11px sans-serif";
		const maxW = Math.max(...lines.map((l) => ctx.measureText(l).width));
		const tw = maxW + pad * 2,
			th = lines.length * lh + pad * 2;
		let tx = px + 10,
			ty = py - th / 2;
		if (tx + tw > b.W - 2) tx = px - tw - 10;
		if (ty < 2) ty = 2;
		if (ty + th > b.H - 2) ty = b.H - th - 2;
		ctx.fillStyle = "#fff";
		ctx.strokeStyle = "#ddd";
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.roundRect(tx, ty, tw, th, 3);
		ctx.fill();
		ctx.stroke();
		ctx.fillStyle = "#333";
		ctx.textAlign = "left";
		ctx.textBaseline = "top";
		lines.forEach((l, i) => ctx.fillText(l, tx + pad, ty + pad + i * lh));
	}

	_addEvents() {
		const c = this._canvas;
		c.addEventListener(
			"wheel",
			(e) => {
				e.preventDefault();
				const factor = e.deltaY > 0 ? 1.1 : 0.9;
				this._zoom = Math.max(0.1, Math.min(10, this._zoom * factor));
				this._draw();
			},
			{ passive: false },
		);

		c.addEventListener("mousedown", (e) => {
			this._drag = {
				active: true,
				startPx: [e.clientX, e.clientY],
				startPan: { ...this._pan },
			};
			c.style.cursor = "grabbing";
		});

		this._docMouseMove = (e) => {
			if (!this._drag.active) return;
			const b = this._dataBounds();
			const dx = e.clientX - this._drag.startPx[0];
			const dy = e.clientY - this._drag.startPx[1];
			const xRange = b.xMax - b.xMin;
			const yRange = b.yMax - b.yMin;
			const pxRange = b.W - 2 * b.m;
			const pyRange = b.H - 2 * b.m;
			this._pan.x = this._drag.startPan.x - (dx / pxRange) * xRange;
			this._pan.y = this._drag.startPan.y + (dy / pyRange) * yRange;
			this._hovered = null;
			this._hoveredTooltip = null;
			this._draw();
		};

		this._docMouseUp = () => {
			if (!this._drag.active) return;
			this._drag.active = false;
			c.style.cursor = "grab";
		};

		document.addEventListener("mousemove", this._docMouseMove);
		document.addEventListener("mouseup", this._docMouseUp);

		c.addEventListener("mousemove", (e) => {
			if (this._drag.active) return;
			const r = c.getBoundingClientRect();
			const mx = e.clientX - r.left,
				my = e.clientY - r.top;
			const b = this._dataBounds();
			let nearest = null,
				nearestDist = Infinity,
				nearestDs = null;
			for (const ds of this._datasets) {
				if (ds.type === "line") continue;
				for (const p of ds.data) {
					const [px, py] = this._toPixel(p.x, p.y, b);
					const d = Math.hypot(mx - px, my - py);
					if (d < nearestDist) {
						nearestDist = d;
						nearest = p;
						nearestDs = ds;
					}
				}
			}
			if (nearestDist < 10) {
				this._hovered = { point: nearest, ds: nearestDs };
				this._hoveredTooltip = nearestDs.tooltip
					? nearestDs.tooltip(nearest)
					: null;
				c.style.cursor = "pointer";
			} else {
				this._hovered = null;
				this._hoveredTooltip = null;
				c.style.cursor = "grab";
			}
			this._draw();
		});

		c.addEventListener("mouseleave", () => {
			if (!this._drag.active) {
				this._hovered = null;
				this._hoveredTooltip = null;
				this._draw();
			}
		});

		c.addEventListener("dblclick", () => this.resetZoom());

		c.addEventListener("click", (e) => {
			if (this._drag.active) return;
			if (!this._hovered) {
				if (this._onClick) this._onClick(null);
				return;
			}
			if (this._onClick) this._onClick(this._hovered.point);
		});
	}
}

class BarChart {
	constructor(container, options = {}) {
		this._canvas = document.createElement("canvas");
		this._canvas.style.cssText = "display:block;width:100%;height:100%;";
		container.appendChild(this._canvas);
		this._ctx = this._canvas.getContext("2d");
		this._options = options;
		this._datasets = [];
		this._labels = [];
		this._margin = { top: 10, right: 10, bottom: 32, left: 28 };

		this._hitAreas = [];
		this._hovered = null;
		this._ro = new ResizeObserver(() => this._resize());
		this._ro.observe(container);
		this._resize();
		this._addEvents();
	}

	setData(labels, datasets) {
		this._labels = labels;
		this._datasets = datasets;
		this._draw();
	}

	destroy() {
		this._ro.disconnect();
	}

	_resize() {
		const c = this._canvas;
		const r = c.getBoundingClientRect();
		c.width = r.width || c.offsetWidth || 300;
		c.height = r.height || c.offsetHeight || 200;
		this._draw();
	}

	_draw() {
		const c = this._canvas,
			ctx = this._ctx;
		const { top, right, bottom, left } = this._margin;
		const W = c.width,
			H = c.height;
		const plotW = W - left - right;
		const plotH = H - top - bottom;
		ctx.clearRect(0, 0, W, H);
		this._hitAreas = [];

		if (!this._labels.length || !this._datasets.length) return;

		const stacked = this._options.stacked ?? false;
		const yMin = this._options.yMin ?? 0;
		let yMax = this._options.yMax;
		if (yMax == null) {
			if (stacked) {
				yMax =
					Math.max(
						...this._labels.map((_, i) =>
							this._datasets.reduce((s, ds) => s + (ds.data[i] ?? 0), 0),
						),
					) * 1.1 || 1;
			} else {
				yMax =
					Math.max(...this._datasets.flatMap((ds) => ds.data)) * 1.15 || 1;
			}
		}

		const nGroups = this._labels.length;
		const nSets = this._datasets.length;
		const groupW = plotW / nGroups;
		const barW = stacked ? groupW * 0.6 : (groupW * 0.6) / nSets;

		const toY = (v) => top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
		const toX = (gi, si) => {
			const gx = left + gi * groupW + groupW / 2;
			if (stacked) return gx - barW / 2;
			const offset = (si - (nSets - 1) / 2) * barW;
			return gx + offset - barW / 2;
		};

		ctx.strokeStyle = "#e8e8e8";
		ctx.lineWidth = 1;
		const step = niceStep(yMax - yMin, 5);
		for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step) {
			const py = toY(v);
			ctx.beginPath();
			ctx.moveTo(left, py);
			ctx.lineTo(W - right, py);
			ctx.stroke();
			ctx.fillStyle = "#bbb";
			ctx.font = "9px sans-serif";
			ctx.textAlign = "right";
			ctx.textBaseline = "middle";
			ctx.fillText(v % 1 === 0 ? v : v.toFixed(1), left - 3, py);
		}

		const stackTops = new Array(nGroups).fill(yMin);

		for (let si = 0; si < nSets; si++) {
			const ds = this._datasets[si];
			ctx.fillStyle = ds.backgroundColor ?? "rgba(100,100,100,0.4)";
			ctx.strokeStyle = ds.borderColor ?? "#999";
			ctx.lineWidth = 1;
			for (let gi = 0; gi < nGroups; gi++) {
				const val = ds.data[gi] ?? 0;
				const base = stacked ? stackTops[gi] : yMin;
				const bx = toX(gi, si);
				const by = toY(base + val);
				const bh = toY(base) - by;
				if (bh > 0) {
					ctx.fillRect(bx, by, barW, bh);
					ctx.strokeRect(bx, by, barW, bh);
					this._hitAreas.push({
						x: bx,
						y: by,
						w: barW,
						h: bh,
						gi,
						si,
						val,
					});
				}
				if (stacked) stackTops[gi] += val;
			}
		}

		ctx.fillStyle = "#888";
		ctx.font = "10px sans-serif";
		ctx.textAlign = "center";
		ctx.textBaseline = "top";
		for (let gi = 0; gi < nGroups; gi++) {
			const gx = left + gi * groupW + groupW / 2;
			ctx.fillText(this._labels[gi], gx, H - bottom + 4);
		}

		ctx.strokeStyle = "#ccc";
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(left, top);
		ctx.lineTo(left, H - bottom);
		ctx.lineTo(W - right, H - bottom);
		ctx.stroke();

		if (this._hovered) this._drawTooltip(ctx, this._hovered);
	}

	_addEvents() {
		const c = this._canvas;
		c.addEventListener("mousemove", (e) => {
			const r = c.getBoundingClientRect();
			const mx = e.clientX - r.left;
			const my = e.clientY - r.top;
			this._hovered =
				this._hitAreas.find(
					(h) =>
						mx >= h.x && mx <= h.x + h.w && my >= h.y && my <= h.y + h.h,
				) ?? null;
			this._draw();
		});
		c.addEventListener("mouseleave", () => {
			this._hovered = null;
			this._draw();
		});
	}

	_drawTooltip(ctx, hit) {
		const cb = this._options.tooltipCallback;
		const lines = cb
			? cb(this._labels[hit.gi], hit.val, hit.si, hit.gi)
			: [this._labels[hit.gi], hit.val.toFixed(1)];
		const pad = 6,
			lh = 14;
		ctx.font = "11px sans-serif";
		const maxW = Math.max(...lines.map((l) => ctx.measureText(l).width));
		const tw = maxW + pad * 2,
			th = lines.length * lh + pad * 2;
		const cx = hit.x + hit.w / 2;
		let tx = cx - tw / 2;
		let ty = hit.y - th - 6;
		const W = this._canvas.width,
			H = this._canvas.height;
		if (tx < 2) tx = 2;
		if (tx + tw > W - 2) tx = W - tw - 2;
		if (ty < 2) ty = hit.y + hit.h + 6;
		ctx.fillStyle = "#fff";
		ctx.strokeStyle = "#ddd";
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.roundRect(tx, ty, tw, th, 3);
		ctx.fill();
		ctx.stroke();
		ctx.fillStyle = "#333";
		ctx.textAlign = "left";
		ctx.textBaseline = "top";
		lines.forEach((l, i) => ctx.fillText(l, tx + pad, ty + pad + i * lh));
	}
}

function niceStep(range, targetSteps) {
	const raw = range / targetSteps;
	const mag = Math.pow(10, Math.floor(Math.log10(raw)));
	const norm = raw / mag;
	let nice = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
	return nice * mag;
}

function _boxStats(values, coef = 1.5) {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const n = sorted.length;
	const q = (p) => {
		const pos = p * (n - 1);
		const lo = Math.floor(pos);
		const hi = Math.ceil(pos);
		return sorted[lo] + (pos - lo) * (sorted[hi] - sorted[lo]);
	};
	const q1 = q(0.25);
	const median = q(0.5);
	const q3 = q(0.75);
	const iqr = q3 - q1;
	const lo = q1 - coef * iqr;
	const hi = q3 + coef * iqr;
	const whiskerMin = sorted.find((v) => v >= lo) ?? sorted[0];
	const whiskerMax =
		[...sorted].reverse().find((v) => v <= hi) ?? sorted[n - 1];
	const outliers = sorted.filter((v) => v < lo || v > hi);
	return { q1, median, q3, whiskerMin, whiskerMax, outliers };
}

class LineChart {
	constructor(container, options = {}) {
		this._canvas = document.createElement("canvas");
		this._canvas.style.cssText = "display:block;width:100%;height:100%;";
		container.appendChild(this._canvas);
		this._ctx = this._canvas.getContext("2d");
		this._options = options;
		this._datasets = [];
		this._hitAreas = [];
		this._margin = { top: 24, right: 30, bottom: 22, left: 24 };
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
		c.width = r.width || c.offsetWidth || 300;
		c.height = r.height || c.offsetHeight || 150;
		this._draw();
	}

	_axisY(v, axisKey) {
		const { top, bottom } = this._margin;
		const H = this._canvas.height;
		const plotH = H - top - bottom;
		const ax =
			axisKey === "right" ? this._options.rightAxis : this._options.leftAxis;
		return top + plotH - ((v - ax.min) / (ax.max - ax.min)) * plotH;
	}

	_axisX(i) {
		const { left, right } = this._margin;
		const W = this._canvas.width;
		const n = (this._options.xLabels ?? []).length;
		if (n <= 1) return left + (W - left - right) / 2;
		return left + (i / (n - 1)) * (W - left - right);
	}

	_draw() {
		const c = this._canvas,
			ctx = this._ctx;
		const W = c.width,
			H = c.height;
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
			ctx.fillStyle = ds.color ?? "#333";
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

class BoxPlotChart {
	constructor(container, options = {}) {
		this._canvas = document.createElement("canvas");
		this._canvas.style.cssText = "display:block;width:100%;height:100%;";
		container.appendChild(this._canvas);
		this._ctx = this._canvas.getContext("2d");
		this._options = options;
		this._datasets = [];
		this._margin = { top: 10, right: 30, bottom: 22, left: 24 };
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
		c.width = r.width || c.offsetWidth || 300;
		c.height = r.height || c.offsetHeight || 200;
		this._draw();
	}

	_axisY(v, axisKey) {
		const { top, bottom } = this._margin;
		const H = this._canvas.height;
		const plotH = H - top - bottom;
		const ax =
			axisKey === "right" ? this._options.rightAxis : this._options.leftAxis;
		return top + plotH - ((v - ax.min) / (ax.max - ax.min)) * plotH;
	}

	_draw() {
		const c = this._canvas,
			ctx = this._ctx;
		const W = c.width,
			H = c.height;
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

		ctx.fillStyle = "#888";
		ctx.font = "10px sans-serif";
		ctx.textAlign = "center";
		ctx.textBaseline = "top";
		for (let gi = 0; gi < n; gi++) {
			const gx = left + (gi + 0.5) * (plotW / n);
			ctx.fillText(xLabels[gi], gx, H - bottom + 2);
		}

		const groupW = plotW / n;
		const boxW = (groupW * 0.6) / nSets;

		for (let si = 0; si < nSets; si++) {
			const ds = this._datasets[si];
			const axKey = ds.yAxis ?? "left";
			const coef = ds.coef ?? 1.5;

			for (let gi = 0; gi < n; gi++) {
				const vals = ds.data[gi] ?? [];
				const stats = _boxStats(vals, coef);
				if (!stats) continue;

				const gx = left + gi * groupW + groupW / 2;
				const bx = gx + (si - (nSets - 1) / 2) * boxW - boxW / 2;
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
