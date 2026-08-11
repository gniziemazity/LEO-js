"use strict";

class FollowBar {
	constructor(pct, color = null, decimals = 1) {
		this.pct = pct;
		this.color = color;
		this.decimals = decimals;
	}
	render() {
		const frag = document.createDocumentFragment();
		const pctEl = document.createElement("span");
		pctEl.className = "follow-pct";
		pctEl.textContent = this.pct.toFixed(this.decimals) + "%";
		if (this.color) pctEl.style.color = this.color;
		const bar = document.createElement("div");
		bar.className = "follow-bar";
		const fill = document.createElement("div");
		fill.className = "follow-bar-fill";
		fill.style.width = Math.max(0, Math.min(100, this.pct)) + "%";
		if (this.color) fill.style.background = this.color;
		bar.appendChild(fill);
		frag.appendChild(pctEl);
		frag.appendChild(bar);
		return frag;
	}
}
