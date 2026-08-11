"use strict";

function _updateHighlightChip() {
	const toolbar = document.getElementById("toolbar");
	if (!toolbar) return;
	let chip = document.getElementById("highlight-chip");
	const hasHi = _highlightIds && _highlightIds.size;
	const hasStar = _starIds && _starIds.size;
	if (!hasHi && !hasStar) {
		if (chip) chip.remove();
		return;
	}
	if (!chip) {
		chip = document.createElement("span");
		chip.id = "highlight-chip";
		const ln = document.getElementById("lesson-name");
		if (ln) ln.after(chip);
		else toolbar.prepend(chip);
	}
	const parts = [];
	if (hasHi) {
		const n = _students.filter((s) => _highlightIds.has(String(s.id))).length;
		parts.push(`Highlighting ${n} of ${_highlightIds.size}`);
	}
	if (hasStar) {
		const n = _students.filter((s) => _starIds.has(String(s.id))).length;
		parts.push(`★ ${n} of ${_starIds.size}`);
	}
	chip.innerHTML = "";
	const label = document.createElement("span");
	label.textContent = parts.join("  ·  ");
	chip.appendChild(label);
	const clear = document.createElement("button");
	clear.type = "button";
	clear.className = "filter-clear";
	clear.textContent = "× clear";
	clear.addEventListener("click", () => {
		_highlightIds = null;
		_starIds = null;
		try {
			const url = new URL(location.href);
			url.searchParams.delete("ids");
			url.searchParams.delete("star");
			history.replaceState(null, "", url);
		} catch (_e) {}
		renderTable();
	});
	chip.appendChild(clear);
}

function _makeNameStar() {
	const star = document.createElement("span");
	star.className = "name-star";
	star.textContent = "★";
	return star;
}

function _setHeaderLabel(el, spec) {
	if (spec.artefactIdx != null) {
		el.innerHTML = artefactCodeHtml(spec.label);
	} else {
		el.textContent = spec.label;
	}
}

function _artefactHeaderTipHtml() {
	return buildArtefactSchemaTipHtml(_artefactSchema || []);
}

