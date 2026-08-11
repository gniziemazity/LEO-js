"use strict";

class Mismatches {
	constructor(events) {
		this.parts = Mismatches._parts(events);
	}
	static color(ev) {
		if (ev.kind === "missing" || ev.kind === "extra-star") {
			const c = langColorFor(ev.lang);
			if (c) return c;
		}
		return markColorFor(ev.kind) || THEME.muted;
	}
	static _parts(events) {
		const mismatches = (events || []).filter((ev) => ev.kind !== "normal");
		mismatches.sort((a, b) => {
			const ea = a.kind === "extra" ? 1 : 0;
			const eb = b.kind === "extra" ? 1 : 0;
			return ea - eb;
		});
		const counts = new Map();
		const order = [];
		for (const ev of mismatches) {
			const key = ev.token + "|" + ev.kind;
			if (!counts.has(key)) {
				counts.set(key, { ev, n: 0 });
				order.push(key);
			}
			counts.get(key).n++;
		}
		return order.map((key) => {
			const { ev, n } = counts.get(key);
			return {
				token: ev.token,
				n,
				color: Mismatches.color(ev),
				dim: ev.kind === "extra-star",
			};
		});
	}
	cell() {
		if (!this.parts.length) return null;
		const wrap = document.createElement("div");
		wrap.className = "mismatch-cell";
		this.parts.forEach((p, i) => {
			const span = document.createElement("span");
			span.className = "mismatch-token";
			if (p.dim) span.style.opacity = "0.5";
			span.style.color = p.color;
			span.textContent = p.token + (p.n > 1 ? "×" + p.n : "");
			wrap.appendChild(span);
			if (i < this.parts.length - 1) {
				const comma = document.createElement("span");
				comma.textContent = ", ";
				comma.style.color = THEME.codeMuted;
				wrap.appendChild(comma);
			}
		});
		return wrap;
	}
	tipHtml() {
		return this.parts
			.map(
				(p) =>
					`<span style="color:${p.color};font-family:Consolas,monospace;font-weight:bold${
						p.dim ? ";opacity:0.5" : ""
					}">${escHtml(p.token)}${p.n > 1 ? "&times;" + p.n : ""}</span>`,
			)
			.join(`<span style="color:${THEME.codeMuted}">, </span>`);
	}
}
