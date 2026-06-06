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

function _tlNiceStep(max, steps) {
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
		return _realToAlterMap?.[trimmed] || trimmed;
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

function _interactionStudentId(field) {
	if (typeof field === "number") return String(field);
	if (typeof field === "string") {
		const trimmed = field.trim();
		const asNum = Number(trimmed);
		if (Number.isInteger(asNum) && String(asNum) === trimmed)
			return String(asNum);
		if (_studentIdMap) {
			for (const [id, name] of Object.entries(_studentIdMap)) {
				if (name === trimmed) return String(id);
			}
		}
	}
	return null;
}

function _isMistakeEvent(e) {
	return e.ts != null && (e.kind === "missing" || e.kind === "extra-star");
}

function _mistakeEventsFor(s) {
	return (s.follow_events || []).filter(_isMistakeEvent);
}

function _jitterFor(name) {
	return _shake ? _jitterMap.get(name) || { dx: 0, dy: 0 } : { dx: 0, dy: 0 };
}

function _clampStudentY(s, jitter, L) {
	const minY = L.M.top + (L.plotHbotPad || 0);
	const maxY = L.M.top + L.plotHbot - (L.plotHbotPad || 0);
	return Math.max(minY, Math.min(maxY, studentY(s, L) + jitter.dy));
}

function _displayCodeInsert(t) {
	return (t || "").replace(/⚓[^⚓]*⚓/g, "").replace(/↩/g, "\n");
}

const _NBSP = " ";

function _clusterMistakes(evs, gap) {
	if (!evs || !evs.length) return [];
	const sorted = [...evs].sort((a, b) => a.ts - b.ts);
	const clusters = [[sorted[0]]];
	for (let i = 1; i < sorted.length; i++) {
		if (sorted[i].ts - sorted[i - 1].ts < gap) {
			clusters[clusters.length - 1].push(sorted[i]);
		} else {
			clusters.push([sorted[i]]);
		}
	}
	return clusters;
}

function _singletonToTextPart(ev) {
	if (ev._virtualType === "anchor")
		return { t: ev._target || "", type: "anchor" };
	if (ev._virtualType === "move") return { t: ev._target || "", type: "move" };
	if (ev._virtualType === "code_insert")
		return { t: ev.code_insert || "", type: "code_insert" };
	return { t: ev.char || "", type: "char" };
}

function resolveInteractionStudentDisplayWithId(field) {
	const name = resolveInteractionStudentDisplay(field);
	const id = _interactionStudentId(field);
	if (id && name && !name.startsWith(`ID ${id}`)) return `${id}. ${name}`;
	return name;
}
