"use strict";

let _curatedPairConnectorSvg = null;
let _curatedPairConnectorItems = [];

function _curatedEnsurePairConnectorSvg() {
	if (_curatedPairConnectorSvg) return _curatedPairConnectorSvg;
	const svgNS = "http://www.w3.org/2000/svg";
	const svg = document.createElementNS(svgNS, "svg");
	svg.id = "curated-pair-connector-svg";
	svg.setAttribute("width", "100%");
	svg.setAttribute("height", "100%");
	document.body.appendChild(svg);
	_curatedPairConnectorSvg = svg;
	return svg;
}

function _curatedClearPairConnectors() {
	_curatedPairConnectorItems = [];
	if (_curatedPairConnectorSvg) _curatedPairConnectorSvg.innerHTML = "";
}

function _curatedFindPartnerEl(side, mark) {
	if (!mark || !mark.paired_with) return null;
	const partnerSide = side === "teacher" ? "student" : "teacher";
	return _curatedFindLeoMarkEl(
		partnerSide,
		mark.paired_with.start,
		mark.paired_with.token,
		mark.paired_with.file,
	);
}

function _curatedFindMoveAnchorEl(extraMark, sourceFile) {
	if (!extraMark || !extraMark.move_to) return null;
	const wrap = document.getElementById(`code-student`);
	if (!wrap) return null;
	const targetFile = extraMark.move_to.file;
	const paneSel = targetFile
		? `.code-pane[data-pane-file="${CSS.escape(targetFile)}"].active`
		: `.code-pane.active`;
	const sel =
		`${paneSel} .insert-anchor--move` +
		`[data-insert-anchor-move-source-file="${CSS.escape(sourceFile)}"]` +
		`[data-insert-anchor-move-source-pos="${extraMark.start}"]`;
	return wrap.querySelector(sel);
}

function _curatedFindInsertAnchorEl(teacherMark) {
	if (!teacherMark.insert_at) return null;
	const wrap = document.getElementById(`code-student`);
	if (!wrap) return null;
	const file = teacherMark.insert_at.file;
	const paneSel = file
		? `.code-pane[data-pane-file="${CSS.escape(file)}"].active`
		: `.code-pane.active`;
	const sel = `${paneSel} .insert-anchor[data-insert-anchor-teacher-pos="${teacherMark.start}"]`;
	return wrap.querySelector(sel);
}

