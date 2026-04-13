"use strict";

function tsToX(ts, L) {
	return L.M.left + (L.plotW * (ts - L.timeMin)) / (L.timeMax - L.timeMin);
}
function xToTs(x, L) {
	return L.timeMin + ((x - L.M.left) / L.plotW) * (L.timeMax - L.timeMin);
}

const Y1_LO = 5,
	Y1_HI = 1500;
function rateToY(r, L) {
	const t =
		(Math.log10(Math.max(r, Y1_LO)) - Math.log10(Y1_LO)) /
		(Math.log10(Y1_HI) - Math.log10(Y1_LO));
	return L.M.top + L.plotH1 * (1 - t);
}
function countToY(n, maxN, L) {
	const pad = L.plotH2Pad || 0;
	return L.M.top + pad + (L.plotH2 - 2 * pad) * (1 - n / Math.max(maxN, 1));
}
function pctToY(pct, L) {
	const pad = L.plotH3Pad || 0;
	return (
		L.M.top +
		pad +
		(L.plotH3 - 2 * pad) * (1 - Math.max(0, Math.min(100, pct)) / 100)
	);
}

function makeLayout(p, W, H1, H2, H3) {
	const M = CFG.M;
	return {
		W,
		M,
		H1,
		H2,
		H3,
		plotW: W - M.left - M.right,
		plotH1: H1 - M.top - M.bottom,
		plotH2: H2 - M.top - M.bottom,
		plotH2Pad: 8,
		plotH3: H3 - M.top - M.bottom,
		plotH3Pad: 8,
		timeMin: _zoomMin ?? p.sessionStart - CFG.PADDING,
		timeMax: _zoomMax ?? p.sessionEnd + CFG.PADDING,
	};
}

function prep(c, W, H) {
	const dpr = window.devicePixelRatio || 1;
	c.width = W * dpr;
	c.height = H * dpr;
	c.style.width = W + "px";
	c.style.height = H + "px";
	const ctx = c.getContext("2d");
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	return ctx;
}

function scheduleRender() {
	if (_renderScheduled) return;
	_renderScheduled = true;
	requestAnimationFrame(() => {
		_renderScheduled = false;
		showLoading(false);
		if (_p) renderCharts(_p);
	});
}

function renderCharts(p) {
	const c1 = document.getElementById("chart1");
	const c2 = document.getElementById("chart2");
	const c3 = document.getElementById("chart3");
	const W = c1.parentElement.clientWidth;
	const H1 = c1.parentElement.clientHeight;
	const H2 = c2.parentElement.clientHeight;
	const H3 = _students ? c3.parentElement.clientHeight : 0;
	const L = makeLayout(p, W, H1, H2, H3);
	_lastL = L;

	drawChart1(prep(c1, W, H1), p, L);
	drawChart2(prep(c2, W, H2), p, L);
	setupChart2Legend(p);
	if (_students) drawChart3(prep(c3, W, H3), p, _students, L);

	setupZoomPan(c1, p, L);
	setupZoomPan(c2, p, L);
	if (_students) setupZoomPan(c3, p, L);
	setupHover(c1, c2, c3, p, L);
	updateZoomLabel(p, L);
}

function redrawChart3() {
	if (!_p || !_students || !_lastL) return;
	const c3 = document.getElementById("chart3");
	const dpr = window.devicePixelRatio || 1;
	const ctx = c3.getContext("2d");
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	drawChart3(ctx, _p, _students, _lastL);
}

const BAR_COLORS = {
	normal: ["#777777", "#000000"],
	dev: ["#22aa22", "#116611"],
	remove: ["#CC2222", "#880000"],
	insert: ["#999999", "#666666"],
	anchor: ["#007acc", "#005a99"],
	move: ["#e07020", "#a04010"],
};

const _chart2Visible = {
	chars: true,
	inserts: true,
	deletes: true,
	anchors: true,
	dev: true,
	moves: true,
};

