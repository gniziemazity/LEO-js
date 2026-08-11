"use strict";

function formatHit(hit, simple = false) {
	if (simple) return formatHitSimple(hit);

	const lines = [];
	function add(s) {
		lines.push(escHtml(String(s)));
	}

	switch (hit.type) {
		case "burst": {
			const b = hit.b;
			if (b.textParts)
				lines.push(
					_trimBlankLines(
						textPartsToHtml(b.textParts, null, b.evs, _p?.replay),
					),
				);
			break;
		}
		case "bar-block": {
			const { blk, burst, kp, students, langCounts } = hit;
			const MAX_HEADER_LINES = 10;
			let headerHtml = "";
			if (burst && burst.textParts) {
				const blockMissings = (students || []).flatMap(({ evs }) =>
					(evs || []).filter((e) => e.kind === "missing"),
				);
				const partColors = _buildPartColorsForMismatches(
					burst,
					blockMissings,
				);
				const {
					parts: filtered,
					partColors: filteredColors,
					evs: filteredEvs,
				} = _filterAnchorMoveParts(burst.textParts, partColors, burst.evs);
				const {
					parts: trunc,
					truncated,
					evs: truncEvs,
				} = _truncatePartsAtLines(filtered, MAX_HEADER_LINES, filteredEvs);
				headerHtml = _trimBlankLines(
					textPartsToHtml(trunc, filteredColors, truncEvs, _p?.replay),
				);
				if (truncated) headerHtml += "\n…";
			} else if (kp) {
				if (kp._virtualType === "code_insert") {
					const synthBurst = {
						textParts: [_singletonToTextPart(kp)],
						evs: [kp],
					};
					const blockMissings = (students || []).flatMap(({ evs }) =>
						(evs || []).filter((e) => e.kind === "missing"),
					);
					const partColors = _buildPartColorsForMismatches(
						synthBurst,
						blockMissings,
					);
					const {
						parts: filtered,
						partColors: filteredColors,
						evs: filteredEvs,
					} = _filterAnchorMoveParts(
						synthBurst.textParts,
						partColors,
						synthBurst.evs,
					);
					const {
						parts: trunc,
						truncated,
						evs: truncEvs,
					} = _truncatePartsAtLines(
						filtered,
						MAX_HEADER_LINES,
						filteredEvs,
					);
					headerHtml = _trimBlankLines(
						textPartsToHtml(trunc, filteredColors, truncEvs, _p?.replay),
					);
					if (truncated) headerHtml += "\n…";
				} else if (
					kp._virtualType === "anchor" ||
					kp._virtualType === "move"
				) {
					headerHtml = "";
				} else {
					headerHtml = escHtml(kp.char || "");
				}
			}
			const headerLine =
				headerHtml ||
				`<b>${escHtml(fmtTime(blk.ts1))} – ${escHtml(fmtTime(blk.ts2))}</b>`;
			const sorted = [...students].sort(
				(a, b) => (b.s.follow_pct ?? 0) - (a.s.follow_pct ?? 0),
			);
			_barBlockStudents = sorted;
			const blockLangs = LANG_STACK_ORDER.filter(
				(l) => l !== "?" && (langCounts[l] || 0) > 0,
			);
			const perLangCounts = sorted.map(({ evs }) => {
				const pl = {};
				for (const e of evs) {
					const l = e.lang || "?";
					pl[l] = (pl[l] || 0) + 1;
				}
				return blockLangs.map((l) => String(pl[l] || 0));
			});
			const maxLangWidths = blockLangs.map((_l, i) =>
				perLangCounts.reduce((m, arr) => Math.max(m, arr[i].length), 0),
			);
			return _wrapBarTooltip(
				headerLine,
				_renderStudentGrid(
					sorted,
					blockLangs,
					perLangCounts,
					maxLangWidths,
				),
			);
		}
		case "token-bar": {
			const { bar } = hit;
			const tokenEsc = escHtml(bar.token || "");
			const tags = [];
			if (bar.isComment) tags.push("comment");
			if (bar.lang) tags.push(bar.lang);
			if (bar.isRemoved) tags.push("ghost");
			const tagStr = tags.length ? ` [${escHtml(tags.join(", "))}]` : "";
			const entries = bar.studentEntries || [];
			if (!entries.length) {
				_barBlockStudents = [];
				return `<b>${tokenEsc}</b>${tagStr}<br><span style="color:#aaa">no mismatches</span>`;
			}
			const sorted = [...entries].sort(
				(a, b) => (b.s.follow_pct ?? 0) - (a.s.follow_pct ?? 0),
			);
			_barBlockStudents = sorted;
			const nStudents = sorted.length;
			const header = nStudents === 1 ? "1 student" : `${nStudents} students`;
			return _wrapBarTooltip(header, _renderStudentGrid(sorted, [], [], []));
		}
		case "code_insert": {
			const code = hit.ev.code_insert || "";
			const raw = code.replace(/↩/g, "\n");
			const trimmed = raw
				.replace(/^(?:[ \t]*\n)+/, "")
				.replace(/\n+[ \t]*$/, "");
			lines.push(
				`<span style="color:${THEME.black};text-decoration:underline ${THEME.codeMuted}">${escHtml(trimmed)}</span>`,
			);
			break;
		}
		case "student": {
			const s = hit.s;
			const pct =
				s.follow_pct != null ? s.follow_pct.toFixed(1) + "%" : "N/A";
			const idPrefix = s.id ? `${escHtml(s.id)}. ` : "";
			let html = `<span class="tt-student" data-header-student="1">👤 ${idPrefix}${escHtml(s.name)} (${escHtml(pct)})</span>`;
			const interTypes = [];
			if (_p) {
				const answered = (_p.interactions["teacher-question"] || []).filter(
					(q) =>
						q.answered_by &&
						q.answered_by.some((field) =>
							matchesStudentName(field, s.name),
						),
				);
				for (const q of answered)
					interTypes.push(
						`<span style="color:${INTERACTION_COLORS["teacher-question"].hex}">Answered: ${escHtml(q.info || "?")}</span>`,
					);
				const asked = (_p.interactions["student-question"] || []).filter(
					(q) => q.asked_by && matchesStudentName(q.asked_by, s.name),
				);
				for (const q of asked)
					interTypes.push(
						`<span style="color:${INTERACTION_COLORS["student-question"].hex}">Asked: ${escHtml(q.info || "?")}</span>`,
					);
				const helped = (_p.interactions["providing-help"] || []).filter(
					(q) => q.student && matchesStudentName(q.student, s.name),
				);
				if (helped.length)
					interTypes.push(
						`<span style="color:${INTERACTION_COLORS["providing-help"].hex}">Got help${helped.length > 1 ? " ×" + helped.length : ""}</span>`,
					);
			}
			if (interTypes.length) {
				html += "\n──────────\n" + interTypes.join("\n");
			}

			let cluster = hit.cluster;
			const isDashHover = cluster != null;
			if (!cluster) {
				const clusters = _clusterMistakes(
					_mistakeEventsFor(s),
					CFG.BURST_GAP,
				);
				if (clusters.length) {
					const first = clusters[0];
					cluster = {
						ts1: first[0].ts,
						ts2: first[first.length - 1].ts,
					};
				}
			}

			if (cluster) {
				const allMissings = (s.follow_events || []).filter(
					(ev) => ev.kind === "missing",
				);
				const lookback = CFG.BURST_GAP;
				const winLo = cluster.ts1 - lookback;
				const winHi = cluster.ts2 + lookback;
				const singletonBlocks = (_p?.singletons || [])
					.filter((kp) => {
						const ts = kp.timestamp / 1000;
						return ts >= winLo && ts <= winHi;
					})
					.map((kp) => {
						const ts = kp.timestamp / 1000;
						return {
							startTs: ts,
							endTs: ts,
							textParts: [_singletonToTextPart(kp)],
							evs: [kp],
						};
					});
				const allBlocks = [
					...(_p?.bursts || []).filter(
						(b) => b.endTs >= winLo && b.startTs <= winHi,
					),
					...singletonBlocks,
				].sort((a, b) => a.startTs - b.startTs);
				const blockHtmls = allBlocks
					.map((b) => {
						if (!b.textParts) return "";
						const partColors = _buildPartColorsForMismatches(
							b,
							allMissings,
						);
						const {
							parts: filtered,
							partColors: filteredColors,
							evs: filteredEvs,
						} = _filterAnchorMoveParts(b.textParts, partColors, b.evs);
						const {
							parts: trunc,
							truncated,
							evs: truncEvs,
						} = _truncatePartsAtLines(filtered, 10, filteredEvs);
						let h = _trimBlankLines(
							textPartsToHtml(
								trunc,
								filteredColors,
								truncEvs,
								_p?.replay,
							),
						);
						if (truncated) h += "\n…";
						return h;
					})
					.filter(Boolean);
				if (blockHtmls.length) {
					html += "\n──────────\n" + blockHtmls.join("\n──────────\n");
				}
			}

			const mismatches = (s.follow_events || []).filter(
				(ev) => ev.kind && ev.kind !== "normal",
			);
			mismatches.sort((a, b) => {
				const ea = a.kind === "extra" ? 1 : 0;
				const eb = b.kind === "extra" ? 1 : 0;
				return ea - eb;
			});
			if (mismatches.length) {
				html += "\n──────────\n";
				const counts = new Map();
				const order = [];
				const inSection = new Set();
				for (const ev of mismatches) {
					const key = (ev.token || ev.label) + "|" + ev.kind;
					if (!counts.has(key)) {
						counts.set(key, { ev, n: 0 });
						order.push(key);
					}
					counts.get(key).n++;
					if (
						isDashHover &&
						cluster &&
						ev.ts != null &&
						ev.ts >= cluster.ts1 &&
						ev.ts <= cluster.ts2
					) {
						inSection.add(key);
					}
				}
				html += order
					.map((key) => {
						const { ev, n } = counts.get(key);
						const langCls =
							(ev.kind === "missing" || ev.kind === "extra-star") &&
							ev.lang
								? `${_langClassFor(ev.lang)}${ev.kind === "extra-star" ? " tt-ghost" : ""}`
								: null;
						const markCls =
							langCls ||
							(ev.kind === "missing"
								? "tt-mark-missing"
								: ev.kind === "extra-star"
									? "tt-mark-ghost"
									: "tt-mark-extra");
						const label = escHtml(ev.token || ev.label);
						const suffix = n > 1 ? `<b>×${n}</b>` : "";
						const emphCls = inSection.has(key) ? " tt-emph" : "";
						return `<span class="${markCls}${emphCls}">${label}${suffix}</span>`;
					})
					.join(", ");
			}
			return html;
		}
		default:
			return formatHitSimple(hit);
	}
	return lines.join("\n");
}

