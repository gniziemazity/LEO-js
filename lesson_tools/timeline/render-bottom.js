"use strict";

function drawBottomChart(ctx, p, students, L) {
	const { M, W, Hbot: H, plotW, plotHbot } = L;
	const gs = 10;

	ctx.fillStyle = THEME.chartBg;
	ctx.fillRect(0, 0, W, H);

	if (_bottomChartVisible.barMode) {
		_drawBottomChartBars(ctx, p, students, L);
		_drawEmphasisRange(ctx, p, L);
		return;
	}

	_computeStudentYs(students, L);

	ctx.save();
	ctx.beginPath();
	ctx.rect(M.left, M.top, plotW, plotHbot);
	ctx.clip();

	drawBlockBackgrounds(ctx, p, L);

	if (!_bottomChartVisible.followRank) {
		ctx.strokeStyle = THEME.chartGrid;
		ctx.lineWidth = 1;
		for (let v = gs; v <= 100; v += gs) {
			const y = pctToY(v, L);
			ctx.beginPath();
			ctx.moveTo(M.left, y);
			ctx.lineTo(M.left + plotW, y);
			ctx.stroke();
		}
	}

	const drawDashesFor = (s, emphasized) => {
		const jitter = _jitterFor(s.name);
		const evs = _mistakeEventsFor(s);
		if (!evs.length) return;
		const clusters = _clusterMistakes(evs, CFG.BURST_GAP);
		const cy = _clampStudentY(s, jitter, L);
		const dotR = emphasized ? 2.0 : 1.5;
		for (const cl of clusters) {
			const isActiveCluster =
				emphasized &&
				_hoveredCluster &&
				cl[0].ts === _hoveredCluster.ts1 &&
				cl[cl.length - 1].ts === _hoveredCluster.ts2;
			if (isActiveCluster) {
				ctx.fillStyle = THEME.orange;
				for (const ev of cl) {
					const cx = tsToX(ev.ts, L);
					ctx.beginPath();
					ctx.arc(cx, cy, dotR + 2, 0, Math.PI * 2);
					ctx.fill();
				}
			}
			ctx.fillStyle = emphasized
				? "rgba(0,0,0,0.85)"
				: "rgba(130,130,130,0.55)";
			for (const ev of cl) {
				const cx = tsToX(ev.ts, L);
				ctx.beginPath();
				ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
				ctx.fill();
			}
		}
	};

	const drawDotFor = (s, emphasized, ans, ask, hlp) => {
		if (s.follow_dt == null) return;
		const jitter = _jitterFor(s.name);
		const x = tsToX(s.follow_dt, L) + jitter.dx;
		const y = _clampStudentY(s, jitter, L);
		const active = ans || ask || hlp;

		ctx.save();
		if (active) {
			if (emphasized) {
				drawStar(ctx, x, y, 9, THEME.black, 1.0);
			} else {
				drawStudentStar(ctx, x, y, ans, ask, hlp);
			}
		} else {
			ctx.globalAlpha = emphasized ? 1.0 : 0.65;
			ctx.beginPath();
			ctx.arc(x, y, 5, 0, Math.PI * 2);
			ctx.fillStyle = emphasized ? THEME.black : THEME.chartDotMutedFill;
			ctx.fill();
			ctx.strokeStyle = emphasized ? THEME.black : THEME.chartDotMutedStroke;
			ctx.lineWidth = emphasized ? 1.5 : 0.8;
			ctx.stroke();
		}
		ctx.restore();
	};

	const answering = new Set(),
		asking = new Set(),
		helping = new Set();
	if (_bottomChartVisible.firstMismatch && _bottomChartVisible.interactions) {
		for (const q of p.interactions["teacher-question"])
			for (const field of q.answered_by) {
				const name = resolveInteractionStudent(field);
				if (name) answering.add(name);
			}
		for (const q of p.interactions["student-question"]) {
			const nm = resolveInteractionStudent(q.asked_by) || "";
			if (nm.trim()) asking.add(nm.trim());
		}
		for (const q of p.interactions["providing-help"]) {
			const nm = resolveInteractionStudent(q.student) || "";
			if (nm.trim()) helping.add(nm.trim());
		}
	}

	for (const s of students) {
		if (_hoveredStudent && s.name === _hoveredStudent.name) continue;
		drawDashesFor(s, false);
	}
	if (_bottomChartVisible.firstMismatch) {
		for (const s of students) {
			if (_hoveredStudent && s.name === _hoveredStudent.name) continue;
			drawDotFor(
				s,
				false,
				answering.has(s.name),
				asking.has(s.name),
				helping.has(s.name),
			);
		}
	}

	if (_hoveredStudent) {
		const hs = _hoveredStudent;
		const hEvs = _mistakeEventsFor(hs);
		if (hEvs.length) {
			const hSorted = [...hEvs].sort((a, b) => a.ts - b.ts);
			const hJitter = _jitterFor(hs.name);
			const cy = _clampStudentY(hs, hJitter, L);
			const x1 = tsToX(hSorted[0].ts, L);
			const x2 = tsToX(hSorted[hSorted.length - 1].ts, L);
			const bandH = 10;
			const padX = 6;
			const radius = 5;
			const bx = x1 - padX;
			const bw = x2 - x1 + 2 * padX;
			const by = cy - bandH / 2;
			ctx.fillStyle = _hexToRgba(THEME.blue, 0.5);
			ctx.beginPath();
			if (typeof ctx.roundRect === "function") {
				ctx.roundRect(bx, by, bw, bandH, radius);
			} else {
				const r = Math.min(radius, bw / 2, bandH / 2);
				ctx.moveTo(bx + r, by);
				ctx.lineTo(bx + bw - r, by);
				ctx.arcTo(bx + bw, by, bx + bw, by + r, r);
				ctx.lineTo(bx + bw, by + bandH - r);
				ctx.arcTo(bx + bw, by + bandH, bx + bw - r, by + bandH, r);
				ctx.lineTo(bx + r, by + bandH);
				ctx.arcTo(bx, by + bandH, bx, by + bandH - r, r);
				ctx.lineTo(bx, by + r);
				ctx.arcTo(bx, by, bx + r, by, r);
				ctx.closePath();
			}
			ctx.fill();
		}

		drawDashesFor(hs, true);
		if (_bottomChartVisible.firstMismatch) {
			drawDotFor(
				hs,
				true,
				answering.has(hs.name),
				asking.has(hs.name),
				helping.has(hs.name),
			);
		}
	}

	ctx.restore();

	ctx.fillStyle = THEME.chartAxisText;
	ctx.font = "11px Consolas,monospace";
	ctx.textAlign = "right";
	ctx.strokeStyle = THEME.chartAxisTick;
	ctx.lineWidth = 1;
	if (_bottomChartVisible.followRank) {
		const N = students.length;
		if (N > 0) {
			for (let r = 1; r <= N; r++) {
				const y = M.top + ((r - 0.5) / N) * plotHbot;
				ctx.beginPath();
				ctx.moveTo(M.left - 3, y);
				ctx.lineTo(M.left, y);
				ctx.stroke();
				if (r === 1 || r === N) {
					ctx.fillText(String(r), M.left - 3, y + 4);
				}
			}
		}
	} else {
		for (let v = 0; v <= 100; v += 10) {
			const y = pctToY(v, L);
			ctx.beginPath();
			ctx.moveTo(M.left - 3, y);
			ctx.lineTo(M.left, y);
			ctx.stroke();
			if (v === 0 || v === 100) {
				ctx.fillText(v + "%", M.left - 3, y + 4);
			}
		}
	}

	const yLabel = _bottomChartVisible.followRank
		? "Follow Rank"
		: "Follow Score";
	rotatedLabel(ctx, 22, M.top + plotHbot / 2, yLabel, THEME.label);

	drawTimeAxis(ctx, L, M.top + plotHbot, H);
	drawBlockMistakeCounts(ctx, p, students, L);
	_drawEmphasisRange(ctx, p, L);
}