function setupChart2Legend(p) {
	const totalEl = document.getElementById("leg-total");
	if (totalEl) totalEl.textContent = `Total Events: ${p.eventCount}`;
	const items = [
		{ key: "chars", count: p.totalChars },
		{ key: "inserts", count: p.codeInserts.length },
		{ key: "deletes", count: p.deletes.length },
		{ key: "dev", count: p.devChars.length },
		{ key: "anchors", count: p.anchors.length },
		{ key: "moves", count: p.moves.length },
	];
	for (const { key, count } of items) {
		const cb = document.getElementById("leg-" + key);
		if (!cb) continue;
		const countEl = cb.closest("label")?.querySelector(".leg-count");
		if (countEl) countEl.textContent = `(${count})`;
		cb.onchange = () => {
			_chart2Visible[key] = cb.checked;
			scheduleRender();
		};
	}
}

function drawChart1(ctx, p, L) {
	const { M, W, H1: H, plotW, plotH1 } = L;
	const bottomY = M.top + plotH1;
	const minBarW =
		tsToX(p.sessionStart + CFG.BAR_MIN_SECS, L) - tsToX(p.sessionStart, L);

	ctx.fillStyle = "#fff";
	ctx.fillRect(0, 0, W, H);

	ctx.save();
	ctx.beginPath();
	ctx.rect(M.left, M.top, plotW, plotH1);
	ctx.clip();

	ctx.strokeStyle = "#e8e8e8";
	ctx.lineWidth = 1;
	for (const r of [10, 20, 50, 100, 200, 500, 1000]) {
		const y = rateToY(r, L);
		ctx.beginPath();
		ctx.moveTo(M.left, y);
		ctx.lineTo(M.left + plotW, y);
		ctx.stroke();
	}

	function bar(ts, rate, dur, colorKey, alpha = 0.72) {
		const x = tsToX(ts - dur / 2, L);
		const x2 = tsToX(ts + dur / 2, L);
		const bw = Math.max(x2 - x, minBarW);
		const cx = (x + x2) / 2;
		const bx = cx - bw / 2;
		const y = rateToY(rate, L);
		const bh = bottomY - y;
		const [fill, edge] = BAR_COLORS[colorKey] || BAR_COLORS.normal;
		ctx.globalAlpha = alpha;
		ctx.fillStyle = fill;
		ctx.fillRect(bx, y, bw, bh);
		ctx.globalAlpha = 1;
		ctx.strokeStyle = edge;
		ctx.lineWidth = 0.5;
		ctx.strokeRect(bx, y, bw, bh);
	}

	for (const b of p.bursts) {
		if (b.chars > 0) {
			const hasVirtual = b.hasCodeInserts || b.hasAnchors || b.hasMoves;
			const effectiveRate = hasVirtual ? Math.max(b.rate, 20) : b.rate;
			bar(b.centerTs, effectiveRate, b.dur, b.colorType);
		} else if (b.hasCodeInserts) {
			const insLen = b.evs
				.filter((e) => e._virtualType === "code_insert")
				.reduce((s, e) => s + (e.code_insert || "").length, 0);
			bar(
				b.centerTs,
				Math.max(10, insLen / (CFG.BAR_MIN_SECS / 60)),
				b.dur,
				"insert",
				0.6,
			);
		} else if (b.hasAnchors || b.hasMoves) {
			bar(b.centerTs, 20, b.dur, b.hasAnchors ? "anchor" : "move", 0.7);
		}
	}
	for (const kp of p.singletons) {
		if (kp._virtualType === "anchor") {
			bar(kp.timestamp / 1000, 20, 0, "anchor", 0.7);
		} else if (kp._virtualType === "move") {
			bar(kp.timestamp / 1000, 20, 0, "move", 0.7);
		} else if (kp._virtualType === "code_insert") {
			bar(
				kp.timestamp / 1000,
				Math.max(
					10,
					(kp.code_insert || "").length / (CFG.BAR_MIN_SECS / 60),
				),
				0,
				"insert",
				0.6,
			);
		} else {
			const ck =
				kp._editor === "dev"
					? "dev"
					: DELETE_CHARS.has(kp.char)
						? "remove"
						: "normal";
			bar(kp.timestamp / 1000, 20, 0, ck);
		}
	}

	ctx.lineWidth = 2;
	ctx.globalAlpha = 0.7;
	function rateLine(r, clr) {
		const y = rateToY(r, L);
		ctx.strokeStyle = clr;
		ctx.setLineDash([6, 4]);
		ctx.beginPath();
		ctx.moveTo(M.left, y);
		ctx.lineTo(M.left + plotW, y);
		ctx.stroke();
		ctx.setLineDash([]);
	}
	rateLine(p.sessionRate, "#888888");
	rateLine(p.activeRate, "#000000");
	ctx.globalAlpha = 1;

	ctx.restore();

	drawYAxisLog(ctx, L);
	rotatedLabel(ctx, 22, L.M.top + L.plotH1 / 2, "Keys / Minute", "#666");

	ctx.font = "10px Consolas,monospace";
	ctx.textAlign = "left";
	const lx = M.left + plotW - 110,
		ly = M.top - 2;
	[
		[`Session: ${p.sessionRate.toFixed(1)} kpm`, "#888888"],
		[`Active:  ${p.activeRate.toFixed(1)} kpm`, "#000000"],
	].forEach(([lbl, clr], i) => {
		const yy = ly + i * 16;
		ctx.fillStyle = clr;
		ctx.fillText(lbl, lx + 14, yy + 9);
	});

	drawTimeAxis(ctx, L, M.top + plotH1, H);
}

