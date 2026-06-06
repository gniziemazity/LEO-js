"use strict";

class DataSource {
	constructor() {
		this.files = new Map();
		this.rootName = "";
		this.rootHandle = null;
		this.isReadOnly = false;
		this.manifest = null;
	}
	async open() {
		throw new Error("DataSource.open() must be overridden");
	}
	async load(_subPath = "") {
		throw new Error("DataSource.load() must be overridden");
	}
	async lessonFiles(_args) {
		throw new Error("DataSource.lessonFiles() must be overridden");
	}
}

class FsDataSource extends DataSource {
	constructor({ idbKey = "lastDir", dbName, lowercaseKeys = true } = {}) {
		super();
		this._idbKey = idbKey;
		this._dbName = dbName;
		this._lowercaseKeys = lowercaseKeys;
	}
	async open({ tryResume = false } = {}) {
		let handle = null;
		if (tryResume) {
			handle = await loadSavedDirHandle(this._idbKey, this._dbName);
		}
		if (!handle) {
			handle = await pickFolderWithMemory(this._idbKey, this._dbName);
		}
		this.rootHandle = handle;
		this.rootName = handle.name;
		return handle;
	}
	async load(subPath = "") {
		if (!this.rootHandle) throw new Error("FsDataSource: no root handle");
		this.files.clear();
		const flatFiles = [];
		const startHandle = subPath
			? await _resolveSubHandle(this.rootHandle, subPath)
			: this.rootHandle;
		const prefix = subPath ? subPath.replace(/\/+$/, "") : "";
		await readDirHandle(startHandle, prefix, this.files, flatFiles, {
			lowercaseKeys: this._lowercaseKeys,
		});
		return flatFiles;
	}
	async lessonFiles({ lesson, group }) {
		const resolved = await resolveLessonHandle({ lesson, group });
		if (!resolved) return null;
		const sub = new FsDataSource({ lowercaseKeys: this._lowercaseKeys });
		sub.rootHandle = resolved.handle;
		sub.rootName = resolved.handle.name;
		return sub;
	}
}

class ScopedDataSource extends DataSource {
	constructor({ files, name, isReadOnly = false, rootHandle = null }) {
		super();
		this.files = files;
		this.rootName = name;
		this.rootHandle = rootHandle;
		this.isReadOnly = isReadOnly;
	}
	async load() {
		return [...this.files.values()];
	}
}

class HttpFileLike {
	constructor(url, name) {
		this.url = url;
		this.name = name;
	}
	async text() {
		const r = await fetch(this.url);
		if (!r.ok) throw new Error(`Fetch ${this.url} failed: ${r.status}`);
		return r.text();
	}
	async arrayBuffer() {
		const r = await fetch(this.url);
		if (!r.ok) throw new Error(`Fetch ${this.url} failed: ${r.status}`);
		return r.arrayBuffer();
	}
}

class HttpDataSource extends DataSource {
	constructor({ manifestUrl = "manifest.json" } = {}) {
		super();
		this.isReadOnly = true;
		this._manifestUrl = manifestUrl;
		this._manifestAbs = null;
	}
	async open() {
		const abs = new URL(this._manifestUrl, location.href);
		this._manifestAbs = abs;
		const r = await fetch(abs.href);
		if (!r.ok) throw new Error(`Manifest fetch failed: ${r.status}`);
		const manifest = await r.json();
		this.manifest = manifest;
		this.rootName = manifest.rootName || "dataset";
		this.files.clear();
		const mtimes = manifest.mtimes || {};
		const addFile = (path) => {
			const url = new URL(path, abs).href;
			const name = path.split("/").pop();
			const file = new HttpFileLike(url, name);
			const mt = mtimes[path.toLowerCase()];
			if (mt) file.lastModified = mt;
			this.files.set(path.toLowerCase(), file);
		};
		for (const p of manifest.rootFiles || []) addFile(p);
		const groups = manifest.groups || {};
		for (const [groupName, lessons] of Object.entries(groups)) {
			for (const [lessonName, info] of Object.entries(lessons || {})) {
				for (const rel of info.files || []) {
					addFile(`${groupName}/${lessonName}/${rel}`);
				}
			}
		}
	}
	async load(_subPath = "") {
		return [...this.files.values()];
	}
	async lessonFiles({ lesson, group }) {
		if (!this.manifest) return null;
		const groups = this.manifest.groups || {};
		const tryGroups = group ? [group] : ["lessons", "assignments"];
		const lessonLc = String(lesson).toLowerCase();
		for (const g of tryGroups) {
			const groupObj = groups[g];
			if (!groupObj) continue;
			const actualKey = Object.keys(groupObj).find(
				(k) => k.toLowerCase() === lessonLc,
			);
			if (!actualKey) continue;
			const fileMap = new Map();
			const prefix = `${g}/${actualKey}/`.toLowerCase();
			for (const [path, file] of this.files) {
				if (path.startsWith(prefix)) {
					fileMap.set(path.slice(prefix.length), file);
				}
			}
			return new ScopedDataSource({
				files: fileMap,
				name: actualKey,
				isReadOnly: true,
			});
		}
		return null;
	}
}