function renderTable() {
	const thead = document.getElementById("thead");
	const tbody = document.getElementById("tbody");
	thead.innerHTML = "";
	tbody.innerHTML = "";
	_updateHighlightChip();
	_restoreSidePanel();

	const showId = true;
	const showName = _paperMode ? true : !_hiddenCols.has("name");
	const showNum = _paperMode ? false : !_hiddenCols.has("num");
	const showFollow = _paperMode ? _simParam : !_hiddenCols.has("follow");

	const showInteractions =
		!_paperMode && _hasInteractions && !_hiddenCols.has("interactions");

	const showLangs = !_paperMode && !_hiddenCols.has("languages");
	const presentLangs = showLangs
		? LANG_COL_DEFS.filter((def) =>
				_students.some((s) => s.langPcts && s.langPcts[def.key] != null),
			)
		: [];

	const _remarkVisible = (col) => {
		if (OBS_COL_RE.test(col)) return true;
		if (_paperMode) return false;
		if (/^grade$/i.test(col)) return !_hiddenCols.has("grade");
		if (/^comments?$/i.test(col)) return !_hiddenCols.has("comments");
		if (/^expected$/i.test(col)) return !_hiddenCols.has("expected");
		if (/^remarks?$/i.test(col)) return !_hiddenCols.has("remarks");
		return true;
	};
	const visibleRemarkCols = _remarkCols.filter(_remarkVisible);
	const showMismatches = !_paperMode && !_hiddenCols.has("mismatches");

	const specs = [];
	if (showId) specs.push({ cls: "col-id", label: "ID", sortKey: "id" });
	if (showName)
		specs.push({ cls: "col-name", label: "Name", sortKey: "name" });
	if (showNum) specs.push({ cls: "col-num", label: "#", sortKey: "num" });
	const _hasArtefactSchema = _artefactSchema && _artefactSchema.length > 0;
	for (const col of visibleRemarkCols) {
		if (OBS_COL_RE.test(col) && _hasArtefactSchema) {
			_artefactSchema.forEach((a, i) => {
				specs.push({
					cls: "col-remark col-obs col-artefact",
					label: a.code || a.key || `A${i + 1}`,
					title: a.label || "",
					sortKey: "artefact:" + i,
					artefactIdx: i,
					artefactCol: col,
				});
			});
			continue;
		}
		let cls = "col-remark";
		if (/^grade$/i.test(col)) cls += " col-grade";
		else if (/^comments?$/i.test(col)) cls += " col-comments";
		else if (OBS_COL_RE.test(col)) cls += " col-obs";
		specs.push({
			cls,
			label: col,
			title: col,
			sortKey: "remark:" + col,
		});
	}
	if (showInteractions)
		specs.push({ cls: "col-int", label: "Interactions", sortKey: "int" });
	if (showFollow)
		specs.push({ cls: "col-follow", label: _followLabel, sortKey: "follow" });
	for (const def of presentLangs)
		specs.push({
			cls: `col-lang col-lang-${def.key}`,
			label: def.label,
			sortKey: "lang:" + def.key,
		});

	const { showFingerprint, hasAnyFp2, hasAnyFp3 } =
		computeFingerprints(_students);
	const showFp1 =
		showFingerprint &&
		(_paperMode ? _fingerprintParam : !_hiddenCols.has("fingerprint"));
	const showFp2 = !_paperMode && hasAnyFp2 && !_hiddenCols.has("fingerprint");
	const showFp3 = !_paperMode && hasAnyFp3 && !_hiddenCols.has("fingerprint");
	if (showFp1)
		specs.push({
			cls: "col-fingerprint col-fp1",
			label: "Fingerprint",
			sortKey: "fingerprint1",
		});
	if (showFp2)
		specs.push({
			cls: "col-fingerprint col-fp2",
			label: "",
			sortKey: "fingerprint2",
		});
	if (showFp3)
		specs.push({
			cls: "col-fingerprint col-fp3",
			label: "",
			sortKey: "fingerprint3",
		});

	const trh = document.createElement("tr");
	for (const spec of specs) {
		const el = document.createElement("th");
		el.className = spec.cls;
		if (spec.artefactIdx != null) {
			el.dataset.artefactIdx = String(spec.artefactIdx);
			attachHtmlTip(el, _artefactHeaderTipHtml());
		} else if (spec.title) {
			el.title = spec.title;
		}
		if (spec.sortKey) {
			el.classList.add("sortable");
			_setHeaderLabel(el, spec);
			if (_sortCol === spec.sortKey) {
				const arrow = document.createElement("span");
				arrow.className = "sort-arrow";
				arrow.textContent = _sortDir === "asc" ? "▲" : "▼";
				el.appendChild(arrow);
			}
			el.addEventListener("click", () => _onSortHeaderClick(spec.sortKey));
		} else {
			_setHeaderLabel(el, spec);
		}
		trh.appendChild(el);
	}
	if (showMismatches) {
		const thMm = document.createElement("th");
		thMm.textContent = "Mismatches";
		thMm.className = "col-mismatch";
		trh.appendChild(thMm);
	}
	thead.appendChild(trh);

	let sortedStudents = _sortStudents(_students, _sortCol, _sortDir);
	const _hasHi = _highlightIds && _highlightIds.size;
	const _hasStar = _starIds && _starIds.size;
	if (_hasHi || _hasStar) {
		const starred = [];
		const highlighted = [];
		const rest = [];
		for (const s of sortedStudents) {
			const id = String(s.id);
			if (_hasStar && _starIds.has(id)) starred.push(s);
			else if (_hasHi && _highlightIds.has(id)) highlighted.push(s);
			else rest.push(s);
		}
		sortedStudents = starred.concat(highlighted, rest);
	}
	for (const s of sortedStudents) {
		const tr = document.createElement("tr");
		tr._student = s;
		if (s.ai_flagged) tr.classList.add("row-ai");
		const _sid = String(s.id);
		const _isStar = _hasStar && _starIds.has(_sid);
		const _isHi = _hasHi && _highlightIds.has(_sid);
		if (_hasHi) {
			tr.classList.add(_isHi ? "row-emphasis" : "row-dim");
		}
		const hasFiles = _studentHasFiles(s);
		if (!hasFiles) tr.classList.add("row-nofiles");

		const openOnClick = (el) => {
			if (!hasFiles) {
				el.title = "Forgot to send the code";
				return;
			}
			el.classList.add("clickable-open");
			el.addEventListener("click", (e) => {
				e.stopPropagation();
				document
					.querySelectorAll("#tbody tr.selected")
					.forEach((r) => r.classList.remove("selected"));
				tr.classList.add("selected");
				if (e.ctrlKey || e.metaKey) {
					openDiffForStudent(s);
					return;
				}
				selectStudentInline(s);
			});
		};

		if (showId) {
			const el = document.createElement("td");
			el.className = "col-id";
			if (_isStar && !showName) el.appendChild(_makeNameStar());
			el.appendChild(document.createTextNode(s.id || "–"));
			if (!showName) _appendDocLinks(el, s);
			openOnClick(el);
			tr.appendChild(el);
		}
		if (showName) {
			const el = document.createElement("td");
			el.className = "col-name";
			if (_isStar) el.appendChild(_makeNameStar());
			el.appendChild(document.createTextNode(s.name));
			_appendDocLinks(el, s);
			openOnClick(el);
			tr.appendChild(el);
		}
		if (showNum) {
			const el = document.createElement("td");
			el.textContent = s.num || "–";
			el.className = "col-num";
			openOnClick(el);
			tr.appendChild(el);
		}
		for (const rk of s.remarks) {
			if (!_remarkVisible(rk.col)) continue;
			if (
				OBS_COL_RE.test(rk.col) &&
				_artefactSchema &&
				_artefactSchema.length
			) {
				const code = rk.val === "_" || !rk.val ? "" : String(rk.val);
				_artefactSchema.forEach((a, i) => {
					const cell = document.createElement("td");
					cell.className = "col-remark col-obs col-artefact";
					_renderArtefactCell(cell, s, rk.col, i, code);
					if (!_canEditCells()) openOnClick(cell);
					tr.appendChild(cell);
				});
				continue;
			}
			const el = document.createElement("td");
			let cls = "col-remark";
			const isObs = OBS_COL_RE.test(rk.col);
			const isGrade = /^grade$/i.test(rk.col);
			const isStatus = /^status$/i.test(rk.col);
			const isComments = /^comments?$/i.test(rk.col);
			const isExpected = /^expected$/i.test(rk.col);
			if (isObs) cls += " col-obs";
			else if (isGrade) cls += " col-grade";
			else if (isStatus) cls += " col-status";
			else if (isComments) cls += " col-comments";
			el.className = cls;
			const editable = isObs || isGrade || isStatus || isComments;
			if (isComments) {
				const inner = document.createElement("div");
				inner.className = "comments-inner";
				inner.textContent = rk.val;
				if (rk.val) inner.title = rk.val;
				el.appendChild(inner);
				_makeCellEditable(inner, s, rk.col);
			} else {
				const obsVal = isObs && (rk.val === "_" || !rk.val) ? "" : rk.val;
				if (isObs) {
					_renderObsCell(el, obsVal);
					if (_mode !== "lesson") {
						_makeCellEditable(el, s, rk.col);
						el.addEventListener("blur", () => {
							_renderObsCell(el, el.textContent);
						});
					}
				} else {
					el.textContent = rk.val;
					if (editable) {
						_makeCellEditable(el, s, rk.col);
					} else {
						const tipText = rk.note
							? rk.note
							: isExpected && rk.val
								? rk.val
								: "";
						if (tipText) setupTip(el, tipText, false);
					}
				}
			}
			tr.appendChild(el);
		}
		if (showInteractions) {
			const el = document.createElement("td");
			el.className = "col-int";
			el.appendChild(
				new InteractionCell(s.total_a, s.total_q, s.total_h).render(),
			);
			tr.appendChild(el);
		}
		if (showFollow) {
			const followEl = document.createElement("td");
			followEl.className = "col-follow";
			if (!isNaN(s.followPct)) {
				followEl.appendChild(new FollowBar(s.followPct).render());
			}
			tr.appendChild(followEl);
		}

		for (const def of presentLangs) {
			const cell = document.createElement("td");
			cell.className = `col-lang col-lang-${def.key}`;
			const pct = s.langPcts ? s.langPcts[def.key] : undefined;
			if (pct != null && !isNaN(pct)) {
				cell.appendChild(
					new FollowBar(pct, langColorFor(def.key)).render(),
				);
			}
			tr.appendChild(cell);
		}

		if (showFp1) {
			tr.appendChild(
				new FingerprintCell({
					cls: "col-fp1",
					tipHtml: s._fpMask
						? _boldFpGroups(
								_maskToBytes(s._fpMask),
								_bytesLangs(s._fpMaskLangs || []),
							)
						: null,
					positions: s._fpPositions || [],
				}).render(),
			);
		}
		if (showFp2) {
			tr.appendChild(
				new FingerprintCell({
					cls: "col-fp2",
					tipHtml: s._fp2Hash
						? _boldFpGroups(s._fp2Hash, _bytesLangs(s._fp2Langs || []))
						: null,
					bytes: s._fp2Bytes,
					langs: s._fp2Langs || [],
					classPrefix: "fp2",
				}).render(),
			);
		}
		if (showFp3) {
			tr.appendChild(
				new FingerprintCell({
					cls: "col-fp3",
					tipHtml: s._fp3Hash ? _boldFpGroups(s._fp3Hash) : null,
					bytes: s._fp3Bytes,
					classPrefix: "fp3",
				}).render(),
			);
		}

		if (showMismatches) {
			const mmEl = document.createElement("td");
			mmEl.className = "col-mismatch";
			renderMismatches(mmEl, s.followEvents);
			tr.appendChild(mmEl);
		}

		tbody.appendChild(tr);
	}

	if (sortedStudents.length > 0) {
		_appendTotalsRow(
			tbody,
			specs,
			sortedStudents,
			visibleRemarkCols,
			presentLangs,
			showName,
			showMismatches,
		);
	}
	_renderArtefactHighlights();
}

