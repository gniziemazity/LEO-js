"use strict";

const REMARKS_BASES = [
	{ key: "ideal", label: "Ideal" },
	{ key: "required", label: "Required" },
	{ key: "leo_star", label: "LEO*" },
	{ key: "leo", label: "LEO" },
	{ key: "lcs_star", label: "LCS*" },
	{ key: "lcs", label: "LCS" },
	{ key: "lev_star", label: "Lev*" },
	{ key: "lev", label: "Lev" },
	{ key: "ro_star", label: "R/O*" },
	{ key: "ro", label: "R/O" },
	{ key: "git_star", label: "Git*" },
	{ key: "git", label: "Git" },
];

const DEFAULT_BASIS_ORDER = ["required", "ideal", "leo_star", "leo"];

function _cssVar(name) {
	return getComputedStyle(document.documentElement)
		.getPropertyValue(name)
		.trim();
}

function _hexToRgba(hex, a) {
	let h = hex.replace(/^#/, "");
	if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
	const r = parseInt(h.slice(0, 2), 16);
	const g = parseInt(h.slice(2, 4), 16);
	const b = parseInt(h.slice(4, 6), 16);
	return `rgba(${r},${g},${b},${a})`;
}

const LANG_COLORS = {
	html: _cssVar("--clr-red"),
	htm: _cssVar("--clr-red"),
	css: _cssVar("--clr-accent"),
	js: _cssVar("--clr-orange"),
	py: _cssVar("--clr-purple"),
};

function langColorFor(key) {
	if (!key) return null;
	let k = String(key).toLowerCase();
	if (k === "javascript") k = "js";
	else if (k === "python") k = "py";
	return LANG_COLORS[k] || null;
}

function _idbOpen(dbName = "lesson_tools") {
	return new Promise((res, rej) => {
		const req = indexedDB.open(dbName, 1);
		req.onupgradeneeded = (e) => {
			const db = e.target.result;
			if (!db.objectStoreNames.contains("state")) {
				db.createObjectStore("state");
			}
		};
		req.onsuccess = (e) => res(e.target.result);
		req.onerror = () => rej(req.error);
	});
}

async function _idbGet(key, dbName = "lesson_tools") {
	try {
		const db = await _idbOpen(dbName);
		return await new Promise((res) => {
			const r = db.transaction("state").objectStore("state").get(key);
			r.onsuccess = () => res(r.result ?? null);
			r.onerror = () => res(null);
		});
	} catch {
		return null;
	}
}

async function _idbSet(key, value, dbName = "lesson_tools") {
	try {
		const db = await _idbOpen(dbName);
		await new Promise((res, rej) => {
			const tx = db.transaction("state", "readwrite");
			tx.objectStore("state").put(value, key);
			tx.oncomplete = res;
			tx.onerror = rej;
		});
	} catch {}
}

function showLoading(on) {
	const el = document.getElementById("loading");
	if (el) el.style.display = on ? "flex" : "none";
}

const DIFF_MARKS_FILES = {
	"": "diff_marks_leo_star.json",
	leo: "diff_marks_leo.json",
	"token-lcs": "diff_marks_lcs.json",
	"token-lcs-star": "diff_marks_lcs_star.json",
	"token-lev": "diff_marks_lev.json",
	"token-lev-star": "diff_marks_lev_star.json",
	"line-ro": "diff_marks_ro.json",
	"line-ro-star": "diff_marks_ro_star.json",
	"line-git": "diff_marks_git.json",
	"line-git-star": "diff_marks_git_star.json",
	ideal: "diff_marks_ideal.json",
	required: "diff_marks_required.json",
};

const CURATED_MODES = new Set(["ideal", "required"]);

function diffModeFromFilename(filename) {
	const lower = String(filename || "").toLowerCase();
	for (const [mode, name] of Object.entries(DIFF_MARKS_FILES)) {
		if (lower === name) return mode;
	}
	return null;
}

function defaultDiffModeKey(allMarks, requestedMode = null) {
	const has = (k) => Object.prototype.hasOwnProperty.call(allMarks, k);
	if (requestedMode != null && has(requestedMode)) return requestedMode;
	if (has("required")) return "required";
	if (has("ideal")) return "ideal";
	if (has("")) return "";
	if (has("leo")) return "leo";
	return Object.keys(allMarks)[0] ?? null;
}

function escHtml(s) {
	return String(s)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function escAttr(s) {
	return escHtml(s).replace(/"/g, "&quot;");
}

function readFileText(file) {
	return new Promise((res, rej) => {
		const r = new FileReader();
		r.onload = (e) => res(e.target.result);
		r.onerror = () => rej(new Error("Could not read: " + file.name));
		r.readAsText(file);
	});
}

function readFileDataUri(file) {
	return new Promise((res, rej) => {
		const r = new FileReader();
		r.onload = (e) => res(e.target.result);
		r.onerror = () => rej(new Error("Could not read: " + file.name));
		r.readAsDataURL(file);
	});
}

function readFileArray(file) {
	return new Promise((res, rej) => {
		const r = new FileReader();
		r.onload = (e) => res(new Uint8Array(e.target.result));
		r.onerror = () => rej(new Error("Could not read: " + file.name));
		r.readAsArrayBuffer(file);
	});
}

async function readDirHandle(handle, prefix, pathMap, files, opts = {}) {
	const lowercaseKeys = opts.lowercaseKeys === true;
	for await (const [name, entry] of handle) {
		const path = prefix ? `${prefix}/${name}` : name;
		if (entry.kind === "directory") {
			await readDirHandle(entry, path, pathMap, files, opts);
		} else {
			const file = await entry.getFile();
			files.push(file);
			pathMap.set(lowercaseKeys ? path.toLowerCase() : path, file);
		}
	}
}

const TOKEN_RE_SRC = "[a-zA-Z0-9]+|[^\\s]";
function newTokenRegex() {
	return new RegExp(TOKEN_RE_SRC, "g");
}

function _hmsToSeconds(hms, sessionDate) {
	const m = String(hms || "").match(
		/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/,
	);
	if (!m) return null;
	const h = Number(m[1]);
	const mn = Number(m[2]);
	const s = Number(m[3]);
	const frac = m[4] ? Number((m[4] + "000").slice(0, 3)) / 1000 : 0;
	if (sessionDate == null) return h * 3600 + mn * 60 + s + frac;
	const dt = new Date(sessionDate);
	dt.setHours(h, mn, s, Math.round(frac * 1000));
	return dt.getTime() / 1000;
}

const _FOLLOW_DESC_RE = /([+-])(.+?)\s+\((\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\)/g;

function parseFollowEvents(descText, sessionDate) {
	const events = [];
	if (!descText) return events;
	const re = new RegExp(_FOLLOW_DESC_RE.source, "g");
	let m;
	while ((m = re.exec(String(descText))) !== null) {
		const rawLabel = m[1] + m[2];
		events.push({
			label: rawLabel,
			ts: _hmsToSeconds(m[3], sessionDate),
			...parseFollowLabel(rawLabel),
		});
	}
	return events;
}

function parseFollowLabel(label) {
	if (label.startsWith("-")) {
		return { kind: "missing", token: label.slice(1).trimStart() };
	}
	if (label.startsWith("+")) {
		const tokenPart = label.slice(1).trimStart();
		if (tokenPart.endsWith("*")) {
			const t = tokenPart.slice(0, -1).trimEnd();
			if (t) return { kind: "extra-star", token: t };
		}
		return { kind: "extra", token: tokenPart };
	}
	return { kind: "normal", token: label };
}

function makeDraggable(handle, target) {
	handle.addEventListener("mousedown", (e) => {
		if (e.button !== 0) return;
		if (e.target.closest && e.target.closest("button, input, select, a"))
			return;
		e.preventDefault();
		const startX = e.clientX;
		const startY = e.clientY;
		const origLeft = parseInt(target.style.left) || 0;
		const origTop = parseInt(target.style.top) || 0;
		document.body.classList.add("is-dragging-overlay");
		const onMove = (me) => {
			target.style.left = `${origLeft + me.clientX - startX}px`;
			target.style.top = `${origTop + me.clientY - startY}px`;
		};
		const onUp = () => {
			document.removeEventListener("mousemove", onMove);
			document.removeEventListener("mouseup", onUp);
			document.body.classList.remove("is-dragging-overlay");
		};
		document.addEventListener("mousemove", onMove);
		document.addEventListener("mouseup", onUp);
	});
}

if (!window.__diffDataResolvers) window.__diffDataResolvers = new Map();
if (!window.__getDifferentiatorData) {
	window.__getDifferentiatorData = async function (dataKey) {
		const resolver = window.__diffDataResolvers.get(dataKey);
		if (!resolver) return null;
		return await resolver();
	};
}

function _buildDiffPayload(data) {
	const allMarks = data.allMarks ?? {};
	const defaultMode = defaultDiffModeKey(allMarks);
	const defaultMarks = defaultMode != null ? allMarks[defaultMode] : null;
	return {
		teacherFiles: data.teacherFiles ?? {},
		studentFiles: data.studentFiles ?? {},
		imageUris: data.imageUris ?? {},
		allMarks,
		mode: defaultMode,
		teacherMarks: defaultMarks?.teacher_files ?? null,
		studentMarks: defaultMarks?.student_files ?? null,
		caseSensitive: defaultMarks?.case_sensitive === true,
		title: data.title,
	};
}

async function openDifferentiator(loader) {
	const buildPayload = async () => _buildDiffPayload(await loader());
	const payload = await buildPayload();
	const dataKey = "diffData_" + Date.now() + "_" + ((Math.random() * 1e6) | 0);
	window.__diffDataResolvers.set(dataKey, buildPayload);
	try {
		localStorage.setItem(dataKey, JSON.stringify(payload));
	} catch (e) {
		console.warn("[Differentiator] localStorage handoff skipped:", e);
	}
	window.open(`differentiator.html?key=${dataKey}`, "_blank");
}