function _curatedCollectConnectorsForRange(
	range,
	items,
	seenPairs,
	seenGroups,
) {
	const marks = _curatedFindMarks(range.side, range.file, range.lo, range.hi);
	const ghostPairsHere = [];
	for (const mark of marks) {
		if (!mark.paired_with) continue;
		if (mark.paired_with.ghost && mark.label === "ghost_extra") {
			ghostPairsHere.push({
				studentMark: mark,
				studentFile: range.file,
				ghost: mark.paired_with,
			});
			continue;
		}
		let teacherFile, teacherStart, teacherToken;
		if (mark.label === "missing") {
			teacherFile = range.file;
			teacherStart = mark.start;
			teacherToken = mark.token;
		} else {
			teacherFile = mark.paired_with.file;
			teacherStart = mark.paired_with.start;
			teacherToken = mark.paired_with.token;
		}
		const key = `${teacherFile}|${teacherStart}|${teacherToken}`;
		if (seenPairs.has(key)) continue;
		seenPairs.add(key);
		const teacherMark = _curatedFileMarks("teacher", teacherFile).find(
			(m) =>
				m.start === teacherStart &&
				m.token === teacherToken &&
				m.label === "missing",
		);
		if (teacherMark) {
			items.push({
				kind: "pair",
				side: "teacher",
				file: teacherFile,
				mark: teacherMark,
			});
		}
	}

	if (range.side === "teacher") {
		const groups = _curatedGroupMarks();
		for (const g of groups) {
			if (g.side !== "teacher" || g.file !== range.file) continue;
			if (g.kind !== "missing-insert" && g.kind !== "missing") continue;
			if (!g.marks.some((m) => m.start < range.hi && m.end > range.lo))
				continue;
			const key = `${g.side}|${g.file}|${g.lo}|${g.hi}`;
			if (seenGroups.has(key)) continue;
			seenGroups.add(key);
			items.push({ kind: "groupInsert", group: g });
		}
	}

	if (range.side === "student") {
		const groups = _curatedGroupMarks();
		for (const g of groups) {
			if (g.side !== "student" || g.file !== range.file) continue;
			if (g.kind !== "extra-move") continue;
			if (!g.marks.some((m) => m.start < range.hi && m.end > range.lo))
				continue;
			const key = `${g.side}|${g.file}|${g.lo}|${g.hi}`;
			if (seenGroups.has(key)) continue;
			seenGroups.add(key);
			items.push({ kind: "extraMove", group: g });
		}
	}

	if (ghostPairsHere.length === 1) {
		const p = ghostPairsHere[0];
		const key = `ghost|${p.ghost.file}|${p.ghost.start}|${p.ghost.token}|${p.studentFile}|${p.studentMark.start}`;
		if (!seenPairs.has(key)) {
			seenPairs.add(key);
			items.push({ kind: "ghost-pair", ...p });
		}
	} else if (ghostPairsHere.length > 1) {
		const sortedByGhost = ghostPairsHere
			.slice()
			.sort((a, b) => b.ghost.start - a.ghost.start);
		const sortedByStudent = ghostPairsHere
			.slice()
			.sort((a, b) => a.studentMark.start - b.studentMark.start);
		const rightmostGhost = sortedByGhost[0].ghost;
		const leftmostStudent = sortedByStudent[0];
		const key = `ghost-group|${rightmostGhost.file}|${rightmostGhost.start}|${leftmostStudent.studentFile}|${leftmostStudent.studentMark.start}`;
		if (!seenPairs.has(key)) {
			seenPairs.add(key);
			items.push({
				kind: "ghost-pair-group",
				ghost: rightmostGhost,
				studentMark: leftmostStudent.studentMark,
				studentFile: leftmostStudent.studentFile,
			});
		}
		for (const p of ghostPairsHere) {
			const k = `ghost|${p.ghost.file}|${p.ghost.start}|${p.ghost.token}|${p.studentFile}|${p.studentMark.start}`;
			seenPairs.add(k);
		}
	}
}

function _curatedRebuildPairConnectorsForSelection(side, file, lo, hi) {
	_curatedPairConnectorItems = [];
	const seenPairs = new Set();
	const seenGroups = new Set();
	_curatedCollectAlwaysOnConnectors(_curatedPairConnectorItems, seenGroups);
	_curatedCollectConnectorsForRange(
		{ side, file, lo, hi },
		_curatedPairConnectorItems,
		seenPairs,
		seenGroups,
	);
}

const _SVG_NS = "http://www.w3.org/2000/svg";
const _CURATED_LINE_GAP = 0.5;

function _curatedSvgLine(svg, x1, y1, x2, y2, color) {
	const ln = document.createElementNS(_SVG_NS, "line");
	ln.setAttribute("x1", x1);
	ln.setAttribute("y1", y1);
	ln.setAttribute("x2", x2);
	ln.setAttribute("y2", y2);
	ln.setAttribute("stroke", color);
	ln.setAttribute("stroke-width", "1");
	ln.setAttribute("stroke-linecap", "round");
	svg.appendChild(ln);
}

function _curatedSvgX(svg, cx, cy, size, color) {
	const half = size / 2;
	for (const [x1, y1, x2, y2] of [
		[cx - half, cy - half, cx + half, cy + half],
		[cx + half, cy - half, cx - half, cy + half],
	]) {
		const ln = document.createElementNS(_SVG_NS, "line");
		ln.setAttribute("x1", x1);
		ln.setAttribute("y1", y1);
		ln.setAttribute("x2", x2);
		ln.setAttribute("y2", y2);
		ln.setAttribute("stroke", color);
		ln.setAttribute("stroke-width", "1.5");
		ln.setAttribute("stroke-linecap", "round");
		svg.appendChild(ln);
	}
}