let _artefactHighlightRaf = 0;
let _artefactHighlightObserver = null;

function _scheduleArtefactHighlights() {
	if (_artefactHighlightRaf) return;
	_artefactHighlightRaf = requestAnimationFrame(() => {
		_artefactHighlightRaf = 0;
		_renderArtefactHighlights();
	});
}

function _ensureArtefactHighlightObserver() {
	if (_artefactHighlightObserver || typeof ResizeObserver === "undefined")
		return;
	const table = document.getElementById("student-table");
	if (!table) return;
	_artefactHighlightObserver = new ResizeObserver(_scheduleArtefactHighlights);
	_artefactHighlightObserver.observe(table);
	window.addEventListener("resize", _scheduleArtefactHighlights);
}

function _renderArtefactHighlights() {
	const wrap = document.getElementById("table-wrap");
	if (!wrap) return;
	let layer = document.getElementById("artefact-highlight-layer");
	if (!_artefactHighlights || !_artefactHighlights.length) {
		if (layer) layer.remove();
		return;
	}
	_ensureArtefactHighlightObserver();
	if (!layer) {
		layer = document.createElement("div");
		layer.id = "artefact-highlight-layer";
		wrap.appendChild(layer);
	}
	layer.innerHTML = "";

	const thead = document.getElementById("thead");
	const tbody = document.getElementById("tbody");
	if (!thead || !tbody) return;

	let rows = [...tbody.querySelectorAll("tr.row-emphasis")];
	if (!rows.length) rows = [...tbody.querySelectorAll("tr:not(.totals-row)")];
	if (!rows.length) return;

	const wrapRect = wrap.getBoundingClientRect();
	const idxs = [...new Set(_artefactHighlights)].sort((a, b) => a - b);
	const runs = [];
	for (const idx of idxs) {
		const th = thead.querySelector(
			`th.col-artefact[data-artefact-idx="${idx}"]`,
		);
		if (!th) continue;
		const cells = rows
			.map((r) =>
				r.querySelector(`td.col-artefact[data-artefact-idx="${idx}"]`),
			)
			.filter(Boolean);
		if (!cells.length) continue;
		const last = runs[runs.length - 1];
		if (last && idx === last.endIdx + 1) {
			last.endIdx = idx;
			last.endTh = th;
		} else {
			runs.push({ endIdx: idx, startTh: th, endTh: th, cells });
		}
	}
	const hiCount = rows.filter((r) => !r.classList.contains("row-ai")).length;
	const denom = _students.filter((s) => !s.ai_flagged).length;
	const hiPct = denom ? Math.round((hiCount / denom) * 100) : 0;
	runs.forEach((run, ri) => {
		const lRect = run.startTh.getBoundingClientRect();
		const rRect = run.endTh.getBoundingClientRect();
		const firstRect = run.cells[0].getBoundingClientRect();
		const lastRect = run.cells[run.cells.length - 1].getBoundingClientRect();
		const left = lRect.left - wrapRect.left + wrap.scrollLeft;
		const right = rRect.right - wrapRect.left + wrap.scrollLeft;
		const top = firstRect.top - wrapRect.top + wrap.scrollTop;
		const height = lastRect.bottom - firstRect.top;
		const box = document.createElement("div");
		box.className = "artefact-highlight-box";
		box.style.left = left + "px";
		box.style.width = Math.max(0, right - left) + "px";
		box.style.top = top + "px";
		box.style.height = height + "px";
		layer.appendChild(box);

		if (ri !== 0 || !hiCount) return;
		const count = document.createElement("div");
		count.className = "artefact-highlight-count";
		const countMain = document.createElement("div");
		countMain.textContent = `${hiCount}/${denom}`;
		const countPct = document.createElement("div");
		countPct.textContent = `(${hiPct}%)`;
		count.appendChild(countMain);
		count.appendChild(countPct);
		count.style.top = top + height + 3 + "px";
		layer.appendChild(count);
		const half = count.offsetWidth / 2;
		const minCx = wrap.scrollLeft + half + 4;
		const maxCx = wrap.scrollLeft + wrap.clientWidth - half - 4;
		const cx = Math.max(minCx, Math.min((left + right) / 2, maxCx));
		count.style.left = cx + "px";
	});
}

