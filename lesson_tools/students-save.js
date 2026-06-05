"use strict";

let _saveInFlight = false;

function _detectTimestampFormat(name) {
	if (/_\d{8}-\d{6}\.xlsx$/i.test(name)) return "datetime";
	if (/_\d{10,}\.xlsx$/i.test(name)) return "unix";
	return "unix";
}

function _stripTimestamp(name) {
	return name
		.replace(/_\d{8}-\d{6}\.xlsx$/i, "")
		.replace(/_\d{10,}\.xlsx$/i, "")
		.replace(/\.xlsx$/i, "");
}

function _formatTimestamp(fmt, d = new Date()) {
	if (fmt === "unix") return String(Math.floor(d.getTime() / 1000));
	const pad = (n, w = 2) => String(n).padStart(w, "0");
	return (
		String(d.getFullYear()) +
		pad(d.getMonth() + 1) +
		pad(d.getDate()) +
		"-" +
		pad(d.getHours()) +
		pad(d.getMinutes()) +
		pad(d.getSeconds())
	);
}

function _buildSaveName(origName) {
	const base = _stripTimestamp(origName);
	const fmt = _detectTimestampFormat(origName);
	return `${base}_${_formatTimestamp(fmt)}.xlsx`;
}

function _setDirty(studentId, colName, value) {
	if (!studentId) return;
	const key = `${studentId}::${colName}`;
	_dirtyEdits.set(key, { studentId, colName, value });
	_updateSaveButton();
}

function _applyDirtyToStudents() {
	if (!_dirtyEdits.size) return;
	const byId = new Map();
	for (const s of _students) if (s.id) byId.set(s.id, s);
	for (const { studentId, colName, value } of _dirtyEdits.values()) {
		const s = byId.get(studentId);
		if (!s) continue;
		const r = (s.remarks || []).find((x) => x.col === colName);
		if (r) {
			r.val = value;
		} else if (s.remarks) {
			s.remarks.push({ col: colName, val: value, note: "" });
		}
	}
}

function _updateSaveButton() {
	const btn = document.getElementById("save-btn");
	if (!btn) return;
	const hasEdits = _dirtyEdits.size > 0;
	btn.disabled = !hasEdits || _saveInFlight;
	btn.textContent = _saveInFlight
		? "Saving…"
		: hasEdits
			? `💾 Save (${_dirtyEdits.size})`
			: "💾 Save";
	if (_activeBasisFileName) {
		const newName = hasEdits ? _buildSaveName(_activeBasisFileName) : "";
		btn.title = hasEdits
			? `Save edits to a new file: ${newName}\n(original ${_activeBasisFileName} stays untouched)`
			: `No edits. Will save to ${_activeBasisFileName} family when there are changes.`;
	}
}

function _xmlEscape(s) {
	return String(s).replace(/[&<>"]/g, (c) =>
		c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
	);
}

function _xmlSpaceAttr(s) {
	return /^\s|\s$|\n/.test(s) ? ' xml:space="preserve"' : "";
}

function _colLettersToNum(letters) {
	let n = 0;
	for (let i = 0; i < letters.length; i++) {
		n = n * 26 + (letters.charCodeAt(i) - 64);
	}
	return n;
}

function _splitCellRef(ref) {
	const m = /^([A-Z]+)(\d+)$/.exec(ref);
	if (!m) return null;
	return {
		col: m[1],
		colNum: _colLettersToNum(m[1]),
		row: Number(m[2]),
	};
}

function _findSheetTarget(workbookXml, relsXml, sheetName) {
	const sheetTagRe = /<sheet\b[^>]*\/?>/g;
	let m;
	let relId = null;
	while ((m = sheetTagRe.exec(workbookXml)) !== null) {
		const tag = m[0];
		const nm = tag.match(/\bname="([^"]+)"/);
		if (!nm || nm[1] !== sheetName) continue;
		const im = tag.match(/\b[A-Za-z][A-Za-z0-9]*:id="([^"]+)"/);
		if (!im) continue;
		relId = im[1];
		break;
	}
	if (!relId) return null;
	const relRe = new RegExp(
		`<Relationship\\b[^>]*\\bId="${relId}"[^>]*\\bTarget="([^"]+)"`,
	);
	const altRelRe = new RegExp(
		`<Relationship\\b[^>]*\\bTarget="([^"]+)"[^>]*\\bId="${relId}"`,
	);
	const rm = relsXml.match(relRe) || relsXml.match(altRelRe);
	if (!rm) return null;
	let target = rm[1];
	if (target.startsWith("/")) return target.slice(1);
	if (target.startsWith("xl/")) return target;
	return "xl/" + target;
}