const _CURATED_ARROW_LEN = 5;
const _CURATED_ARROW_HALF_WIDTH = 3;

function _curatedSvgArrowhead(svg, tipX, tipY, dirX, dirY, color) {
	const len = Math.hypot(dirX, dirY) || 1;
	const ux = dirX / len;
	const uy = dirY / len;
	const px = -uy;
	const py = ux;
	const baseCenterX = tipX - ux * _CURATED_ARROW_LEN;
	const baseCenterY = tipY - uy * _CURATED_ARROW_LEN;
	const b1x = baseCenterX + px * _CURATED_ARROW_HALF_WIDTH;
	const b1y = baseCenterY + py * _CURATED_ARROW_HALF_WIDTH;
	const b2x = baseCenterX - px * _CURATED_ARROW_HALF_WIDTH;
	const b2y = baseCenterY - py * _CURATED_ARROW_HALF_WIDTH;
	const poly = document.createElementNS(_SVG_NS, "polygon");
	poly.setAttribute("points", `${tipX},${tipY} ${b1x},${b1y} ${b2x},${b2y}`);
	poly.setAttribute("fill", color);
	svg.appendChild(poly);
}

function _curatedSrcPosToClient(side, file, srcPos) {
	if (typeof _curatedSrcPosToDomPoint !== "function") return null;
	const dom = _curatedSrcPosToDomPoint(side, file, srcPos);
	if (!dom) return null;
	let range;
	try {
		range = document.createRange();
		range.setStart(dom.node, dom.offset);
		range.collapse(true);
	} catch {
		return null;
	}
	const rect = range.getBoundingClientRect();
	if (!rect) return null;
	if (
		rect.width === 0 &&
		rect.height === 0 &&
		rect.top === 0 &&
		rect.left === 0
	) {
		return null;
	}
	const lineEl =
		dom.node.nodeType === 1
			? dom.node.closest && dom.node.closest(".diff-line")
			: dom.node.parentElement &&
				dom.node.parentElement.closest(".diff-line");
	const lineBottom = lineEl
		? lineEl.getBoundingClientRect().bottom + _CURATED_LINE_GAP
		: rect.bottom + _CURATED_LINE_GAP;
	return { x: rect.left, y: lineBottom };
}

const _CURATED_INSERT_ANCHOR_LIFT = 2.25;

function _curatedElBelowLineY(el) {
	if (el && el.classList && el.classList.contains("insert-anchor")) {
		const line = el.closest(".diff-line");
		if (line) {
			const r = el.getBoundingClientRect();
			const lr = line.getBoundingClientRect();
			const lh = parseFloat(getComputedStyle(line).lineHeight);
			if (Number.isFinite(lh) && lh > 0) {
				const center = r.top + r.height / 2;
				const lineIdx = Math.max(0, Math.floor((center - lr.top) / lh));
				return (
					lr.top +
					(lineIdx + 1) * lh +
					_CURATED_LINE_GAP -
					_CURATED_INSERT_ANCHOR_LIFT
				);
			}
		}
	}
	return el.getBoundingClientRect().bottom + _CURATED_LINE_GAP;
}

