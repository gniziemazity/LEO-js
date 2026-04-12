"use strict";

const tooltipEl = document.getElementById("tooltip");
let _pinned = null;

function setupHover(c1, c2, c3, p, L) {
	for (const [canvas, id] of [
		[c1, "c1"],
		[c2, "c2"],
		[c3, "c3"],
	]) {
		if (!canvas) continue;
		const key = canvas.id + "_h";
		if (_hoverAborts.has(key)) _hoverAborts.get(key).abort();
		const ac = new AbortController();
		_hoverAborts.set(key, ac);
		const sig = { signal: ac.signal };

		canvas.addEventListener(
			"mousemove",
			(e) => {
				if (PAN_STATE.active || _pinned) return;
				const hit = findHit(e, canvas, id, p, L);

				if (id === "c3") {
					const newStudent = hit?.type === "student" ? hit.s : null;
					if (newStudent !== _hoveredStudent) {
						_hoveredStudent = newStudent;
						redrawChart3();
					}
				}

				if (hit) showTip(e.clientX, e.clientY, hit, false, id);
				else hideTip();
			},
			sig,
		);

		canvas.addEventListener(
			"mouseleave",
			() => {
				if (id === "c3" && _hoveredStudent) {
					_hoveredStudent = null;
					redrawChart3();
				}
				if (!_pinned) hideTip();
			},
			sig,
		);

		canvas.addEventListener(
			"click",
			(e) => {
				if (PAN_STATE.active) return;
				const hit = findHit(e, canvas, id, p, L);
				if (!hit) {
					_pinned = null;
					hideTip();
					return;
				}
				if (id === "c3" && hit.type === "student") {
					openDiffWindow(hit.s);
					return;
				}
				if (_pinned === hit) {
					_pinned = null;
					hideTip();
				} else {
					_pinned = hit;
					showTip(e.clientX, e.clientY, hit, true, id);
				}
			},
			sig,
		);
	}
}

function canvasXY(e, canvas) {
	const r = canvas.getBoundingClientRect();
	return [e.clientX - r.left, e.clientY - r.top];
}

function findHit(e, canvas, id, p, L) {
	const [mx, my] = canvasXY(e, canvas);
	const { M, plotW } = L;
	const plotH = id === "c1" ? L.plotH1 : id === "c2" ? L.plotH2 : L.plotH3;
	if (mx < M.left || mx > M.left + plotW || my < M.top || my > M.top + plotH)
		return null;
	const ts = xToTs(mx, L);
	const thT = (L.timeMax - L.timeMin) * (10 / plotW);
	if (id === "c1") return hitChart1(ts, p, L, thT);
	if (id === "c2") return hitChart2(ts, my, p, L, thT);
	if (id === "c3") return hitChart3(ts, my, p, L, thT);
	return null;
}

function hitChart1(ts, p, L, thT) {
	let best = null,
		bestD = Infinity;
	for (const b of p.bursts) {
		if (ts >= b.startTs - thT && ts <= b.endTs + thT) {
			const d = Math.abs(ts - b.centerTs);
			if (d < bestD) {
				bestD = d;
				best = { type: "burst", b };
			}
		}
	}
	for (const kp of p.singletons) {
		const d = Math.abs(ts - kp.timestamp / 1000);
		if (d < thT * 2 && d < bestD) {
			bestD = d;
			if (kp._virtualType === "anchor")
				best = {
					type: "anchor",
					anc: { ts: kp.timestamp, ids: [kp._target] },
				};
			else if (kp._virtualType === "move")
				best = {
					type: "move",
					mv: { ts: kp.timestamp, target: kp._target },
				};
			else if (kp._virtualType === "code_insert")
				best = { type: "code_insert", ev: kp };
			else best = { type: "char", ev: kp };
		}
	}
	return best;
}

function hitChart2(ts, my, p, L, thT) {
	const cum = p.cumulative,
		maxN = p.totalChars || 1,
		PY = 8;
	let best = null,
		bestD = Infinity;

	function check(type, payload, evTs_secs) {
		const dx = Math.abs(ts - evTs_secs);
		const dy = Math.abs(my - countToY(charsAt(evTs_secs, cum), maxN, L));
		if (dx < thT * 2 && dy < PY) {
			const dxPx = (dx / (L.timeMax - L.timeMin)) * L.plotW;
			const d = dxPx * dxPx + dy * dy;
			if (d < bestD) {
				bestD = d;
				best = { type, ...payload };
			}
		}
	}

	for (const anc of p.anchors) check("anchor", { anc }, anc.ts / 1000);
	for (const mv of p.moves) check("move", { mv }, mv.ts / 1000);
	for (const ev of p.codeInserts)
		check("code_insert", { ev }, ev.timestamp / 1000);
	for (const ev of p.deletes) check("delete", { ev }, ev.timestamp / 1000);
	for (const ev of p.devChars) check("dev_char", { ev }, ev.timestamp / 1000);

	for (const grp of p.burstGroups) {
		for (const idx of grp.idxs) {
			const c = cum[idx];
			if (!c) continue;
			const dx = Math.abs(ts - c.ts);
			const dy = Math.abs(my - countToY(c.count, maxN, L));
			if (dx < thT * 2 && dy < PY) {
				const dxPx = (dx / (L.timeMax - L.timeMin)) * L.plotW;
				const d = dxPx * dxPx + dy * dy;
				if (d < bestD) {
					bestD = d;
					best = { type: "char", ev: c.event };
				}
			}
		}
	}
	return best || hitInteraction(ts, p);
}

