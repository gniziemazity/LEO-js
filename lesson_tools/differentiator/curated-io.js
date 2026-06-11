"use strict";

function _curatedBackfillTimestamps(teacherFiles, studentFiles) {
	const leoStar = _allMarks[""];
	if (!leoStar) return;
	const tsByPos = new Map();
	const remTsByPos = new Map();
	for (const [file, entries] of Object.entries(
		leoStar.teacher_token_timestamps || {},
	)) {
		for (const e of entries || []) {
			tsByPos.set(`${file}|${e.start}|${e.end}`, e.ts);
		}
	}
	for (const [file, marks] of Object.entries(leoStar.teacher_files || {})) {
		for (const m of marks || []) {
			if (m.label === "missing" && m.timestamp) {
				const k = `${file}|${m.start}|${m.end}`;
				if (!tsByPos.has(k)) tsByPos.set(k, m.timestamp);
			}
		}
	}
	for (const [file, marks] of Object.entries(leoStar.student_files || {})) {
		for (const m of marks || []) {
			if (m.label === "ghost_extra" && m.removal_ts) {
				remTsByPos.set(
					`${file}|${m.token}|${m.start}|${m.end}`,
					m.removal_ts,
				);
			}
		}
	}
	for (const [file, marks] of Object.entries(teacherFiles || {})) {
		for (const m of marks || []) {
			if (m.label !== "missing" || m.timestamp) continue;
			const ts = tsByPos.get(`${file}|${m.start}|${m.end}`);
			if (ts) m.timestamp = ts;
		}
	}
	for (const [file, marks] of Object.entries(studentFiles || {})) {
		for (const m of marks || []) {
			if (m.label !== "ghost_extra" || m.removal_ts) continue;
			const ts = remTsByPos.get(`${file}|${m.token}|${m.start}|${m.end}`);
			if (ts) m.removal_ts = ts;
		}
	}
}

function _curatedBuildJson() {
	const matching = _diffMode === "minimal" ? "minimal" : "ideal";
	const t = _curatedMarks() || {
		token_matching: matching,
		teacher_files: {},
		student_files: {},
	};
	const teacherFiles = _deepClone(t.teacher_files || {});
	const studentFiles = _deepClone(t.student_files || {});
	_curatedBackfillTimestamps(teacherFiles, studentFiles);
	const out = {
		token_matching: matching,
		teacher_files: teacherFiles,
		student_files: studentFiles,
	};
	if (t.file_pairs && Object.keys(t.file_pairs).length) {
		out.file_pairs = { ...t.file_pairs };
	}
	return JSON.stringify(out, null, 2) + "\n";
}

function _curatedDownload() {
	const json = _curatedBuildJson();
	const blob = new Blob([json], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download =
		_diffMode === "minimal"
			? "diff_marks_minimal.json"
			: "diff_marks_ideal.json";
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}

function _curatedFlashButton(id, label) {
	const btn = document.getElementById(id);
	if (!btn) return;
	const orig = btn.textContent;
	btn.textContent = label;
	btn.classList.add("active");
	setTimeout(() => {
		btn.textContent = orig;
		btn.classList.remove("active");
	}, 900);
}

function _curatedCopyToClipboard() {
	const json = _curatedBuildJson();
	const done = () => _curatedFlashButton("btn-copy-curated", "✓ Copied");
	const fail = () => _curatedFlashButton("btn-copy-curated", "✖ Failed");
	if (navigator.clipboard && navigator.clipboard.writeText) {
		navigator.clipboard.writeText(json).then(done).catch(fail);
		return;
	}
	const ta = document.createElement("textarea");
	ta.value = json;
	ta.style.position = "fixed";
	ta.style.left = "-9999px";
	document.body.appendChild(ta);
	ta.focus();
	ta.select();
	let ok = false;
	try {
		ok = document.execCommand("copy");
	} catch {}
	ta.remove();
	if (ok) done();
	else fail();
}