function _curatedRefreshPairConnectors() {
	const svg = _curatedEnsurePairConnectorSvg();
	svg.innerHTML = "";
	if (!_curatedPairConnectorItems.length) return;

	const teacherPanel = document.getElementById("panel-teacher");
	const studentPanel = document.getElementById("panel-student");
	if (!teacherPanel || !studentPanel) return;
	const tpRect = teacherPanel.getBoundingClientRect();
	const spRect = studentPanel.getBoundingClientRect();
	const midX = (tpRect.right + spRect.left) / 2;

	const missingColor = MARK_COLORS.missing;
	const extraColor = MARK_COLORS.extra;
	const blackColor = THEME.black;
	const ghostPairColor = THEME.ghostPair;
	const paleBlueColor = MARK_COLORS.ghost_extra;

	const _langForTeacher = (file, marks) => {
		if (!file) return missingColor;
		const text =
			typeof _teacherFiles !== "undefined" && _teacherFiles[file]
				? _teacherFiles[file].replace(/\r\n/g, "\n")
				: "";
		const pos = marks && marks[0] ? marks[0].start : 0;
		return typeof _diffMissingColorAt === "function"
			? _diffMissingColorAt(file, text, pos)
			: typeof _diffMissingColorFor === "function"
				? _diffMissingColorFor(file)
				: missingColor;
	};

	for (const item of _curatedPairConnectorItems) {
		if (item.kind === "ghost-pair" || item.kind === "ghost-pair-group") {
			const teacherEl = _curatedFindGhostEl(item.ghost, { activeOnly: true });
			const studentEl = _curatedFindLeoMarkEl(
				"student",
				item.studentMark.start,
				item.studentMark.token,
				item.studentFile,
			);
			if (!teacherEl || !studentEl) continue;
			const tRect = teacherEl.getBoundingClientRect();
			const sRect = studentEl.getBoundingClientRect();
			const tY = _curatedElBelowLineY(teacherEl);
			const sY = _curatedElBelowLineY(studentEl);
			_curatedSvgLine(svg, tRect.right, tY, midX, tY, paleBlueColor);
			_curatedSvgLine(svg, midX, tY, midX, sY, blackColor);
			_curatedSvgLine(svg, midX, sY, sRect.left, sY, ghostPairColor);
			_curatedSvgArrowhead(svg, sRect.left, sY, 1, 0, ghostPairColor);
		} else if (item.kind === "pair") {
			const srcEl = _curatedFindMarkEl(item.side, item.mark, item.file);
			const partnerEl = _curatedFindPartnerEl(item.side, item.mark);
			if (!srcEl || !partnerEl) continue;

			let teacherEl, studentEl;
			let teacherFile;
			if (item.side === "teacher") {
				teacherEl = srcEl;
				studentEl = partnerEl;
				teacherFile = item.file;
			} else {
				teacherEl = partnerEl;
				studentEl = srcEl;
				teacherFile = item.mark?.paired_with?.file || null;
			}
			const tRect = teacherEl.getBoundingClientRect();
			const sRect = studentEl.getBoundingClientRect();
			const tY = _curatedElBelowLineY(teacherEl);
			const sY = _curatedElBelowLineY(studentEl);

			const teacherMarkPos =
				item.side === "teacher"
					? item.mark?.start
					: item.mark?.paired_with?.start;
			const teacherLangColor = _langForTeacher(teacherFile, [
				{ start: teacherMarkPos || 0 },
			]);

			_curatedSvgLine(svg, tRect.right, tY, midX, tY, extraColor);
			_curatedSvgLine(svg, midX, tY, midX, sY, blackColor);
			_curatedSvgLine(svg, midX, sY, sRect.left, sY, teacherLangColor);
			_curatedSvgArrowhead(svg, sRect.left, sY, 1, 0, teacherLangColor);
		} else if (item.kind === "groupInsert") {
			const g = item.group;
			const langColor = _langForTeacher(g.file, g.marks);

			let anchorEl = null;
			if (g.kind === "missing-insert") {
				const firstMark = g.marks[0];
				if (firstMark) anchorEl = _curatedFindInsertAnchorEl(firstMark);
			}

			if (g.marks.length === 1) {
				const teacherEl = _curatedFindMarkEl("teacher", g.marks[0], g.file);
				if (!teacherEl) continue;
				const tRect = teacherEl.getBoundingClientRect();
				const startX = tRect.right;
				const startY = _curatedElBelowLineY(teacherEl);
				if (anchorEl) {
					const aRect = anchorEl.getBoundingClientRect();
					const aY = _curatedElBelowLineY(anchorEl);
					const aX = aRect.left + aRect.width / 2;
					_curatedSvgLine(svg, startX, startY, midX, startY, blackColor);
					_curatedSvgLine(svg, midX, startY, midX, aY, blackColor);
					_curatedSvgLine(svg, midX, aY, aX, aY, langColor);
					_curatedSvgArrowhead(
						svg,
						aX,
						aY,
						aX >= midX ? 1 : -1,
						0,
						langColor,
					);
				} else {
					_curatedSvgLine(svg, startX, startY, midX, startY, blackColor);
					_curatedSvgX(svg, midX, startY, 10, langColor);
				}
				continue;
			}

			const r = _curatedCollectGroupRect(g);
			if (!r) continue;
			const paneRect = r.pane.getBoundingClientRect();
			const startX = paneRect.left + r.left + r.width;
			const boxTop = paneRect.top + r.top;
			const boxBottom = boxTop + r.height;

			if (anchorEl) {
				const aRect = anchorEl.getBoundingClientRect();
				const aY = _curatedElBelowLineY(anchorEl);
				const aX = aRect.left + aRect.width / 2;
				const startY = Math.max(boxTop, Math.min(boxBottom, aY));
				_curatedSvgLine(svg, startX, startY, midX, startY, blackColor);
				_curatedSvgLine(svg, midX, startY, midX, aY, blackColor);
				_curatedSvgLine(svg, midX, aY, aX, aY, langColor);
				_curatedSvgArrowhead(
					svg,
					aX,
					aY,
					aX >= midX ? 1 : -1,
					0,
					langColor,
				);
			} else {
				const startY = (boxTop + boxBottom) / 2;
				_curatedSvgLine(svg, startX, startY, midX, startY, blackColor);
				_curatedSvgX(svg, midX, startY, 10, langColor);
			}
		} else if (item.kind === "extraMove") {
			const g = item.group;
			let startX, startY;
			if (g.marks.length === 1) {
				const studentEl = _curatedFindMarkEl("student", g.marks[0], g.file);
				if (!studentEl) continue;
				const sRect = studentEl.getBoundingClientRect();
				startX = sRect.right;
				startY = _curatedElBelowLineY(studentEl);
			} else {
				const r = _curatedCollectGroupRect(g);
				if (!r) continue;
				const paneRect = r.pane.getBoundingClientRect();
				startX = paneRect.left + r.left + r.width;
				const boxTop = paneRect.top + r.top;
				const boxBottom = boxTop + r.height;
				startY = (boxTop + boxBottom) / 2;
			}
			const rightX = spRect.right - 8;
			const anchorEl = _curatedFindMoveAnchorEl(g.marks[0], g.file);
			let targetX, targetY;
			if (anchorEl) {
				const aRect = anchorEl.getBoundingClientRect();
				targetX = aRect.left + aRect.width / 2;
				targetY = _curatedElBelowLineY(anchorEl);
			} else {
				const target = _curatedSrcPosToClient(
					"student",
					g.moveFile,
					g.movePos,
				);
				if (!target) {
					_curatedSvgLine(svg, startX, startY, rightX, startY, extraColor);
					_curatedSvgX(svg, rightX, startY, 10, extraColor);
					continue;
				}
				targetX = target.x;
				targetY = target.y;
			}
			_curatedSvgLine(svg, startX, startY, rightX, startY, extraColor);
			_curatedSvgLine(svg, rightX, startY, rightX, targetY, blackColor);
			_curatedSvgLine(svg, rightX, targetY, targetX, targetY, extraColor);
			const dirX = targetX <= rightX ? -1 : 1;
			_curatedSvgArrowhead(svg, targetX, targetY, dirX, 0, extraColor);
		}
	}
}
