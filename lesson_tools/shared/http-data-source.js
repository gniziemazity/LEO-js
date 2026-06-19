"use strict";

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
