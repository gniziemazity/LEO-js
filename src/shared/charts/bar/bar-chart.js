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
		this._margin = { top: 6, right: 4, bottom: 28, left: 34 };

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
			const sumsByStack = new Map();
			for (let si = 0; si < this._datasets.length; si++) {
				const ds = this._datasets[si];
				const key = stacked
					? "__global"
					: ds.stack != null
						? `__s_${ds.stack}`
						: `__solo_${si}`;
				let sums = sumsByStack.get(key);
				if (!sums) {
					sums = new Array(this._labels.length).fill(0);
					sumsByStack.set(key, sums);
				}
				for (let i = 0; i < this._labels.length; i++)
					sums[i] += ds.data[i] ?? 0;
			}
			let maxStackSum = 0;
			for (const sums of sumsByStack.values())
				for (const v of sums) if (v > maxStackSum) maxStackSum = v;
			yMax = maxStackSum * (stacked ? 1.1 : 1.15) || 1;
		}

		const nGroups = this._labels.length;
		const nSets = this._datasets.length;
		const groupW = plotW / nGroups;

		const stackKeys = [];
		const setSlot = new Array(nSets);
		for (let si = 0; si < nSets; si++) {
			if (this._datasets[si].overlap === true) {
				setSlot[si] = -1;
				continue;
			}
			let key;
			if (stacked) {
				key = "__global";
			} else if (this._datasets[si].stack != null) {
				key = `__s_${this._datasets[si].stack}`;
			} else {
				key = `__solo_${si}`;
			}
			let idx = stackKeys.indexOf(key);
			if (idx < 0) {
				idx = stackKeys.length;
				stackKeys.push(key);
			}
			setSlot[si] = idx;
		}
		const nStacks = stackKeys.length || 1;
		const barW = (groupW * 0.6) / nStacks;
		const overlapBarW = groupW * 0.6;
		const overlapOffset = (groupW - overlapBarW) / 2;

		const toY = (v) => top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
		const toX = (gi, slot) => {
			const gx = left + gi * groupW + groupW / 2;
			if (nStacks === 1) return gx - barW / 2;
			const offset = (slot - (nStacks - 1) / 2) * barW;
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
			ctx.fillStyle = "#595959";
			ctx.font = "9px sans-serif";
			ctx.textAlign = "right";
			ctx.textBaseline = "middle";
			ctx.fillText(
				(v % 1 === 0 ? v : v.toFixed(1)) +
					(this._options.yTickSuffix || ""),
				left - 5,
				py,
			);
		}

		const stackTops = [];
		for (let s = 0; s < nStacks; s++)
			stackTops.push(new Array(nGroups).fill(yMin));

		for (let si = 0; si < nSets; si++) {
			const ds = this._datasets[si];
			const slot = setSlot[si];
			const isOverlap = slot < 0;
			const bg = ds.backgroundColor ?? "rgba(100,100,100,0.4)";
			const bd = ds.borderColor ?? "#999";
			const bgPerBar = Array.isArray(bg);
			const bdPerBar = Array.isArray(bd);
			if (!bgPerBar) ctx.fillStyle = bg;
			if (!bdPerBar) ctx.strokeStyle = bd;
			ctx.lineWidth = 1;
			const striped = ds.pattern === "stripes";
			const useBarW = isOverlap ? overlapBarW : barW;
			for (let gi = 0; gi < nGroups; gi++) {
				const val = ds.data[gi] ?? 0;
				const base = isOverlap ? yMin : stackTops[slot][gi];
				const bx = isOverlap
					? left + gi * groupW + overlapOffset
					: toX(gi, slot);
				const by = toY(base + val);
				const bh = toY(base) - by;
				if (bh > 0) {
					const fillColor = bgPerBar
						? (bg[gi] ?? "rgba(100,100,100,0.4)")
						: bg;
					const strokeColor = bdPerBar ? (bd[gi] ?? "#999") : bd;
					if (striped) {
						_drawStripedBar(
							ctx,
							bx,
							by,
							useBarW,
							bh,
							fillColor,
							strokeColor,
						);
					} else {
						if (bgPerBar) ctx.fillStyle = fillColor;
						if (bdPerBar) ctx.strokeStyle = strokeColor;
						ctx.fillRect(bx, by, useBarW, bh);
						ctx.strokeRect(bx, by, useBarW, bh);
					}
					this._hitAreas.push({
						x: bx,
						y: by,
						w: useBarW,
						h: bh,
						gi,
						si,
						val,
					});
					const labelCb = this._options.barLabel;
					if (labelCb) {
						const label = labelCb(gi, si, val, ds);
						if (label) {
							ctx.save();
							ctx.font = "bold 10px sans-serif";
							ctx.textAlign = "center";
							ctx.textBaseline = "bottom";
							const textW = ctx.measureText(label).width;
							if (useBarW >= textW + 4) {
								if (bh >= 14) {
									ctx.fillStyle = ds.labelColor ?? "#fff";
									if (this._options.barLabelAtTop) {
										ctx.textBaseline = "top";
										ctx.fillText(label, bx + useBarW / 2, by + 2);
									} else {
										ctx.fillText(
											label,
											bx + useBarW / 2,
											by + bh - 2,
										);
									}
								} else {
									ctx.fillStyle = ds.outsideLabelColor ?? "#555";
									ctx.fillText(label, bx + useBarW / 2, by - 2);
								}
							}
							ctx.restore();
						}
					}
				}
				if (!isOverlap) stackTops[slot][gi] += val;
			}
		}

		ctx.fillStyle = "#595959";
		ctx.font = "10px sans-serif";
		ctx.textAlign = "center";
		ctx.textBaseline = "top";
		for (let gi = 0; gi < nGroups; gi++) {
			const gx = left + gi * groupW + groupW / 2;
			ctx.fillText(this._labels[gi], gx, H - bottom + 5);
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

function _drawStripedBar(ctx, x, y, w, h, fillColor, strokeColor) {
	if (w <= 0 || h <= 0) return;
	ctx.save();
	ctx.globalAlpha = 0.25;
	ctx.fillStyle = fillColor;
	ctx.fillRect(x, y, w, h);
	ctx.globalAlpha = 1;
	ctx.beginPath();
	ctx.rect(x, y, w, h);
	ctx.clip();
	ctx.strokeStyle = strokeColor;
	ctx.lineWidth = 1;
	const step = 5;
	for (let lx = x - h; lx < x + w + h; lx += step) {
		ctx.beginPath();
		ctx.moveTo(lx, y + h);
		ctx.lineTo(lx + h, y);
		ctx.stroke();
	}
	ctx.restore();
	ctx.strokeStyle = strokeColor;
	ctx.lineWidth = 1;
	ctx.strokeRect(x, y, w, h);
}