function _appendTotalsRow(
	tbody,
	specs,
	sortedStudents,
	visibleRemarkCols,
	presentLangs,
	showName,
	showMismatches,
) {
	const totalsRow = document.createElement("tr");
	totalsRow.className = "totals-row";

	const obsCol = visibleRemarkCols.find((c) => OBS_COL_RE.test(c));
	let obsCounts = null;
	if (obsCol) {
		obsCounts = countArtefactColumn(
			sortedStudents
				.filter((s) => !s.ai_flagged)
				.map((s) => {
					const r = (s.remarks || []).find((x) => x.col === obsCol);
					return r && r.val ? String(r.val).trim() : "";
				}),
		);
	}

	const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
	const followVals = sortedStudents
		.map((s) => s.followPct)
		.filter((x) => x != null && !isNaN(x));
	const avgFollow = followVals.length ? mean(followVals) : null;

	const avgByLang = {};
	for (const def of presentLangs) {
		const vals = sortedStudents
			.map((s) => (s.langPcts ? s.langPcts[def.key] : undefined))
			.filter((x) => x != null && !isNaN(x));
		avgByLang[def.key] = vals.length ? mean(vals) : null;
	}

	const nonAiCount = sortedStudents.filter((s) => !s.ai_flagged).length;
	let countSlotAssigned = false;
	for (const spec of specs) {
		if (spec.cls.includes("col-int")) {
			const sums = INTERACTION_TYPES.map((t) =>
				sortedStudents.reduce(
					(a, s) => (s.ai_flagged ? a : a + (s[t.key] || 0)),
					0,
				),
			);
			const c = document.createElement("td");
			c.className = "col-int";
			c.appendChild(new InteractionCell(sums[0], sums[1], sums[2]).render());
			totalsRow.appendChild(c);
			continue;
		}
		const td = document.createElement("td");
		td.className = spec.cls;
		const isName = spec.cls.includes("col-name");
		const isId = spec.cls.includes("col-id");
		const isObs = spec.cls.includes("col-obs");
		const isFollow = spec.cls.includes("col-follow");
		const langMatch = spec.cls.match(/col-lang-(\w+)/);
		const isLang = !!langMatch;

		if (!countSlotAssigned && (isName || (isId && !showName))) {
			td.textContent = `${nonAiCount} students`;
			countSlotAssigned = true;
		} else if (spec.artefactIdx != null && obsCounts) {
			td.dataset.artefactIdx = String(spec.artefactIdx);
			td.innerHTML = renderArtefactTotalOne(
				obsCounts[spec.artefactIdx] || 0,
				_artefactSchema[spec.artefactIdx],
			);
		} else if (isObs && obsCounts) {
			td.innerHTML = renderArtefactTotals(obsCounts, _artefactSchema);
		} else if (isFollow && avgFollow != null) {
			td.appendChild(new FollowBar(avgFollow).render());
		} else if (isLang) {
			const lang = langMatch[1];
			if (avgByLang[lang] != null) {
				td.appendChild(
					new FollowBar(avgByLang[lang], langColorFor(lang)).render(),
				);
			}
		}
		totalsRow.appendChild(td);
	}

	if (showMismatches) {
		const td = document.createElement("td");
		td.className = "col-mismatch";
		totalsRow.appendChild(td);
	}

	tbody.appendChild(totalsRow);
}

