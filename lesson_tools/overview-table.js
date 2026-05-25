"use strict";

function renderTable() {
	const table = document.getElementById("grades-table");
	table.innerHTML = "";
	table.classList.remove("anon-name", "anon-id");
	if (_anonMode === "name") table.classList.add("anon-name");
	else if (_anonMode === "id") table.classList.add("anon-id");

	const thead = document.createElement("thead");
	const r1 = document.createElement("tr");
	const r2 = document.createElement("tr");

	const mkBase = (cls) => {
		const th = document.createElement("th");
		th.className = "grp" + (cls ? " " + cls : "");
		r1.appendChild(th);
	};
	mkBase("col-id sticky-l");
	mkBase("col-name sticky-l");
	mkBase("col-num sticky-l");
	mkBase();
	mkBase();

	const grp = (label, colspan, sep = false) => {
		const th = document.createElement("th");
		th.textContent = label;
		th.colSpan = colspan;
		th.className = "grp";
		if (sep) th.classList.add("asn-sep");
		r1.appendChild(th);
		return th;
	};
	const col = (label, cls = "", sep = false) => {
		const th = document.createElement("th");
		th.textContent = label;
		if (cls) th.className = cls;
		if (sep) th.classList.add("asn-sep");
		r2.appendChild(th);
	};

	col("ID", "col-id sticky-l");
	col("Name", "col-name sticky-l");
	col("#", "col-num sticky-l");
	col("KPM");
	col("Self");

	for (const a of ASSIGNMENTS) {
		if (a.follow != null) {
			attachLessonGroup(grp(a.name, 5, true), a);
			col("Follow%", "lhd", true);
			col("Obs", "lhd");
			col("Grade", "ahd");
			col("Status", "ahd");
			col("Obs", "ahd");
		} else {
			attachLessonGroup(grp(a.name, 3, true), a);
			col("Grade", "ahd", true);
			col("Status", "ahd");
			col("Obs", "ahd");
		}
	}
	grp("", 8, true);
	col("Quiz", "", true);
	col("KPM");
	col("Avg");
	col("Part%");
	col("Ans");
	col("Qs");
	col("Help");
	col("Comments");

	thead.appendChild(r1);
	thead.appendChild(r2);
	table.appendChild(thead);

	const cdiffMin = Math.min(0, ..._students.map((s) => s.total_cdiff ?? 0));
	const cdiffMax = Math.max(0, ..._students.map((s) => s.total_cdiff ?? 0));

	const tbody = document.createElement("tbody");
	_students.forEach((s) => {
		const tr = document.createElement("tr");
		tr.classList.add(s.passed_course ? "row-pass" : "row-fail");
		if (s.excluded) tr.classList.add("row-excluded");

		const cell = (content, cls = "") => {
			const td = document.createElement("td");
			if (cls) td.className = cls;
			td.textContent = content ?? "";
			return td;
		};
		const obsCell = (entry, cls = "") => {
			const td = document.createElement("td");
			if (cls) td.className = cls;
			const badges = trapBadges(entry.obs, entry.name);
			if (badges) {
				td.innerHTML = badges;
				td.title = `${entry.name} traps (${entry.obs}) — green = ok, red = trap fired`;
			} else {
				td.textContent = obsText(entry.obs);
			}
			return td;
		};

		tr.appendChild(cell(s.id, "id-cell col-id sticky-l"));
		tr.appendChild(cell(studentLabel(s), "name-cell col-name sticky-l"));
		tr.appendChild(cell(s.number, "num col-num sticky-l"));
		tr.appendChild(cell(fmtN(s.pre_typing), "num"));
		tr.appendChild(cell(fmtN(s.self_eval), "num"));

		for (const entry of s.lessons) {
			if (entry.hasFollowCol) {
				const fc = document.createElement("td");
				fc.className = "follow clickable asn-sep";
				fc.title = `Open ${entry.name} lesson`;
				fc.addEventListener("click", () => openLessonDiff(s, entry));
				if (entry.follow != null) {
					fc.textContent = entry.follow.toFixed(0) + "%";
					fc.style.color = followFg(entry.follow);
				}
				tr.appendChild(fc);
				tr.appendChild(cell(obsText(entry.lesson_obs)));

				const gc = document.createElement("td");
				gc.className = "follow clickable asn-col";
				gc.title = `Open ${entry.name} assignment`;
				gc.addEventListener("click", () => openAssignDiff(s, entry));
				if (entry.grade != null) {
					gc.textContent = entry.grade;
					gc.style.color = followFg((entry.grade / 5) * 100);
					gc.style.fontWeight = "700";
				}
				tr.appendChild(gc);
				const stc1 = document.createElement("td");
				stc1.textContent = entry.status || "";
				const sc1 = statusCellCls(entry.status);
				stc1.className = sc1 || "asn-col";
				tr.appendChild(stc1);
				tr.appendChild(obsCell(entry, "asn-col"));
			} else {
				const gc = document.createElement("td");
				gc.className = "follow clickable asn-sep asn-col";
				gc.title = `Open ${entry.name} assignment`;
				gc.addEventListener("click", () => openAssignDiff(s, entry));
				if (entry.grade != null) {
					gc.textContent = entry.grade;
					gc.style.color = followFg((entry.grade / 5) * 100);
					gc.style.fontWeight = "700";
				}
				tr.appendChild(gc);
				const stc2 = document.createElement("td");
				stc2.textContent = entry.status || "";
				const sc2 = statusCellCls(entry.status);
				stc2.className = sc2 || "asn-col";
				tr.appendChild(stc2);
				tr.appendChild(obsCell(entry, "asn-col"));
			}
		}

		tr.appendChild(cell(fmtN(s.quiz_stii), "num asn-sep"));
		tr.appendChild(cell(fmtN(s.post_typing), "num"));
		tr.appendChild(cell(fmtN(s.avg_assignments, 1), "num"));

		const pc = document.createElement("td");
		pc.className = "num";
		if (s.participation != null) {
			pc.textContent = s.participation.toFixed(0) + "%";
			pc.style.color = followFg(s.participation);
		} else {
			pc.textContent = "—";
			pc.style.color = THEME.codeMuted;
		}
		pc.style.fontWeight = "700";
		tr.appendChild(pc);

		tr.appendChild(numCellBold(s.total_a));
		tr.appendChild(numCellBold(s.total_q));
		tr.appendChild(numCellBold(s.total_h));
		tr.appendChild(cdiffCell(s.total_cdiff, cdiffMin, cdiffMax));
		tr.addEventListener("click", () => {
			tbody
				.querySelectorAll("tr.selected")
				.forEach((r) => r.classList.remove("selected"));
			tr.classList.add("selected");
		});
		tbody.appendChild(tr);
	});
	table.appendChild(tbody);
}

