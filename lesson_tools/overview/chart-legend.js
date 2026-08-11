"use strict";

class ChartLegend {
	constructor(items) {
		this.items = items || [];
	}
	render() {
		const legend = el("div", "chart-legend");
		for (const it of this.items) {
			const item = el("span", "chart-legend-item");
			const sq = el("span", "chart-legend-sq");
			sq.style.background = it.color;
			item.appendChild(sq);
			item.appendChild(document.createTextNode(it.label));
			legend.appendChild(item);
		}
		return legend;
	}
}
