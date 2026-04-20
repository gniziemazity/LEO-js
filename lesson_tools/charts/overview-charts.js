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
