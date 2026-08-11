"use strict";

const ARTEFACT_CODE_RE = /^[01]+$/;

const ARTEFACT_SEVERITY_COLORS = {
	high: () => THEME.red,
	medium: () => THEME.orange,
	med: () => THEME.orange,
	low: () => THEME.yellow,
};

function artefactFiredColorFor(severity) {
	const key = String(severity || "")
		.trim()
		.toLowerCase();
	const fn = ARTEFACT_SEVERITY_COLORS[key] || ARTEFACT_SEVERITY_COLORS.high;
	return fn();
}

function artefactBitColor(fired, entry) {
	return fired
		? artefactFiredColorFor((entry && entry.severity) || "high")
		: THEME.artefactOk;
}

function isArtefactPattern(raw) {
	const s = (raw ?? "").trim();
	return s.length > 0 && ARTEFACT_CODE_RE.test(s);
}

function artefactCodeHtml(code) {
	return escHtml(String(code)).replace(/_(\w+)/g, "<sub>$1</sub>");
}

function buildArtefactSchemaTipHtml(schema) {
	return (schema || [])
		.map(
			(e) =>
				`${artefactCodeHtml(String(e.code || e.key || "?"))}: ${escHtml(e.label || "")}`,
		)
		.join("<br>");
}

function renderArtefactBadges(raw, schema) {
	const code = (raw ?? "").trim();
	if (!isArtefactPattern(code)) return null;
	const schemaArr = Array.isArray(schema) ? schema : [];
	return code
		.split("")
		.map((ch, i) => {
			const clr = artefactBitColor(ch === "1", schemaArr[i]);
			return (
				`<span style="display:inline-block;` +
				`width:14px;height:14px;border-radius:2px;margin:0 1px;` +
				`vertical-align:middle;background:${clr}"></span>`
			);
		})
		.join("");
}

function renderArtefactTotals(counts, schema) {
	const schemaArr = Array.isArray(schema) ? schema : [];
	const n = Math.max((counts || []).length, schemaArr.length);
	if (!n) return "";
	const parts = [];
	for (let i = 0; i < n; i++) {
		const count = (counts && counts[i]) || 0;
		const clr = artefactBitColor(count > 0, schemaArr[i]);
		parts.push(
			`<span style="display:inline-block;` +
				`min-width:14px;height:14px;border-radius:2px;margin:0 1px;` +
				`vertical-align:middle;background:${clr};color:white;` +
				`font-size:10px;font-weight:bold;text-align:center;` +
				`line-height:14px;padding:0 2px">${count}</span>`,
		);
	}
	return parts.join("");
}

function renderArtefactCellSquare(fired, entry) {
	const clr = artefactBitColor(fired, entry);
	return (
		`<span style="display:inline-block;width:14px;height:14px;` +
		`border-radius:2px;vertical-align:middle;background:${clr}"></span>`
	);
}

function renderArtefactTotalOne(count, entry) {
	const clr = artefactBitColor(count > 0, entry);
	return (
		`<span style="display:inline-block;min-width:14px;height:14px;` +
		`border-radius:2px;vertical-align:middle;background:${clr};color:white;` +
		`font-size:10px;font-weight:bold;text-align:center;line-height:14px;` +
		`padding:0 2px">${count}</span>`
	);
}

function buildArtefactSummaryHtml(raw, schema) {
	const code = (raw ?? "").trim();
	if (!isArtefactPattern(code)) return "";
	const schemaArr = Array.isArray(schema) ? schema : [];
	const sq = (clr) =>
		`<span style="display:inline-block;width:11px;height:11px;border-radius:2px;` +
		`vertical-align:middle;margin-right:6px;background:${clr}"></span>`;
	const lines = [];
	const n = Math.max(code.length, schemaArr.length);
	for (let i = 0; i < n; i++) {
		const entry = schemaArr[i];
		const fired = code[i] === "1";
		const label = entry && entry.label ? entry.label : `bit ${i + 1}`;
		const entryCode = entry && (entry.code || entry.key);
		const codeHtml = entryCode ? `${artefactCodeHtml(entryCode)}: ` : "";
		const clr = artefactBitColor(fired, entry);
		const style = fired ? "font-weight:bold" : `color:${THEME.muted}`;
		lines.push(
			`<div style="${style}">${sq(clr)}${codeHtml}${escHtml(label)}</div>`,
		);
	}
	return lines.join("");
}

function countArtefactColumn(codes) {
	const counts = [];
	for (const code of codes) {
		if (!ARTEFACT_CODE_RE.test(code)) continue;
		for (let i = 0; i < code.length; i++) {
			counts[i] = (counts[i] || 0) + (code[i] === "1" ? 1 : 0);
		}
	}
	return counts;
}

function parseArtefactLabelsCsv(text) {
	const { header, rows } = parseCsv(text);
	const keyIdx = header.findIndex((h) => /^key$/i.test(h));
	const labelIdx = header.findIndex((h) => /^label$/i.test(h));
	const codeIdx = header.findIndex((h) => /^code$/i.test(h));
	const sevIdx = header.findIndex((h) => /^severity$/i.test(h));
	if (keyIdx === -1 || labelIdx === -1) return [];
	const out = [];
	for (const parts of rows) {
		const key = parts[keyIdx];
		const label = parts[labelIdx];
		if (!key || !label) continue;
		const severity =
			sevIdx !== -1 ? (parts[sevIdx] || "").trim().toLowerCase() : "high";
		const code = codeIdx !== -1 ? (parts[codeIdx] || "").trim() : "";
		out.push({ key, label, code, severity: severity || "high" });
	}
	return out;
}

async function loadArtefactLabelsFromHandle(dirHandle) {
	if (!dirHandle) return [];
	try {
		const fh = await dirHandle.getFileHandle("artefact_labels.csv");
		const file = await fh.getFile();
		return parseArtefactLabelsCsv(await readFileText(file));
	} catch {
		return [];
	}
}

function loadArtefactLabelsFromFileMap(fileMap) {
	if (!fileMap) return null;
	for (const [k, file] of fileMap) {
		if (k.endsWith("/artefact_labels.csv") || k === "artefact_labels.csv") {
			return file;
		}
	}
	return null;
}
