"use strict";

const REMARKS_BASES = [
	{ key: "ideal", label: "Ideal" },
	{ key: "minimal", label: "Minimal" },
	{ key: "leo_star", label: "LEO*" },
	{ key: "leo", label: "LEO" },
	{ key: "lcs_star", label: "LCS*" },
	{ key: "lcs", label: "LCS" },
	{ key: "git_star", label: "Git*" },
	{ key: "git", label: "Git" },
];

const DEFAULT_BASIS_ORDER = ["ideal", "minimal", "leo_star", "leo"];

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

const THEME = {
	blue: _cssVar("--clr-accent"),
	orange: _cssVar("--clr-orange"),
	yellow: _cssVar("--clr-yellow"),
	green: _cssVar("--clr-green"),
	purple: _cssVar("--clr-purple"),
	red: _cssVar("--clr-red"),
	gray: _cssVar("--clr-gray"),
	muted: _cssVar("--clr-muted"),
	artefactOk: _cssVar("--clr-artefact-ok"),
	label: _cssVar("--clr-label"),
	bg: _cssVar("--clr-bg"),
	barTrack: _cssVar("--clr-bar-track"),
	paleRed: _cssVar("--clr-pale-red"),
	neg: _cssVar("--clr-neg"),
	textStrong: _cssVar("--clr-text-strong"),
	textFaint: _cssVar("--clr-text-faint"),
	codeMuted: _cssVar("--clr-code-muted"),
	black: _cssVar("--clr-black"),
	ghostPair: _cssVar("--clr-ghost-pair"),
	chartBg: _cssVar("--clr-chart-bg"),
	chartGrid: _cssVar("--clr-chart-grid"),
	chartAxisLine: _cssVar("--clr-chart-axis-line"),
	chartAxisText: _cssVar("--clr-chart-axis-text"),
	chartAxisTick: _cssVar("--clr-chart-axis-tick"),
	chartKpmActive: _cssVar("--clr-chart-kpm-active"),
	chartKpmSession: _cssVar("--clr-chart-kpm-session"),
	chartCumulative: _cssVar("--clr-chart-cumulative"),
	chartCumulativeFill: _cssVar("--clr-chart-cumulative-fill"),
	chartInsertMarker: _cssVar("--clr-chart-insert-marker"),
	chartDotMutedFill: _cssVar("--clr-chart-dot-muted-fill"),
	chartDotMutedStroke: _cssVar("--clr-chart-dot-muted-stroke"),
	tipBgBlue: _cssVar("--clr-tip-bg-blue"),
	tipBgOrange: _cssVar("--clr-tip-bg-orange"),
	tipBgGreen: _cssVar("--clr-tip-bg-green"),
};

const LANG_COLORS = {
	html: THEME.red,
	htm: THEME.red,
	css: THEME.blue,
	js: THEME.orange,
	py: THEME.purple,
};

function langColorFor(key) {
	if (!key) return null;
	let k = String(key).toLowerCase();
	if (k === "javascript") k = "js";
	else if (k === "python") k = "py";
	return LANG_COLORS[k] || null;
}

const MARK_COLORS = {
	missing: _cssVar("--clr-mark-missing"),
	extra: _cssVar("--clr-mark-extra"),
	ghost_extra: _cssVar("--clr-mark-ghost"),
	comment: _cssVar("--clr-mark-comment"),
};

