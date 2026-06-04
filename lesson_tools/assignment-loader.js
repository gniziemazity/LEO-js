"use strict";

let _assignmentServedDs;
async function _assignmentServed() {
	if (_assignmentServedDs === undefined) {
		try {
			_assignmentServedDs = await detectServedDataSource();
		} catch {
			_assignmentServedDs = null;
		}
	}
	return _assignmentServedDs;
}

async function _assignmentScoped(name) {
	const served = await _assignmentServed();
	if (served && typeof served.lessonFiles === "function") {
		try {
			const scoped = await served.lessonFiles({
				lesson: name,
				group: "assignments",
			});
			if (scoped && scoped.files && scoped.files.size) return scoped;
		} catch {}
	}
	return null;
}

const AssignmentLoader = {
	async renderInstructions(name, fileViewer) {
		const scoped = await _assignmentScoped(name);
		let html;
		let base;
		if (scoped) {
			const file = scoped.files.get("instructions.html");
			if (!file) throw new Error("instructions.html not found");
			html = await file.text();
			base = new URL(".", file.url).href;
		} else {
			const resp = await fetch(`/assignments/${name}/instructions.html`);
			if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
			html = await resp.text();
			base = `${location.origin}/assignments/${name}/`;
		}
		const files = [{ name: "instructions.html", content: html }];
		fileViewer.setTabs(["instructions.html"], "instructions.html");
		fileViewer.setEditorHtml(
			fvRenderStaticEditor(html, "html", "instructions.html"),
		);
		fileViewer.setPreviewSrcdoc(
			`<!DOCTYPE html><html><head><base href="${base}"><style>body{margin:16px 20px;font-family:sans-serif;font-size:14px;line-height:1.6;color:#222;}img{max-width:100%;height:auto;}ol,ul{padding-left:1.5em;margin:8px 0;}li{margin:4px 0;}p{margin:8px 0;}</style></head><body>${html}</body></html>`,
		);
		return files;
	},

	async renderStart(name, fileViewer) {
		const scoped = await _assignmentScoped(name);
		let codeFiles;
		if (scoped) {
			codeFiles = [...scoped.files.entries()]
				.filter(([p]) => p.startsWith("start/"))
				.map(([p, f]) => ({ name: p.slice("start/".length), file: f }))
				.filter(
					(e) => e.name && !e.name.includes("/") && CODE_EXT.test(e.name),
				);
		} else {
			const entries = await listServerDir(`/assignments/${name}/start/`);
			codeFiles = entries
				.filter((e) => e.kind === "file" && CODE_EXT.test(e.name))
				.map((e) => {
					const url = `/assignments/${name}/start/${e.name}`;
					return {
						name: e.name,
						file: {
							url,
							text: async () => {
								const r = await fetch(url);
								return r.ok ? await r.text() : "";
							},
						},
					};
				});
		}
		if (!codeFiles.length) return [];

		const loaded = await Promise.all(
			codeFiles.map(async (e) => ({
				name: e.name,
				content: await e.file.text(),
			})),
		);
		const names = codeFiles.map((e) => e.name);

		const defaultFile =
			names.find((f) => f.toLowerCase() === "index.html") ||
			names.find((f) => f.toLowerCase().endsWith(".html")) ||
			names[0];
		fileViewer.setTabs(names, defaultFile);
		this.showFile(fileViewer, loaded, defaultFile);

		const htmlEntry =
			codeFiles.find((e) => e.name.toLowerCase() === "index.html") ||
			codeFiles.find((e) => e.name.toLowerCase().endsWith(".html"));
		if (htmlEntry) {
			fileViewer.setPreviewSrc(htmlEntry.file.url);
		} else {
			fileViewer.setPreviewSrcdoc(
				"<!DOCTYPE html><html><body style='margin:16px;font-family:sans-serif;color:#888'>No HTML preview available.</body></html>",
			);
		}
		return loaded;
	},

	showFile(fileViewer, files, name) {
		const f = files.find((x) => x.name === name);
		if (!f) return;
		fileViewer.setEditorHtml(fvRenderStaticEditor(f.content, null, name));
	},
};