function _drawEmphasisRange(ctx, p, L) {
	if (!_emphasisStartHms || !_emphasisEndHms) return;
	const sessionDate = new Date(p.sessionStart * 1000);
	let t1 = _hmsToSeconds(_emphasisStartHms, sessionDate);
	let t2 = _hmsToSeconds(_emphasisEndHms, sessionDate);
	if (t1 == null || t2 == null) return;
	if (t2 < t1) [t1, t2] = [t2, t1];
	const { M, plotW, plotHbot } = L;
	const x1 = tsToX(t1, L);
	const x2 = tsToX(t2, L);
	if (x2 < M.left || x1 > M.left + plotW) return;
	ctx.save();
	ctx.beginPath();
	ctx.rect(M.left, M.top, plotW, plotHbot);
	ctx.clip();
	ctx.beginPath();
	ctx.roundRect(x1, M.top + 2, Math.max(x2 - x1, 2), plotHbot - 4, 3);
	ctx.lineWidth = 3.5;
	ctx.strokeStyle = THEME.black;
	ctx.stroke();
	const tipX = x1 - 5;
	const ay = M.top + 2 + 0.3 * (plotHbot - 4);
	ctx.beginPath();
	ctx.moveTo(tipX, ay);
	ctx.lineTo(tipX - 14, ay - 10);
	ctx.lineTo(tipX - 14, ay - 4);
	ctx.lineTo(tipX - 34, ay - 4);
	ctx.lineTo(tipX - 34, ay + 4);
	ctx.lineTo(tipX - 14, ay + 4);
	ctx.lineTo(tipX - 14, ay + 10);
	ctx.closePath();
	ctx.fillStyle = THEME.black;
	ctx.fill();
	ctx.restore();
}