function renderMismatches(cell, events) {
	const mm = new Mismatches(events);
	const wrap = mm.cell();
	if (!wrap) return;
	cell.innerHTML = "";
	cell.appendChild(wrap);
	const tipHtml = mm.tipHtml();
	cell.addEventListener("mouseenter", (e) => showTipHtml(e, tipHtml));
	cell.addEventListener("mousemove", (e) => moveTip(e));
	cell.addEventListener("mouseleave", () => hideTip());
}

const _colsPanel = makeColsPanel({
	colHideKeys: COL_HIDE_KEYS,
	hiddenCols: _hiddenCols,
	onChange: () => {
		_saveHiddenCols();
		renderTable();
	},
});
function _toggleColsPanel() {
	_colsPanel.toggle();
}

function _studentHasFiles(student) {
	if (!student) return true;
	let anonIdsPresent = false;
	for (const k of _allFiles.keys()) {
		if (k.includes("anon_ids/")) {
			anonIdsPresent = true;
			break;
		}
	}
	if (!anonIdsPresent) return true;
	if (!student.id) return true;
	const sid = student.id.toLowerCase();
	for (const k of _allFiles.keys()) {
		const idx = k.indexOf("anon_ids/");
		if (idx < 0) continue;
		const after = k.slice(idx + "anon_ids/".length);
		const slash = after.indexOf("/");
		if (slash < 0) continue;
		if (after.slice(0, slash) === sid) return true;
	}
	return false;
}

