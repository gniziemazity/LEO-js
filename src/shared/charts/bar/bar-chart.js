"use strict";

class BarChart {
	constructor(container, options = {}) {
		this._canvas = document.createElement("canvas");
		this._canvas.style.cssText = "display:block;width:100%;height:100%;";
		container.appendChild(this._canvas);
		this._ctx = this._canvas.getContext("2d");
		this._options = options;
		this._datasets = [];
		this._labels = [];
		this._margin = { top: 6, right: 4, bottom: 28, left: 22 };

		this._hitAreas = [];
		this._hovered = null;
		this._dpr = 1;
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
		const dpr = window.devicePixelRatio || 1;
		const w = r.width || c.offsetWidth || 300;
		const h = r.height || c.offsetHeight || 200;
		c.width = w * dpr;
		c.height = h * dpr;
		this._dpr = dpr;
		this._draw();
	}

	_draw() {
		const c = this._canvas,
			ctx = this._ctx;
		const dpr = this._dpr || 1;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		const { top, right, bottom, left } = this._margin;
		const W = c.width / dpr;
		const H = c.height / dpr;
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

		if (this._hovered) this._drawTooltip(ctx, this._hovered, W, H);
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

	_drawTooltip(ctx, hit, W, H) {
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
