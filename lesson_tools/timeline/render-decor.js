"use strict";

function drawBlockBackgrounds(ctx, p, L) {
	const { M, plotHbot } = L;

	ctx.save();

	const drawBand = (cx, dur, key) => {
		const { bx, bw } = _blockBarGeom(cx, dur, L);
		const color = BAR_COLORS[key] || BAR_COLORS.normal;
		ctx.fillStyle = _hexToRgba(color, 0.15);
		ctx.fillRect(bx, M.top, bw, plotHbot);
	};

	for (const b of p.bursts || []) {
		const span = _burstEffectiveSpan(b);
		drawBand(span.centerTs, span.dur, _burstColorKey(b));
	}
	for (const kp of p.singletons || []) {
		const ts = kp.timestamp / 1000;
		const extra = _eventDurationSec(kp);
		drawBand(ts + extra / 2, extra, _singletonColorKey(kp));
	}
	ctx.restore();
}

function drawBlockMistakeCounts(ctx, p, students, L) {
	if (!students || !students.length) return;
	const { M, plotW } = L;
	const xMin = M.left;
	const xMax = M.left + plotW;
	const labelY = Math.max(8, M.top - 10);

	const blocks = _buildBottomChartBlocks(p);
	const studentEvs = _studentMistakes(students);

	ctx.save();
	ctx.fillStyle = THEME.textStrong;
	ctx.font = "bold 10px Consolas,monospace";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";

	for (const blk of blocks) {
		const cx = (tsToX(blk.ts1, L) + tsToX(blk.ts2, L)) / 2;
		if (cx < xMin || cx > xMax) continue;
		const count = _countStudentsInRange(studentEvs, blk.ts1, blk.ts2);
		if (count === 0) continue;
		ctx.fillText(String(count), cx, labelY);
	}
	ctx.restore();
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
	const blue = INTERACTION_COLORS["teacher-question"].hex;
	const orange = INTERACTION_COLORS["student-question"].hex;
	const green = INTERACTION_COLORS["providing-help"].hex;
	const n = (ans ? 1 : 0) + (ask ? 1 : 0) + (hlp ? 1 : 0);
	if (n === 3) {
		drawStar(ctx, x, y, 9, green, 1.0);
		drawStar(ctx, x, y, 5, orange, 1.0);
		drawStar(ctx, x, y, 2, blue, 1.0);
	} else if (n === 2) {
		const [outerClr, innerClr] =
			ans && ask
				? [orange, blue]
				: ans && hlp
					? [green, blue]
					: [green, orange];
		drawStar(ctx, x, y, 9, outerClr, 1.0);
		drawStar(ctx, x, y, 5, innerClr, 1.0);
	} else {
		const fill = ans ? blue : ask ? orange : green;
		drawStar(ctx, x, y, 9, fill, 1.0);
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
			const w = Math.max(x2 - x1, 2);
			const spec = typeof clrOrFn === "function" ? clrOrFn(q) : clrOrFn;
			if (spec && typeof spec === "object" && spec.striped) {
				_fillStriped(ctx, x1, plotTop, w, plotH, spec.color);
			} else {
				ctx.fillStyle = spec;
				ctx.fillRect(x1, plotTop, w, plotH);
			}
		}
	}
}

function drawYAxisLog(ctx, L) {
	const { M, plotHmid } = L;
	ctx.strokeStyle = THEME.chartAxisLine;
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(M.left, M.top);
	ctx.lineTo(M.left, M.top + plotHmid);
	ctx.stroke();
	ctx.fillStyle = THEME.chartAxisText;
	ctx.font = "11px Consolas,monospace";
	ctx.textAlign = "right";
	ctx.strokeStyle = THEME.chartAxisTick;
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

	ctx.strokeStyle = THEME.chartAxisLine;
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(M.left, axisY);
	ctx.lineTo(M.left + plotW, axisY);
	ctx.stroke();
	ctx.fillStyle = THEME.chartAxisText;
	ctx.font = "10px Consolas,monospace";
	ctx.textAlign = "center";
	ctx.strokeStyle = THEME.chartAxisTick;
	for (let ts = firstTick; ts <= timeMax; ts += tickInt) {
		const x = tsToX(ts, L);
		ctx.beginPath();
		ctx.moveTo(x, axisY);
		ctx.lineTo(x, axisY + 4);
		ctx.stroke();
		ctx.fillText(fmtTime(ts), x, axisY + 14);
	}
}