function hitChart3(ts, my, p, L, thT) {
	if (!_students) return null;
	const PY = 10;
	let best = null,
		bestD = Infinity;
	for (const s of _students) {
		if (s.follow_dt == null) continue;
		const jitter = _shake
			? _jitterMap.get(s.name) || { dx: 0, dy: 0 }
			: { dx: 0, dy: 0 };
		const jitterDt = (jitter.dx / L.plotW) * (L.timeMax - L.timeMin);
		const dx = Math.abs(ts - (s.follow_dt + jitterDt));
		const _minY = L.M.top + (L.plotH3Pad || 0);
		const _maxY = L.M.top + L.plotH3 - (L.plotH3Pad || 0);
		const dy = Math.abs(
			my -
				Math.max(
					_minY,
					Math.min(_maxY, pctToY(s.follow_pct, L) + jitter.dy),
				),
		);
		if (dx < thT * 3 && dy < PY) {
			const dxPx = (dx / (L.timeMax - L.timeMin)) * L.plotW;
			const d = dxPx * dxPx + dy * dy;
			if (d < bestD) {
				bestD = d;
				best = { type: "student", s };
			}
		}
	}
	return best;
}

function hitInteraction(ts, p) {
	for (const [itype, qs] of Object.entries(p.interactions)) {
		for (const q of qs) {
			const end =
				q.closed_at ||
				(
					p.events.find((e) => e.timestamp / 1000 > q.timestamp) || {
						timestamp: (q.timestamp + 5) * 1000,
					}
				).timestamp / 1000;
			if (ts >= q.timestamp && ts <= end)
				return { type: "interaction", itype, q };
		}
	}
	return null;
}

function showTip(cx, cy, hit, pinned, chartId) {
	tooltipEl.innerHTML = formatHit(hit, chartId === "c2");
	tooltipEl.style.display = "block";
	tooltipEl.style.background = bgForHit(hit);
	tooltipEl.classList.toggle("pinned", pinned);
	const tw = tooltipEl.offsetWidth,
		th = tooltipEl.offsetHeight;
	let tx = cx + 16,
		ty = cy + 42;
	if (tx + tw > window.innerWidth - 8) tx = cx - tw - 16;
	if (ty + th > window.innerHeight - 8) ty = cy - th + 42;
	tooltipEl.style.left = tx + "px";
	tooltipEl.style.top = ty + "px";
}

function hideTip() {
	tooltipEl.style.display = "none";
}

function bgForHit(hit) {
	if (!hit) return "#ffffff";
	switch (hit.type) {
		case "move":
			return "#FFF3E0";
		case "anchor":
			return "#E3F2FD";
		case "code_insert":
			return "#F5F5F5";
		case "dev_char":
			return "#E8F5E9";
		case "delete":
			return "#FFEBEE";
		case "char":
			return "#ffffff";
		case "burst":
			return hit.b?.colorType === "dev" ? "#E8F5E9" : "#ffffff";
		default:
			return "#ffffff";
	}
}

