"use strict";

async function openDiffWindow(student) {
	const newWin = window.open("", "_blank");
	if (!newWin) {
		alert("Please allow popups for this page.");
		return;
	}

	try {
		const studentDir = (
			CFG.STUDENT_SUBDIR +
			"/" +
			student.name +
			"/"
		).toLowerCase();

		const teacherEntries = [..._allFiles.entries()].filter(
			([p]) => /^correct\//i.test(p) && /\.(html|css|js)$/i.test(p),
		);

		const studentEntries = [..._allFiles.entries()].filter(
			([p]) =>
				p.toLowerCase().startsWith(studentDir) &&
				/\.(html|css|js)$/i.test(p),
		);

		let diffMarks = null;
		const diffMarksKey = studentDir + "diff_marks.json";
		const diffMarksEntry = [..._allFiles.entries()].find(
			([p]) => p.toLowerCase() === diffMarksKey,
		);
		if (diffMarksEntry) {
			try {
				diffMarks = JSON.parse(await diffReadText(diffMarksEntry[1]));
			} catch {}
		}

		const teacherFilesColors = diffMarks ? diffMarks.teacher_files || {} : {};
		const studentFilesColors = diffMarks ? diffMarks.student_files || {} : {};
		const caseSensitive = diffMarks
			? diffMarks.case_sensitive === true
			: false;

		const teacherFiles = {};
		for (const [path, file] of teacherEntries) {
			teacherFiles[path.split("/").pop()] = await diffReadText(file);
		}
		const studentFiles = {};
		for (const [path, file] of studentEntries) {
			studentFiles[path.split("/").pop()] = await diffReadText(file);
		}

		const html = diffBuildHtml(
			student,
			teacherFiles,
			teacherFilesColors,
			studentFiles,
			studentFilesColors,
			caseSensitive,
		);
		newWin.document.open();
		newWin.document.write(html);
		newWin.document.close();
	} catch (err) {
		console.error("[KLA diff]", err);
		newWin.document.open();
		newWin.document.write(
			`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:20px;color:#c00">` +
				`<b>Error opening diff window:</b><br>${escHtml(err.message)}</body></html>`,
		);
		newWin.document.close();
	}
}

const DIFF_LABEL_COLORS = {
	missing: "#e00",
	comment: "#4a4",
	extra: "#00c",
	extra_star: "#a000c0",
	extra_comment: "#080",
};

function buildFileOccurrenceMap(filesColorData, filename, caseSensitive) {
	const map = new Map();
	if (!filesColorData) return map;
	const fileData = filesColorData[filename] || {};
	for (const [tok, entries] of Object.entries(fileData)) {
		if (!Array.isArray(entries)) continue;
		const colors = entries.map((e) =>
			e && typeof e === "string" ? (DIFF_LABEL_COLORS[e] ?? e) : e,
		);
		if (colors.some((c) => c))
			map.set(caseSensitive ? tok : tok.toUpperCase(), colors);
	}
	return map;
}

function diffReadText(file) {
	return new Promise((res, rej) => {
		const r = new FileReader();
		r.onload = (e) => res(e.target.result);
		r.onerror = () => rej(new Error("Could not read: " + file.name));
		r.readAsText(file);
	});
}

function diffSortNames(names, preferReconstructed) {
	const html = names.filter((n) => /\.html$/i.test(n));
	const css = names.filter((n) => /\.css$/i.test(n));
	const js = names.filter((n) => /\.js$/i.test(n));
	if (preferReconstructed) {
		const ri = html.findIndex(
			(n) => n.toLowerCase() === "reconstructed.html",
		);
		if (ri > 0) {
			const reordered = [html[ri], ...html.filter((_, i) => i !== ri)];
			return [...reordered, ...css, ...js];
		}
	}
	return [...html, ...css, ...js];
}

function diffColorize(text, occurrenceMap, caseSensitive) {
	if (!occurrenceMap || !occurrenceMap.size) return escHtml(text);

	const escaped = escHtml(text);
	const searchText = caseSensitive ? escaped : escaped.toUpperCase();
	const marks = [];

	for (const [token, occColors] of occurrenceMap) {
		if (!occColors.some((c) => c)) continue;

		const rePat = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const startsWord = /^\w/.test(token);
		const endsWord = /\w$/.test(token);
		let pattern = rePat;
		if (startsWord) {
			pattern = (token.includes("-") ? "(?<![.\\w])" : "(?<!\\w)") + rePat;
		}
		if (endsWord) {
			pattern = pattern + "(?!\\w)";
		}
		const re = new RegExp(pattern, "g");

		const positions = [];
		let m;
		while ((m = re.exec(searchText)) !== null) {
			positions.push({ start: m.index, end: m.index + m[0].length });
		}

		for (let i = 0; i < Math.min(positions.length, occColors.length); i++) {
			const color = occColors[i];
			if (color) {
				marks.push({
					start: positions[i].start,
					end: positions[i].end,
					color,
					raw: escaped.slice(positions[i].start, positions[i].end),
				});
			}
		}
	}

	if (!marks.length) return escaped;

	marks.sort((a, b) => a.start - b.start || b.end - a.end);

	const kept = [];
	let lastEnd = 0;
	for (const m of marks) {
		if (m.start >= lastEnd) {
			kept.push(m);
			lastEnd = m.end;
		}
	}

	let out = "",
		pos = 0;
	for (const m of kept) {
		out += escaped.slice(pos, m.start);
		out += `<span style="color:${m.color};font-weight:bold">${m.raw}</span>`;
		pos = m.end;
	}
	out += escaped.slice(pos);
	return out;
}

