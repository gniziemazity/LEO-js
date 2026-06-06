"use strict";

function _studentDocFiles(student) {
	if (!student || !student.id) return [];
	const sid = String(student.id).toLowerCase();
	const out = [];
	for (const [key, file] of _allFiles) {
		const m = key.match(/(?:^|\/)anon_ids\/([^/]+)\/(.+\.(docx|pdf))$/i);
		if (m && m[1] === sid) {
			out.push({
				name: m[2].split("/").pop(),
				file,
				ext: m[3].toLowerCase(),
			});
		}
	}
	return out;
}

function _appendDocLinks(el, student) {
	for (const d of _studentDocFiles(student)) {
		const a = document.createElement("span");
		a.className = "doc-link";
		a.textContent = d.ext === "pdf" ? "📕" : "📄";
		a.title = "Open " + d.name;
		a.addEventListener("click", (e) => {
			e.stopPropagation();
			_openStudentDoc(d);
		});
		el.appendChild(a);
	}
}

let _docViewerWired = false;
function _wireDocViewer() {
	if (_docViewerWired) return;
	const win = document.getElementById("doc-viewer");
	if (!win) return;
	_docViewerWired = true;
	const head = document.getElementById("doc-viewer-head");
	if (head && typeof makeDraggable === "function") makeDraggable(head, win);
	const close = document.getElementById("doc-viewer-close");
	if (close)
		close.addEventListener("click", () => win.classList.remove("is-open"));
}

async function _openStudentDoc(d) {
	_wireDocViewer();
	const win = document.getElementById("doc-viewer");
	const body = document.getElementById("doc-viewer-body");
	if (!win || !body) return;
	document.getElementById("doc-viewer-title").textContent = d.name;
	win.classList.add("is-open");
	body.style.padding = "";
	body.textContent = "Loading…";
	try {
		if (d.ext === "pdf") {
			let url = d.file.url;
			if (!url) {
				const buf = await readFileArray(d.file);
				url = URL.createObjectURL(
					new Blob([buf], { type: "application/pdf" }),
				);
			}
			body.style.padding = "0";
			body.innerHTML = "";
			const frame = document.createElement("iframe");
			frame.src = url;
			body.appendChild(frame);
		} else {
			if (typeof window.mammoth === "undefined") {
				body.textContent = "Word viewer (mammoth.js) failed to load.";
				return;
			}
			const buf = await readFileArray(d.file);
			const res = await window.mammoth.convertToHtml({ arrayBuffer: buf });
			body.innerHTML = res.value || "(empty document)";
		}
	} catch (e) {
		body.textContent = "Failed to open document: " + ((e && e.message) || e);
	}
}
