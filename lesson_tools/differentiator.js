"use strict";

const DIFF_LABEL_COLORS = {
	missing: "#e00",
	comment: "#4a4",
	extra: "#00c",
	extra_star: "#a000c0",
	extra_comment: "#080",
};

let _teacherFiles = null;
let _studentFiles = null;
let _teacherMarks = null;
let _studentMarks = null;
let _imageUris = {}; // basename → data: URI for preview image inlining

window.addEventListener("DOMContentLoaded", () => {
	const key = new URLSearchParams(location.search).get("key") || "diffData";
	const raw = localStorage.getItem(key);
	if (raw) {
		localStorage.removeItem(key);
		try {
			const data = JSON.parse(raw);
			_teacherFiles = data.teacherFiles || {};
			_studentFiles = data.studentFiles || {};
			_teacherMarks = data.teacherMarks || null;
			_studentMarks = data.studentMarks || null;
			_imageUris = data.imageUris || {};
			if (data.title) document.title = data.title;
			document.getElementById("title-student").textContent =
				data.title || "Student";
			renderPanel("teacher", _teacherFiles, _teacherMarks);
			renderPanel("student", _studentFiles, _studentMarks);
		} catch (e) {
			console.error("[Differentiator] Failed to parse diff data", e);
		}
	}

	document.getElementById("input-teacher").addEventListener("change", (e) => {
		loadFilesFromInput(e.target.files, "teacher");
	});
	document.getElementById("input-student").addEventListener("change", (e) => {
		loadFilesFromInput(e.target.files, "student");
	});
});

function loadFilesFromInput(files, side) {
	const texts = {};
	let diffMarks = null;
	let pending = files.length;
	if (!pending) return;

	for (const file of files) {
		const reader = new FileReader();
		reader.onload = (e) => {
			if (file.name.toLowerCase() === "diff_marks.json") {
				try {
					diffMarks = JSON.parse(e.target.result);
				} catch {}
			} else {
				texts[file.name] = e.target.result;
			}
			pending--;
			if (pending === 0) {
				const marks = diffMarks
					? (side === "teacher"
							? diffMarks.teacher_files
							: diffMarks.student_files) || null
					: null;

				if (side === "teacher") {
					_teacherFiles = texts;
					_teacherMarks = marks;
				} else {
					_studentFiles = texts;
					_studentMarks = marks;
				}
				renderPanel(
					side,
					side === "teacher" ? _teacherFiles : _studentFiles,
					marks,
				);
			}
		};
		reader.readAsText(file);
	}
}

function renderPanel(side, files, marks) {
	if (!files || !Object.keys(files).length) return;

	const landing = document.getElementById(`landing-${side}`);
	const content = document.getElementById(`content-${side}`);
	const tabs = document.getElementById(`tabs-${side}`);
	const codeWrap = document.getElementById(`code-${side}`);
	const previewBtn = document.getElementById("btn-preview");
	const previewFrame = document.getElementById(`preview-${side}`);

	landing.style.display = "none";
	content.style.display = "flex";
	if (side === "teacher") {
		if (previewBtn) previewBtn.style.display = "block";
	}

	// reset preview state when reloading
	if (previewFrame) {
		previewFrame.style.display = "none";
		if (side === "teacher" && previewBtn) {
			previewBtn.classList.remove("active");
			previewBtn.textContent = "⬜ Preview";
		}
	}
	codeWrap.style.display = "";

	const allNames = Object.keys(files).filter((n) =>
		/\.(html|css|js)$/i.test(n),
	);
	const names = sortFileNames(allNames, side === "teacher");

	tabs.innerHTML = "";
	codeWrap.innerHTML = "";

	names.forEach((name, i) => {
		const btn = document.createElement("button");
		btn.className = "file-tab" + (i === 0 ? " file-tab-active" : "");
		btn.textContent = name;
		btn.onclick = () => {
			tabs
				.querySelectorAll(".file-tab")
				.forEach((t) => t.classList.remove("file-tab-active"));
			codeWrap
				.querySelectorAll(".code-pane")
				.forEach((p) => p.classList.remove("active"));
			btn.classList.add("file-tab-active");
			codeWrap.children[i].classList.add("active");
		};
		tabs.appendChild(btn);

		const pane = document.createElement("div");
		pane.className = "code-pane" + (i === 0 ? " active" : "");

		const text = files[name] || "";
		const fileMarks = marks ? marks[name] || null : null;
		const html = Array.isArray(fileMarks)
			? diffColorizePositions(text, fileMarks)
			: escHtml(text);

		pane.innerHTML = `<pre>${html}</pre>`;
		codeWrap.appendChild(pane);
	});

	if (localStorage.getItem("diff-preview-mode") === "preview") {
		const files = side === "teacher" ? _teacherFiles : _studentFiles;
		const iframe = document.getElementById(`preview-${side}`);
		if (files && Object.keys(files).length && iframe) {
			updatePreview(side, files, iframe);
			iframe.style.display = "block";
			codeWrap.style.display = "none";
		}
		if (side === "teacher" && previewBtn) {
			previewBtn.textContent = "📄 Code";
			previewBtn.classList.add("active");
		}
	}
}

