"use strict";

let _students = [];
let _remarkCols = [];
let _hasInteractions = false;
let _followLabel = "FOLLOW";
let _allFiles = new Map();
let _dirHandle = null;
let _anonMode = "";
let _shownUnicodeCorruptionWarning = false;

const INTERACTION_MAP = { Q: "❓", A: "🙋", H: "🤝" };

const MISMATCH_COLORS = {
	missing: _cssVar("--clr-mark-missing") || "#cc2222",
	"extra-star": _cssVar("--clr-mark-ghost") || "#3aa0e0",
	extra: _cssVar("--clr-mark-extra") || "#007acc",
};

const UI_COLORS = {
	faint: _cssVar("--clr-code-muted") || "#aaa",
	muted: _cssVar("--clr-muted") || "#888",
	dangerStrong: _cssVar("--clr-danger-strong") || "#c62828",
};

const landingEl = document.getElementById("landing");
const mainEl = document.getElementById("main");
const loadingEl = document.getElementById("loading");
const lessonNameEl = document.getElementById("lesson-name");
const anonSelectEl = document.getElementById("anon-select");

(function () {
	const qs = new URLSearchParams(location.search);
	const anon = qs.get("anon") || "";
	if (anon && ["name", "id"].includes(anon)) {
		_anonMode = anon;
		anonSelectEl.value = anon;
	}
})();

async function _tryAutoLoad() {
	const handle = await _idbGet("lastDir");
	if (!handle || handle.kind !== "directory") return false;
	try {
		const perm = await handle.requestPermission({ mode: "read" });
		if (perm !== "granted") return false;
	} catch {
		return false;
	}
	showLoading(true);
	_dirHandle = handle;
	_allFiles.clear();
	const files = [];
	await readDirHandle(handle, "", _allFiles, files, { lowercaseKeys: true });
	lessonNameEl.textContent = handle.name;
	document.title = "Students – " + handle.name;
	await loadXlsxFiles(files);
	return true;
}

(async function () {
	const qs = new URLSearchParams(location.search);
	if (qs.get("autoload") !== "1") return;
	if (typeof XLSX === "undefined") {
		await new Promise((resolve) => {
			const s = document.querySelector('script[src*="xlsx"]');
			if (s) {
				s.addEventListener("load", resolve, { once: true });
				s.addEventListener("error", resolve, { once: true });
			} else {
				resolve();
			}
		});
	}
	const ok = await _tryAutoLoad();
	if (!ok) {
		const btn = document.createElement("button");
		btn.className = "landing-btn";
		btn.textContent = "🔄 Load Students";
		btn.onclick = async () => {
			btn.disabled = true;
			await _tryAutoLoad();
			btn.disabled = false;
		};
		document.getElementById("landing-buttons").prepend(btn);
	}
})();

function showLoading(on) {
	loadingEl.style.display = on ? "flex" : "none";
}

async function openFolderPicker() {
	try {
		const lastDir = await _idbGet("lastDir");
		const opts = { mode: "read" };
		if (lastDir) opts.startIn = lastDir;
		const dirHandle = await window.showDirectoryPicker(opts);
		_idbSet("lastDir", dirHandle);
		showLoading(true);
		_dirHandle = dirHandle;
		_allFiles.clear();
		const files = [];
		await readDirHandle(dirHandle, "", _allFiles, files, {
			lowercaseKeys: true,
		});
		const name = dirHandle.name;
		lessonNameEl.textContent = name;
		document.title = "Students – " + name;
		await loadXlsxFiles(files);
	} catch (e) {
		if (e.name !== "AbortError") alert("Could not open folder: " + e.message);
		showLoading(false);
	}
}