function _drawBottomChartBars(ctx, p, students, L) {
	const { M, W, Hbot: H, plotW, plotHbot } = L;
	const bottomY = M.top + plotHbot;

	const blocks = _buildBottomChartBlocks(p);
	const studentEvs = _studentMistakes(students);
	const langEventCounts = (t1, t2) => {
		const counts = {};
		for (const evs of studentEvs) {
			for (const e of evs) {
				if (e.ts >= t1 && e.ts <= t2) {
					const l = e.lang || "?";
					if (!counts[l]) counts[l] = { ghost: 0, nonGhost: 0 };
					if (e.kind === "extra-star") counts[l].ghost++;
					else counts[l].nonGhost++;
				}
			}
		}
		return counts;
	};

	const counts = blocks.map((blk) =>
		_countStudentsInRange(studentEvs, blk.ts1, blk.ts2),
	);
	const totalStudents = (students || []).length;
	const denom = Math.max(1, totalStudents);

	ctx.save();
	ctx.beginPath();
	ctx.rect(M.left, M.top, plotW, plotHbot);
	ctx.clip();

	ctx.fillStyle = THEME.barTrack;
	for (let i = 0; i < blocks.length; i++) {
		const c = counts[i];
		if (c <= 0) continue;
		const blk = blocks[i];
		const { bx, bw } = _blockBarGeom(blk.centerTs, blk.dur, L);
		const bh = Math.min(plotHbot, (c / denom) * plotHbot);
		const by = bottomY - bh;
		ctx.fillRect(bx, by, bw, bh);
	}

	_drawTokenOverlay(ctx, p, students, L, denom);

	ctx.restore();

	const presentLangs = new Set();
	for (let i = 0; i < blocks.length; i++) {
		if (counts[i] <= 0) continue;
		const lc = langEventCounts(blocks[i].ts1, blocks[i].ts2);
		for (const l of Object.keys(lc)) {
			const v = lc[l];
			if (v.ghost + v.nonGhost > 0) presentLangs.add(l);
		}
	}
	const legendItems = LANG_STACK_ORDER.filter(
		(l) => l !== "comment" && presentLangs.has(l),
	);
	if (legendItems.length) {
		ctx.font = "bold 10px Consolas,monospace";
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		const sq = 9;
		const lx = M.left + 6;
		let ly = M.top + 8;
		for (const l of legendItems) {
			ctx.fillStyle = _langBarColorOf(l);
			ctx.fillRect(lx, ly - sq / 2, sq, sq);
			ctx.fillStyle = THEME.chartAxisText;
			ctx.fillText(l, lx + sq + 5, ly);
			ly += 14;
		}
	}

	ctx.fillStyle = THEME.chartAxisText;
	ctx.font = "11px Consolas,monospace";
	ctx.textAlign = "right";
	ctx.textBaseline = "alphabetic";
	ctx.strokeStyle = THEME.chartAxisTick;
	ctx.lineWidth = 1;
	const ticks = totalStudents > 0 ? [0, totalStudents] : [0];
	for (const v of ticks) {
		const y = bottomY - (v / denom) * plotHbot;
		ctx.beginPath();
		ctx.moveTo(M.left - 3, y);
		ctx.lineTo(M.left, y);
		ctx.stroke();
		ctx.fillText(String(v), M.left - 3, y + 4);
	}
	rotatedLabel(ctx, 22, M.top + plotHbot / 2, "Students", THEME.label);

	drawTimeAxis(ctx, L, M.top + plotHbot, H);
	drawBlockMistakeCounts(ctx, p, students, L);
}

let _tokenOverlaySlots = [];