function drawChart2(ctx, p, L) {
	const { M, W, H2: H, plotW, plotH2 } = L;
	const cum = p.cumulative;
	const maxN = p.totalChars || 1;
	const gs = niceStep(maxN, 5);

	ctx.fillStyle = "#fff";
	ctx.fillRect(0, 0, W, H);

	ctx.save();
	ctx.beginPath();
	ctx.rect(M.left, M.top, plotW, plotH2);
	ctx.clip();

	ctx.strokeStyle = "#e8e8e8";
	ctx.lineWidth = 1;
	for (let v = gs; v <= maxN; v += gs) {
		const y = countToY(v, maxN, L);
		ctx.beginPath();
		ctx.moveTo(M.left, y);
		ctx.lineTo(M.left + plotW, y);
		ctx.stroke();
	}

	drawInteractionSpans(
		ctx,
		p,
		L,
		M.top,
		plotH2,
		Object.fromEntries(
			Object.entries(INTERACTION_COLORS).map(([k, v]) => [k, v.spanRgba]),
		),
	);

	if (cum.length > 1) {
		const pts = cum.map((c) => [tsToX(c.ts, L), countToY(c.count, maxN, L)]);
		ctx.beginPath();
		ctx.moveTo(pts[0][0], pts[0][1]);
		for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
		ctx.lineTo(pts[pts.length - 1][0], M.top + plotH2);
		ctx.lineTo(pts[0][0], M.top + plotH2);
		ctx.closePath();
		ctx.fillStyle = "rgba(204,204,204,0.3)";
		ctx.fill();
		ctx.beginPath();
		ctx.moveTo(pts[0][0], pts[0][1]);
		for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
		ctx.strokeStyle = "#CCCCCC";
		ctx.lineWidth = 2;
		ctx.stroke();
	}

	const R = CFG.DOT_R,
		DR = CFG.DIA_R;

	function dot(x, y, fill, alpha = 1) {
		ctx.save();
		ctx.globalAlpha = alpha;
		ctx.beginPath();
		ctx.arc(x, y, R, 0, Math.PI * 2);
		ctx.fillStyle = fill;
		ctx.fill();
		ctx.restore();
	}
	function dia(x, y, fill, alpha = 1) {
		ctx.save();
		ctx.globalAlpha = alpha;
		const outerR = DR - 2;
		ctx.beginPath();
		ctx.moveTo(x, y - outerR);
		ctx.lineTo(x + outerR, y);
		ctx.lineTo(x, y + outerR);
		ctx.lineTo(x - outerR, y);
		ctx.closePath();
		ctx.fillStyle = fill;
		ctx.fill();
		ctx.strokeStyle = "#888";
		ctx.lineWidth = 2.5;
		ctx.stroke();
		const ir = 3;
		ctx.beginPath();
		ctx.moveTo(x, y - ir);
		ctx.lineTo(x + ir, y);
		ctx.lineTo(x, y + ir);
		ctx.lineTo(x - ir, y);
		ctx.closePath();
		ctx.fillStyle = "#000";
		ctx.fill();
		ctx.restore();
	}

	if (_chart2Visible.chars)
		for (const grp of p.burstGroups)
			for (const idx of grp.idxs) {
				const c = cum[idx];
				if (!c) continue;
				dot(tsToX(c.ts, L), countToY(c.count, maxN, L), "#000", 1.0);
			}
	if (_chart2Visible.deletes)
		for (const ev of p.deletes) {
			const ts = ev.timestamp / 1000;
			dot(
				tsToX(ts, L),
				countToY(charsAt(ts, cum), maxN, L),
				ev._isStructuralDelete ? "#EE9999" : "#CC2222",
				1.0,
			);
		}
	if (_chart2Visible.dev)
		for (const ev of p.devChars) {
			const ts = ev.timestamp / 1000;
			dot(tsToX(ts, L), countToY(charsAt(ts, cum), maxN, L), "#22aa22", 1.0);
		}
	if (_chart2Visible.anchors)
		for (const anc of p.anchors) {
			const ts = anc.ts / 1000;
			dot(tsToX(ts, L), countToY(charsAt(ts, cum), maxN, L), "#007acc", 1.0);
		}
	if (_chart2Visible.moves)
		for (const mv of p.moves) {
			const ts = mv.ts / 1000;
			dot(tsToX(ts, L), countToY(charsAt(ts, cum), maxN, L), "#e07020", 1.0);
		}
	if (_chart2Visible.inserts)
		for (const ev of p.codeInserts) {
			const ts = ev.timestamp / 1000;
			dia(tsToX(ts, L), countToY(charsAt(ts, cum), maxN, L), "#999999");
		}

	ctx.restore();

	ctx.fillStyle = "#555";
	ctx.font = "11px Consolas,monospace";
	ctx.textAlign = "right";
	ctx.strokeStyle = "#aaa";
	ctx.lineWidth = 1;
	for (let v = gs; v <= maxN; v += gs) {
		const y = countToY(v, maxN, L);
		ctx.fillText(v, M.left - 3, y + 4);
		ctx.beginPath();
		ctx.moveTo(M.left - 3, y);
		ctx.lineTo(M.left, y);
		ctx.stroke();
	}
	rotatedLabel(ctx, 22, M.top + plotH2 / 2, "Chars Typed", "#666");

	drawTimeAxis(ctx, L, M.top + plotH2, H);
}