function _patchSheetXml(xml, edits) {
	const byRow = new Map();
	for (const e of edits) {
		const p = _splitCellRef(e.ref);
		if (!p) continue;
		if (!byRow.has(p.row)) byRow.set(p.row, []);
		byRow.get(p.row).push({ ...e, colNum: p.colNum });
	}

	for (const [rowNum, rowEdits] of byRow) {
		const rowRe = new RegExp(
			`(<row\\b[^>]*\\br="${rowNum}"[^>]*>)([\\s\\S]*?)(</row>)`,
		);
		const found = rowRe.test(xml);
		if (!found) continue;
		xml = xml.replace(rowRe, (_m, open, body, close) => {
			let newBody = body;
			for (const e of rowEdits) {
				const cellRe = new RegExp(
					`<c\\s[^>]*\\br="${e.ref}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`,
				);
				const existing = newBody.match(cellRe);
				let styleAttr = "";
				if (existing) {
					const sm = existing[0].match(/\bs="(\d+)"/);
					if (sm) styleAttr = ` s="${sm[1]}"`;
				}
				const v = String(e.value == null ? "" : e.value);
				const numMatch = !e.forceString && /^-?\d+(?:[.,]\d+)?$/.test(v);
				let newCell;
				if (v === "") {
					newCell = `<c r="${e.ref}"${styleAttr}/>`;
				} else if (numMatch) {
					newCell = `<c r="${e.ref}"${styleAttr}><v>${v.replace(",", ".")}</v></c>`;
				} else {
					newCell = `<c r="${e.ref}"${styleAttr} t="inlineStr"><is><t${_xmlSpaceAttr(v)}>${_xmlEscape(v)}</t></is></c>`;
				}
				if (existing) {
					newBody = newBody.replace(cellRe, newCell);
				} else {
					let inserted = false;
					newBody = newBody.replace(
						/<c\b[^>]*\br="([A-Z]+)\d+"[^>]*(?:\/>|>[\s\S]*?<\/c>)/g,
						(cm, ccol) => {
							if (inserted) return cm;
							const n = _colLettersToNum(ccol);
							if (n > e.colNum) {
								inserted = true;
								return newCell + cm;
							}
							return cm;
						},
					);
					if (!inserted) newBody += newCell;
				}
			}
			return open + newBody + close;
		});
	}
	return xml;
}

async function _saveActiveBasis() {
	if (_saveInFlight) return;
	if (!_dirtyEdits.size) return;
	if (!_dirHandle) {
		alert("No folder is open.");
		return;
	}
	if (!_activeBasisFile || !_activeBasisFileName) {
		alert("No active spreadsheet to save.");
		return;
	}
	try {
		const perm = await _dirHandle.requestPermission({ mode: "readwrite" });
		if (perm !== "granted") {
			alert("Write permission denied for the folder.");
			return;
		}
	} catch (e) {
		alert("Could not request write permission: " + e.message);
		return;
	}

	_saveInFlight = true;
	_updateSaveButton();
	try {
		const origBuf = new Uint8Array(await _activeBasisFile.arrayBuffer());
		const zip = await miniZipParse(origBuf);

		const td = new TextDecoder("utf-8");
		const te = new TextEncoder();

		const workbookBytes = zip.files.get("xl/workbook.xml");
		const relsBytes = zip.files.get("xl/_rels/workbook.xml.rels");
		if (!workbookBytes || !relsBytes) {
			throw new Error("xlsx missing workbook.xml or its rels");
		}
		const workbookXml = td.decode(workbookBytes);
		const relsXml = td.decode(relsBytes);

		const sheetPath = _findSheetTarget(
			workbookXml,
			relsXml,
			_activeSheetName,
		);
		if (!sheetPath || !zip.files.get(sheetPath)) {
			const names = Array.from(
				workbookXml.matchAll(/<sheet\b[^>]*\bname="([^"]+)"/g),
			)
				.map((mm) => mm[1])
				.join(", ");
			throw new Error(
				`Sheet "${_activeSheetName}" not found in workbook (sheets present: ${names || "(none)"})`,
			);
		}

		const byId = new Map();
		for (const s of _baseStudents || _students) {
			if (s.id) byId.set(s.id, s);
		}

		const edits = [];
		for (const { studentId, colName, value } of _dirtyEdits.values()) {
			const s = byId.get(studentId);
			if (!s || s._rowIndex == null) continue;
			const c = _activeRemarkColIdx[colName];
			if (c == null) continue;
			edits.push({
				ref: XLSX.utils.encode_cell({ r: s._rowIndex, c }),
				value: value,
				forceString: OBS_COL_RE.test(colName),
			});
		}

		const sheetXml = td.decode(zip.files.get(sheetPath));
		const patchedXml = _patchSheetXml(sheetXml, edits);
		zip.files.set(sheetPath, te.encode(patchedXml));

		const outBytes = await miniZipBuild(zip.files, zip.order);

		const newName = _buildSaveName(_activeBasisFileName);
		const fileHandle = await _dirHandle.getFileHandle(newName, {
			create: true,
		});
		const writable = await fileHandle.createWritable();
		await writable.write(outBytes);
		await writable.close();

		_dirtyEdits.clear();
		const newFile = await fileHandle.getFile();
		_activeBasisFile = newFile;
		_activeBasisFileName = newName;
		if (_activeBasis) _basisFiles.set(_activeBasis, newFile);
		else if (_basisFallbackFile) _basisFallbackFile = newFile;
		_allFiles.set(newName.toLowerCase(), newFile);
		_updateSaveButton();
		document.querySelectorAll("#tbody td.dirty").forEach((el) => {
			el.classList.remove("dirty");
		});
		_snapshotOrigObs(_students);
		document.querySelectorAll("#tbody td.artefact-changed").forEach((el) => {
			el.classList.remove("artefact-changed");
		});
		alert(`Saved ${edits.length} edit(s) to ${newName}.`);
	} catch (ex) {
		console.error("[Students] save failed", ex);
		alert("Save failed: " + ex.message);
	} finally {
		_saveInFlight = false;
		_updateSaveButton();
	}
}