const _GRADES_SKIP_DIRS = new Set(["students", "curated"]);

class GradesDataSource extends DataSource {
	constructor() {
		super();
		this.isReadOnly = true;
	}
	async open() {
		const r = await fetch("/grades-session");
		if (!r.ok) throw new Error("GradesDataSource: no /grades-session");
		let folder = "";
		try {
			folder = (await r.json()).folder || "";
		} catch {}
		this.rootName = folder
			? String(folder).split(/[\\/]/).filter(Boolean).pop()
			: "grades";
		return this;
	}
	async _addDirFiles(rel) {
		let entries;
		try {
			entries = await listServerDir(`/grades-data/${rel}`);
		} catch {
			return;
		}
		for (const e of entries || []) {
			if (!e || !e.name || e.kind === "directory") continue;
			const childRel = `${rel}${e.name}`;
			const url = new URL(`/grades-data/${childRel}`, location.href).href;
			this.files.set(childRel.toLowerCase(), new HttpFileLike(url, e.name));
		}
	}
	async load() {
		this.files.clear();
		await this._addDirFiles("");
		for (const g of ["lessons", "assignments"]) {
			let lessons;
			try {
				lessons = await listServerDir(`/grades-data/${g}/`);
			} catch {
				continue;
			}
			for (const e of lessons || []) {
				if (e && e.kind === "directory") {
					await this._addDirFiles(`${g}/${e.name}/`);
				}
			}
		}
		return [...this.files.values()];
	}
	async _crawl(base, rel, fileMap) {
		let entries;
		try {
			entries = await listServerDir(`/grades-data/${base}${rel}`);
		} catch {
			return;
		}
		for (const e of entries || []) {
			if (!e || !e.name) continue;
			if (
				e.kind === "directory" &&
				rel === "" &&
				_GRADES_SKIP_DIRS.has(e.name.toLowerCase())
			) {
				continue;
			}
			const childRel = `${rel}${e.name}`;
			if (e.kind === "directory") {
				await this._crawl(base, `${childRel}/`, fileMap);
			} else {
				const url = new URL(
					`/grades-data/${base}${childRel}`,
					location.href,
				).href;
				fileMap.set(childRel.toLowerCase(), new HttpFileLike(url, e.name));
			}
		}
	}
	async lessonFiles({ lesson, group }) {
		const tryGroups = group ? [group] : ["lessons", "assignments"];
		const lessonLc = String(lesson).toLowerCase();
		for (const g of tryGroups) {
			let groupEntries;
			try {
				groupEntries = await listServerDir(`/grades-data/${g}/`);
			} catch {
				continue;
			}
			const match = (groupEntries || []).find(
				(e) => e.kind === "directory" && e.name.toLowerCase() === lessonLc,
			);
			if (!match) continue;
			const fileMap = new Map();
			await this._crawl(`${g}/${match.name}/`, "", fileMap);
			if (fileMap.size) {
				return new ScopedDataSource({
					files: fileMap,
					name: match.name,
					isReadOnly: true,
				});
			}
		}
		return null;
	}
}

async function detectDataSource({ manifestUrl } = {}) {
	let candidates;
	if (manifestUrl) {
		candidates = [manifestUrl];
	} else {
		const inToolsDir = /\/tools\/[^/]+$/.test(location.pathname);
		candidates = inToolsDir
			? ["../manifest.json", "manifest.json"]
			: ["manifest.json", "../manifest.json"];
	}
	for (const url of candidates) {
		try {
			const abs = new URL(url, location.href);
			const r = await fetch(abs.href, { method: "HEAD" });
			if (r.ok) return new HttpDataSource({ manifestUrl: url });
		} catch {}
	}
	return null;
}

async function detectServedDataSource() {
	const httpDs = await detectDataSource();
	if (httpDs) {
		await httpDs.open();
		return httpDs;
	}
	try {
		const gradesDs = new GradesDataSource();
		await gradesDs.open();
		return gradesDs;
	} catch {
		return null;
	}
}

async function loadLessonDataSource({ lesson, group }) {
	const served = await detectServedDataSource();
	const scoped = served ? await served.lessonFiles({ lesson, group }) : null;
	return scoped || new FsDataSource().lessonFiles({ lesson, group });
}

async function _resolveSubHandle(rootHandle, subPath) {
	const parts = String(subPath).split("/").filter(Boolean);
	let cur = rootHandle;
	for (const p of parts) {
		cur = await cur.getDirectoryHandle(p);
	}
	return cur;
}
