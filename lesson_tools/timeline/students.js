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

	_basisFiles = new Map();
	_basisFallbackFile = null;
	for (const f of files) {
		const n = f.name.toLowerCase();
		if (!n.includes("remarks") || !n.endsWith(".xlsx")) continue;
		let matched = false;
		for (const { key } of REMARKS_BASES) {
			if (n === `remarks_${key}.xlsx`) {
				_basisFiles.set(key, f);
				matched = true;
				break;
			}
		}
		if (!matched) _basisFallbackFile = f;
	}

	let chosenKey = null;
	for (const key of DEFAULT_BASIS_ORDER) {
		if (_basisFiles.has(key)) {
			chosenKey = key;
			break;
		}
	}
	if (!chosenKey) {
		for (const { key } of REMARKS_BASES) {
			if (_basisFiles.has(key)) {
				chosenKey = key;
				break;
			}
		}
	}
	_activeBasis = chosenKey;
	const remarksFile = chosenKey
		? _basisFiles.get(chosenKey)
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
	if (_basisFiles.size === 0) {
		container.classList.remove("has-options");
		container.innerHTML = "";
		return;
	}
	container.classList.add("has-options");
	let select = container.querySelector("select");
	if (!select) {
		container.innerHTML = "";
		container.appendChild(document.createTextNode("Basis: "));
		select = document.createElement("select");
		container.appendChild(select);
		select.addEventListener("change", async () => {
			_activeBasis = select.value;
			select.classList.toggle(
				"is-curated",
				_activeBasis === "ideal" || _activeBasis === "required",
			);
			const f = _basisFiles.get(_activeBasis);
			if (!f) return;
			try {
				showLoading(true);
				await _loadRemarksFile(f);
			} catch (ex) {
				showLoading(false);
				alert("Error loading basis xlsx:\n" + ex.message);
			}
		});
	}
	select.innerHTML = "";
	for (const { key, label } of REMARKS_BASES) {
		if (!_basisFiles.has(key)) continue;
		const opt = document.createElement("option");
		opt.value = key;
		opt.textContent = label;
		select.appendChild(opt);
	}
	if (_activeBasis) select.value = _activeBasis;
	select.classList.toggle(
		"is-curated",
		select.value === "ideal" || select.value === "required",
	);
}

function parseStudentData(remarksBuf, sessionDate, sessionStart, sessionEnd) {
	const wbR = XLSX.read(remarksBuf, { type: "array" });
	const wsR = wbR.Sheets["Remarks"] || wbR.Sheets[wbR.SheetNames[0]];
	const rowsR = XLSX.utils.sheet_to_json(wsR, { header: 1, defval: "" });
	const hdrR = rowsR[0] || [];
	const nameColR = hdrR.indexOf("Student");
	const pctColR = hdrR.indexOf("Follow (E)");
	const descColR = hdrR.indexOf("Follow (E) Desc");
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

	const langDescCols = {};
	for (const label of ["HTML", "CSS", "JS", "Py"]) {
		const col = hdrR.indexOf(`${label} (E) Desc`);
		if (col !== -1) langDescCols[label] = col;
	}

	const followData = {};
	for (let i = 1; i < rowsR.length; i++) {
		const row = rowsR[i];
		const name = String(row[nameColR] || "").trim();
		if (!name || name === "undefined") continue;
		const pct = parseFloat(row[pctColR]);
		const desc = descColR !== -1 ? String(row[descColR] || "") : "";
		const events = parseFollowEvents(desc, sessionDate);
		const langOf = new Map();
		for (const [label, col] of Object.entries(langDescCols)) {
			const langDesc = String(row[col] || "");
			if (!langDesc) continue;
			for (const ev of parseFollowEvents(langDesc, sessionDate)) {
				langOf.set(`${ev.kind}|${ev.token}|${ev.ts}`, label);
			}
		}
		for (const ev of events) {
			const key = `${ev.kind}|${ev.token}|${ev.ts}`;
			const lang = langOf.get(key);
			if (lang) ev.lang = lang;
		}
		followData[name] = {
			pct: isNaN(pct) ? null : pct,
			events,
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
