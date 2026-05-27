"use strict";

const AssignmentLoader = {
	async renderInstructions(name, fileViewer) {
		const resp = await fetch(`/assignments/${name}/instructions.html`);
		if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
		const html = await resp.text();
		const files = [{ name: "instructions.html", content: html }];
		fileViewer.setTabs(["instructions.html"], "instructions.html");
		fileViewer.setEditorHtml(
			fvRenderStaticEditor(html, "html", "instructions.html"),
		);
		const base = `${location.origin}/assignments/${name}/`;
		fileViewer.setPreviewSrcdoc(
			`<!DOCTYPE html><html><head><base href="${base}"><style>body{margin:16px 20px;font-family:sans-serif;font-size:14px;line-height:1.6;color:#222;}img{max-width:100%;height:auto;}ol,ul{padding-left:1.5em;margin:8px 0;}li{margin:4px 0;}p{margin:8px 0;}</style></head><body>${html}</body></html>`,
		);
		return files;
	},

	async renderStart(name, fileViewer) {
		const entries = await listServerDir(`/assignments/${name}/start/`);
		const codeFiles = entries
			.filter((e) => e.kind === "file" && CODE_EXT.test(e.name))
			.map((e) => e.name);
		if (!codeFiles.length) return [];

		const loaded = await Promise.all(
			codeFiles.map(async (fname) => {
				const r = await fetch(`/assignments/${name}/start/${fname}`);
				return { name: fname, content: r.ok ? await r.text() : "" };
			}),
		);

		const defaultFile =
			codeFiles.find((f) => f.toLowerCase() === "index.html") ||
			codeFiles.find((f) => f.toLowerCase().endsWith(".html")) ||
			codeFiles[0];
		fileViewer.setTabs(codeFiles, defaultFile);
		this.showFile(fileViewer, loaded, defaultFile);

		const htmlFile =
			codeFiles.find((f) => f.toLowerCase() === "index.html") ||
			codeFiles.find((f) => f.toLowerCase().endsWith(".html"));
		if (htmlFile) {
			fileViewer.setPreviewSrc(`/assignments/${name}/start/${htmlFile}`);
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