function numCellBold(v) {
	const td = document.createElement("td");
	td.className = "num";
	if (v != null && !isNaN(v) && +v !== 0) {
		td.textContent = Math.round(+v).toString();
		td.style.fontWeight = "700";
	}
	return td;
}

function cdiffCell(v, vmin, vmax) {
	const td = document.createElement("td");
	td.className = "num";
	if (v == null || isNaN(v)) return td;
	const n = +v;
	td.textContent = n > 0 ? "+" + n : String(n);
	td.style.fontWeight = "700";
	if (n === 0) {
		td.style.color = THEME.black;
	} else if (n < 0 && vmin < 0) {
		const t = Math.min(1, n / vmin);
		td.style.color = `rgb(${Math.round(204 * t)}, ${Math.round(34 * t)}, ${Math.round(34 * t)})`;
	} else if (n > 0 && vmax > 0) {
		const t = Math.min(1, n / vmax);
		td.style.color = `rgb(0, ${Math.round(122 * t)}, ${Math.round(204 * t)})`;
	} else {
		td.style.color = THEME.black;
	}
	return td;
}

function applyStickyColumns() {
	const table = document.getElementById("grades-table");
	if (!table) return;
	const r2Sticky = table.querySelectorAll("thead tr:nth-child(2) th.sticky-l");
	let acc = 0;
	const lefts = [];
	r2Sticky.forEach((th) => {
		lefts.push(acc);
		acc += th.offsetWidth;
	});
	table.querySelectorAll("tr").forEach((row) => {
		row.querySelectorAll(".sticky-l").forEach((cell, i) => {
			if (i < lefts.length) cell.style.left = lefts[i] + "px";
		});
	});
	const hdr1 = table.querySelector("thead tr:first-child");
	const hdr2 = table.querySelector("thead tr:last-child");
	if (hdr1 && hdr2 && hdr1 !== hdr2)
		hdr2.querySelectorAll("th").forEach((th) => {
			th.style.top = hdr1.offsetHeight + "px";
		});
}

function onAnonChange(val) {
	_anonMode = val;
	if (_students.length) {
		renderTable();
		renderStats();
		renderProgress();
		renderClusters();
	} else {
		const table = document.getElementById("grades-table");
		table.classList.remove("anon-name", "anon-id");
		if (val === "name") table.classList.add("anon-name");
		else if (val === "id") table.classList.add("anon-id");
	}
	requestAnimationFrame(applyStickyColumns);
}

function studentLabel(s) {
	if (!s) return "";
	if (_anonMode === "id") return s.id || "—";
	if (_anonMode === "name") return _realToAlterMap[_nfc(s.name)] || s.name;
	return s.name;
}

function studentLabelWithId(s) {
	if (!s) return "";
	if (_anonMode === "id") return s.id || "—";
	const name = studentLabel(s);
	return s.id ? `${s.id}. ${name}` : name;
}

