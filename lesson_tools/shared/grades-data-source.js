"use strict";

const _GRADES_SKIP_DIRS = new Set(["students", "curated"]);

class GradesDataSource extends DataSource {
	constructor() {
		super();
		this.isReadOnly = true;
		this.serverWritable = true;
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
					serverWritable: true,
				});
			}
		}
		return null;
	}
}
