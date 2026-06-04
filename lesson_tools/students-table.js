"use strict";

function _buildByteFingerprint(events, { trackLangs = false } = {}) {
	const bytes = [];
	const langs = trackLangs ? [] : null;
	let cur = 0;
	let count = 0;
	for (const ev of events) {
		const tok = ev.token || ev.label || "";
		const bit = tok.length % 2;
		cur = (cur << 1) | bit;
		if (langs) langs.push(ev.lang || null);
		count++;
		if (count === 8) {
			bytes.push(cur);
			cur = 0;
			count = 0;
		}
	}
	if (count > 0) {
		cur = cur << (8 - count);
		bytes.push(cur);
	}
	return { bytes, langs };
}

function _renderByteFingerprint(
	wrap,
	bytes,
	{ langs, classPrefix, bytesPerCol = 2 } = {},
) {
	const bar = document.createElement("div");
	bar.className = `${classPrefix}-bar`;
	for (let i = 0; i < bytes.length; i += bytesPerCol) {
		const col = document.createElement("div");
		col.className = `${classPrefix}-byte`;
		for (let j = 0; j < bytesPerCol; j++) {
			const byteIdx = i + j;
			const b = byteIdx < bytes.length ? bytes[byteIdx] : 0;
			for (let k = 7; k >= 0; k--) {
				const bit = (b >> k) & 1;
				const px = document.createElement("div");
				px.className = `${classPrefix}-bit` + (bit ? " on" : "");
				if (bit && langs) {
					const lang = langs[byteIdx * 8 + (7 - k)];
					const lc = lang ? langColorFor(lang) : null;
					if (lc) px.style.background = lc;
				}
				col.appendChild(px);
			}
		}
		bar.appendChild(col);
	}
	wrap.appendChild(bar);
}

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
		el.innerHTML = escHtml(spec.label).replace(/_(\w+)/g, "<sub>$1</sub>");
	} else {
		el.textContent = spec.label;
	}
}

function _studentDocFiles(student) {
	if (!student || !student.id) return [];
	const sid = String(student.id).toLowerCase();
	const out = [];
	for (const [key, file] of _allFiles) {
		const m = key.match(/(?:^|\/)anon_ids\/([^/]+)\/(.+\.(docx|pdf))$/i);
		if (m && m[1] === sid) {
			out.push({
				name: m[2].split("/").pop(),
				file,
				ext: m[3].toLowerCase(),
			});
		}
	}
	return out;
}

function _appendDocLinks(el, student) {
	for (const d of _studentDocFiles(student)) {
		const a = document.createElement("span");
		a.className = "doc-link";
		a.textContent = d.ext === "pdf" ? "📕" : "📄";
		a.title = "Open " + d.name;
		a.addEventListener("click", (e) => {
			e.stopPropagation();
			_openStudentDoc(d);
		});
		el.appendChild(a);
	}
}

let _docViewerWired = false;
function _wireDocViewer() {
	if (_docViewerWired) return;
	const win = document.getElementById("doc-viewer");
	if (!win) return;
	_docViewerWired = true;
	const head = document.getElementById("doc-viewer-head");
	if (head && typeof makeDraggable === "function") makeDraggable(head, win);
	const close = document.getElementById("doc-viewer-close");
	if (close)
		close.addEventListener("click", () => win.classList.remove("is-open"));
}

