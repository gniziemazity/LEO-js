"use strict";

const _OVERVIEW_BASIS_LANG = [
	{ key: "follow_html", header: "HTML (E)" },
	{ key: "follow_css", header: "CSS (E)" },
	{ key: "follow_js", header: "JS (E)" },
];

function _overviewParseSheetFollow(ws) {
	const out = new Map();
	if (!ws) return out;
	const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
	const hdr = (rows[0] || []).map((h) => String(h || "").trim());
	const iId = hdr.findIndex((h) => /^(student.?id|id)$/i.test(h));
	let iScore = hdr.indexOf("Follow (E)");
	if (iScore === -1) iScore = hdr.indexOf("Similarity");
	if (iId === -1 || iScore === -1) return out;
	const langIdx = {};
	for (const def of _OVERVIEW_BASIS_LANG) {
		const i = hdr.indexOf(def.header);
		if (i !== -1) langIdx[def.key] = i;
	}
	for (let r = 1; r < rows.length; r++) {
		const row = rows[r] || [];
		const id = String(row[iId] || "")
			.trim()
			.toLowerCase();
		if (!id) continue;
		const f = parseFloat(row[iScore]);
		const rec = { follow: isNaN(f) ? null : f };
		for (const def of _OVERVIEW_BASIS_LANG) {
			if (langIdx[def.key] != null) {
				const v = parseFloat(row[langIdx[def.key]]);
				rec[def.key] = isNaN(v) ? null : v;
			}
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
	const validKeys = new Set(REMARKS_BASES.map((b) => b.key));
	const seen = new Set();
	const add = (topic, key, file) => {
		if (!validKeys.has(key) || !topic) return;
		const sk = `${key}|${topic}`;
		if (seen.has(sk)) return;
		seen.add(sk);
		if (!_basisFiles.has(key)) _basisFiles.set(key, new Map());
		_basisFiles.get(key).set(topic, file);
	};

	if (_overviewDs.files) {
		for (const grp of ["lessons", "assignments"]) {
			const re = new RegExp(
				`^${grp}/([^/]+)/(?:excels/)?remarks_([a-z0-9_]+)\\.xlsx$`,
			);
			for (const [path, file] of _overviewDs.files) {
				const m = path.match(re);
				if (m) add(m[1], m[2], file);
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
						const mm = e.name
							.toLowerCase()
							.match(/^remarks_([a-z0-9_]+)\.xlsx$/);
						if (!mm) continue;
						const url = new URL(
							`/grades-data/${sub}${e.name}`,
							location.href,
						).href;
						add(
							t.name.toLowerCase(),
							mm[1],
							new HttpFileLike(url, e.name),
						);
					}
				}
			}
		}
	}
}

function _overviewCaptureFollowSnapshot() {
	_baseFollowSnapshot = new Map();
	for (const s of _students) {
		const perTopic = {};
		for (const l of s.lessons) {
			perTopic[l.name] = {
				follow: l.follow,
				follow_html: l.follow_html,
				follow_css: l.follow_css,
				follow_js: l.follow_js,
			};
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
			l.follow = v.follow;
			l.follow_html = v.follow_html;
			l.follow_css = v.follow_css;
			l.follow_js = v.follow_js;
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
		let nOverlaid = 0;
		for (const s of _students) {
			const sid = String(s.id).toLowerCase();
			for (const l of s.lessons) {
				const m = byTopicById.get(_overviewNorm(l.name));
				if (!m) continue;
				const rec = m.get(sid);
				if (!rec) continue;
				if ("follow" in rec) l.follow = rec.follow;
				if ("follow_html" in rec) l.follow_html = rec.follow_html;
				if ("follow_css" in rec) l.follow_css = rec.follow_css;
				if ("follow_js" in rec) l.follow_js = rec.follow_js;
				nOverlaid++;
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

		const options = [];
		if (typeof REMARKS_BASES !== "undefined") {
			for (const { key, label } of REMARKS_BASES) {
				if (_basisFiles.has(key)) options.push({ key, label });
			}
		}
		if (!options.length) {
			container.innerHTML = "";
			return;
		}
		_overviewBuildBasisSelect(container, options);
	} catch (e) {}
}

function _overviewBuildBasisSelect(container, options) {
	let chosen = null;
	for (const k of ["ideal", "leo_star"]) {
		if (_basisFiles.has(k)) {
			chosen = k;
			break;
		}
	}
	if (!chosen) chosen = options[0].key;

	container.innerHTML = "";
	const label = document.createElement("label");
	label.className = "toolbar-check";
	label.appendChild(document.createTextNode("Basis:"));
	const select = document.createElement("select");
	select.id = "basis-select";
	select.className = "tb-select";
	for (const { key, label: lbl } of options) {
		const opt = document.createElement("option");
		opt.value = key;
		opt.textContent = lbl;
		select.appendChild(opt);
	}
	select.value = chosen;
	const syncCurated = () =>
		select.classList.toggle(
			"is-curated",
			select.value === "ideal" || select.value === "minimal",
		);
	syncCurated();
	select.addEventListener("change", () => {
		syncCurated();
		_overviewApplyBasis(select.value);
	});
	label.appendChild(select);
	container.appendChild(label);

	_overviewApplyBasis(chosen);
}
