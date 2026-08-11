"use strict";

function _sortKeyOf(s, sortCol) {
	if (sortCol === "id") return { type: "str", v: s.id || "" };
	if (sortCol === "name") return { type: "str", v: s.name || "" };
	if (sortCol === "num") return { type: "str", v: s.num || "" };
	if (sortCol === "follow") return { type: "num", v: s.followPct };
	if (sortCol === "int")
		return {
			type: "num",
			v: (s.total_a || 0) + (s.total_q || 0) + (s.total_h || 0),
		};
	if (sortCol === "fingerprint1")
		return { type: "str", v: s._fpMask ? _maskToBytes(s._fpMask) : "" };
	if (sortCol === "fingerprint2") return { type: "num", v: s._fp2Count };
	if (sortCol === "fingerprint3") return { type: "num", v: s._fp3Count };
	if (sortCol.startsWith("lang:")) {
		const k = sortCol.slice(5);
		const v = s.langPcts ? s.langPcts[k] : undefined;
		return { type: "num", v: v == null ? NaN : v };
	}
	if (sortCol.startsWith("artefact:")) {
		const idx = parseInt(sortCol.slice("artefact:".length), 10);
		const r = (s.remarks || []).find((x) => OBS_COL_RE.test(x.col));
		const code = r && r.val ? String(r.val).trim() : "";
		const fired = ARTEFACT_CODE_RE.test(code) && code[idx] === "1" ? 1 : 0;
		return { type: "num", v: fired };
	}
	if (sortCol.startsWith("remark:")) {
		const col = sortCol.slice(7);
		const r = (s.remarks || []).find((x) => x.col === col);
		return { type: "str", v: r ? r.val || "" : "" };
	}
	return { type: "str", v: "" };
}

function _sortStudents(students, sortCol, sortDir) {
	const dir = sortDir === "desc" ? -1 : 1;
	const idCmp = (a, b) =>
		String(a.id || "").localeCompare(String(b.id || ""), undefined, {
			numeric: true,
		});
	return [...students].sort((a, b) => {
		const ka = _sortKeyOf(a, sortCol);
		const kb = _sortKeyOf(b, sortCol);
		let c;
		if (ka.type === "num") {
			const aN = ka.v == null || isNaN(ka.v);
			const bN = kb.v == null || isNaN(kb.v);
			if (aN && bN) c = 0;
			else if (aN) return 1;
			else if (bN) return -1;
			else c = ka.v - kb.v;
		} else {
			const aE = !ka.v;
			const bE = !kb.v;
			if (aE && bE) c = 0;
			else if (aE) return 1;
			else if (bE) return -1;
			else
				c = String(ka.v).localeCompare(String(kb.v), undefined, {
					numeric: true,
				});
		}
		if (c === 0) return idCmp(a, b);
		return c * dir;
	});
}

function _onSortHeaderClick(sortKey) {
	if (_sortCol === sortKey) {
		_sortDir = _sortDir === "asc" ? "desc" : "asc";
	} else {
		_sortCol = sortKey;
		_sortDir = "asc";
	}
	renderTable();
}