function markColorFor(key) {
	if (!key) return null;
	const k = key === "extra-star" ? "ghost_extra" : key;
	return MARK_COLORS[k] || null;
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

function parseCsv(text) {
	const lines = String(text || "")
		.replace(/^\uFEFF/, "")
		.split(/\r?\n/)
		.filter(Boolean);
	if (lines.length < 2) return { header: [], rows: [], delim: "," };
	const delim = lines[0].includes(";") ? ";" : ",";
	const cells = (line) =>
		line.split(delim).map((s) => s.trim().replace(/^"|"$/g, ""));
	return { header: cells(lines[0]), rows: lines.slice(1).map(cells), delim };
}

async function readCsvText(file) {
	const buf = await file.arrayBuffer();
	const bytes = new Uint8Array(buf);
	const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
	try {
		return stripBom(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch (e) {}
	try {
		return stripBom(new TextDecoder("windows-1252").decode(bytes));
	} catch (e) {}
	return stripBom(new TextDecoder("latin1").decode(bytes));
}

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

function parseStudentIdNameMap(text) {
	const map = {};
	const { header, rows } = parseCsv(text);
	const idIdx = header.findIndex((h) => /student.?id|^id$/i.test(h));
	const nameIdx = header.findIndex((h) => /student.?name|^name$/i.test(h));
	const alterIdx = header.findIndex((h) => /alter.?ego/i.test(h));
	const valIdx = nameIdx !== -1 ? nameIdx : alterIdx;
	if (idIdx === -1 || valIdx === -1) return map;
	for (const parts of rows) {
		const id = parts[idIdx];
		const name = parts[valIdx];
		if (id && name) map[id] = name;
	}
	return map;
}

function parseAlterEgoMap(text, { keyTransform } = {}) {
	const map = {};
	const { header, rows } = parseCsv(text);
	const nameIdx = header.findIndex((h) => /student.?name|^name$/i.test(h));
	const alterIdx = header.findIndex((h) => /alter.?ego/i.test(h));
	if (nameIdx === -1 || alterIdx === -1) return map;
	for (const parts of rows) {
		const realName = parts[nameIdx];
		const alterEgo = parts[alterIdx];
		if (realName && alterEgo) {
			map[keyTransform ? keyTransform(realName) : realName] = alterEgo;
		}
	}
	return map;
}

function getFileExt(name) {
	if (!name) return "";
	const m = String(name).match(/\.[^./\\]+$/);
	return m ? m[0].slice(1).toLowerCase() : "";
}

const _SHORT_ID_BY_EXT = {
	html: "html",
	htm: "html",
	css: "css",
	js: "js",
	py: "py",
};

function langShortId(name, fallback = "html") {
	return _SHORT_ID_BY_EXT[getFileExt(name)] || fallback;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|ico|bmp)$/i;
const MEDIA_EXT =
	/\.(png|jpe?g|gif|svg|webp|ico|bmp|mp3|wav|ogg|m4a|aac|flac|mp4|webm|ogv|mov)$/i;
const CODE_EXT = /\.(html|css|js|py)$/i;
const DOC_EXT = /\.docx$/i;

async function pickFolderWithMemory(idbKey = "lastDir", dbName = undefined) {
	const lastDir = await _idbGet(idbKey, dbName);
	const opts = { mode: "read" };
	if (lastDir) opts.startIn = lastDir;
	const handle = await window.showDirectoryPicker(opts);
	_idbSet(idbKey, handle, dbName);
	return handle;
}

async function pickFilesWithMemory(
	opts = {},
	idbKey = "lastDir",
	dbName = undefined,
) {
	const lastDir = await _idbGet(idbKey, dbName);
	if (lastDir) opts.startIn = lastDir;
	const handles = await window.showOpenFilePicker(opts);
	if (handles && handles.length) _idbSet(idbKey, handles[0], dbName);
	return handles || [];
}

async function loadSavedDirHandle(idbKey = "lastDir", dbName = undefined) {
	const handle = await _idbGet(idbKey, dbName);
	if (!handle || handle.kind !== "directory") return null;
	try {
		if ((await handle.requestPermission({ mode: "read" })) !== "granted")
			return null;
	} catch {
		return null;
	}
	return handle;
}

const IDB_KEY_COURSE_ROOT = "courseRoot";
const IDB_KEY_LESSON_ROOT = "lessonRoot";

function parseToolParams(search = location.search) {
	const p = new URLSearchParams(search);
	const lesson = p.get("lesson") || null;
	const group = p.get("group") || null;
	const id = p.get("id") || null;
	const mode = p.get("mode") || null;
	const title = p.get("title") || null;
	const parseIdList = (raw) =>
		raw
			? raw
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean)
			: null;
	const ids = parseIdList(p.get("ids"));
	const star = parseIdList(p.get("star"));
	const stepRaw = p.get("step");
	const step =
		stepRaw != null && stepRaw !== "" && Number.isFinite(Number(stepRaw))
			? Number(stepRaw)
			: null;
	const autoplayRaw = p.get("autoplay");
	const autoplay = autoplayRaw === "1" || autoplayRaw === "true";
	const ts = p.get("ts");
	const speedRaw = p.get("speed");
	const speed =
		speedRaw != null && speedRaw !== "" && Number(speedRaw) > 0
			? Number(speedRaw)
			: null;
	return {
		lesson,
		group,
		id,
		mode,
		title,
		ids,
		star,
		step,
		autoplay,
		ts,
		speed,
	};
}

async function resolveLessonHandle({ lesson, group } = {}) {
	if (!lesson) return null;
	if (!group) {
		const lessonRoot = await _idbGet(IDB_KEY_LESSON_ROOT);
		if (
			lessonRoot &&
			lessonRoot.kind === "directory" &&
			lessonRoot.name === lesson
		) {
			try {
				if (
					(await lessonRoot.requestPermission({ mode: "read" })) ===
					"granted"
				) {
					return { handle: lessonRoot, group: null };
				}
			} catch {}
		}
	}
	const tryGroups = group ? [group] : ["lessons", "assignments"];
	const courseRoot = await _idbGet(IDB_KEY_COURSE_ROOT);
	if (courseRoot && courseRoot.kind === "directory") {
		try {
			if (
				(await courseRoot.requestPermission({ mode: "read" })) === "granted"
			) {
				for (const g of tryGroups) {
					try {
						const groupHandle = await courseRoot.getDirectoryHandle(g);
						const lessonHandle =
							await groupHandle.getDirectoryHandle(lesson);
						return { handle: lessonHandle, group: g };
					} catch {}
				}
			}
		} catch {}
	}
	const lessonRoot = await _idbGet(IDB_KEY_LESSON_ROOT);
	if (
		lessonRoot &&
		lessonRoot.kind === "directory" &&
		lessonRoot.name === lesson
	) {
		try {
			if (
				(await lessonRoot.requestPermission({ mode: "read" })) === "granted"
			) {
				return { handle: lessonRoot, group: group || null };
			}
		} catch {}
	}
	return null;
}

function buildToolUrl(
	target,
	{
		lesson,
		group,
		id,
		mode,
		title,
		ids,
		star,
		step,
		autoplay,
		ts,
		speed,
	} = {},
) {
	const params = new URLSearchParams();
	if (lesson) params.set("lesson", lesson);
	if (group) params.set("group", group);
	if (id) params.set("id", id);
	if (mode) params.set("mode", mode);
	if (title) params.set("title", title);
	if (ids && ids.length)
		params.set("ids", Array.isArray(ids) ? ids.join(",") : ids);
	if (star && star.length)
		params.set("star", Array.isArray(star) ? star.join(",") : star);
	if (step != null && step !== "") params.set("step", step);
	if (autoplay) params.set("autoplay", "1");
	if (ts != null && ts !== "") params.set("ts", ts);
	if (speed != null && speed !== "") params.set("speed", speed);
	const qs = params.toString();
	return qs ? `${target}?${qs}` : target;
}

function navigateToStudents(args = {}) {
	window.open(buildToolUrl("students.html", args), "_blank");
}
function openInNewTab(url, focus = false) {
	if (focus) {
		const win = window.open(url, "_blank");
		if (win) {
			win.opener = null;
			win.focus();
			return;
		}
	}
	const a = document.createElement("a");
	a.href = url;
	a.target = "_blank";
	a.rel = "noopener";
	document.body.appendChild(a);
	a.click();
	a.remove();
}

function previewBaseTarget(html) {
	const s = String(html || "");
	if (/<base\b[^>]*\btarget\s*=/i.test(s)) return s;
	if (/<base\b/i.test(s))
		return s.replace(/<base\b/i, '<base target="_blank" ');
	const tag = '<base target="_blank">';
	if (/<head\b[^>]*>/i.test(s))
		return s.replace(/(<head\b[^>]*>)/i, "$1" + tag);
	if (/<html\b[^>]*>/i.test(s))
		return s.replace(/(<html\b[^>]*>)/i, "$1" + tag);
	return tag + s;
}
function navigateToDifferentiator(args = {}, focus = false) {
	openInNewTab(buildToolUrl("differentiator.html", args), focus);
}
function navigateToTimeline(args = {}) {
	openInNewTab(buildToolUrl("timeline.html", args));
}

function navigateToSimulator(args = {}) {
	openInNewTab(buildToolUrl("simulator.html", args));
}

async function listServerDir(path) {
	const resp = await fetch(path);
	if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
	const text = await resp.text();
	try {
		return JSON.parse(text);
	} catch {
		const matches = [...text.matchAll(/href="([^/"]+)\/?"/g)];
		return matches.map((m) => ({
			name: m[1],
			kind: m[1].includes(".") ? "file" : "directory",
		}));
	}
}

async function waitForXlsxBundle() {
	if (typeof XLSX !== "undefined") return;
	await new Promise((resolve) => {
		const s = document.querySelector('script[src*="xlsx"]');
		if (s) {
			s.addEventListener("load", resolve, { once: true });
			s.addEventListener("error", resolve, { once: true });
		} else {
			resolve();
		}
	});
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
	"line-git": "diff_marks_git.json",
	"line-git-star": "diff_marks_git_star.json",
	ideal: "diff_marks_ideal.json",
	minimal: "diff_marks_minimal.json",
};

const DIFF_MARKS_PRIORITY = ["ideal", "minimal", "", "leo"];

const CURATED_MODES = new Set(["ideal", "minimal"]);

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
	if (has("ideal")) return "ideal";
	if (has("minimal")) return "minimal";
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

function isArtefactPattern(raw) {
	const s = (raw ?? "").trim();
	return s.length > 0 && /^[01]+$/.test(s);
}

function formatInteractionCounts(a, q, h) {
	const fmt = (n, emoji) => {
		const c = Math.round(+n);
		if (!(c > 0)) return null;
		const inner = c === 1 ? emoji : `${emoji}&nbsp;${c}`;
		return `<span class="ia-box">${inner}</span>`;
	};
	return [fmt(a, "🙋"), fmt(q, "❓"), fmt(h, "🤝")].filter(Boolean).join("");
}

function artefactCodeHtml(code) {
	return escHtml(String(code)).replace(/_(\w+)/g, "<sub>$1</sub>");
}

function renderArtefactBadges(raw, schema) {
	const code = (raw ?? "").trim();
	if (!isArtefactPattern(code)) return null;
	const schemaArr = Array.isArray(schema) ? schema : [];
	return code
		.split("")
		.map((ch, i) => {
			const fired = ch === "1";
			const sev = (schemaArr[i] && schemaArr[i].severity) || "high";
			const clr = fired ? artefactFiredColorFor(sev) : THEME.artefactOk;
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
		const sev = (schemaArr[i] && schemaArr[i].severity) || "high";
		const clr = count > 0 ? artefactFiredColorFor(sev) : THEME.artefactOk;
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
	const sev = (entry && entry.severity) || "high";
	const clr = fired ? artefactFiredColorFor(sev) : THEME.artefactOk;
	return (
		`<span style="display:inline-block;width:14px;height:14px;` +
		`border-radius:2px;vertical-align:middle;background:${clr}"></span>`
	);
}

function renderArtefactTotalOne(count, entry) {
	const sev = (entry && entry.severity) || "high";
	const clr = count > 0 ? artefactFiredColorFor(sev) : THEME.artefactOk;
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
		const clr = fired
			? artefactFiredColorFor((entry && entry.severity) || "high")
			: THEME.artefactOk;
		const style = fired ? "font-weight:bold" : `color:${THEME.muted}`;
		lines.push(
			`<div style="${style}">${sq(clr)}${codeHtml}${escHtml(label)}</div>`,
		);
	}
	return lines.join("");
}

let _SHARED_TIP_EL = null;

function _ensureSharedTip() {
	if (_SHARED_TIP_EL && document.body.contains(_SHARED_TIP_EL))
		return _SHARED_TIP_EL;
	let el = document.getElementById("shared-html-tip");
	if (!el) {
		el = document.createElement("div");
		el.id = "shared-html-tip";
		el.style.cssText =
			"position:fixed;display:none;background:" +
			THEME.bg +
			";color:" +
			THEME.textStrong +
			";font-size:11px;font-family:Consolas,monospace;padding:6px 10px;" +
			"border:1px solid " +
			THEME.muted +
			";border-radius:4px;pointer-events:none;z-index:10000;" +
			"max-width:640px;box-shadow:0 2px 8px rgba(0,0,0,0.25);line-height:1.45;";
		document.body.appendChild(el);
	}
	_SHARED_TIP_EL = el;
	return el;
}

function _moveSharedTip(e) {
	const el = _SHARED_TIP_EL;
	if (!el) return;
	const tw = el.offsetWidth;
	const th = el.offsetHeight;
	let tx = e.clientX + 14;
	let ty = e.clientY - 8;
	if (tx + tw > window.innerWidth - 8) tx = e.clientX - tw - 14;
	if (ty + th > window.innerHeight - 8) ty = e.clientY - th - 8;
	el.style.left = tx + "px";
	el.style.top = ty + "px";
}

function attachHtmlTip(el, htmlOrFn) {
	const get = typeof htmlOrFn === "function" ? htmlOrFn : () => htmlOrFn;
	el.addEventListener("mouseenter", (e) => {
		const html = get();
		if (!html) return;
		const tip = _ensureSharedTip();
		tip.innerHTML = html;
		tip.style.display = "block";
		_moveSharedTip(e);
	});
	el.addEventListener("mousemove", _moveSharedTip);
	el.addEventListener("mouseleave", () => {
		if (_SHARED_TIP_EL) _SHARED_TIP_EL.style.display = "none";
	});
}

function readFileText(file) {
	if (file && typeof file.text === "function") return file.text();
	return new Promise((res, rej) => {
		const r = new FileReader();
		r.onload = (e) => res(e.target.result);
		r.onerror = () => rej(new Error("Could not read: " + file.name));
		r.readAsText(file);
	});
}

async function readFileDataUri(file) {
	if (file && typeof file.url === "string") {
		const r = await fetch(file.url);
		if (!r.ok) throw new Error(`Fetch ${file.url} failed: ${r.status}`);
		const blob = await r.blob();
		return new Promise((res, rej) => {
			const reader = new FileReader();
			reader.onload = (e) => res(e.target.result);
			reader.onerror = () =>
				rej(new Error("Could not read: " + (file.name || file.url)));
			reader.readAsDataURL(blob);
		});
	}
	return new Promise((res, rej) => {
		const r = new FileReader();
		r.onload = (e) => res(e.target.result);
		r.onerror = () => rej(new Error("Could not read: " + file.name));
		r.readAsDataURL(file);
	});
}

async function readFileArray(file) {
	if (file && typeof file.arrayBuffer === "function") {
		const buf = await file.arrayBuffer();
		return new Uint8Array(buf);
	}
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
	return new RegExp(TOKEN_RE_SRC, "gu");
}

const OBS_COL_RE = /^obs\.?$/i;
const ARTEFACT_CODE_RE = /^[01]+$/;

function round1(x) {
	return Math.round(x * 10) / 10;
}

function lsGet(key, fallback = null) {
	try {
		const v = localStorage.getItem(key);
		return v === null ? fallback : v;
	} catch (e) {
		return fallback;
	}
}
function lsSet(key, value) {
	try {
		localStorage.setItem(key, value);
	} catch (e) {}
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

const _FOLLOW_DESC_RE =
	/([+-])(.+?)\s+\((\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\)(?:\s*~([0-9.]+))?/g;

function parseFollowEvents(descText, sessionDate) {
	const events = [];
	if (!descText) return events;
	const re = new RegExp(_FOLLOW_DESC_RE.source, "g");
	let m;
	while ((m = re.exec(String(descText))) !== null) {
		const rawLabel = m[1] + m[2];
		const ev = {
			label: rawLabel,
			ts: _hmsToSeconds(m[3], sessionDate),
			...parseFollowLabel(rawLabel),
		};
		if (m[4] != null) ev.sim = parseFloat(m[4]);
		events.push(ev);
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

async function buildDiffPayloadData(fileMap, studentDir) {
	const entries = [...fileMap.entries()];
	const teach = (re) =>
		entries.filter(([p]) => re.test(p) && CODE_EXT.test(p));
	const recoEntries = teach(/^reconstructed\//i);
	const startEntries = teach(/^start\//i);
	const correctEntries = teach(/^correct\//i);
	const teacherEntries = recoEntries.length
		? recoEntries
		: startEntries.length
			? startEntries
			: correctEntries;
	const studentEntries = entries.filter(
		([p]) => p.startsWith(studentDir) && CODE_EXT.test(p),
	);

	const teacherFiles = {};
	for (const [, f] of teacherEntries)
		teacherFiles[f.name] = await readFileText(f);
	const studentFiles = {};
	for (const [, f] of studentEntries)
		studentFiles[f.name] = await readFileText(f);

	const studentBase = _studentDirBaseUrl(fileMap, studentDir);
	const fetchMark = async (mode) => {
		const fname = DIFF_MARKS_FILES[mode];
		const entry = fileMap.get(studentDir + fname);
		let text = null;
		if (entry) {
			try {
				text = await readFileText(entry);
			} catch {}
		} else if (studentBase) {
			try {
				const r = await fetch(studentBase + fname);
				if (r.ok) text = await r.text();
			} catch {}
		}
		if (text == null) return null;
		try {
			return JSON.parse(text);
		} catch {
			return null;
		}
	};

	const priorityModes = DIFF_MARKS_PRIORITY.filter(
		(m) => m in DIFF_MARKS_FILES,
	);
	const restModes = Object.keys(DIFF_MARKS_FILES).filter(
		(m) => !priorityModes.includes(m),
	);
	const allMarks = {};
	await Promise.all(
		priorityModes.map(async (mode) => {
			const json = await fetchMark(mode);
			if (json) allMarks[mode] = json;
		}),
	);
	const pendingMarks = Promise.all(
		restModes.map(async (mode) => [mode, await fetchMark(mode)]),
	).then((pairs) => {
		const out = {};
		for (const [mode, json] of pairs) if (json) out[mode] = json;
		return out;
	});

	const imageUris = {};
	for (const [p, f] of entries) {
		if (
			MEDIA_EXT.test(p) &&
			(/^correct\//i.test(p) ||
				/^start\//i.test(p) ||
				p.startsWith(studentDir))
		) {
			if (!imageUris[f.name]) imageUris[f.name] = fileToUrl(f);
		}
	}

	const docUris = {};
	for (const [p, f] of entries) {
		if (
			DOC_EXT.test(p) &&
			!/(^|\/)~\$/.test(p) &&
			(!p.includes("/") ||
				p.startsWith(studentDir) ||
				/^correct\//i.test(p) ||
				/^start\//i.test(p) ||
				/^reconstructed\//i.test(p))
		) {
			if (!docUris[f.name]) docUris[f.name] = fileToUrl(f);
		}
	}

	const teacherBaseUrl = _deriveHttpBaseUrl(teacherEntries);
	const studentBaseUrl = _deriveHttpBaseUrl(studentEntries);

	return {
		teacherFiles,
		studentFiles,
		allMarks,
		pendingMarks,
		imageUris,
		docUris,
		teacherBaseUrl,
		studentBaseUrl,
	};
}

function _deriveHttpBaseUrl(entries) {
	for (const [, f] of entries) {
		if (f && typeof f.url === "string" && /^https?:/i.test(f.url)) {
			return f.url.replace(/[^/]*$/, "");
		}
	}
	return null;
}

function _studentDirBaseUrl(fileMap, studentDir) {
	for (const [p, f] of fileMap) {
		if (!p.startsWith(studentDir)) continue;
		if (p.slice(studentDir.length).includes("/")) continue;
		if (f && typeof f.url === "string" && /^https?:/i.test(f.url)) {
			return f.url.replace(/[^/]*$/, "");
		}
	}
	return null;
}

function fileToUrl(file) {
	if (file && typeof file.url === "string") return file.url;
	return URL.createObjectURL(file);
}

function _buildDiffPayload(data) {
	const allMarks = data.allMarks ?? {};
	const defaultMode = defaultDiffModeKey(allMarks);
	const defaultMarks = defaultMode != null ? allMarks[defaultMode] : null;
	return {
		teacherFiles: data.teacherFiles ?? {},
		studentFiles: data.studentFiles ?? {},
		imageUris: data.imageUris ?? {},
		docUris: data.docUris ?? {},
		allMarks,
		pendingMarks: data.pendingMarks ?? null,
		mode: defaultMode,
		teacherMarks: defaultMarks?.teacher_files ?? null,
		studentMarks: defaultMarks?.student_files ?? null,
		caseSensitive: defaultMarks?.case_sensitive === true,
		title: data.title,
		teacherBaseUrl: data.teacherBaseUrl ?? null,
		studentBaseUrl: data.studentBaseUrl ?? null,
	};
}