function sortFileNames(names, preferReconstructed) {
	const html = names.filter((n) => /\.html$/i.test(n));
	const css = names.filter((n) => /\.css$/i.test(n));
	const js = names.filter((n) => /\.js$/i.test(n));
	if (preferReconstructed) {
		const ri = html.findIndex(
			(n) => n.toLowerCase() === "reconstructed.html",
		);
		if (ri > 0) {
			return [
				[html[ri], ...html.filter((_, i) => i !== ri)],
				css,
				js,
			].flat();
		}
	}
	return [...html, ...css, ...js];
}

function escHtml(s) {
	return String(s)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function diffColorizePositions(text, posMarks) {
	if (!posMarks || !posMarks.length) return escHtml(text);
	const colored = posMarks.filter(
		(m) => m.label && DIFF_LABEL_COLORS[m.label],
	);
	if (!colored.length) return escHtml(text);

	const normText = text.replace(/\r\n/g, "\n");

	colored.sort((a, b) => a.start - b.start || b.end - a.end);
	const kept = [];
	let lastEnd = 0;
	for (const m of colored) {
		if (m.start >= lastEnd) {
			kept.push(m);
			lastEnd = m.end;
		}
	}

	let out = "",
		pos = 0;
	for (const m of kept) {
		out += escHtml(normText.slice(pos, m.start));
		const color = DIFF_LABEL_COLORS[m.label];
		out += `<span style="color:${color};font-weight:bold">${escHtml(normText.slice(m.start, m.end))}</span>`;
		pos = m.end;
	}
	out += escHtml(normText.slice(pos));
	return out;
}

function togglePreview() {
	const btn = document.getElementById("btn-preview");
	const isPreview = btn && btn.classList.contains("active");

	for (const side of ["teacher", "student"]) {
		const codeWrap = document.getElementById(`code-${side}`);
		const tabs = document.getElementById(`tabs-${side}`);
		const iframe = document.getElementById(`preview-${side}`);
		const content = document.getElementById(`content-${side}`);
		if (!codeWrap || content.style.display === "none") continue;

		if (isPreview) {
			if (iframe) iframe.style.display = "none";
			codeWrap.style.display = "";
		} else {
			const files = side === "teacher" ? _teacherFiles : _studentFiles;
			if (!files || !Object.keys(files).length) continue;
			if (iframe) {
				updatePreview(side, files, iframe);
				iframe.style.display = "block";
			}
			codeWrap.style.display = "none";
		}
	}

	if (btn) {
		if (isPreview) {
			btn.textContent = "\u2b1c Preview";
			btn.classList.remove("active");
		} else {
			btn.textContent = "\ud83d\udcc4 Code";
			btn.classList.add("active");
		}
	}
	localStorage.setItem("diff-preview-mode", isPreview ? "code" : "preview");
}

function updatePreview(side, files, iframe) {
	const htmlEntry = Object.entries(files).find(([name]) =>
		/\.html$/i.test(name),
	);
	if (!htmlEntry) {
		iframe.srcdoc =
			"<p style='font-family:sans-serif;padding:20px;color:#888'>No HTML file found.</p>";
		return;
	}
	const html = htmlEntry[1];
	const filesMap = { ..._imageUris };
	for (const [name, content] of Object.entries(files)) {
		if (!/\.html$/i.test(name)) filesMap[name] = content;
	}
	iframe.srcdoc = inlineFilesInHtml(html, filesMap) || "";
}
