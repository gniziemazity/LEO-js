"use strict";

async function loadXlsxFiles(files) {
	if (typeof XLSX === "undefined") {
		alert(
			"SheetJS not loaded — need internet access or xlsx.full.min.js next to this file.",
		);
		return;
	}

	let remarksFile = null;
	for (const f of files) {
		const n = f.name.toLowerCase();
		if (n.includes("remarks")) remarksFile = f;
	}
	if (!remarksFile) return;

	try {
		showLoading(true);
		const rBuf = await readFileArray(remarksFile);
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
	} catch (ex) {
		showLoading(false);
		alert("Error loading xlsx files:\n" + ex.message);
	}
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

	const followData = {};
	for (let i = 1; i < rowsR.length; i++) {
		const row = rowsR[i];
		const name = String(row[nameColR] || "").trim();
		if (!name || name === "undefined") continue;
		const pct = parseFloat(row[pctColR]);
		const desc = descColR !== -1 ? String(row[descColR] || "") : "";
		followData[name] = {
			pct: isNaN(pct) ? null : pct,
			events: parseFollowEvents(desc, sessionDate),
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
				(
					evs
						.filter(
							(e) => e.kind === "missing" || e.kind === "extra-star",
						)
						.reduce((a, b) => (a == null || b.ts < a.ts ? b : a), null) ??
					evs[0]
				)?.ts ?? null,
		});
	}
	return { students, idMap };
}

function parseFollowEvents(descText, sessionDate) {
	const events = [];
	if (!descText) return events;
	for (const seg of String(descText).split(/,\s+/)) {
		const m = seg.match(/^(.+?)\s*\((\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\)\s*$/);
		if (!m) continue;
		const rawLabel = m[1].trim();
		if (!rawLabel) continue;
		const [hms, frac = "0"] = m[2].split(".");
		const [h, min, s] = hms.split(":").map(Number);
		const ms = Number((frac + "000").slice(0, 3));
		const dt = new Date(sessionDate);
		dt.setHours(h, min, s, ms);
		const { kind, token } = parseFollowLabel(rawLabel);
		events.push({ label: rawLabel, ts: dt.getTime() / 1000, kind, token });
	}
	return events;
}
