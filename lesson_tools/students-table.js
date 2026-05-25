"use strict";

function renderTable() {
	const thead = document.getElementById("thead");
	const tbody = document.getElementById("tbody");
	thead.innerHTML = "";
	tbody.innerHTML = "";

	const showId = true;
	const showName = _anonMode !== "id";
	const showNum = _anonMode === "";

	const presentLangs = LANG_COL_DEFS.filter((def) =>
		_students.some((s) => s.langPcts && s.langPcts[def.key] != null),
	);

	const specs = [];
	if (showId) specs.push({ cls: "col-id", label: "ID", sortKey: "id" });
	if (showName)
		specs.push({ cls: "col-name", label: "Name", sortKey: "name" });
	if (showNum) specs.push({ cls: "col-num", label: "#", sortKey: "num" });
	for (const col of _remarkCols) {
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
	if (_hasInteractions)
		specs.push({ cls: "col-int", label: "INT", sortKey: "int" });
	specs.push({ cls: "col-follow", label: _followLabel, sortKey: "follow" });
	for (const def of presentLangs)
		specs.push({
			cls: `col-lang col-lang-${def.key}`,
			label: def.label,
			sortKey: "lang:" + def.key,
		});

	const _hasFpTs = (ev) =>
		ev.kind && ev.kind !== "normal" && ev.ts != null && ev.ts > 0;
	const _isFpEvent = (ev) => ev.kind && ev.kind !== "normal";
	const _isMissingCommentWithTs = (ev) =>
		ev.kind === "missing" && ev.ts != null && ev.ts > 0;
	let fpMinTs = Infinity;
	let fpMaxTs = -Infinity;
	for (const s of _students) {
		for (const ev of s.langEvents || []) {
			if (!_hasFpTs(ev)) continue;
			if (ev.ts < fpMinTs) fpMinTs = ev.ts;
			if (ev.ts > fpMaxTs) fpMaxTs = ev.ts;
		}
		for (const ev of s.commentEvents || []) {
			if (!_isMissingCommentWithTs(ev)) continue;
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
		const langTagged = (s.langEvents || [])
			.filter(useFpTs ? _hasFpTs : _isFpEvent)
			.map((ev) => ({ ev, lang: ev.lang || "unk" }));
		const commentTagged = useFpTs
			? (s.commentEvents || [])
					.filter(_isMissingCommentWithTs)
					.map((ev) => ({ ev, lang: "comment" }))
			: [];
		const mistakes = [...langTagged, ...commentTagged];
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
		s._fp2Bytes = [];
		s._fp2Hash = "";
		const extras = (s.langEvents || []).filter(
			(ev) => ev.kind === "extra" || ev.kind === "extra-star",
		);
		const bytes = [];
		let cur = 0;
		let count = 0;
		for (const ev of extras) {
			const tok = ev.token || ev.label || "";
			const bit = tok.length % 2;
			cur = (cur << 1) | bit;
			count++;
			if (count === 8) {
				bytes.push(cur);
				cur = 0;
				count = 0;
			}
		}
		if (count > 0) bytes.push(cur);
		s._fp2Bytes = bytes;
		if (bytes.length > fp2MaxBytes) fp2MaxBytes = bytes.length;
	}
	for (const s of _students) {
		while (s._fp2Bytes.length < fp2MaxBytes) s._fp2Bytes.push(0);
		s._fp2Hash = s._fp2Bytes.map((b) => String(b).padStart(3, "0")).join("-");
	}
	const hasAnyFp2 = fp2MaxBytes > 0;
	let fp3MaxBytes = 0;
	for (const s of _students) {
		s._fp3Bytes = [];
		s._fp3Hash = "";
		const evs = (s.commentEvents || []).filter((ev) => ev.kind === "extra");
		const bytes = [];
		let cur = 0;
		let count = 0;
		for (const ev of evs) {
			const tok = ev.token || ev.label || "";
			const bit = tok.length % 2;
			cur = (cur << 1) | bit;
			count++;
			if (count === 8) {
				bytes.push(cur);
				cur = 0;
				count = 0;
			}
		}
		if (count > 0) bytes.push(cur);
		s._fp3Bytes = bytes;
		if (bytes.length > fp3MaxBytes) fp3MaxBytes = bytes.length;
	}
	for (const s of _students) {
		while (s._fp3Bytes.length < fp3MaxBytes) s._fp3Bytes.push(0);
		s._fp3Hash = s._fp3Bytes.map((b) => String(b).padStart(3, "0")).join("-");
	}
	const hasAnyFp3 = fp3MaxBytes > 0;
	_computeFingerprintMask(_students);
	if (showFingerprint || hasAnyFp2 || hasAnyFp3)
		specs.push({
			cls: "col-fingerprint",
			label: "Fingerprint",
			sortKey: "fingerprint",
		});

	const trh = document.createElement("tr");
	for (const spec of specs) {
		const el = document.createElement("th");
		el.className = spec.cls;
		if (spec.title) el.title = spec.title;
		if (spec.sortKey) {
			el.classList.add("sortable");
			el.textContent = spec.label;
			if (_sortCol === spec.sortKey) {
				const arrow = document.createElement("span");
				arrow.className = "sort-arrow";
				arrow.textContent = _sortDir === "asc" ? "▲" : "▼";
				el.appendChild(arrow);
			}
			el.addEventListener("click", () => _onSortHeaderClick(spec.sortKey));
		} else {
			el.textContent = spec.label;
		}
		trh.appendChild(el);
	}
	const thMm = document.createElement("th");
	thMm.textContent = "Mismatches";
	thMm.className = "col-mismatch";
	trh.appendChild(thMm);
	thead.appendChild(trh);

	const sortedStudents = _sortStudents(_students, _sortCol, _sortDir);
	for (const s of sortedStudents) {
		const tr = document.createElement("tr");

		if (showId) {
			const el = document.createElement("td");
			el.textContent = s.id || "–";
			el.className = "col-id";
			tr.appendChild(el);
		}
		if (showName) {
			const el = document.createElement("td");
			el.textContent = s.name;
			el.className = "col-name";
			tr.appendChild(el);
		}
		if (showNum) {
			const el = document.createElement("td");
			el.textContent = s.num || "–";
			el.className = "col-num";
			tr.appendChild(el);
		}
		for (const rk of s.remarks) {
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
			const obsVal = isObs && (rk.val === "_" || !rk.val) ? "" : rk.val;
			if (isObs && obsVal) el.style.fontWeight = "bold";
			el.textContent = isObs ? obsVal : rk.val;
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
			tr.appendChild(el);
		}
		if (_hasInteractions) {
			const el = document.createElement("td");
			el.className = "col-int";
			el.textContent = s.interactions;
			tr.appendChild(el);
		}
		const followEl = document.createElement("td");
		followEl.className = "col-follow";
		if (!isNaN(s.followPct)) {
			followEl.textContent = s.followPct.toFixed(1) + "%";
			const r = Math.round(
				Math.max(0, Math.min(1, 1 - s.followPct / 100)) * 200,
			);
			followEl.style.color = `rgb(${r}, 0, 0)`;
		} else {
			followEl.textContent = "";
			followEl.style.color = THEME.codeMuted;
		}
		tr.appendChild(followEl);

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

		if (showFingerprint || hasAnyFp2 || hasAnyFp3) {
			const fpEl = document.createElement("td");
			fpEl.className = "col-fingerprint";
			const parts = [];
			if (s._fpMask) parts.push(_boldFpGroups(_maskToBytes(s._fpMask)));
			if (s._fp2Hash) parts.push(_boldFpGroups(s._fp2Hash));
			if (s._fp3Hash) parts.push(_boldFpGroups(s._fp3Hash));
			if (parts.length) setupTipHtml(fpEl, parts.join("  |  "));
			const wrap = document.createElement("div");
			wrap.className = "fp-wrap";
			if (showFingerprint) {
				const bar = document.createElement("div");
				bar.className = "fp-bar";
				for (const entry of s._fpPositions || []) {
					const mark = document.createElement("div");
					mark.className = "fp-mark lang-" + (entry.lang || "unk");
					mark.style.left = entry.pos * 100 + "%";
					bar.appendChild(mark);
				}
				wrap.appendChild(bar);
			}
			if (hasAnyFp2) {
				const bar2 = document.createElement("div");
				bar2.className = "fp2-bar";
				for (const b of s._fp2Bytes) {
					const col = document.createElement("div");
					col.className = "fp2-byte";
					for (let k = 7; k >= 0; k--) {
						const bit = (b >> k) & 1;
						const px = document.createElement("div");
						px.className = "fp2-bit" + (bit ? " on" : "");
						col.appendChild(px);
					}
					bar2.appendChild(col);
				}
				wrap.appendChild(bar2);
			}
			if (hasAnyFp3) {
				const bar3 = document.createElement("div");
				bar3.className = "fp3-bar";
				for (const b of s._fp3Bytes) {
					const col = document.createElement("div");
					col.className = "fp3-byte";
					for (let k = 7; k >= 0; k--) {
						const bit = (b >> k) & 1;
						const px = document.createElement("div");
						px.className = "fp3-bit" + (bit ? " on" : "");
						col.appendChild(px);
					}
					bar3.appendChild(col);
				}
				wrap.appendChild(bar3);
			}
			fpEl.appendChild(wrap);
			tr.appendChild(fpEl);
		}

		const mmEl = document.createElement("td");
		mmEl.className = "col-mismatch";
		renderMismatches(mmEl, s.followEvents);
		tr.appendChild(mmEl);

		tr.addEventListener("click", () => {
			document
				.querySelectorAll("#tbody tr.selected")
				.forEach((r) => r.classList.remove("selected"));
			tr.classList.add("selected");
			openDiffForStudent(s);
		});
		tbody.appendChild(tr);
	}
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

function onAnonChange(val) {
	_anonMode = val;
	renderTable();
}

function _makeCellEditable(el, student, colName) {
	if (!student.id) return;
	el.classList.add("editable-cell");
	el.contentEditable = "plaintext-only";
	el.spellcheck = false;
	el.title = "Click to edit · Enter commits · Esc cancels";
	el.addEventListener("click", (e) => e.stopPropagation());
	el.addEventListener("mousedown", (e) => e.stopPropagation());
	let _origText = el.textContent;
	el.addEventListener("focus", () => {
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

async function _readStudentDiffPayload(student) {
	const followPct =
		student.followPct != null ? student.followPct.toFixed(1) + "%" : "N/A";

	const fileMap = new Map();
	if (_dirHandle) {
		await readDirHandle(_dirHandle, "", fileMap, [], { lowercaseKeys: true });
	} else {
		for (const [k, v] of _allFiles) fileMap.set(k, v);
	}

	const studentPrefix = "anon_ids/" + (student.id + "/").toLowerCase();
	const { teacherFiles, studentFiles, allMarks, imageUris } =
		await buildDiffPayloadData(fileMap, studentPrefix);

	if (!Object.keys(teacherFiles).length && !Object.keys(studentFiles).length) {
		throw new Error(
			`No files found for student "${student.name}". Make sure the folder contains correct/ and anon_ids/ subdirectories.`,
		);
	}

	return {
		teacherFiles,
		studentFiles,
		allMarks,
		imageUris,
		title: `${student.id ? student.id + ". " : ""}${student.name} (${followPct})`,
	};
}

async function openDiffForStudent(student) {
	if (!_allFiles.size) return;
	try {
		await openDifferentiator(() => _readStudentDiffPayload(student));
	} catch (err) {
		console.error("[Students] openDiffForStudent", err);
		alert("Error opening differentiator: " + err.message);
	}
}