async function loadXlsxFiles(files) {
	if (typeof XLSX === "undefined") {
		await new Promise((resolve) => {
			const s = document.querySelector('script[src*="xlsx"]');
			if (s) {
				s.addEventListener("load", resolve, { once: true });
				s.addEventListener("error", resolve, { once: true });
			} else {
				resolve();
			}
		});
	}
	if (typeof XLSX === "undefined") {
		alert(
			"SheetJS not loaded — need an internet connection or xlsx.full.min.js next to this file.",
		);
		showLoading(false);
		return;
	}
	const xlsxFiles = files.filter((f) =>
		f.name.toLowerCase().endsWith(".xlsx"),
	);
	const _ts = (f) => {
		const m = f.name.match(/_(\d{8,})/);
		return m ? Number(m[1]) : f.lastModified || 0;
	};
	const gradesFiles = xlsxFiles
		.filter((f) => /grades/i.test(f.name))
		.sort((a, b) => _ts(b) - _ts(a));
	const remarksFiles = xlsxFiles
		.filter((f) => /remarks/i.test(f.name))
		.sort((a, b) => _ts(b) - _ts(a));
	const remarksFile = gradesFiles[0] || remarksFiles[0] || null;
	if (!remarksFile) {
		showLoading(false);
		alert(
			"No grades xlsx file found. Make sure a file with 'grades' or 'remarks' in its name exists.",
		);
		return;
	}
	try {
		showLoading(true);
		const remarksBuf = await readFileArray(remarksFile);
		const result = parseStudentRows(remarksBuf);
		_students = result.students;
		_remarkCols = result.remarkCols;
		_hasInteractions = result.hasInteractions;
		_followLabel = result.followLabel;
		showLoading(false);
		if (!_students.length) {
			alert("No students found in remarks xlsx.");
			return;
		}
		landingEl.style.display = "none";
		mainEl.style.display = "flex";
		renderTable();
	} catch (ex) {
		showLoading(false);
		alert("Error loading xlsx files:\n" + ex.message);
	}
}

function parseStudentRows(remarksBuf) {
	const wbR = XLSX.read(remarksBuf, { type: "array" });
	const wsR =
		wbR.Sheets["Grades"] ||
		wbR.Sheets["Remarks"] ||
		wbR.Sheets[wbR.SheetNames[0]];
	const rowsR = XLSX.utils.sheet_to_json(wsR, {
		header: 1,
		defval: "",
	});
	const hdrR = (rowsR[0] || []).map((h) => String(h || "").trim());

	const iName = findCol(hdrR, /^(student|name|student.?name)$/i);
	const iId = findCol(hdrR, /^(student.?id|id)$/i);
	const iNum = findCol(hdrR, /^(number|no\.?|phone|tel|student.?no\.?)$/i);
	let iFollowPct = hdrR.indexOf("Follow (E)");
	let iFollowDesc = hdrR.indexOf("Follow (E) Desc");
	const iSimilarity = iFollowPct === -1 ? hdrR.indexOf("Similarity") : -1;
	if (iSimilarity !== -1) {
		iFollowPct = iSimilarity;
		iFollowDesc = hdrR.indexOf("Similarity Desc");
	}
	const iRemarksDesc = findCol(hdrR, /^remarks?\s*desc/i);

	const iInteractions = findCol(hdrR, /^interactions?$/i);
	const specialSet = new Set(
		[
			iName,
			iId,
			iNum,
			iFollowPct,
			iFollowDesc,
			iRemarksDesc,
			iInteractions,
		].filter((i) => i !== -1),
	);

	const REMARK_WHITELIST = /^(remarks?|expected|obs\.?|interactions?)$/i;
	const remarkCols = hdrR
		.map((name, idx) => ({ name, idx }))
		.filter(
			({ name, idx }) => !specialSet.has(idx) && REMARK_WHITELIST.test(name),
		);
	if (iName === -1) throw new Error('Remarks xlsx: missing "Student" column');

	const students = [];
	const unicodeCorruptionHits = [];
	const unicodeRepairHits = [];
	for (let i = 1; i < rowsR.length; i++) {
		const row = rowsR[i];
		const name = String(row[iName] || "").trim();
		if (!name || name === "undefined") continue;
		const followPct = iFollowPct !== -1 ? parseFloat(row[iFollowPct]) : NaN;
		const followDesc =
			iFollowDesc !== -1 ? String(row[iFollowDesc] || "") : "";
		const followEvents = isNaN(followPct)
			? []
			: iSimilarity !== -1
				? parseSimilarityEvents(followDesc)
				: parseFollowEvents(followDesc);
		const remarksDesc =
			iRemarksDesc !== -1 ? String(row[iRemarksDesc] ?? "").trim() : "";
		const remarks = remarkCols.map(({ name: colName, idx }) => {
			const addr = XLSX.utils.encode_cell({ r: i, c: idx });
			const cell = wsR[addr];
			const note =
				cell && cell.c
					? cell.c
							.map((c) => c.t || "")
							.filter(Boolean)
							.join("\n")
							.trim()
					: "";
			const rawVal = String(row[idx] ?? "").trim();
			const repaired = repairLikelyAstralEmojiFallbacks(rawVal);
			if (repaired.repairedCount) {
				unicodeRepairHits.push({
					rowIndex: i + 1,
					name,
					column: colName,
					before: rawVal,
					after: repaired.text,
				});
			}
			const val = repaired.text;
			if (hasLikelyAstralTruncation(val)) {
				unicodeCorruptionHits.push({
					rowIndex: i + 1,
					name,
					column: colName,
					value: val,
				});
			}
			return {
				col: colName,
				val,
				note,
			};
		});
		const obsEmpty = (r) => /^obs$/i.test(r.col) && (r.val === "_" || !r.val);
		if (remarks.every((r) => !r.val || obsEmpty(r))) continue;
		const interactions =
			iInteractions !== -1
				? String(row[iInteractions] ?? "")
						.trim()
						.split(/[\s,;]+/)
						.filter(Boolean)
						.map((t) => INTERACTION_MAP[t.toUpperCase()] || t)
						.join("")
				: "";
		students.push({
			name,
			id: iId !== -1 ? String(row[iId] ?? "").trim() : "",
			num: iNum !== -1 ? String(row[iNum] ?? "").trim() : "",
			followPct,
			followEvents,
			remarksDesc,
			remarks,
			interactions,
		});
	}
	students.sort((a, b) =>
		a.id.localeCompare(b.id, undefined, { numeric: true }),
	);
	warnLikelyAstralTruncation(unicodeCorruptionHits, unicodeRepairHits);
	return {
		students,
		remarkCols: remarkCols.map((c) => c.name),
		hasInteractions: iInteractions !== -1,
		followLabel: iSimilarity !== -1 ? "SIM" : "FOLLOW",
	};
}

