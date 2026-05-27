"use strict";

const _FV_LANG_BY_EXT = {
	".html": "html",
	".htm": "html",
	".css": "css",
	".js": "js",
	".py": "py",
};

function _fvLangFor(filename) {
	const m = (filename || "").toLowerCase().match(/\.[^./\\]+$/);
	return (m && _FV_LANG_BY_EXT[m[0]]) || "html";
}

function _fvTabLabel(name) {
	if (name === "MAIN") return "MAIN";
	return name.split("/").pop().split("\\").pop();
}

class FileViewer {
	constructor(opts = {}) {
		this._tabNames = [];
		this._activeFile = null;
		this._onChange = opts.onActiveFileChange || null;
		this._persistKey = opts.persistKey || null;

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
			this._installResize();
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
			<iframe class="fv-preview" sandbox="allow-scripts allow-same-origin"></iframe>
		`;
		this._rootEl = rootEl;
		this._tabsEl = rootEl.querySelector(".fv-tabs");
		this.editorEl = rootEl.querySelector(".fv-editor");
		this._dividerEl = rootEl.querySelector(".fv-divider");
		this.previewEl = rootEl.querySelector(".fv-preview");
		this._containerEl = rootEl;
		this._targetEl = this.previewEl;
	}

	_installResize() {
		if (this._persistKey) {
			const stored = parseFloat(localStorage.getItem(this._persistKey));
			if (Number.isFinite(stored) && stored > 5 && stored < 95) {
				this._targetEl.style.flex = `0 0 ${stored}%`;
			}
		}
		let dragging = false;
		this._dividerEl.addEventListener("pointerdown", (e) => {
			dragging = true;
			this._dividerEl.setPointerCapture(e.pointerId);
			document.body.style.cursor = "col-resize";
			document.body.style.userSelect = "none";
			e.preventDefault();
		});
		this._dividerEl.addEventListener("pointermove", (e) => {
			if (!dragging) return;
			const r = this._containerEl.getBoundingClientRect();
			const pct = ((r.right - e.clientX) / r.width) * 100;
			const clamped = Math.max(10, Math.min(80, pct));
			this._targetEl.style.flex = `0 0 ${clamped}%`;
		});
		const stop = (e) => {
			if (!dragging) return;
			dragging = false;
			try {
				this._dividerEl.releasePointerCapture(e.pointerId);
			} catch {}
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
			const m = this._targetEl.style.flex.match(/0 0 ([\d.]+)%/);
			if (m && this._persistKey) {
				localStorage.setItem(this._persistKey, m[1]);
			}
		};
		this._dividerEl.addEventListener("pointerup", stop);
		this._dividerEl.addEventListener("pointercancel", stop);
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

	setEditorHtml(html) {
		if (!this.editorEl) return;
		this.editorEl.innerHTML = html;
	}

	setPreviewSrcdoc(html) {
		if (!this.previewEl) return;
		this.previewEl.removeAttribute("src");
		this.previewEl.srcdoc = html || "";
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

	hidePreview() {
		if (this.previewEl) this.previewEl.style.display = "none";
		if (this._dividerEl) this._dividerEl.style.display = "none";
	}

	showPreview() {
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
	const lang = language || _fvLangFor(filename || "");
	const text = String(content || "").replace(/\r\n?/g, "\n");
	return renderEditorHtml({ text, cursor: -1, charTs: [] }, false, lang);
}
