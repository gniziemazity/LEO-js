"use strict";

let _basisFiles = new Map();
let _basisFallbackFile = null;
let _activeBasis = null;

async function loadXlsxFiles(files) {
	if (typeof XLSX === "undefined") {
		alert(
			"SheetJS not loaded — need internet access or xlsx.full.min.js next to this file.",
		);
		return;
	}

	const picked = pickRemarksFiles(files, { lessonName: _lessonName });
	_basisFiles = picked.basisFiles;
	_basisFallbackFile = picked.fallback;
	_activeBasis = defaultBasis(_basisFiles, parseToolParams().basis);
	const remarksFile = _activeBasis
		? _basisFiles.get(_activeBasis)
		: _basisFallbackFile;
	if (!remarksFile) return;

	try {
		showLoading(true);
		await _loadRemarksFile(remarksFile);
		_renderBasisPicker();
	} catch (ex) {
		showLoading(false);
		alert("Error loading xlsx files:\n" + ex.message);
	}
}

async function _loadRemarksFile(file) {
	const rBuf = await readFileArray(file);
	const sessionDate = new Date(_p.sessionStart * 1000);
	const result = parseStudentData(
		rBuf,
		sessionDate,
		_p.sessionStart,
		_p.sessionEnd,
	);
	_students = result.students;
	_studentIdMap = result.idMap;
	if (!_students.length) {
		showLoading(false);
		return;
	}
	document.getElementById("chart-bottom-section").style.display = "";
	scheduleRender();
}

function _renderBasisPicker() {
	const container = document.getElementById("chart-bottom-basis");
	if (!container) return;
	const shown = renderBasisSelect(
		container,
		_basisFiles,
		_activeBasis,
		async (key) => {
			_activeBasis = key;
			const f = _basisFiles.get(key);
			if (!f) return;
			try {
				showLoading(true);
				await _loadRemarksFile(f);
			} catch (ex) {
				showLoading(false);
				alert("Error loading basis xlsx:\n" + ex.message);
			}
		},
	);
	container.classList.toggle("has-options", !!shown);
}

function parseStudentData(remarksBuf, sessionDate, sessionStart, sessionEnd) {
	const { rows: rowsR, hdr: hdrR } = readRemarksSheet(remarksBuf);
	const nameColR = hdrR.indexOf("Student");
	const pctColR = hdrR.indexOf("Follow (E)");
	const descColR = hdrR.indexOf("Follow (E) Desc");
	const obsColRs = hdrR
		.map((h, i) => [String(h || "").toLowerCase(), i])
		.filter(([h]) => h.includes("obs"))
		.map(([, i]) => i);
	if (nameColR === -1 || pctColR === -1)
		throw new Error(
			'remarks.xlsx: missing "Student" or "Follow (E)" columns',
		);

	const idMap = {};
	const nameToId = {};
	for (let i = 1; i < rowsR.length; i++) {
		const row = rowsR[i];
		const idVal = row[0];
		const nameVal = row[1];
		if (idVal != null && nameVal != null) {
			const id = Number(idVal);
			const name = String(nameVal).trim();
			const idStr = String(idVal).trim();
			if (Number.isInteger(id) && id > 0 && name) {
				idMap[id] = name;
				nameToId[name] = idStr;
			}
		}
	}

	const langCols = remarksLangCols(hdrR).filter((c) => c.desc !== -1);

	const followData = {};
	for (let i = 1; i < rowsR.length; i++) {
		const row = rowsR[i];
		const name = String(row[nameColR] || "").trim();
		if (!name || name === "undefined") continue;
		const pct = parseFloat(row[pctColR]);
		const desc = descColR !== -1 ? String(row[descColR] || "") : "";
		const events = parseFollowEvents(desc, sessionDate);
		const langEvents = [];
		for (const col of langCols) {
			for (const ev of parseFollowEvents(row[col.desc], sessionDate)) {
				ev.lang = col.label;
				langEvents.push(ev);
			}
		}
		tagEventLangs(events, langEvents);
		followData[name] = {
			pct: isNaN(pct) ? null : pct,
			events,
			obs: obsColRs
				.map((c) => String(row[c] || "").trim())
				.filter(Boolean)
				.join(" "),
		};
	}

	const students = [];
	for (const name of Object.keys(followData).sort()) {
		const fd = followData[name];
		if (fd.pct == null) continue;
		let evs = fd.events || [];
		if (!evs.length)
			evs = [
				{
					label: "(followed till end)",
					ts: sessionEnd,
					kind: "normal",
					token: "",
				},
			];
		students.push({
			name,
			id: nameToId[name] || "",
			obs: fd.obs || "",
			follow_pct: fd.pct,
			follow_events: evs,
			follow_dt:
				evs
					.filter(_isMistakeEvent)
					.reduce((a, b) => (a == null || b.ts < a.ts ? b : a), null)
					?.ts ?? sessionEnd + CFG.PADDING / 2,
		});
	}
	return { students, idMap };
}
