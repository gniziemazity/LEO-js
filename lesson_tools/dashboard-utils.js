"use strict";

function lowerBound(arr, val, key) {
	let lo = 0,
		hi = arr.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (key(arr[mid]) < val) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}
function upperBound(arr, val, key) {
	let lo = 0,
		hi = arr.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (key(arr[mid]) <= val) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}
function charsAt(ts_secs, cum) {
	return upperBound(cum, ts_secs, (c) => c.ts);
}

function fmtTime(ts) {
	const d = new Date(ts * 1000);
	return [d.getHours(), d.getMinutes(), d.getSeconds()]
		.map((n) => String(n).padStart(2, "0"))
		.join(":");
}

function niceStep(max, steps) {
	const rough = max / steps,
		mag = Math.pow(10, Math.floor(Math.log10(rough))),
		n = rough / mag;
	return Math.max(1, (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag);
}

function rotatedLabel(ctx, x, y, text, color) {
	ctx.save();
	ctx.translate(x, y);
	ctx.rotate(-Math.PI / 2);
	ctx.textAlign = "center";
	ctx.fillStyle = color;
	ctx.font = "11px Segoe UI";
	ctx.fillText(text, 0, 0);
	ctx.restore();
}

function showLoading(on) {
	document.getElementById("loading").style.display = on ? "flex" : "none";
}

function resolveInteractionStudent(field) {
	if (typeof field === "number") {
		return _studentIdMap?.[field] || null;
	}
	if (typeof field === "string") {
		const trimmed = field.trim();
		if (!trimmed) return null;
		const asNum = Number(trimmed);
		if (Number.isInteger(asNum) && String(asNum) === trimmed) {
			return _studentIdMap?.[asNum] || null;
		}
		return trimmed;
	}
	return null;
}

function resolveInteractionStudentDisplay(field) {
	const name = resolveInteractionStudent(field);
	if (name) return name;
	if (typeof field === "number") return `ID ${field}`;
	if (typeof field === "string") {
		const trimmed = field.trim();
		const asNum = Number(trimmed);
		if (Number.isInteger(asNum) && String(asNum) === trimmed)
			return `ID ${asNum}`;
		return trimmed;
	}
	return "";
}
