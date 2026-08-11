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
	return served ? await served.lessonFiles({ lesson, group }) : null;
}

async function _resolveSubHandle(rootHandle, subPath) {
	const parts = String(subPath).split("/").filter(Boolean);
	let cur = rootHandle;
	for (const p of parts) {
		cur = await cur.getDirectoryHandle(p);
	}
	return cur;
}