function _drawTokenOverlay(ctx, p, students, L, denom) {
	_tokenOverlaySlots = [];
	if (!_teacherTokens || !_teacherTokens.length) return;
	const { M, plotW, plotHbot } = L;
	const scaleDenom = Math.max(1, denom || (students || []).length);
	const baseY = M.top + plotHbot;
	const blocks = _buildBottomChartBlocks(p);
	const tokenBars = _buildTokenViewBars(students);
	if (!tokenBars.length) return;

	for (const blk of blocks) {
		const tbs = tokenBars
			.filter((t) => !t.isComment && t.ts >= blk.ts1 && t.ts <= blk.ts2)
			.sort((a, b) => a.ts - b.ts);
		if (!tbs.length) continue;
		const blockLangCounts = {};
		for (const t of tbs) {
			if (!_langBarColorOf(t.lang)) continue;
			const w = t.students ? t.students.size : 0;
			blockLangCounts[t.lang] = (blockLangCounts[t.lang] || 0) + w + 1;
		}
		let dominantLang = null;
		let dominantCount = 0;
		for (const [l, c] of Object.entries(blockLangCounts)) {
			if (c > dominantCount) {
				dominantCount = c;
				dominantLang = l;
			}
		}
		const { bx, bw } = _blockBarGeom(blk.centerTs, blk.dur, L);
		const slotW = bw / tbs.length;
		for (let j = 0; j < tbs.length; j++) {
			const tb = tbs[j];
			const sx = bx + j * slotW;
			const nStudents = tb.students ? tb.students.size : 0;
			if (nStudents === 0) continue;
			const totalH = (nStudents / scaleDenom) * plotHbot;
			_tokenOverlaySlots.push({ bar: tb, sx, slotW, totalH });
			const nonGhost = tb.regularStudents ? tb.regularStudents.size : 0;
			const ghost = tb.ghostStudents ? tb.ghostStudents.size : 0;
			const subDenom = Math.max(1, nonGhost + ghost);
			const nonGhostH = totalH * (nonGhost / subDenom);
			const ghostH = totalH - nonGhostH;
			const lang = tb.lang || dominantLang;
			const color = _langBarColorOf(lang);
			if (!color) continue;
			if (nonGhostH > 0) {
				ctx.globalAlpha = 0.95;
				ctx.fillStyle = color;
				ctx.fillRect(sx, baseY - nonGhostH, slotW, nonGhostH);
				ctx.globalAlpha = 1;
			}
			if (ghostH > 0) {
				_fillStriped(ctx, sx, baseY - totalH, slotW, ghostH, color);
			}
		}
	}
}

function _tokenOverlayHitTest(mx, my, L) {
	const slots = _tokenOverlaySlots;
	if (!slots || !slots.length) return null;
	const baseY = L.M.top + L.plotHbot;
	for (let i = 0; i < slots.length; i++) {
		const sl = slots[i];
		if (mx < sl.sx || mx > sl.sx + sl.slotW) continue;
		if (my < baseY - Math.max(sl.totalH, 6) || my > baseY) continue;
		return { type: "token-bar", bar: sl.bar, idx: i };
	}
	return null;
}

function _buildTokenViewBars(students) {
	const byKey = new Map();
	const keyOf = (ts, token) => `${ts}|${token}`;
	for (const s of students || []) {
		const perKey = new Map();
		const evsByKey = new Map();
		for (const ev of s.follow_events || []) {
			if (!_isMistakeEvent(ev)) continue;
			const k = keyOf(ev.ts, ev.token);
			const cur = perKey.get(k);
			if (cur !== "ghost") {
				perKey.set(
					k,
					ev.kind === "extra-star" ? "ghost" : cur || "regular",
				);
			}
			if (!evsByKey.has(k)) evsByKey.set(k, []);
			evsByKey.get(k).push(ev);
			let entry = byKey.get(k);
			if (!entry) {
				entry = {
					ts: ev.ts,
					token: ev.token,
					students: new Set(),
					studentEntries: [],
					ghostStudents: new Set(),
					regularStudents: new Set(),
					lang: ev.lang || null,
				};
				byKey.set(k, entry);
			}
			if (!entry.lang && ev.lang) entry.lang = ev.lang;
		}
		for (const [k, kind] of perKey) {
			const entry = byKey.get(k);
			entry.studentEntries.push({ s, evs: evsByKey.get(k) || [] });
			entry.students.add(s.name);
			if (kind === "ghost") entry.ghostStudents.add(s.name);
			else entry.regularStudents.add(s.name);
		}
	}

	const EMPTY_SET = new Set();
	const EMPTY_ARR = [];
	return _teacherTokens.map((t) => {
		const lookupTs = t.isRemoved && t.delTs != null ? t.delTs : t.ts;
		const m = byKey.get(keyOf(lookupTs, t.token));
		return {
			ts: lookupTs,
			token: t.token,
			students: m ? m.students : EMPTY_SET,
			studentEntries: m ? m.studentEntries : EMPTY_ARR,
			ghostStudents: m ? m.ghostStudents : EMPTY_SET,
			regularStudents: m ? m.regularStudents : EMPTY_SET,
			lang: m ? m.lang : null,
			isComment: t.isComment,
			isRemoved: t.isRemoved,
			empty: !m,
		};
	});
}