function formatHitSimple(hit) {
	switch (hit.type) {
		case "char": {
			const ch = hit.ev.char;
			if (ch === "↩" || ch === "\n") return `<span class="tt-nl">\\n</span>`;
			return ch === " " ? "␣" : escHtml(ch);
		}
		case "dev_char": {
			const ch = hit.ev.char;
			if (ch === "↩" || ch === "\n") return `<span class="tt-nl">\\n</span>`;
			return ch === " " ? "␣" : escHtml(ch);
		}
		case "delete": {
			return escHtml(hit.ev.char);
		}
		case "move": {
			return `<span class="tt-move">→${escHtml(hit.mv.target)}</span>`;
		}
		case "anchor": {
			return `<span class="tt-anchor">${hit.anc.ids.map(escHtml).join("\n")}</span>`;
		}
		case "code_insert": {
			const raw = (hit.ev.code_insert || "").replace(/↩/g, "\n");
			const trimmed = raw
				.replace(/^(?:[ \t]*\n)+/, "")
				.replace(/\n+[ \t]*$/, "");
			return `<span style="color:${THEME.black};text-decoration:underline ${THEME.codeMuted}">${escHtml(trimmed)}</span>`;
		}
		case "interaction": {
			const q = hit.q;
			const clr = INTERACTION_COLORS[hit.itype]?.hex;
			const icon = INTERACTION_KINDS[hit.itype]?.icon || "💬";
			if (hit.itype === "teacher-question") {
				let h = `<span style="color:${clr}">${icon} ${escHtml(q.info || "")}</span>`;
				if (q.answered_by && q.answered_by.length) {
					const names = q.answered_by.map((field) =>
						resolveInteractionStudentDisplayWithId(field),
					);
					h += `\nAnswered by: ${names.map(escHtml).join(", ")}`;
				}
				return h;
			} else if (hit.itype === "student-question") {
				let h = `<span style="color:${clr}">${icon} ${escHtml(q.info || "")}</span>`;
				if (q.asked_by) {
					const name = resolveInteractionStudentDisplayWithId(q.asked_by);
					h += `\nAsked by: ${escHtml(name)}`;
				}
				return h;
			} else if (hit.itype === "providing-help") {
				let h = `<span style="color:${clr}">${icon} Provided Help</span>`;
				if (q.student) {
					const name = resolveInteractionStudentDisplayWithId(q.student);
					h += `\nStudent: ${escHtml(name)}`;
				}
				return h;
			}
			return "";
		}
		default:
			return formatHit(hit);
	}
}