function drawChart3(ctx, p, students, L) {
	const { M, W, H3: H, plotW, plotH3 } = L;
	const gs = 10;

	ctx.fillStyle = "#fff";
	ctx.fillRect(0, 0, W, H);

	ctx.save();
	ctx.beginPath();
	ctx.rect(M.left, M.top, plotW, plotH3);
	ctx.clip();

	ctx.strokeStyle = "#e8e8e8";
	ctx.lineWidth = 1;
	for (let v = gs; v <= 100; v += gs) {
		const y = pctToY(v, L);
		ctx.beginPath();
		ctx.moveTo(M.left, y);
		ctx.lineTo(M.left + plotW, y);
		ctx.stroke();
	}

	for (const s of students) {
		const isHovered = _hoveredStudent && s.name === _hoveredStudent.name;
		const jitter = _shake
			? _jitterMap.get(s.name) || { dx: 0, dy: 0 }
			: { dx: 0, dy: 0 };
		const evs = (s.follow_events || []).filter((e) => e.ts != null);
		if (!evs.length) continue;
		const sorted = [...evs].sort((a, b) => a.ts - b.ts);
		const clusters = [];
		let cur = [sorted[0]];
		for (let i = 1; i < sorted.length; i++) {
			if (sorted[i].ts - sorted[i - 1].ts < CFG.BURST_GAP * 2)
				cur.push(sorted[i]);
			else {
				clusters.push(cur);
				cur = [sorted[i]];
			}
		}
		clusters.push(cur);
		const barH = isHovered ? 6 : 3;
		const minY = L.M.top + (L.plotH3Pad || 0);
		const maxY = L.M.top + L.plotH3 - (L.plotH3Pad || 0);
		const y0 =
			Math.max(minY, Math.min(maxY, pctToY(s.follow_pct, L) + jitter.dy)) -
			barH / 2;
		for (const cl of clusters) {
			const x1 = tsToX(cl[0].ts, L);
			const x2 = Math.max(tsToX(cl[cl.length - 1].ts, L), x1 + 3);
			ctx.fillStyle = isHovered
				? "rgba(0,0,0,0.85)"
				: "rgba(180,180,180,0.35)";
			ctx.fillRect(x1, y0, x2 - x1, barH);
		}
	}

	const answering = new Set(),
		asking = new Set(),
		helping = new Set();
	for (const q of p.interactions["teacher-question"])
		for (const name of q.answered_by) answering.add(name);
	for (const q of p.interactions["student-question"]) {
		const nm = q.asked_by.trim();
		if (nm) asking.add(nm);
	}
	for (const q of p.interactions["providing-help"]) {
		const nm = q.student.trim();
		if (nm) helping.add(nm);
	}

	for (const s of students) {
		if (s.follow_dt == null) continue;
		const jitter = _shake
			? _jitterMap.get(s.name) || { dx: 0, dy: 0 }
			: { dx: 0, dy: 0 };
		const x = tsToX(s.follow_dt, L) + jitter.dx;
		const _minY = L.M.top + (L.plotH3Pad || 0);
		const _maxY = L.M.top + L.plotH3 - (L.plotH3Pad || 0);
		const y = Math.max(
			_minY,
			Math.min(_maxY, pctToY(s.follow_pct, L) + jitter.dy),
		);
		const ans = answering.has(s.name);
		const ask = asking.has(s.name);
		const hlp = helping.has(s.name);
		const active = ans || ask || hlp;
		const isHovered = _hoveredStudent && s.name === _hoveredStudent.name;

		ctx.save();
		if (active) {
			if (isHovered) {
				drawStar(ctx, x, y, 9, "#000000", 1.0);
			} else {
				drawStudentStar(ctx, x, y, ans, ask, hlp);
			}
		} else {
			ctx.globalAlpha = isHovered ? 1.0 : 0.65;
			ctx.beginPath();
			ctx.arc(x, y, 5, 0, Math.PI * 2);
			ctx.fillStyle = isHovered ? "#000" : "#CCCCCC";
			ctx.fill();
			ctx.strokeStyle = isHovered ? "#000" : "#999";
			ctx.lineWidth = isHovered ? 1.5 : 0.8;
			ctx.stroke();
		}
		ctx.restore();
	}

	ctx.restore();

	ctx.fillStyle = "#555";
	ctx.font = "11px Consolas,monospace";
	ctx.textAlign = "right";
	ctx.strokeStyle = "#aaa";
	ctx.lineWidth = 1;
	for (let v = 0; v <= 100; v += 10) {
		const y = pctToY(v, L);
		ctx.fillText(v + "%", M.left - 3, y + 4);
		ctx.beginPath();
		ctx.moveTo(M.left - 3, y);
		ctx.lineTo(M.left, y);
		ctx.stroke();
	}
	rotatedLabel(ctx, 22, M.top + plotH3 / 2, "Follow Score", "#666");

	drawTimeAxis(ctx, L, M.top + plotH3, H);
}