function escHtml(s) {
	return String(s)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function textPartsToHtml(parts) {
	let charCount = 0;
	const MAX = 300;
	let html = "";
	let truncated = false;
	for (let i = 0; i < parts.length; i++) {
		if (truncated) break;
		const p = parts[i];
		if (p.type === "anchor") {
			html += `<span style="color:#007acc">${escHtml(p.t)}</span>`;
		} else if (p.type === "move") {
			html += `<span style="color:#e07020">→${escHtml(p.t)}</span>`;
		} else if (p.type === "code_insert") {
			const raw = (p.t || "").replace(/⚓[^⚓]*⚓/g, "").replace(/↩/g, "\n");
			const display = raw.length > 200 ? raw.slice(0, 200) + "…" : raw;
			html += `<span style="color:#888888">${escHtml(display)}</span>`;
		} else {
			if (charCount >= MAX) {
				html += escHtml("\n… (+more chars)");
				truncated = true;
			} else {
				const ch = p.t;
				if (DELETE_CHARS.has(ch)) {
					let isPaleRed = false;
					if (ch === "\u232b") {
						const nextChars = parts
							.slice(i + 1)
							.filter((x) => x.type === "char")
							.slice(0, 4)
							.map((x) => x.t)
							.join("");
						isPaleRed = nextChars.startsWith("</");
					}
					const col = isPaleRed ? "#ffaaaa" : "#cc2222";
					html += `<span style="color:${col}">${escHtml(ch)}</span>`;
				} else {
					html += escHtml(ch === "↩" ? "\n" : ch);
				}
				charCount++;
			}
		}
	}
	return html;
}

function formatHit(hit, simple = false) {
	if (simple) return formatHitSimple(hit);

	const lines = [];
	function add(s) {
		lines.push(escHtml(String(s)));
	}

	switch (hit.type) {
		case "burst": {
			const b = hit.b;
			if (b.textParts) lines.push(textPartsToHtml(b.textParts));
			break;
		}
		case "code_insert": {
			const code = hit.ev.code_insert || "";
			const raw = code.replace(/↩/g, "\n");
			const display =
				raw.length > 280
					? raw.slice(0, 280) + `\n… (+${raw.length - 280} more chars)`
					: raw;
			lines.push(escHtml(display));
			break;
		}
		case "student": {
			const s = hit.s;
			const pct =
				s.follow_pct != null ? s.follow_pct.toFixed(1) + "%" : "N/A";
			const mismatches = (s.follow_events || []).filter(
				(ev) => ev.kind && ev.kind !== "normal",
			);
			let html = `👤 ${escHtml(s.name)} (${escHtml(pct)})`;
			const interTypes = [];
			if (_p) {
				const answered = (_p.interactions["teacher-question"] || []).filter(
					(q) => q.answered_by && q.answered_by.includes(s.name),
				);
				for (const q of answered)
					interTypes.push("Answered: " + (q.info || "?"));
				const asked = (_p.interactions["student-question"] || []).filter(
					(q) => q.asked_by && q.asked_by.trim() === s.name,
				);
				for (const q of asked) interTypes.push("Asked: " + (q.info || "?"));
				const helped = (_p.interactions["providing-help"] || []).filter(
					(q) => q.student && q.student.trim() === s.name,
				);
				if (helped.length)
					interTypes.push(
						"Got help" + (helped.length > 1 ? " ×" + helped.length : ""),
					);
			}
			if (interTypes.length) {
				html += "\n──────────\n" + interTypes.join("\n");
			}
			if (mismatches.length) {
				html += "\n──────────\n";
				const counts = new Map();
				const order = [];
				for (const ev of mismatches) {
					const key = (ev.token || ev.label) + "|" + ev.kind;
					if (!counts.has(key)) {
						counts.set(key, { ev, n: 0 });
						order.push(key);
					}
					counts.get(key).n++;
				}
				html += order
					.map((key) => {
						const { ev, n } = counts.get(key);
						const color =
							ev.kind === "missing"
								? "#e53935"
								: ev.kind === "extra-star"
									? "#8e24aa"
									: "#1e88e5";
						const label = escHtml(ev.token || ev.label);
						const suffix = n > 1 ? `<b>×${n}</b>` : "";
						return `<span style="color:${color}">${label}${suffix}</span>`;
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
			return ch === "↩" ? "↩ (Enter)" : escHtml(ch);
		}
		case "dev_char": {
			const ch = hit.ev.char;
			return ch === "↩" ? "↩ (Enter)" : escHtml(ch);
		}
		case "delete": {
			return escHtml(hit.ev.char);
		}
		case "move": {
			return `<span style="color:#e07020">→${escHtml(hit.mv.target)}</span>`;
		}
		case "anchor": {
			return `<span style="color:#007acc">${hit.anc.ids.map(escHtml).join("\n")}</span>`;
		}
		case "code_insert": {
			const raw = (hit.ev.code_insert || "").replace(/↩/g, "\n");
			const display =
				raw.length > 280
					? raw.slice(0, 280) + `\n… (+${raw.length - 280} more chars)`
					: raw;
			return escHtml(display);
		}
		case "interaction": {
			const lines = [];
			function add(s) {
				lines.push(escHtml(String(s)));
			}
			const q = hit.q;
			if (hit.itype === "teacher-question") {
				add(`❓ ${q.info || ""}`);
				if (q.answered_by && q.answered_by.length)
					add(`Answered by: ${q.answered_by.join(", ")}`);
			} else if (hit.itype === "student-question") {
				add(`🙋 ${q.info || ""}`);
				if (q.asked_by) add(`Asked by: ${q.asked_by}`);
			} else if (hit.itype === "providing-help") {
				add("🤝 Providing Help");
				if (q.student) add(`Student: ${q.student}`);
			}
			return lines.join("\n");
		}
		default:
			return formatHit(hit);
	}
}
