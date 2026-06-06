"use strict";

function _isPreviewMode() {
	if (_previewOverride !== null) return _previewOverride;
	return localStorage.getItem("diff-preview-mode") === "preview";
}

function _refreshPreviewButton() {
	const btn = document.getElementById("btn-preview");
	if (!btn) return;
	const on = _isPreviewMode();
	btn.classList.toggle("is-toggle-on", on);
	btn.textContent = on ? "\u2b1b Preview" : "\u2b1c Preview";
}

let _savedCodeScrollTop = 0;
function _applyPreviewMode(isPreview) {
	const scroll = document.getElementById("diff-scroll");
	if (isPreview && scroll) _savedCodeScrollTop = scroll.scrollTop;
	document.body.classList.toggle("diff-preview-on", isPreview);
	for (const side of ["teacher", "student"]) {
		const codeWrap = document.getElementById(`code-${side}`);
		const iframe = document.getElementById(`preview-${side}`);
		const content = document.getElementById(`content-${side}`);
		if (!codeWrap || !content || content.style.display === "none") continue;

		if (isPreview) {
			const files = side === "teacher" ? _teacherFiles : _studentFiles;
			if (!files || !Object.keys(files).length) continue;
			if (iframe) {
				updatePreview(side, files, iframe);
				iframe.style.display = "block";
			}
			codeWrap.style.display = "none";
		} else {
			if (iframe) iframe.style.display = "none";
			codeWrap.style.display = "";
		}
		_updateHScrollProxy(side);
	}
	if (scroll) scroll.scrollTop = isPreview ? 0 : _savedCodeScrollTop || 0;
}

function _hscrollProxyFor(side) {
	const codeWrap = document.getElementById(`code-${side}`);
	const proxy = document.getElementById(`hscroll-${side}`);
	if (!codeWrap || !proxy) return null;
	if (!proxy.dataset.wired) {
		proxy.dataset.wired = "1";
		let syncing = false;
		proxy.addEventListener(
			"scroll",
			() => {
				if (syncing) return;
				syncing = true;
				codeWrap.scrollLeft = proxy.scrollLeft;
				syncing = false;
			},
			{ passive: true },
		);
		codeWrap.addEventListener(
			"scroll",
			() => {
				if (syncing) return;
				syncing = true;
				proxy.scrollLeft = codeWrap.scrollLeft;
				syncing = false;
			},
			{ passive: true },
		);
	}
	return { codeWrap, proxy };
}

function _updateHScrollProxy(side) {
	const refs = _hscrollProxyFor(side);
	if (!refs) return;
	const { codeWrap, proxy } = refs;
	const hidden =
		codeWrap.style.display === "none" || codeWrap.clientWidth === 0;
	const overflow = codeWrap.scrollWidth - codeWrap.clientWidth;
	if (!hidden && overflow > 1) {
		proxy.firstElementChild.style.width = `${codeWrap.scrollWidth}px`;
		proxy.classList.add("is-active");
		proxy.scrollLeft = codeWrap.scrollLeft;
	} else {
		proxy.classList.remove("is-active");
	}
}

function _updateHScrollProxies() {
	_updateHScrollProxy("teacher");
	_updateHScrollProxy("student");
}

function _updateTabHScroll(side) {
	const tabs = document.getElementById(`tabs-${side}`);
	const proxy = document.getElementById(`tab-hscroll-${side}`);
	if (!tabs || !proxy) return;
	const inner = proxy.firstElementChild;
	const overflow = tabs.scrollWidth - tabs.clientWidth;
	if (overflow > 1) {
		inner.style.width = `${tabs.scrollWidth}px`;
		proxy.classList.add("is-active");
		proxy.scrollLeft = tabs.scrollLeft;
		if (!proxy.dataset.wired) {
			proxy.dataset.wired = "1";
			let syncing = false;
			proxy.addEventListener(
				"scroll",
				() => {
					if (syncing) return;
					syncing = true;
					tabs.scrollLeft = proxy.scrollLeft;
					syncing = false;
				},
				{ passive: true },
			);
			tabs.addEventListener(
				"scroll",
				() => {
					if (syncing) return;
					syncing = true;
					proxy.scrollLeft = tabs.scrollLeft;
					syncing = false;
				},
				{ passive: true },
			);
		}
	} else {
		proxy.classList.remove("is-active");
	}
}

function _updateTabHScrolls() {
	_updateTabHScroll("teacher");
	_updateTabHScroll("student");
}

function togglePreview() {
	const next = !_isPreviewMode();
	_previewOverride = null;
	localStorage.setItem("diff-preview-mode", next ? "preview" : "code");
	_applyPreviewMode(next);
	_refreshPreviewButton();
}

function _refreshPreviewIfActive(side) {
	if (!_isPreviewMode()) return;
	const iframe = document.getElementById(`preview-${side}`);
	if (!iframe || iframe.style.display === "none") return;
	const files = side === "teacher" ? _teacherFiles : _studentFiles;
	if (!files || !Object.keys(files).length) return;
	updatePreview(side, files, iframe);
	const scroll = document.getElementById("diff-scroll");
	if (scroll) scroll.scrollTop = 0;
}

