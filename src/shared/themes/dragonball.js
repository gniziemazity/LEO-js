(function () {
	function distance(p1, p2) {
		let d = 0;
		for (let i = 0; i < 2; i++) d += (p1[i] - p2[i]) * (p1[i] - p2[i]);
		return Math.sqrt(d);
	}

	function getNeighbors(index, nodes, k) {
		for (let i = 0; i < nodes.length; i++) {
			if (i === index) nodes[i].dist = Infinity;
			else nodes[i].dist = distance(nodes[index], nodes[i]);
		}
		const neighbors = [nodes[0]];
		for (let i = 1; i < nodes.length; i++) {
			let j = 0;
			while (j < neighbors.length && nodes[i].dist > neighbors[j].dist) j++;
			neighbors.splice(j, 0, nodes[i]);
		}
		while (neighbors.length > k) neighbors.pop();
		return neighbors;
	}

	function getKNNLinks(nodes, k) {
		const segments = [];
		for (let i = 0; i < nodes.length; i++) {
			const neighbors = getNeighbors(i, nodes, k);
			for (let j = 0; j < neighbors.length; j++) {
				segments.push([nodes[i], neighbors[j]]);
			}
		}
		return segments;
	}

	const DEFAULT_BALL = { r: 93, g: 173, b: 226 };
	const FRAME_RAYS = "rgba(255,255,255,0.8)";
	const FRAME_SPARK_GAP = 22;

	function cornerRadius(box) {
		return Math.max(0, Math.min(box.r || 0, box.w / 2, box.h / 2));
	}

	function perimeterLength(box) {
		const r = cornerRadius(box);
		return 2 * (box.w + box.h) - 8 * r + 2 * Math.PI * r;
	}

	function perimeterPoint(box, p, out) {
		const r = cornerRadius(box);
		const arc = (Math.PI / 2) * r;
		const corners = [
			[box.x + box.w - r, box.y + r],
			[box.x + box.w - r, box.y + box.h - r],
			[box.x + r, box.y + box.h - r],
			[box.x + r, box.y + r],
		];
		for (let i = 0; i < 4; i++) {
			const side = i % 2 ? box.h - 2 * r : box.w - 2 * r;
			const a = ((i - 1) * Math.PI) / 2;
			const [cx, cy] = corners[i];
			if (p <= side) {
				const back = side - p;
				return [
					cx + (r + out) * Math.cos(a) + Math.sin(a) * back,
					cy + (r + out) * Math.sin(a) - Math.cos(a) * back,
				];
			}
			p -= side;
			if (p <= arc || i === 3) {
				const t = r > 0 ? a + Math.min(p, arc) / r : a;
				return [cx + (r + out) * Math.cos(t), cy + (r + out) * Math.sin(t)];
			}
			p -= arc;
		}
	}

	function parseRGB(str) {
		if (!str) return null;
		const s = String(str).trim();
		let m = s.match(/^#([0-9a-f]{3})$/i);
		if (m) {
			const h = m[1];
			return {
				r: parseInt(h[0] + h[0], 16),
				g: parseInt(h[1] + h[1], 16),
				b: parseInt(h[2] + h[2], 16),
			};
		}
		m = s.match(/^#([0-9a-f]{6})$/i);
		if (m) {
			return {
				r: parseInt(m[1].slice(0, 2), 16),
				g: parseInt(m[1].slice(2, 4), 16),
				b: parseInt(m[1].slice(4, 6), 16),
			};
		}
		m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
		if (m) return { r: +m[1], g: +m[2], b: +m[3] };
		return null;
	}

	registerTheme("dragonball", {
		shape: "circle",
		init() {
			this.frame = 0;
			this._raysGrad = null;
			this._ballGrad = null;
			if (!this._rgb) this._rgb = DEFAULT_BALL;
		},
		setColor(color) {
			const rgb = parseRGB(color);
			if (!rgb) return;
			this._rgb = rgb;
			this._ballGrad = null;
		},
		_raysPath(ctx, cx, cy, w, h) {
			const angleOffset = this.frame / 25;
			const reach = Math.max(w, h) * 2;
			const step = Math.PI / 24;
			let intStep = 0;
			ctx.beginPath();
			for (let i = 0; i <= Math.PI * 2; i += step) {
				let radius = 0;
				if (intStep % 7 === 0 || intStep % 7 === 1) radius = reach;
				const x = cx + Math.cos(i + angleOffset) * radius;
				const y = cy + Math.sin(i + angleOffset) * radius;
				if (i === 0) ctx.moveTo(x, y);
				else ctx.lineTo(x, y);
				intStep++;
			}
		},
		_rays(ctx, cx, cy, size, w, h) {
			this._raysPath(ctx, cx, cy, w, h);
			if (!this._raysGrad) {
				const grad = ctx.createRadialGradient(
					cx,
					cy,
					size,
					cx,
					cy,
					Math.max(w, h) / 2,
				);
				grad.addColorStop(0, "rgba(255,255,255,0.9)");
				grad.addColorStop(1, "rgba(255,255,255,0)");
				this._raysGrad = grad;
			}
			ctx.fillStyle = this._raysGrad;
			ctx.fill();
		},
		_ball(ctx, cx, cy, size) {
			const glow = size / 6;
			const outer = size + glow;
			if (!this._ballGrad) {
				const c = this._rgb || DEFAULT_BALL;
				const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, outer);
				grad.addColorStop(0, "#ffffff");
				grad.addColorStop((size - glow) / outer, "#ffffff");
				grad.addColorStop(size / outer, `rgba(${c.r},${c.g},${c.b},1)`);
				grad.addColorStop(1, `rgba(${c.r},${c.g},${c.b},0)`);
				this._ballGrad = grad;
			}
			ctx.beginPath();
			ctx.arc(cx, cy, outer, 0, Math.PI * 2);
			ctx.fillStyle = this._ballGrad;
			ctx.fill();
		},
		_electricity(ctx, cx, cy, size) {
			const nodes = [];
			while (nodes.length < 70) {
				const angle = Math.random() * Math.PI * 2;
				const radius = size + (Math.random() * size) / 5;
				nodes.push([
					cx + Math.cos(angle) * radius,
					cy + Math.sin(angle) * radius,
				]);
			}
			const segments = getKNNLinks(nodes, 2);
			ctx.lineWidth = 2;
			ctx.strokeStyle = "white";
			for (let i = 0; i < segments.length; i++) {
				ctx.beginPath();
				ctx.moveTo(segments[i][0][0], segments[i][0][1]);
				ctx.lineTo(segments[i][1][0], segments[i][1][1]);
				ctx.stroke();
			}
		},
		draw(ctx, t, w, h) {
			const cx = w / 2;
			const cy = h / 2;
			const size = Math.min(w, h) * 0.4;

			this._rays(ctx, cx, cy, size, w, h);
			this._ball(ctx, cx, cy, size);
			this._electricity(ctx, cx, cy, size);

			this.frame++;
		},
		_frameGlow(ctx, box, band) {
			const c = this._rgb || DEFAULT_BALL;
			const color = `rgb(${c.r},${c.g},${c.b})`;
			const grow = band / 4;
			ctx.save();
			ctx.fillStyle = color;
			ctx.shadowColor = color;
			ctx.shadowBlur = band;
			ctx.beginPath();
			ctx.roundRect(
				box.x - grow,
				box.y - grow,
				box.w + grow * 2,
				box.h + grow * 2,
				cornerRadius(box) + grow,
			);
			ctx.fill();
			ctx.restore();
		},
		_frameElectricity(ctx, box, band) {
			const perimeter = perimeterLength(box);
			const count = Math.max(24, Math.round(perimeter / FRAME_SPARK_GAP));
			const offsets = [];
			for (let i = 0; i < count; i++)
				offsets.push(Math.random() * perimeter);
			offsets.sort((a, b) => a - b);
			const nodes = offsets.map((p) =>
				perimeterPoint(box, p, Math.random() * band * 0.7),
			);
			ctx.lineWidth = 2;
			ctx.strokeStyle = "white";
			ctx.beginPath();
			for (let i = 0; i < count; i++) {
				for (let k = 1; k <= 2; k++) {
					const next = nodes[(i + k) % count];
					ctx.moveTo(nodes[i][0], nodes[i][1]);
					ctx.lineTo(next[0], next[1]);
				}
			}
			ctx.stroke();
		},
		drawFrame(ctx, t, w, h, box) {
			const band = Math.max(
				1,
				Math.min(box.x, box.y, w - box.x - box.w, h - box.y - box.h),
			);
			this._raysPath(ctx, w / 2, h / 2, w, h);
			ctx.fillStyle = FRAME_RAYS;
			ctx.fill();
			this._frameGlow(ctx, box, band);
			this._frameElectricity(ctx, box, band);

			this.frame++;
		},
	});
})();
