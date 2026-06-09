"use strict";

function _fvTabLabel(name) {
	if (name === "MAIN") return "MAIN";
	const base = name.split("/").pop().split("\\").pop();
	if (/\.docx$/i.test(base)) return "📒 " + base;
	if (/\.pdf$/i.test(base)) return "📕 " + base;
	return base;
}

const FV_LOADING_HTML =
	'<!doctype html><meta charset="utf-8">' +
	"<style>html,body{margin:0;height:100%}" +
	"body{display:flex;align-items:center;justify-content:center;" +
	"background:#fff;color:#999;font-family:'Segoe UI',sans-serif;font-size:13px}" +
	"</style><body>Loading…</body>";

const FV_LOADING_EDITOR_HTML =
	'<div style="display:flex;align-items:center;justify-content:center;' +
	"height:100%;color:#999;font-family:'Segoe UI',sans-serif;font-size:13px\">Loading…</div>";

class FileViewer {
	constructor(opts = {}) {
		this._tabNames = [];
		this._activeFile = null;
		this._onChange = opts.onActiveFileChange || null;
		this._persistKey = opts.persistKey || null;
		this._leftLabel = opts.leftLabel || "";
		this._previewLabel = opts.previewLabel || "";

		if (opts.rootEl) {
			this._buildStandaloneDom(opts.rootEl);
		} else {
			this.editorEl = opts.editorEl;
			this.previewEl = opts.previewEl;
			this._tabsEl = opts.tabsEl;
			this._dividerEl = opts.dividerEl || null;
			this._targetEl = opts.resizeTargetEl || null;
			this._containerEl = opts.resizeContainerEl || null;
		}

		if (this._dividerEl && this._targetEl && this._containerEl) {
			installDragDivider({
				dividerEl: this._dividerEl,
				targetEl: this._targetEl,
				containerEl: this._containerEl,
				axis: "x",
				persistKey: this._persistKey,
			});
		}
	}

	_buildStandaloneDom(rootEl) {
		rootEl.classList.add("fv-root");
		rootEl.innerHTML = `
			<div class="fv-left">
				<div class="fv-tabs"></div>
				<pre class="fv-editor"></pre>
			</div>
			<div class="fv-divider" title="Drag to resize"></div>
			<div class="fv-right">
				<div class="fv-preview-head"></div>
				<iframe class="fv-preview" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads"></iframe>
			</div>
		`;
		this._rootEl = rootEl;
		this._tabsEl = rootEl.querySelector(".fv-tabs");
		this.editorEl = rootEl.querySelector(".fv-editor");
		this._dividerEl = rootEl.querySelector(".fv-divider");
		this.previewEl = rootEl.querySelector(".fv-preview");
		this._rightEl = rootEl.querySelector(".fv-right");
		this._previewHeadEl = rootEl.querySelector(".fv-preview-head");
		if (this._previewLabel)
			this._previewHeadEl.textContent = this._previewLabel;
		this._containerEl = rootEl;
		this._targetEl = this._rightEl;
		this._renderTabs();
	}

	setTabs(names, activeName = null) {
		this._tabNames = [...names];
		if (activeName != null) {
			this._activeFile = activeName;
		} else if (!this._tabNames.includes(this._activeFile)) {
			this._activeFile = this._tabNames[0] || null;
		}
		this._renderTabs();
	}

	setActiveFile(name) {
		if (this._activeFile === name) return;
		this._activeFile = name;
		this._renderTabs();
	}

	setLeftLabel(text) {
		this._leftLabel = text || "";
		this._renderTabs();
	}

	setEditorHtml(html) {
		if (!this.editorEl) return;
		this.editorEl.innerHTML = html;
	}

	showEditorLoading() {
		if (!this.editorEl) return;
		this.editorEl.innerHTML = FV_LOADING_EDITOR_HTML;
	}

	setPreviewSrcdoc(html) {
		if (!this.previewEl) return;
		this.previewEl.removeAttribute("src");
		this.previewEl.srcdoc =
			typeof previewBaseTarget === "function"
				? previewBaseTarget(html || "")
				: html || "";
	}

	setPreviewSrc(url) {
		if (!this.previewEl) return;
		this.previewEl.removeAttribute("srcdoc");
		this.previewEl.src = url;
	}

	clearPreview() {
		if (!this.previewEl) return;
		this.previewEl.removeAttribute("src");
		this.previewEl.srcdoc = "";
	}

	showPreviewLoading() {
		if (!this.previewEl) return;
		this.previewEl.removeAttribute("src");
		this.previewEl.srcdoc = FV_LOADING_HTML;
	}

	hidePreview() {
		if (this._rightEl) this._rightEl.style.display = "none";
		else if (this.previewEl) this.previewEl.style.display = "none";
		if (this._dividerEl) this._dividerEl.style.display = "none";
	}

	showPreview() {
		if (this._rightEl) this._rightEl.style.display = "";
		if (this.previewEl) this.previewEl.style.display = "";
		if (this._dividerEl) this._dividerEl.style.display = "";
	}

	get activeFile() {
		return this._activeFile;
	}

	get tabNames() {
		return [...this._tabNames];
	}

	_renderTabs() {
		if (!this._tabsEl) return;
		this._tabsEl.innerHTML = "";
		if (this._leftLabel) {
			const lbl = document.createElement("span");
			lbl.className = "fv-left-label";
			lbl.textContent = this._leftLabel;
			this._tabsEl.appendChild(lbl);
		}
		if (this._tabNames.length <= 1) return;
		for (const name of this._tabNames) {
			const btn = document.createElement("button");
			btn.className =
				"file-tab" + (name === this._activeFile ? " file-tab-active" : "");
			btn.dataset.fileName = name;
			btn.textContent = _fvTabLabel(name);
			btn.title = name;
			btn.onclick = () => {
				if (this._activeFile === name) return;
				this._activeFile = name;
				this._renderTabs();
				if (this._onChange) this._onChange(name);
			};
			this._tabsEl.appendChild(btn);
		}
	}
}

function fvRenderStaticEditor(content, language = null, filename = null) {
	const lang = language || langShortId(filename || "");
	const text = String(content || "").replace(/\r\n?/g, "\n");
	return renderEditorHtml({ text, cursor: -1, charTs: [] }, false, lang);
}