function _activeHtmlFileFor(side, files) {
	const activeBtn = document.querySelector(`#tabs-${side} .file-tab-active`);
	const activeName = activeBtn?.dataset.fileName;
	if (activeName && /\.html$/i.test(activeName) && files[activeName] != null) {
		return activeName;
	}
	for (const name of Object.keys(files)) {
		if (/\.html$/i.test(name)) return name;
	}
	return null;
}

function updatePreview(side, files, iframe) {
	const activeHtml = _activeHtmlFileFor(side, files);
	if (!activeHtml) {
		iframe.srcdoc = `<p style='font-family:sans-serif;padding:20px;color:${THEME.muted}'>No HTML file found.</p>`;
		return;
	}
	let html = files[activeHtml];
	const baseUrl = side === "teacher" ? _teacherBaseUrl : _studentBaseUrl;
	const headInjects = [];
	if (baseUrl) headInjects.push(`<base href="${baseUrl}">`);
	const mediaMap = {};
	for (const [name, url] of Object.entries(_imageUris)) {
		if (/^(?:blob|https?):/i.test(url)) mediaMap[name] = url;
	}
	if (Object.keys(mediaMap).length) {
		headInjects.push(_buildMediaShimScript(mediaMap));
	}
	if (headInjects.length) html = _injectIntoHead(html, headInjects.join("\n"));
	const filesMap = { ..._imageUris };
	for (const [name, content] of Object.entries(files)) {
		if (!/\.html$/i.test(name)) filesMap[name] = content;
	}
	iframe.srcdoc = inlineFilesInHtml(html, filesMap) || "";
}

function _injectIntoHead(html, snippet) {
	if (/<head\b[^>]*>/i.test(html)) {
		return html.replace(/(<head\b[^>]*>)/i, `$1\n${snippet}`);
	}
	if (/<html\b[^>]*>/i.test(html)) {
		return html.replace(/(<html\b[^>]*>)/i, `$1\n<head>${snippet}</head>`);
	}
	return `<head>${snippet}</head>${html}`;
}

function _buildMediaShimScript(mediaMap) {
	const json = JSON.stringify(mediaMap).replace(/<\/script/gi, "<\\/script");
	return (
		"<script>(function(){const __M=" +
		json +
		";function _b(s){return String(s).split(/[/\\\\]/).pop();}" +
		"const _OA=window.Audio;" +
		"window.Audio=function(src){const m=typeof src==='string'?__M[_b(src)]:null;return new _OA(m||src);};" +
		"window.Audio.prototype=_OA.prototype;" +
		"})();</script>"
	);
}

function _refreshDocxButton() {
	const btn = document.getElementById("btn-docx");
	if (!btn) return;
	const names = Object.keys(_docUris);
	btn.style.display = names.length ? "" : "none";
	btn.textContent = names.length === 1 ? `📄 ${names[0]}` : "📄 Answer";
}

function _ensureDocxViewer() {
	let win = document.getElementById("docx-viewer");
	if (win) return win;
	win = document.createElement("div");
	win.id = "docx-viewer";
	win.innerHTML = `
		<div id="docx-viewer-head">
			<span id="docx-viewer-title">Answer</span>
			<button id="docx-viewer-close" title="Close">✕</button>
		</div>
		<div id="docx-viewer-body"></div>`;
	document.body.appendChild(win);
	makeDraggable(win.querySelector("#docx-viewer-head"), win);
	win.querySelector("#docx-viewer-close").onclick = _closeDocxViewer;
	return win;
}

function _closeDocxViewer() {
	const win = document.getElementById("docx-viewer");
	if (win) win.classList.remove("is-open");
}

async function _docxHtml(url) {
	if (_docHtmlCache[url] != null) return _docHtmlCache[url];
	const resp = await fetch(url);
	const buf = await resp.arrayBuffer();
	const result = await window.mammoth.convertToHtml({ arrayBuffer: buf });
	_docHtmlCache[url] = result.value || "";
	return _docHtmlCache[url];
}

async function toggleDocxViewer() {
	const win = _ensureDocxViewer();
	if (win.classList.contains("is-open")) {
		win.classList.remove("is-open");
		return;
	}
	const names = Object.keys(_docUris);
	if (!names.length) return;
	if (typeof window.mammoth === "undefined") {
		alert("Word viewer library (mammoth.js) failed to load.");
		return;
	}
	if (!win.style.left) {
		win.style.left = `${Math.round(window.innerWidth * 0.18)}px`;
		win.style.top = `${Math.round(window.innerHeight * 0.1)}px`;
	}
	win.querySelector("#docx-viewer-title").textContent =
		names.length === 1 ? names[0] : "Answer";
	const body = win.querySelector("#docx-viewer-body");
	body.textContent = "Converting…";
	win.classList.add("is-open");
	try {
		const sections = [];
		for (const name of names) {
			const html = await _docxHtml(_docUris[name]);
			const heading =
				names.length > 1
					? `<div class="docx-file-name">${escHtml(name)}</div>`
					: "";
			sections.push(heading + html);
		}
		body.innerHTML = sections.join("");
	} catch (e) {
		body.textContent = `Failed to render document: ${(e && e.message) || e}`;
	}
}
