"use strict";

const _OVERVIEW_FOLLOW_FIELDS = [
	"follow",
	...LANG_FOLLOW_KEYS.map((k) => k.key),
];

function _overviewParseSheetFollow(ws) {
	const out = new Map();
	if (!ws) return out;
	const { rows, hdr } = remarksSheetTable(ws);
	const iId = hdr.findIndex((h) => /^(student.?id|id)$/i.test(h));
	const iScore = remarksScoreCols(hdr).pct;
	if (iId === -1 || iScore === -1) return out;
	const langCols = remarksLangCols(hdr).filter(
		(c) =>
			c.pct !== -1 && _OVERVIEW_FOLLOW_FIELDS.includes(`follow_${c.key}`),
	);
	for (let r = 1; r < rows.length; r++) {
		const row = rows[r] || [];
		const id = String(row[iId] || "")
			.trim()
			.toLowerCase();
		if (!id) continue;
		const f = parseFloat(row[iScore]);
		const rec = { follow: isNaN(f) ? null : f };
		for (const c of langCols) {
			const v = parseFloat(row[c.pct]);
			rec[`follow_${c.key}`] = isNaN(v) ? null : v;
		}
		out.set(id, rec);
	}
	return out;
}

function _overviewParseBasisFollow(buf) {
	const byTopic = new Map();
	let wb;
	try {
		wb = XLSX.read(buf, { type: "array" });
	} catch {
		return byTopic;
	}
	const names = wb.SheetNames || [];
	if (names.length > 1) {
		for (const name of names) {
			const m = _overviewParseSheetFollow(wb.Sheets[name]);
			if (m.size) byTopic.set(_overviewNorm(name), m);
		}
	}
	if (!byTopic.size) {
		const ws = wb.Sheets["Remarks"] || wb.Sheets[names[0]];
		const m = _overviewParseSheetFollow(ws);
		if (m.size) byTopic.set("", m);
	}
	return byTopic;
}

async function _overviewDetectBasisFiles() {
	_basisFiles = new Map();
	if (!_overviewDs || typeof REMARKS_BASES === "undefined") {
		return;
	}
	const byTopic = new Map();
	const add = (topic, file) => {
		if (!topic) return;
		if (!byTopic.has(topic)) byTopic.set(topic, []);
		byTopic.get(topic).push(file);
	};

	if (_overviewDs.files) {
		for (const grp of ["lessons", "assignments"]) {
			const re = new RegExp(
				String.raw`^${grp}/([^/]+)/(?:excels/)?remarks_[^/]*\.xlsx$`,
			);
			for (const [path, file] of _overviewDs.files) {
				const m = path.match(re);
				if (m) add(m[1], file);
			}
		}
	}

	if (typeof listServerDir === "function") {
		for (const grp of ["lessons", "assignments"]) {
			let topics;
			try {
				topics = await listServerDir(`/grades-data/${grp}/`);
			} catch {
				continue;
			}
			for (const t of topics || []) {
				if (!t || t.kind !== "directory" || !t.name) continue;
				for (const sub of [
					`${grp}/${t.name}/`,
					`${grp}/${t.name}/excels/`,
				]) {
					let files;
					try {
						files = await listServerDir(`/grades-data/${sub}`);
					} catch {
						continue;
					}
					for (const e of files || []) {
						if (!e || e.kind === "directory" || !e.name) continue;
						if (!remarksBasisOf(e.name)) continue;
						const url = new URL(
							`/grades-data/${sub}${e.name}`,
							location.href,
						).href;
						add(t.name.toLowerCase(), new HttpFileLike(url, e.name));
					}
				}
			}
		}
	}

	for (const [topic, files] of byTopic) {
		for (const [key, file] of pickRemarksFiles(files).basisFiles) {
			if (!_basisFiles.has(key)) _basisFiles.set(key, new Map());
			_basisFiles.get(key).set(topic, file);
		}
	}
}

function _overviewCaptureFollowSnapshot() {
	_baseFollowSnapshot = new Map();
	for (const s of _students) {
		const perTopic = {};
		for (const l of s.lessons) {
			const v = {};
			for (const k of _OVERVIEW_FOLLOW_FIELDS) v[k] = l[k];
			perTopic[l.name] = v;
		}
		_baseFollowSnapshot.set(s.id, perTopic);
	}
}

function _overviewRestoreFollowSnapshot() {
	if (!_baseFollowSnapshot) return;
	for (const s of _students) {
		const snap = _baseFollowSnapshot.get(s.id);
		if (!snap) continue;
		for (const l of s.lessons) {
			const v = snap[l.name];
			if (!v) continue;
			for (const k of _OVERVIEW_FOLLOW_FIELDS) l[k] = v[k];
		}
	}
}

function _overviewRecomputeParticipation() {
	if (typeof COL !== "undefined" && COL.participation != null) return;
	for (const s of _students) {
		const fs = s.lessons
			.filter((l) => l.hasFollowCol && l.follow != null)
			.map((l) => l.follow);
		s.participation = fs.length
			? fs.reduce((a, b) => a + b, 0) / fs.length
			: null;
	}
}

function _overviewNorm(s) {
	return String(s || "")
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "");
}

async function _overviewApplyBasis(key) {
	_overviewRestoreFollowSnapshot();
	const byTopic = _basisFiles.get(key);
	if (byTopic) {
		const byTopicById = new Map();
		await Promise.all(
			[...byTopic.entries()].map(async ([folder, f]) => {
				try {
					const buf = await readFileArray(f);
					const parsed = _overviewParseBasisFollow(buf);
					for (const [tn, m] of parsed) {
						byTopicById.set(tn || _overviewNorm(folder), m);
					}
				} catch (e) {}
			}),
		);
		for (const s of _students) {
			const sid = String(s.id).toLowerCase();
			for (const l of s.lessons) {
				const m = byTopicById.get(_overviewNorm(l.name));
				if (!m) continue;
				const rec = m.get(sid);
				if (!rec) continue;
				Object.assign(l, rec);
			}
		}
	}
	_activeBasis = key;
	_overviewRecomputeParticipation();
	if (_students.length) {
		renderTable();
		renderStats();
		renderClusters();
	}
}

async function _overviewRenderBasisPicker() {
	try {
		const container = document.getElementById("basis-picker");
		if (!container) return;
		await _overviewDetectBasisFiles();
		const chosen = renderBasisSelect(
			container,
			_basisFiles,
			defaultBasis(_basisFiles),
			_overviewApplyBasis,
			{ labelClass: "toolbar-check", selectClass: "tb-select" },
		);
		if (chosen) _overviewApplyBasis(chosen);
	} catch (e) {}
}