function hasLikelyAstralTruncation(text) {
	if (!text) return false;
	for (const ch of text) {
		if (isLikelyAstralEmojiFallbackChar(ch)) return true;
	}
	return false;
}

function isLikelyAstralEmojiFallbackChar(ch) {
	if (!ch || ch.length === 0) return false;
	const cp = ch.codePointAt(0);
	if (cp < 0xf900 || cp > 0xfaff) return false;
	const candidate = String.fromCodePoint(0x10000 + cp);
	return /\p{Extended_Pictographic}/u.test(candidate);
}

function repairLikelyAstralEmojiFallbacks(text) {
	if (!text) return { text, repairedCount: 0 };
	let repairedCount = 0;
	let out = "";
	for (const ch of text) {
		if (isLikelyAstralEmojiFallbackChar(ch)) {
			repairedCount += 1;
			out += String.fromCodePoint(0x10000 + ch.codePointAt(0));
		} else {
			out += ch;
		}
	}
	return { text: out, repairedCount };
}

function warnLikelyAstralTruncation(hits, repairs) {
	if (_shownUnicodeCorruptionWarning || (!hits.length && !repairs.length))
		return;
	_shownUnicodeCorruptionWarning = true;
	const repairedCount = repairs.length;
	const unrepairedCount = hits.length;
	const repairedSample = repairs.slice(0, 4);
	const unrepairedSample = hits.slice(0, 4);
	if (repairedCount) {
		console.warn(
			"[Students] Repaired likely astral emoji fallback glyphs in XLSX values.",
			{ repairedCount, sample: repairedSample },
		);
	}
	if (unrepairedCount) {
		console.warn(
			"[Students] Some possible astral emoji truncations could not be auto-repaired.",
			{ unrepairedCount, sample: unrepairedSample },
		);
	}
}

function findCol(headers, re) {
	const idx = headers.findIndex((h) => re.test(h));
	return idx; // -1 if not found
}

function parseSimilarityEvents(descText) {
	const events = [];
	for (const part of (descText || "").split(/,\s*/)) {
		const m = part.trim().match(/^([+-])(.+?)(?:\s+\(x(\d+)\))?$/);
		if (!m) continue;
		const kind = m[1] === "-" ? "missing" : "extra";
		const token = m[2].trim();
		const count = m[3] ? parseInt(m[3]) : 1;
		for (let i = 0; i < count; i++) events.push({ kind, token });
	}
	return events;
}