function diffBuildHtml(
	student,
	teacherFiles,
	teacherFilesColors,
	studentFiles,
	studentFilesColors,
	caseSensitive,
) {
	const followPct =
		student.follow_pct != null ? student.follow_pct.toFixed(1) + "%" : "N/A";
	const teacherNames = diffSortNames(Object.keys(teacherFiles), true);
	const studentNames = diffSortNames(Object.keys(studentFiles), false);

	function tabBar(panelId, names) {
		if (!names.length) return "";
		return names
			.map(
				(n, i) =>
					`<button class="tab${i === 0 ? " active" : ""}" ` +
					`onclick="switchTab('${panelId}',${i})" ` +
					`data-panel="${panelId}" data-idx="${i}">${escHtml(n)}</button>`,
			)
			.join("");
	}

	function codePanes(panelId, names, files, filesColorData) {
		if (!names.length) return `<div class="empty-msg">No files found</div>`;
		return names
			.map((n, i) => {
				const content = files[n] || "";
				const occMap = buildFileOccurrenceMap(
					filesColorData,
					n,
					caseSensitive,
				);
				const colorized = diffColorize(content, occMap, caseSensitive);
				return (
					`<div class="pane${i === 0 ? " active" : ""}" ` +
					`data-panel="${panelId}" data-idx="${i}"><pre>${colorized}</pre></div>`
				);
			})
			.join("");
	}

	const css = `
*, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
html, body { height:100%; overflow:hidden;
  font-family:'Segoe UI',sans-serif; font-size:13px;
  background:#e8e8e8; color:#555; }
body { display:flex; flex-direction:column; }
#content { display:flex; flex:1; overflow:hidden; }
.panel { display:flex; flex-direction:column; flex:1; min-width:0;
         border-right:2px solid #ccc; overflow:hidden; }
.panel:last-child { border-right:none; }
.panel-title { background:#e8e8e8; padding:4px 10px; font-size:11px; font-weight:700;
               color:#555; text-transform:uppercase; letter-spacing:.6px;
               flex-shrink:0; border-bottom:1px solid #ccc; }
.tab-bar { display:flex; background:#f3f3f3; border-bottom:1px solid #ddd;
           flex-shrink:0; overflow-x:auto; }
.tab { padding:4px 14px; border:none; background:transparent; color:#666;
       cursor:pointer; font:12px Consolas,monospace; border-bottom:2px solid transparent;
       white-space:nowrap; }
.tab.active { color:#007acc; border-bottom-color:#007acc; }
.tab:hover:not(.active) { background:#e8e8e8; color:#333; }
.code-wrap { flex:1; overflow:hidden; position:relative; }
.pane { display:none; height:100%; overflow:auto; }
.pane.active { display:block; }
.pane pre { padding:8px; font-family:Consolas,'Courier New',monospace;
            font-size:12px; line-height:1.5; color:#aaa;
            background:#fff; white-space:pre-wrap; word-wrap:break-word;
            tab-size:4; -moz-tab-size:4;
            min-height:100%; }
.empty-msg { padding:20px; color:#aaa; font-style:italic; font-size:13px; }
`;

	const switchTabScript = `
function switchTab(panelId, idx) {
  document.querySelectorAll('[data-panel="'+panelId+'"]')
    .forEach(el => el.classList.remove('active'));
  document.querySelectorAll('[data-panel="'+panelId+'"][data-idx="'+idx+'"]')
    .forEach(el => el.classList.add('active'));
}`;

	return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8">
<title>${escHtml(student.name)} (${escHtml(followPct)})</title>
<style>${css}</style>
</head><body>
<div id="content">
  <div class="panel">
    <div class="panel-title">Teacher</div>
    <div class="tab-bar">${tabBar("teacher", teacherNames)}</div>
    <div class="code-wrap">${codePanes("teacher", teacherNames, teacherFiles, teacherFilesColors)}</div>
  </div>
  <div class="panel">
    <div class="panel-title">${escHtml(student.name)} (${escHtml(followPct)})</div>
    <div class="tab-bar">${tabBar("student", studentNames)}</div>
    <div class="code-wrap">${codePanes("student", studentNames, studentFiles, studentFilesColors)}</div>
  </div>
</div>
<script>${switchTabScript}<\/script>
</body></html>`;
}