function fmtN(v, dec = 0) {
	if (v == null || isNaN(v)) return null;
	return dec > 0 ? (+v).toFixed(dec) : Math.round(+v).toString();
}
function followFg(pct) {
	if (pct < 40) return THEME.red;
	if (pct < 60) return _cssVar("--clr-orange");
	if (pct < 75) return THEME.label;
	return THEME.textStrong;
}
function statusCellCls(s) {
	if (!s) return "";
	return (
		{
			Pass: "st-bg-pass",
			"Pass'": "st-bg-prime",
			"Pass*": "st-bg-star",
			"Fail*": "st-bg-fail",
			Fail: "st-bg-fail",
		}[s] || ""
	);
}
function obsText(raw) {
	return !raw || !raw.trim() ? "" : raw.trim();
}

function trapBadges(raw, assignmentName) {
	const code = (raw ?? "").trim();
	if (!/^[01]+$/.test(code)) return null;
	const schema = _trapSchema[(assignmentName || "").toLowerCase()];
	if (!schema || schema.length !== code.length) return null;
	return schema
		.map((t, i) => {
			const fired = code[i] === "0";
			const clr = fired ? THEME.red : THEME.green;
			const title = `${t.label} — ${fired ? "trap fired (0)" : "ok (1)"}`;
			return (
				`<span title="${escHtml(title)}" style="display:inline-block;` +
				`width:9px;height:9px;border-radius:2px;margin:0 1px;` +
				`vertical-align:middle;background:${clr}"></span>`
			);
		})
		.join("");
}

async function openLessonDiff(student, entry) {
	const key = findHandle(_lessonHandles, entry.name);
	console.log(
		"[overview] openLessonDiff student.id =",
		student.id,
		"entry.name =",
		entry.name,
		"entry.follow =",
		entry.follow,
		"resolved lesson folder key =",
		key,
	);
	if (!key) {
		alert(`No lesson folder found for "${entry.name}".`);
		return;
	}
	await openDiff(_lessonHandles[key], student, entry.follow);
}
async function openAssignDiff(student, entry) {
	const key = findHandle(_assignHandles, entry.name);
	console.log(
		"[overview] openAssignDiff student.id =",
		student.id,
		"entry.name =",
		entry.name,
		"resolved assign folder key =",
		key,
	);
	if (!key) {
		alert(`No assignment folder found for "${entry.name}".`);
		return;
	}
	await openDiff(_assignHandles[key], student, null);
}
function findHandle(handles, name) {
	const nl = name.toLowerCase();
	if (handles[nl]) return nl;
	for (const k of Object.keys(handles))
		if (k.includes(nl) || nl.includes(k)) return k;
	return null;
}
function attachLessonGroup(th, assignment) {
	const key = findHandle(_lessonHandles, assignment.name);
	if (!key) return;
	const handle = _lessonHandles[key];
	th.classList.add("clickable");
	th.title = `Open ${assignment.name} timeline`;
	th.addEventListener("click", async () => {
		try {
			const perm = await handle.requestPermission({ mode: "read" });
			if (perm !== "granted") {
				alert(`Permission denied for "${assignment.name}" folder.`);
				return;
			}
			await _idbSet("lastDir", handle);
			window.open("timeline.html?autoload=1", "_blank");
		} catch (e) {
			alert("Could not open timeline: " + e.message);
		}
	});
}

async function _readOverviewDiffPayload(dirHandle, student, followPct) {
	const sid = (student.id || "").trim();
	if (!sid)
		throw new Error(`Cannot find anon folder for "${student.name}" (no ID).`);

	console.log(
		"[overview] _readOverviewDiffPayload dirHandle.name =",
		dirHandle.name,
		"sid =",
		sid,
		"followPct =",
		followPct,
	);

	const fileMap = new Map();
	await readDirHandle(dirHandle, "", fileMap, [], { lowercaseKeys: true });
	const anonIdsKeys = [...fileMap.keys()].filter((p) =>
		p.startsWith("anon_ids/"),
	);
	const anonIdFolders = [
		...new Set(anonIdsKeys.map((p) => p.split("/")[1])),
	].sort();
	console.log("[overview] anon_ids/ folders inside lesson:", anonIdFolders);
	console.log(
		"[overview] anon_ids/" + sid.toLowerCase() + "/ present? =",
		anonIdFolders.includes(sid.toLowerCase()),
	);

	const studentPrefix = "anon_ids/" + sid.toLowerCase() + "/";
	const { teacherFiles, studentFiles, allMarks, imageUris } =
		await buildDiffPayloadData(fileMap, studentPrefix);

	if (!Object.keys(teacherFiles).length && !Object.keys(studentFiles).length) {
		throw new Error(`No code files found for ${student.name}.`);
	}

	const label = followPct != null ? followPct.toFixed(0) + "%" : "assignment";
	return {
		teacherFiles,
		studentFiles,
		allMarks,
		imageUris,
		title: `${student.id ? escHtml(String(student.id)) + ". " : ""}${escHtml(studentLabel(student))} (${escHtml(label)})`,
	};
}

async function openDiff(dirHandle, student, followPct) {
	try {
		showLoading(true);
		await openDifferentiator(() =>
			_readOverviewDiffPayload(dirHandle, student, followPct),
		);
		showLoading(false);
	} catch (e) {
		showLoading(false);
		alert("Error: " + e.message);
	}
}