function _renderObsCell(el, val) {
	const v = val == null ? "" : String(val);
	const badges = renderArtefactBadges(v, _artefactSchema);
	if (badges) {
		el.innerHTML = badges;
		el.dataset.rawValue = v;
		el.style.fontWeight = "";
		el.title = "";
		el.dataset.artefactTipHtml = buildArtefactSummaryHtml(v, _artefactSchema);
		if (!el.dataset.artefactTipWired) {
			attachHtmlTip(el, () => el.dataset.artefactTipHtml || "");
			el.dataset.artefactTipWired = "1";
		}
	} else {
		if (_mode === "lesson") {
			el.innerHTML = formatLessonObsHtml(v);
			el.style.fontWeight = "";
		} else {
			el.textContent = v;
			el.style.fontWeight = v ? "bold" : "";
		}
		delete el.dataset.rawValue;
		delete el.dataset.artefactTipHtml;
		el.style.color = v.includes("<") ? THEME.red : "";
		el.title = "";
	}
}

function _snapshotOrigObs(students) {
	_origObs.clear();
	for (const s of students || []) {
		if (s.id == null) continue;
		const r = (s.remarks || []).find((x) => OBS_COL_RE.test(x.col));
		_origObs.set(String(s.id), r && r.val ? String(r.val) : "");
	}
}

function _artefactChangedSince(studentId, idx, fired) {
	const orig = _origObs.get(String(studentId)) || "";
	const origFired = ARTEFACT_CODE_RE.test(orig) && orig[idx] === "1";
	return fired !== origFired;
}

