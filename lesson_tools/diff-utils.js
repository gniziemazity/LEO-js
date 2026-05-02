"use strict";

function _cssVar(name) {
	return getComputedStyle(document.documentElement)
		.getPropertyValue(name)
		.trim();
}

function _hexToRgba(hex, a) {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	return `rgba(${r},${g},${b},${a})`;
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
	truth: "diff_marks_truth.json",
};

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
	if (has("truth")) return "truth";
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