function drawStar(ctx, cx, cy, r, fill, alpha = 1) {
	ctx.save();
	ctx.globalAlpha = alpha;
	ctx.beginPath();
	for (let i = 0; i < 5; i++) {
		const a1 = (i * 4 * Math.PI) / 5 - Math.PI / 2;
		const a2 = ((i * 4 + 2) * Math.PI) / 5 - Math.PI / 2;
		if (i === 0) ctx.moveTo(cx + r * Math.cos(a1), cy + r * Math.sin(a1));
		else ctx.lineTo(cx + r * Math.cos(a1), cy + r * Math.sin(a1));
		ctx.lineTo(cx + r * 0.4 * Math.cos(a2), cy + r * 0.4 * Math.sin(a2));
	}
	ctx.closePath();
	ctx.fillStyle = fill;
	ctx.fill();
	ctx.restore();
}

function drawStudentStar(ctx, x, y, ans, ask, hlp) {
	const n = (ans ? 1 : 0) + (ask ? 1 : 0) + (hlp ? 1 : 0);
	if (n === 3) {
		drawStar(ctx, x, y, 9, "#66BB6A", 1.0);
		drawStar(ctx, x, y, 5, "#e07020", 1.0);
		drawStar(ctx, x, y, 2, "#007acc", 1.0);
	} else if (n === 2) {
		const [outerClr, innerClr] =
			ans && ask
				? ["#e07020", "#007acc"]
				: ans && hlp
					? ["#66BB6A", "#007acc"]
					: ["#66BB6A", "#e07020"];
		drawStar(ctx, x, y, 9, outerClr, 1.0);
		drawStar(ctx, x, y, 5, innerClr, 1.0);
	} else {
		const r = 9;
		const fill = ans ? "#007acc" : ask ? "#e07020" : "#66BB6A";
		drawStar(ctx, x, y, r, fill, 1.0);
	}
}