function parseFollowEvents(descText) {
	const re = /([^(,]+?)\s*\((\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\)/g;
	const events = [];
	let m;
	while ((m = re.exec(descText)) !== null) {
		const rawLabel = m[1].trim();
		events.push({ label: rawLabel, ...parseFollowLabel(rawLabel) });
	}
	return events;
}

function renderTable() {
	const thead = document.getElementById("thead");
	const tbody = document.getElementById("tbody");
	thead.innerHTML = "";
	tbody.innerHTML = "";

	const showId = true; // ID always shown
	const showName = _anonMode !== "id";
	const showNum = _anonMode === "";

	// Build column specs
	const specs = [];
	if (showId) specs.push({ cls: "col-id", label: "ID" });
	if (showName) specs.push({ cls: "col-name", label: "Name" });
	if (showNum) specs.push({ cls: "col-num", label: "#" });
	for (const col of _remarkCols)
		specs.push({ cls: "col-remark", label: col, title: col });
	if (_hasInteractions) specs.push({ cls: "col-int", label: "INT" });
	specs.push({ cls: "col-follow", label: _followLabel });

	const trh = document.createElement("tr");
	for (const spec of specs) {
		const el = document.createElement("th");
		el.textContent = spec.label;
		el.className = spec.cls;
		if (spec.title) el.title = spec.title;
		trh.appendChild(el);
	}
	const thMm = document.createElement("th");
	thMm.textContent = "Mismatches";
	thMm.className = "col-mismatch";
	trh.appendChild(thMm);
	thead.appendChild(trh);

	for (const s of _students) {
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
			el.className = "col-remark";
			const isObs = /^obs$/i.test(rk.col);
			const isExpected = /^expected$/i.test(rk.col);
			if (isObs) {
				const obsVal = rk.val === "_" || !rk.val ? "" : rk.val;
				el.textContent = obsVal;
				if (obsVal) {
					el.style.fontWeight = "bold";
					el.style.color = UI_COLORS.dangerStrong;
				}
			} else {
				el.textContent = rk.val;
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
			followEl.style.color = UI_COLORS.faint;
		}
		tr.appendChild(followEl);

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
		const color = MISMATCH_COLORS[ev.kind] || UI_COLORS.muted;
		const span = document.createElement("span");
		span.className = "mismatch-token";
		span.style.color = color;
		span.textContent = ev.token + (n > 1 ? "×" + n : "");
		wrap.appendChild(span);
		if (order.indexOf(key) < order.length - 1) {
			const comma = document.createElement("span");
			comma.textContent = ", ";
			comma.style.color = UI_COLORS.faint;
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
		`<span style="color:${UI_COLORS.faint}">, </span>`,
	);
	cell.addEventListener("mouseenter", (e) => showTipHtml(e, tipHtml));
	cell.addEventListener("mousemove", (e) => moveTip(e));
	cell.addEventListener("mouseleave", () => hideTip());
}

function onAnonChange(val) {
	_anonMode = val;
	renderTable();
}

const tipEl = document.getElementById("tip");

function setupTip(el, text, noWrap = false) {
	el.addEventListener("mouseenter", (e) => showTip(e, text, noWrap));
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

const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|ico|bmp)$/i;

async function _readStudentDiffPayload(student) {
	const followPct =
		student.followPct != null ? student.followPct.toFixed(1) + "%" : "N/A";

	const fileMap = new Map();
	if (_dirHandle) {
		await readDirHandle(_dirHandle, "", fileMap, [], { lowercaseKeys: true });
	} else {
		for (const [k, v] of _allFiles) fileMap.set(k, v);
	}

	const recoEntries = [...fileMap.entries()].filter(
		([p]) => /^reconstructed\//i.test(p) && /\.(html|css|js|py)$/i.test(p),
	);
	const correctEntries = [...fileMap.entries()].filter(
		([p]) => /^correct\//i.test(p) && /\.(html|css|js|py)$/i.test(p),
	);
	const teacherEntries = recoEntries.length ? recoEntries : correctEntries;
	const studentDir = (student.id + "/").toLowerCase();
	const anonBase = "anon_ids/";
	const studentEntries = [...fileMap.entries()].filter(
		([p]) =>
			p.startsWith(anonBase + studentDir) && /\.(html|css|js|py)$/i.test(p),
	);

	const allMarks = {};
	for (const [mode, fname] of Object.entries(DIFF_MARKS_FILES)) {
		const entry = fileMap.get(anonBase + studentDir + fname);
		if (entry) {
			try {
				allMarks[mode] = JSON.parse(await readFileText(entry));
			} catch {}
		}
	}

	const teacherFiles = {};
	for (const [, file] of teacherEntries)
		teacherFiles[file.name] = await readFileText(file);

	const studentFiles = {};
	for (const [, file] of studentEntries)
		studentFiles[file.name] = await readFileText(file);

	const imageUris = {};
	const imageEntries = [...fileMap.entries()].filter(
		([p]) =>
			IMAGE_EXT.test(p) &&
			(/^correct\//i.test(p) || p.startsWith(anonBase + studentDir)),
	);
	for (const [, file] of imageEntries) {
		if (!imageUris[file.name]) {
			imageUris[file.name] = await readFileDataUri(file);
		}
	}

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