async function _openStudentDoc(d) {
	_wireDocViewer();
	const win = document.getElementById("doc-viewer");
	const body = document.getElementById("doc-viewer-body");
	if (!win || !body) return;
	document.getElementById("doc-viewer-title").textContent = d.name;
	win.classList.add("is-open");
	body.style.padding = "";
	body.textContent = "Loading…";
	try {
		if (d.ext === "pdf") {
			let url = d.file.url;
			if (!url) {
				const buf = await readFileArray(d.file);
				url = URL.createObjectURL(
					new Blob([buf], { type: "application/pdf" }),
				);
			}
			body.style.padding = "0";
			body.innerHTML = "";
			const frame = document.createElement("iframe");
			frame.src = url;
			body.appendChild(frame);
		} else {
			if (typeof window.mammoth === "undefined") {
				body.textContent = "Word viewer (mammoth.js) failed to load.";
				return;
			}
			const buf = await readFileArray(d.file);
			const res = await window.mammoth.convertToHtml({ arrayBuffer: buf });
			body.innerHTML = res.value || "(empty document)";
		}
	} catch (e) {
		body.textContent = "Failed to open document: " + ((e && e.message) || e);
	}
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
	const showFollow = !_paperMode && !_hiddenCols.has("follow");

	const showLangs = !_paperMode && !_hiddenCols.has("languages");
	const presentLangs = showLangs
		? LANG_COL_DEFS.filter((def) =>
				_students.some((s) => s.langPcts && s.langPcts[def.key] != null),
			)
		: [];

	const _remarkVisible = (col) => {
		if (/^obs\.?$/i.test(col)) return true;
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
		if (/^obs\.?$/i.test(col) && _hasArtefactSchema) {
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
		else if (/^obs\.?$/i.test(col)) cls += " col-obs";
		specs.push({
			cls,
			label: col,
			title: col,
			sortKey: "remark:" + col,
		});
	}
	if (!_paperMode && _hasInteractions)
		specs.push({ cls: "col-int", label: "INT", sortKey: "int" });
	if (showFollow)
		specs.push({ cls: "col-follow", label: _followLabel, sortKey: "follow" });
	for (const def of presentLangs)
		specs.push({
			cls: `col-lang col-lang-${def.key}`,
			label: def.label,
			sortKey: "lang:" + def.key,
		});
	// Divergence / Change relative to the in-class starter, surfaced
	// per-student from the new Diverge / Change columns of the remarks
	// xlsx. Hidden if no row carries them (older basis files).
	const showDiv =
		!_paperMode &&
		!_hiddenCols.has("diverge") &&
		_students.some((s) => s.divergence != null);
	const showChg =
		!_paperMode &&
		!_hiddenCols.has("change") &&
		_students.some((s) => s.change != null);
	if (showDiv)
		specs.push({
			cls: "col-diverge",
			label: "Div",
			title: "Divergence from in-class starter (missing+extra+ghost_extra)",
			sortKey: "diverge",
		});
	if (showChg)
		specs.push({
			cls: "col-change",
			label: "Chg",
			title: "Change from in-class starter (missing only)",
			sortKey: "change",
		});

	const _hasFpTs = (ev) =>
		ev.kind && ev.kind !== "normal" && ev.ts != null && ev.ts > 0;
	const _isFpEvent = (ev) => ev.kind && ev.kind !== "normal";
	let fpMinTs = Infinity;
	let fpMaxTs = -Infinity;
	for (const s of _students) {
		for (const ev of s.langEvents || []) {
			if (!_hasFpTs(ev)) continue;
			if (ev.ts < fpMinTs) fpMinTs = ev.ts;
			if (ev.ts > fpMaxTs) fpMaxTs = ev.ts;
		}
	}
	const fpRange = fpMaxTs - fpMinTs;
	const useFpTs = isFinite(fpMinTs) && isFinite(fpMaxTs) && fpRange > 0;
	const hasAnyFpEvents = _students.some((s) =>
		(s.langEvents || []).some(_isFpEvent),
	);
	const showFingerprint = useFpTs || hasAnyFpEvents;
	for (const s of _students) {
		s._fpPositions = [];
		if (!showFingerprint) continue;
		const mistakes = (s.langEvents || [])
			.filter(useFpTs ? _hasFpTs : _isFpEvent)
			.map((ev) => ({ ev, lang: ev.lang || "unk" }));
		if (!mistakes.length) continue;
		const positions = useFpTs
			? mistakes.map(({ ev }) => (ev.ts - fpMinTs) / fpRange)
			: mistakes.map((_, i) =>
					mistakes.length > 1 ? i / (mistakes.length - 1) : 0.5,
				);
		s._fpPositions = mistakes.map(({ lang }, i) => ({
			pos: positions[i],
			lang,
		}));
	}
	let fp2MaxBytes = 0;
	for (const s of _students) {
		const extras = (s.langEvents || []).filter(
			(ev) => ev.kind === "extra" || ev.kind === "extra-star",
		);
		const { bytes, langs } = _buildByteFingerprint(extras, {
			trackLangs: true,
		});
		s._fp2Bytes = bytes;
		s._fp2Langs = langs;
		s._fp2Hash = "";
		s._fp2Count = extras.length;
		if (bytes.length > fp2MaxBytes) fp2MaxBytes = bytes.length;
	}
	if (fp2MaxBytes % 2) fp2MaxBytes++;
	for (const s of _students) {
		while (s._fp2Bytes.length < fp2MaxBytes) s._fp2Bytes.push(0);
		s._fp2Hash = s._fp2Bytes.map((b) => String(b).padStart(3, "0")).join("-");
	}
	const hasAnyFp2 = fp2MaxBytes > 0;
	let fp3MaxBytes = 0;
	for (const s of _students) {
		const evs = (s.commentEvents || []).filter((ev) => ev.kind === "extra");
		const { bytes } = _buildByteFingerprint(evs);
		s._fp3Bytes = bytes;
		s._fp3Hash = "";
		s._fp3Count = evs.length;
		if (bytes.length > fp3MaxBytes) fp3MaxBytes = bytes.length;
	}
	if (fp3MaxBytes % 2) fp3MaxBytes++;
	for (const s of _students) {
		while (s._fp3Bytes.length < fp3MaxBytes) s._fp3Bytes.push(0);
		s._fp3Hash = s._fp3Bytes.map((b) => String(b).padStart(3, "0")).join("-");
	}
	const hasAnyFp3 = fp3MaxBytes > 0;
	_computeFingerprintMask(_students);
	const showFp1 =
		!_paperMode && showFingerprint && !_hiddenCols.has("fingerprint1");
	const showFp2 = !_paperMode && hasAnyFp2 && !_hiddenCols.has("fingerprint2");
	const showFp3 = !_paperMode && hasAnyFp3 && !_hiddenCols.has("fingerprint3");
	if (showFp1)
		specs.push({
			cls: "col-fingerprint col-fp1",
			label: "Fingerprint (F)",
			sortKey: "fingerprint1",
		});
	if (showFp2)
		specs.push({
			cls: "col-fingerprint col-fp2",
			label: "Fingerprint (E)",
			sortKey: "fingerprint2",
		});
	if (showFp3)
		specs.push({
			cls: "col-fingerprint col-fp3",
			label: "Fingerprint (C)",
			sortKey: "fingerprint3",
		});

	const trh = document.createElement("tr");
	for (const spec of specs) {
		const el = document.createElement("th");
		el.className = spec.cls;
		if (spec.title) el.title = spec.title;
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

		const openOnClick = (el) => {
			if (!hasFiles) {
				el.title = "No submitted files for this student";
				return;
			}
			el.classList.add("clickable-open");
			el.addEventListener("click", (e) => {
				e.stopPropagation();
				if (e.shiftKey) {
					openDiffForStudent(s);
					return;
				}
				document
					.querySelectorAll("#tbody tr.selected")
					.forEach((r) => r.classList.remove("selected"));
				tr.classList.add("selected");
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
				/^obs\.?$/i.test(rk.col) &&
				_artefactSchema &&
				_artefactSchema.length
			) {
				const code = rk.val === "_" || !rk.val ? "" : String(rk.val);
				_artefactSchema.forEach((a, i) => {
					const cell = document.createElement("td");
					cell.className = "col-remark col-obs col-artefact";
					_renderArtefactCell(cell, s, rk.col, i, code);
					tr.appendChild(cell);
				});
				continue;
			}
			const el = document.createElement("td");
			let cls = "col-remark";
			const isObs = /^obs\.?$/i.test(rk.col);
			const isGrade = /^grade$/i.test(rk.col);
			const isComments = /^comments?$/i.test(rk.col);
			const isExpected = /^expected$/i.test(rk.col);
			if (isObs) cls += " col-obs";
			else if (isGrade) cls += " col-grade";
			else if (isComments) cls += " col-comments";
			el.className = cls;
			const editable = isObs || isGrade || isComments;
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
					_makeCellEditable(el, s, rk.col);
					_renderObsCell(el, obsVal);
					el.addEventListener("blur", () => {
						_renderObsCell(el, el.textContent);
					});
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
		if (!_paperMode && _hasInteractions) {
			const el = document.createElement("td");
			el.className = "col-int";
			el.textContent = s.interactions;
			tr.appendChild(el);
		}
		if (showFollow) {
			const followEl = document.createElement("td");
			followEl.className = "col-follow";
			if (!isNaN(s.followPct)) {
				const pctEl = document.createElement("span");
				pctEl.className = "follow-pct";
				pctEl.textContent = s.followPct.toFixed(1) + "%";
				const bar = document.createElement("div");
				bar.className = "follow-bar";
				const fill = document.createElement("div");
				fill.className = "follow-bar-fill";
				fill.style.width = Math.max(0, Math.min(100, s.followPct)) + "%";
				bar.appendChild(fill);
				followEl.appendChild(pctEl);
				followEl.appendChild(bar);
			}
			tr.appendChild(followEl);
		}

		for (const def of presentLangs) {
			const cell = document.createElement("td");
			cell.className = `col-lang col-lang-${def.key}`;
			const pct = s.langPcts ? s.langPcts[def.key] : undefined;
			if (pct != null && !isNaN(pct)) {
				const pctEl = document.createElement("span");
				pctEl.className = "lang-pct";
				pctEl.textContent = pct.toFixed(1) + "%";
				const bar = document.createElement("div");
				bar.className = "lang-bar";
				const fill = document.createElement("div");
				fill.className = "lang-bar-fill";
				fill.style.width = Math.max(0, Math.min(100, pct)) + "%";
				bar.appendChild(fill);
				cell.appendChild(pctEl);
				cell.appendChild(bar);
			}
			tr.appendChild(cell);
		}

		const _fmtMarkCount = (n) => {
			if (n == null) return "";
			if (n >= 1000) return Math.round(n / 100) / 10 + "k";
			return String(n);
		};
		const _setMarkCell = (cell, total, byLang) => {
			cell.textContent = _fmtMarkCount(total);
			if (byLang && Object.keys(byLang).length) {
				const parts = Object.entries(byLang)
					.filter(([, v]) => v != null && v > 0)
					.sort(([, a], [, b]) => b - a)
					.map(([k, v]) => `${k.toUpperCase()}: ${v}`);
				if (parts.length) cell.title = parts.join("  ·  ");
			}
		};
		if (showDiv) {
			const cell = document.createElement("td");
			cell.className = "col-diverge";
			_setMarkCell(cell, s.divergence, s.langDiv);
			tr.appendChild(cell);
		}
		if (showChg) {
			const cell = document.createElement("td");
			cell.className = "col-change";
			_setMarkCell(cell, s.change, s.langChg);
			tr.appendChild(cell);
		}

		if (showFp1) {
			const fpEl = document.createElement("td");
			fpEl.className = "col-fingerprint col-fp1";
			if (s._fpMask) {
				setupTipHtml(
					fpEl,
					_boldFpGroups(
						_maskToBytes(s._fpMask),
						_bytesLangs(s._fpMaskLangs || []),
					),
				);
			}
			const wrap = document.createElement("div");
			wrap.className = "fp-wrap";
			const bar = document.createElement("div");
			bar.className = "fp-bar";
			for (const entry of s._fpPositions || []) {
				const mark = document.createElement("div");
				mark.className = "fp-mark lang-" + (entry.lang || "unk");
				mark.style.left = entry.pos * 100 + "%";
				bar.appendChild(mark);
			}
			wrap.appendChild(bar);
			fpEl.appendChild(wrap);
			tr.appendChild(fpEl);
		}
		if (showFp2) {
			const fpEl = document.createElement("td");
			fpEl.className = "col-fingerprint col-fp2";
			if (s._fp2Hash) {
				setupTipHtml(
					fpEl,
					_boldFpGroups(s._fp2Hash, _bytesLangs(s._fp2Langs || [])),
				);
			}
			const wrap = document.createElement("div");
			wrap.className = "fp-wrap";
			_renderByteFingerprint(wrap, s._fp2Bytes, {
				langs: s._fp2Langs || [],
				classPrefix: "fp2",
			});
			fpEl.appendChild(wrap);
			tr.appendChild(fpEl);
		}
		if (showFp3) {
			const fpEl = document.createElement("td");
			fpEl.className = "col-fingerprint col-fp3";
			if (s._fp3Hash) setupTipHtml(fpEl, _boldFpGroups(s._fp3Hash));
			const wrap = document.createElement("div");
			wrap.className = "fp-wrap";
			_renderByteFingerprint(wrap, s._fp3Bytes, {
				classPrefix: "fp3",
			});
			fpEl.appendChild(wrap);
			tr.appendChild(fpEl);
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

	const obsCol = visibleRemarkCols.find((c) => /^obs\.?$/i.test(c));
	let obsCounts = null;
	if (obsCol) {
		obsCounts = [];
		for (const s of sortedStudents) {
			if (s.ai_flagged) continue;
			const r = (s.remarks || []).find((x) => x.col === obsCol);
			if (!r || !r.val) continue;
			const code = String(r.val).trim();
			if (!/^[01]+$/.test(code)) continue;
			for (let i = 0; i < code.length; i++) {
				obsCounts[i] = (obsCounts[i] || 0) + (code[i] === "1" ? 1 : 0);
			}
		}
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
			const pctEl = document.createElement("span");
			pctEl.className = "follow-pct";
			pctEl.textContent = avgFollow.toFixed(1) + "%";
			td.appendChild(pctEl);
		} else if (isLang) {
			const lang = langMatch[1];
			if (avgByLang[lang] != null) {
				const pctEl = document.createElement("span");
				pctEl.className = "lang-pct";
				pctEl.textContent = avgByLang[lang].toFixed(1) + "%";
				td.appendChild(pctEl);
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
	const mismatches = (events || []).filter((ev) => ev.kind !== "normal");
	if (!mismatches.length) return;
	mismatches.sort((a, b) => {
		const ea = a.kind === "extra" ? 1 : 0;
		const eb = b.kind === "extra" ? 1 : 0;
		return ea - eb;
	});
	const counts = new Map();
	const order = [];
	for (const ev of mismatches) {
		const key = ev.token + "|" + ev.kind;
		if (!counts.has(key)) {
			counts.set(key, { ev, n: 0 });
			order.push(key);
		}
		counts.get(key).n++;
	}
	const wrap = document.createElement("div");
	wrap.className = "mismatch-cell";
	const tipParts = [];
	for (const key of order) {
		const { ev, n } = counts.get(key);
		const color = _mismatchColor(ev);
		const span = document.createElement("span");
		span.className = "mismatch-token";
		if (ev.kind === "extra-star") span.style.opacity = "0.5";
		span.style.color = color;
		span.textContent = ev.token + (n > 1 ? "×" + n : "");
		wrap.appendChild(span);
		if (order.indexOf(key) < order.length - 1) {
			const comma = document.createElement("span");
			comma.textContent = ", ";
			comma.style.color = THEME.codeMuted;
			wrap.appendChild(comma);
		}
		const esc = ev.token.replace(/&/g, "&amp;").replace(/</g, "&lt;");
		tipParts.push(
			`<span style="color:${color};font-family:Consolas,monospace;font-weight:bold">${esc}${n > 1 ? "&times;" + n : ""}</span>`,
		);
	}
	cell.innerHTML = "";
	cell.appendChild(wrap);
	const tipHtml = tipParts.join(
		`<span style="color:${THEME.codeMuted}">, </span>`,
	);
	cell.addEventListener("mouseenter", (e) => showTipHtml(e, tipHtml));
	cell.addEventListener("mousemove", (e) => moveTip(e));
	cell.addEventListener("mouseleave", () => hideTip());
}

function _colsPanelOutsideClick(e) {
	const panel = document.getElementById("cols-panel");
	const btn = document.getElementById("cols-btn");
	if (!panel || !btn) return;
	if (panel.contains(e.target) || btn.contains(e.target)) return;
	panel.hidden = true;
	document.removeEventListener("click", _colsPanelOutsideClick, true);
}

function _renderColsPanel() {
	const panel = document.getElementById("cols-panel");
	if (!panel) return;
	panel.innerHTML = "";
	for (const { key, label } of COL_HIDE_KEYS) {
		const lab = document.createElement("label");
		const cb = document.createElement("input");
		cb.type = "checkbox";
		cb.checked = !_hiddenCols.has(key);
		cb.addEventListener("change", () => {
			if (cb.checked) _hiddenCols.delete(key);
			else _hiddenCols.add(key);
			_saveHiddenCols();
			renderTable();
		});
		lab.appendChild(cb);
		lab.appendChild(document.createTextNode(" " + label));
		panel.appendChild(lab);
	}
}

function _toggleColsPanel() {
	const panel = document.getElementById("cols-panel");
	if (!panel) return;
	if (panel.hidden) {
		_renderColsPanel();
		panel.hidden = false;
		setTimeout(() => {
			document.addEventListener("click", _colsPanelOutsideClick, true);
		}, 0);
	} else {
		panel.hidden = true;
		document.removeEventListener("click", _colsPanelOutsideClick, true);
	}
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
		el.textContent = v;
		delete el.dataset.rawValue;
		delete el.dataset.artefactTipHtml;
		el.style.fontWeight = v ? "bold" : "";
		el.title = "";
	}
}

function _snapshotOrigObs(students) {
	_origObs.clear();
	for (const s of students || []) {
		if (s.id == null) continue;
		const r = (s.remarks || []).find((x) => /^obs\.?$/i.test(x.col));
		_origObs.set(String(s.id), r && r.val ? String(r.val) : "");
	}
}

function _artefactChangedSince(studentId, idx, fired) {
	const orig = _origObs.get(String(studentId)) || "";
	const origFired = /^[01]+$/.test(orig) && orig[idx] === "1";
	return fired !== origFired;
}

function _renderArtefactCell(el, student, colName, idx, code) {
	const fired = /^[01]+$/.test(code) && code[idx] === "1";
	const entry = _artefactSchema[idx];
	el.innerHTML = renderArtefactCellSquare(fired, entry);
	let tip = entry && entry.label ? entry.label : "";
	if (_artefactChangedSince(student.id, idx, fired)) {
		el.classList.add("artefact-changed");
		tip = tip ? `${tip} · changed (unsaved)` : "changed (unsaved)";
	}
	if (tip) el.title = tip;
	if (!_isReadOnly && student.id) {
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
		r && r.val && /^[01]+$/.test(String(r.val).trim())
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
			if (/^[01]+$/.test(c) && c[idx] === "1") count++;
		}
		totalTd.innerHTML = renderArtefactTotalOne(count, _artefactSchema[idx]);
	}
}

function _makeCellEditable(el, student, colName) {
	if (!student.id) return;
	if (_isReadOnly) return;
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
		const isObs = /^obs\.?$/i.test(colName);
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

const tipEl = document.getElementById("tip");

function setupTip(el, text, noWrap = false) {
	el.addEventListener("mouseenter", (e) => showTip(e, text, noWrap));
	el.addEventListener("mousemove", (e) => moveTip(e));
	el.addEventListener("mouseleave", () => hideTip());
}

function setupTipHtml(el, html) {
	el.addEventListener("mouseenter", (e) => showTipHtml(e, html));
	el.addEventListener("mousemove", (e) => moveTip(e));
	el.addEventListener("mouseleave", () => hideTip());
}

function showTip(e, text, noWrap = false) {
	tipEl.textContent = text;
	tipEl.style.whiteSpace = noWrap ? "pre" : "pre-wrap";
	tipEl.style.display = "block";
	moveTip(e);
}

function showTipHtml(e, html) {
	tipEl.innerHTML = html;
	tipEl.style.whiteSpace = "pre-wrap";
	tipEl.style.display = "block";
	moveTip(e);
}
function moveTip(e) {
	const tw = tipEl.offsetWidth,
		th = tipEl.offsetHeight;
	let tx = e.clientX + 14,
		ty = e.clientY - 8;
	if (tx + tw > window.innerWidth - 8) tx = e.clientX - tw - 14;
	if (ty + th > window.innerHeight - 8) ty = e.clientY - th - 8;
	tipEl.style.left = tx + "px";
	tipEl.style.top = ty + "px";
}

function hideTip() {
	tipEl.style.display = "none";
}

function _diffTitleFor(student) {
	const followPct =
		student.followPct != null ? student.followPct.toFixed(1) + "%" : "N/A";
	return `${student.id ? student.id + ". " : ""}${student.name} (${followPct})`;
}

function openDiffForStudent(student) {
	if (!_lessonName || !student.id) return;
	navigateToDifferentiator({
		lesson: _lessonName,
		group: _groupFolder(),
		id: student.id,
		title: _diffTitleFor(student),
	});
}
