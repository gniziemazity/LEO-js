"use strict";

const INTERACTION_TYPES = [
	{ key: "total_a", emoji: INTERACTION_KINDS["teacher-question"].icon },
	{ key: "total_q", emoji: INTERACTION_KINDS["student-question"].icon },
	{ key: "total_h", emoji: INTERACTION_KINDS["providing-help"].icon },
];

class InteractionCell {
	constructor(a, q, h) {
		this.counts = [a, q, h];
	}
	static badge(n, emoji) {
		const c = Math.round(+n);
		if (!(c > 0)) return "";
		return `<span class="ia-box">${c}${emoji}</span>`;
	}
	render() {
		const wrap = document.createElement("div");
		wrap.className = "ia-cell";
		INTERACTION_TYPES.forEach((t, i) => {
			const slot = document.createElement("span");
			slot.className = "ia-slot";
			slot.innerHTML = InteractionCell.badge(this.counts[i], t.emoji);
			wrap.appendChild(slot);
		});
		return wrap;
	}
}
