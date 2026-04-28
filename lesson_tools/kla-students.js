"use strict";

async function loadXlsxFiles(files) {
	if (typeof XLSX === "undefined") {
		alert(
			"SheetJS not loaded — need internet access or xlsx.full.min.js next to this file.",
		);
		return;
	}

	let remarksFile = null,
		simFile = null;
	for (const f of files) {
		const n = f.name.toLowerCase();
		if (n.includes("remarks")) remarksFile = f;
		else if (
			n.includes("similarity") ||
			n.includes("teacher_sim") ||
			n.includes("sim")
		)
			simFile = f;
	}
	if (!remarksFile || !simFile) return;

	try {
		showLoading(true);
		const [rBuf, sBuf] = await Promise.all([
			readAsArray(remarksFile),
			readAsArray(simFile),
		]);
		const sessionDate = new Date(_p.sessionStart * 1000);
		const result = parseStudentData(
			rBuf,
			sBuf,
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
		document.getElementById("chart3-section").style.display = "";
		scheduleRender();
	} catch (ex) {
		showLoading(false);
		alert("Error loading xlsx files:\n" + ex.message);
	}
}

function readAsArray(file) {
	return new Promise((res, rej) => {
		const r = new FileReader();
		r.onload = (e) => res(new Uint8Array(e.target.result));
		r.onerror = rej;
		r.readAsArrayBuffer(file);
	});
}

function parseStudentData(
	remarksBuf,
	simBuf,
	sessionDate,
	sessionStart,
	sessionEnd,
) {
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
	for (let i = 1; i < rowsR.length; i++) {
		const row = rowsR[i];
		const idVal = row[0];
		const nameVal = row[1];
		if (idVal != null && nameVal != null) {
			const id = Number(idVal);
			const name = String(nameVal).trim();
			if (Number.isInteger(id) && id > 0 && name) {
				idMap[id] = name;
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

	const wbS = XLSX.read(simBuf, { type: "array" });
	const wsS = wbS.Sheets[wbS.SheetNames[0]];
	const rowsS = XLSX.utils.sheet_to_json(wsS, { header: 1, defval: "" });
	const hdrS = rowsS[0] || [];
	const nameColS = hdrS.indexOf("Student");
	const incCols = hdrS.reduce((a, h, i) => {
		if (h === "Inc" || (h && String(h).endsWith("_Inc"))) a.push(i);
		return a;
	}, []);

	const incData = {};
	if (nameColS !== -1 && incCols.length) {
		for (let i = 1; i < rowsS.length; i++) {
			const row = rowsS[i];
			const name = String(row[nameColS] || "").trim();
			if (!name) continue;
			const vals = incCols
				.map((c) => parseFloat(row[c]))
				.filter((v) => !isNaN(v));
			if (vals.length)
				incData[name] = vals.reduce((a, v) => a + v, 0) / vals.length;
		}
	}

	const allNames = new Set([
		...Object.keys(followData),
		...Object.keys(incData),
	]);
	const students = [];
	for (const name of [...allNames].sort()) {
		const fd = followData[name] || {};
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
			follow_pct: fd.pct,
			follow_events: evs,
			follow_dt:
				(
					evs.find((e) => e.kind !== "extra" && e.kind !== "extra-star") ??
					evs[0]
				)?.ts ?? null,
			inc_sim: incData[name] ?? null,
		});
	}
	return { students, idMap };
}

function parseFollowLabel(label) {
	if (label.startsWith("-")) {
		const token = label.slice(1).trimStart();
		return { kind: "missing", token };
	}
	if (label.startsWith("+")) {
		const tokenPart = label.slice(1).trimStart();
		if (tokenPart.endsWith("*")) {
			return { kind: "extra-star", token: tokenPart.slice(0, -1).trimEnd() };
		}
		return { kind: "extra", token: tokenPart };
	}
	return { kind: "normal", token: label };
}

function parseFollowEvents(descText, sessionDate) {
	const re = /([^(,]+?)\s*\((\d{2}:\d{2}:\d{2})\)/g;
	const events = [];
	let m;
	while ((m = re.exec(descText)) !== null) {
		const rawLabel = m[1].trim();
		const [h, min, s] = m[2].split(":").map(Number);
		const dt = new Date(sessionDate);
		dt.setHours(h, min, s, 0);
		const { kind, token } = parseFollowLabel(rawLabel);
		events.push({ label: rawLabel, ts: dt.getTime() / 1000, kind, token });
	}
	return events;
}
