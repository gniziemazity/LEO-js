"use strict";

const MOODLE_COMMENT_COL_RE = /^comments?$/i;
const MOODLE_GRADE_COL_RE = /^grade$/i;

function _moodleRemarkValue(student, re) {
	const rk = (student.remarks || []).find((r) => re.test(r.col));
	return rk && rk.val != null ? String(rk.val).trim() : "";
}

function _moodleFeedbackRows() {
	const rows = [];
	for (const s of _students || []) {
		const name = String(s.name || "").trim();
		if (!name) continue;
		const comment = _moodleRemarkValue(s, MOODLE_COMMENT_COL_RE);
		const curated = _moodleRemarkValue(s, MOODLE_GRADE_COL_RE);
		const pct = Number(s.followPct);
		const grade = curated
			? curated
			: Number.isFinite(pct)
				? String(Math.round(pct))
				: null;
		if (!comment && grade == null) continue;
		const source = grade == null ? null : curated ? "grade" : "follow";
		rows.push({ name, comment, grade, source });
	}
	return rows;
}

const _moodleFiller = async function (ROWS) {
	const GRADE_SELECT_SELECTORS = [
		'select[name^="quickgrade_"]',
		"select.quickgrade",
		'select[name*="grade"]',
	];
	const GRADE_FIELD_SELECTORS = [
		'input[name^="quickgrade_"]',
		'input[id^="quickgrade_"]',
		'input[type="text"][name*="grade"]',
		'input[type="number"][name*="grade"]',
	];
	const GRADE_OK = ["dropdown", "field"];
	const COMMENT_TOGGLE_SELECTORS = [
		"a.comment-link",
		'[id^="comment-link"]',
		'[data-region="comment-link"]',
	];
	const COMMENT_BOX_SELECTORS = [
		"textarea.comment-area-text",
		".comment-area textarea",
		'textarea[name="content"]',
	];

	const norm = (s) =>
		String(s == null ? "" : s)
			.replace(/\s+/g, " ")
			.trim()
			.toLowerCase();
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

	function pick(root, selectors) {
		for (const sel of selectors) {
			const el = root.querySelector(sel);
			if (el) return el;
		}
		return null;
	}

	function setInputValue(el, value) {
		const proto =
			el instanceof HTMLTextAreaElement
				? HTMLTextAreaElement.prototype
				: HTMLInputElement.prototype;
		const desc = Object.getOwnPropertyDescriptor(proto, "value");
		if (desc && desc.set) desc.set.call(el, value);
		else el.value = value;
		el.dispatchEvent(new Event("input", { bubbles: true }));
		el.dispatchEvent(new Event("change", { bubbles: true }));
	}

	function setFieldValue(el, value) {
		if (!el) return false;
		if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
			setInputValue(el, value);
			return true;
		}
		if (el.isContentEditable) {
			el.innerHTML = "";
			const p = document.createElement("p");
			p.textContent = value;
			el.appendChild(p);
			el.dispatchEvent(new Event("input", { bubbles: true }));
			const wrap = el.closest(".editor_atto") || el.parentElement;
			const hidden =
				wrap && wrap.parentElement
					? wrap.parentElement.querySelector("textarea")
					: null;
			if (hidden) setInputValue(hidden, "<p>" + value + "</p>");
			return true;
		}
		return false;
	}

	function numOf(v) {
		const n = Number(
			String(v == null ? "" : v)
				.replace(",", ".")
				.trim(),
		);
		return Number.isFinite(n) ? n : null;
	}

	function findOption(sel, value) {
		const opts = Array.from(sel.options || []);
		const want = norm(value);
		const byText = opts.find((o) => norm(o.textContent) === want);
		if (byText) return byText;
		const wantNum = numOf(value);
		if (wantNum == null) return null;
		return opts.find((o) => numOf(o.textContent) === wantNum) || null;
	}

	function setSelectValue(sel, value) {
		const opt = findOption(sel, value);
		if (!opt) return false;
		sel.value = opt.value;
		sel.dispatchEvent(new Event("input", { bubbles: true }));
		sel.dispatchEvent(new Event("change", { bubbles: true }));
		return true;
	}

	function fillGrade(tr, row) {
		const dropdown = pick(tr, GRADE_SELECT_SELECTORS);
		const field = pick(tr, GRADE_FIELD_SELECTORS);
		const wantsDropdown = row.source === "grade";
		for (const el of wantsDropdown ? [dropdown, field] : [field, dropdown]) {
			if (!el) continue;
			if (el.tagName === "SELECT") {
				if (setSelectValue(el, row.grade)) return "dropdown";
			} else if (setFieldValue(el, String(row.grade))) return "field";
		}
		if (!dropdown && !field) return "NO FIELD";
		return "NO MATCH";
	}

	function findRow(name) {
		const want = norm(name);
		const trs = Array.from(document.querySelectorAll("tr"));
		const exact = trs.find((tr) =>
			Array.from(tr.querySelectorAll("td,th")).some(
				(c) => norm(c.textContent) === want,
			),
		);
		if (exact) return exact;
		return (
			trs.find((tr) => {
				const link = tr.querySelector('a[href*="/user/view.php"]');
				return link && norm(link.textContent).includes(want);
			}) || null
		);
	}

	async function openComments(tr) {
		let box = pick(tr, COMMENT_BOX_SELECTORS);
		if (box && box.offsetParent !== null) return box;
		const toggle = pick(tr, COMMENT_TOGGLE_SELECTORS);
		if (!toggle) return box;
		toggle.click();
		for (let i = 0; i < 25; i++) {
			await sleep(100);
			box = pick(tr, COMMENT_BOX_SELECTORS);
			if (box && box.offsetParent !== null) return box;
		}
		return box;
	}

	const report = [];
	let touched = 0;
	for (const row of ROWS) {
		const tr = findRow(row.name);
		if (!tr) {
			report.push({
				student: row.name,
				row: "NOT FOUND",
				grade: "-",
				comments: "-",
			});
			continue;
		}
		const grade = row.grade == null ? "skipped" : fillGrade(tr, row);
		let comments = "skipped";
		if (row.comment) {
			comments = setFieldValue(await openComments(tr), row.comment)
				? "ok"
				: "NO FIELD";
		}
		if (GRADE_OK.includes(grade) || comments === "ok") touched++;
		report.push({ student: row.name, row: "found", grade, comments });
	}
	console.table(report);
	console.log(
		"LEO -> Moodle: " +
			touched +
			" of " +
			ROWS.length +
			" students filled. Nothing was saved - review and save each one yourself.",
	);
};

function _buildMoodleScript(rows) {
	return (
		"(" +
		_moodleFiller.toString() +
		")(" +
		JSON.stringify(rows, null, 1) +
		");\n"
	);
}

function _moodleFlash(btn, label) {
	const original = btn.textContent;
	btn.textContent = label;
	setTimeout(() => {
		btn.textContent = original;
	}, 1400);
}

function _copyMoodleScript() {
	const btn = document.getElementById("moodle-btn");
	const rows = _moodleFeedbackRows();
	if (!rows.length) {
		alert("No students with a Grade, a Comments value or a Follow score.");
		return;
	}
	const text = _buildMoodleScript(rows);
	const done = () => _moodleFlash(btn, "✓ " + rows.length + " copied");
	const fail = () => _moodleFlash(btn, "✖ Failed");
	if (navigator.clipboard && navigator.clipboard.writeText) {
		navigator.clipboard.writeText(text).then(done).catch(fail);
		return;
	}
	const ta = document.createElement("textarea");
	ta.value = text;
	ta.style.position = "fixed";
	ta.style.opacity = "0";
	document.body.appendChild(ta);
	ta.select();
	try {
		document.execCommand("copy") ? done() : fail();
	} catch {
		fail();
	}
	ta.remove();
}
