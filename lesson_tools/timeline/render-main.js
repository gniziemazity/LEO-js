"use strict";

function drawMiddleChart(ctx, p, L) {
	const { M, W, Hmid: H, plotW, plotHmid } = L;
	const bottomY = M.top + plotHmid;

	ctx.fillStyle = THEME.chartBg;
	ctx.fillRect(0, 0, W, H);

	ctx.save();
	ctx.beginPath();
	ctx.rect(M.left, M.top, plotW, plotHmid);
	ctx.clip();

	ctx.strokeStyle = THEME.chartGrid;
	ctx.lineWidth = 1;
	for (const r of [10, 20, 50, 100, 200, 500, 1000]) {
		const y = rateToY(r, L);
		ctx.beginPath();
		ctx.moveTo(M.left, y);
		ctx.lineTo(M.left + plotW, y);
		ctx.stroke();
	}

	function bar(ts, rate, dur, colorKey, alpha = 0.72) {
		const { bx, bw } = _blockBarGeom(ts, dur, L);
		const y = rateToY(rate, L);
		const bh = bottomY - y;
		const fill = BAR_COLORS[colorKey] || BAR_COLORS.normal;
		ctx.globalAlpha = alpha;
		ctx.fillStyle = fill;
		ctx.fillRect(bx, y, bw, bh);
		ctx.globalAlpha = 1;
		ctx.strokeStyle = fill;
		ctx.lineWidth = 0.5;
		ctx.strokeRect(bx, y, bw, bh);
	}

	for (const b of p.bursts) {
		const span = _burstEffectiveSpan(b);
		if (b.chars > 0) {
			const hasVirtual = b.hasCodeInserts || b.hasAnchors || b.hasMoves;
			const effectiveRate = hasVirtual ? Math.max(b.rate, 20) : b.rate;
			bar(span.centerTs, effectiveRate, span.dur, b.colorType);
		} else if (b.hasCodeInserts) {
			const insLen = b.evs
				.filter((e) => e._virtualType === "code_insert")
				.reduce((s, e) => s + (e.code_insert || "").length, 0);
			bar(
				span.centerTs,
				Math.max(10, insLen / (CFG.BAR_MIN_SECS / 60)),
				span.dur,
				"normal",
			);
		} else if (b.hasAnchors || b.hasMoves) {
			bar(
				span.centerTs,
				20,
				span.dur,
				b.hasAnchors ? "anchor" : "move",
				0.7,
			);
		}
	}
	for (const kp of p.singletons) {
		const ts = kp.timestamp / 1000;
		const extra = _eventDurationSec(kp);
		if (kp._virtualType === "anchor") {
			bar(ts, 20, 0, "anchor", 0.7);
		} else if (kp._virtualType === "move") {
			bar(ts, 20, 0, "move", 0.7);
		} else if (kp._virtualType === "code_insert") {
			bar(
				ts + extra / 2,
				Math.max(
					10,
					(kp.code_insert || "").length / (CFG.BAR_MIN_SECS / 60),
				),
				extra,
				"normal",
			);
		} else {
			const ck =
				kp._editor === "dev"
					? "dev"
					: DELETE_CHARS.has(kp.char)
						? "remove"
						: "normal";
			bar(ts + extra / 2, 20, extra, ck);
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
	rateLine(p.sessionRate, THEME.chartKpmSession);
	rateLine(p.activeRate, THEME.chartKpmActive);
	ctx.globalAlpha = 1;

	ctx.restore();

	drawYAxisLog(ctx, L);
	rotatedLabel(
		ctx,
		22,
		L.M.top + L.plotHmid / 2,
		"Keys / Minute",
		THEME.label,
	);

	ctx.font = "10px Consolas,monospace";
	ctx.textAlign = "left";
	const lx = M.left + plotW - 110,
		ly = M.top - 2;
	[
		[`Session: ${p.sessionRate.toFixed(1)} kpm`, THEME.chartKpmSession],
		[`Active:  ${p.activeRate.toFixed(1)} kpm`, THEME.chartKpmActive],
	].forEach(([lbl, clr], i) => {
		const yy = ly + i * 16;
		ctx.fillStyle = clr;
		ctx.fillText(lbl, lx + 14, yy + 9);
	});

	drawTimeAxis(ctx, L, M.top + plotHmid, H);
}

function drawTopChart(ctx, p, L) {
	const { M, W, Htop: H, plotW, plotHtop } = L;
	const cum = p.cumulative;
	const maxN = p.totalChars || 1;
	const gs = _tlNiceStep(maxN, 5);

	ctx.fillStyle = THEME.chartBg;
	ctx.fillRect(0, 0, W, H);

	ctx.save();
	ctx.beginPath();
	ctx.rect(M.left, M.top, plotW, plotHtop);
	ctx.clip();

	ctx.strokeStyle = THEME.chartGrid;
	ctx.lineWidth = 1;
	for (let v = gs; v <= maxN; v += gs) {
		const y = countToY(v, maxN, L);
		ctx.beginPath();
		ctx.moveTo(M.left, y);
		ctx.lineTo(M.left + plotW, y);
		ctx.stroke();
	}

	if (_topChartVisible.interactions)
		drawInteractionSpans(ctx, p, L, M.top, plotHtop, {
			...Object.fromEntries(
				Object.entries(INTERACTION_COLORS).map(([k, v]) => [k, v.spanRgba]),
			),
			"teacher-question": (q) =>
				q.answered_by?.length
					? INTERACTION_COLORS["teacher-question"].spanRgba
					: {
							striped: true,
							color: INTERACTION_COLORS["teacher-question"].hex,
						},
		});

	if (cum.length > 1) {
		const pts = cum.map((c) => [tsToX(c.ts, L), countToY(c.count, maxN, L)]);
		ctx.beginPath();
		ctx.moveTo(pts[0][0], pts[0][1]);
		for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
		ctx.lineTo(pts[pts.length - 1][0], M.top + plotHtop);
		ctx.lineTo(pts[0][0], M.top + plotHtop);
		ctx.closePath();
		ctx.fillStyle = THEME.chartCumulativeFill;
		ctx.fill();
		ctx.beginPath();
		ctx.moveTo(pts[0][0], pts[0][1]);
		for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
		ctx.strokeStyle = THEME.chartCumulative;
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
		ctx.strokeStyle = THEME.muted;
		ctx.lineWidth = 2.5;
		ctx.stroke();
		const ir = 3;
		ctx.beginPath();
		ctx.moveTo(x, y - ir);
		ctx.lineTo(x + ir, y);
		ctx.lineTo(x, y + ir);
		ctx.lineTo(x - ir, y);
		ctx.closePath();
		ctx.fillStyle = THEME.black;
		ctx.fill();
		ctx.restore();
	}

	if (_topChartVisible.chars)
		for (const grp of p.burstGroups)
			for (const idx of grp.idxs) {
				const c = cum[idx];
				if (!c) continue;
				dot(tsToX(c.ts, L), countToY(c.count, maxN, L), THEME.black, 1.0);
			}
	if (_topChartVisible.deletes)
		for (const ev of p.deletes) {
			const ts = ev.timestamp / 1000;
			dot(
				tsToX(ts, L),
				countToY(charsAt(ts, cum), maxN, L),
				ev._isStructuralDelete ? THEME.paleRed : BAR_COLORS.remove,
				1.0,
			);
		}
	if (_topChartVisible.dev)
		for (const ev of p.devChars) {
			const ts = ev.timestamp / 1000;
			dot(
				tsToX(ts, L),
				countToY(charsAt(ts, cum), maxN, L),
				BAR_COLORS.dev,
				1.0,
			);
		}
	if (_topChartVisible.anchors)
		for (const anc of p.anchors) {
			const ts = anc.ts / 1000;
			dot(
				tsToX(ts, L),
				countToY(charsAt(ts, cum), maxN, L),
				BAR_COLORS.anchor,
				1.0,
			);
		}
	if (_topChartVisible.moves)
		for (const mv of p.moves) {
			const ts = mv.ts / 1000;
			dot(
				tsToX(ts, L),
				countToY(charsAt(ts, cum), maxN, L),
				BAR_COLORS.move,
				1.0,
			);
		}
	if (_topChartVisible.inserts)
		for (const ev of p.codeInserts) {
			const ts = ev.timestamp / 1000;
			dia(
				tsToX(ts, L),
				countToY(charsAt(ts, cum), maxN, L),
				THEME.chartInsertMarker,
			);
		}

	ctx.restore();

	ctx.fillStyle = THEME.chartAxisText;
	ctx.font = "11px Consolas,monospace";
	ctx.textAlign = "right";
	ctx.strokeStyle = THEME.chartAxisTick;
	ctx.lineWidth = 1;
	for (let v = gs; v <= maxN; v += gs) {
		const y = countToY(v, maxN, L);
		ctx.fillText(v, M.left - 3, y + 4);
		ctx.beginPath();
		ctx.moveTo(M.left - 3, y);
		ctx.lineTo(M.left, y);
		ctx.stroke();
	}
	rotatedLabel(ctx, 22, M.top + plotHtop / 2, "Key Presses", THEME.label);

	drawTimeAxis(ctx, L, M.top + plotHtop, H);
}