function drawInteractionSpans(ctx, p, L, plotTop, plotH, colors) {
	for (const [type, qs] of Object.entries(p.interactions)) {
		const clrOrFn = colors[type];
		if (!clrOrFn) continue;
		for (const q of qs) {
			let endTs;
			if (q.closed_at) {
				endTs = q.closed_at;
			} else {
				const nxt = p.events.find((e) => e.timestamp / 1000 > q.timestamp);
				endTs = nxt ? nxt.timestamp / 1000 : q.timestamp + 5;
			}
			const x1 = tsToX(q.timestamp, L),
				x2 = tsToX(endTs, L);
			ctx.fillStyle = typeof clrOrFn === "function" ? clrOrFn(q) : clrOrFn;
			ctx.fillRect(x1, plotTop, Math.max(x2 - x1, 2), plotH);
		}
	}
}

function drawYAxisLog(ctx, L) {
	const { M, plotH1 } = L;
	ctx.strokeStyle = "#ccc";
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(M.left, M.top);
	ctx.lineTo(M.left, M.top + plotH1);
	ctx.stroke();
	ctx.fillStyle = "#555";
	ctx.font = "11px Consolas,monospace";
	ctx.textAlign = "right";
	ctx.strokeStyle = "#aaa";
	for (const r of [10, 100, 1000]) {
		const y = rateToY(r, L);
		ctx.fillText(r, M.left - 3, y + 4);
		ctx.beginPath();
		ctx.moveTo(M.left - 3, y);
		ctx.lineTo(M.left, y);
		ctx.stroke();
	}
}

function drawTimeAxis(ctx, L, axisY, _H) {
	const { M, plotW, timeMin, timeMax } = L;
	const totalSecs = timeMax - timeMin;
	const targets = [5, 10, 15, 20, 30, 60, 120, 180, 300, 600, 900, 1800, 3600];
	const want = Math.min(plotW / 80, 14);
	const tickInt = targets.find((t) => totalSecs / t <= want) || 3600;
	const firstTick = Math.ceil(timeMin / tickInt) * tickInt;

	ctx.strokeStyle = "#ccc";
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(M.left, axisY);
	ctx.lineTo(M.left + plotW, axisY);
	ctx.stroke();
	ctx.fillStyle = "#555";
	ctx.font = "10px Consolas,monospace";
	ctx.textAlign = "center";
	ctx.strokeStyle = "#aaa";
	for (let ts = firstTick; ts <= timeMax; ts += tickInt) {
		const x = tsToX(ts, L);
		ctx.beginPath();
		ctx.moveTo(x, axisY);
		ctx.lineTo(x, axisY + 4);
		ctx.stroke();
		ctx.fillText(fmtTime(ts), x, axisY + 14);
	}
}