function _renderArtefactCell(el, student, colName, idx, code) {
	el.dataset.artefactIdx = String(idx);
	const fired = ARTEFACT_CODE_RE.test(code) && code[idx] === "1";
	const entry = _artefactSchema[idx];
	el.innerHTML = renderArtefactCellSquare(fired, entry);
	el.title = "";
	const getCode = () => {
		const r = (student.remarks || []).find((x) => x.col === colName);
		return r && r.val ? String(r.val).trim() : "";
	};
	attachHtmlTip(el, () =>
		buildArtefactSummaryHtml(getCode(), _artefactSchema),
	);
	if (_artefactChangedSince(student.id, idx, fired)) {
		el.classList.add("artefact-changed");
	}
	if (_canEditCells() && student.id) {
		el.classList.add("artefact-toggle");
		el.addEventListener("mousedown", (e) => e.stopPropagation());
		el.addEventListener("click", (e) => {
			e.stopPropagation();
			_toggleArtefact(student, colName, idx, el);
		});
	}
}

function _toggleArtefact(student, colName, idx, el) {
	const len = _artefactSchema.length;
	const r = (student.remarks || []).find((x) => x.col === colName);
	const cur =
		r && r.val && ARTEFACT_CODE_RE.test(String(r.val).trim())
			? String(r.val).trim()
			: "";
	const arr = [];
	for (let i = 0; i < len; i++) arr[i] = cur[i] === "1" ? "1" : "0";
	arr[idx] = arr[idx] === "1" ? "0" : "1";
	const newVal = arr.join("");
	_setDirty(student.id, colName, newVal);
	if (r) r.val = newVal;
	else
		(student.remarks || (student.remarks = [])).push({
			col: colName,
			val: newVal,
		});
	const baseRow =
		_baseStudents && _baseStudents.find((x) => x.id === student.id);
	if (baseRow) {
		const br = (baseRow.remarks || []).find((x) => x.col === colName);
		if (br) br.val = newVal;
	}
	el.innerHTML = renderArtefactCellSquare(
		arr[idx] === "1",
		_artefactSchema[idx],
	);
	el.classList.toggle(
		"artefact-changed",
		_artefactChangedSince(student.id, idx, arr[idx] === "1"),
	);
	const totalTd = document.querySelector(
		`.totals-row td.col-artefact[data-artefact-idx="${idx}"]`,
	);
	if (totalTd) {
		let count = 0;
		for (const s of _students) {
			if (s.ai_flagged) continue;
			const rr = (s.remarks || []).find((x) => x.col === colName);
			const c = rr && rr.val ? String(rr.val).trim() : "";
			if (ARTEFACT_CODE_RE.test(c) && c[idx] === "1") count++;
		}
		totalTd.innerHTML = renderArtefactTotalOne(count, _artefactSchema[idx]);
	}
}

function _makeCellEditable(el, student, colName) {
	if (!student.id) return;
	if (!_canEditCells()) return;
	el.classList.add("editable-cell");
	el.contentEditable = "plaintext-only";
	el.spellcheck = false;
	el.title = "Click to edit · Enter commits · Esc cancels";
	el.addEventListener("click", (e) => e.stopPropagation());
	el.addEventListener("mousedown", (e) => e.stopPropagation());
	let _origText = el.textContent;
	el.addEventListener("focus", () => {
		if (el.dataset.rawValue != null) {
			el.textContent = el.dataset.rawValue;
		}
		_origText = el.textContent;
		el.classList.add("editing");
	});
	el.addEventListener("keydown", (e) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			el.blur();
		} else if (e.key === "Escape") {
			e.preventDefault();
			el.textContent = _origText;
			el.blur();
		}
	});
	el.addEventListener("blur", () => {
		el.classList.remove("editing");
		const newText = el.textContent;
		if (newText === _origText) return;
		_setDirty(student.id, colName, newText);
		el.classList.add("dirty");
		const isObs = OBS_COL_RE.test(colName);
		if (isObs) el.style.fontWeight = newText ? "bold" : "";
		const r = (student.remarks || []).find((x) => x.col === colName);
		if (r) r.val = newText;
		const baseRow =
			_baseStudents && _baseStudents.find((x) => x.id === student.id);
		if (baseRow) {
			const br = (baseRow.remarks || []).find((x) => x.col === colName);
			if (br) br.val = newText;
		}
	});
}

function _diffTitleFor(student) {
	return diffStudentTitle(student.id, student.name, student.followPct);
}

function openDiffForStudent(student) {
	if (!_lessonName || !student.id) return;
	navigateToDifferentiator(
		{
			lesson: _lessonName,
			group: _groupFolder(),
			id: student.id,
			title: _diffTitleFor(student),
		},
		true,
	);
}
