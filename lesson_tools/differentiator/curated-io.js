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

function _curatedBuildJson(matchingOverride) {
	const matching =
		matchingOverride || (_diffMode === "minimal" ? "minimal" : "ideal");
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

function _curatedDownloadFile(fname, matching) {
	const json = _curatedBuildJson(matching);
	const blob = new Blob([json], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = fname;
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

function _curatedCopyText(text, btnId) {
	const done = () => _curatedFlashButton(btnId, "✓ Copied");
	const fail = () => _curatedFlashButton(btnId, "✖ Failed");
	if (navigator.clipboard && navigator.clipboard.writeText) {
		navigator.clipboard.writeText(text).then(done).catch(fail);
		return;
	}
	const ta = document.createElement("textarea");
	ta.value = text;
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

function _curatedCurrentSid() {
	if (typeof _navState === "undefined" || !_navState) return null;
	const { folders, currentIdx } = _navState;
	if (!Array.isArray(folders) || currentIdx == null || currentIdx < 0) {
		return null;
	}
	return folders[currentIdx] || null;
}

function _curatedActiveDataSource() {
	if (typeof _navState === "undefined" || !_navState) return null;
	return _navState.dataSource || null;
}

function _curatedLessonBaseUrl(ds, sid) {
	const pfx = `anon_ids/${String(sid).toLowerCase()}/`;
	for (const [rel, f] of ds.files) {
		if (!f || !f.url) continue;
		if (rel.startsWith(pfx) && rel.indexOf("/", pfx.length) === -1) {
			return f.url.replace(/\/anon_ids\/[^/]+\/[^/?#]*$/i, "");
		}
	}
	return null;
}

async function _curatedWriteServer(url, text) {
	const res = await fetch(url, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: text,
	});
	if (!res.ok) throw new Error(`Server write failed: ${res.status}`);
}

async function _curatedWriteFs(rootHandle, relParts, text) {
	let dir = rootHandle;
	for (let i = 0; i < relParts.length - 1; i++) {
		dir = await dir.getDirectoryHandle(relParts[i], { create: true });
	}
	const fh = await dir.getFileHandle(relParts[relParts.length - 1], {
		create: true,
	});
	const writable = await fh.createWritable();
	await writable.write(text);
	await writable.close();
}

async function _curatedSaveToFolder(fname, matching) {
	const ds = _curatedActiveDataSource();
	const sid = _curatedCurrentSid();
	if (!ds || !sid) {
		throw new Error(
			"Open a student from a course folder first — there is no target folder to save into.",
		);
	}
	const text = _curatedBuildJson(matching);

	if (ds.serverWritable) {
		const base = _curatedLessonBaseUrl(ds, sid);
		if (!base) {
			throw new Error("Could not locate the student folder on the server.");
		}
		await _curatedWriteServer(`${base}/anon_ids/${sid}/${fname}`, text);
		await _curatedWriteServer(`${base}/curated/${sid}/${fname}`, text);
		return `anon_ids/${sid}/ and curated/${sid}/`;
	}

	if (ds.rootHandle) {
		try {
			if (ds.rootHandle.requestPermission) {
				const perm = await ds.rootHandle.requestPermission({
					mode: "readwrite",
				});
				if (perm !== "granted") {
					throw new Error("Write permission denied for the folder.");
				}
			}
		} catch (e) {
			throw new Error("Could not get write permission: " + e.message);
		}
		await _curatedWriteFs(ds.rootHandle, ["anon_ids", sid, fname], text);
		await _curatedWriteFs(ds.rootHandle, ["curated", sid, fname], text);
		return `anon_ids/${sid}/ and curated/${sid}/`;
	}

	throw new Error("This dataset is read-only (no writable location).");
}

function _curatedResolveSaveName(basis, custom) {
	if (basis === "ideal") {
		return { fname: "diff_marks_ideal.json", matching: "ideal" };
	}
	if (basis === "minimal") {
		return { fname: "diff_marks_minimal.json", matching: "minimal" };
	}
	let n = String(custom || "").trim();
	n = n.replace(/\.json$/i, "").replace(/^diff_marks_/i, "");
	n = n.replace(/[^a-zA-Z0-9._-]/g, "");
	if (!n) return null;
	const matching = _diffMode === "minimal" ? "minimal" : "ideal";
	return { fname: `diff_marks_${n}.json`, matching };
}

function _curatedCloseSaveDialog() {
	if (typeof _curatedFloatWin !== "undefined" && _curatedFloatWin) {
		_curatedFloatWin.win.style.display = "none";
	}
}

function _curatedOpenSaveDialog() {
	if (typeof _embedMode !== "undefined" && _embedMode) return;
	const defaultBasis = _diffMode === "minimal" ? "minimal" : "ideal";

	const form = document.createElement("div");
	form.className = "csm-form";
	form.innerHTML = `
		<label>
			File
			<select id="csm-basis">
				<option value="ideal">ideal</option>
				<option value="minimal">minimal</option>
				<option value="custom">Custom…</option>
			</select>
		</label>
		<label id="csm-custom-row" style="display:none;">
			Differentiating part <span class="csm-hint">(diff_marks_&lt;name&gt;.json)</span>
			<input id="csm-custom" type="text" placeholder="name">
		</label>
		<div id="csm-status"></div>
		<div class="csm-actions">
			<button id="csm-copy" class="btn-edit">📋 Copy</button>
			<button id="csm-download" class="btn-edit">⬇ Download</button>
			<button id="csm-save" class="btn-edit">💾 Save</button>
		</div>`;

	const basisSel = form.querySelector("#csm-basis");
	const customRow = form.querySelector("#csm-custom-row");
	const customInp = form.querySelector("#csm-custom");
	const statusEl = form.querySelector("#csm-status");
	basisSel.value = defaultBasis;

	const syncCustom = () => {
		const isCustom = basisSel.value === "custom";
		customRow.style.display = isCustom ? "block" : "none";
		if (isCustom) customInp.focus();
	};
	basisSel.addEventListener("change", syncCustom);
	syncCustom();

	const showStatus = (msg, ok) => {
		statusEl.style.display = "block";
		statusEl.textContent = msg;
		statusEl.style.color = ok ? "var(--clr-green)" : "var(--clr-red)";
	};

	const resolve = () => {
		const r = _curatedResolveSaveName(basisSel.value, customInp.value);
		if (!r) showStatus("Enter a name for the file.", false);
		return r;
	};
	const resolveLoose = () => {
		const r = _curatedResolveSaveName(basisSel.value, customInp.value);
		if (r) return r;
		const matching = _diffMode === "minimal" ? "minimal" : "ideal";
		return { fname: `diff_marks_${matching}.json`, matching };
	};

	form.querySelector("#csm-copy").addEventListener("click", () => {
		const r = resolveLoose();
		_curatedCopyText(_curatedBuildJson(r.matching), "csm-copy");
	});
	form.querySelector("#csm-download").addEventListener("click", () => {
		const r = resolveLoose();
		_curatedDownloadFile(r.fname, r.matching);
		showStatus(`⬇ Downloaded ${r.fname}`, true);
	});

	const saveBtn = form.querySelector("#csm-save");
	saveBtn.addEventListener("click", async () => {
		const r = resolve();
		if (!r) return;
		saveBtn.disabled = true;
		showStatus("Saving…", true);
		try {
			await _curatedSaveToFolder(r.fname, r.matching);
			showStatus(`✓ Saved ${r.fname}`, true);
			setTimeout(_curatedCloseSaveDialog, 1000);
		} catch (err) {
			console.error("[Differentiator] Save failed", err);
			showStatus("Save failed: " + (err && err.message), false);
			saveBtn.disabled = false;
		}
	});

	_curatedShowFloatWin("Save diff marks", form);
}

function _curatedClearDiff() {
	if (typeof _embedMode !== "undefined" && _embedMode) return;
	const t = _curatedMarks();
	if (!t) return;
	const hasMarks =
		Object.keys(t.teacher_files || {}).length ||
		Object.keys(t.student_files || {}).length;
	if (!hasMarks) return;
	_curatedSnapshot();
	t.teacher_files = {};
	t.student_files = {};
	if (t.file_pairs) t.file_pairs = {};
	_curatedCancelPending();
	_curatedClearPairHover();
	_curatedHideControls();
	_curatedClearPairConnectors();
	_curatedRerender();
}
